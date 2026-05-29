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
	"gorm.io/gorm"
)

// Dividend Settings
func GetDividendSettings(c *gin.Context) {
	var settings []models.DividendSetting
	database.DB.Order("fiscal_year DESC").Find(&settings)
	c.JSON(http.StatusOK, gin.H{"data": settings})
}

// periodOf returns the effective inclusive [start, end] of a dividend
// setting. If the setting has no explicit start date (legacy rows), the
// start is derived from (ReferenceDate − DaysInYear + 1) so an overlap
// check works against either schema. Returns ok=false when there is no
// reference_date at all (can't reason about a period without it).
func periodOf(s *models.DividendSetting) (start, end time.Time, ok bool) {
	if s.ReferenceDate == nil {
		return time.Time{}, time.Time{}, false
	}
	end = *s.ReferenceDate
	if s.ReferenceStartDate != nil {
		start = *s.ReferenceStartDate
	} else {
		days := s.DaysInYear
		if days <= 0 {
			days = 365
		}
		start = end.AddDate(0, 0, -(days - 1))
	}
	return start, end, true
}

// validateDividendSettingOverlap rejects a setting whose [start, end] period
// overlaps with another fiscal year. Two periods overlap when
// max(start1, start2) ≤ min(end1, end2). excludeID skips the row being updated.
func validateDividendSettingOverlap(s *models.DividendSetting, excludeID uint) error {
	start, end, ok := periodOf(s)
	if !ok {
		return nil // no reference_date → can't check
	}
	if !start.Before(end) && !start.Equal(end) {
		return fmt.Errorf("reference_start_date (%s) must be on or before reference_date (%s)",
			start.Format("2006-01-02"), end.Format("2006-01-02"))
	}
	var others []models.DividendSetting
	q := database.DB.Where("reference_date IS NOT NULL")
	if excludeID > 0 {
		q = q.Where("id != ?", excludeID)
	}
	q.Find(&others)
	for _, o := range others {
		oStart, oEnd, ook := periodOf(&o)
		if !ook {
			continue
		}
		latestStart := start
		if oStart.After(latestStart) {
			latestStart = oStart
		}
		earliestEnd := end
		if oEnd.Before(earliestEnd) {
			earliestEnd = oEnd
		}
		if !latestStart.After(earliestEnd) {
			return fmt.Errorf(
				"Period [%s → %s] overlaps with existing fiscal year '%s' [%s → %s]. Pick a non-overlapping period (e.g. start the day after the previous one ended).",
				start.Format("2006-01-02"), end.Format("2006-01-02"),
				o.FiscalYear,
				oStart.Format("2006-01-02"), oEnd.Format("2006-01-02"),
			)
		}
	}
	return nil
}

func CreateDividendSetting(c *gin.Context) {
	var setting models.DividendSetting
	if err := c.ShouldBindJSON(&setting); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if setting.FiscalYear == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fiscal_year is required"})
		return
	}
	if setting.ReferenceDate == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reference_date is required"})
		return
	}

	// Fiscal-year name uniqueness (clearer than relying on the DB constraint).
	var nameConflict int64
	database.DB.Model(&models.DividendSetting{}).
		Where("fiscal_year = ?", setting.FiscalYear).Count(&nameConflict)
	if nameConflict > 0 {
		c.JSON(http.StatusConflict, gin.H{
			"error": fmt.Sprintf("Fiscal year '%s' already exists. Use a different label.", setting.FiscalYear),
		})
		return
	}

	// Auto-compute days from the period if start is set and days is 0.
	if setting.ReferenceStartDate != nil && setting.DaysInYear <= 0 {
		days := int(setting.ReferenceDate.Sub(*setting.ReferenceStartDate).Hours()/24) + 1
		if days <= 0 {
			days = 365
		}
		setting.DaysInYear = days
	}
	if setting.DaysInYear <= 0 {
		setting.DaysInYear = 365
	}

	// Period overlap check.
	if err := validateDividendSettingOverlap(&setting, 0); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	if err := database.DB.Create(&setting).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "Dividend setting created", "id": setting.ID, "data": setting})
}

