package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

func GetAllocations(c *gin.Context) {
	shareholderID := c.Query("shareholder_id")
	round := c.Query("round")
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

	countQ := database.DB.Model(&models.Allocation{})
	if shareholderID != "" {
		countQ = countQ.Where("shareholder_id = ?", shareholderID)
	}
	if round != "" {
		countQ = countQ.Where("round = ?", round)
	}
	if status != "" {
		countQ = countQ.Where("status = ?", status)
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

	findQ := database.DB.Model(&models.Allocation{})
	if shareholderID != "" {
		findQ = findQ.Where("shareholder_id = ?", shareholderID)
	}
	if round != "" {
		findQ = findQ.Where("round = ?", round)
	}
	if status != "" {
		findQ = findQ.Where("status = ?", status)
	}
	if search != "" {
		if len(searchShIDs) > 0 {
			findQ = findQ.Where("shareholder_id IN ?", searchShIDs)
		} else {
			findQ = findQ.Where("1 = 0")
		}
	}
	var allocations []models.Allocation
	offset := (page - 1) * pageSize
	findQ.Preload("Shareholder").Preload("Subscription").Offset(offset).Limit(pageSize).Order("id DESC").Find(&allocations)

	c.JSON(http.StatusOK, gin.H{"data": allocations, "total": total, "page": page, "page_size": pageSize})
}

func CreateAllocation(c *gin.Context) {
	var alloc models.Allocation
	if err := c.ShouldBindJSON(&alloc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	alloc.ApprovalStatus = "pending"
	database.DB.Create(&alloc)
	c.JSON(http.StatusCreated, gin.H{"message": "Allocation created", "id": alloc.ID})
}

func AllocateFromSubscriptions(c *gin.Context) {
	var input struct {
		Round int `json:"round" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Count subscriptions that are eligible but still pending approval (to surface in the response)
	pendingQuery := database.DB.Model(&models.Subscription{}).
		Where("status IN ? AND approval_status = ?", []string{"active", "extended"}, "pending")
	if input.Round > 1 {
		pendingQuery = pendingQuery.Where("type = ?", "additional")
	}
	var pendingApprovalCount int64
	pendingQuery.Count(&pendingApprovalCount)

	var subs []models.Subscription
	query := database.DB.Where("status IN ? AND approval_status = ?", []string{"active", "extended"}, "approved")
	if input.Round > 1 {
		query = query.Where("type = ?", "additional")
	}
	query.Find(&subs)

	now := time.Now()
	count := 0
	skipped := 0
	for _, sub := range subs {
		// Skip if this subscription was already allocated in this round
		var existingCount int64
		database.DB.Model(&models.Allocation{}).
			Where("subscription_id = ? AND round = ?", sub.ID, input.Round).
			Count(&existingCount)
		if existingCount > 0 {
			skipped++
			continue
		}

		alloc := models.Allocation{
			ShareholderID:   sub.ShareholderID,
			SubscriptionID:  &sub.ID,
			AllocationNo:    fmt.Sprintf("ALLOC-%d-%d", input.Round, sub.ID),
			Round:           input.Round,
			AllocatedShares: sub.NumberOfShares,
			AllocatedAmount: sub.ShareAmount,
			AllocationDate:  &now,
			Status:          "allocated",
			ApprovalStatus:  "pending",
		}
		database.DB.Create(&alloc)
		count++
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":                "Allocation completed",
		"count":                  count,
		"skipped":                skipped,
		"pending_approval_count": pendingApprovalCount,
		"round":                  input.Round,
	})
}

func UpdateAllocation(c *gin.Context) {
	id := c.Param("id")
	var alloc models.Allocation
	if err := database.DB.First(&alloc, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Allocation not found"})
		return
	}
	if err := c.ShouldBindJSON(&alloc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Save(&alloc)
	c.JSON(http.StatusOK, gin.H{"message": "Allocation updated"})
}
