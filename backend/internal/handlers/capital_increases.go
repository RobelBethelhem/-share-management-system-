package handlers

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ============================================================
// Capital Increase Share Allocation
// ============================================================
// Algorithm: each round distributes the remaining pool of new shares in
// whole numbers using the Hamilton (largest-remainder) method. The basis
// is each shareholder's fully-paid shares — pre-CI in round 1, plus paid
// shares from this CI's earlier rounds in rounds 2+.

// ----- helpers -----

// ciBaseBreakdown is the full per-shareholder basis breakdown used for
// transparency in the preview UI.
//
// Basis = TotalAllocatedShares + CIAllocatedShares
//   pre-CI total allocated (paid + unpaid) + total allocated (paid + unpaid)
//   from earlier rounds of this CI.
//
// We intentionally use the FULL allocated count, not just paid. The intent
// is that every share a shareholder is entitled to (regardless of whether
// they've finished paying for it) counts as their basis for receiving new
// shares in a capital increase. PaidShares / UnpaidShares are kept in the
// payload for UI transparency but no longer drive the Hamilton math.
type ciBaseBreakdown struct {
	AllocationCount      int   `json:"allocation_count"`
	TotalAllocatedShares int64 `json:"total_allocated_shares"` // pre-CI total (paid + unpaid)
	PaidShares           int64 `json:"paid_shares"`            // pre-CI paid (FIFO) — display only
	UnpaidShares         int64 `json:"unpaid_shares"`          // pre-CI unpaid — display only
	CIAllocatedShares    int64 `json:"ci_allocated_shares"`    // round 2+: total allocated from earlier rounds of this CI
	Total                int64 `json:"total"`                  // basis used by Hamilton
}

func ciBaseBreakdownFor(ciID uint, round int, shareholderID uint) ciBaseBreakdown {
	var b ciBaseBreakdown
	// Pre-CI allocations
	var preCIAllocs []models.Allocation
	database.DB.Where("shareholder_id = ? AND capital_increase_id IS NULL", shareholderID).
		Order("id ASC").Find(&preCIAllocs)
	b.AllocationCount = len(preCIAllocs)
	for _, a := range preCIAllocs {
		b.TotalAllocatedShares += a.AllocatedShares
		b.PaidShares += computeAllocPaidShares(shareholderID, a.ID)
	}

	// Shares moved by LEGACY transfers (no allocation link): the transferee's
	// transfer_in (+shares) has no allocation row, and the transferor's
	// allocations were never shrunk — their transfer_out (−shares) is the only
	// record. Both are invisible to the allocation sum above, so a shareholder
	// who joined purely by transfer would get basis 0 and be excluded from the
	// capital increase. Add the net unlinked transfer share delta so transfer-
	// received shares count as basis (and legacy transferors aren't overstated).
	var unlinkedTransferShares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = 'active' AND approval_status = 'approved' AND allocation_id IS NULL AND payment_method IN ('transfer_in','transfer_out')", shareholderID).
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&unlinkedTransferShares)
	b.TotalAllocatedShares += unlinkedTransferShares
	if b.TotalAllocatedShares < 0 {
		b.TotalAllocatedShares = 0
	}
	// Transfers move fully-paid shares — reflect them in the paid display too.
	b.PaidShares += unlinkedTransferShares
	if b.PaidShares < 0 {
		b.PaidShares = 0
	}

	b.UnpaidShares = b.TotalAllocatedShares - b.PaidShares
	if b.UnpaidShares < 0 {
		b.UnpaidShares = 0
	}

	// Round 2+: total allocated (paid + unpaid) from earlier rounds of THIS CI
	if round > 1 {
		var thisCIAllocs []models.Allocation
		database.DB.Where("shareholder_id = ? AND capital_increase_id = ? AND round < ?",
			shareholderID, ciID, round).
			Order("id ASC").Find(&thisCIAllocs)
		for _, a := range thisCIAllocs {
			b.CIAllocatedShares += a.AllocatedShares
		}
	}
	b.Total = b.TotalAllocatedShares + b.CIAllocatedShares
	return b
}

// fullyConfirmedAllPreSubsInCI returns true iff every pre-subscription the
// shareholder has in this CI was followed by a confirmation of the FULL
// offered amount. Partial confirmations, declines, and not-yet-confirmed
// pre-subs all count as "not fully confirmed".
//
// Used as a gate when creating CIAdditionalRequest rows — a shareholder
// who hasn't accepted everything offered cannot ask for MORE.
func fullyConfirmedAllPreSubsInCI(ciID, shareholderID uint) bool {
	var preSubs []models.Subscription
	database.DB.Where(
		"capital_increase_id = ? AND shareholder_id = ? AND type = ?",
		ciID, shareholderID, "pre-subscription",
	).Find(&preSubs)
	if len(preSubs) == 0 {
		// No pre-subs at all — they aren't in this CI yet; can't ask for additional.
		return false
	}
	for _, ps := range preSubs {
		var conf models.Subscription
		err := database.DB.Where(
			"capital_increase_id = ? AND shareholder_id = ? AND type = ? AND round = ? AND status = ?",
			ciID, shareholderID, "confirmation", ps.Round, "active",
		).First(&conf).Error
		if err != nil || conf.NumberOfShares < ps.NumberOfShares {
			return false
		}
	}
	return true
}

