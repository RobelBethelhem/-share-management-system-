package handlers

import (
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
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

func ReverseSubscription(c *gin.Context) {
	id := c.Param("id")
	var sub models.Subscription
	if err := database.DB.First(&sub, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	// Only allow reversal of approved, active subscriptions
	if sub.ApprovalStatus != "approved" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot reverse subscription that has not been approved yet"})
		return
	}
	if sub.Status != "active" && sub.Status != "extended" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only active or extended subscriptions can be reversed"})
		return
	}

	sub.Status = "reversed"
	database.DB.Save(&sub)

	// Create approval record for audit trail
	database.DB.Create(&models.PendingApproval{
		EntityType:  "subscription",
		EntityID:    sub.ID,
		Action:      "reverse",
		RequestedBy: getUserID(c),
		Status:      "approved",
		RequestedAt: time.Now(),
	})

	c.JSON(http.StatusOK, gin.H{"message": "Subscription reversed"})
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
