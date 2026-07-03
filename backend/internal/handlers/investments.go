package handlers

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

// subscriptionExpiryGate rejects new payments against an allocation whose
// subscription expiry date has passed (EAT date-only; the expiry day itself
// still accepts payments). Extending the subscription lifts the gate. Shared
// by direct investments (validateInvestmentCap) and dividend reinvestment.
func subscriptionExpiryGate(alloc *models.Allocation) error {
	if alloc.SubscriptionID == nil {
		return nil
	}
	var sub models.Subscription
	if err := database.DB.First(&sub, *alloc.SubscriptionID).Error; err != nil {
		return nil // subscription gone (e.g. legacy) — nothing to gate on
	}
	if sub.ExpiryDate != nil && truncToDay(time.Now()).After(truncToDay(*sub.ExpiryDate)) {
		return fmt.Errorf(
			"Subscription %s expired on %s — extend it before recording new payments.",
			sub.SubscriptionNo, truncToDay(*sub.ExpiryDate).Format("2006-01-02"))
	}
	return nil
}

// validateInvestmentCap checks that the proposed investment doesn't push
// total commitments (paid + pending) above the allocation cap.
//
// Three branches:
//   - transfer_in / transfer_out: ownership moves, not money — always allow.
//   - allocation_id given: cap = that single allocation's allocated amount
//     minus everything already pending/approved against it.
//   - allocation_id null: cap = total approved allocations for this
//     shareholder minus everything already pending/approved across the
//     shareholder. (Investments without allocation_id feed the FIFO
//     unlinked pool.) If the shareholder has no approved allocations
//     yet, the check is skipped — early payments before allocation are
//     legitimate.
//
// Returns (nil, nil) when the payment is within cap. On violation,
// returns a user-facing error message + a structured details map for
// the response body. excludeInvestmentID is non-zero when updating an
// existing investment, so the row being updated isn't double-counted.
func validateInvestmentCap(inv *models.Investment, excludeInvestmentID uint) (error, gin.H) {
	if inv.PaymentMethod == "transfer_in" || inv.PaymentMethod == "transfer_out" {
		return nil, nil
	}

	// Per-allocation cap (strict). The cap correctly accounts for:
	//   (1) direct approved investments linked via allocation_id
	//   (2) approved unlinked investments that FIFO-allocate to THIS allocation
	//       (same logic the UI's summary endpoint uses, so cap matches what
	//       the operator sees as paid_shares / remaining_amount)
	//   (3) any pending direct investments against this allocation
	// Sum = effective approved (FIFO) + pending direct. Anything proposed
	// beyond (AllocatedShares − sum) is rejected.
	if inv.AllocationID != nil && *inv.AllocationID > 0 {
		var alloc models.Allocation
		if err := database.DB.First(&alloc, *inv.AllocationID).Error; err != nil {
			return fmt.Errorf("Allocation not found"), nil
		}
		if alloc.ShareholderID != inv.ShareholderID {
			return fmt.Errorf("Allocation does not belong to this shareholder"), nil
		}

		// Expiry gate: no new payments against a subscription whose expiry
		// date has passed — the operator must Extend it first.
		if err := subscriptionExpiryGate(&alloc); err != nil {
			return err, gin.H{"expired": true}
		}

		// (1)+(2): effective FIFO-aware approved paid shares.
		effPaidShares := computeAllocPaidShares(inv.ShareholderID, alloc.ID)
		var effPaidAmount float64
		if alloc.AllocatedShares > 0 {
			effPaidAmount = float64(effPaidShares) / float64(alloc.AllocatedShares) * alloc.AllocatedAmount
		}
		// Defensive: never undercount direct approved amount because of integer
		// share rounding in (effPaidShares / AllocatedShares) * AllocatedAmount.
		var directApprovedAmount float64
		database.DB.Model(&models.Investment{}).
			Where("allocation_id = ? AND status = 'active' AND approval_status = 'approved' AND payment_method NOT IN ('transfer_in','transfer_out')", alloc.ID).
			Select("COALESCE(SUM(amount), 0)").Scan(&directApprovedAmount)
		if directApprovedAmount > effPaidAmount {
			effPaidAmount = directApprovedAmount
		}

		// (3): pending direct against this allocation (in-flight commitments).
		pendQ := database.DB.Model(&models.Investment{}).
			Where("allocation_id = ? AND status = 'active' AND approval_status = 'pending' AND payment_method NOT IN ('transfer_in','transfer_out')", alloc.ID)
		if excludeInvestmentID > 0 {
			pendQ = pendQ.Where("id != ?", excludeInvestmentID)
		}
		var pendingShares int64
		var pendingAmount float64
		pendQ.Select("COALESCE(SUM(number_of_shares), 0)").Scan(&pendingShares)
		pendQ.Select("COALESCE(SUM(amount), 0)").Scan(&pendingAmount)

		committedShares := effPaidShares + pendingShares
		committedAmount := effPaidAmount + pendingAmount
		maxShares := alloc.AllocatedShares - committedShares
		maxAmount := alloc.AllocatedAmount - committedAmount
		if maxShares < 0 {
			maxShares = 0
		}
		if maxAmount < 0 {
			maxAmount = 0
		}

		if inv.Amount > maxAmount+0.01 {
			return fmt.Errorf(
				"Amount exceeds allocation cap. Allocation %s: allocated %.2f ETB, already committed %.2f ETB (approved+pending), maximum new payment %.2f ETB.",
				alloc.AllocationNo, alloc.AllocatedAmount, committedAmount, maxAmount,
			), gin.H{
				"allocation_no":     alloc.AllocationNo,
				"allocated_amount":  alloc.AllocatedAmount,
				"already_committed": committedAmount,
				"max_amount":        maxAmount,
				"attempted":         inv.Amount,
			}
		}
		if inv.NumberOfShares > maxShares {
			return fmt.Errorf(
				"Shares exceed allocation cap. Allocation %s: allocated %d shares, already committed %d (approved+pending), maximum new shares %d.",
				alloc.AllocationNo, alloc.AllocatedShares, committedShares, maxShares,
			), gin.H{
				"allocation_no":     alloc.AllocationNo,
				"allocated_shares":  alloc.AllocatedShares,
				"already_committed": committedShares,
				"max_shares":        maxShares,
				"attempted":         inv.NumberOfShares,
			}
		}
		return nil, nil
	}

	// Unlinked payment — cap against shareholder's total approved allocations,
	// validating BOTH amount and shares so a manual share-count override
	// can't sneak past the amount check.
	var totalAllocated float64
	var totalAllocatedShares int64
	database.DB.Model(&models.Allocation{}).
		Where("shareholder_id = ? AND approval_status = 'approved'", inv.ShareholderID).
		Select("COALESCE(SUM(allocated_amount), 0)").Scan(&totalAllocated)
	database.DB.Model(&models.Allocation{}).
		Where("shareholder_id = ? AND approval_status = 'approved'", inv.ShareholderID).
		Select("COALESCE(SUM(allocated_shares), 0)").Scan(&totalAllocatedShares)
	if totalAllocated <= 0 {
		// ZERO subscription/allocation capacity → no investment. This used to
		// be skipped ("early payments before allocation are legitimate"),
		// which let a shareholder with no — or a fully reversed — subscription
		// record any amount. The business rule is now: money in requires
		// allocation capacity to apply it to.
		return fmt.Errorf(
			"This shareholder has no approved allocation to invest against. Create and approve a subscription/allocation first.",
		), gin.H{"total_allocated": 0, "attempted": inv.Amount, "zero_subscription": true}
	}

	q := database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = 'active' AND approval_status IN ('pending','approved') AND payment_method NOT IN ('transfer_in','transfer_out')",
			inv.ShareholderID)
	if excludeInvestmentID > 0 {
		q = q.Where("id != ?", excludeInvestmentID)
	}
	var totalCommitted float64
	var totalCommittedShares int64
	q.Select("COALESCE(SUM(amount), 0)").Scan(&totalCommitted)
	q.Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalCommittedShares)

	maxAmount := totalAllocated - totalCommitted
	maxShares := totalAllocatedShares - totalCommittedShares
	if maxAmount < 0 {
		maxAmount = 0
	}
	if maxShares < 0 {
		maxShares = 0
	}
	if inv.Amount > maxAmount+0.01 {
		return fmt.Errorf(
			"Amount exceeds the shareholder's total allocation cap. Total allocated %.2f ETB, already committed %.2f ETB (approved+pending), maximum new payment %.2f ETB. Tip: pick a specific allocation from the dropdown for a tighter cap.",
			totalAllocated, totalCommitted, maxAmount,
		), gin.H{
			"total_allocated":   totalAllocated,
			"already_committed": totalCommitted,
			"max_amount":        maxAmount,
			"attempted":         inv.Amount,
		}
	}
	if inv.NumberOfShares > maxShares {
		return fmt.Errorf(
			"Shares exceed the shareholder's total allocation cap. Total allocated %d shares, already committed %d, maximum new shares %d. Tip: pick a specific allocation from the dropdown for a tighter cap.",
			totalAllocatedShares, totalCommittedShares, maxShares,
		), gin.H{
			"total_allocated_shares": totalAllocatedShares,
			"already_committed":      totalCommittedShares,
			"max_shares":             maxShares,
			"attempted":              inv.NumberOfShares,
		}
	}
	return nil, nil
}