// fullyConfirmedAllPriorRounds returns true iff every pre-subscription the
// shareholder had in rounds 1..upToRound-1 of this CI was followed by a
// confirmation of the FULL offered amount.
//
// Used as a gate for round 2+ allocation: a shareholder who partially
// confirmed (or didn't confirm at all) in an earlier round must NOT receive
// additional allocations in later rounds, even if they have a pending
// additional request.
func fullyConfirmedAllPriorRounds(ciID, shareholderID uint, upToRound int) bool {
	var preSubs []models.Subscription
	database.DB.Where(
		"capital_increase_id = ? AND shareholder_id = ? AND type = ? AND round < ?",
		ciID, shareholderID, "pre-subscription", upToRound,
	).Find(&preSubs)
	if len(preSubs) == 0 {
		return true // no prior pre-subs → gate doesn't apply
	}
	for _, ps := range preSubs {
		var conf models.Subscription
		err := database.DB.Where(
			"capital_increase_id = ? AND shareholder_id = ? AND type = ? AND round = ? AND status = ?",
			ciID, shareholderID, "confirmation", ps.Round, "active",
		).First(&conf).Error
		if err != nil || conf.NumberOfShares < ps.NumberOfShares {
			return false
		}
	}
	return true
}

// ciRemainingPool returns total_new_shares minus shares already confirmed
// in earlier rounds of this CI (i.e., subscriptions of type "confirmation"
// or "additional" with status="active").
func ciRemainingPool(ci *models.CapitalIncrease) int64 {
	var confirmed int64
	database.DB.Model(&models.Subscription{}).
		Where("capital_increase_id = ? AND type IN ? AND status = ?",
			ci.ID, []string{"confirmation", "additional"}, "active").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&confirmed)
	rem := ci.TotalNewShares - confirmed
	if rem < 0 {
		rem = 0
	}
	return rem
}

type ciAllocEntry struct {
	ShareholderID   uint            `json:"shareholder_id"`
	ShareholderName string          `json:"shareholder_name"`
	AccountNo       string          `json:"account_no"`
	Breakdown       ciBaseBreakdown `json:"breakdown"`
	BaseShares      int64           `json:"base_shares"`
	// Formula transparency: WillGet = min(Floor + RemainderUplift, RequestCap)
	//   exact = pool * base_shares / total_basis
	//   floor = floor(exact)
	//   frac  = exact - floor
	//   uplift = +1 if this row was awarded a remainder share via Hamilton (largest-remainder)
	//   request_cap = sum of remaining (requested - fulfilled) across this shareholder's
	//                 pending+partial additional requests (only applies for round 2+)
	//   cap_binds   = true if the cap reduced the Hamilton result
	ExactClaim      float64         `json:"exact_claim"`
	FloorShares     int64           `json:"floor_shares"`
	Frac            float64         `json:"frac"`
	RemainderUplift int64           `json:"remainder_uplift"`
	RequestCap      *int64          `json:"request_cap"`
	CapBinds        bool            `json:"cap_binds"`
	AllocatedShares int64           `json:"allocated_shares"`
}

// pendingRequestCapsByShareholder returns, for each shareholder, the total
// remaining (requested - fulfilled) across their pending+partial additional
// requests in this CI. Round-2+ allocations are capped by this value.
func pendingRequestCapsByShareholder(ciID uint) map[uint]int64 {
	var reqs []models.CIAdditionalRequest
	database.DB.Where("capital_increase_id = ? AND status IN ?",
		ciID, []string{"pending", "partial"}).Find(&reqs)
	caps := map[uint]int64{}
	for _, r := range reqs {
		left := r.RequestedShares - r.FulfilledShares
		if left > 0 {
			caps[r.ShareholderID] += left
		}
	}
	return caps
}

