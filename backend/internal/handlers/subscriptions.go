package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetSubscriptions(c *gin.Context) {
	shareholderID := c.Query("shareholder_id")
	subType := c.Query("type")
	status := c.Query("status")
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

	countQ := database.DB.Model(&models.Subscription{})
	if shareholderID != "" {
		countQ = countQ.Where("shareholder_id = ?", shareholderID)
	}
	if subType != "" {
		countQ = countQ.Where("type = ?", subType)
	}
	if status != "" {
		countQ = countQ.Where("status = ?", status)
	}
	if search != "" {
		if len(searchShIDs) > 0 {
			countQ = countQ.Where("shareholder_id IN ?", searchShIDs)
		} else {
			countQ = countQ.Where("1 = 0") // no match
		}
	}
	var total int64
	countQ.Count(&total)

	findQ := database.DB.Model(&models.Subscription{})
	if shareholderID != "" {
		findQ = findQ.Where("shareholder_id = ?", shareholderID)
	}
	if subType != "" {
		findQ = findQ.Where("type = ?", subType)
	}
	if status != "" {
		findQ = findQ.Where("status = ?", status)
	}
	if search != "" {
		if len(searchShIDs) > 0 {
			findQ = findQ.Where("shareholder_id IN ?", searchShIDs)
		} else {
			findQ = findQ.Where("1 = 0") // no match
		}
	}
	var subscriptions []models.Subscription
	offset := (page - 1) * pageSize
	findQ.Preload("Shareholder").Offset(offset).Limit(pageSize).Order("id DESC").Find(&subscriptions)

	c.JSON(http.StatusOK, gin.H{"data": subscriptions, "total": total, "page": page, "page_size": pageSize})
}

func GetSubscription(c *gin.Context) {
	id := c.Param("id")
	var sub models.Subscription
	if err := database.DB.Preload("Shareholder").First(&sub, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}
	c.JSON(http.StatusOK, sub)
}

func CreateSubscription(c *gin.Context) {
	var sub models.Subscription
	if err := c.ShouldBindJSON(&sub); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check for double subscription
	var exists int64
	database.DB.Model(&models.Subscription{}).
		Where("shareholder_id = ? AND type = ? AND status = ?", sub.ShareholderID, sub.Type, "active").
		Count(&exists)
	if exists > 0 && sub.Type != "additional" {
		c.JSON(http.StatusConflict, gin.H{"error": "Active subscription already exists for this shareholder"})
		return
	}

	sub.Status = "active"
	sub.ApprovalStatus = "pending"
	if err := database.DB.Create(&sub).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create subscription: " + err.Error()})
		return
	}

	// Create pending approval
	approval := models.PendingApproval{
		EntityType:  "subscription",
		EntityID:    sub.ID,
		Action:      "create",
		RequestedBy: getUserID(c),
		Status:      "pending",
		RequestedAt: time.Now(),
	}
	if err := database.DB.Create(&approval).Error; err != nil {
		// Log but don't fail the subscription creation
		println("Warning: failed to create approval record:", err.Error())
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Subscription created, pending approval", "id": sub.ID})
}

func UpdateSubscription(c *gin.Context) {
	id := c.Param("id")
	var sub models.Subscription
	if err := database.DB.First(&sub, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	// Only allow editing if still pending approval
	if sub.ApprovalStatus != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot edit subscription after approval. Only pending subscriptions can be edited."})
		return
	}

	var input models.Subscription
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Update allowed fields only (not status/approval fields)
	sub.ShareholderID = input.ShareholderID
	sub.Type = input.Type
	sub.ShareAmount = input.ShareAmount
	sub.NumberOfShares = input.NumberOfShares
	sub.ParValue = input.ParValue
	sub.SubscriptionDate = input.SubscriptionDate
	sub.ExpiryDate = input.ExpiryDate
	sub.Remark = input.Remark

	database.DB.Save(&sub)
	c.JSON(http.StatusOK, gin.H{"message": "Subscription updated"})
}

func DeleteSubscription(c *gin.Context) {
	id := c.Param("id")
	var sub models.Subscription
	if err := database.DB.First(&sub, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	// Only allow deleting if still pending approval
	if sub.ApprovalStatus != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot delete subscription after approval. Only pending subscriptions can be deleted."})
		return
	}

	// Also delete the related pending approval
	database.DB.Where("entity_type = ? AND entity_id = ? AND status = ?", "subscription", sub.ID, "pending").
		Delete(&models.PendingApproval{})

	database.DB.Delete(&sub)
	c.JSON(http.StatusOK, gin.H{"message": "Subscription deleted"})
}

