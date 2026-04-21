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

// ============================================================
// Shareholder Marketplace Endpoints (Mobile)
// ============================================================

// CreateListing creates a sell listing
func CreateListing(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")

	var req struct {
		NumberOfShares int64   `json:"number_of_shares" binding:"required"`
		PricePerShare  float64 `json:"price_per_share" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Number of shares and price are required"})
		return
	}
	if req.NumberOfShares <= 0 || req.PricePerShare <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Values must be positive"})
		return
	}

	sellerID := shID.(uint)

	// Calculate available shares (total - blocked - already listed)
	var totalShares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", sellerID, "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

	var blockedShares int64
	database.DB.Model(&models.ShareBlock{}).
		Where("shareholder_id = ? AND is_released = ?", sellerID, false).
		Select("COALESCE(SUM(block_shares), 0)").Scan(&blockedShares)

	var listedShares int64
	database.DB.Model(&models.ShareListing{}).
		Where("seller_id = ? AND status = ?", sellerID, "active").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&listedShares)

	available := totalShares - blockedShares - listedShares
	if req.NumberOfShares > available {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     fmt.Sprintf("Insufficient shares. Available: %d", available),
			"available": available,
		})
		return
	}

	listing := models.ShareListing{
		SellerID:       sellerID,
		NumberOfShares: req.NumberOfShares,
		PricePerShare:  req.PricePerShare,
		TotalValue:     float64(req.NumberOfShares) * req.PricePerShare,
		Status:         "active",
	}
	database.DB.Create(&listing)
	database.DB.Preload("Seller").First(&listing, listing.ID)

	c.JSON(http.StatusCreated, gin.H{"data": listing})
}

// GetListings returns all active marketplace listings
func GetListings(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	filter := c.DefaultQuery("filter", "all") // all, my
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}

	query := database.DB.Model(&models.ShareListing{})

	if filter == "my" {
		query = query.Where("seller_id = ?", shID)
	} else {
		query = query.Where("status = ?", "active")
	}

	var total int64
	query.Count(&total)

	var listings []models.ShareListing
	query.Preload("Seller").Order("created_at DESC").
		Offset((page - 1) * 20).Limit(20).Find(&listings)

	c.JSON(http.StatusOK, gin.H{"data": listings, "total": total})
}

// GetListingDetail returns a single listing with seller info
func GetListingDetail(c *gin.Context) {
	id := c.Param("id")
	var listing models.ShareListing
	if err := database.DB.Preload("Seller").First(&listing, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": listing})
}

// CancelListing cancels a seller's own listing
func CancelListing(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	id := c.Param("id")

	var listing models.ShareListing
	if err := database.DB.First(&listing, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}
	if listing.SellerID != shID.(uint) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not your listing"})
		return
	}
	if listing.Status != "active" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only active listings can be cancelled"})
		return
	}

	listing.Status = "cancelled"
	database.DB.Save(&listing)
	c.JSON(http.StatusOK, gin.H{"message": "Listing cancelled"})
}

// BuyShares creates a trade request for a listing
func BuyShares(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	listingID, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	buyerID := shID.(uint)

	var listing models.ShareListing
	if err := database.DB.First(&listing, listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	if listing.Status != "active" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Listing is no longer active"})
		return
	}
	if listing.SellerID == buyerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot buy your own listing"})
		return
	}

	// Check if buyer already has a pending trade for this listing
	var existingTrade models.TradeRequest
	if database.DB.Where("listing_id = ? AND buyer_id = ? AND status = ?", listingID, buyerID, "pending").
		First(&existingTrade).Error == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You already have a pending request for this listing"})
		return
	}

	// Create trade request
	trade := models.TradeRequest{
		ListingID:      uint(listingID),
		SellerID:       listing.SellerID,
		BuyerID:        buyerID,
		NumberOfShares: listing.NumberOfShares,
		PricePerShare:  listing.PricePerShare,
		TotalValue:     listing.TotalValue,
		Status:         "pending",
	}
	database.DB.Create(&trade)

	// Update listing status to pending
	listing.Status = "pending"
	database.DB.Save(&listing)

	// Create PendingApproval for admin
	database.DB.Create(&models.PendingApproval{
		EntityType:  "trade_request",
		EntityID:    trade.ID,
		Action:      "create",
		RequestedBy: buyerID,
		Status:      "pending",
		RequestedAt: time.Now(),
	})

	database.DB.Preload("Listing.Seller").Preload("Seller").Preload("Buyer").First(&trade, trade.ID)
	c.JSON(http.StatusCreated, gin.H{"data": trade})
}

// GetMyTrades returns trade requests involving the shareholder
func GetMyTrades(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var trades []models.TradeRequest
	database.DB.Preload("Listing").Preload("Seller").Preload("Buyer").
		Where("seller_id = ? OR buyer_id = ?", shID, shID).
		Order("created_at DESC").Find(&trades)
	c.JSON(http.StatusOK, gin.H{"data": trades})
}

// GetAvailableShares returns the shareholder's available shares for selling
func GetAvailableShares(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")

	var totalShares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", shID, "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

	var blockedShares int64
	database.DB.Model(&models.ShareBlock{}).
		Where("shareholder_id = ? AND is_released = ?", shID, false).
		Select("COALESCE(SUM(block_shares), 0)").Scan(&blockedShares)

	var listedShares int64
	database.DB.Model(&models.ShareListing{}).
		Where("seller_id = ? AND status = ?", shID, "active").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&listedShares)

	var bankCapital models.BankCapital
	database.DB.First(&bankCapital)

	c.JSON(http.StatusOK, gin.H{
		"total_shares":   totalShares,
		"blocked_shares": blockedShares,
		"listed_shares":  listedShares,
		"available":      totalShares - blockedShares - listedShares,
		"par_value":      bankCapital.ParValuePerShare,
	})
}

// ============================================================
// Admin Marketplace Endpoints
// ============================================================

// GetTradeRequests returns all trade requests for admin
func GetTradeRequests(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")
	var trades []models.TradeRequest
	query := database.DB.Preload("Listing").Preload("Seller").Preload("Buyer")
	if status != "all" {
		query = query.Where("status = ?", status)
	}
	query.Order("created_at DESC").Find(&trades)
	c.JSON(http.StatusOK, gin.H{"data": trades})
}

// GetTradeRequestDetail returns a single trade request with fee preview
func GetTradeRequestDetail(c *gin.Context) {
	id := c.Param("id")
	var trade models.TradeRequest
	if err := database.DB.Preload("Listing").Preload("Seller").Preload("Buyer").First(&trade, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Trade request not found"})
		return
	}

	// Calculate fees using existing system settings
	var bankCapital models.BankCapital
	database.DB.First(&bankCapital)
	parValue := bankCapital.ParValuePerShare

	transferValue := float64(trade.NumberOfShares) * trade.PricePerShare

	cgtRate := getSettingFloat("capital_gain_tax_rate", 15)
	sfRate := getSettingFloat("transfer_service_fee_rate", 1)
	sdRate := getSettingFloat("transfer_stamp_duty_rate", 0.5)
	vatRate := getSettingFloat("transfer_vat_rate", 15)

	capitalGainTax := transferValue * cgtRate / 100
	serviceFee := transferValue * sfRate / 100
	stampDuty := transferValue * sdRate / 100
	vat := serviceFee * vatRate / 100
	totalFees := capitalGainTax + serviceFee + stampDuty + vat

	c.JSON(http.StatusOK, gin.H{
		"data": trade,
		"fees": gin.H{
			"transfer_value":   transferValue,
			"par_value":        parValue,
			"capital_gain_tax": capitalGainTax,
			"service_fee":      serviceFee,
			"stamp_duty":       stampDuty,
			"vat":              vat,
			"total_fees":       totalFees,
			"cgt_rate":         cgtRate,
			"sf_rate":          sfRate,
			"sd_rate":          sdRate,
			"vat_rate":         vatRate,
		},
	})
}

func getSettingFloat(key string, defaultVal float64) float64 {
	var setting models.SystemSetting
	if err := database.DB.Where("`key` = ?", key).First(&setting).Error; err != nil {
		return defaultVal
	}
	val, err := strconv.ParseFloat(setting.Value, 64)
	if err != nil {
		return defaultVal
	}
	return val
}