// computeRoundAllocation runs the Hamilton largest-remainder algorithm
// for the given round and returns one entry per eligible shareholder
// (including those who get 0, so callers can show the full picture).
//
//   - Round 1:  every active shareholder with paid pre-CI shares participates.
//   - Round 2+: only shareholders with pending+partial additional requests
//               participate, and each shareholder's allocation is capped at
//               their remaining (requested - fulfilled) sum.
//
// The second return is the pool; the third is the total basis among the
// shareholders who actually participated.
func computeRoundAllocation(ci *models.CapitalIncrease, round int) ([]ciAllocEntry, int64, int64, error) {
	pool := ciRemainingPool(ci)
	if pool <= 0 {
		return nil, 0, 0, errors.New("no shares remaining in the pool")
	}

	var shareholders []models.Shareholder
	database.DB.Where("status = ?", "active").Order("id ASC").Find(&shareholders)
	if len(shareholders) == 0 {
		return nil, pool, 0, errors.New("no active shareholders")
	}

	// For round 2+, eligibility is gated by pending additional requests.
	var caps map[uint]int64
	if round >= 2 {
		caps = pendingRequestCapsByShareholder(ci.ID)
		if len(caps) == 0 {
			return nil, pool, 0, errors.New("no pending additional requests — open the additional-request phase to keep distributing")
		}
	}

	type calcRow struct {
		idx       int
		breakdown ciBaseBreakdown
		base      int64
		exact     float64
		floor     int64
		frac      float64
		uplift    int64
		cap       *int64
		capBinds  bool
		shID      uint
	}
	rows := make([]calcRow, 0, len(shareholders))
	breakdownByIdx := make(map[int]ciBaseBreakdown, len(shareholders))
	var totalBase int64
	for i, s := range shareholders {
		bd := ciBaseBreakdownFor(ci.ID, round, s.ID)
		breakdownByIdx[i] = bd
		if bd.Total <= 0 {
			continue
		}
		var rowCap *int64
		if round >= 2 {
			lim, ok := caps[s.ID]
			if !ok || lim <= 0 {
				// No pending additional request for this shareholder — they
				// don't participate in this round at all.
				continue
			}
			// Partial-confirmation gate: a shareholder who didn't fully
			// confirm every prior-round pre-sub is locked out of further
			// CI rounds, even if they have a pending additional request.
			if !fullyConfirmedAllPriorRounds(ci.ID, s.ID, round) {
				continue
			}
			rowCap = &lim
		}
		rows = append(rows, calcRow{idx: i, breakdown: bd, base: bd.Total, shID: s.ID, cap: rowCap})
		totalBase += bd.Total
	}
	if totalBase == 0 {
		return nil, pool, 0, errors.New("no eligible shareholders with paid shares for this round")
	}

	var distributed int64
	for i := range rows {
		exact := float64(pool) * float64(rows[i].base) / float64(totalBase)
		floor := int64(math.Floor(exact))
		rows[i].exact = exact
		rows[i].floor = floor
		rows[i].frac = exact - float64(floor)
		distributed += floor
	}
	leftover := pool - distributed

	// Hamilton tie-break: highest fractional remainder first; on ties,
	// larger base wins; final tie broken by lower shareholder ID.
	sorted := make([]int, len(rows))
	for i := range rows {
		sorted[i] = i
	}
	sort.Slice(sorted, func(a, b int) bool {
		ra, rb := rows[sorted[a]], rows[sorted[b]]
		if ra.frac != rb.frac {
			return ra.frac > rb.frac
		}
		if ra.base != rb.base {
			return ra.base > rb.base
		}
		return ra.shID < rb.shID
	})
	for k := int64(0); k < leftover && k < int64(len(sorted)); k++ {
		rows[sorted[k]].uplift = 1
	}

	// Apply request caps (round 2+). Any excess from a binding cap rolls
	// over to the next round's pool implicitly — pool is recomputed each
	// round from confirmed shares, not from offered shares.
	for i := range rows {
		want := rows[i].floor + rows[i].uplift
		if rows[i].cap != nil && want > *rows[i].cap {
			rows[i].capBinds = true
		}
	}

	// Build result rows; include zero-basis shareholders too so callers
	// can render the full picture (Will Get = 0, basis = 0).
	out := make([]ciAllocEntry, 0, len(shareholders))
	rowByIdx := make(map[int]calcRow, len(rows))
	for _, r := range rows {
		rowByIdx[r.idx] = r
	}
	for i, s := range shareholders {
		r, ok := rowByIdx[i]
		if !ok {
			out = append(out, ciAllocEntry{
				ShareholderID:   s.ID,
				ShareholderName: s.GetFullName(),
				AccountNo:       s.AccountNo,
				Breakdown:       breakdownByIdx[i],
				BaseShares:      0,
				AllocatedShares: 0,
			})
			continue
		}
		allocated := r.floor + r.uplift
		if r.cap != nil && allocated > *r.cap {
			allocated = *r.cap
		}
		out = append(out, ciAllocEntry{
			ShareholderID:   s.ID,
			ShareholderName: s.GetFullName(),
			AccountNo:       s.AccountNo,
			Breakdown:       r.breakdown,
			BaseShares:      r.base,
			ExactClaim:      r.exact,
			FloorShares:     r.floor,
			Frac:            r.frac,
			RemainderUplift: r.uplift,
			RequestCap:      r.cap,
			CapBinds:        r.capBinds,
			AllocatedShares: allocated,
		})
	}
	return out, pool, totalBase, nil
}

// ----- list / detail / create / update -----

func GetCapitalIncreases(c *gin.Context) {
	var items []models.CapitalIncrease
	database.DB.Order("id DESC").Find(&items)
	c.JSON(http.StatusOK, gin.H{"data": items})
}

func GetCapitalIncrease(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}

	// Per-round breakdown
	type RoundSummary struct {
		Round          int   `json:"round"`
		PreSubShares   int64 `json:"pre_sub_shares"`
		ConfirmedShares int64 `json:"confirmed_shares"`
		PreSubCount    int64 `json:"pre_sub_count"`
		ConfirmedCount int64 `json:"confirmed_count"`
	}
	rounds := []RoundSummary{}
	for r := 1; r <= ci.CurrentRound; r++ {
		var rs RoundSummary
		rs.Round = r
		database.DB.Model(&models.Subscription{}).
			Where("capital_increase_id = ? AND round = ? AND type = ?", ci.ID, r, "pre-subscription").
			Select("COALESCE(SUM(number_of_shares),0)").Scan(&rs.PreSubShares)
		database.DB.Model(&models.Subscription{}).
			Where("capital_increase_id = ? AND round = ? AND type = ?", ci.ID, r, "pre-subscription").
			Count(&rs.PreSubCount)
		database.DB.Model(&models.Subscription{}).
			Where("capital_increase_id = ? AND round = ? AND type = ? AND status = ?", ci.ID, r, "confirmation", "active").
			Select("COALESCE(SUM(number_of_shares),0)").Scan(&rs.ConfirmedShares)
		database.DB.Model(&models.Subscription{}).
			Where("capital_increase_id = ? AND round = ? AND type = ? AND status = ?", ci.ID, r, "confirmation", "active").
			Count(&rs.ConfirmedCount)
		rounds = append(rounds, rs)
	}

	// Self-heal: legacy additional requests submitted before round-tagging
	// landed in the DB with Round = 0. Backfill them to the current round so
	// they surface in the right round tab.
	if ci.CurrentRound > 0 {
		database.DB.Model(&models.CIAdditionalRequest{}).
			Where("capital_increase_id = ? AND round = 0", ci.ID).
			Update("round", ci.CurrentRound)
	}

	// Pull the additional requests for this CI so the round tab can show
	// per-shareholder request totals alongside the confirmation column.
	var addReqs []models.CIAdditionalRequest
	database.DB.Where("capital_increase_id = ?", ci.ID).Order("id ASC").Find(&addReqs)

	c.JSON(http.StatusOK, gin.H{
		"data":                ci,
		"rounds":              rounds,
		"remaining":           ciRemainingPool(&ci),
		"additional_requests": addReqs,
	})
}