func UpdateDividendSetting(c *gin.Context) {
	id := c.Param("id")
	var setting models.DividendSetting
	if err := database.DB.First(&setting, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Setting not found"})
		return
	}
	if err := c.ShouldBindJSON(&setting); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Same validations as create, scoped to "any OTHER row".
	if setting.FiscalYear == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fiscal_year is required"})
		return
	}
	var nameConflict int64
	database.DB.Model(&models.DividendSetting{}).
		Where("fiscal_year = ? AND id != ?", setting.FiscalYear, setting.ID).Count(&nameConflict)
	if nameConflict > 0 {
		c.JSON(http.StatusConflict, gin.H{
			"error": fmt.Sprintf("Fiscal year '%s' already exists.", setting.FiscalYear),
		})
		return
	}
	if setting.ReferenceStartDate != nil && setting.DaysInYear <= 0 && setting.ReferenceDate != nil {
		days := int(setting.ReferenceDate.Sub(*setting.ReferenceStartDate).Hours()/24) + 1
		if days <= 0 {
			days = 365
		}
		setting.DaysInYear = days
	}
	if err := validateDividendSettingOverlap(&setting, setting.ID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	database.DB.Save(&setting)
	c.JSON(http.StatusOK, gin.H{"message": "Dividend setting updated", "data": setting})
}

func ProcessDividend(c *gin.Context) {
	id := c.Param("id")
	var setting models.DividendSetting
	if err := database.DB.First(&setting, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Setting not found"})
		return
	}

	if setting.IsProcessed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dividend already processed"})
		return
	}

	// Get all active shareholders
	var shareholders []models.Shareholder
	database.DB.Where("status = ?", "active").Find(&shareholders)

	// Load dynamic share calculation formula
	shareFormula := "shares * days_held / days_in_year" // default: weighted average
	var formulaSetting models.SystemSetting
	if err := database.DB.Where("`key` = ?", "share_calc_formula").First(&formulaSetting).Error; err == nil {
		shareFormula = formulaSetting.Value
	}

	daysInYear := float64(setting.DaysInYear)
	if daysInYear == 0 {
		daysInYear = 365
	}

	// Load company-level data (once for all shareholders)
	companyVars := loadCompanyVars()

	// Calculate shares for each shareholder using dynamic formula
	var totalCalcShares float64
	type ShareholderWeight struct {
		ID             uint
		WeightedShares float64
	}
	var weights []ShareholderWeight

	for _, sh := range shareholders {
		shares := calculateSharesWithFormula(sh.ID, setting, shareFormula, daysInYear, companyVars)
		totalCalcShares += shares
		weights = append(weights, ShareholderWeight{ID: sh.ID, WeightedShares: shares})
	}

	// Calculate DPS
	dps := float64(0)
	if totalCalcShares > 0 {
		dps = setting.DeclaredAmount / totalCalcShares
	}
	setting.DividendPerShare = dps

	// Get tax schedules
	var taxSchedules []models.DividendTaxSchedule
	database.DB.Order("min_amount ASC").Find(&taxSchedules)

	// Generate dividends for each shareholder
	count := 0
	for _, w := range weights {
		if w.WeightedShares <= 0 {
			continue
		}

		grossDividend := w.WeightedShares * dps
		taxAmount := calculateDividendTax(grossDividend, taxSchedules)
		netDividend := grossDividend - taxAmount

		dividend := models.Dividend{
			ShareholderID:     w.ID,
			DividendSettingID: setting.ID,
			FiscalYear:        setting.FiscalYear,
			WeightedAvgShares: w.WeightedShares,
			GrossDividend:     math.Round(grossDividend*100) / 100,
			TaxAmount:         math.Round(taxAmount*100) / 100,
			NetDividend:       math.Round(netDividend*100) / 100,
			UncollectedAmount: math.Round(netDividend*100) / 100,
			Status:            "pending",
			ApprovalStatus:    "approved",
		}
		database.DB.Create(&dividend)
		count++
	}

	now := time.Now()
	setting.IsProcessed = true
	setting.ProcessedAt = &now
	setting.Status = "processed"
	database.DB.Save(&setting)

	c.JSON(http.StatusOK, gin.H{
		"message":               "Dividend processed",
		"shareholders_processed": count,
		"total_weighted_shares":  totalCalcShares,
		"dividend_per_share":     dps,
	})
}

