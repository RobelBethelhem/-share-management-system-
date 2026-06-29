package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
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
	// A pending block still reserves its shares (reserve-on-request) so two
	// requests can't claim the same shares and a transfer can't grab them
	// mid-approval. Only a REJECTED block frees them (and a released one).
	var paidTypeBlocked int64
	database.DB.Model(&models.ShareBlock{}).
		Where("allocation_id = ? AND shares_type = 'paid' AND is_released = ? AND approval_status <> ?", allocID, false, "rejected").
		Select("COALESCE(SUM(block_shares), 0)").Scan(&paidTypeBlocked)

	var bothPaidPortion int64
	database.DB.Model(&models.ShareBlock{}).
		Where("allocation_id = ? AND shares_type = 'both' AND is_released = ? AND approval_status <> ?", allocID, false, "rejected").
		Select("COALESCE(SUM(paid_shares_to_block), 0)").Scan(&bothPaidPortion)

	return paidTypeBlocked + bothPaidPortion
}

// getEffectiveUnpaidBlocked returns the total unpaid shares locked by active blocks on an allocation.
// Includes "unpaid" type blocks (full block_shares) and the unpaid portion of "both" type blocks.
func getEffectiveUnpaidBlocked(allocID uint) int64 {
	var unpaidTypeBlocked int64
	database.DB.Model(&models.ShareBlock{}).
		Where("allocation_id = ? AND shares_type = 'unpaid' AND is_released = ? AND approval_status <> ?", allocID, false, "rejected").
		Select("COALESCE(SUM(block_shares), 0)").Scan(&unpaidTypeBlocked)

	var bothUnpaidPortion int64
	database.DB.Model(&models.ShareBlock{}).
		Where("allocation_id = ? AND shares_type = 'both' AND is_released = ? AND approval_status <> ?", allocID, false, "rejected").
		Select("COALESCE(SUM(unpaid_shares_to_block), 0)").Scan(&bothUnpaidPortion)

	return unpaidTypeBlocked + bothUnpaidPortion
}