// computeAllocPaidShares returns the effective paid shares for one allocation,
// applying the same FIFO unlinked-pool logic used in GetShareholderInvestmentSummary.
// This is the authoritative calculation — use it anywhere paid-share counts are needed for validation.
func computeAllocPaidShares(shareholderID uint, allocID uint) int64 {
	// Unlinked pool: cash/bank payments with no allocation_id.
	// transfer_in/transfer_out are excluded — they are allocation-specific ownership movements.
	var unlinkedPool float64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = 'active' AND approval_status = 'approved' AND allocation_id IS NULL AND payment_method NOT IN ('transfer_in','transfer_out')", shareholderID).
		Select("COALESCE(SUM(amount), 0)").Scan(&unlinkedPool)

	// Walk allocations in FIFO order (oldest first), drain the pool allocation by allocation
	var allocations []models.Allocation
	database.DB.Where("shareholder_id = ?", shareholderID).Order("id ASC").Find(&allocations)

	for _, a := range allocations {
		var explicitPaid float64
		database.DB.Model(&models.Investment{}).
			Where("allocation_id = ? AND status = 'active' AND approval_status = 'approved'", a.ID).
			Select("COALESCE(SUM(amount), 0)").Scan(&explicitPaid)

		remaining := a.AllocatedAmount - explicitPaid
		var unlinkedApplied float64
		if unlinkedPool > 0 && remaining > 0 {
			if unlinkedPool >= remaining {
				unlinkedApplied = remaining
			} else {
				unlinkedApplied = unlinkedPool
			}
			unlinkedPool -= unlinkedApplied
		}

		paid := explicitPaid + unlinkedApplied
		paidShares := int64(0)
		if a.AllocatedAmount > 0 && paid > 0 {
			paidShares = int64(paid / a.AllocatedAmount * float64(a.AllocatedShares))
		}

		if a.ID == allocID {
			return paidShares
		}
	}
	return 0
}