// loadCompanyVars loads company-level data from BankCapital (called once per processing)
func loadCompanyVars() map[string]float64 {
	vars := map[string]float64{
		"paid_up_capital":      0,
		"authorized_capital":   0,
		"company_par_value":    1000,
		"total_company_shares": 0,
	}
	var bc models.BankCapital
	if err := database.DB.First(&bc).Error; err == nil {
		vars["paid_up_capital"] = bc.PaidUpCapital
		vars["authorized_capital"] = bc.AuthorizedCapital
		vars["company_par_value"] = bc.ParValuePerShare
		vars["total_company_shares"] = float64(bc.TotalShares)
	}
	return vars
}

// loadShareholderVars computes aggregate variables for a single shareholder
func loadShareholderVars(shareholderID uint, investments []models.Investment) map[string]float64 {
	totalShares := int64(0)
	totalPaid := float64(0)
	paidShares := int64(0)

	for _, inv := range investments {
		totalShares += inv.NumberOfShares
		totalPaid += inv.Amount
		// "paid_shares" = shares from investments that are fully paid (amount >= shares * par_value)
		if inv.NumberOfShares > 0 && inv.Amount > 0 {
			paidShares += inv.NumberOfShares
		}
	}

	// Query blocked shares
	var blockedShares int64
	database.DB.Model(&models.ShareBlock{}).
		Where("shareholder_id = ? AND is_released = ? AND status = ?", shareholderID, false, "active").
		Select("COALESCE(SUM(block_shares), 0)").Scan(&blockedShares)

	// Query subscribed but not yet paid shares
	var subscriptionShares int64
	database.DB.Model(&models.Subscription{}).
		Where("shareholder_id = ? AND status = ?", shareholderID, "active").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&subscriptionShares)

	return map[string]float64{
		"total_shares":        float64(totalShares),
		"total_paid":          totalPaid,
		"paid_shares":         float64(paidShares),
		"blocked_shares":      float64(blockedShares),
		"subscription_shares": float64(subscriptionShares),
		"free_shares":         float64(totalShares - blockedShares),
	}
}

// calculateSharesWithFormula evaluates the share calc formula per investment and sums results
func calculateSharesWithFormula(shareholderID uint, setting models.DividendSetting, formula string, daysInYear float64, companyVars map[string]float64) float64 {
	var investments []models.Investment
	database.DB.Where("shareholder_id = ? AND status = ?", shareholderID, "active").
		Order("payment_date ASC").Find(&investments)

	if len(investments) == 0 {
		return 0
	}

	// Load shareholder-level aggregates
	shVars := loadShareholderVars(shareholderID, investments)

	total := float64(0)
	for _, inv := range investments {
		// Calculate days_held
		daysHeld := daysInYear // default: full year if no dates
		if inv.PaymentDate != nil && setting.ReferenceDate != nil {
			daysHeld = setting.ReferenceDate.Sub(*inv.PaymentDate).Hours() / 24
			if daysHeld < 0 {
				continue // investment made after reference date, skip
			}
			if daysHeld > daysInYear {
				daysHeld = daysInYear
			}
		}

		parValue := float64(0)
		if inv.NumberOfShares > 0 {
			parValue = inv.Amount / float64(inv.NumberOfShares)
		}

		// Per-investment variables
		vars := map[string]float64{
			"shares":       float64(inv.NumberOfShares),
			"amount":       inv.Amount,
			"days_held":    daysHeld,
			"days_in_year": daysInYear,
			"par_value":    parValue,
			"premium":      inv.PremiumValue,
		}

		// Merge shareholder-level variables
		for k, v := range shVars {
			vars[k] = v
		}

		// Merge company-level variables
		for k, v := range companyVars {
			vars[k] = v
		}

		result, err := EvaluateFormula(formula, vars)
		if err != nil {
			// Fallback: weighted average
			result = float64(inv.NumberOfShares) * (daysHeld / daysInYear)
		}
		if result > 0 {
			total += result
		}
	}

	return total
}

