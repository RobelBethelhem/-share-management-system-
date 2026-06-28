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
		// FromInvestmentID identifies the specific paid payment (cohort) the
		// shares are sold from. Optional (legacy / whole-allocation transfers
		// omit it). When set, the dividend-from floor is that payment's date —
		// not the allocation's earliest — and the paid shares can't exceed it.
		FromInvestmentID *uint `json:"from_investment_id"`
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

	// A shareholder cannot transfer shares to himself.
	if input.TransferorID == input.TransfereeID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transferor and transferee cannot be the same shareholder"})
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
			// When a specific source payment (cohort) is named, validate it and
			// cap the paid shares to that payment — you can't sell more of a
			// cohort than it holds, and it must be an approved positive share
			// purchase belonging to the transferor and this allocation.
			if line.FromInvestmentID != nil {
				var srcInv models.Investment
				if err := database.DB.First(&srcInv, *line.FromInvestmentID).Error; err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Source payment %d not found", *line.FromInvestmentID)})
					return
				}
				if srcInv.ShareholderID != input.TransferorID {
					c.JSON(http.StatusBadRequest, gin.H{"error": "Source payment does not belong to the transferor"})
					return
				}
				if srcInv.AllocationID == nil || *srcInv.AllocationID != line.FromAllocationID {
					c.JSON(http.StatusBadRequest, gin.H{"error": "Source payment is not part of the selected allocation"})
					return
				}
				if srcInv.NumberOfShares <= 0 || srcInv.ApprovalStatus != "approved" || srcInv.Status != "active" {
					c.JSON(http.StatusBadRequest, gin.H{"error": "Source payment is not an active, approved share purchase"})
					return
				}
				if line.PaidSharesToTransfer > srcInv.NumberOfShares {
					c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
						"Paid shares to transfer (%d) exceeds the selected payment's shares (%d)",
						line.PaidSharesToTransfer, srcInv.NumberOfShares)})
					return
				}
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

			// PENDING outgoing transfers from THIS allocation — they reserve
			// capacity even though they haven't been executed yet. Without this,
			// two pending transfers can both pass the per-line check against
			// the same paid pool, and double-spend happens on approval.
			var pendingPaidOut, pendingUnpaidOut int64
			database.DB.Table("transfer_lines").
				Joins("JOIN transfers ON transfers.id = transfer_lines.transfer_id").
				Where("transfer_lines.from_allocation_id = ? AND transfers.approval_status = ?",
					alloc.ID, "pending").
				Select("COALESCE(SUM(transfer_lines.paid_shares_to_transfer), 0)").Scan(&pendingPaidOut)
			database.DB.Table("transfer_lines").
				Joins("JOIN transfers ON transfers.id = transfer_lines.transfer_id").
				Where("transfer_lines.from_allocation_id = ? AND transfers.approval_status = ?",
					alloc.ID, "pending").
				Select("COALESCE(SUM(transfer_lines.unpaid_shares_to_transfer), 0)").Scan(&pendingUnpaidOut)

			totalFree := alloc.AllocatedShares - totalBlocked - pendingPaidOut - pendingUnpaidOut
			if totalFree < 0 {
				totalFree = 0
			}

			availPaid := srcPaidShares - effPaidBlocked - pendingPaidOut
			if availPaid < 0 {
				availPaid = 0
			}
			if availPaid > totalFree {
				availPaid = totalFree
			}
			availUnpaid := srcUnpaidShares - effUnpaidBlocked - pendingUnpaidOut
			if availUnpaid < 0 {
				availUnpaid = 0
			}
			if availUnpaid > totalFree {
				availUnpaid = totalFree
			}

			if line.PaidSharesToTransfer > availPaid {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
					"Allocation %d: paid shares to transfer (%d) exceeds available paid (%d — %d paid − %d blocked − %d already pending in other transfers)",
					line.FromAllocationID, line.PaidSharesToTransfer, availPaid, srcPaidShares, effPaidBlocked, pendingPaidOut)})
				return
			}
			if line.UnpaidSharesToTransfer > availUnpaid {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
					"Allocation %d: unpaid shares to transfer (%d) exceeds available unpaid (%d — %d unpaid − %d blocked − %d already pending in other transfers)",
					line.FromAllocationID, line.UnpaidSharesToTransfer, availUnpaid, srcUnpaidShares, effUnpaidBlocked, pendingUnpaidOut)})
				return
			}
			totalLineRequested := line.PaidSharesToTransfer + line.UnpaidSharesToTransfer
			if totalLineRequested > totalFree {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
					"Allocation %d: total shares to transfer (%d) exceeds total free (%d — %d allocated − %d blocked − %d already pending)",
					line.FromAllocationID, totalLineRequested, totalFree, alloc.AllocatedShares, totalBlocked, pendingPaidOut+pendingUnpaidOut)})
				return
			}
			totalPaid += line.PaidSharesToTransfer
			totalUnpaid += line.UnpaidSharesToTransfer
		}

		// Anchor rule: a shareholder who still has unpaid shares somewhere
		// after this transfer must retain at least 1 paid share. Otherwise
		// the unpaid ownership has no paid anchor in the register.
		//
		//   60 paid + 40 unpaid, transfer 60 paid → 0 paid + 40 unpaid → REJECT
		//   60 paid +  0 unpaid, transfer 60 paid → 0 paid +  0 unpaid → OK
		//   Alloc1: 60p/0u, Alloc2: 100p/50u; transfer 100p from Alloc2 →
		//     60 paid + 50 unpaid remaining → OK (Alloc1 still has 60 paid)
		var transferorAllocs []models.Allocation
		database.DB.Where("shareholder_id = ?", input.TransferorID).Find(&transferorAllocs)
		var currentPaidTotal, currentUnpaidTotal int64
		for _, a := range transferorAllocs {
			paid := computeAllocPaidShares(input.TransferorID, a.ID)
			currentPaidTotal += paid
			if a.AllocatedShares > paid {
				currentUnpaidTotal += a.AllocatedShares - paid
			}
		}
		// Subtract everything already reserved by OTHER pending transfers from
		// this transferor — the anchor rule has to see the post-pending state,
		// not just the post-approved state.
		var pendingPaidAcross, pendingUnpaidAcross int64
		database.DB.Table("transfer_lines").
			Joins("JOIN transfers ON transfers.id = transfer_lines.transfer_id").
			Where("transfers.transferor_id = ? AND transfers.approval_status = ?",
				input.TransferorID, "pending").
			Select("COALESCE(SUM(transfer_lines.paid_shares_to_transfer), 0)").Scan(&pendingPaidAcross)
		database.DB.Table("transfer_lines").
			Joins("JOIN transfers ON transfers.id = transfer_lines.transfer_id").
			Where("transfers.transferor_id = ? AND transfers.approval_status = ?",
				input.TransferorID, "pending").
			Select("COALESCE(SUM(transfer_lines.unpaid_shares_to_transfer), 0)").Scan(&pendingUnpaidAcross)
		currentPaidTotal -= pendingPaidAcross
		currentUnpaidTotal -= pendingUnpaidAcross
		if currentPaidTotal < 0 {
			currentPaidTotal = 0
		}
		if currentUnpaidTotal < 0 {
			currentUnpaidTotal = 0
		}
		paidAfter := currentPaidTotal - totalPaid
		unpaidAfter := currentUnpaidTotal - totalUnpaid
		if unpaidAfter > 0 && paidAfter < 1 {
			maxPaid := currentPaidTotal - 1
			if maxPaid < 0 {
				maxPaid = 0
			}
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf(
					"Transfer would leave the shareholder with 0 paid shares but %d unpaid shares remaining. "+
						"At least 1 paid share must stay with the shareholder while any unpaid shares exist. "+
						"Reduce paid shares to at most %d, or also transfer the remaining %d unpaid shares.",
					unpaidAfter, maxPaid, unpaidAfter,
				),
				"current_paid":   currentPaidTotal,
				"current_unpaid": currentUnpaidTotal,
				"paid_after":     paidAfter,
				"unpaid_after":   unpaidAfter,
				"max_paid":       maxPaid,
			})
			return
		}

		// Dividend-from-date floor. The AgreedDividendDate cannot be earlier
		// than when the source shares were acquired — backdating it would credit
		// the new owner (and debit the old) for days the shares didn't yet
		// exist, producing negative cohort rows in the dividend breakdown.
		// When a specific source payment is named, the floor is THAT payment's
		// date (e.g. an Oct 21 payment can't be transferred effective Sep 1);
		// otherwise it falls back to the source allocation's earliest
		// acquisition. Floor = the LATEST such date across all source lines.
		if input.AgreedDividendDate != nil {
			var floor *time.Time
			var floorLabel string
			for _, line := range input.Lines {
				var cand *time.Time
				var label string
				if line.FromInvestmentID != nil {
					var srcInv models.Investment
					if err := database.DB.First(&srcInv, *line.FromInvestmentID).Error; err == nil && srcInv.PaymentDate != nil {
						cand = srcInv.PaymentDate
						label = fmt.Sprintf("the selected payment (%s)", srcInv.PaymentDate.Format("2006-01-02"))
					}
				}
				if cand == nil {
					var alloc models.Allocation
					if err := database.DB.First(&alloc, line.FromAllocationID).Error; err != nil {
						continue
					}
					cand = allocationAcquisitionDate(alloc)
					label = fmt.Sprintf("source allocation %s acquired its shares", alloc.AllocationNo)
				}
				if cand != nil && (floor == nil || cand.After(*floor)) {
					floor = cand
					floorLabel = label
				}
			}
			if floor != nil {
				// Compare date-only (ignore time component).
				fy, fm, fd := floor.Date()
				floorDay := time.Date(fy, fm, fd, 0, 0, 0, 0, floor.Location())
				ay, am, ad := input.AgreedDividendDate.Date()
				agreedDay := time.Date(ay, am, ad, 0, 0, 0, 0, input.AgreedDividendDate.Location())
				if agreedDay.Before(floorDay) {
					c.JSON(http.StatusBadRequest, gin.H{
						"error": fmt.Sprintf(
							"Dividend From Share Transfer Date (%s) cannot be earlier than when %s (%s). Pick a date on or after %s.",
							agreedDay.Format("2006-01-02"), floorLabel,
							floorDay.Format("2006-01-02"), floorDay.Format("2006-01-02"),
						),
						"min_dividend_date": floorDay.Format("2006-01-02"),
					})
					return
				}
			}
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
		// Whole-share floor: a transfer must move at least one whole share
		// (shares are integers, so this is the "amount >= one par value"
		// equivalent for transfers).
		if input.NumberOfShares < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Transfer must move at least one whole share."})
			return
		}
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
		// Reuse the same fee policy as the preview endpoint so the stored
		// numbers exactly match what the admin saw before clicking Create.
		// Pass through lines so cost basis is read per-allocation; falls back
		// to FromAllocationID, then BankCapital par if neither is provided.
		feeLines := make([]calcFeeLineInput, 0, len(input.Lines))
		for _, l := range input.Lines {
			feeLines = append(feeLines, calcFeeLineInput{
				FromAllocationID:       l.FromAllocationID,
				PaidSharesToTransfer:   l.PaidSharesToTransfer,
				UnpaidSharesToTransfer: l.UnpaidSharesToTransfer,
			})
		}
		b := computeTransferFees(transfer.NumberOfShares, transfer.ParValue, transfer.FromAllocationID, feeLines)
		transfer.TransferAmount = b.TransferValue
		transfer.CapitalGainTax = b.CapitalGainTax
		transfer.ServiceFee = b.ServiceFee
		transfer.StampDuty = b.StampDuty
		transfer.VAT = b.VAT
		transfer.TotalFees = b.TotalFees
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

	// Re-validate per-line availability against CURRENT state. Catches the
	// race where T1 + T2 both passed the create-time check independently,
	// then T1 was approved first and ate the shared paid pool. Without this,
	// approving T2 would silently drive the allocation's effective paid
	// count negative.
	for _, line := range transfer.Lines {
		var alloc models.Allocation
		if err := database.DB.First(&alloc, line.FromAllocationID).Error; err != nil {
			return fmt.Errorf("approval failed: allocation %d not found", line.FromAllocationID)
		}
		srcPaid := computeAllocPaidShares(transfer.TransferorID, alloc.ID)
		srcUnpaid := alloc.AllocatedShares - srcPaid
		effPaidBlocked := getEffectivePaidBlocked(alloc.ID)
		effUnpaidBlocked := getEffectiveUnpaidBlocked(alloc.ID)

		// Pending shares reserved by OTHER pending transfers (not this one).
		var pendingPaidOther, pendingUnpaidOther int64
		database.DB.Table("transfer_lines").
			Joins("JOIN transfers ON transfers.id = transfer_lines.transfer_id").
			Where("transfer_lines.from_allocation_id = ? AND transfers.id != ? AND transfers.approval_status = ?",
				alloc.ID, transferID, "pending").
			Select("COALESCE(SUM(transfer_lines.paid_shares_to_transfer), 0)").Scan(&pendingPaidOther)
		database.DB.Table("transfer_lines").
			Joins("JOIN transfers ON transfers.id = transfer_lines.transfer_id").
			Where("transfer_lines.from_allocation_id = ? AND transfers.id != ? AND transfers.approval_status = ?",
				alloc.ID, transferID, "pending").
			Select("COALESCE(SUM(transfer_lines.unpaid_shares_to_transfer), 0)").Scan(&pendingUnpaidOther)

		availPaid := srcPaid - effPaidBlocked - pendingPaidOther
		if availPaid < 0 {
			availPaid = 0
		}
		availUnpaid := srcUnpaid - effUnpaidBlocked - pendingUnpaidOther
		if availUnpaid < 0 {
			availUnpaid = 0
		}
		if line.PaidSharesToTransfer > availPaid {
			return fmt.Errorf(
				"approval blocked: allocation %s — paid shares to transfer (%d) exceeds currently available (%d). Another transfer was approved between create and now, eating this allocation's paid capacity. Reject this transfer or wait until the prior approvals settle.",
				alloc.AllocationNo, line.PaidSharesToTransfer, availPaid)
		}
		if line.UnpaidSharesToTransfer > availUnpaid {
			return fmt.Errorf(
				"approval blocked: allocation %s — unpaid shares to transfer (%d) exceeds currently available (%d).",
				alloc.AllocationNo, line.UnpaidSharesToTransfer, availUnpaid)
		}
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
				// The transferee's dividend-eligibility clock starts at the agreed
				// dividend date (or transfer approval time if no agreed date) —
				// not at `now`. This is what the weighted-average breakdown reads
				// to compute days_held for the new owner.
				AllocationDate:  dividendDate,
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

// calcFeeLineInput models one source-allocation line for the fee calculator.
// Used by both the preview endpoint (CalculateTransferFees) and the save path
// (CreateTransfer) — the two callers share the same helper below so the
// numbers the admin sees in the preview are exactly what gets persisted.
type calcFeeLineInput struct {
	FromAllocationID       uint  `json:"from_allocation_id"`
	PaidSharesToTransfer   int64 `json:"paid_shares_to_transfer"`
	UnpaidSharesToTransfer int64 `json:"unpaid_shares_to_transfer"`
}

// transferFeeBreakdown is the structured output of computeTransferFees.
// Field names mirror the JSON keys the frontend already consumes.
type transferFeeBreakdown struct {
	TransferValue          float64
	CostBasisPerShare      float64
	SellingPricePerShare   float64
	GainPerShare           float64
	CapitalGain            float64
	CapitalGainTax         float64
	CapitalGainTaxRate     float64
	ServiceFee             float64
	ServiceFeeRate         float64
	ServiceFeeMin          float64
	ServiceFeeMax          float64
	ServiceFeeFloorApplied bool
	ServiceFeeCapApplied   bool
	LowSharesThreshold     int64
	StampDuty              float64
	StampDutyType          string
	StampDutyRate          float64
	StampDutyAmount        float64
	VAT                    float64
	VATRate                float64
	TotalFees              float64
	LineCosts              []map[string]interface{}
}

// computeTransferFees encapsulates the full fee policy. Single source of
// truth — used for both preview and persistence.
//
//   - Stamp duty: dispatches on transfer_stamp_duty_type (fixed | percent).
//     fixed mode applies transfer_stamp_duty_amount (a flat ETB number);
//     percent mode applies transfer_stamp_duty_rate × transfer value.
//
//   - Service fee: base = rate × transfer_value, then floor it at
//     transfer_service_fee_min_low_shares whenever shares < threshold (default
//     1,000 ETB minimum for transfers < 100 shares), then cap at
//     transfer_service_fee_max (default 20,000 ETB).
//
//   - CGT: 15% × max(0, selling - cost basis) × shares. cost basis is the
//     seller's per-share buying price, weighted across lines from the
//     source Allocation's AllocatedAmount/AllocatedShares.
func computeTransferFees(numberOfShares int64, pricePerShare float64, fromAllocationID *uint, lines []calcFeeLineInput) transferFeeBreakdown {
	out := transferFeeBreakdown{SellingPricePerShare: pricePerShare}
	out.TransferValue = float64(numberOfShares) * pricePerShare

	getRate := func(key string, fallback float64) float64 {
		var s models.SystemSetting
		if err := database.DB.Where("`key` = ?", key).First(&s).Error; err == nil {
			if v, err2 := strconv.ParseFloat(s.Value, 64); err2 == nil {
				return v
			}
		}
		return fallback
	}
	getStr := func(key, fallback string) string {
		var s models.SystemSetting
		if err := database.DB.Where("`key` = ?", key).First(&s).Error; err == nil && s.Value != "" {
			return s.Value
		}
		return fallback
	}

	capitalGainRate := getRate("capital_gain_tax_rate", 15) / 100
	serviceFeeRate := getRate("transfer_service_fee_rate", 1) / 100
	vatRate := getRate("transfer_vat_rate", 15) / 100

	stampDutyType := getStr("transfer_stamp_duty_type", "fixed")
	stampDutyAmount := getRate("transfer_stamp_duty_amount", 5)
	stampDutyRate := getRate("transfer_stamp_duty_rate", 0.5) / 100

	serviceFeeMin := getRate("transfer_service_fee_min_low_shares", 1000)
	serviceFeeMax := getRate("transfer_service_fee_max", 20000)
	lowSharesThreshold := int64(getRate("transfer_service_fee_low_shares_threshold", 100))

	// Cost basis fallback = company par from BankCapital
	companyPar := 0.0
	var bc models.BankCapital
	if err := database.DB.First(&bc).Error; err == nil && bc.ParValuePerShare > 0 {
		companyPar = bc.ParValuePerShare
	}
	costBasis := companyPar

	if len(lines) > 0 {
		var totalShares int64
		var weightedSum float64
		for _, ln := range lines {
			shares := ln.PaidSharesToTransfer + ln.UnpaidSharesToTransfer
			if shares <= 0 || ln.FromAllocationID == 0 {
				continue
			}
			var alloc models.Allocation
			if err := database.DB.First(&alloc, ln.FromAllocationID).Error; err != nil {
				continue
			}
			cb := companyPar
			if alloc.AllocatedShares > 0 {
				cb = alloc.AllocatedAmount / float64(alloc.AllocatedShares)
			}
			out.LineCosts = append(out.LineCosts, map[string]interface{}{
				"allocation_id":        alloc.ID,
				"shares":               shares,
				"cost_basis_per_share": cb,
			})
			weightedSum += cb * float64(shares)
			totalShares += shares
		}
		if totalShares > 0 {
			costBasis = weightedSum / float64(totalShares)
		}
	} else if fromAllocationID != nil {
		var alloc models.Allocation
		if err := database.DB.First(&alloc, *fromAllocationID).Error; err == nil && alloc.AllocatedShares > 0 {
			costBasis = alloc.AllocatedAmount / float64(alloc.AllocatedShares)
			out.LineCosts = append(out.LineCosts, map[string]interface{}{
				"allocation_id":        alloc.ID,
				"shares":               numberOfShares,
				"cost_basis_per_share": costBasis,
			})
		}
	}

	out.CostBasisPerShare = costBasis
	out.GainPerShare = pricePerShare - costBasis
	if out.GainPerShare < 0 {
		out.GainPerShare = 0
	}
	out.CapitalGain = out.GainPerShare * float64(numberOfShares)
	out.CapitalGainTax = out.CapitalGain * capitalGainRate
	out.CapitalGainTaxRate = capitalGainRate * 100

	// Service fee with floor + cap.
	// Base is shares × COMPANY PAR (not the selling price). The service fee
	// is a registry/processing charge on the nominal value of the shares
	// being moved, independent of the price the parties agreed. So 200 shares
	// at company par 1,000 → base 200,000 → 1% → 2,000 ETB, regardless of
	// whether they sold at 1,200 or 800 per share.
	serviceFeeBase := float64(numberOfShares) * companyPar
	if companyPar <= 0 {
		// No company par configured — fall back to transfer value so the fee
		// isn't silently zero.
		serviceFeeBase = out.TransferValue
	}
	sf := serviceFeeBase * serviceFeeRate
	if numberOfShares < lowSharesThreshold && sf < serviceFeeMin {
		sf = serviceFeeMin
		out.ServiceFeeFloorApplied = true
	}
	if sf > serviceFeeMax {
		sf = serviceFeeMax
		out.ServiceFeeCapApplied = true
	}
	out.ServiceFee = sf
	out.ServiceFeeRate = serviceFeeRate * 100
	out.ServiceFeeMin = serviceFeeMin
	out.ServiceFeeMax = serviceFeeMax
	out.LowSharesThreshold = lowSharesThreshold

	if stampDutyType == "percent" {
		out.StampDuty = out.TransferValue * stampDutyRate
	} else {
		out.StampDuty = stampDutyAmount
	}
	out.StampDutyType = stampDutyType
	out.StampDutyRate = stampDutyRate * 100
	out.StampDutyAmount = stampDutyAmount

	out.VAT = out.ServiceFee * vatRate
	out.VATRate = vatRate * 100
	out.TotalFees = out.CapitalGainTax + out.ServiceFee + out.StampDuty + out.VAT
	return out
}

func CalculateTransferFees(c *gin.Context) {
	var input struct {
		NumberOfShares   int64              `json:"number_of_shares" binding:"required"`
		ParValue         float64            `json:"par_value" binding:"required"`
		PricePerShare    float64            `json:"price_per_share"`
		FromAllocationID *uint              `json:"from_allocation_id"`
		Lines            []calcFeeLineInput `json:"lines"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.PricePerShare <= 0 {
		input.PricePerShare = input.ParValue
	}
	b := computeTransferFees(input.NumberOfShares, input.PricePerShare, input.FromAllocationID, input.Lines)
	c.JSON(http.StatusOK, gin.H{
		"transfer_value":            b.TransferValue,
		"cost_basis_per_share":      b.CostBasisPerShare,
		"selling_price_per_share":   b.SellingPricePerShare,
		"gain_per_share":            b.GainPerShare,
		"capital_gain":              b.CapitalGain,
		"capital_gain_tax":          b.CapitalGainTax,
		"capital_gain_tax_rate":     b.CapitalGainTaxRate,
		"line_costs":                b.LineCosts,
		"service_fee":               b.ServiceFee,
		"service_fee_rate":          b.ServiceFeeRate,
		"service_fee_min":           b.ServiceFeeMin,
		"service_fee_max":           b.ServiceFeeMax,
		"service_fee_floor_applied": b.ServiceFeeFloorApplied,
		"service_fee_cap_applied":   b.ServiceFeeCapApplied,
		"low_shares_threshold":      b.LowSharesThreshold,
		"stamp_duty":                b.StampDuty,
		"stamp_duty_type":           b.StampDutyType,
		"stamp_duty_rate":           b.StampDutyRate,
		"stamp_duty_amount":         b.StampDutyAmount,
		"vat":                       b.VAT,
		"vat_rate":                  b.VATRate,
		"total_fees":                b.TotalFees,
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