// subscriptionReversalGuards rejects a reversal whose side effects can't be
// safely unwound. Returns nil when the subscription's allocations are
// untouched by blocks and transfers.
func subscriptionReversalGuards(sub *models.Subscription) error {
	if sub.CapitalIncreaseID != nil {
		return fmt.Errorf("This subscription belongs to a capital increase — manage it from the Capital Increase module")
	}
	var allocIDs []uint
	database.DB.Model(&models.Allocation{}).
		Where("subscription_id = ?", sub.ID).Pluck("id", &allocIDs)
	if len(allocIDs) == 0 {
		return nil
	}

	// Active blocks lock the shares — they must be released first.
	var blocked int64
	database.DB.Model(&models.ShareBlock{}).
		Where("allocation_id IN ? AND is_released = ? AND approval_status <> ?", allocIDs, false, "rejected").
		Count(&blocked)
	if blocked > 0 {
		return fmt.Errorf("Cannot reverse: %d active share block(s) exist on this subscription's shares. Release them first.", blocked)
	}

	// Shares already moved (or moving) by transfer can't be pulled back.
	var transferInvs int64
	database.DB.Model(&models.Investment{}).
		Where("allocation_id IN ? AND payment_method IN ('transfer_in','transfer_out') AND status = 'active'", allocIDs).
		Count(&transferInvs)
	if transferInvs > 0 {
		return fmt.Errorf("Cannot reverse: shares from this subscription were involved in a transfer. Reversal is only possible while the shares are untouched.")
	}
	var pendingLines int64
	database.DB.Table("transfer_lines").
		Joins("JOIN transfers ON transfers.id = transfer_lines.transfer_id").
		Where("transfer_lines.from_allocation_id IN ? AND transfers.approval_status = ?", allocIDs, "pending").
		Count(&pendingLines)
	if pendingLines > 0 {
		return fmt.Errorf("Cannot reverse: a pending transfer draws from this subscription's shares. Resolve it first.")
	}
	var pendingDest int64
	database.DB.Model(&models.Transfer{}).
		Where("to_allocation_id IN ? AND approval_status = ?", allocIDs, "pending").
		Count(&pendingDest)
	if pendingDest > 0 {
		return fmt.Errorf("Cannot reverse: a pending transfer targets this subscription's allocation. Resolve it first.")
	}
	return nil
}

// ReverseSubscription REQUESTS a reversal (authorization required). The
// subscription — and every payment made against it — stays fully effective
// until an authorizer approves the reversal.
func ReverseSubscription(c *gin.Context) {
	id := c.Param("id")
	var sub models.Subscription
	if err := database.DB.First(&sub, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	if sub.ApprovalStatus != "approved" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot reverse subscription that has not been approved yet"})
		return
	}
	if sub.Status == "reversed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This subscription is already reversed"})
		return
	}
	if sub.IsReversalPending {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A reversal for this subscription is already pending approval"})
		return
	}
	if err := subscriptionReversalGuards(&sub); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sub.IsReversalPending = true
	database.DB.Save(&sub)

	database.DB.Create(&models.PendingApproval{
		EntityType:  "subscription",
		EntityID:    sub.ID,
		Action:      "reverse",
		RequestedBy: getUserID(c),
		Status:      "pending",
		RequestedAt: time.Now(),
	})

	c.JSON(http.StatusOK, gin.H{"message": "Reversal requested — pending authorization"})
}

