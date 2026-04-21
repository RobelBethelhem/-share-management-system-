package handlers

import (
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

func MasterDataReport(c *gin.Context) {
	var shareholders []models.Shareholder
	database.DB.Preload("Address").Where("status = ?", "active").Order("account_no ASC").Find(&shareholders)
	c.JSON(http.StatusOK, gin.H{"data": shareholders, "total": len(shareholders)})
}

func ShareholderStatement(c *gin.Context) {
	id := c.Param("id")
	shIDu, _ := strconv.ParseUint(id, 10, 64)
	shID := uint(shIDu)

	var shareholder models.Shareholder
	database.DB.Preload("Address").First(&shareholder, id)

	var investments []models.Investment
	database.DB.Where("shareholder_id = ? AND status = ?", id, "active").Order("payment_date ASC").Find(&investments)

	var subscriptions []models.Subscription
	database.DB.Where("shareholder_id = ?", id).Find(&subscriptions)

	var dividends []models.Dividend
	database.DB.Where("shareholder_id = ?", id).Order("fiscal_year DESC").Find(&dividends)

	// Transfers — preload Lines + per-line allocations so the statement
	// can show paid/unpaid breakdown per source allocation.
	var transfers []models.Transfer
	database.DB.Where("transferor_id = ? OR transferee_id = ?", id, id).
		Preload("Transferor").Preload("Transferee").
		Preload("Lines").Preload("Lines.FromAllocation").
		Order("transfer_date DESC").Find(&transfers)

	// Blocks — preload Allocation for per-allocation context
	var blocks []models.ShareBlock
	database.DB.Where("shareholder_id = ?", id).
		Preload("Allocation").
		Order("id DESC").Find(&blocks)

	// Safety net: if Preload("Allocation") returned nil for a block that has allocation_id set,
	// load the allocation individually. This handles edge cases where the batch preload misses records.
	for i := range blocks {
		if blocks[i].AllocationID != nil && blocks[i].Allocation == nil {
			var alloc models.Allocation
			if err := database.DB.First(&alloc, *blocks[i].AllocationID).Error; err == nil {
				blocks[i].Allocation = &alloc
			}
		}
	}

	// Allocations with paid/unpaid/blocked breakdown
	var allocations []models.Allocation
	database.DB.Where("shareholder_id = ?", id).
		Preload("Subscription").Order("id ASC").Find(&allocations)

	type AllocSummary struct {
		ID              uint    `json:"id"`
		AllocationNo    string  `json:"allocation_no"`
		Round           int     `json:"round"`
		AllocatedShares int64   `json:"allocated_shares"`
		AllocatedAmount float64 `json:"allocated_amount"`
		PaidShares      int64   `json:"paid_shares"`
		UnpaidShares    int64   `json:"unpaid_shares"`
		BlockedShares   int64   `json:"blocked_shares"`
		PaidBlocked     int64   `json:"paid_blocked"`
		UnpaidBlocked   int64   `json:"unpaid_blocked"`
		AvailableShares int64   `json:"available_shares"`
		ApprovalStatus  string  `json:"approval_status"`
		SubType         string  `json:"subscription_type"`
	}

	allocSummaries := make([]AllocSummary, 0, len(allocations))
	for _, a := range allocations {
		paidShares := computeAllocPaidShares(shID, a.ID)
		paidBlocked := getEffectivePaidBlocked(a.ID)
		unpaidBlocked := getEffectiveUnpaidBlocked(a.ID)
		var totalBlocked int64
		database.DB.Model(&models.ShareBlock{}).
			Where("allocation_id = ? AND is_released = ?", a.ID, false).
			Select("COALESCE(SUM(block_shares), 0)").Scan(&totalBlocked)
		subType := ""
		if a.SubscriptionID != nil {
			subType = a.Subscription.Type
		}
		allocSummaries = append(allocSummaries, AllocSummary{
			ID:              a.ID,
			AllocationNo:    a.AllocationNo,
			Round:           a.Round,
			AllocatedShares: a.AllocatedShares,
			AllocatedAmount: a.AllocatedAmount,
			PaidShares:      paidShares,
			UnpaidShares:    a.AllocatedShares - paidShares,
			BlockedShares:   totalBlocked,
			PaidBlocked:     paidBlocked,
			UnpaidBlocked:   unpaidBlocked,
			AvailableShares: a.AllocatedShares - totalBlocked,
			ApprovalStatus:  a.ApprovalStatus,
			SubType:         subType,
		})
	}

	var totalInvested float64
	var totalShares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ?", id, "active").
		Select("COALESCE(SUM(amount), 0)").Scan(&totalInvested)
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ?", id, "active").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

	c.JSON(http.StatusOK, gin.H{
		"shareholder":    shareholder,
		"investments":    investments,
		"subscriptions":  subscriptions,
		"dividends":      dividends,
		"transfers":      transfers,
		"blocks":         blocks,
		"allocations":    allocSummaries,
		"total_invested": totalInvested,
		"total_shares":   totalShares,
	})
}

func SubscriptionReport(c *gin.Context) {
	var subs []models.Subscription
	query := database.DB.Preload("Shareholder")
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	query.Order("id DESC").Find(&subs)

	var totalAmount float64
	database.DB.Model(&models.Subscription{}).
		Where("status = ?", "active").
		Select("COALESCE(SUM(share_amount), 0)").Scan(&totalAmount)

	c.JSON(http.StatusOK, gin.H{"data": subs, "total": len(subs), "total_amount": totalAmount})
}

func InvestmentReport(c *gin.Context) {
	var investments []models.Investment
	query := database.DB.Preload("Shareholder").Where("status = ?", "active")
	totalQuery := database.DB.Model(&models.Investment{}).Where("status = ?", "active")
	if startDate := c.Query("start_date"); startDate != "" {
		query = query.Where("payment_date >= ?", startDate)
		totalQuery = totalQuery.Where("payment_date >= ?", startDate)
	}
	if endDate := c.Query("end_date"); endDate != "" {
		query = query.Where("payment_date <= ?", endDate)
		totalQuery = totalQuery.Where("payment_date <= ?", endDate)
	}
	query.Order("payment_date DESC").Find(&investments)

	var totalAmount float64
	var totalShares int64
	totalQuery.Select("COALESCE(SUM(amount), 0)").Scan(&totalAmount)
	totalQuery.Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

	c.JSON(http.StatusOK, gin.H{"data": investments, "total": len(investments), "total_amount": totalAmount, "total_shares": totalShares})
}

func RegistrationBookReport(c *gin.Context) {
	var shareholders []models.Shareholder
	database.DB.Preload("Address").Where("status = ?", "active").
		Order("created_at DESC").Find(&shareholders)

	type RegEntry struct {
		models.Shareholder
		TotalShares   int64   `json:"total_shares"`
		TotalInvested float64 `json:"total_invested"`
	}

	var entries []RegEntry
	for _, sh := range shareholders {
		var totalShares int64
		var totalInvested float64
		database.DB.Model(&models.Investment{}).
			Where("shareholder_id = ? AND status = ?", sh.ID, "active").
			Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)
		database.DB.Model(&models.Investment{}).
			Where("shareholder_id = ? AND status = ?", sh.ID, "active").
			Select("COALESCE(SUM(amount), 0)").Scan(&totalInvested)
		entries = append(entries, RegEntry{
			Shareholder:   sh,
			TotalShares:   totalShares,
			TotalInvested: totalInvested,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": entries, "total": len(entries)})
}

// TransferEntry wraps Transfer with computed paid/unpaid totals aggregated from lines.
type TransferEntry struct {
	models.Transfer
	PaidSharesTotal   int64 `json:"paid_shares_total"`
	UnpaidSharesTotal int64 `json:"unpaid_shares_total"`
}

func TransferReport(c *gin.Context) {
	var transfers []models.Transfer
	query := database.DB.Preload("Transferor").Preload("Transferee").
		Preload("Lines").Preload("Lines.FromAllocation")

	if startDate := c.Query("start_date"); startDate != "" {
		query = query.Where("transfer_date >= ?", startDate)
	}
	if endDate := c.Query("end_date"); endDate != "" {
		query = query.Where("transfer_date <= ?", endDate)
	}
	query.Order("transfer_date DESC").Find(&transfers)

	entries := make([]TransferEntry, 0, len(transfers))
	for _, t := range transfers {
		var paid, unpaid int64
		for _, l := range t.Lines {
			paid += l.PaidSharesToTransfer
			unpaid += l.UnpaidSharesToTransfer
		}
		entries = append(entries, TransferEntry{
			Transfer:          t,
			PaidSharesTotal:   paid,
			UnpaidSharesTotal: unpaid,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": entries, "total": len(entries)})
}

func DividendReport(c *gin.Context) {
	var dividends []models.Dividend
	query := database.DB.Preload("Shareholder").Preload("DividendSetting")
	if fiscalYear := c.Query("fiscal_year"); fiscalYear != "" {
		query = query.Where("fiscal_year = ?", fiscalYear)
	}
	query.Order("id DESC").Find(&dividends)

	var totalGross, totalTax, totalNet, totalCollected float64
	for _, d := range dividends {
		totalGross += d.GrossDividend
		totalTax += d.TaxAmount
		totalNet += d.NetDividend
		totalCollected += d.CollectedAmount
	}

	c.JSON(http.StatusOK, gin.H{
		"data":            dividends,
		"total":           len(dividends),
		"total_gross":     totalGross,
		"total_tax":       totalTax,
		"total_net":       totalNet,
		"total_collected": totalCollected,
	})
}

func DividendTaxReport(c *gin.Context) {
	var dividends []models.Dividend
	query := database.DB.Preload("Shareholder")
	if fiscalYear := c.Query("fiscal_year"); fiscalYear != "" {
		query = query.Where("fiscal_year = ?", fiscalYear)
	}
	query.Where("tax_amount > 0").Order("id DESC").Find(&dividends)

	var totalTax float64
	for _, d := range dividends {
		totalTax += d.TaxAmount
	}

	c.JSON(http.StatusOK, gin.H{"data": dividends, "total": len(dividends), "total_tax": totalTax})
}

// BlockReport returns share blocks with allocation and paid/unpaid split info.
func BlockReport(c *gin.Context) {
	var blocks []models.ShareBlock
	query := database.DB.Preload("Shareholder").Preload("Allocation")
	if isReleased := c.Query("is_released"); isReleased != "" {
		query = query.Where("is_released = ?", isReleased == "true")
	}
	if sharesType := c.Query("shares_type"); sharesType != "" {
		query = query.Where("shares_type = ?", sharesType)
	}
	query.Order("id DESC").Find(&blocks)

	var totalBlocked, activeBlocked int64
	for _, b := range blocks {
		totalBlocked += b.BlockShares
		if !b.IsReleased {
			activeBlocked += b.BlockShares
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data":           blocks,
		"total":          len(blocks),
		"total_blocked":  totalBlocked,
		"active_blocked": activeBlocked,
	})
}

// CertificateReport returns certificates with allocation info.
func CertificateReport(c *gin.Context) {
	var certs []models.Certificate
	database.DB.Preload("Shareholder").Preload("Allocation").Order("id DESC").Find(&certs)
	c.JSON(http.StatusOK, gin.H{"data": certs, "total": len(certs)})
}

func ForeignShareholdersReport(c *gin.Context) {
	var shareholders []models.Shareholder
	database.DB.Preload("Address").Where("is_foreign = ? AND status = ?", true, "active").Find(&shareholders)

	type ForeignEntry struct {
		models.Shareholder
		TotalShares   int64   `json:"total_shares"`
		TotalInvested float64 `json:"total_invested"`
	}

	var entries []ForeignEntry
	var totalCapital float64
	for _, sh := range shareholders {
		var totalShares int64
		var totalInvested float64
		database.DB.Model(&models.Investment{}).
			Where("shareholder_id = ? AND status = ?", sh.ID, "active").
			Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)
		database.DB.Model(&models.Investment{}).
			Where("shareholder_id = ? AND status = ?", sh.ID, "active").
			Select("COALESCE(SUM(amount), 0)").Scan(&totalInvested)
		totalCapital += totalInvested
		entries = append(entries, ForeignEntry{
			Shareholder:   sh,
			TotalShares:   totalShares,
			TotalInvested: totalInvested,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": entries, "total": len(entries), "total_capital": totalCapital})
}

func StaffShareholdersReport(c *gin.Context) {
	var shareholders []models.Shareholder
	database.DB.Preload("Address").Where("is_staff = ? AND status = ?", true, "active").Find(&shareholders)
	c.JSON(http.StatusOK, gin.H{"data": shareholders, "total": len(shareholders)})
}

func TopShareholdersReport(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

	type TopEntry struct {
		ShareholderID uint    `json:"shareholder_id"`
		AccountNo     string  `json:"account_no"`
		Name          string  `json:"name"`
		TotalShares   int64   `json:"total_shares"`
		TotalInvested float64 `json:"total_invested"`
	}

	var entries []TopEntry
	database.DB.Raw(`
		SELECT s.id as shareholder_id, s.account_no,
			CONCAT(s.first_name, ' ', COALESCE(s.middle_name, ''), ' ', s.last_name) as name,
			COALESCE(SUM(i.number_of_shares), 0) as total_shares,
			COALESCE(SUM(i.amount), 0) as total_invested
		FROM shareholders s
		LEFT JOIN investments i ON i.shareholder_id = s.id AND i.status = 'active'
		WHERE s.status = 'active' AND s.deleted_at IS NULL
		GROUP BY s.id, s.account_no, s.first_name, s.middle_name, s.last_name
		ORDER BY total_shares DESC
		LIMIT ?
	`, limit).Scan(&entries)

	c.JSON(http.StatusOK, gin.H{"data": entries, "total": len(entries)})
}

func ServiceChargeReport(c *gin.Context) {
	var charges []models.ServiceCharge
	query := database.DB.Preload("Shareholder")
	if chargeType := c.Query("type"); chargeType != "" {
		query = query.Where("charge_type = ?", chargeType)
	}
	if startDate := c.Query("start_date"); startDate != "" {
		query = query.Where("charge_date >= ?", startDate)
	}
	if endDate := c.Query("end_date"); endDate != "" {
		query = query.Where("charge_date <= ?", endDate)
	}
	query.Order("charge_date DESC").Find(&charges)

	var totalAmount float64
	for _, ch := range charges {
		totalAmount += ch.Amount
	}

	c.JSON(http.StatusOK, gin.H{"data": charges, "total": len(charges), "total_amount": totalAmount})
}

func DormantShareholdersReport(c *gin.Context) {
	var shareholders []models.Shareholder
	database.DB.Where("status = ?", "dormant").Find(&shareholders)
	c.JSON(http.StatusOK, gin.H{"data": shareholders, "total": len(shareholders)})
}

// DailySchedulesReport returns daily investment and transfer activity for a given date range
func DailySchedulesReport(c *gin.Context) {
	startDate := c.DefaultQuery("start_date", time.Now().Format("2006-01-02"))
	endDate := c.DefaultQuery("end_date", startDate)

	type DailyEntry struct {
		Date             string  `json:"date"`
		Investments      int64   `json:"investments"`
		InvestmentAmount float64 `json:"investment_amount"`
		Transfers        int64   `json:"transfers"`
		TransferAmount   float64 `json:"transfer_amount"`
		Collections      int64   `json:"collections"`
		CollectionAmount float64 `json:"collection_amount"`
		ServiceFees      float64 `json:"service_fees"`
	}

	var entries []DailyEntry
	database.DB.Raw(`
		SELECT dates.date,
			COALESCE(inv.cnt, 0) as investments,
			COALESCE(inv.amt, 0) as investment_amount,
			COALESCE(tr.cnt, 0) as transfers,
			COALESCE(tr.amt, 0) as transfer_amount,
			COALESCE(div.cnt, 0) as collections,
			COALESCE(div.amt, 0) as collection_amount,
			COALESCE(sc.amt, 0) as service_fees
		FROM (
			SELECT DATE(payment_date) as date FROM investments WHERE payment_date BETWEEN ? AND ?
			UNION SELECT DATE(transfer_date) FROM transfers WHERE transfer_date BETWEEN ? AND ?
			UNION SELECT DATE(collection_date) FROM dividends WHERE collection_date BETWEEN ? AND ?
			UNION SELECT DATE(charge_date) FROM service_charges WHERE charge_date BETWEEN ? AND ?
		) dates
		LEFT JOIN (
			SELECT DATE(payment_date) as d, COUNT(*) as cnt, SUM(amount) as amt
			FROM investments WHERE payment_date BETWEEN ? AND ? AND status = 'active'
			GROUP BY DATE(payment_date)
		) inv ON inv.d = dates.date
		LEFT JOIN (
			SELECT DATE(transfer_date) as d, COUNT(*) as cnt, SUM(transfer_amount) as amt
			FROM transfers WHERE transfer_date BETWEEN ? AND ?
			GROUP BY DATE(transfer_date)
		) tr ON tr.d = dates.date
		LEFT JOIN (
			SELECT DATE(collection_date) as d, COUNT(*) as cnt, SUM(collected_amount) as amt
			FROM dividends WHERE collection_date BETWEEN ? AND ? AND collected_amount > 0
			GROUP BY DATE(collection_date)
		) div ON div.d = dates.date
		LEFT JOIN (
			SELECT DATE(charge_date) as d, SUM(amount) as amt
			FROM service_charges WHERE charge_date BETWEEN ? AND ?
			GROUP BY DATE(charge_date)
		) sc ON sc.d = dates.date
		ORDER BY dates.date DESC
	`, startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate,
		startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate).Scan(&entries)

	c.JSON(http.StatusOK, gin.H{"data": entries, "total": len(entries)})
}

// InfluentialShareholdersReport returns shareholders who hold above a threshold percentage of total shares
func InfluentialShareholdersReport(c *gin.Context) {
	thresholdPct, _ := strconv.ParseFloat(c.DefaultQuery("threshold", "1"), 64)

	var totalShares int64
	database.DB.Model(&models.Investment{}).
		Where("status = ?", "active").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

	if totalShares == 0 {
		c.JSON(http.StatusOK, gin.H{"data": []interface{}{}, "total": 0, "total_shares": 0})
		return
	}

	threshold := float64(totalShares) * thresholdPct / 100

	type InfluentialEntry struct {
		ShareholderID   uint    `json:"shareholder_id"`
		AccountNo       string  `json:"account_no"`
		Name            string  `json:"name"`
		ShareholderType string  `json:"shareholder_type"`
		TotalShares     int64   `json:"total_shares"`
		TotalInvested   float64 `json:"total_invested"`
		SharePercentage float64 `json:"share_percentage"`
	}

	var entries []InfluentialEntry
	database.DB.Raw(`
		SELECT s.id as shareholder_id, s.account_no,
			CONCAT(s.first_name, ' ', COALESCE(s.middle_name, ''), ' ', s.last_name) as name,
			s.shareholder_type,
			COALESCE(SUM(i.number_of_shares), 0) as total_shares,
			COALESCE(SUM(i.amount), 0) as total_invested,
			COALESCE(SUM(i.number_of_shares), 0) * 100.0 / ? as share_percentage
		FROM shareholders s
		LEFT JOIN investments i ON i.shareholder_id = s.id AND i.status = 'active'
		WHERE s.status = 'active' AND s.deleted_at IS NULL
		GROUP BY s.id, s.account_no, s.first_name, s.middle_name, s.last_name, s.shareholder_type
		HAVING COALESCE(SUM(i.number_of_shares), 0) >= ?
		ORDER BY total_shares DESC
	`, totalShares, threshold).Scan(&entries)

	c.JSON(http.StatusOK, gin.H{
		"data":          entries,
		"total":         len(entries),
		"total_shares":  totalShares,
		"threshold_pct": thresholdPct,
	})
}

// AllocationReport returns per-allocation breakdown with paid/unpaid/blocked shares.
func AllocationReport(c *gin.Context) {
	var allocations []models.Allocation
	query := database.DB.Preload("Shareholder").Preload("Subscription")
	if shID := c.Query("shareholder_id"); shID != "" {
		query = query.Where("shareholder_id = ?", shID)
	}
	if approvalStatus := c.Query("approval_status"); approvalStatus != "" {
		query = query.Where("approval_status = ?", approvalStatus)
	}
	query.Order("shareholder_id ASC, id ASC").Find(&allocations)

	type AllocEntry struct {
		ID              uint    `json:"id"`
		AllocationNo    string  `json:"allocation_no"`
		Round           int     `json:"round"`
		AllocatedShares int64   `json:"allocated_shares"`
		AllocatedAmount float64 `json:"allocated_amount"`
		PaidShares      int64   `json:"paid_shares"`
		UnpaidShares    int64   `json:"unpaid_shares"`
		BlockedShares   int64   `json:"blocked_shares"`
		PaidBlocked     int64   `json:"paid_blocked"`
		UnpaidBlocked   int64   `json:"unpaid_blocked"`
		AvailableShares int64   `json:"available_shares"`
		ShareholderID   uint    `json:"shareholder_id"`
		AccountNo       string  `json:"account_no"`
		ShareholderName string  `json:"shareholder_name"`
		SubType         string  `json:"subscription_type"`
		ApprovalStatus  string  `json:"approval_status"`
	}

	entries := make([]AllocEntry, 0, len(allocations))
	var grandAllocated, grandPaid, grandBlocked int64
	for _, a := range allocations {
		paidShares := computeAllocPaidShares(a.ShareholderID, a.ID)
		paidBlocked := getEffectivePaidBlocked(a.ID)
		unpaidBlocked := getEffectiveUnpaidBlocked(a.ID)
		var totalBlocked int64
		database.DB.Model(&models.ShareBlock{}).
			Where("allocation_id = ? AND is_released = ?", a.ID, false).
			Select("COALESCE(SUM(block_shares), 0)").Scan(&totalBlocked)

		name := a.Shareholder.FirstName
		if a.Shareholder.MiddleName != "" {
			name += " " + a.Shareholder.MiddleName
		}
		name += " " + a.Shareholder.LastName

		subType := ""
		if a.SubscriptionID != nil {
			subType = a.Subscription.Type
		}

		grandAllocated += a.AllocatedShares
		grandPaid += paidShares
		grandBlocked += totalBlocked

		entries = append(entries, AllocEntry{
			ID:              a.ID,
			AllocationNo:    a.AllocationNo,
			Round:           a.Round,
			AllocatedShares: a.AllocatedShares,
			AllocatedAmount: a.AllocatedAmount,
			PaidShares:      paidShares,
			UnpaidShares:    a.AllocatedShares - paidShares,
			BlockedShares:   totalBlocked,
			PaidBlocked:     paidBlocked,
			UnpaidBlocked:   unpaidBlocked,
			AvailableShares: a.AllocatedShares - totalBlocked,
			ShareholderID:   a.ShareholderID,
			AccountNo:       a.Shareholder.AccountNo,
			ShareholderName: name,
			SubType:         subType,
			ApprovalStatus:  a.ApprovalStatus,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"data":            entries,
		"total":           len(entries),
		"total_allocated": grandAllocated,
		"total_paid":      grandPaid,
		"total_unpaid":    grandAllocated - grandPaid,
		"total_blocked":   grandBlocked,
		"total_available": grandAllocated - grandBlocked,
	})
}
