package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetTransfers(c *gin.Context) {
	transferorID := c.Query("transferor_id")
	transferType := c.Query("transfer_type")
	approvalStatus := c.Query("approval_status")
	search := c.Query("search")
	fromAllocationID := c.Query("from_allocation_id")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	var searchCond string
	var searchLike string
	if search != "" {
		searchLike = "%" + search + "%"
		var shIDs []uint
		database.DB.Model(&models.Shareholder{}).
			Where("first_name LIKE ? OR last_name LIKE ? OR account_no LIKE ?", searchLike, searchLike, searchLike).
			Pluck("id", &shIDs)
		if len(shIDs) > 0 {
			idParts := make([]string, len(shIDs))
			for i, id := range shIDs {
				idParts[i] = fmt.Sprintf("%d", id)
			}
			idList := strings.Join(idParts, ",")
			searchCond = fmt.Sprintf("(transferor_id IN (%s) OR transferee_id IN (%s) OR batch_no LIKE ?)", idList, idList)
		} else {
			searchCond = "batch_no LIKE ?"
		}
	}

	countQ := database.DB.Model(&models.Transfer{})
	if transferorID != "" {
		countQ = countQ.Where("transferor_id = ?", transferorID)
	}
	if transferType != "" {
		countQ = countQ.Where("transfer_type = ?", transferType)
	}
	if approvalStatus != "" {
		countQ = countQ.Where("approval_status = ?", approvalStatus)
	}
	if searchCond != "" {
		countQ = countQ.Where(searchCond, searchLike)
	}
	if fromAllocationID != "" {
		cond := "from_allocation_id = ? OR to_allocation_id = ? OR id IN (SELECT transfer_id FROM transfer_lines WHERE from_allocation_id = ?)"
		countQ = countQ.Where(cond, fromAllocationID, fromAllocationID, fromAllocationID)
	}
	var total int64
	countQ.Count(&total)

	findQ := database.DB.Model(&models.Transfer{})
	if transferorID != "" {
		findQ = findQ.Where("transferor_id = ?", transferorID)
	}
	if transferType != "" {
		findQ = findQ.Where("transfer_type = ?", transferType)
	}
	if approvalStatus != "" {
		findQ = findQ.Where("approval_status = ?", approvalStatus)
	}
	if searchCond != "" {
		findQ = findQ.Where(searchCond, searchLike)
	}
	if fromAllocationID != "" {
		cond := "from_allocation_id = ? OR to_allocation_id = ? OR id IN (SELECT transfer_id FROM transfer_lines WHERE from_allocation_id = ?)"
		findQ = findQ.Where(cond, fromAllocationID, fromAllocationID, fromAllocationID)
	}
	var transfers []models.Transfer
	offset := (page - 1) * pageSize
	findQ.Preload("Transferor").Preload("Transferee").Offset(offset).Limit(pageSize).Order("id DESC").Find(&transfers)

	c.JSON(http.StatusOK, gin.H{"data": transfers, "total": total, "page": page, "page_size": pageSize})
}

func GetTransfer(c *gin.Context) {
	id := c.Param("id")
	var transfer models.Transfer
	if err := database.DB.Preload("Transferor").Preload("Transferee").
		Preload("Lines.FromAllocation").First(&transfer, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transfer not found"})
		return
	}
	c.JSON(http.StatusOK, transfer)
}