// validateAndBuildBlock validates one share block against the allocation's
// available paid/unpaid shares and fills its paid/unpaid portions + block_shares.
// Reserve-on-request: pending + approved blocks already count as blocked (only
// rejected/released free their shares). consumedPaid/consumedUnpaid aggregate
// sibling blocks created in the same batch so two lines on one allocation can't
// over-reserve; pass empty maps for a single block.
func validateAndBuildBlock(block *models.ShareBlock, consumedPaid, consumedUnpaid map[uint]int64) error {
	if block.AllocationID == nil {
		return fmt.Errorf("Allocation must be specified for a share block")
	}
	var alloc models.Allocation
	if err := database.DB.First(&alloc, *block.AllocationID).Error; err != nil {
		return fmt.Errorf("Allocation not found")
	}
	if alloc.ShareholderID != block.ShareholderID {
		return fmt.Errorf("Allocation %s does not belong to this shareholder", alloc.AllocationNo)
	}
	if block.SharesType == "" {
		block.SharesType = "both"
	}
	if block.SharesType != "paid" && block.SharesType != "unpaid" && block.SharesType != "both" {
		return fmt.Errorf("shares_type must be paid, unpaid, or both")
	}

	paidShares := computeAllocPaidShares(block.ShareholderID, *block.AllocationID)
	unpaidShares := alloc.AllocatedShares - paidShares
	existingPaidBlocked := getEffectivePaidBlocked(*block.AllocationID)
	existingUnpaidBlocked := getEffectiveUnpaidBlocked(*block.AllocationID)

	availPaid := paidShares - existingPaidBlocked - consumedPaid[*block.AllocationID]
	if availPaid < 0 {
		availPaid = 0
	}
	availUnpaid := unpaidShares - existingUnpaidBlocked - consumedUnpaid[*block.AllocationID]
	if availUnpaid < 0 {
		availUnpaid = 0
	}

	switch block.SharesType {
	case "paid":
		if block.BlockShares <= 0 {
			return fmt.Errorf("Block shares must be greater than 0")
		}
		if block.BlockShares > availPaid {
			return fmt.Errorf("Cannot block %d paid shares on %s. Available paid: %d (total paid: %d, already blocked/pending: %d).",
				block.BlockShares, alloc.AllocationNo, availPaid, paidShares, existingPaidBlocked+consumedPaid[*block.AllocationID])
		}
		block.PaidSharesToBlock = block.BlockShares
		block.UnpaidSharesToBlock = 0

	case "unpaid":
		if block.BlockShares <= 0 {
			return fmt.Errorf("Block shares must be greater than 0")
		}
		if block.BlockShares > availUnpaid {
			return fmt.Errorf("Cannot block %d unpaid shares on %s. Available unpaid: %d (total unpaid: %d, already blocked/pending: %d).",
				block.BlockShares, alloc.AllocationNo, availUnpaid, unpaidShares, existingUnpaidBlocked+consumedUnpaid[*block.AllocationID])
		}
		block.UnpaidSharesToBlock = block.BlockShares
		block.PaidSharesToBlock = 0

	case "both":
		if block.PaidSharesToBlock <= 0 && block.UnpaidSharesToBlock <= 0 {
			return fmt.Errorf("At least one of paid or unpaid shares to block must be greater than 0")
		}
		if block.PaidSharesToBlock < 0 || block.UnpaidSharesToBlock < 0 {
			return fmt.Errorf("Paid and unpaid shares to block cannot be negative")
		}
		if block.PaidSharesToBlock > availPaid {
			return fmt.Errorf("Cannot block %d paid shares on %s. Available paid: %d (total paid: %d, already blocked/pending: %d).",
				block.PaidSharesToBlock, alloc.AllocationNo, availPaid, paidShares, existingPaidBlocked+consumedPaid[*block.AllocationID])
		}
		if block.UnpaidSharesToBlock > availUnpaid {
			return fmt.Errorf("Cannot block %d unpaid shares on %s. Available unpaid: %d (total unpaid: %d, already blocked/pending: %d).",
				block.UnpaidSharesToBlock, alloc.AllocationNo, availUnpaid, unpaidShares, existingUnpaidBlocked+consumedUnpaid[*block.AllocationID])
		}
		block.BlockShares = block.PaidSharesToBlock + block.UnpaidSharesToBlock
	}

	// Reserve within this batch so a later sibling line sees the reduced pool.
	consumedPaid[*block.AllocationID] += block.PaidSharesToBlock
	consumedUnpaid[*block.AllocationID] += block.UnpaidSharesToBlock
	return nil
}

// RunBlockRelease performs the actual release once a release request is
// approved: frees the shares and marks the block released.
func RunBlockRelease(blockID uint) error {
	var block models.ShareBlock
	if err := database.DB.First(&block, blockID).Error; err != nil {
		return err
	}
	now := time.Now()
	return database.DB.Model(&models.ShareBlock{}).Where("id = ?", blockID).
		Updates(map[string]interface{}{
			"is_released":        true,
			"is_release_pending": false,
			"release_date":       &now,
			"status":             "released",
		}).Error
}

