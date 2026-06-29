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

func GetPendingApprovals(c *gin.Context) {
	var approvals []models.PendingApproval
	query := database.DB

	if entityType := c.Query("entity_type"); entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	statusFilter := c.Query("status")
	if statusFilter != "" && statusFilter != "all" {
		query = query.Where("status = ?", statusFilter)
	} else if statusFilter == "" {
		query = query.Where("status = ?", "pending")
	}
	// status=all shows everything

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	var total int64
	query.Model(&models.PendingApproval{}).Count(&total)
	offset := (page - 1) * pageSize
	query.Offset(offset).Limit(pageSize).Order("id DESC").Find(&approvals)

	c.JSON(http.StatusOK, gin.H{"data": approvals, "total": total, "page": page, "page_size": pageSize})
}


func ApproveItem(c *gin.Context) {
	id := c.Param("id")
	var approval models.PendingApproval
	if err := database.DB.First(&approval, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Approval not found"})
		return
	}

	now := time.Now()
	uid := getUserID(c)
	approval.Status = "approved"
	approval.ApprovedBy = &uid
	approval.ProcessedAt = &now
	database.DB.Save(&approval)

	// Update the entity's approval status and run business logic
	switch approval.EntityType {
	case "investment":
		database.DB.Model(&models.Investment{}).Where("id = ?", approval.EntityID).Update("approval_status", "approved")
		// Materialise the Allocation for dividend-reinvest investments so the
		// shareholder formally owns the new shares (no-op for regular cash
		// investments that already link to an existing allocation).
		if err := CreateAllocationForDividendInvestment(approval.EntityID); err != nil {
			fmt.Println("warn: allocation create failed for investment", approval.EntityID, err)
		}
	case "transfer":
		if err := RunTransferApproval(approval.EntityID); err != nil {
			// Revert the pending_approval so it can be retried
			approval.Status = "pending"
			approval.ApprovedBy = nil
			approval.ProcessedAt = nil
			database.DB.Save(&approval)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Transfer approval failed: " + err.Error()})
			return
		}
	case "subscription":
		database.DB.Model(&models.Subscription{}).Where("id = ?", approval.EntityID).Update("approval_status", "approved")
	case "block":
		if approval.Action == "release" {
			if err := RunBlockRelease(approval.EntityID); err != nil {
				approval.Status = "pending"
				approval.ApprovedBy = nil
				approval.ProcessedAt = nil
				database.DB.Save(&approval)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Block release failed: " + err.Error()})
				return
			}
		} else {
			database.DB.Model(&models.ShareBlock{}).Where("id = ?", approval.EntityID).Update("approval_status", "approved")
		}
	case "dividend":
		if approval.Action == "transfer" {
			// Execute the pending dividend transfer. Log a final "transfer"
			// action with the amount that moved hands.
			var div models.Dividend
			if err := database.DB.First(&div, approval.EntityID).Error; err == nil {
				transferAmount := div.GrossDividend - div.ReinvestedAmount - div.CollectedAmount
				database.DB.Model(&models.Dividend{}).Where("id = ?", approval.EntityID).
					Updates(map[string]interface{}{
						"is_transfer_pending": false,
						"is_transferred":      true,
						"status":              "transferred",
					})
				logDividendAction(database.DB, models.DividendAction{
					DividendID:    div.ID,
					ActionType:    "transfer",
					Amount:        transferAmount,
					TaxImpact:     div.TaxAmount,
					Description:   fmt.Sprintf("Transferred to %s (%s) — ETB %.2f", div.TransferTo, div.TransferReason, transferAmount),
					Remark:        div.TransferReason,
					ActedByUserID: uid,
				})
			}
		} else {
			database.DB.Model(&models.Dividend{}).Where("id = ?", approval.EntityID).Update("approval_status", "approved")
		}
	case "trade_request":
		executeTradeApproval(approval.EntityID)
	case "proxy":
		database.DB.Model(&models.AGMProxy{}).Where("id = ?", approval.EntityID).Update("status", "approved")
	case "capital_increase":
		// Approval transitions draft → approved. Admin then clicks Start on the
		// CI detail page to enter round_open and run Round 1.
		database.DB.Model(&models.CapitalIncrease{}).Where("id = ?", approval.EntityID).Update("status", "approved")
	case "shareholder":
		// Edit/delete of a shareholder is held until approved here. Add stays
		// immediate (CreateShareholder doesn't queue an approval).
		if approval.Action == "delete" {
			database.DB.Delete(&models.Shareholder{}, approval.EntityID)
		} else {
			if err := ApplyShareholderUpdate(approval.EntityID, approval.Payload); err != nil {
				approval.Status = "pending"
				approval.ApprovedBy = nil
				approval.ProcessedAt = nil
				database.DB.Save(&approval)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Shareholder update failed: " + err.Error()})
				return
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Item approved"})
}

// executeTradeApproval creates a Transfer from an approved marketplace trade request
func executeTradeApproval(tradeID uint) {
	var trade models.TradeRequest
	if err := database.DB.First(&trade, tradeID).Error; err != nil {
		return
	}

	trade.Status = "approved"
	database.DB.Save(&trade)

	// Get par value
	var bankCapital models.BankCapital
	database.DB.First(&bankCapital)
	parValue := bankCapital.ParValuePerShare

	transferAmount := float64(trade.NumberOfShares) * trade.PricePerShare

	// Calculate fees using system settings
	cgtRate := getTradeSettingFloat("capital_gain_tax_rate", 15)
	sfRate := getTradeSettingFloat("transfer_service_fee_rate", 1)
	sdRate := getTradeSettingFloat("transfer_stamp_duty_rate", 0.5)
	vatRate := getTradeSettingFloat("transfer_vat_rate", 15)

	capitalGainTax := transferAmount * cgtRate / 100
	serviceFee := transferAmount * sfRate / 100
	stampDuty := transferAmount * sdRate / 100
	vat := serviceFee * vatRate / 100
	totalFees := capitalGainTax + serviceFee + stampDuty + vat

	batchNo := fmt.Sprintf("MKT-%d", time.Now().UnixMilli())
	now := time.Now()

	// Create Transfer using the existing transfer model
	transfer := models.Transfer{
		BatchNo:        batchNo,
		TransferorID:   trade.SellerID,
		TransfereeID:   trade.BuyerID,
		TransferType:   "sale",
		TransferDate:   &now,
		NumberOfShares: trade.NumberOfShares,
		ParValue:       parValue,
		TransferAmount: transferAmount,
		CapitalGainTax: capitalGainTax,
		ServiceFee:     serviceFee,
		StampDuty:      stampDuty,
		VAT:            vat,
		TotalFees:      totalFees,
		Status:         "approved",
		ApprovalStatus: "approved",
	}
	database.DB.Create(&transfer)

	// Record service charge (same as admin transfer flow)
	database.DB.Create(&models.ServiceCharge{
		ShareholderID: trade.SellerID,
		ChargeType:    "transfer",
		Amount:        totalFees,
		ReferenceType: "transfer",
		ReferenceID:   transfer.ID,
		ChargeDate:    &now,
		Remark:        "Marketplace sale - " + batchNo,
	})

	// Link transfer to trade request
	trade.TransferID = &transfer.ID
	trade.Status = "completed"
	database.DB.Save(&trade)

	// Update listing status
	database.DB.Model(&models.ShareListing{}).Where("id = ?", trade.ListingID).
		Update("status", "completed")

	// Execute the actual share transfer
	RunTransferApproval(transfer.ID) //nolint:errcheck — trade approvals are fire-and-forget
}

func getTradeSettingFloat(key string, defaultVal float64) float64 {
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

// ApproveByEntity approves a pending approval by entity_type and entity_id
// This allows approving directly from entity pages (e.g. Subscriptions, Investments)
func ApproveByEntity(c *gin.Context) {
	entityType := c.Param("entity_type")
	entityID := c.Param("entity_id")

	var approval models.PendingApproval
	if err := database.DB.Where("entity_type = ? AND entity_id = ? AND status = ?", entityType, entityID, "pending").
		First(&approval).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No pending approval found for this item"})
		return
	}

	now := time.Now()
	uid := getUserID(c)
	approval.Status = "approved"
	approval.ApprovedBy = &uid
	approval.ProcessedAt = &now
	database.DB.Save(&approval)

	// Update the entity's approval status and run business logic
	switch approval.EntityType {
	case "investment":
		database.DB.Model(&models.Investment{}).Where("id = ?", approval.EntityID).Update("approval_status", "approved")
		// Materialise the Allocation for dividend-reinvest investments — see
		// CreateAllocationForDividendInvestment doc for guards.
		if err := CreateAllocationForDividendInvestment(approval.EntityID); err != nil {
			fmt.Println("warn: allocation create failed for investment", approval.EntityID, err)
		}
	case "transfer":
		if err := RunTransferApproval(approval.EntityID); err != nil {
			approval.Status = "pending"
			approval.ApprovedBy = nil
			approval.ProcessedAt = nil
			database.DB.Save(&approval)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Transfer approval failed: " + err.Error()})
			return
		}
	case "subscription":
		database.DB.Model(&models.Subscription{}).Where("id = ?", approval.EntityID).Update("approval_status", "approved")
	case "block":
		if approval.Action == "release" {
			if err := RunBlockRelease(approval.EntityID); err != nil {
				approval.Status = "pending"
				approval.ApprovedBy = nil
				approval.ProcessedAt = nil
				database.DB.Save(&approval)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Block release failed: " + err.Error()})
				return
			}
		} else {
			database.DB.Model(&models.ShareBlock{}).Where("id = ?", approval.EntityID).Update("approval_status", "approved")
		}
	case "dividend":
		if approval.Action == "transfer" {
			// Execute the pending dividend transfer. Log a final "transfer"
			// action with the amount that moved hands.
			var div models.Dividend
			if err := database.DB.First(&div, approval.EntityID).Error; err == nil {
				transferAmount := div.GrossDividend - div.ReinvestedAmount - div.CollectedAmount
				database.DB.Model(&models.Dividend{}).Where("id = ?", approval.EntityID).
					Updates(map[string]interface{}{
						"is_transfer_pending": false,
						"is_transferred":      true,
						"status":              "transferred",
					})
				logDividendAction(database.DB, models.DividendAction{
					DividendID:    div.ID,
					ActionType:    "transfer",
					Amount:        transferAmount,
					TaxImpact:     div.TaxAmount,
					Description:   fmt.Sprintf("Transferred to %s (%s) — ETB %.2f", div.TransferTo, div.TransferReason, transferAmount),
					Remark:        div.TransferReason,
					ActedByUserID: uid,
				})
			}
		} else {
			database.DB.Model(&models.Dividend{}).Where("id = ?", approval.EntityID).Update("approval_status", "approved")
		}
	case "trade_request":
		executeTradeApproval(approval.EntityID)
	case "proxy":
		database.DB.Model(&models.AGMProxy{}).Where("id = ?", approval.EntityID).Update("status", "approved")
	case "capital_increase":
		database.DB.Model(&models.CapitalIncrease{}).Where("id = ?", approval.EntityID).Update("status", "approved")
	case "shareholder":
		if approval.Action == "delete" {
			database.DB.Delete(&models.Shareholder{}, approval.EntityID)
		} else {
			if err := ApplyShareholderUpdate(approval.EntityID, approval.Payload); err != nil {
				approval.Status = "pending"
				approval.ApprovedBy = nil
				approval.ProcessedAt = nil
				database.DB.Save(&approval)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Shareholder update failed: " + err.Error()})
				return
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Item approved"})
}

// RejectByEntity rejects a pending approval by entity_type and entity_id
func RejectByEntity(c *gin.Context) {
	entityType := c.Param("entity_type")
	entityID := c.Param("entity_id")

	var input struct {
		Remark string `json:"remark"`
	}
	c.ShouldBindJSON(&input)

	var approval models.PendingApproval
	if err := database.DB.Where("entity_type = ? AND entity_id = ? AND status = ?", entityType, entityID, "pending").
		First(&approval).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No pending approval found for this item"})
		return
	}

	now := time.Now()
	uid := getUserID(c)
	approval.Status = "rejected"
	approval.ApprovedBy = &uid
	approval.ProcessedAt = &now
	approval.Remark = input.Remark
	database.DB.Save(&approval)

	// Update entity — write both the status flip AND the rejection reason,
	// so list pages can show "Rejected — <reason>" without joining PendingApproval.
	rejUpdate := map[string]interface{}{"approval_status": "rejected", "rejection_reason": input.Remark}
	rejStatusUpdate := map[string]interface{}{"status": "rejected", "rejection_reason": input.Remark}
	switch approval.EntityType {
	case "investment":
		database.DB.Model(&models.Investment{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
		// If this investment was sourced from a dividend reinvestment, reverse
		// the dividend's reinvested_amount / tax / net / uncollected so the
		// dividend is collectible again. No-op for normal investments.
		ReverseDividendReinvestForInvestment(approval.EntityID, uid)
	case "transfer":
		database.DB.Model(&models.Transfer{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
	case "subscription":
		database.DB.Model(&models.Subscription{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
	case "block":
		if approval.Action == "release" {
			// Release rejected — the block stays active; just clear the flag.
			database.DB.Model(&models.ShareBlock{}).Where("id = ?", approval.EntityID).Update("is_release_pending", false)
		} else {
			database.DB.Model(&models.ShareBlock{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
		}
	case "dividend":
		if approval.Action == "transfer" {
			// Clear the pending transfer state; the dividend stays in its
			// current ledger position. Log the rejection so the operator
			// sees it in the action history.
			database.DB.Model(&models.Dividend{}).Where("id = ?", approval.EntityID).
				Updates(map[string]interface{}{
					"is_transfer_pending": false,
					"transfer_to":         "",
					"transfer_reason":     "",
				})
			logDividendAction(database.DB, models.DividendAction{
				DividendID:    approval.EntityID,
				ActionType:    "transfer_rejected",
				Description:   "Transfer request rejected: " + input.Remark,
				Remark:        input.Remark,
				ActedByUserID: uid,
			})
		} else {
			database.DB.Model(&models.Dividend{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
		}
	case "trade_request":
		database.DB.Model(&models.TradeRequest{}).Where("id = ?", approval.EntityID).Updates(rejStatusUpdate)
		var rejTrade models.TradeRequest
		if database.DB.First(&rejTrade, approval.EntityID).Error == nil {
			database.DB.Model(&models.ShareListing{}).Where("id = ?", rejTrade.ListingID).Update("status", "active")
		}
	case "proxy":
		database.DB.Model(&models.AGMProxy{}).Where("id = ?", approval.EntityID).Updates(rejStatusUpdate)
	case "capital_increase":
		// Reject keeps the CI row but marks status=rejected so admin can either
		// delete it or open a new campaign. No business action to undo.
		database.DB.Model(&models.CapitalIncrease{}).Where("id = ?", approval.EntityID).
			Updates(map[string]interface{}{"status": "rejected", "remark": input.Remark})
	}

	c.JSON(http.StatusOK, gin.H{"message": "Item rejected"})
}

func RejectItem(c *gin.Context) {
	id := c.Param("id")
	var input struct {
		Remark string `json:"remark"`
	}
	c.ShouldBindJSON(&input)

	var approval models.PendingApproval
	if err := database.DB.First(&approval, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Approval not found"})
		return
	}

	now := time.Now()
	uid := getUserID(c)
	approval.Status = "rejected"
	approval.ApprovedBy = &uid
	approval.ProcessedAt = &now
	approval.Remark = input.Remark
	database.DB.Save(&approval)

	// Update entity — same pattern as RejectByEntity: write status + reason
	// onto the entity itself so the list views can render the rejection reason
	// without joining PendingApproval.
	rejUpdate := map[string]interface{}{"approval_status": "rejected", "rejection_reason": input.Remark}
	rejStatusUpdate := map[string]interface{}{"status": "rejected", "rejection_reason": input.Remark}
	switch approval.EntityType {
	case "investment":
		database.DB.Model(&models.Investment{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
		// Compensating action: if this investment was sourced from a dividend
		// reinvestment, reverse the dividend's reinvested_amount / tax / net /
		// uncollected so the dividend is collectible again and a fresh
		// Subscribe action can be taken.
		ReverseDividendReinvestForInvestment(approval.EntityID, uid)
	case "transfer":
		database.DB.Model(&models.Transfer{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
	case "subscription":
		database.DB.Model(&models.Subscription{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
	case "block":
		if approval.Action == "release" {
			// Release rejected — the block stays active; just clear the flag.
			database.DB.Model(&models.ShareBlock{}).Where("id = ?", approval.EntityID).Update("is_release_pending", false)
		} else {
			database.DB.Model(&models.ShareBlock{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
		}
	case "dividend":
		if approval.Action == "transfer" {
			// Clear the pending transfer state; the dividend stays in its
			// current ledger position. Log the rejection so the operator
			// sees it in the action history.
			database.DB.Model(&models.Dividend{}).Where("id = ?", approval.EntityID).
				Updates(map[string]interface{}{
					"is_transfer_pending": false,
					"transfer_to":         "",
					"transfer_reason":     "",
				})
			logDividendAction(database.DB, models.DividendAction{
				DividendID:    approval.EntityID,
				ActionType:    "transfer_rejected",
				Description:   "Transfer request rejected: " + input.Remark,
				Remark:        input.Remark,
				ActedByUserID: uid,
			})
		} else {
			database.DB.Model(&models.Dividend{}).Where("id = ?", approval.EntityID).Updates(rejUpdate)
		}
	case "trade_request":
		database.DB.Model(&models.TradeRequest{}).Where("id = ?", approval.EntityID).Updates(rejStatusUpdate)
		var rejTrade models.TradeRequest
		if database.DB.First(&rejTrade, approval.EntityID).Error == nil {
			database.DB.Model(&models.ShareListing{}).Where("id = ?", rejTrade.ListingID).Update("status", "active")
		}
	case "proxy":
		database.DB.Model(&models.AGMProxy{}).Where("id = ?", approval.EntityID).Updates(rejStatusUpdate)
	case "capital_increase":
		// Reject keeps the CI row but marks status=rejected so admin can either
		// delete it or open a new campaign. No business action to undo.
		database.DB.Model(&models.CapitalIncrease{}).Where("id = ?", approval.EntityID).
			Updates(map[string]interface{}{"status": "rejected", "remark": input.Remark})
	}

	c.JSON(http.StatusOK, gin.H{"message": "Item rejected"})
}