type ciCreateInput struct {
	Label          string  `json:"label" binding:"required"`
	TotalNewShares int64   `json:"total_new_shares" binding:"required,gt=0"`
	ParValue       float64 `json:"par_value" binding:"required,gt=0"`
	MaxAutoRounds  int     `json:"max_auto_rounds"`
	Remark         string  `json:"remark"`
}

func CreateCapitalIncrease(c *gin.Context) {
	var input ciCreateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.MaxAutoRounds <= 0 {
		input.MaxAutoRounds = 3
	}
	ci := models.CapitalIncrease{
		Label:          input.Label,
		TotalNewShares: input.TotalNewShares,
		ParValue:       input.ParValue,
		MaxAutoRounds:  input.MaxAutoRounds,
		Remark:         input.Remark,
		Status:         "draft",
	}
	if err := database.DB.Create(&ci).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Queue a PendingApproval so the CI shows up in the Authorization tab.
	// Status stays "draft" until an admin approves there → "approved" → admin
	// then clicks Start on the campaign detail page to enter round_open.
	database.DB.Create(&models.PendingApproval{
		EntityType:  "capital_increase",
		EntityID:    ci.ID,
		Action:      "create",
		RequestedBy: getUserID(c),
		Status:      "pending",
		RequestedAt: time.Now(),
	})
	c.JSON(http.StatusCreated, gin.H{"message": "Capital increase created, pending authorization", "id": ci.ID, "data": ci})
}

func UpdateCapitalIncrease(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	if ci.Status != "draft" {
		c.JSON(http.StatusConflict, gin.H{"error": "Only draft capital increases can be edited"})
		return
	}
	var input ciCreateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ci.Label = input.Label
	ci.TotalNewShares = input.TotalNewShares
	ci.ParValue = input.ParValue
	if input.MaxAutoRounds > 0 {
		ci.MaxAutoRounds = input.MaxAutoRounds
	}
	ci.Remark = input.Remark
	database.DB.Save(&ci)
	c.JSON(http.StatusOK, gin.H{"message": "Capital increase updated", "data": ci})
}

// ----- lifecycle -----

func StartCapitalIncrease(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	if ci.Status != "approved" {
		c.JSON(http.StatusConflict, gin.H{"error": "Only approved capital increases can be started. Approve it from the Authorization tab first."})
		return
	}
	// Disallow concurrent active CIs.
	var activeCount int64
	database.DB.Model(&models.CapitalIncrease{}).
		Where("status IN ?", []string{"round_open", "additional_open"}).
		Count(&activeCount)
	if activeCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Another capital increase is already active"})
		return
	}
	now := time.Now()
	ci.Status = "round_open"
	ci.CurrentRound = 0
	ci.StartedAt = &now
	database.DB.Save(&ci)
	c.JSON(http.StatusOK, gin.H{"message": "Capital increase started", "data": ci})
}

func PreviewCIRound(c *gin.Context) {
	id := c.Param("id")
	roundStr := c.Param("round")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	round, _ := strconv.Atoi(roundStr)
	if round <= 0 {
		round = ci.CurrentRound + 1
	}
	entries, pool, totalBasis, err := computeRoundAllocation(&ci, round)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var sum int64
	for _, e := range entries {
		sum += e.AllocatedShares
	}
	c.JSON(http.StatusOK, gin.H{
		"round":              round,
		"pool":               pool,
		"total_basis":        totalBasis,
		"allocated_in_round": sum,
		"entries":            entries,
	})
}

type ciRunRoundInput struct {
	Round int `json:"round" binding:"required,gt=0"`
}

func RunCIRound(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	if ci.Status != "round_open" && ci.Status != "additional_open" {
		c.JSON(http.StatusConflict, gin.H{"error": "Capital increase is not active"})
		return
	}
	var input ciRunRoundInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.Round > ci.MaxAutoRounds {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Round exceeds the configured max auto rounds"})
		return
	}
	// Block re-running a round that already has pre-subscriptions.
	var existing int64
	database.DB.Model(&models.Subscription{}).
		Where("capital_increase_id = ? AND round = ? AND type = ?", ci.ID, input.Round, "pre-subscription").
		Count(&existing)
	if existing > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Round has already been run"})
		return
	}

	entries, _, _, err := computeRoundAllocation(&ci, input.Round)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	now := time.Now()
	created := 0
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		for _, e := range entries {
			if e.AllocatedShares <= 0 {
				continue
			}
			sub := models.Subscription{
				ShareholderID:     e.ShareholderID,
				SubscriptionNo:    fmt.Sprintf("CI-%d-R%d-%d", ci.ID, input.Round, e.ShareholderID),
				Type:              "pre-subscription",
				ShareAmount:       float64(e.AllocatedShares) * ci.ParValue,
				NumberOfShares:    e.AllocatedShares,
				ParValue:          ci.ParValue,
				SubscriptionDate:  &now,
				Status:            "active",
				IsProportional:    true,
				ApprovalStatus:    "approved",
				CapitalIncreaseID: &ci.ID,
				Round:             input.Round,
				BaseShares:        e.BaseShares,
			}
			if err := tx.Create(&sub).Error; err != nil {
				return err
			}
			created++
		}
		ci.CurrentRound = input.Round
		// If we were in additional_open (manual phase), running an auto round
		// brings us back to the active round flow.
		ci.Status = "round_open"
		return tx.Save(&ci).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":      "Round executed",
		"round":        input.Round,
		"created":      created,
	})
}