// allocationAcquisitionDate returns the date on/after which the source
// allocation's shares may start earning dividend for the holder — i.e. the
// floor for any transfer's AgreedDividendDate drawn from this allocation.
//
// It is the LATER of:
//   - the allocation's AllocationDate (for a transfer-received allocation
//     this is the incoming transfer's agreed date), and
//   - the earliest payment_date among the allocation's positive-share
//     approved investments (original purchase / transfer_in / reinvest).
//
// Returns nil only when neither is known. Backdating a transfer's
// dividend-from date before this would credit the new owner (and debit the
// old) for days the shares didn't yet belong to the source allocation —
// the exact mismatch that produced negative cohort rows.
func allocationAcquisitionDate(alloc models.Allocation) *time.Time {
	var earliest *time.Time
	database.DB.Model(&models.Investment{}).
		Where("allocation_id = ? AND status = 'active' AND approval_status = 'approved' AND number_of_shares > 0", alloc.ID).
		Select("MIN(payment_date)").Scan(&earliest)

	acq := alloc.AllocationDate
	if earliest != nil && (acq == nil || earliest.After(*acq)) {
		acq = earliest
	}
	return acq
}

func GetInvestments(c *gin.Context) {
	shareholderID := c.Query("shareholder_id")
	approvalStatus := c.Query("approval_status")
	method := c.Query("payment_method")
	search := c.Query("search")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	// Resolve search to shareholder IDs once
	var searchShIDs []uint
	var searchLike string
	if search != "" {
		searchLike = "%" + search + "%"
		database.DB.Model(&models.Shareholder{}).
			Where("first_name LIKE ? OR last_name LIKE ? OR account_no LIKE ?", searchLike, searchLike, searchLike).
			Pluck("id", &searchShIDs)
	}

	countQ := database.DB.Model(&models.Investment{})
	if shareholderID != "" {
		countQ = countQ.Where("shareholder_id = ?", shareholderID)
	}
	if approvalStatus != "" {
		countQ = countQ.Where("approval_status = ?", approvalStatus)
	}
	if method != "" {
		countQ = countQ.Where("payment_method = ?", method)
	}
	if search != "" {
		if len(searchShIDs) > 0 {
			countQ = countQ.Where("shareholder_id IN ?", searchShIDs)
		} else {
			countQ = countQ.Where("1 = 0")
		}
	}
	var total int64
	countQ.Count(&total)

	findQ := database.DB.Model(&models.Investment{})
	if shareholderID != "" {
		findQ = findQ.Where("shareholder_id = ?", shareholderID)
	}
	if approvalStatus != "" {
		findQ = findQ.Where("approval_status = ?", approvalStatus)
	}
	if method != "" {
		findQ = findQ.Where("payment_method = ?", method)
	}
	if search != "" {
		if len(searchShIDs) > 0 {
			findQ = findQ.Where("shareholder_id IN ?", searchShIDs)
		} else {
			findQ = findQ.Where("1 = 0")
		}
	}
	var investments []models.Investment
	offset := (page - 1) * pageSize
	findQ.Preload("Shareholder").Offset(offset).Limit(pageSize).Order("id DESC").Find(&investments)

	c.JSON(http.StatusOK, gin.H{"data": investments, "total": total, "page": page, "page_size": pageSize})
}