func calculateDividendTax(amount float64, schedules []models.DividendTaxSchedule) float64 {
	// Load dynamic formula from system settings
	formula := "(amount * rate / 100) - deduction" // default fallback
	var setting models.SystemSetting
	if err := database.DB.Where("`key` = ?", "tax_formula").First(&setting).Error; err == nil {
		formula = setting.Value
	}

	for _, s := range schedules {
		if amount >= s.MinAmount && amount <= s.MaxAmount {
			vars := map[string]float64{
				"amount":    amount,
				"rate":      s.TaxRate,
				"deduction": s.Deduction,
				"min":       s.MinAmount,
				"max":       s.MaxAmount,
			}
			result, err := EvaluateFormula(formula, vars)
			if err != nil {
				// Fallback to hardcoded if formula fails
				return (amount * s.TaxRate / 100) - s.Deduction
			}
			if result < 0 {
				return 0
			}
			return result
		}
	}
	// Default: use last bracket for amounts above all ranges
	if len(schedules) > 0 {
		last := schedules[len(schedules)-1]
		vars := map[string]float64{
			"amount":    amount,
			"rate":      last.TaxRate,
			"deduction": last.Deduction,
			"min":       last.MinAmount,
			"max":       last.MaxAmount,
		}
		result, err := EvaluateFormula(formula, vars)
		if err != nil {
			return (amount * last.TaxRate / 100) - last.Deduction
		}
		if result < 0 {
			return 0
		}
		return result
	}
	return 0
}

