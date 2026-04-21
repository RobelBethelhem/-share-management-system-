package handlers

import (
	"net/http"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

func GetDashboard(c *gin.Context) {
	// ── Core Stats ──
	var activeShareholders int64
	database.DB.Model(&models.Shareholder{}).Where("status = ?", "active").Count(&activeShareholders)

	var dormantShareholders int64
	database.DB.Model(&models.Shareholder{}).Where("status = ?", "dormant").Count(&dormantShareholders)

	var totalShareholders int64
	database.DB.Model(&models.Shareholder{}).Count(&totalShareholders)

	var totalSubscriptions int64
	database.DB.Model(&models.Subscription{}).Where("status = ?", "active").Count(&totalSubscriptions)

	var totalPaidUpCapital float64
	database.DB.Model(&models.Investment{}).
		Where("status = ? AND approval_status = ?", "active", "approved").
		Select("COALESCE(SUM(amount), 0)").Scan(&totalPaidUpCapital)

	var totalShares int64
	database.DB.Model(&models.Allocation{}).
		Select("COALESCE(SUM(allocated_shares), 0)").Scan(&totalShares)

	var totalUncollectedDividend float64
	database.DB.Model(&models.Dividend{}).
		Select("COALESCE(SUM(uncollected_amount), 0)").Scan(&totalUncollectedDividend)

	var totalCollectedDividend float64
	database.DB.Model(&models.Dividend{}).
		Select("COALESCE(SUM(collected_amount), 0)").Scan(&totalCollectedDividend)

	var totalTransfers int64
	database.DB.Model(&models.Transfer{}).Count(&totalTransfers)

	var totalTransferValue float64
	database.DB.Model(&models.Transfer{}).
		Where("status = ? OR approval_status = ?", "approved", "approved").
		Select("COALESCE(SUM(transfer_amount), 0)").Scan(&totalTransferValue)

	var totalBlocked int64
	database.DB.Model(&models.ShareBlock{}).Where("is_released = ?", false).Count(&totalBlocked)

	var totalBlockedAmount float64
	database.DB.Model(&models.ShareBlock{}).
		Where("is_released = ?", false).
		Select("COALESCE(SUM(block_amount_birr), 0)").Scan(&totalBlockedAmount)

	var pendingApprovals int64
	database.DB.Model(&models.PendingApproval{}).Where("status = ?", "pending").Count(&pendingApprovals)

	var totalCertificates int64
	database.DB.Model(&models.Certificate{}).Where("status = ?", "active").Count(&totalCertificates)

	// ── Investor Category Breakdown ──
	type CategoryCount struct {
		Type  string `json:"type"`
		Count int64  `json:"count"`
	}
	var categories []CategoryCount
	database.DB.Model(&models.Shareholder{}).
		Where("status = ?", "active").
		Select("shareholder_type as type, count(*) as count").
		Group("shareholder_type").Scan(&categories)

	// ── Gender Distribution ──
	type GenderCount struct {
		Gender string `json:"gender"`
		Count  int64  `json:"count"`
	}
	var genders []GenderCount
	database.DB.Model(&models.Shareholder{}).
		Where("status = ? AND gender != ''", "active").
		Select("gender, count(*) as count").
		Group("gender").Scan(&genders)

	// ── Foreign Nationals ──
	var foreignCount int64
	var foreignCapital float64
	database.DB.Model(&models.Shareholder{}).
		Where("is_foreign = ? AND status = ?", true, "active").Count(&foreignCount)
	database.DB.Model(&models.Investment{}).
		Joins("JOIN shareholders ON shareholders.id = investments.shareholder_id").
		Where("shareholders.is_foreign = ? AND investments.status = ? AND investments.approval_status = ?", true, "active", "approved").
		Select("COALESCE(SUM(investments.amount), 0)").Scan(&foreignCapital)

	var foreignPercentage float64
	if totalPaidUpCapital > 0 {
		foreignPercentage = (foreignCapital / totalPaidUpCapital) * 100
	}

	// ── Staff Shareholders ──
	var staffCount int64
	database.DB.Model(&models.Shareholder{}).
		Where("is_staff = ? AND status = ?", true, "active").Count(&staffCount)

	// ── Bank Capital ──
	var bankCapital models.BankCapital
	database.DB.Order("id DESC").First(&bankCapital)

	capitalUtilization := float64(0)
	if bankCapital.AuthorizedCapital > 0 {
		capitalUtilization = (totalPaidUpCapital / bankCapital.AuthorizedCapital) * 100
	}

	// ── Monthly Investment Trend (last 12 months) ──
	type MonthlyTrend struct {
		Month  string  `json:"month"`
		Amount float64 `json:"amount"`
		Count  int64   `json:"count"`
	}
	var investmentTrend []MonthlyTrend
	database.DB.Model(&models.Investment{}).
		Where("status = ? AND approval_status = ? AND payment_date IS NOT NULL", "active", "approved").
		Select("DATE_FORMAT(payment_date, '%Y-%m') as month, SUM(amount) as amount, COUNT(*) as count").
		Group("DATE_FORMAT(payment_date, '%Y-%m')").
		Order("month DESC").Limit(12).
		Scan(&investmentTrend)
	// Reverse to chronological order
	for i, j := 0, len(investmentTrend)-1; i < j; i, j = i+1, j-1 {
		investmentTrend[i], investmentTrend[j] = investmentTrend[j], investmentTrend[i]
	}

	// ── Monthly Registration Trend ──
	type RegistrationTrend struct {
		Month string `json:"month"`
		Count int64  `json:"count"`
	}
	var regTrend []RegistrationTrend
	database.DB.Model(&models.Shareholder{}).
		Select("DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count").
		Group("DATE_FORMAT(created_at, '%Y-%m')").
		Order("month DESC").Limit(12).
		Scan(&regTrend)
	for i, j := 0, len(regTrend)-1; i < j; i, j = i+1, j-1 {
		regTrend[i], regTrend[j] = regTrend[j], regTrend[i]
	}

	// ── Dividend by Fiscal Year ──
	type DividendYearSummary struct {
		FiscalYear  string  `json:"fiscal_year"`
		Gross       float64 `json:"gross"`
		Tax         float64 `json:"tax"`
		Collected   float64 `json:"collected"`
		Uncollected float64 `json:"uncollected"`
	}
	var dividendByYear []DividendYearSummary
	database.DB.Model(&models.Dividend{}).
		Select("fiscal_year, SUM(gross_dividend) as gross, SUM(tax_amount) as tax, SUM(collected_amount) as collected, SUM(uncollected_amount) as uncollected").
		Group("fiscal_year").Order("fiscal_year DESC").Limit(5).
		Scan(&dividendByYear)
	for i, j := 0, len(dividendByYear)-1; i < j; i, j = i+1, j-1 {
		dividendByYear[i], dividendByYear[j] = dividendByYear[j], dividendByYear[i]
	}

	// ── Top 10 Shareholders ──
	type TopShareholder struct {
		ID            uint    `json:"id"`
		AccountNo     string  `json:"account_no"`
		Name          string  `json:"name"`
		TotalShares   int64   `json:"total_shares"`
		TotalInvested float64 `json:"total_invested"`
	}
	var topShareholders []TopShareholder
	database.DB.Raw(`
		SELECT s.id, s.account_no,
			CONCAT(s.first_name, ' ', COALESCE(s.middle_name, ''), ' ', s.last_name) as name,
			COALESCE(SUM(i.number_of_shares), 0) as total_shares,
			COALESCE(SUM(i.amount), 0) as total_invested
		FROM shareholders s
		LEFT JOIN investments i ON i.shareholder_id = s.id AND i.status = 'active' AND i.approval_status = 'approved'
		WHERE s.status = 'active' AND s.deleted_at IS NULL
		GROUP BY s.id, s.account_no, s.first_name, s.middle_name, s.last_name
		HAVING total_shares > 0
		ORDER BY total_shares DESC
		LIMIT 10
	`).Scan(&topShareholders)

	// ── Recent Activities ──
	var recentInvestments []models.Investment
	database.DB.Preload("Shareholder").Order("created_at DESC").Limit(5).Find(&recentInvestments)

	var recentTransfers []models.Transfer
	database.DB.Preload("Transferor").Preload("Transferee").Order("created_at DESC").Limit(5).Find(&recentTransfers)

	// ── Subscription Status Breakdown ──
	type SubStatus struct {
		Status string `json:"status"`
		Count  int64  `json:"count"`
	}
	var subStatuses []SubStatus
	database.DB.Model(&models.Subscription{}).
		Select("status, count(*) as count").
		Group("status").Scan(&subStatuses)

	// ── Transfer Type Breakdown ──
	type TransferTypeCount struct {
		Type  string `json:"type"`
		Count int64  `json:"count"`
	}
	var transferTypes []TransferTypeCount
	database.DB.Model(&models.Transfer{}).
		Select("transfer_type as type, count(*) as count").
		Group("transfer_type").Scan(&transferTypes)

	// ── Block Type Breakdown ──
	type BlockTypeCount struct {
		Type  string `json:"type"`
		Count int64  `json:"count"`
	}
	var blockTypes []BlockTypeCount
	database.DB.Model(&models.ShareBlock{}).
		Where("is_released = ?", false).
		Select("block_type as type, count(*) as count").
		Group("block_type").Scan(&blockTypes)

	// ── Approval Status Breakdown ──
	type ApprovalBreakdown struct {
		EntityType string `json:"entity_type"`
		Count      int64  `json:"count"`
	}
	var pendingByType []ApprovalBreakdown
	database.DB.Model(&models.PendingApproval{}).
		Where("status = ?", "pending").
		Select("entity_type, count(*) as count").
		Group("entity_type").Scan(&pendingByType)

	// ── Total Service Fees Collected ──
	var totalServiceFees float64
	database.DB.Model(&models.ServiceCharge{}).
		Select("COALESCE(SUM(amount), 0)").Scan(&totalServiceFees)

	c.JSON(http.StatusOK, gin.H{
		"active_shareholders":        activeShareholders,
		"dormant_shareholders":       dormantShareholders,
		"total_shareholders":         totalShareholders,
		"total_subscriptions":        totalSubscriptions,
		"total_paid_up_capital":      totalPaidUpCapital,
		"total_shares":               totalShares,
		"total_uncollected_dividend": totalUncollectedDividend,
		"total_collected_dividend":   totalCollectedDividend,
		"total_transfers":            totalTransfers,
		"total_transfer_value":       totalTransferValue,
		"total_blocked":              totalBlocked,
		"total_blocked_amount":       totalBlockedAmount,
		"pending_approvals":          pendingApprovals,
		"total_certificates":         totalCertificates,
		"total_service_fees":         totalServiceFees,
		"staff_count":                staffCount,
		"investor_categories":        categories,
		"gender_distribution":        genders,
		"foreign_nationals": gin.H{
			"count":      foreignCount,
			"capital":    foreignCapital,
			"percentage": foreignPercentage,
		},
		"bank_capital":         bankCapital,
		"capital_utilization":  capitalUtilization,
		"investment_trend":     investmentTrend,
		"registration_trend":   regTrend,
		"dividend_by_year":     dividendByYear,
		"top_shareholders":     topShareholders,
		"recent_investments":   recentInvestments,
		"recent_transfers":     recentTransfers,
		"subscription_status":  subStatuses,
		"transfer_types":       transferTypes,
		"block_types":          blockTypes,
		"pending_by_type":      pendingByType,
	})
}
