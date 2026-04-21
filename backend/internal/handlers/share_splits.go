package handlers

import (
	"fmt"
	"net/http"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

func GetShareSplits(c *gin.Context) {
	var splits []models.ShareSplit
	database.DB.Order("id DESC").Find(&splits)
	c.JSON(http.StatusOK, gin.H{"data": splits})
}

func CreateShareSplit(c *gin.Context) {
	var split models.ShareSplit
	if err := c.ShouldBindJSON(&split); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Create(&split)
	c.JSON(http.StatusCreated, gin.H{"message": "Share split created", "id": split.ID})
}

func UpdateShareSplit(c *gin.Context) {
	id := c.Param("id")
	var split models.ShareSplit
	if err := database.DB.First(&split, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share split not found"})
		return
	}
	if split.Status == "processed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot edit a processed share split"})
		return
	}
	if err := c.ShouldBindJSON(&split); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Save(&split)
	c.JSON(http.StatusOK, gin.H{"message": "Share split updated"})
}

func ProcessShareSplit(c *gin.Context) {
	id := c.Param("id")
	var split models.ShareSplit
	if err := database.DB.First(&split, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share split not found"})
		return
	}

	if split.Status == "processed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Share split already processed"})
		return
	}

	if split.OldParValue <= 0 || split.NewParValue <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Old and new par values must be positive"})
		return
	}

	// Parse the ratio (e.g., "2:1" means each old share becomes 2 new shares)
	var ratioNum, ratioDen int
	_, err := fmt.Sscanf(split.SplitRatio, "%d:%d", &ratioNum, &ratioDen)
	if err != nil || ratioNum <= 0 || ratioDen <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid split ratio format. Use N:M (e.g., 2:1)"})
		return
	}

	multiplier := float64(ratioNum) / float64(ratioDen)

	// Update all active investments: multiply shares, update par value
	var investments []models.Investment
	database.DB.Where("status = ?", "active").Find(&investments)

	updatedCount := 0
	for _, inv := range investments {
		newShares := int64(float64(inv.NumberOfShares) * multiplier)
		database.DB.Model(&inv).Updates(map[string]interface{}{
			"number_of_shares": newShares,
			"par_value":        split.NewParValue,
		})
		updatedCount++
	}

	// Update subscriptions
	var subs []models.Subscription
	database.DB.Where("status = ?", "active").Find(&subs)
	for _, sub := range subs {
		newShares := int64(float64(sub.NumberOfShares) * multiplier)
		database.DB.Model(&sub).Updates(map[string]interface{}{
			"number_of_shares": newShares,
			"par_value":        split.NewParValue,
		})
	}

	// Update BankCapital
	var bc models.BankCapital
	if err := database.DB.First(&bc).Error; err == nil {
		newTotalShares := int64(float64(bc.TotalShares) * multiplier)
		database.DB.Model(&bc).Updates(map[string]interface{}{
			"par_value_per_share": split.NewParValue,
			"total_shares":       newTotalShares,
		})
	}

	// Mark as processed
	now := time.Now()
	split.Status = "processed"
	split.ProcessedAt = &now
	database.DB.Save(&split)

	c.JSON(http.StatusOK, gin.H{
		"message":              "Share split processed successfully",
		"investments_updated":  updatedCount,
		"subscriptions_updated": len(subs),
		"split_multiplier":    multiplier,
	})
}