// DeleteDividendSetting wipes a fiscal-year dividend run end-to-end so the
// admin can re-declare and re-process during testing or after a botched run:
// the DividendSetting row, every per-shareholder Dividend it produced, and
// every DividendAction in their history.
//
// Safety: the cascade refuses if real money has already moved against any of
// the dividends — specifically, if any of them have collected_amount > 0
// (cash paid out) or reinvested_amount > 0 (used to fund Investment rows).
// In those cases the admin should reverse the collections/reinvestments
// first, then retry the delete.
func DeleteDividendSetting(c *gin.Context) {
	id := c.Param("id")
	var setting models.DividendSetting
	if err := database.DB.First(&setting, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dividend setting not found"})
		return
	}

	var dividends []models.Dividend
	database.DB.Where("dividend_setting_id = ?", setting.ID).Find(&dividends)

	var totalCollected, totalReinvested float64
	var blockedCount, transferredCount int
	for _, d := range dividends {
		totalCollected += d.CollectedAmount
		totalReinvested += d.ReinvestedAmount
		if d.IsBlocked {
			blockedCount++
		}
		if d.IsTransferred {
			transferredCount++
		}
	}
	var blockers []string
	if totalCollected > 0 {
		blockers = append(blockers, fmt.Sprintf("ETB %.2f already collected as cash", totalCollected))
	}
	if totalReinvested > 0 {
		blockers = append(blockers, fmt.Sprintf("ETB %.2f reinvested into Investment rows", totalReinvested))
	}
	if blockedCount > 0 {
		blockers = append(blockers, fmt.Sprintf("%d dividends are blocked", blockedCount))
	}
	if transferredCount > 0 {
		blockers = append(blockers, fmt.Sprintf("%d dividends were transferred (inheritance / legal order)", transferredCount))
	}
	if len(blockers) > 0 {
		msg := "Cannot delete fiscal year " + setting.FiscalYear + " — "
		for i, b := range blockers {
			if i > 0 {
				msg += "; "
			}
			msg += b
		}
		msg += ". Reverse those actions first."
		c.JSON(http.StatusConflict, gin.H{"error": msg})
		return
	}

	dividendIDs := make([]uint, 0, len(dividends))
	for _, d := range dividends {
		dividendIDs = append(dividendIDs, d.ID)
	}

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if len(dividendIDs) > 0 {
			if err := tx.Where("dividend_id IN ?", dividendIDs).
				Delete(&models.DividendAction{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("dividend_setting_id = ?", setting.ID).
			Delete(&models.Dividend{}).Error; err != nil {
			return err
		}
		return tx.Delete(&setting).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":             fmt.Sprintf("Deleted fiscal year %s (and %d dividends)", setting.FiscalYear, len(dividends)),
		"deleted_setting_id":  setting.ID,
		"deleted_dividends":   len(dividends),
	})
}

// Dividend Payments
func GetDividends(c *gin.Context) {
	var dividends []models.Dividend
	query := database.DB.Preload("Shareholder").Preload("DividendSetting")

	if shareholderID := c.Query("shareholder_id"); shareholderID != "" {
		query = query.Where("shareholder_id = ?", shareholderID)
	}
	if fiscalYear := c.Query("fiscal_year"); fiscalYear != "" {
		query = query.Where("fiscal_year = ?", fiscalYear)
	}
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	var total int64
	query.Model(&models.Dividend{}).Count(&total)
	offset := (page - 1) * pageSize
	query.Offset(offset).Limit(pageSize).Order("id DESC").Find(&dividends)

	// Augment each row with the live recomputed weighted_shares/gross/tax/net
	// so the UI can show current truth (post-transfers) alongside the stored
	// processing-time snapshot. We expose both — the frontend decides which
	// to show as primary and which as tooltip.
	type augmented struct {
		models.Dividend
		LiveWeightedShares float64 `json:"live_weighted_shares"`
		LiveGrossDividend  float64 `json:"live_gross_dividend"`
		LiveTaxAmount      float64 `json:"live_tax_amount"`
		LiveNetDividend    float64 `json:"live_net_dividend"`
		LiveUncollected    float64 `json:"live_uncollected"`
	}
	out := make([]augmented, 0, len(dividends))
	for _, d := range dividends {
		live := computeLiveDividend(d, d.DividendSetting)
		// Live uncollected = live net − already collected (reinvested is
		// already removed inside computeLiveDividend's net). Keeps the
		// Uncollected column consistent with the live Gross/Net columns so
		// it can never exceed the live gross.
		liveUncollected := live.Net - d.CollectedAmount
		if liveUncollected < 0 {
			liveUncollected = 0
		}
		out = append(out, augmented{
			Dividend:           d,
			LiveWeightedShares: live.WeightedShares,
			LiveGrossDividend:  live.Gross,
			LiveTaxAmount:      live.Tax,
			LiveNetDividend:    live.Net,
			LiveUncollected:    liveUncollected,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": out, "total": total, "page": page, "page_size": pageSize})
}

// GetDividend returns one dividend row with the shareholder and fiscal-year
// setting preloaded — used by the Authorization page's review modal.
func GetDividend(c *gin.Context) {
	id := c.Param("id")
	var dividend models.Dividend
	if err := database.DB.Preload("Shareholder").Preload("DividendSetting").
		First(&dividend, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dividend not found"})
		return
	}
	c.JSON(http.StatusOK, dividend)
}

func CollectDividend(c *gin.Context) {
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
		Amount        float64 `json:"amount" binding:"required"`
		PaymentMethod string  `json:"payment_method" binding:"required"`
		Remark        string  `json:"remark"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Amount > dividend.UncollectedAmount {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Amount exceeds uncollected dividend"})
		return
	}

	now := time.Now()
	dividend.CollectedAmount += input.Amount
	dividend.UncollectedAmount -= input.Amount
	dividend.PaymentMethod = input.PaymentMethod
	dividend.CollectionDate = &now
	dividend.Remark = input.Remark

	if dividend.UncollectedAmount <= 0 {
		dividend.Status = "collected"
	} else {
		dividend.Status = "partial"
	}

	database.DB.Save(&dividend)
	// Tax impact (informational) = proportional share of the dividend's tax
	// attributable to this collected slice. The collection is net cash; this
	// tells the operator how much tax was already withheld upstream for the
	// portion paid out today. Formula: tax × (this collect ÷ net).
	var taxImpact float64
	if dividend.NetDividend > 0 {
		taxImpact = dividend.TaxAmount * input.Amount / dividend.NetDividend
	}
	logDividendAction(database.DB, models.DividendAction{
		DividendID:    dividend.ID,
		ActionType:    "collect",
		Amount:        input.Amount,
		TaxImpact:     taxImpact,
		Description:   fmt.Sprintf("Collected ETB %.2f via %s (tax withheld ETB %.2f)", input.Amount, input.PaymentMethod, taxImpact),
		PaymentMethod: input.PaymentMethod,
		Remark:        input.Remark,
		ActedByUserID: getUserID(c),
	})
	c.JSON(http.StatusOK, gin.H{"message": "Dividend collected", "remaining": dividend.UncollectedAmount})
}

func BlockDividend(c *gin.Context) {
	id := c.Param("id")
	var input struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&input)

	var dividend models.Dividend
	database.DB.First(&dividend, id)
	database.DB.Model(&models.Dividend{}).Where("id = ?", id).
		Updates(map[string]interface{}{"is_blocked": true, "block_reason": input.Reason})
	logDividendAction(database.DB, models.DividendAction{
		DividendID:    dividend.ID,
		ActionType:    "block",
		Description:   "Dividend blocked: " + input.Reason,
		Remark:        input.Reason,
		ActedByUserID: getUserID(c),
	})
	c.JSON(http.StatusOK, gin.H{"message": "Dividend blocked"})
}

func ReleaseDividend(c *gin.Context) {
	id := c.Param("id")
	var dividend models.Dividend
	database.DB.First(&dividend, id)
	database.DB.Model(&models.Dividend{}).Where("id = ?", id).
		Updates(map[string]interface{}{"is_blocked": false, "block_reason": ""})
	logDividendAction(database.DB, models.DividendAction{
		DividendID:    dividend.ID,
		ActionType:    "release",
		Description:   "Block released",
		ActedByUserID: getUserID(c),
	})
	c.JSON(http.StatusOK, gin.H{"message": "Dividend released"})
}

func TransferDividend(c *gin.Context) {
	id := c.Param("id")
	var input struct {
		TransferTo string `json:"transfer_to" binding:"required"`
		Reason     string `json:"reason" binding:"required"` // inheritance, legal_order
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var dividend models.Dividend
	if err := database.DB.First(&dividend, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dividend not found"})
		return
	}
	// Strict guards.
	if dividend.IsBlocked {
		c.JSON(http.StatusConflict, gin.H{"error": "Dividend is blocked. Release the block before transferring."})
		return
	}
	if dividend.IsTransferred {
		c.JSON(http.StatusConflict, gin.H{"error": "Dividend has already been transferred."})
		return
	}
	if dividend.IsTransferPending {
		c.JSON(http.StatusConflict, gin.H{"error": "A transfer is already pending approval for this dividend."})
		return
	}
	if dividend.Status == "collected" {
		c.JSON(http.StatusConflict, gin.H{"error": "Dividend has already been fully collected; nothing left to transfer."})
		return
	}
	// Compute the transferable balance (what's left after reinvest + collect).
	transferAmount := dividend.GrossDividend - dividend.ReinvestedAmount - dividend.CollectedAmount
	if transferAmount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Nothing left to transfer on this dividend."})
		return
	}

	// Mark pending and store destination; the actual transfer runs on approve.
	now := time.Now()
	uid := getUserID(c)
	database.DB.Model(&models.Dividend{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"is_transfer_pending": true,
			"transfer_to":         input.TransferTo,
			"transfer_reason":     input.Reason,
		})
	database.DB.Create(&models.PendingApproval{
		EntityType:  "dividend",
		EntityID:    dividend.ID,
		Action:      "transfer",
		RequestedBy: uid,
		Status:      "pending",
		RequestedAt: now,
		Remark:      fmt.Sprintf("To %s (%s) — ETB %.2f", input.TransferTo, input.Reason, transferAmount),
	})
	logDividendAction(database.DB, models.DividendAction{
		DividendID:    dividend.ID,
		ActionType:    "transfer_requested",
		Amount:        transferAmount,
		TaxImpact:     dividend.TaxAmount,
		Description:   fmt.Sprintf("Transfer to %s (%s) — ETB %.2f, pending approval", input.TransferTo, input.Reason, transferAmount),
		Remark:        input.Reason,
		ActedByUserID: uid,
	})
	c.JSON(http.StatusOK, gin.H{
		"message":         "Transfer request queued for authorization",
		"transfer_amount": transferAmount,
	})
}

func ReturnDividendTax(c *gin.Context) {
	id := c.Param("id")
	database.DB.Model(&models.Dividend{}).Where("id = ?", id).Update("is_tax_returned", true)
	c.JSON(http.StatusOK, gin.H{"message": "Dividend tax returned"})
}

func ReturnDividendPayment(c *gin.Context) {
	id := c.Param("id")
	var dividend models.Dividend
	if err := database.DB.First(&dividend, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dividend not found"})
		return
	}
	dividend.IsPaymentReturned = true
	dividend.UncollectedAmount += dividend.CollectedAmount
	dividend.CollectedAmount = 0
	dividend.Status = "pending"
	database.DB.Save(&dividend)
	c.JSON(http.StatusOK, gin.H{"message": "Dividend payment returned"})
}

// Dividend Tax Schedules
func GetDividendTaxSchedules(c *gin.Context) {
	var schedules []models.DividendTaxSchedule
	database.DB.Order("min_amount ASC").Find(&schedules)
	c.JSON(http.StatusOK, gin.H{"data": schedules})
}

func UpdateDividendTaxSchedule(c *gin.Context) {
	var schedules []models.DividendTaxSchedule
	if err := c.ShouldBindJSON(&schedules); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Where("1 = 1").Delete(&models.DividendTaxSchedule{})
	database.DB.Create(&schedules)
	c.JSON(http.StatusOK, gin.H{"message": "Tax schedules updated"})
}

func CreateDividendTaxBracket(c *gin.Context) {
	var bracket models.DividendTaxSchedule
	if err := c.ShouldBindJSON(&bracket); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Create(&bracket)
	c.JSON(http.StatusCreated, gin.H{"message": "Tax bracket created", "id": bracket.ID})
}

func UpdateDividendTaxBracket(c *gin.Context) {
	id := c.Param("id")
	var bracket models.DividendTaxSchedule
	if err := database.DB.First(&bracket, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Tax bracket not found"})
		return
	}
	if err := c.ShouldBindJSON(&bracket); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Save(&bracket)
	c.JSON(http.StatusOK, gin.H{"message": "Tax bracket updated"})
}

func DeleteDividendTaxBracket(c *gin.Context) {
	id := c.Param("id")
	database.DB.Delete(&models.DividendTaxSchedule{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "Tax bracket deleted"})
}

// DPS Summary Table
func GetDPSSummary(c *gin.Context) {
	var settings []models.DividendSetting
	database.DB.Where("is_processed = ?", true).Order("fiscal_year DESC").Find(&settings)

	var summaries []gin.H
	for _, s := range settings {
		var totalDividend float64
		var totalTax float64
		var totalCollected float64
		var shareholderCount int64

		database.DB.Model(&models.Dividend{}).Where("dividend_setting_id = ?", s.ID).
			Select("COALESCE(SUM(gross_dividend), 0)").Scan(&totalDividend)
		database.DB.Model(&models.Dividend{}).Where("dividend_setting_id = ?", s.ID).
			Select("COALESCE(SUM(tax_amount), 0)").Scan(&totalTax)
		database.DB.Model(&models.Dividend{}).Where("dividend_setting_id = ?", s.ID).
			Select("COALESCE(SUM(collected_amount), 0)").Scan(&totalCollected)
		database.DB.Model(&models.Dividend{}).Where("dividend_setting_id = ?", s.ID).
			Count(&shareholderCount)

		summaries = append(summaries, gin.H{
			"fiscal_year":        s.FiscalYear,
			"declared_amount":    s.DeclaredAmount,
			"dividend_per_share": s.DividendPerShare,
			"total_dividend":     totalDividend,
			"total_tax":          totalTax,
			"total_collected":    totalCollected,
			"total_uncollected":  totalDividend - totalTax - totalCollected,
			"shareholders":       shareholderCount,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": summaries})
}
