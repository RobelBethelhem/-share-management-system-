package handlers

import (
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

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
	c.JSON(http.StatusOK, inv)
}

func CreateInvestment(c *gin.Context) {
	var inv models.Investment
	if err := c.ShouldBindJSON(&inv); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check for double payment (same shareholder, same date, same amount)
	var exists int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND amount = ? AND DATE(payment_date) = DATE(?)",
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
		Status              string     `json:"status"`
		ApprovalStatus      string     `json:"approval_status"`
		SubscriptionType    string     `json:"subscription_type"`
		PaidAmount          float64    `json:"paid_amount"`
		PaidShares          int64      `json:"paid_shares"`
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
		if a.Subscription.ID > 0 {
			subType = a.Subscription.Type
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

		allocDetails = append(allocDetails, AllocDetail{
			ID:                  a.ID,
			AllocationNo:        a.AllocationNo,
			Round:               a.Round,
			AllocatedShares:     a.AllocatedShares,
			AllocatedAmount:     a.AllocatedAmount,
			AllocationDate:      a.AllocationDate,
			Status:              a.Status,
			ApprovalStatus:      a.ApprovalStatus,
			SubscriptionType:    subType,
			PaidAmount:          paid,
			PaidShares:          paidShares,
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
