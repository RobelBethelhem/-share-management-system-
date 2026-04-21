package handlers

import (
	"fmt"
	"net/http"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

func GetSystemSettings(c *gin.Context) {
	var settings []models.SystemSetting
	database.DB.Find(&settings)
	c.JSON(http.StatusOK, gin.H{"data": settings})
}

func GetSystemSetting(c *gin.Context) {
	key := c.Param("key")
	var setting models.SystemSetting
	if err := database.DB.Where("`key` = ?", key).First(&setting).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Setting not found"})
		return
	}
	c.JSON(http.StatusOK, setting)
}

func UpdateSystemSetting(c *gin.Context) {
	key := c.Param("key")
	var input struct {
		Value       string `json:"value" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var setting models.SystemSetting
	result := database.DB.Where("`key` = ?", key).First(&setting)
	if result.Error != nil {
		setting = models.SystemSetting{
			Key:         key,
			Value:       input.Value,
			Description: input.Description,
		}
		database.DB.Create(&setting)
	} else {
		setting.Value = input.Value
		if input.Description != "" {
			setting.Description = input.Description
		}
		database.DB.Save(&setting)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Setting updated", "setting": setting})
}

func CreateSystemSetting(c *gin.Context) {
	var input struct {
		Key         string `json:"key" binding:"required"`
		Value       string `json:"value" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if key already exists
	var count int64
	database.DB.Model(&models.SystemSetting{}).Where("`key` = ?", input.Key).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Setting with this key already exists"})
		return
	}

	setting := models.SystemSetting{
		Key:         input.Key,
		Value:       input.Value,
		Description: input.Description,
	}
	database.DB.Create(&setting)
	c.JSON(http.StatusCreated, gin.H{"message": "Setting created", "setting": setting})
}

func DeleteSystemSetting(c *gin.Context) {
	key := c.Param("key")
	result := database.DB.Where("`key` = ?", key).Delete(&models.SystemSetting{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Setting not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Setting deleted"})
}

// BankCapital endpoints
// calculatePaidUpCapital computes paid-up capital from actual approved investments
func calculatePaidUpCapital() float64 {
	var total float64
	database.DB.Model(&models.Investment{}).
		Where("approval_status = ? AND status = ?", "approved", "active").
		Select("COALESCE(SUM(amount), 0)").Scan(&total)
	return total
}

func GetBankCapital(c *gin.Context) {
	var bc models.BankCapital
	if err := database.DB.Order("id DESC").First(&bc).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"data": nil})
		return
	}

	// Override paid_up_capital with actual calculated value from investments
	bc.PaidUpCapital = calculatePaidUpCapital()

	c.JSON(http.StatusOK, gin.H{"data": bc})
}

func UpdateBankCapital(c *gin.Context) {
	var input struct {
		AuthorizedCapital float64 `json:"authorized_capital"`
		ParValuePerShare  float64 `json:"par_value_per_share"`
		TotalShares       int64   `json:"total_shares"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validation: par_value × total_shares must not exceed authorized_capital
	totalParValue := input.ParValuePerShare * float64(input.TotalShares)
	if totalParValue > input.AuthorizedCapital {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Par Value (%.0f) × Total Shares (%d) = %.0f Birr exceeds Authorized Capital (%.0f Birr)",
				input.ParValuePerShare, input.TotalShares, totalParValue, input.AuthorizedCapital),
		})
		return
	}

	// Calculate actual paid-up capital from investments
	paidUpCapital := calculatePaidUpCapital()

	var bc models.BankCapital
	if err := database.DB.Order("id DESC").First(&bc).Error; err != nil {
		bc = models.BankCapital{
			AuthorizedCapital: input.AuthorizedCapital,
			PaidUpCapital:     paidUpCapital,
			ParValuePerShare:  input.ParValuePerShare,
			TotalShares:       input.TotalShares,
		}
		database.DB.Create(&bc)
	} else {
		bc.AuthorizedCapital = input.AuthorizedCapital
		bc.PaidUpCapital = paidUpCapital
		bc.ParValuePerShare = input.ParValuePerShare
		bc.TotalShares = input.TotalShares
		database.DB.Save(&bc)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Bank capital updated", "data": bc})
}

// TestFormula allows admin to test a formula with sample values
func TestFormula(c *gin.Context) {
	var input struct {
		Formula string             `json:"formula" binding:"required"`
		Vars    map[string]float64 `json:"vars" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := EvaluateFormula(input.Formula, input.Vars)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Formula error: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"formula": input.Formula,
		"vars":    input.Vars,
		"result":  result,
	})
}