func CreateTransfer(c *gin.Context) {
	type LineInput struct {
		FromAllocationID       uint  `json:"from_allocation_id" binding:"required"`
		PaidSharesToTransfer   int64 `json:"paid_shares_to_transfer"`
		UnpaidSharesToTransfer int64 `json:"unpaid_shares_to_transfer"`
	}
	type TransferInput struct {
		TransferorID       uint        `json:"transferor_id" binding:"required"`
		TransfereeID       uint        `json:"transferee_id" binding:"required"`
		TransferType       string      `json:"transfer_type"`
		ParValue           float64     `json:"par_value"`
		NumberOfShares     int64       `json:"number_of_shares"`
		IsFullTransfer     bool        `json:"is_full_transfer"`
		AgreedDividendDate *time.Time  `json:"agreed_dividend_date"`
		Reason             string      `json:"reason"`
		ToAllocationID     *uint       `json:"to_allocation_id"`
		FromAllocationID   *uint       `json:"from_allocation_id"` // legacy fallback
		Lines              []LineInput `json:"lines"`
	}
	var input TransferInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// === MULTI-LINE PATH ===
	if len(input.Lines) > 0 {
		totalPaid, totalUnpaid := int64(0), int64(0)
		for _, line := range input.Lines {
			var alloc models.Allocation
			if err := database.DB.First(&alloc, line.FromAllocationID).Error; err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Allocation %d not found", line.FromAllocationID)})
				return
			}
			if alloc.ShareholderID != input.TransferorID {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Allocation %d does not belong to the transferor", line.FromAllocationID)})
				return
			}
			// Compute effective paid shares using FIFO unlinked-pool — must match
			// GetShareholderInvestmentSummary (i.e., what the UI displays) exactly.
			srcPaidShares := computeAllocPaidShares(input.TransferorID, alloc.ID)
			srcUnpaidShares := alloc.AllocatedShares - srcPaidShares

			// Precise per-type block accounting (includes "both" block paid/unpaid breakdown).
			effPaidBlocked := getEffectivePaidBlocked(alloc.ID)
			effUnpaidBlocked := getEffectiveUnpaidBlocked(alloc.ID)

			// Total blocks via direct SUM — catches legacy blocks where paid/unpaid split fields are 0.
			var totalBlocked int64
			database.DB.Model(&models.ShareBlock{}).
				Where("allocation_id = ? AND is_released = ?", alloc.ID, false).
				Select("COALESCE(SUM(block_shares), 0)").Scan(&totalBlocked)
			totalFree := alloc.AllocatedShares - totalBlocked
			if totalFree < 0 {
				totalFree = 0
			}

			availPaid := srcPaidShares - effPaidBlocked
			if availPaid < 0 {
				availPaid = 0
			}
			if availPaid > totalFree {
				availPaid = totalFree
			}
			availUnpaid := srcUnpaidShares - effUnpaidBlocked
			if availUnpaid < 0 {
				availUnpaid = 0
			}
			if availUnpaid > totalFree {
				availUnpaid = totalFree
			}

			if line.PaidSharesToTransfer > availPaid {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
					"Allocation %d: paid shares to transfer (%d) exceeds available paid shares (%d — %d paid minus %d blocked)",
					line.FromAllocationID, line.PaidSharesToTransfer, availPaid, srcPaidShares, effPaidBlocked)})
				return
			}
			if line.UnpaidSharesToTransfer > availUnpaid {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
					"Allocation %d: unpaid shares to transfer (%d) exceeds available unpaid shares (%d — %d unpaid minus %d blocked)",
					line.FromAllocationID, line.UnpaidSharesToTransfer, availUnpaid, srcUnpaidShares, effUnpaidBlocked)})
				return
			}
			totalLineRequested := line.PaidSharesToTransfer + line.UnpaidSharesToTransfer
			if totalLineRequested > totalFree {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
					"Allocation %d: total shares to transfer (%d) exceeds total free shares (%d — %d allocated minus %d blocked)",
					line.FromAllocationID, totalLineRequested, totalFree, alloc.AllocatedShares, totalBlocked)})
				return
			}
			totalPaid += line.PaidSharesToTransfer
			totalUnpaid += line.UnpaidSharesToTransfer
		}
		// Validate ToAllocationID belongs to transferee
		if input.ToAllocationID != nil {
			var dest models.Allocation
			if err := database.DB.First(&dest, *input.ToAllocationID).Error; err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Destination allocation not found"})
				return
			}
			if dest.ShareholderID != input.TransfereeID {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Destination allocation does not belong to the transferee"})
				return
			}
		}
		input.NumberOfShares = totalPaid + totalUnpaid
	} else {
		// === LEGACY SINGLE-ALLOCATION PATH ===
		if input.FromAllocationID != nil {
			var alloc models.Allocation
			if err := database.DB.First(&alloc, *input.FromAllocationID).Error; err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Allocation not found"})
				return
			}
			if alloc.ShareholderID != input.TransferorID {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Selected allocation does not belong to the transferor"})
				return
			}
		}
		var availableShares int64
		database.DB.Model(&models.Investment{}).
			Where("shareholder_id = ? AND status = 'active' AND approval_status = 'approved'", input.TransferorID).
			Select("COALESCE(SUM(number_of_shares), 0)").Scan(&availableShares)
		var blockedShares int64
		database.DB.Model(&models.ShareBlock{}).
			Where("shareholder_id = ? AND is_released = ?", input.TransferorID, false).
			Select("COALESCE(SUM(block_shares), 0)").Scan(&blockedShares)
		freeShares := availableShares - blockedShares
		if input.NumberOfShares > freeShares {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Insufficient shares. Available: %d, Requested: %d", freeShares, input.NumberOfShares)})
			return
		}
	}

	// Build Transfer record
	transfer := models.Transfer{
		TransferorID:       input.TransferorID,
		TransfereeID:       input.TransfereeID,
		TransferType:       input.TransferType,
		ParValue:           input.ParValue,
		NumberOfShares:     input.NumberOfShares,
		IsFullTransfer:     input.IsFullTransfer,
		AgreedDividendDate: input.AgreedDividendDate,
		Reason:             input.Reason,
		ToAllocationID:     input.ToAllocationID,
		FromAllocationID:   input.FromAllocationID,
	}

	if transfer.ParValue > 0 {
		transferValue := float64(transfer.NumberOfShares) * transfer.ParValue
		transfer.TransferAmount = transferValue
		transfer.CapitalGainTax = transferValue * 0.15
		transfer.ServiceFee = transferValue * 0.01
		transfer.StampDuty = transferValue * 0.005
		transfer.VAT = transfer.ServiceFee * 0.15
		transfer.TotalFees = transfer.CapitalGainTax + transfer.ServiceFee + transfer.StampDuty + transfer.VAT
	}

	now := time.Now()
	transfer.TransferDate = &now
	transfer.BatchNo = fmt.Sprintf("TRF-%d", now.UnixNano()/1000000)
	transfer.ApprovalStatus = "pending"

	database.DB.Create(&transfer)

	// Create TransferLines for multi-line path
	for _, line := range input.Lines {
		database.DB.Create(&models.TransferLine{
			TransferID:             transfer.ID,
			FromAllocationID:       line.FromAllocationID,
			PaidSharesToTransfer:   line.PaidSharesToTransfer,
			UnpaidSharesToTransfer: line.UnpaidSharesToTransfer,
		})
	}

	database.DB.Create(&models.ServiceCharge{
		ShareholderID: transfer.TransferorID,
		ChargeType:    "transfer",
		Amount:        transfer.TotalFees,
		ReferenceType: "transfer",
		ReferenceID:   transfer.ID,
		ChargeDate:    &now,
	})

	database.DB.Create(&models.PendingApproval{
		EntityType:  "transfer",
		EntityID:    transfer.ID,
		Action:      "create",
		RequestedBy: getUserID(c),
		Status:      "pending",
		RequestedAt: now,
	})

	c.JSON(http.StatusCreated, gin.H{"message": "Transfer created", "id": transfer.ID, "batch_no": transfer.BatchNo})
}

