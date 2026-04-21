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

func GetShareBlocks(c *gin.Context) {
	var blocks []models.ShareBlock
	query := database.DB.Preload("Shareholder").Preload("Allocation")

	if shareholderID := c.Query("shareholder_id"); shareholderID != "" {
		query = query.Where("shareholder_id = ?", shareholderID)
	}
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if isReleased := c.Query("is_released"); isReleased != "" {
		query = query.Where("is_released = ?", isReleased == "true")
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	var total int64
	query.Model(&models.ShareBlock{}).Count(&total)
	offset := (page - 1) * pageSize
	query.Offset(offset).Limit(pageSize).Order("id DESC").Find(&blocks)

	// Safety net: manually load allocation if preload missed it
	for i := range blocks {
		if blocks[i].AllocationID != nil && blocks[i].Allocation == nil {
			var alloc models.Allocation
			if database.DB.First(&alloc, *blocks[i].AllocationID).Error == nil {
				blocks[i].Allocation = &alloc
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": blocks, "total": total, "page": page, "page_size": pageSize})
}

func GetShareBlock(c *gin.Context) {
	id := c.Param("id")
	var block models.ShareBlock
	if err := database.DB.Preload("Shareholder").Preload("Allocation").First(&block, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share block not found"})
		return
	}

	var previousBlocks []models.ShareBlock
	database.DB.Where("shareholder_id = ? AND id != ?", block.ShareholderID, block.ID).Find(&previousBlocks)

	c.JSON(http.StatusOK, gin.H{
		"block":           block,
		"previous_blocks": previousBlocks,
	})
}

// getEffectivePaidBlocked returns the total paid shares locked by active blocks on an allocation.
// Includes "paid" type blocks (full block_shares) and the paid portion of "both" type blocks.
func getEffectivePaidBlocked(allocID uint) int64 {
	var paidTypeBlocked int64
	database.DB.Model(&models.ShareBlock{}).
		Where("allocation_id = ? AND shares_type = 'paid' AND is_released = ?", allocID, false).
		Select("COALESCE(SUM(block_shares), 0)").Scan(&paidTypeBlocked)

	var bothPaidPortion int64
	database.DB.Model(&models.ShareBlock{}).
		Where("allocation_id = ? AND shares_type = 'both' AND is_released = ?", allocID, false).
		Select("COALESCE(SUM(paid_shares_to_block), 0)").Scan(&bothPaidPortion)

	return paidTypeBlocked + bothPaidPortion
}

// getEffectiveUnpaidBlocked returns the total unpaid shares locked by active blocks on an allocation.
// Includes "unpaid" type blocks (full block_shares) and the unpaid portion of "both" type blocks.
func getEffectiveUnpaidBlocked(allocID uint) int64 {
	var unpaidTypeBlocked int64
	database.DB.Model(&models.ShareBlock{}).
		Where("allocation_id = ? AND shares_type = 'unpaid' AND is_released = ?", allocID, false).
		Select("COALESCE(SUM(block_shares), 0)").Scan(&unpaidTypeBlocked)

	var bothUnpaidPortion int64
	database.DB.Model(&models.ShareBlock{}).
		Where("allocation_id = ? AND shares_type = 'both' AND is_released = ?", allocID, false).
		Select("COALESCE(SUM(unpaid_shares_to_block), 0)").Scan(&bothUnpaidPortion)

	return unpaidTypeBlocked + bothUnpaidPortion
}

func CreateShareBlock(c *gin.Context) {
	var block models.ShareBlock
	if err := c.ShouldBindJSON(&block); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if block.AllocationID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Allocation must be specified for a share block"})
		return
	}

	// Validate and load the allocation
	var alloc models.Allocation
	if err := database.DB.First(&alloc, *block.AllocationID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Allocation not found"})
		return
	}
	if alloc.ShareholderID != block.ShareholderID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Allocation does not belong to this shareholder"})
		return
	}

	if block.SharesType == "" {
		block.SharesType = "both"
	}
	if block.SharesType != "paid" && block.SharesType != "unpaid" && block.SharesType != "both" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "shares_type must be paid, unpaid, or both"})
		return
	}

	// Compute paid/unpaid using the same FIFO logic the UI displays
	paidShares := computeAllocPaidShares(block.ShareholderID, *block.AllocationID)
	unpaidShares := alloc.AllocatedShares - paidShares

	// Existing locks on this allocation (precise per-type)
	existingPaidBlocked := getEffectivePaidBlocked(*block.AllocationID)
	existingUnpaidBlocked := getEffectiveUnpaidBlocked(*block.AllocationID)

	availPaid := paidShares - existingPaidBlocked
	if availPaid < 0 {
		availPaid = 0
	}
	availUnpaid := unpaidShares - existingUnpaidBlocked
	if availUnpaid < 0 {
		availUnpaid = 0
	}

	switch block.SharesType {
	case "paid":
		if block.BlockShares <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Block shares must be greater than 0"})
			return
		}
		if block.BlockShares > availPaid {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf(
					"Cannot block %d paid shares on %s. Available paid: %d (total paid: %d, already blocked: %d).",
					block.BlockShares, alloc.AllocationNo, availPaid, paidShares, existingPaidBlocked),
			})
			return
		}
		block.PaidSharesToBlock = block.BlockShares
		block.UnpaidSharesToBlock = 0

	case "unpaid":
		if block.BlockShares <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Block shares must be greater than 0"})
			return
		}
		if block.BlockShares > availUnpaid {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf(
					"Cannot block %d unpaid shares on %s. Available unpaid: %d (total unpaid: %d, already blocked: %d).",
					block.BlockShares, alloc.AllocationNo, availUnpaid, unpaidShares, existingUnpaidBlocked),
			})
			return
		}
		block.UnpaidSharesToBlock = block.BlockShares
		block.PaidSharesToBlock = 0

	case "both":
		if block.PaidSharesToBlock <= 0 && block.UnpaidSharesToBlock <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "At least one of paid or unpaid shares to block must be greater than 0"})
			return
		}
		if block.PaidSharesToBlock < 0 || block.UnpaidSharesToBlock < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Paid and unpaid shares to block cannot be negative"})
			return
		}
		if block.PaidSharesToBlock > availPaid {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf(
					"Cannot block %d paid shares on %s. Available paid: %d (total paid: %d, already blocked: %d).",
					block.PaidSharesToBlock, alloc.AllocationNo, availPaid, paidShares, existingPaidBlocked),
			})
			return
		}
		if block.UnpaidSharesToBlock > availUnpaid {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf(
					"Cannot block %d unpaid shares on %s. Available unpaid: %d (total unpaid: %d, already blocked: %d).",
					block.UnpaidSharesToBlock, alloc.AllocationNo, availUnpaid, unpaidShares, existingUnpaidBlocked),
			})
			return
		}
		// block_shares = total of both portions
		block.BlockShares = block.PaidSharesToBlock + block.UnpaidSharesToBlock
	}

	block.ApprovalStatus = "pending"
	database.DB.Create(&block)

	now := time.Now()

	if block.ServiceFee > 0 {
		database.DB.Create(&models.ServiceCharge{
			ShareholderID: block.ShareholderID,
			ChargeType:    "block",
			Amount:        block.ServiceFee,
			ReferenceType: "share_block",
			ReferenceID:   block.ID,
			ChargeDate:    &now,
		})
	}

	database.DB.Create(&models.PendingApproval{
		EntityType:  "block",
		EntityID:    block.ID,
		Action:      "create",
		RequestedBy: getUserID(c),
		Status:      "pending",
		RequestedAt: now,
	})

	c.JSON(http.StatusCreated, gin.H{"message": "Share block created", "id": block.ID})
}

func ReleaseShareBlock(c *gin.Context) {
	id := c.Param("id")
	var block models.ShareBlock
	if err := database.DB.First(&block, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share block not found"})
		return
	}

	now := time.Now()
	block.IsReleased = true
	block.ReleaseDate = &now
	block.Status = "released"
	database.DB.Save(&block)

	c.JSON(http.StatusOK, gin.H{"message": "Share block released"})
}