// ConfirmCISubscriptionInput is the body of the confirm endpoint.
//   - ConfirmedShares: how many of the offered shares the shareholder accepts
//     (0 = decline; the difference between offered and confirmed flows back
//     into the pool for the next round).
//   - AdditionalRequested: optional extra shares the shareholder wants beyond
//     the offer; creates a CIAdditionalRequest that caps next-round allocation.
type ConfirmCISubscriptionInput struct {
	ConfirmedShares     *int64 `json:"confirmed_shares"`
	AdditionalRequested int64  `json:"additional_requested"`
	Note                string `json:"note"`
}

// ConfirmCISubscription records a shareholder's decision on a pre-subscription:
// they may confirm fully, partially, or decline (confirmed_shares = 0), and
// optionally register an additional-share request. For round 2+ pre-subs,
// the confirmed shares first reduce the shareholder's pending additional
// requests FIFO (so requests get marked partial/fulfilled correctly).
func ConfirmCISubscription(c *gin.Context) {
	id := c.Param("id")
	subID := c.Param("subId")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	var sub models.Subscription
	if err := database.DB.First(&sub, subID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}
	if sub.CapitalIncreaseID == nil || *sub.CapitalIncreaseID != ci.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Subscription does not belong to this capital increase"})
		return
	}
	if sub.Type != "pre-subscription" {
		c.JSON(http.StatusConflict, gin.H{"error": "Only pre-subscriptions can be confirmed"})
		return
	}
	if sub.ShareholderConfirmedAt != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Subscription is already confirmed"})
		return
	}
	if sub.Status == "expired" || sub.Status == "declined" {
		c.JSON(http.StatusConflict, gin.H{"error": "Pre-subscription is no longer active"})
		return
	}

	var input ConfirmCISubscriptionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.ConfirmedShares == nil {
		// Backward compatibility: missing field means "confirm the full offer".
		full := sub.NumberOfShares
		input.ConfirmedShares = &full
	}
	confirmed := *input.ConfirmedShares
	if confirmed < 0 || confirmed > sub.NumberOfShares {
		c.JSON(http.StatusBadRequest, gin.H{"error": "confirmed_shares must be between 0 and the offered amount"})
		return
	}
	if input.AdditionalRequested < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "additional_requested cannot be negative"})
		return
	}
	// Gate: a shareholder asking for additional shares in this CI must also
	// confirm THIS pre-sub in full (otherwise they're partial-confirming AND
	// asking for more, which contradicts the campaign's rules).
	if input.AdditionalRequested > 0 && confirmed < sub.NumberOfShares {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Cannot request additional shares with a partial confirmation. Confirm the full offered amount first, then ask for additional.",
		})
		return
	}

	now := time.Now()
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		// Always mark the pre-sub as acted-on so it doesn't get re-confirmed
		// or auto-expired on round close. Also persist the note here so it
		// survives even on a decline (where no confirmation row is created).
		sub.ShareholderConfirmedAt = &now
		if input.Note != "" {
			sub.Remark = input.Note
		}
		if confirmed == 0 {
			sub.Status = "declined"
		}
		if err := tx.Save(&sub).Error; err != nil {
			return err
		}

		if confirmed > 0 {
			confirmation := models.Subscription{
				ShareholderID:          sub.ShareholderID,
				SubscriptionNo:         fmt.Sprintf("CI-%d-R%d-%d-C", ci.ID, sub.Round, sub.ShareholderID),
				Type:                   "confirmation",
				ShareAmount:            float64(confirmed) * sub.ParValue,
				NumberOfShares:         confirmed,
				ParValue:               sub.ParValue,
				SubscriptionDate:       &now,
				Status:                 "active",
				IsProportional:         true,
				ApprovalStatus:         "approved",
				CapitalIncreaseID:      &ci.ID,
				Round:                  sub.Round,
				ShareholderConfirmedAt: &now,
				BaseShares:             sub.BaseShares,
				Remark:                 input.Note,
			}
			if err := tx.Create(&confirmation).Error; err != nil {
				return err
			}
			alloc := models.Allocation{
				ShareholderID:     sub.ShareholderID,
				SubscriptionID:    &confirmation.ID,
				AllocationNo:      fmt.Sprintf("CI-%d-R%d-A-%d", ci.ID, sub.Round, sub.ShareholderID),
				Round:             sub.Round,
				AllocatedShares:   confirmed,
				AllocatedAmount:   confirmation.ShareAmount,
				AllocationDate:    &now,
				Status:            "allocated",
				ApprovalStatus:    "approved",
				CapitalIncreaseID: &ci.ID,
			}
			if err := tx.Create(&alloc).Error; err != nil {
				return err
			}

			// For round 2+ confirmations, drain pending additional requests
			// FIFO. The confirmation fulfills part (or all) of what the
			// shareholder previously asked for.
			if sub.Round >= 2 {
				remaining := confirmed
				var reqs []models.CIAdditionalRequest
				tx.Where("capital_increase_id = ? AND shareholder_id = ? AND status IN ?",
					ci.ID, sub.ShareholderID, []string{"pending", "partial"}).
					Order("id ASC").Find(&reqs)
				for i := range reqs {
					if remaining <= 0 {
						break
					}
					left := reqs[i].RequestedShares - reqs[i].FulfilledShares
					if left <= 0 {
						continue
					}
					take := remaining
					if take > left {
						take = left
					}
					reqs[i].FulfilledShares += take
					if reqs[i].FulfilledShares >= reqs[i].RequestedShares {
						reqs[i].Status = "fulfilled"
					} else {
						reqs[i].Status = "partial"
					}
					if err := tx.Save(&reqs[i]).Error; err != nil {
						return err
					}
					remaining -= take
				}
			}
		}

		// Optional: a new additional request raised during this confirmation.
		if input.AdditionalRequested > 0 {
			req := models.CIAdditionalRequest{
				CapitalIncreaseID: ci.ID,
				ShareholderID:     sub.ShareholderID,
				Round:             sub.Round,
				RequestedShares:   input.AdditionalRequested,
				Status:            "pending",
				Note:              input.Note,
			}
			if err := tx.Create(&req).Error; err != nil {
				return err
			}
		}

		// Refresh CI running total (counts only what's actually been confirmed
		// or admin-approved-additional, not what was offered).
		var confirmedTotal int64
		tx.Model(&models.Subscription{}).
			Where("capital_increase_id = ? AND type IN ? AND status = ?",
				ci.ID, []string{"confirmation", "additional"}, "active").
			Select("COALESCE(SUM(number_of_shares),0)").Scan(&confirmedTotal)
		ci.AllocatedShares = confirmedTotal
		return tx.Save(&ci).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Confirmation recorded"})
}

