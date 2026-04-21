package handlers

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

// Dividend Settings
func GetDividendSettings(c *gin.Context) {
	var settings []models.DividendSetting
	database.DB.Order("fiscal_year DESC").Find(&settings)
	c.JSON(http.StatusOK, gin.H{"data": settings})
}

func CreateDividendSetting(c *gin.Context) {
	var setting models.DividendSetting
	if err := c.ShouldBindJSON(&setting); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Create(&setting)
	c.JSON(http.StatusCreated, gin.H{"message": "Dividend setting created", "id": setting.ID})
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
	database.DB.Save(&setting)
	c.JSON(http.StatusOK, gin.H{"message": "Dividend setting updated"})
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

	c.JSON(http.StatusOK, gin.H{"data": dividends, "total": total, "page": page, "page_size": pageSize})
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
	c.JSON(http.StatusOK, gin.H{"message": "Dividend collected", "remaining": dividend.UncollectedAmount})
}

func BlockDividend(c *gin.Context) {
	id := c.Param("id")
	var input struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&input)

	database.DB.Model(&models.Dividend{}).Where("id = ?", id).
		Updates(map[string]interface{}{"is_blocked": true, "block_reason": input.Reason})
	c.JSON(http.StatusOK, gin.H{"message": "Dividend blocked"})
}

func ReleaseDividend(c *gin.Context) {
	id := c.Param("id")
	database.DB.Model(&models.Dividend{}).Where("id = ?", id).
		Updates(map[string]interface{}{"is_blocked": false, "block_reason": ""})
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

	database.DB.Model(&models.Dividend{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"is_transferred":   true,
			"transfer_to":     input.TransferTo,
			"transfer_reason": input.Reason,
			"status":          "transferred",
		})
	c.JSON(http.StatusOK, gin.H{"message": "Dividend transfer recorded"})
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
