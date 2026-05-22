package handlers

import (
	"net/http"
	"strconv"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

// shareholderFieldType maps each searchable column to its semantic type.
// Columns NOT in this map cannot be queried — this is the whitelist that
// keeps the advanced-search endpoint safe from SQL injection via field names.
var shareholderFieldType = map[string]string{
	"id":                 "int",
	"account_no":         "string",
	"first_name":         "string",
	"middle_name":        "string",
	"last_name":          "string",
	"first_name_am":      "string",
	"middle_name_am":     "string",
	"last_name_am":       "string",
	"tin":                "string",
	"national_id_no":     "string",
	"passport_no":        "string",
	"nationality":        "string",
	"nationality_am":     "string",
	"shareholder_type":   "enum",
	"gender":             "enum",
	"status":             "enum",
	"phone":              "string",
	"phone2":             "string",
	"phone3":             "string",
	"email":              "string",
	"email2":             "string",
	"email3":             "string",
	"is_staff":           "bool",
	"is_foreign":         "bool",
	"citizenship_status": "string",
	"date_of_birth":      "date",
	"created_at":         "date",
	"updated_at":         "date",
}

func GetShareholders(c *gin.Context) {
	var shareholders []models.Shareholder
	query := database.DB.Preload("Address")

	// Search filters
	if search := c.Query("search"); search != "" {
		like := "%" + search + "%"
		query = query.Where("first_name LIKE ? OR last_name LIKE ? OR account_no LIKE ? OR tin LIKE ? OR phone LIKE ?",
			like, like, like, like, like)
	}
	if shType := c.Query("type"); shType != "" {
		query = query.Where("shareholder_type = ?", shType)
	}
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if c.Query("is_foreign") == "true" {
		query = query.Where("is_foreign = ?", true)
	}
	if c.Query("is_staff") == "true" {
		query = query.Where("is_staff = ?", true)
	}

	// Pagination
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}

	var total int64
	query.Model(&models.Shareholder{}).Count(&total)

	offset := (page - 1) * pageSize
	query.Offset(offset).Limit(pageSize).Order("id DESC").Find(&shareholders)

	c.JSON(http.StatusOK, gin.H{
		"data":      shareholders,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// SearchShareholdersAdvanced — structured multi-criteria search.
// Delegates the heavy lifting to ApplyAdvancedFilters; this handler just
// owns the per-entity whitelist, the Preload, the Order, and pagination.
func SearchShareholdersAdvanced(c *gin.Context) {
	var input AdvSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	offset := NormalizePaging(&input)

	query := database.DB.Model(&models.Shareholder{}).Preload("Address")
	query = ApplyAdvancedFilters(query, input.Filters, shareholderFieldType)

	var total int64
	query.Count(&total)
	var shareholders []models.Shareholder
	query.Offset(offset).Limit(input.PageSize).Order("id DESC").Find(&shareholders)

	c.JSON(http.StatusOK, gin.H{
		"data":      shareholders,
		"total":     total,
		"page":      input.Page,
		"page_size": input.PageSize,
	})
}

func GetShareholder(c *gin.Context) {
	id := c.Param("id")
	var shareholder models.Shareholder
	if err := database.DB.Preload("Address").Preload("POA").
		Preload("Subscriptions").Preload("Investments").
		Preload("Dividends").Preload("ShareBlocks").
		Preload("Certificates").
		First(&shareholder, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Shareholder not found"})
		return
	}

	// Get aggregate share summary
	var totalInvested float64
	var totalShares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ?", shareholder.ID, "active").
		Select("COALESCE(SUM(amount), 0)").Scan(&totalInvested)
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ?", shareholder.ID, "active").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

	var totalSubscribed float64
	database.DB.Model(&models.Subscription{}).
		Where("shareholder_id = ? AND status = ?", shareholder.ID, "active").
		Select("COALESCE(SUM(share_amount), 0)").Scan(&totalSubscribed)

	var blockedShares int64
	database.DB.Model(&models.ShareBlock{}).
		Where("shareholder_id = ? AND is_released = ?", shareholder.ID, false).
		Select("COALESCE(SUM(block_shares), 0)").Scan(&blockedShares)

	c.JSON(http.StatusOK, gin.H{
		"shareholder": shareholder,
		"summary": gin.H{
			"total_invested":   totalInvested,
			"total_shares":     totalShares,
			"total_subscribed": totalSubscribed,
			"blocked_shares":   blockedShares,
			"available_shares": totalShares - blockedShares,
		},
	})
}

func CreateShareholder(c *gin.Context) {
	var input struct {
		models.Shareholder
		Address *models.ShareholderAddress `json:"address"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check duplicate account
	var exists int64
	database.DB.Model(&models.Shareholder{}).Where("account_no = ?", input.AccountNo).Count(&exists)
	if exists > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Account number already exists"})
		return
	}

	shareholder := input.Shareholder
	if err := database.DB.Create(&shareholder).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create shareholder"})
		return
	}

	if input.Address != nil {
		input.Address.ShareholderID = shareholder.ID
		database.DB.Create(input.Address)
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Shareholder created", "id": shareholder.ID})
}

func UpdateShareholder(c *gin.Context) {
	id := c.Param("id")
	var shareholder models.Shareholder
	if err := database.DB.First(&shareholder, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Shareholder not found"})
		return
	}

	var input struct {
		models.Shareholder
		Address *models.ShareholderAddress `json:"address"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	database.DB.Model(&shareholder).Updates(input.Shareholder)

	if input.Address != nil {
		input.Address.ShareholderID = shareholder.ID
		database.DB.Where("shareholder_id = ?", shareholder.ID).
			Assign(input.Address).
			FirstOrCreate(&models.ShareholderAddress{})
	}

	c.JSON(http.StatusOK, gin.H{"message": "Shareholder updated"})
}

func DeleteShareholder(c *gin.Context) {
	id := c.Param("id")
	database.DB.Delete(&models.Shareholder{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "Shareholder deleted"})
}

func SearchShareholders(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		c.JSON(http.StatusOK, gin.H{"data": []interface{}{}})
		return
	}
	like := "%" + q + "%"
	var shareholders []models.Shareholder
	database.DB.Where("first_name LIKE ? OR last_name LIKE ? OR account_no LIKE ?", like, like, like).
		Limit(20).Find(&shareholders)
	c.JSON(http.StatusOK, gin.H{"data": shareholders})
}

// POA handlers
func CreatePOA(c *gin.Context) {
	shareholderID := c.Param("id")
	var poa models.POA
	if err := c.ShouldBindJSON(&poa); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sid, _ := strconv.ParseUint(shareholderID, 10, 32)
	poa.ShareholderID = uint(sid)
	database.DB.Create(&poa)
	c.JSON(http.StatusCreated, gin.H{"message": "POA created", "id": poa.ID})
}

func UpdatePOA(c *gin.Context) {
	id := c.Param("poaId")
	var poa models.POA
	if err := database.DB.First(&poa, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "POA not found"})
		return
	}
	if err := c.ShouldBindJSON(&poa); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Save(&poa)
	c.JSON(http.StatusOK, gin.H{"message": "POA updated"})
}