// ReverseCISubscription undoes a confirm/decline on a pre-subscription so the
// admin can re-confirm with a corrected amount. It is destructive but bounded:
//
//   - The sibling confirmation Subscription (if any) and its Allocation are deleted.
//   - Additional requests created during this round by this shareholder are
//     deleted ONLY IF their fulfilled_shares == 0 (i.e., not already drained
//     by a later round's confirmation).
//   - The pre-sub is reset to active.
//   - FIFO fulfillment for the shareholder's remaining pending+partial requests
//     is recomputed from scratch by replaying surviving Round-2+ confirmations,
//     so undo leaves the request ledger consistent.
//   - ci.AllocatedShares is recomputed from the surviving confirmations.
//
// This endpoint is intended for admin corrections and testing — it is not part
// of the normal flow.
func ReverseCISubscription(c *gin.Context) {
	id := c.Param("id")
	subID := c.Param("subId")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	var sub models.Subscription
	if err := database.DB.First(&sub, subID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}
	if sub.CapitalIncreaseID == nil || *sub.CapitalIncreaseID != ci.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Subscription does not belong to this capital increase"})
		return
	}
	if sub.Type != "pre-subscription" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only pre-subscriptions can be reversed"})
		return
	}
	if sub.ShareholderConfirmedAt == nil && sub.Status == "active" {
		c.JSON(http.StatusConflict, gin.H{"error": "Nothing to reverse — pre-subscription has not been acted on"})
		return
	}

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Delete sibling confirmation rows and their allocations.
		var confs []models.Subscription
		tx.Where("capital_increase_id = ? AND shareholder_id = ? AND round = ? AND type = ? AND status = ?",
			ci.ID, sub.ShareholderID, sub.Round, "confirmation", "active").
			Find(&confs)
		for _, conf := range confs {
			if err := tx.Where("subscription_id = ?", conf.ID).Delete(&models.Allocation{}).Error; err != nil {
				return err
			}
			// Hard-delete (Subscription has soft delete; bypass it for clean undo)
			if err := tx.Unscoped().Delete(&conf).Error; err != nil {
				return err
			}
		}

		// 2. Delete unused additional requests created during THIS round by this
		//    shareholder. Skip any that have already been partially fulfilled
		//    by a later round — those need a different remediation path.
		if err := tx.Where(
			"capital_increase_id = ? AND shareholder_id = ? AND round = ? AND fulfilled_shares = 0",
			ci.ID, sub.ShareholderID, sub.Round,
		).Delete(&models.CIAdditionalRequest{}).Error; err != nil {
			return err
		}

		// 3. Reset the pre-sub.
		sub.ShareholderConfirmedAt = nil
		sub.Status = "active"
		sub.Remark = ""
		if err := tx.Save(&sub).Error; err != nil {
			return err
		}

		// 4. Replay FIFO fulfillment for this shareholder's CI requests.
		//    Reset all of them, then drain by each surviving Round-2+
		//    confirmation in chronological order.
		var allReqs []models.CIAdditionalRequest
		tx.Where("capital_increase_id = ? AND shareholder_id = ?", ci.ID, sub.ShareholderID).
			Order("id ASC").Find(&allReqs)
		for i := range allReqs {
			if allReqs[i].FulfilledShares != 0 || (allReqs[i].Status != "pending") {
				allReqs[i].FulfilledShares = 0
				if allReqs[i].Status != "rejected" && allReqs[i].Status != "expired" {
					allReqs[i].Status = "pending"
				}
				if err := tx.Save(&allReqs[i]).Error; err != nil {
					return err
				}
			}
		}
		var survivors []models.Subscription
		tx.Where("capital_increase_id = ? AND shareholder_id = ? AND type = ? AND status = ? AND round >= ?",
			ci.ID, sub.ShareholderID, "confirmation", "active", 2).
			Order("id ASC").Find(&survivors)
		for _, conf := range survivors {
			remaining := conf.NumberOfShares
			var reqs []models.CIAdditionalRequest
			tx.Where("capital_increase_id = ? AND shareholder_id = ? AND status IN ?",
				ci.ID, sub.ShareholderID, []string{"pending", "partial"}).
				Order("id ASC").Find(&reqs)
			for i := range reqs {
				if remaining <= 0 {
					break
				}
				left := reqs[i].RequestedShares - reqs[i].FulfilledShares
				if left <= 0 {
					continue
				}
				take := remaining
				if take > left {
					take = left
				}
				reqs[i].FulfilledShares += take
				if reqs[i].FulfilledShares >= reqs[i].RequestedShares {
					reqs[i].Status = "fulfilled"
				} else {
					reqs[i].Status = "partial"
				}
				if err := tx.Save(&reqs[i]).Error; err != nil {
					return err
				}
				remaining -= take
			}
		}

		// 5. Recompute ci.AllocatedShares from surviving confirmations.
		var confirmedTotal int64
		tx.Model(&models.Subscription{}).
			Where("capital_increase_id = ? AND type IN ? AND status = ?",
				ci.ID, []string{"confirmation", "additional"}, "active").
			Select("COALESCE(SUM(number_of_shares),0)").Scan(&confirmedTotal)
		ci.AllocatedShares = confirmedTotal
		return tx.Save(&ci).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Reversed"})
}

