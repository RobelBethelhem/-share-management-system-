package handlers

import (
	"fmt"
	"net/http"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/middleware"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// ShareholderLogin authenticates shareholders using account_no + phone
func ShareholderLogin(c *gin.Context) {
	var req struct {
		AccountNo string `json:"account_no" binding:"required"`
		Phone     string `json:"phone" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Account number and phone are required"})
		return
	}

	var shareholder models.Shareholder
	if err := database.DB.Where("account_no = ? AND phone = ?", req.AccountNo, req.Phone).First(&shareholder).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid account number or phone"})
		return
	}

	if shareholder.Status == "dormant" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Your account is dormant. Please contact the bank."})
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"shareholder_id": shareholder.ID,
		"account_no":     shareholder.AccountNo,
		"role":           "shareholder",
		"exp":            time.Now().Add(7 * 24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString(middleware.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": tokenString,
		"shareholder": gin.H{
			"id":               shareholder.ID,
			"account_no":       shareholder.AccountNo,
			"first_name":       shareholder.FirstName,
			"middle_name":      shareholder.MiddleName,
			"last_name":        shareholder.LastName,
			"phone":            shareholder.Phone,
			"email":            shareholder.Email,
			"shareholder_type": shareholder.ShareholderType,
			"status":           shareholder.Status,
		},
	})
}

// ShareholderProfile returns full profile of the logged-in shareholder
func ShareholderProfile(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var shareholder models.Shareholder
	database.DB.Preload("Address").First(&shareholder, shID)

	c.JSON(http.StatusOK, gin.H{
		"id":                shareholder.ID,
		"account_no":        shareholder.AccountNo,
		"first_name":        shareholder.FirstName,
		"middle_name":       shareholder.MiddleName,
		"last_name":         shareholder.LastName,
		"phone":             shareholder.Phone,
		"email":             shareholder.Email,
		"shareholder_type":  shareholder.ShareholderType,
		"gender":            shareholder.Gender,
		"nationality":       shareholder.Nationality,
		"status":            shareholder.Status,
		"tin":               shareholder.TIN,
		"date_of_birth":     shareholder.DateOfBirth,
		"citizenship_status": shareholder.CitizenshipStatus,
		"address":           shareholder.Address,
		"created_at":        shareholder.CreatedAt,
	})
}

// ShareholderDashboard returns summary stats for the shareholder
func ShareholderDashboard(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")

	var shareholder models.Shareholder
	database.DB.First(&shareholder, shID)

	// Total shares and invested
	var totalShares int64
	var totalInvested float64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", shID, "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", shID, "active", "approved").
		Select("COALESCE(SUM(amount), 0)").Scan(&totalInvested)

	// Blocked shares
	var blockedShares int64
	database.DB.Model(&models.ShareBlock{}).
		Where("shareholder_id = ? AND is_released = ?", shID, false).
		Select("COALESCE(SUM(block_shares), 0)").Scan(&blockedShares)

	// Total dividends
	var totalDividendNet float64
	var totalCollected float64
	var totalUncollected float64
	database.DB.Model(&models.Dividend{}).
		Where("shareholder_id = ?", shID).
		Select("COALESCE(SUM(net_dividend), 0)").Scan(&totalDividendNet)
	database.DB.Model(&models.Dividend{}).
		Where("shareholder_id = ?", shID).
		Select("COALESCE(SUM(collected_amount), 0)").Scan(&totalCollected)
	database.DB.Model(&models.Dividend{}).
		Where("shareholder_id = ?", shID).
		Select("COALESCE(SUM(uncollected_amount), 0)").Scan(&totalUncollected)

	// Certificates count
	var certCount int64
	database.DB.Model(&models.Certificate{}).Where("shareholder_id = ?", shID).Count(&certCount)

	// Par value
	var bankCapital models.BankCapital
	database.DB.First(&bankCapital)

	// Total company shares for ownership percentage
	var totalCompanyShares int64
	database.DB.Model(&models.Investment{}).
		Where("status = ? AND approval_status = ?", "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalCompanyShares)

	ownershipPct := float64(0)
	if totalCompanyShares > 0 {
		ownershipPct = float64(totalShares) * 100 / float64(totalCompanyShares)
	}

	// Recent investments (last 5)
	var recentInvestments []models.Investment
	database.DB.Where("shareholder_id = ? AND status = ?", shID, "active").
		Order("payment_date DESC").Limit(5).Find(&recentInvestments)

	// Recent dividends
	var recentDividends []models.Dividend
	database.DB.Where("shareholder_id = ?", shID).
		Order("fiscal_year DESC").Limit(5).Find(&recentDividends)

	c.JSON(http.StatusOK, gin.H{
		"shareholder": gin.H{
			"id":         shareholder.ID,
			"account_no": shareholder.AccountNo,
			"first_name": shareholder.FirstName,
			"last_name":  shareholder.LastName,
			"full_name":  shareholder.GetFullName(),
		},
		"total_shares":        totalShares,
		"total_invested":      totalInvested,
		"blocked_shares":      blockedShares,
		"free_shares":         totalShares - blockedShares,
		"par_value":           bankCapital.ParValuePerShare,
		"share_value":         float64(totalShares) * bankCapital.ParValuePerShare,
		"ownership_pct":       ownershipPct,
		"total_dividend_net":  totalDividendNet,
		"total_collected":     totalCollected,
		"total_uncollected":   totalUncollected,
		"certificates":        certCount,
		"recent_investments":  recentInvestments,
		"recent_dividends":    recentDividends,
	})
}

// ShareholderInvestments returns all investments for the shareholder
func ShareholderInvestments(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var investments []models.Investment
	database.DB.Where("shareholder_id = ? AND status = ?", shID, "active").
		Order("payment_date DESC").Find(&investments)

	var totalAmount float64
	var totalShares int64
	for _, inv := range investments {
		totalAmount += inv.Amount
		totalShares += inv.NumberOfShares
	}

	c.JSON(http.StatusOK, gin.H{
		"data":         investments,
		"total":        len(investments),
		"total_amount": totalAmount,
		"total_shares": totalShares,
	})
}

// ShareholderDividends returns all dividends for the shareholder
func ShareholderDividends(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var dividends []models.Dividend
	database.DB.Preload("DividendSetting").
		Where("shareholder_id = ?", shID).
		Order("fiscal_year DESC").Find(&dividends)

	var totalGross, totalTax, totalNet, totalCollected, totalUncollected float64
	for _, d := range dividends {
		totalGross += d.GrossDividend
		totalTax += d.TaxAmount
		totalNet += d.NetDividend
		totalCollected += d.CollectedAmount
		totalUncollected += d.UncollectedAmount
	}

	c.JSON(http.StatusOK, gin.H{
		"data":              dividends,
		"total":             len(dividends),
		"total_gross":       totalGross,
		"total_tax":         totalTax,
		"total_net":         totalNet,
		"total_collected":   totalCollected,
		"total_uncollected": totalUncollected,
	})
}

// ShareholderTransfers returns transfers involving the shareholder
func ShareholderTransfers(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var transfers []models.Transfer
	database.DB.Preload("Transferor").Preload("Transferee").
		Where("transferor_id = ? OR transferee_id = ?", shID, shID).
		Order("transfer_date DESC").Find(&transfers)

	c.JSON(http.StatusOK, gin.H{"data": transfers, "total": len(transfers)})
}

// ShareholderCertificates returns certificates for the shareholder
func ShareholderCertificates(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var certs []models.Certificate
	database.DB.Preload("Shareholder").Where("shareholder_id = ?", shID).Order("id DESC").Find(&certs)
	c.JSON(http.StatusOK, gin.H{"data": certs, "total": len(certs)})
}

// ShareholderBlocks returns share blocks for the shareholder
func ShareholderBlocks(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var blocks []models.ShareBlock
	database.DB.Where("shareholder_id = ?", shID).Order("id DESC").Find(&blocks)
	c.JSON(http.StatusOK, gin.H{"data": blocks, "total": len(blocks)})
}

// SetupPin creates or replaces a device binding with a hashed PIN
func SetupPin(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")

	var req struct {
		Pin        string `json:"pin" binding:"required"`
		DeviceID   string `json:"device_id" binding:"required"`
		DeviceName string `json:"device_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "PIN and device ID are required"})
		return
	}

	if len(req.Pin) != 4 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "PIN must be exactly 4 digits"})
		return
	}
	for _, ch := range req.Pin {
		if ch < '0' || ch > '9' {
			c.JSON(http.StatusBadRequest, gin.H{"error": "PIN must contain only digits"})
			return
		}
	}

	hashedPin, err := bcrypt.GenerateFromPassword([]byte(req.Pin), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to secure PIN"})
		return
	}

	// Remove any existing binding for this device
	database.DB.Where("device_id = ?", req.DeviceID).Delete(&models.DeviceBinding{})

	binding := models.DeviceBinding{
		ShareholderID: shID.(uint),
		DeviceID:      req.DeviceID,
		PinHash:       string(hashedPin),
		DeviceName:    req.DeviceName,
	}
	if err := database.DB.Create(&binding).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to bind device"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "PIN set successfully"})
}