// CreateShareBlocksBatch blocks two or more allocations in one action. The
// shareholder / block type / date / reason are shared; each line names an
// allocation, shares-type and shares. Validates them all (aggregating per
// allocation), then creates each block pending approval atomically.
func CreateShareBlocksBatch(c *gin.Context) {
	var input struct {
		ShareholderID uint                `json:"shareholder_id"`
		BlockType     string              `json:"block_type"`
		BlockDate     *time.Time          `json:"block_date"`
		Reason        string              `json:"reason"`
		Blocks        []models.ShareBlock `json:"blocks"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.ShareholderID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Shareholder is required"})
		return
	}
	if len(input.Blocks) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Add at least one allocation to block"})
		return
	}

	consumedPaid := map[uint]int64{}
	consumedUnpaid := map[uint]int64{}
	for i := range input.Blocks {
		b := &input.Blocks[i]
		b.ShareholderID = input.ShareholderID
		if b.BlockType == "" {
			b.BlockType = input.BlockType
		}
		if b.BlockDate == nil {
			b.BlockDate = input.BlockDate
		}
		if b.Reason == "" {
			b.Reason = input.Reason
		}
		if err := validateAndBuildBlock(b, consumedPaid, consumedUnpaid); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	now := time.Now()
	uid := getUserID(c)
	createdIDs := make([]uint, 0, len(input.Blocks))
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		for i := range input.Blocks {
			b := &input.Blocks[i]
			b.ApprovalStatus = "pending"
			if err := tx.Create(b).Error; err != nil {
				return err
			}
			createdIDs = append(createdIDs, b.ID)
			if b.ServiceFee > 0 {
				if err := tx.Create(&models.ServiceCharge{
					ShareholderID: b.ShareholderID,
					ChargeType:    "block",
					Amount:        b.ServiceFee,
					ReferenceType: "share_block",
					ReferenceID:   b.ID,
					ChargeDate:    &now,
				}).Error; err != nil {
					return err
				}
			}
			if err := tx.Create(&models.PendingApproval{
				EntityType:  "block",
				EntityID:    b.ID,
				Action:      "create",
				RequestedBy: uid,
				Status:      "pending",
				RequestedAt: now,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"message": fmt.Sprintf("%d share block(s) created — pending approval", len(createdIDs)),
		"ids":     createdIDs,
	})
}

func CreateShareBlock(c *gin.Context) {
	var block models.ShareBlock
	if err := c.ShouldBindJSON(&block); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateAndBuildBlock(&block, map[uint]int64{}, map[uint]int64{}); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	block.ApprovalStatus = "pending"
	now := time.Now()
	uid := getUserID(c)

	// Atomic: the block, its service charge, and its pending approval all land
	// together (or not at all) so a block can never exist without its approval.
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&block).Error; err != nil {
			return err
		}
		if block.ServiceFee > 0 {
			if err := tx.Create(&models.ServiceCharge{
				ShareholderID: block.ShareholderID,
				ChargeType:    "block",
				Amount:        block.ServiceFee,
				ReferenceType: "share_block",
				ReferenceID:   block.ID,
				ChargeDate:    &now,
			}).Error; err != nil {
				return err
			}
		}
		return tx.Create(&models.PendingApproval{
			EntityType:  "block",
			EntityID:    block.ID,
			Action:      "create",
			RequestedBy: uid,
			Status:      "pending",
			RequestedAt: now,
		}).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Share block created — pending approval", "id": block.ID})
}

// ReleaseShareBlock now REQUESTS a release (authorization required) rather than
// releasing immediately. The shares stay reserved until the release is approved.
func ReleaseShareBlock(c *gin.Context) {
	id := c.Param("id")
	var block models.ShareBlock
	if err := database.DB.First(&block, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share block not found"})
		return
	}
	if block.IsReleased {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This block is already released"})
		return
	}
	if block.IsReleasePending {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A release for this block is already pending approval"})
		return
	}
	if block.ApprovalStatus != "approved" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This block isn't approved yet — reject the pending block request instead of releasing it"})
		return
	}

	now := time.Now()
	block.IsReleasePending = true
	database.DB.Save(&block)

	database.DB.Create(&models.PendingApproval{
		EntityType:  "block",
		EntityID:    block.ID,
		Action:      "release",
		RequestedBy: getUserID(c),
		Status:      "pending",
		RequestedAt: now,
	})

	c.JSON(http.StatusOK, gin.H{"message": "Release requested — pending approval"})
}