func GetInvestment(c *gin.Context) {
	id := c.Param("id")
	var inv models.Investment
	if err := database.DB.Preload("Shareholder").First(&inv, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Investment not found"})
		return
	}

	// For dividend-funded investments, attach the funding split so the
	// authorizer sees exactly where the money came from — not just the total.
	// The reinvest DividendAction records the dividend portion; the remainder
	// is the cash/bank top-up.
	type dividendFunding struct {
		DividendID       uint    `json:"dividend_id"`
		FiscalYear       string  `json:"fiscal_year"`
		GrossDividend    float64 `json:"gross_dividend"`
		ReinvestAmount   float64 `json:"reinvest_amount"`
		AdditionalAmount float64 `json:"additional_amount"`
		AdditionalMethod string  `json:"additional_method"`
		Description      string  `json:"description"`
	}
	resp := struct {
		models.Investment
		DividendFunding *dividendFunding `json:"dividend_funding,omitempty"`
	}{Investment: inv}

	var action models.DividendAction
	if err := database.DB.Where("investment_id = ? AND action_type = ?", inv.ID, "reinvest").
		First(&action).Error; err == nil {
		f := dividendFunding{
			DividendID:       action.DividendID,
			ReinvestAmount:   action.Amount,
			AdditionalMethod: action.PaymentMethod,
			Description:      action.Description,
		}
		f.AdditionalAmount = inv.Amount - action.Amount
		if f.AdditionalAmount < 0 {
			f.AdditionalAmount = 0
		}
		var div models.Dividend
		if err := database.DB.First(&div, action.DividendID).Error; err == nil {
			f.FiscalYear = div.FiscalYear
			f.GrossDividend = div.GrossDividend
		}
		resp.DividendFunding = &f
	}

	c.JSON(http.StatusOK, resp)
}

// validateWholeShareAmount enforces that a normal (non-dividend) investment buys
// a WHOLE number of shares: the amount must be a positive exact multiple of the
// company par value — at least one par (no 600 at par 1,000) and evenly
// divisible (no fraction like 1,500 = 1.5 shares at par 1,000). The
// dividend-reinvest path snaps to whole shares on its own endpoint, so it is
// exempt here.
func validateWholeShareAmount(inv *models.Investment) error {
	if inv.PaymentMethod == "dividend" {
		return nil
	}
	// Prefer the authoritative company par from settings; fall back to the
	// par carried on the investment if settings aren't available.
	par := inv.ParValue
	var bc models.BankCapital
	if err := database.DB.First(&bc).Error; err == nil && bc.ParValuePerShare > 0 {
		par = bc.ParValuePerShare
	}
	if par <= 0 {
		return nil // can't validate share-evenness without a par value
	}
	if inv.Amount < par {
		return fmt.Errorf("amount %.2f is below one share's par value (%.2f) — an investment must cover at least one whole share", inv.Amount, par)
	}
	shares := inv.Amount / par
	if math.Abs(shares-math.Round(shares)) > 1e-6 {
		return fmt.Errorf("amount %.2f is not a whole number of shares — it must be an exact multiple of the par value (%.2f); %.2f buys %.2f shares", inv.Amount, par, inv.Amount, shares)
	}
	if inv.NumberOfShares < 1 {
		return fmt.Errorf("investment must be for at least one whole share")
	}
	return nil
}