// PinLogin authenticates a shareholder using device_id + PIN
func PinLogin(c *gin.Context) {
	var req struct {
		Pin      string `json:"pin" binding:"required"`
		DeviceID string `json:"device_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "PIN and device ID are required"})
		return
	}

	var binding models.DeviceBinding
	if err := database.DB.Where("device_id = ?", req.DeviceID).First(&binding).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Device not registered. Please login with your credentials."})
		return
	}

	if binding.IsLocked {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Too many failed attempts. Please login with your credentials to reset your PIN.", "locked": true})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(binding.PinHash), []byte(req.Pin)); err != nil {
		binding.FailedAttempts++
		if binding.FailedAttempts >= 5 {
			binding.IsLocked = true
		}
		database.DB.Save(&binding)

		if binding.IsLocked {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Too many failed attempts. Please login with your credentials to reset your PIN.", "locked": true})
		} else {
			remaining := 5 - binding.FailedAttempts
			c.JSON(http.StatusUnauthorized, gin.H{"error": fmt.Sprintf("Invalid PIN. %d attempts remaining.", remaining)})
		}
		return
	}

	// Reset failed attempts on success
	if binding.FailedAttempts > 0 {
		binding.FailedAttempts = 0
		database.DB.Save(&binding)
	}

	// Load shareholder
	var shareholder models.Shareholder
	if err := database.DB.First(&shareholder, binding.ShareholderID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Shareholder not found"})
		return
	}

	if shareholder.Status == "dormant" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Your account is dormant. Please contact the bank."})
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"shareholder_id": shareholder.ID,
		"account_no":     shareholder.AccountNo,
		"role":           "shareholder",
		"exp":            time.Now().Add(7 * 24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString(middleware.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": tokenString,
		"shareholder": gin.H{
			"id":               shareholder.ID,
			"account_no":       shareholder.AccountNo,
			"first_name":       shareholder.FirstName,
			"middle_name":      shareholder.MiddleName,
			"last_name":        shareholder.LastName,
			"phone":            shareholder.Phone,
			"email":            shareholder.Email,
			"shareholder_type": shareholder.ShareholderType,
			"status":           shareholder.Status,
		},
	})
}