type ciCloseRoundInput struct {
	Round int `json:"round" binding:"required,gt=0"`
}

func CloseCIRound(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	var input ciCloseRoundInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Expire any pre-subscriptions in this round that were never confirmed.
	database.DB.Model(&models.Subscription{}).
		Where("capital_increase_id = ? AND round = ? AND type = ? AND shareholder_confirmed_at IS NULL",
			ci.ID, input.Round, "pre-subscription").
		Update("status", "expired")

	c.JSON(http.StatusOK, gin.H{"message": "Round closed", "round": input.Round})
}

func OpenCIAdditional(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	if ci.Status != "round_open" {
		c.JSON(http.StatusConflict, gin.H{"error": "Capital increase is not in an open-round state"})
		return
	}
	ci.Status = "additional_open"
	database.DB.Save(&ci)
	c.JSON(http.StatusOK, gin.H{"message": "Additional-request phase opened", "data": ci})
}

// DeleteCapitalIncrease hard-deletes a CI and everything it owns
// (subscriptions, allocations, additional requests). Refuses if any
// Investment payment row is linked to one of its allocations, because
// those represent real money received against the campaign.
func DeleteCapitalIncrease(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}

	// Find all allocations belonging to this CI, then check for linked investments.
	var allocIDs []uint
	database.DB.Model(&models.Allocation{}).
		Where("capital_increase_id = ?", ci.ID).
		Pluck("id", &allocIDs)
	if len(allocIDs) > 0 {
		var linkedInvestments int64
		database.DB.Model(&models.Investment{}).
			Where("allocation_id IN ?", allocIDs).
			Count(&linkedInvestments)
		if linkedInvestments > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "Cannot delete: investment payments are linked to this capital increase's allocations. Reverse those payments first."})
			return
		}
	}

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("capital_increase_id = ?", ci.ID).Delete(&models.CIAdditionalRequest{}).Error; err != nil {
			return err
		}
		if err := tx.Where("capital_increase_id = ?", ci.ID).Delete(&models.Allocation{}).Error; err != nil {
			return err
		}
		// Subscriptions use soft-delete (DeletedAt); Unscoped() removes them outright
		// so a re-run on the same test data is genuinely clean.
		if err := tx.Unscoped().Where("capital_increase_id = ?", ci.ID).Delete(&models.Subscription{}).Error; err != nil {
			return err
		}
		return tx.Delete(&ci).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Capital increase deleted"})
}

func CloseCapitalIncrease(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	now := time.Now()
	ci.Status = "closed"
	ci.ClosedAt = &now
	database.DB.Save(&ci)
	c.JSON(http.StatusOK, gin.H{"message": "Capital increase closed", "data": ci})
}

// ----- additional requests -----

type ciAdditionalRequestInput struct {
	ShareholderID   uint   `json:"shareholder_id" binding:"required"`
	RequestedShares int64  `json:"requested_shares" binding:"required,gt=0"`
	Note            string `json:"note"`
}

func CreateCIAdditionalRequest(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	if ci.Status != "round_open" && ci.Status != "additional_open" {
		c.JSON(http.StatusConflict, gin.H{"error": "Capital increase is not active"})
		return
	}
	var input ciAdditionalRequestInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Gate: only shareholders who have fully confirmed every pre-sub offered
	// in this CI can request additional shares. Partial confirms and declines
	// disqualify — you can't ask for MORE if you haven't accepted what's on
	// the table.
	if !fullyConfirmedAllPreSubsInCI(ci.ID, input.ShareholderID) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Shareholder must fully confirm every pre-subscription in this campaign before requesting additional shares. Partial confirmations, declines, and not-yet-confirmed rows all disqualify.",
		})
		return
	}
	req := models.CIAdditionalRequest{
		CapitalIncreaseID: ci.ID,
		ShareholderID:     input.ShareholderID,
		Round:             ci.CurrentRound, // tie to the round whose confirmation phase produced this
		RequestedShares:   input.RequestedShares,
		Note:              input.Note,
		Status:            "pending",
	}
	if err := database.DB.Create(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "Additional request submitted", "id": req.ID})
}

func GetCIAdditionalRequests(c *gin.Context) {
	id := c.Param("id")
	var reqs []models.CIAdditionalRequest
	q := database.DB.Preload("Shareholder").Order("id DESC")
	if id != "" {
		q = q.Where("capital_increase_id = ?", id)
	}
	q.Find(&reqs)
	c.JSON(http.StatusOK, gin.H{"data": reqs})
}

