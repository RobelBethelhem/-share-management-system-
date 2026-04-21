package handlers

import (
	"net/http"
	"strconv"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

func GetAGMAttendance(c *gin.Context) {
	var records []models.AGMAttendance
	query := database.DB.Preload("Shareholder")

	if year := c.Query("year"); year != "" {
		query = query.Where("agm_year = ?", year)
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	var total int64
	query.Model(&models.AGMAttendance{}).Count(&total)
	offset := (page - 1) * pageSize
	query.Offset(offset).Limit(pageSize).Order("id DESC").Find(&records)

	// Summary — if year filter is empty, summarize all records
	var totalPresent int64
	var totalVotingPower float64
	summaryQuery := database.DB.Model(&models.AGMAttendance{}).Where("is_present = ?", true)
	if year := c.Query("year"); year != "" {
		summaryQuery = summaryQuery.Where("agm_year = ?", year)
	}
	summaryQuery.Count(&totalPresent)
	summaryQuery.Select("COALESCE(SUM(voting_power), 0)").Scan(&totalVotingPower)

	c.JSON(http.StatusOK, gin.H{
		"data":               records,
		"total":              total,
		"page":               page,
		"page_size":          pageSize,
		"total_present":      totalPresent,
		"total_voting_power": totalVotingPower,
	})
}

func CreateAGMAttendance(c *gin.Context) {
	var record models.AGMAttendance
	if err := c.ShouldBindJSON(&record); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get shareholder's approved active shares
	var totalShares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", record.ShareholderID, "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)
	record.NumberOfShares = totalShares

	// Always mark as present (they're being recorded as attending)
	record.IsPresent = true

	// Calculate voting power = shareholder's shares / total company shares
	var totalCompanyShares int64
	database.DB.Model(&models.Investment{}).
		Where("status = ? AND approval_status = ?", "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalCompanyShares)
	if totalCompanyShares > 0 {
		record.VotingPower = float64(totalShares) / float64(totalCompanyShares)
	}

	database.DB.Create(&record)
	c.JSON(http.StatusCreated, gin.H{"message": "AGM attendance recorded", "id": record.ID})
}

func BulkCreateAGMAttendance(c *gin.Context) {
	var records []models.AGMAttendance
	if err := c.ShouldBindJSON(&records); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for i := range records {
		var totalShares int64
		database.DB.Model(&models.Investment{}).
			Where("shareholder_id = ? AND status = ?", records[i].ShareholderID, "active").
			Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)
		records[i].NumberOfShares = totalShares
	}
	database.DB.Create(&records)
	c.JSON(http.StatusCreated, gin.H{"message": "AGM attendance recorded", "count": len(records)})
}
