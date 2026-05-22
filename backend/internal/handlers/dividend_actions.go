package handlers

import (
	"fmt"
	"math"
	"net/http"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// logDividendAction writes one row to the dividend_actions audit table.
// Called from every Collect/Block/Release/Transfer/Reinvest path so the
// "+" expander on the dividend row can show the full lifecycle.
func logDividendAction(tx *gorm.DB, action models.DividendAction) {
	if action.ActedAt.IsZero() {
		action.ActedAt = time.Now()
	}
	tx.Create(&action)
}

// liveDividend recomputes weighted_shares / gross / tax / net for a single
// dividend based on the CURRENT Investment state. This is what the
// shareholder is actually entitled to right now, regardless of what was
// stored at the original ProcessDividend snapshot. A transfer that
// happens after processing reduces the seller's live values and increases
// the buyer's. The stored snapshot is preserved for audit; the live values
// are what the UI displays as primary.
type liveDividendResult struct {
	WeightedShares float64 `json:"weighted_shares"`
	Gross          float64 `json:"gross"`
	Tax            float64 `json:"tax"`
	Net            float64 `json:"net"`
}

func computeLiveDividend(dividend models.Dividend, setting models.DividendSetting) liveDividendResult {
	daysInYear := float64(setting.DaysInYear)
	if daysInYear == 0 {
		daysInYear = 365
	}
	endDate := time.Now()
	if setting.ReferenceDate != nil {
		endDate = *setting.ReferenceDate
	}

	var investments []models.Investment
	database.DB.Where("shareholder_id = ? AND status = ? AND approval_status = ?",
		dividend.ShareholderID, "active", "approved").Find(&investments)

	var weighted float64
	for _, inv := range investments {
		if inv.PaymentDate == nil {
			continue
		}
		daysHeld := endDate.Sub(*inv.PaymentDate).Hours() / 24
		if daysHeld < 0 {
			continue
		}
		if daysHeld > daysInYear {
			daysHeld = daysInYear
		}
		weighted += float64(inv.NumberOfShares) * daysHeld / daysInYear
	}

	gross := weighted * setting.DividendPerShare
	if gross < 0 {
		gross = 0
		weighted = 0
	}

	// Tax recalculated on (live gross − reinvested portion), matching the
	// reinvest action's semantics.
	taxableGross := gross - dividend.ReinvestedAmount
	if taxableGross < 0 {
		taxableGross = 0
	}
	var taxSchedules []models.DividendTaxSchedule
	database.DB.Order("min_amount ASC").Find(&taxSchedules)
	tax := calculateDividendTax(taxableGross, taxSchedules)
	net := taxableGross - tax
	if net < 0 {
		net = 0
	}

	r := math.Round
	return liveDividendResult{
		WeightedShares: r(weighted*10000) / 10000,
		Gross:          r(gross*100) / 100,
		Tax:            r(tax*100) / 100,
		Net:            r(net*100) / 100,
	}
}

// ReinvestDividend is the unified "Subscribe from Dividend" action.
//
// The user can:
//   - reinvest_amount: take part of the gross dividend and put it into a
//     new Investment row. This portion is NOT taxed (the shareholder didn't
//     realize the gain — they reinvested it).
//   - additional_amount: add fresh money from cash/bank/CPO. Tax never
//     applies here.
//
// After the action:
//   - dividend.reinvested_amount += reinvest_amount
//   - tax is RECALCULATED on the remaining gross (gross - reinvested), so
//     reinvesting drops the shareholder into a lower bracket if the tax
//     schedule is progressive.
//   - net_dividend / uncollected_amount are updated accordingly.
//   - One or two Investment rows are created (one tagged payment_method =
//     "dividend", one with the chosen additional method).
//   - A DividendAction row is logged for transparency.
func ReinvestDividend(c *gin.Context) {
	id := c.Param("id")
	var dividend models.Dividend
	if err := database.DB.First(&dividend, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dividend not found"})
		return
	}
	if dividend.IsBlocked {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dividend is blocked"})
		return
	}

	var input struct {
		ReinvestAmount          float64 `json:"reinvest_amount"`           // gross portion to reinvest (no tax)
		AdditionalAmount        float64 `json:"additional_amount"`          // optional, from shareholder's own pocket
		AdditionalPaymentMethod string  `json:"additional_payment_method"` // cash, bank_transfer, cpo, check
		SubscriptionID          *uint   `json:"subscription_id"`            // optional — link investment(s) to a subscription
		AllocationID            *uint   `json:"allocation_id"`              // optional — link to a specific allocation
		FromAccount             string  `json:"from_account"`               // for additional payment
		ReferenceNo             string  `json:"reference_no"`
		Remark                  string  `json:"remark"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.ReinvestAmount <= 0 && input.AdditionalAmount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Provide reinvest_amount and/or additional_amount"})
		return
	}

	// Validate reinvest portion: must fit within (gross - already-reinvested - already-collected)
	collectedGrossEquivalent := dividend.CollectedAmount
	// Treat collected_amount as "net cash" — gross-equivalent depends on the
	// effective rate at the time. To keep this simple and conservative we
	// constrain reinvest_amount to leave room for already-collected cash.
	available := dividend.GrossDividend - dividend.ReinvestedAmount - collectedGrossEquivalent
	if input.ReinvestAmount > available+0.005 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Reinvest amount %.2f exceeds available %.2f (gross %.2f − already reinvested %.2f − collected %.2f)",
				input.ReinvestAmount, available, dividend.GrossDividend, dividend.ReinvestedAmount, collectedGrossEquivalent),
		})
		return
	}

	// Recalculate tax on the post-reinvest taxable gross.
	var taxSchedules []models.DividendTaxSchedule
	database.DB.Order("min_amount ASC").Find(&taxSchedules)

	newReinvested := dividend.ReinvestedAmount + input.ReinvestAmount
	newTaxableGross := dividend.GrossDividend - newReinvested
	if newTaxableGross < 0 {
		newTaxableGross = 0
	}
	newTax := calculateDividendTax(newTaxableGross, taxSchedules)
	newNetDividend := newTaxableGross - newTax
	newUncollected := newNetDividend - dividend.CollectedAmount
	if newUncollected < -0.005 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Reinvest would leave uncollected balance negative (%.2f). Collect less cash or reinvest less.", newUncollected),
		})
		return
	}
	if newUncollected < 0 {
		newUncollected = 0
	}

	totalInvestmentAmount := input.ReinvestAmount + input.AdditionalAmount

	now := time.Now()
	userID := getUserID(c)

	// Captured by the transaction closure so we can include the snapped values
	// in the JSON response (admin sees exactly how many whole shares were
	// created and any unused residual that stayed in the dividend).
	var snappedReinvestShares, snappedAdditionalShares int64
	var snappedReinvestAmount, snappedAdditionalAmount float64
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		oldTax := dividend.TaxAmount

		// Snap to whole shares: an Investment row cannot own fractional shares.
		// We floor (amount ÷ par) for each portion, and the residual ETB stays
		// untouched (in the dividend for reinvest, returned via the response
		// summary for additional). The frontend's modal preview shows this
		// exactly so the admin can adjust before submitting if they want to
		// reach the next whole share by topping up the additional amount.
		parValue := float64(0)
		var bc models.BankCapital
		if err := tx.First(&bc).Error; err == nil && bc.ParValuePerShare > 0 {
			parValue = bc.ParValuePerShare
		}
		if parValue <= 0 {
			return fmt.Errorf("par value per share is not configured in bank capital settings")
		}

		// COMBINE FIRST, then floor. This is the key change: the residual
		// from the dividend portion (e.g. 479.25) combines with the additional
		// (520.75) to fund the last whole share. Previously we floored each
		// portion separately and lost that crossover.
		combined := input.ReinvestAmount + input.AdditionalAmount
		totalShares := int64(math.Floor(combined / parValue))
		if totalShares <= 0 {
			return fmt.Errorf("combined amount ETB %.2f doesn't add up to one whole share at par ETB %.2f. Increase the amount or use Collect for the small balance", combined, parValue)
		}
		totalUsed := float64(totalShares) * parValue
		// Consume reinvest first — anything reinvest can't fund is paid from
		// the additional cash. Any leftover reinvest (e.g. user reinvested
		// 1500 but combined only used 1000) stays in the dividend untouched.
		actualReinvest := math.Min(input.ReinvestAmount, totalUsed)
		actualAdditional := totalUsed - actualReinvest

		// For the response we report two "logical" share counts split by
		// funding source — these are floats rounded for display only.
		var reinvestShares, additionalShares int64
		if input.AdditionalAmount > 0 && actualAdditional > 0 {
			// Some shares funded entirely by additional, plus the fractional
			// share that bridges reinvest and additional. We attribute the
			// bridging share to the side that contributed more of it.
			cleanReinvestShares := int64(math.Floor(input.ReinvestAmount / parValue))
			cleanAdditionalShares := int64(math.Floor(input.AdditionalAmount / parValue))
			bridgeShare := totalShares - cleanReinvestShares - cleanAdditionalShares
			reinvestShares = cleanReinvestShares
			additionalShares = cleanAdditionalShares + bridgeShare
		} else {
			reinvestShares = totalShares
			additionalShares = 0
		}
		snappedReinvestShares = reinvestShares
		snappedAdditionalShares = additionalShares
		snappedReinvestAmount = actualReinvest
		snappedAdditionalAmount = actualAdditional

		// Use the snapped reinvest amount (not the user's requested amount)
		// to recompute the dividend ledger. Any residual ETB stays in the
		// dividend record untouched (i.e. still available as uncollected).
		snappedReinvested := dividend.ReinvestedAmount + actualReinvest
		snappedTaxableGross := dividend.GrossDividend - snappedReinvested
		if snappedTaxableGross < 0 {
			snappedTaxableGross = 0
		}
		snappedTax := calculateDividendTax(snappedTaxableGross, taxSchedules)
		snappedNet := snappedTaxableGross - snappedTax
		snappedUncollected := snappedNet - dividend.CollectedAmount
		if snappedUncollected < -0.005 {
			return fmt.Errorf("snap would leave uncollected balance negative (%.2f)", snappedUncollected)
		}
		if snappedUncollected < 0 {
			snappedUncollected = 0
		}
		dividend.ReinvestedAmount = math.Round(snappedReinvested*100) / 100
		dividend.TaxAmount = math.Round(snappedTax*100) / 100
		dividend.NetDividend = math.Round(snappedNet*100) / 100
		dividend.UncollectedAmount = math.Round(snappedUncollected*100) / 100
		if dividend.UncollectedAmount <= 0 && dividend.ReinvestedAmount+dividend.CollectedAmount >= dividend.GrossDividend-0.005 {
			dividend.Status = "settled"
		}
		if err := tx.Save(&dividend).Error; err != nil {
			return err
		}

		// Single combined Investment row representing the whole-share purchase.
		// Tagged "dividend" if dividend money is the dominant source; otherwise
		// the additional payment method. The Remark spells out the funding
		// split for audit.
		method := input.AdditionalPaymentMethod
		if method == "" {
			method = "cash"
		}
		if actualReinvest >= actualAdditional {
			method = "dividend"
		}
		remark := fmt.Sprintf("Dividend #%d reinvestment: %d whole shares (ETB %.2f) — ETB %.2f from dividend",
			dividend.ID, totalShares, totalUsed, actualReinvest)
		if actualAdditional > 0 {
			remark += fmt.Sprintf(" + ETB %.2f from %s", actualAdditional, input.AdditionalPaymentMethod)
		}
		inv := models.Investment{
			ShareholderID:  dividend.ShareholderID,
			PaymentDate:    &now,
			PaymentMethod:  method,
			Amount:         totalUsed,
			NumberOfShares: totalShares,
			ParValue:       parValue,
			ReferenceNo:    input.ReferenceNo,
			FromAccount:    input.FromAccount,
			AllocationID:   input.AllocationID,
			Status:         "active",
			ApprovalStatus: "pending",
			Remark:         remark,
		}
		if err := tx.Create(&inv).Error; err != nil {
			return err
		}
		tx.Create(&models.PendingApproval{
			EntityType:  "investment",
			EntityID:    inv.ID,
			Action:      "create",
			RequestedBy: userID,
			Status:      "pending",
			RequestedAt: now,
		})
		fromDividendInv := &inv

		// Log action — record the ACTUAL snapped reinvest amount (not the
		// user's requested amount) so a later reject can reverse this exact
		// number from the dividend ledger.
		var invID *uint
		if fromDividendInv != nil {
			invID = &fromDividendInv.ID
		}
		desc := fmt.Sprintf("Reinvested ETB %.2f from dividend (%d whole shares)", actualReinvest, reinvestShares)
		if input.AdditionalAmount > 0 {
			desc = fmt.Sprintf("%s + ETB %.2f additional (%s) — total %d shares (ETB %.2f)",
				desc, actualAdditional, input.AdditionalPaymentMethod, totalShares, totalUsed)
		}
		desc = fmt.Sprintf("%s · tax recalc: %.2f → %.2f", desc, oldTax, dividend.TaxAmount)
		logDividendAction(tx, models.DividendAction{
			DividendID:    dividend.ID,
			ActionType:    "reinvest",
			Amount:        actualReinvest, // snapped — used as the exact reversal amount on reject
			TaxImpact:     dividend.TaxAmount - oldTax,
			Description:   desc,
			InvestmentID:  invID,
			PaymentMethod: input.AdditionalPaymentMethod,
			Remark:        input.Remark,
			ActedByUserID: userID,
		})
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	totalShares := snappedReinvestShares + snappedAdditionalShares
	totalSnappedAmount := snappedReinvestAmount + snappedAdditionalAmount
	residual := totalInvestmentAmount - totalSnappedAmount
	c.JSON(http.StatusOK, gin.H{
		"message":                  "Reinvestment recorded",
		"dividend":                 dividend,
		"requested_total":          totalInvestmentAmount,
		"snapped_reinvest_amount":  snappedReinvestAmount,
		"snapped_reinvest_shares":  snappedReinvestShares,
		"snapped_additional_amount": snappedAdditionalAmount,
		"snapped_additional_shares": snappedAdditionalShares,
		"snapped_total_amount":     totalSnappedAmount,
		"snapped_total_shares":     totalShares,
		"residual_unused":          residual, // fractional ETB that didn't fit into a whole share
		"new_tax_amount":           dividend.TaxAmount,
		"new_net_dividend":         dividend.NetDividend,
		"new_uncollected":          dividend.UncollectedAmount,
		"new_reinvested":           dividend.ReinvestedAmount,
	})
}

// GetDividendBreakdown returns the per-INVESTMENT weighted-shares detail
// behind the dividend's WeightedAvgShares figure. This mirrors exactly what
// ProcessDividend does: each Investment (payment event) is one row, weighted
// by its own payment_date. Partial payments naturally appear as separate
// rows, so a shareholder who paid 200/100/200 across three dates sees three
// rows with different days_held — and the sum matches the stored gross.
func GetDividendBreakdown(c *gin.Context) {
	id := c.Param("id")
	var dividend models.Dividend
	if err := database.DB.Preload("Shareholder").Preload("DividendSetting").
		First(&dividend, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dividend not found"})
		return
	}

	setting := dividend.DividendSetting
	daysInYear := float64(setting.DaysInYear)
	if daysInYear == 0 {
		daysInYear = 365
	}

	endDate := time.Now()
	if setting.ReferenceDate != nil {
		endDate = *setting.ReferenceDate
	}

	// Per-investment: shares × days_held / days_in_year, summed.
	// Approved + active only (matches what ProcessDividend uses).
	var investments []models.Investment
	database.DB.Where("shareholder_id = ? AND status = ?", dividend.ShareholderID, "active").
		Order("payment_date ASC, id ASC").Find(&investments)

	type entry struct {
		InvestmentID    uint       `json:"investment_id"`
		AllocationID    *uint      `json:"allocation_id"`
		AllocationNo    string     `json:"allocation_no"`
		PaymentMethod   string     `json:"payment_method"`
		ReferenceNo     string     `json:"reference_no"` // for transfer rows this is the batch_no
		Kind            string     `json:"kind"`          // original | transfer_in | transfer_out | dividend
		Shares          int64      `json:"shares"`            // signed (transfer_out is negative)
		Amount          float64    `json:"amount"`            // stored (signed) — what was actually paid
		BookAmount      float64    `json:"book_amount"`       // shares × COMPANY par — book value used for dividend math
		ParValue        float64    `json:"par_value"`         // stored par (transfer price for transfer rows)
		CompanyParValue float64    `json:"company_par_value"` // the bank-capital par used for book valuation
		PaymentDate     *time.Time `json:"payment_date"`
		EndingDate      *time.Time `json:"ending_date"`
		DaysHeld        float64    `json:"days_held"`
		WeightedShares  float64    `json:"weighted_shares"`   // = shares × days_held ÷ days_in_year
		Formula         string     `json:"formula"`
		ApprovalStatus  string     `json:"approval_status"`
	}
	var entries []entry
	var totalWeighted float64

	// Preload allocations so we can show allocation_no per investment
	allocCache := map[uint]models.Allocation{}
	for _, inv := range investments {
		if inv.AllocationID != nil {
			if _, ok := allocCache[*inv.AllocationID]; !ok {
				var a models.Allocation
				if err := database.DB.First(&a, *inv.AllocationID).Error; err == nil {
					allocCache[a.ID] = a
				}
			}
		}
	}

	// Load the company par value (from BankCapital) — used for the "book
	// value" column. Transferred shares were paid at the transfer's par
	// (which can differ — e.g. 1,200 vs 1,000) but for dividend / ownership
	// accounting we value them at the company's par. The Amount column in
	// the UI shows this book value; the stored amount is in a tooltip.
	companyPar := 0.0
	var bc models.BankCapital
	if err := database.DB.First(&bc).Error; err == nil && bc.ParValuePerShare > 0 {
		companyPar = bc.ParValuePerShare
	}

	for _, inv := range investments {
		// Skip rows that won't enter the per-investment formula:
		// - investments not approved (still pending)
		// - investments with no payment date
		if inv.ApprovalStatus != "approved" {
			continue
		}
		if inv.PaymentDate == nil {
			continue
		}
		// Days held = end - payment_date (clamped to [0, days_in_year])
		daysHeld := endDate.Sub(*inv.PaymentDate).Hours() / 24
		if daysHeld < 0 {
			continue // payment after reference date — doesn't contribute
		}
		if daysHeld > daysInYear {
			daysHeld = daysInYear
		}
		weighted := float64(inv.NumberOfShares) * daysHeld / daysInYear

		allocNo := ""
		if inv.AllocationID != nil {
			if a, ok := allocCache[*inv.AllocationID]; ok {
				allocNo = a.AllocationNo
			}
		}

		kind := "original"
		switch inv.PaymentMethod {
		case "transfer_in":
			kind = "transfer_in"
		case "transfer_out":
			kind = "transfer_out"
		case "dividend":
			kind = "dividend"
		}
		bookAmount := float64(inv.NumberOfShares) * companyPar
		entries = append(entries, entry{
			InvestmentID:    inv.ID,
			AllocationID:    inv.AllocationID,
			AllocationNo:    allocNo,
			PaymentMethod:   inv.PaymentMethod,
			ReferenceNo:     inv.ReferenceNo,
			Kind:            kind,
			Shares:          inv.NumberOfShares,
			Amount:          inv.Amount,
			BookAmount:      math.Round(bookAmount*100) / 100,
			ParValue:        inv.ParValue,
			CompanyParValue: companyPar,
			PaymentDate:     inv.PaymentDate,
			EndingDate:      &endDate,
			DaysHeld:        math.Round(daysHeld*100) / 100,
			WeightedShares:  math.Round(weighted*10000) / 10000,
			Formula:         fmt.Sprintf("%d × %.0f ÷ %.0f", inv.NumberOfShares, math.Round(daysHeld), daysInYear),
			ApprovalStatus:  inv.ApprovalStatus,
		})
		totalWeighted += weighted
	}

	live := computeLiveDividend(dividend, setting)

	c.JSON(http.StatusOK, gin.H{
		"dividend":              dividend,
		"days_in_year":          daysInYear,
		"reference_date":        setting.ReferenceDate,
		"formula_label":         "Σ ( shares × days_held ÷ days_in_year ) — per payment event",
		"investments":           entries,
		"total_weighted_shares": math.Round(totalWeighted*10000) / 10000,
		"dividend_per_share":    setting.DividendPerShare,
		"computed_gross":        math.Round(totalWeighted*setting.DividendPerShare*100) / 100,
		"stored_gross":          dividend.GrossDividend,
		// Side-by-side comparison data: stored snapshot vs current live value.
		"stored": gin.H{
			"weighted_shares": dividend.WeightedAvgShares,
			"gross":           dividend.GrossDividend,
			"tax":             dividend.TaxAmount,
			"net":             dividend.NetDividend,
		},
		"live": live,
	})
}

// CreateAllocationForDividendInvestment is the APPROVE-side counterpart to
// ReverseDividendReinvestForInvestment. When an Investment sourced from a
// dividend reinvestment gets approved, this helper materialises a new
// Allocation row so the shareholder formally owns the new shares. Without
// this, the Investment is approved but no Allocation exists — meaning the
// shareholder can't transfer those shares, can't have a certificate issued
// for them, and can't block them.
//
// Idempotent / safe for non-reinvest investments:
//   - If AllocationID is already set, no-op (regular cash investment paying
//     toward an existing allocation).
//   - If NumberOfShares <= 0, no-op (transfer_out rows, zero-share rows).
//   - If PaymentMethod != "dividend", no-op (only the dividend reinvest
//     flow needs an Allocation auto-created; regular cash/bank investments
//     enter the FIFO pool by design).
//
// On reject after approve: ReverseDividendReinvestForInvestment handles
// reversing the dividend ledger. To also remove the Allocation created here,
// admins should hard-delete the Allocation via the Allocations page — we
// don't auto-delete because once approved the Allocation may already have
// downstream artifacts (certificates, transfers, blocks).
func CreateAllocationForDividendInvestment(investmentID uint) error {
	var inv models.Investment
	if err := database.DB.First(&inv, investmentID).Error; err != nil {
		return err
	}
	if inv.AllocationID != nil {
		return nil
	}
	if inv.NumberOfShares <= 0 {
		return nil
	}
	if inv.PaymentMethod != "dividend" {
		return nil
	}

	now := time.Now()
	alloc := models.Allocation{
		ShareholderID:   inv.ShareholderID,
		AllocationNo:    fmt.Sprintf("DIV-REINV-%d", inv.ID),
		Round:           0,
		AllocatedShares: inv.NumberOfShares,
		AllocatedAmount: inv.Amount,
		AllocationDate:  &now,
		Status:          "allocated",
		ApprovalStatus:  "approved",
	}
	if err := database.DB.Create(&alloc).Error; err != nil {
		return err
	}

	// Link back. Use a direct Update to keep the change minimal (avoid
	// touching other Investment fields like updated_at unnecessarily).
	if err := database.DB.Model(&models.Investment{}).
		Where("id = ?", inv.ID).
		Update("allocation_id", alloc.ID).Error; err != nil {
		return err
	}

	// Log a dividend-side history entry so the timeline shows the
	// materialised allocation alongside the original reinvest action.
	var act models.DividendAction
	if err := database.DB.Where("investment_id = ? AND action_type = ?", inv.ID, "reinvest").First(&act).Error; err == nil {
		invIDCopy := inv.ID
		logDividendAction(database.DB, models.DividendAction{
			DividendID:    act.DividendID,
			ActionType:    "reinvest_approved",
			Amount:        inv.Amount,
			Description:   fmt.Sprintf("Investment #%d approved — Allocation %s created for %d shares.", inv.ID, alloc.AllocationNo, inv.NumberOfShares),
			InvestmentID:  &invIDCopy,
			Remark:        "Allocation auto-created on approval",
			ActedByUserID: 0,
		})
	}
	return nil
}

// ReverseDividendReinvestForInvestment is called when an Investment that was
// sourced from a dividend reinvestment gets rejected. It compensates the
// dividend by subtracting the previously-applied reinvested amount,
// recomputing tax/net/uncollected, resetting the dividend's status if it had
// been marked "settled", and logging a "reinvest_rejected" action so the
// admin can see in the dividend's history that the underlying investment
// was undone — and re-Subscribe if they want to retry.
//
// Idempotent: if no matching reinvest DividendAction exists for the given
// investment ID, it's a no-op (the investment wasn't dividend-sourced).
//
// userID identifies who triggered the reject (for the audit row).
func ReverseDividendReinvestForInvestment(investmentID uint, userID uint) {
	var actions []models.DividendAction
	if err := database.DB.Where("investment_id = ? AND action_type = ?", investmentID, "reinvest").
		Find(&actions).Error; err != nil || len(actions) == 0 {
		return // not a dividend-sourced investment, nothing to reverse
	}

	for _, act := range actions {
		var dividend models.Dividend
		if err := database.DB.First(&dividend, act.DividendID).Error; err != nil {
			continue
		}

		// Reverse the dividend ledger.
		oldTax := dividend.TaxAmount
		newReinvested := dividend.ReinvestedAmount - act.Amount
		if newReinvested < 0 {
			newReinvested = 0
		}
		newTaxableGross := dividend.GrossDividend - newReinvested
		if newTaxableGross < 0 {
			newTaxableGross = 0
		}
		var taxSchedules []models.DividendTaxSchedule
		database.DB.Order("min_amount ASC").Find(&taxSchedules)
		newTax := calculateDividendTax(newTaxableGross, taxSchedules)
		newNet := newTaxableGross - newTax
		newUncollected := newNet - dividend.CollectedAmount
		if newUncollected < 0 {
			newUncollected = 0
		}

		dividend.ReinvestedAmount = math.Round(newReinvested*100) / 100
		dividend.TaxAmount = math.Round(newTax*100) / 100
		dividend.NetDividend = math.Round(newNet*100) / 100
		dividend.UncollectedAmount = math.Round(newUncollected*100) / 100
		// If the dividend had been marked "settled" because everything was
		// reinvested or collected, but now uncollected > 0 because of the
		// reversal, flip it back to "pending" / "partial" so the admin can act on it.
		if dividend.UncollectedAmount > 0 {
			if dividend.CollectedAmount > 0 {
				dividend.Status = "partial"
			} else {
				dividend.Status = "pending"
			}
		}
		database.DB.Save(&dividend)

		invIDCopy := investmentID
		logDividendAction(database.DB, models.DividendAction{
			DividendID:    dividend.ID,
			ActionType:    "reinvest_rejected",
			Amount:        -act.Amount, // negative to show the reversal
			TaxImpact:     dividend.TaxAmount - oldTax,
			Description:   fmt.Sprintf("Reinvestment of ETB %.2f reversed — Investment #%d was rejected by Authorization. Dividend is collectible again.", act.Amount, investmentID),
			InvestmentID:  &invIDCopy,
			Remark:        "auto-reversal on investment reject",
			ActedByUserID: userID,
		})
	}
}

// GetDividendHistory returns every action that was taken on this dividend.
func GetDividendHistory(c *gin.Context) {
	id := c.Param("id")
	var actions []models.DividendAction
	database.DB.Where("dividend_id = ?", id).Order("acted_at ASC, id ASC").Find(&actions)
	c.JSON(http.StatusOK, gin.H{"data": actions})
}