func CreateInvestment(c *gin.Context) {
	var inv models.Investment
	if err := c.ShouldBindJSON(&inv); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Payment date is the dividend-eligibility clock for this holding: the
	// share earns from the payment day itself, inclusive (today = 1,
	// tomorrow = 2 — see wholeDaysHeld). It must be known, otherwise the
	// weighted-average day count is undefined — reject rather than silently
	// assume a full year.
	if inv.PaymentDate == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payment_date is required"})
		return
	}

	// Check for double payment (same shareholder, same date, same amount).
	// Only ACTIVE rows count — after a subscription reversal the shareholder
	// may legitimately re-pay the same amount on the same date.
	var exists int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND amount = ? AND DATE(payment_date) = DATE(?) AND status = 'active'",
			inv.ShareholderID, inv.Amount, inv.PaymentDate).
		Count(&exists)
	if exists > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Duplicate payment detected"})
		return
	}

	// Calculate shares from amount if not provided
	if inv.NumberOfShares == 0 && inv.ParValue > 0 {
		inv.NumberOfShares = int64(inv.Amount / inv.ParValue)
	}

	// Must buy a whole number of shares (amount = exact multiple of par).
	if err := validateWholeShareAmount(&inv); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Allocation cap validation — reject overpayment before creating the row.
	if err, details := validateInvestmentCap(&inv, 0); err != nil {
		resp := gin.H{"error": err.Error()}
		for k, v := range details {
			resp[k] = v
		}
		c.JSON(http.StatusBadRequest, resp)
		return
	}

	inv.ApprovalStatus = "pending"
	database.DB.Create(&inv)

	database.DB.Create(&models.PendingApproval{
		EntityType:  "investment",
		EntityID:    inv.ID,
		Action:      "create",
		RequestedBy: getUserID(c),
		Status:      "pending",
		RequestedAt: time.Now(),
	})

	c.JSON(http.StatusCreated, gin.H{"message": "Investment recorded", "id": inv.ID})
}

func UpdateInvestment(c *gin.Context) {
	id := c.Param("id")
	var inv models.Investment
	if err := database.DB.First(&inv, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Investment not found"})
		return
	}
	if err := c.ShouldBindJSON(&inv); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Must still buy a whole number of shares after the edit.
	if err := validateWholeShareAmount(&inv); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Allocation cap validation — exclude this row from the existing sum
	// so editing fields other than amount doesn't trip the cap.
	if err, details := validateInvestmentCap(&inv, inv.ID); err != nil {
		resp := gin.H{"error": err.Error()}
		for k, v := range details {
			resp[k] = v
		}
		c.JSON(http.StatusBadRequest, resp)
		return
	}
	database.DB.Save(&inv)
	c.JSON(http.StatusOK, gin.H{"message": "Investment updated"})
}