// ListAllCIAdditionalRequests is the cross-CI version for the dedicated admin page.
func ListAllCIAdditionalRequests(c *gin.Context) {
	var reqs []models.CIAdditionalRequest
	q := database.DB.Preload("Shareholder").Preload("CapitalIncrease").Order("id DESC")
	if status := c.Query("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	q.Find(&reqs)
	c.JSON(http.StatusOK, gin.H{"data": reqs})
}

type ciApproveInput struct {
	ApprovedShares int64 `json:"approved_shares" binding:"required,gt=0"`
}

func ApproveCIAdditionalRequest(c *gin.Context) {
	id := c.Param("id")
	reqID := c.Param("reqId")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	var req models.CIAdditionalRequest
	if err := database.DB.First(&req, reqID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return
	}
	if req.CapitalIncreaseID != ci.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request does not belong to this capital increase"})
		return
	}
	if req.Status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "Request is not pending"})
		return
	}
	var input ciApproveInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	pool := ciRemainingPool(&ci)
	if input.ApprovedShares > pool {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Approved shares exceed remaining pool"})
		return
	}

	now := time.Now()
	// Use the next round number above MaxAutoRounds for additional approvals so
	// they are clearly tagged in the round column.
	addlRound := ci.MaxAutoRounds + 1
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		req.Status = "approved"
		req.ApprovedShares = input.ApprovedShares
		if err := tx.Save(&req).Error; err != nil {
			return err
		}
		additional := models.Subscription{
			ShareholderID:     req.ShareholderID,
			SubscriptionNo:    fmt.Sprintf("CI-%d-ADD-%d", ci.ID, req.ID),
			Type:              "additional",
			ShareAmount:       float64(input.ApprovedShares) * ci.ParValue,
			NumberOfShares:    input.ApprovedShares,
			ParValue:          ci.ParValue,
			SubscriptionDate:  &now,
			Status:            "active",
			IsProportional:    false,
			ApprovalStatus:    "approved",
			CapitalIncreaseID: &ci.ID,
			Round:             addlRound,
		}
		if err := tx.Create(&additional).Error; err != nil {
			return err
		}
		alloc := models.Allocation{
			ShareholderID:     req.ShareholderID,
			SubscriptionID:    &additional.ID,
			AllocationNo:      fmt.Sprintf("CI-%d-ADD-A-%d", ci.ID, req.ID),
			Round:             addlRound,
			AllocatedShares:   input.ApprovedShares,
			AllocatedAmount:   additional.ShareAmount,
			AllocationDate:    &now,
			Status:            "allocated",
			ApprovalStatus:    "approved",
			CapitalIncreaseID: &ci.ID,
		}
		if err := tx.Create(&alloc).Error; err != nil {
			return err
		}
		var confirmedTotal int64
		tx.Model(&models.Subscription{}).
			Where("capital_increase_id = ? AND type IN ? AND status = ?",
				ci.ID, []string{"confirmation", "additional"}, "active").
			Select("COALESCE(SUM(number_of_shares),0)").Scan(&confirmedTotal)
		ci.AllocatedShares = confirmedTotal
		return tx.Save(&ci).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Request approved"})
}

func RejectCIAdditionalRequest(c *gin.Context) {
	id := c.Param("id")
	reqID := c.Param("reqId")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}
	var req models.CIAdditionalRequest
	if err := database.DB.First(&req, reqID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return
	}
	if req.CapitalIncreaseID != ci.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request does not belong to this capital increase"})
		return
	}
	if req.Status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "Request is not pending"})
		return
	}
	req.Status = "rejected"
	database.DB.Save(&req)
	c.JSON(http.StatusOK, gin.H{"message": "Request rejected"})
}

// ----- summary (dashboard) -----

func GetCISummary(c *gin.Context) {
	id := c.Param("id")
	var ci models.CapitalIncrease
	if err := database.DB.First(&ci, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Capital increase not found"})
		return
	}

	// Per-round subscription rollup
	var preSubs []models.Subscription
	database.DB.Where("capital_increase_id = ?", ci.ID).
		Order("round ASC, id ASC").Find(&preSubs)

	var preSubCount, confirmedCount, additionalCount, pendingRequests int64
	database.DB.Model(&models.Subscription{}).
		Where("capital_increase_id = ? AND type = ?", ci.ID, "pre-subscription").
		Count(&preSubCount)
	database.DB.Model(&models.Subscription{}).
		Where("capital_increase_id = ? AND type = ? AND status = ?", ci.ID, "confirmation", "active").
		Count(&confirmedCount)
	database.DB.Model(&models.Subscription{}).
		Where("capital_increase_id = ? AND type = ? AND status = ?", ci.ID, "additional", "active").
		Count(&additionalCount)
	database.DB.Model(&models.CIAdditionalRequest{}).
		Where("capital_increase_id = ? AND status = ?", ci.ID, "pending").
		Count(&pendingRequests)

	c.JSON(http.StatusOK, gin.H{
		"data":                   ci,
		"remaining":              ciRemainingPool(&ci),
		"pre_subscription_count": preSubCount,
		"confirmed_count":        confirmedCount,
		"additional_count":       additionalCount,
		"pending_requests":       pendingRequests,
	})
}

// GetCISubscriptions returns all subscription rows for a CI, optionally filtered by round and type.
func GetCISubscriptions(c *gin.Context) {
	id := c.Param("id")
	q := database.DB.Preload("Shareholder").Where("capital_increase_id = ?", id)
	if r := c.Query("round"); r != "" {
		q = q.Where("round = ?", r)
	}
	if t := c.Query("type"); t != "" {
		q = q.Where("type = ?", t)
	}
	var subs []models.Subscription
	q.Order("round ASC, id ASC").Find(&subs)
	c.JSON(http.StatusOK, gin.H{"data": subs})
}