// RunSubscriptionReversal executes an APPROVED reversal: the subscription, its
// allocations and every payment made against them cease to count anywhere —
// as if the investment never happened. Allocations are soft-deleted (dropping
// out of the summary, CI basis, transfers, blocks and reports automatically);
// linked investments flip to status "reversed" so every SUM over active
// investments excludes them; dividend-funded payments also restore their
// dividend's ledger. actedBy is the approving user (for the dividend audit
// trail).
func RunSubscriptionReversal(subID uint, actedBy uint) error {
	var sub models.Subscription
	if err := database.DB.First(&sub, subID).Error; err != nil {
		return err
	}
	if sub.Status == "reversed" {
		return nil // already done
	}
	// Re-check at execution time — state may have changed since the request.
	if err := subscriptionReversalGuards(&sub); err != nil {
		return err
	}

	var allocIDs []uint
	database.DB.Model(&models.Allocation{}).
		Where("subscription_id = ?", sub.ID).Pluck("id", &allocIDs)

	var linkedInvIDs []uint
	var dividendFundedIDs []uint
	if len(allocIDs) > 0 {
		database.DB.Model(&models.Investment{}).
			Where("allocation_id IN ? AND status = 'active'", allocIDs).Pluck("id", &linkedInvIDs)
		database.DB.Model(&models.Investment{}).
			Where("allocation_id IN ? AND status = 'active' AND payment_method = 'dividend'", allocIDs).
			Pluck("id", &dividendFundedIDs)
	}

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if len(linkedInvIDs) > 0 {
			// Payments no longer count — everywhere.
			if err := tx.Model(&models.Investment{}).Where("id IN ?", linkedInvIDs).
				Update("status", "reversed").Error; err != nil {
				return err
			}
			// Void any still-pending investment approvals for those payments.
			if err := tx.Model(&models.PendingApproval{}).
				Where("entity_type = 'investment' AND entity_id IN ? AND status = 'pending'", linkedInvIDs).
				Updates(map[string]interface{}{"status": "rejected", "remark": "Subscription reversed"}).Error; err != nil {
				return err
			}
		}
		if len(allocIDs) > 0 {
			// Soft-delete: allocations vanish from all model-based queries.
			if err := tx.Delete(&models.Allocation{}, allocIDs).Error; err != nil {
				return err
			}
		}
		return tx.Model(&models.Subscription{}).Where("id = ?", sub.ID).
			Updates(map[string]interface{}{"status": "reversed", "is_reversal_pending": false}).Error
	})
	if err != nil {
		return err
	}

	// Restore dividend ledgers for dividend-funded payments (idempotent; no-op
	// for anything not sourced from a dividend). Outside the tx — it manages
	// its own writes, mirroring the investment-rejection path.
	for _, invID := range dividendFundedIDs {
		ReverseDividendReinvestForInvestment(invID, actedBy)
	}
	return nil
}

func ExtendSubscription(c *gin.Context) {
	id := c.Param("id")
	var sub models.Subscription
	if err := database.DB.First(&sub, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	// Only allow extension of approved subscriptions
	if sub.ApprovalStatus != "approved" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot extend subscription that has not been approved"})
		return
	}
	if sub.Status == "reversed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot extend a reversed subscription"})
		return
	}

	var input struct {
		NewExpiryDate string `json:"new_expiry_date"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.NewExpiryDate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "New expiry date is required"})
		return
	}

	newDate, err := time.Parse("2006-01-02", input.NewExpiryDate)
	if err != nil {
		// Try ISO format
		newDate, err = time.Parse(time.RFC3339, input.NewExpiryDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid date format. Use YYYY-MM-DD"})
			return
		}
	}

	sub.ExpiryDate = &newDate
	sub.Status = "extended"
	database.DB.Save(&sub)

	// Create approval record for audit trail
	database.DB.Create(&models.PendingApproval{
		EntityType:  "subscription",
		EntityID:    sub.ID,
		Action:      "extend",
		RequestedBy: getUserID(c),
		Status:      "approved",
		RequestedAt: time.Now(),
	})

	c.JSON(http.StatusOK, gin.H{"message": "Subscription extended", "new_expiry_date": newDate.Format("2006-01-02")})
}

// Pre-subscription proportional allocation for all shareholders
func PreSubscribe(c *gin.Context) {
	var input struct {
		ShareAmount float64 `json:"share_amount" binding:"required"`
		ParValue    float64 `json:"par_value" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var shareholders []models.Shareholder
	database.DB.Where("status = ?", "active").Find(&shareholders)

	count := 0
	for _, sh := range shareholders {
		sub := models.Subscription{
			ShareholderID:  sh.ID,
			Type:           "pre-subscription",
			ShareAmount:    input.ShareAmount,
			NumberOfShares: int64(input.ShareAmount / input.ParValue),
			ParValue:       input.ParValue,
			Status:         "active",
			IsProportional: true,
			ApprovalStatus: "pending",
		}
		database.DB.Create(&sub)
		count++
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Pre-subscription created", "count": count})
}

func getUserID(c *gin.Context) uint {
	id, _ := c.Get("user_id")
	if uid, ok := id.(uint); ok {
		return uid
	}
	return 0
}