// RunTransferApproval is the single authoritative function that executes transfer business logic.
// It handles both the legacy path (no lines → flat investments) and the multi-line path
// (lines present → allocation updates + per-line investments for paid portion).
// Called by ApproveTransfer (direct HTTP) and by approvals.go (pending approval flow).
func RunTransferApproval(transferID uint) error {
	var transfer models.Transfer
	if err := database.DB.Preload("Lines").First(&transfer, transferID).Error; err != nil {
		return err
	}

	return database.DB.Transaction(func(tx *gorm.DB) error {
		transfer.Status = "approved"
		transfer.ApprovalStatus = "approved"
		if err := tx.Save(&transfer).Error; err != nil {
			return err
		}

		now := time.Now()
		dividendDate := &now
		if transfer.AgreedDividendDate != nil {
			dividendDate = transfer.AgreedDividendDate
		}

		// === LEGACY PATH (no lines — backward-compatible with old transfers) ===
		if len(transfer.Lines) == 0 {
			if err := tx.Create(&models.Investment{
				ShareholderID:  transfer.TransferorID,
				PaymentDate:    dividendDate,
				PaymentMethod:  "transfer_out",
				Amount:         -transfer.TransferAmount,
				NumberOfShares: -transfer.NumberOfShares,
				ParValue:       transfer.ParValue,
				ReferenceNo:    transfer.BatchNo,
				Status:         "active",
				ApprovalStatus: "approved",
				Remark:         "Transfer out - " + transfer.BatchNo,
			}).Error; err != nil {
				return err
			}
			if err := tx.Create(&models.Investment{
				ShareholderID:  transfer.TransfereeID,
				PaymentDate:    dividendDate,
				PaymentMethod:  "transfer_in",
				Amount:         transfer.TransferAmount,
				NumberOfShares: transfer.NumberOfShares,
				ParValue:       transfer.ParValue,
				ReferenceNo:    transfer.BatchNo,
				Status:         "active",
				ApprovalStatus: "approved",
				Remark:         "Transfer in - " + transfer.BatchNo,
			}).Error; err != nil {
				return err
			}
			if transfer.IsFullTransfer {
				tx.Model(&models.Shareholder{}).Where("id = ?", transfer.TransferorID).Update("status", "dormant")
			}
			return nil
		}

		// === MULTI-LINE PATH ===
		totalPaid, totalUnpaid := int64(0), int64(0)
		for _, line := range transfer.Lines {
			totalPaid += line.PaidSharesToTransfer
			totalUnpaid += line.UnpaidSharesToTransfer
		}
		totalShares := totalPaid + totalUnpaid

		// Step 1: Determine/create destination allocation (sized for full total)
		var destAllocID *uint
		if transfer.ToAllocationID != nil {
			// Merge into existing allocation: expand by total transferred shares
			if err := tx.Model(&models.Allocation{}).Where("id = ?", *transfer.ToAllocationID).
				Updates(map[string]interface{}{
					"allocated_shares": gorm.Expr("allocated_shares + ?", totalShares),
					"allocated_amount": gorm.Expr("allocated_amount + ?", float64(totalShares)*transfer.ParValue),
				}).Error; err != nil {
				return err
			}
			destAllocID = transfer.ToAllocationID
		} else {
			// Create new allocation for transferee, inherit round from first line's source
			inheritRound := 1
			var srcAlloc models.Allocation
			if err := tx.First(&srcAlloc, transfer.Lines[0].FromAllocationID).Error; err == nil {
				inheritRound = srcAlloc.Round
			}
			newAlloc := models.Allocation{
				ShareholderID:   transfer.TransfereeID,
				AllocationNo:    "TALLOC-" + transfer.BatchNo,
				Round:           inheritRound,
				AllocatedShares: totalShares,
				AllocatedAmount: float64(totalShares) * transfer.ParValue,
				AllocationDate:  &now,
				Status:          "allocated",
				ApprovalStatus:  "approved",
			}
			if err := tx.Create(&newAlloc).Error; err != nil {
				return err
			}
			destAllocID = &newAlloc.ID
			transfer.ToAllocationID = destAllocID
			tx.Save(&transfer)
		}

		// Step 2: Process each line
		for _, line := range transfer.Lines {
			allocIDCopy := line.FromAllocationID

			// Paid shares: move via investment records
			if line.PaidSharesToTransfer > 0 {
				paidAmt := float64(line.PaidSharesToTransfer) * transfer.ParValue
				if err := tx.Create(&models.Investment{
					ShareholderID:  transfer.TransferorID,
					PaymentDate:    dividendDate,
					PaymentMethod:  "transfer_out",
					Amount:         -paidAmt,
					NumberOfShares: -line.PaidSharesToTransfer,
					ParValue:       transfer.ParValue,
					AllocationID:   &allocIDCopy,
					ReferenceNo:    transfer.BatchNo,
					Status:         "active",
					ApprovalStatus: "approved",
					Remark:         fmt.Sprintf("Transfer out (paid) alloc %d - %s", line.FromAllocationID, transfer.BatchNo),
				}).Error; err != nil {
					return err
				}
				if err := tx.Create(&models.Investment{
					ShareholderID:  transfer.TransfereeID,
					PaymentDate:    dividendDate,
					PaymentMethod:  "transfer_in",
					Amount:         paidAmt,
					NumberOfShares: line.PaidSharesToTransfer,
					ParValue:       transfer.ParValue,
					AllocationID:   destAllocID,
					ReferenceNo:    transfer.BatchNo,
					Status:         "active",
					ApprovalStatus: "approved",
					Remark:         fmt.Sprintf("Transfer in (paid) alloc %d - %s", line.FromAllocationID, transfer.BatchNo),
				}).Error; err != nil {
					return err
				}
			}

			// Reduce source allocation for ALL transferred shares on this line (paid + unpaid).
			// Paid shares are also tracked via investment records above; unpaid only via this reduction.
			totalLineShares := line.PaidSharesToTransfer + line.UnpaidSharesToTransfer
			if totalLineShares > 0 {
				totalLineAmt := float64(totalLineShares) * transfer.ParValue
				if err := tx.Model(&models.Allocation{}).Where("id = ?", line.FromAllocationID).
					Updates(map[string]interface{}{
						"allocated_shares": gorm.Expr("allocated_shares - ?", totalLineShares),
						"allocated_amount": gorm.Expr("allocated_amount - ?", totalLineAmt),
					}).Error; err != nil {
					return err
				}
				// Destination was already sized for the full total in Step 1.
			}
		}

		// Step 3: Dormant check
		if transfer.IsFullTransfer {
			tx.Model(&models.Shareholder{}).Where("id = ?", transfer.TransferorID).Update("status", "dormant")
		}
		return nil
	})
}