func GetShareholderInvestmentSummary(c *gin.Context) {
	shareholderID := c.Param("id")

	// Total paid across all approved investments only
	var totalPaid float64
	var totalSharesPaid int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = 'active' AND approval_status = 'approved'", shareholderID).
		Select("COALESCE(SUM(amount), 0)").Scan(&totalPaid)
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = 'active' AND approval_status = 'approved'", shareholderID).
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalSharesPaid)

	// Total subscribed (approved only)
	var totalSubscribed float64
	var totalSubscribedShares int64
	database.DB.Model(&models.Subscription{}).
		Where("shareholder_id = ? AND status IN ? AND approval_status = ?", shareholderID, []string{"active", "extended"}, "approved").
		Select("COALESCE(SUM(share_amount), 0)").Scan(&totalSubscribed)
	database.DB.Model(&models.Subscription{}).
		Where("shareholder_id = ? AND status IN ? AND approval_status = ?", shareholderID, []string{"active", "extended"}, "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalSubscribedShares)

	// Allocations fetched oldest-first for FIFO payment distribution
	var allocations []models.Allocation
	database.DB.Where("shareholder_id = ?", shareholderID).
		Preload("Subscription").
		Order("id ASC").Find(&allocations)

	type AllocDetail struct {
		ID                  uint       `json:"id"`
		AllocationNo        string     `json:"allocation_no"`
		Round               int        `json:"round"`
		AllocatedShares     int64      `json:"allocated_shares"`
		AllocatedAmount     float64    `json:"allocated_amount"`
		AllocationDate      *time.Time `json:"allocation_date"`
		AcquisitionDate     *time.Time `json:"acquisition_date"` // dividend-from floor for transfers from this allocation
		Status              string     `json:"status"`
		ApprovalStatus      string     `json:"approval_status"`
		SubscriptionType    string     `json:"subscription_type"`
		SubscriptionExpiry  *time.Time `json:"subscription_expiry"` // payments blocked after this day (extend to lift)
		PaidAmount          float64    `json:"paid_amount"`
		PaidShares          int64      `json:"paid_shares"`
		// Pending direct investments waiting on approval. The form uses these
		// to subtract from the cap so double-pending the same allocation can't
		// sneak past the frontend validator.
		PendingShares       int64      `json:"pending_shares"`
		PendingAmount       float64    `json:"pending_amount"`
		RemainingAmount     float64    `json:"remaining_amount"`
		PaymentStatus       string     `json:"payment_status"`
		BlockedShares       int64      `json:"blocked_shares"`        // total (paid + unpaid)
		PaidBlockedShares   int64      `json:"paid_blocked_shares"`   // effective paid-locked
		UnpaidBlockedShares int64      `json:"unpaid_blocked_shares"` // effective unpaid-locked
	}

	// Unlinked payments pool: cash/bank payments with no allocation_id recorded before the
	// allocation selector was added. Transfers (transfer_in / transfer_out) are EXCLUDED —
	// they represent ownership movements tied to a specific allocation and must never be
	// FIFO-redistributed to arbitrary allocations.
	var unlinkedPool float64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = 'active' AND approval_status = 'approved' AND allocation_id IS NULL AND payment_method NOT IN ('transfer_in','transfer_out')", shareholderID).
		Select("COALESCE(SUM(amount), 0)").Scan(&unlinkedPool)

	var totalAllocatedShares int64
	var totalAllocatedAmount float64
	allocDetails := make([]AllocDetail, 0, len(allocations))

	for _, a := range allocations {
		totalAllocatedShares += a.AllocatedShares
		totalAllocatedAmount += a.AllocatedAmount

		// Explicit approved payments linked to this allocation via allocation_id
		var explicitPaid float64
		database.DB.Model(&models.Investment{}).
			Where("allocation_id = ? AND status = 'active' AND approval_status = 'approved'", a.ID).
			Select("COALESCE(SUM(amount), 0)").Scan(&explicitPaid)

		// Apply unlinked payments FIFO to fill remaining balance
		remaining := a.AllocatedAmount - explicitPaid
		var unlinkedApplied float64
		if unlinkedPool > 0 && remaining > 0 {
			if unlinkedPool >= remaining {
				unlinkedApplied = remaining
			} else {
				unlinkedApplied = unlinkedPool
			}
			unlinkedPool -= unlinkedApplied
		}

		paid := explicitPaid + unlinkedApplied
		// Derive paid shares proportionally from paid amount
		paidShares := int64(0)
		if a.AllocatedAmount > 0 && paid > 0 {
			paidShares = int64(paid / a.AllocatedAmount * float64(a.AllocatedShares))
		}
		remainingAmt := a.AllocatedAmount - paid
		if remainingAmt < 0 {
			remainingAmt = 0
		}
		ps := "not_started"
		if paid >= a.AllocatedAmount && a.AllocatedAmount > 0 {
			ps = "fully_paid"
		} else if paid > 0 {
			ps = "partially_paid"
		}

		subType := ""
		var subExpiry *time.Time
		if a.Subscription.ID > 0 {
			subType = a.Subscription.Type
			subExpiry = a.Subscription.ExpiryDate
		}

		// Block counts broken down by type so the transfer form can show precise available shares.
		// BlockedShares uses direct SUM(block_shares) for backward-compat with legacy blocks
		// that were created before PaidSharesToBlock/UnpaidSharesToBlock fields existed.
		paidBlockedOnAlloc := getEffectivePaidBlocked(a.ID)
		unpaidBlockedOnAlloc := getEffectiveUnpaidBlocked(a.ID)
		var totalBlockedOnAlloc int64
		database.DB.Model(&models.ShareBlock{}).
			Where("allocation_id = ? AND is_released = ?", a.ID, false).
			Select("COALESCE(SUM(block_shares), 0)").Scan(&totalBlockedOnAlloc)

		// Pending direct investments against this allocation (not yet
		// approved, but committed). Frontend subtracts these from the cap
		// so double-pending the same allocation can't slip through.
		var pendingSharesOnAlloc int64
		var pendingAmountOnAlloc float64
		database.DB.Model(&models.Investment{}).
			Where("allocation_id = ? AND status = 'active' AND approval_status = 'pending' AND payment_method NOT IN ('transfer_in','transfer_out')", a.ID).
			Select("COALESCE(SUM(number_of_shares), 0)").Scan(&pendingSharesOnAlloc)
		database.DB.Model(&models.Investment{}).
			Where("allocation_id = ? AND status = 'active' AND approval_status = 'pending' AND payment_method NOT IN ('transfer_in','transfer_out')", a.ID).
			Select("COALESCE(SUM(amount), 0)").Scan(&pendingAmountOnAlloc)

		allocDetails = append(allocDetails, AllocDetail{
			ID:                  a.ID,
			AllocationNo:        a.AllocationNo,
			Round:               a.Round,
			AllocatedShares:     a.AllocatedShares,
			AllocatedAmount:     a.AllocatedAmount,
			AllocationDate:      a.AllocationDate,
			AcquisitionDate:     allocationAcquisitionDate(a),
			Status:              a.Status,
			ApprovalStatus:      a.ApprovalStatus,
			SubscriptionType:    subType,
			SubscriptionExpiry:  subExpiry,
			PaidAmount:          paid,
			PaidShares:          paidShares,
			PendingShares:       pendingSharesOnAlloc,
			PendingAmount:       pendingAmountOnAlloc,
			RemainingAmount:     remainingAmt,
			PaymentStatus:       ps,
			BlockedShares:       totalBlockedOnAlloc,
			PaidBlockedShares:   paidBlockedOnAlloc,
			UnpaidBlockedShares: unpaidBlockedOnAlloc,
		})
	}

	// Reverse for display: newest allocation first
	for i, j := 0, len(allocDetails)-1; i < j; i, j = i+1, j-1 {
		allocDetails[i], allocDetails[j] = allocDetails[j], allocDetails[i]
	}

	// Overall payment status — based on allocated amount, not subscription.
	// Subscription amount stays fixed even after transfers; allocation reflects actual current shares.
	paymentStatus := "not_started"
	if totalAllocatedAmount > 0 && totalPaid >= totalAllocatedAmount {
		paymentStatus = "fully_paid"
	} else if totalPaid > 0 {
		paymentStatus = "partially_paid"
	}

	// Total blocked shares across all allocations
	var totalBlockedShares int64
	database.DB.Model(&models.ShareBlock{}).
		Where("shareholder_id = ? AND is_released = ?", shareholderID, false).
		Select("COALESCE(SUM(block_shares), 0)").Scan(&totalBlockedShares)

	// Recent approved payments
	var investments []models.Investment
	database.DB.Where("shareholder_id = ? AND status = 'active' AND approval_status = 'approved'", shareholderID).
		Order("payment_date DESC").Limit(10).Find(&investments)

	c.JSON(http.StatusOK, gin.H{
		"total_paid":              totalPaid,
		"total_shares_paid":       totalSharesPaid,
		"total_subscribed":        totalSubscribed,
		"total_subscribed_shares": totalSubscribedShares,
		"total_allocated_shares":  totalAllocatedShares,
		"total_allocated_amount":  totalAllocatedAmount,
		"outstanding_balance":     totalAllocatedAmount - totalPaid,
		"payment_status":          paymentStatus,
		"blocked_shares":          totalBlockedShares,
		"allocations":             allocDetails,
		"payments":                investments,
	})
}