func ApproveTransfer(c *gin.Context) {
	id := c.Param("id")
	transferID, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid transfer ID"})
		return
	}
	if err := RunTransferApproval(uint(transferID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transfer approval failed: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Transfer approved and executed"})
}

func RejectTransfer(c *gin.Context) {
	id := c.Param("id")
	var input struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&input)
	database.DB.Model(&models.Transfer{}).Where("id = ?", id).
		Updates(map[string]interface{}{"status": "rejected", "approval_status": "rejected"})
	c.JSON(http.StatusOK, gin.H{"message": "Transfer rejected"})
}

func CalculateTransferFees(c *gin.Context) {
	var input struct {
		NumberOfShares int64   `json:"number_of_shares" binding:"required"`
		ParValue       float64 `json:"par_value" binding:"required"`
		PricePerShare  float64 `json:"price_per_share"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.PricePerShare <= 0 {
		input.PricePerShare = input.ParValue
	}

	transferValue := float64(input.NumberOfShares) * input.PricePerShare

	getRate := func(key string, fallback float64) float64 {
		var s models.SystemSetting
		if err := database.DB.Where("`key` = ?", key).First(&s).Error; err == nil {
			if v, err2 := strconv.ParseFloat(s.Value, 64); err2 == nil {
				return v
			}
		}
		return fallback
	}

	capitalGainRate := getRate("capital_gain_tax_rate", 15) / 100
	serviceFeeRate := getRate("transfer_service_fee_rate", 1) / 100
	stampDutyRate := getRate("transfer_stamp_duty_rate", 0.5) / 100
	vatRate := getRate("transfer_vat_rate", 15) / 100

	capitalGainTax := transferValue * capitalGainRate
	serviceFee := transferValue * serviceFeeRate
	stampDuty := transferValue * stampDutyRate
	vat := serviceFee * vatRate
	total := capitalGainTax + serviceFee + stampDuty + vat

	c.JSON(http.StatusOK, gin.H{
		"transfer_value":        transferValue,
		"capital_gain_tax":      capitalGainTax,
		"capital_gain_tax_rate": capitalGainRate * 100,
		"service_fee":           serviceFee,
		"service_fee_rate":      serviceFeeRate * 100,
		"stamp_duty":            stampDuty,
		"stamp_duty_rate":       stampDutyRate * 100,
		"vat":                   vat,
		"vat_rate":              vatRate * 100,
		"total_fees":            total,
	})
}

func LookupShareholder(c *gin.Context) {
	accountNo := c.Query("account_no")
	if accountNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "account_no required"})
		return
	}
	var sh models.Shareholder
	if err := database.DB.Where("account_no = ?", accountNo).First(&sh).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"found": false, "message": "Account not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"found":          true,
		"shareholder_id": sh.ID,
		"name":           fmt.Sprintf("%s %s", sh.FirstName, sh.LastName),
		"account_no":     sh.AccountNo,
	})
}
