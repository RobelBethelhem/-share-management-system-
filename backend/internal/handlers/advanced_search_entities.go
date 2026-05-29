package handlers

import (
	"net/http"
	"strings"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

// Each entity exposes a structured advanced-search endpoint with the same
// shape as POST /shareholders/search-advanced. The whitelist below pairs each
// searchable column with its semantic type so ApplyAdvancedFilters can pick
// the right operators.

// ----- Investments -----

var investmentFieldType = map[string]string{
	"id":              "int",
	"shareholder_id":  "int",
	"allocation_id":   "int",
	"payment_method":  "enum",
	"from_account":    "string",
	"reference_no":    "string",
	"amount":          "number",
	"number_of_shares": "int",
	"par_value":       "number",
	"premium_value":   "number",
	"is_standing":     "bool",
	"standing_frequency": "enum",
	"status":          "enum",
	"approval_status": "enum",
	"remark":          "string",
	"payment_date":    "date",
	"amharic_date":    "string",
	"created_at":      "date",
}

func SearchInvestmentsAdvanced(c *gin.Context) {
	var input AdvSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	offset := NormalizePaging(&input)
	query := database.DB.Model(&models.Investment{}).Preload("Shareholder")
	query = ApplyAdvancedFilters(query, input.Filters, investmentFieldType)

	var total int64
	query.Count(&total)
	var rows []models.Investment
	query.Offset(offset).Limit(input.PageSize).Order("id DESC").Find(&rows)
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "page": input.Page, "page_size": input.PageSize})
}

// ----- Subscriptions -----

var subscriptionFieldType = map[string]string{
	"id":                "int",
	"shareholder_id":    "int",
	"subscription_no":   "string",
	"type":              "enum",
	"share_amount":      "number",
	"number_of_shares":  "int",
	"par_value":         "number",
	"status":            "enum",
	"approval_status":   "enum",
	"is_proportional":   "bool",
	"remark":            "string",
	"capital_increase_id": "int",
	"round":             "int",
	"base_shares":       "int",
	"subscription_date": "date",
	"expiry_date":       "date",
	"created_at":        "date",
}

func SearchSubscriptionsAdvanced(c *gin.Context) {
	var input AdvSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	offset := NormalizePaging(&input)
	query := database.DB.Model(&models.Subscription{}).Preload("Shareholder")
	query = ApplyAdvancedFilters(query, input.Filters, subscriptionFieldType)

	var total int64
	query.Count(&total)
	var rows []models.Subscription
	query.Offset(offset).Limit(input.PageSize).Order("id DESC").Find(&rows)
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "page": input.Page, "page_size": input.PageSize})
}

// ----- Transfers -----

var transferFieldType = map[string]string{
	"id":               "int",
	"batch_no":         "string",
	"transferor_id":    "int",
	"transferee_id":    "int",
	"transfer_type":    "enum",
	"number_of_shares": "int",
	"par_value":        "number",
	"transfer_amount":  "number",
	"capital_gain_tax": "number",
	"service_fee":      "number",
	"stamp_duty":       "number",
	"vat":              "number",
	"total_fees":       "number",
	"is_full_transfer": "bool",
	"include_subscribed": "bool",
	"reason":           "string",
	"status":           "enum",
	"approval_status":  "enum",
	"transfer_date":    "date",
	"created_at":       "date",
}

func SearchTransfersAdvanced(c *gin.Context) {
	var input AdvSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	offset := NormalizePaging(&input)
	query := database.DB.Model(&models.Transfer{}).Preload("Transferor").Preload("Transferee")
	query = ApplyAdvancedFilters(query, input.Filters, transferFieldType)

	var total int64
	query.Count(&total)
	var rows []models.Transfer
	query.Offset(offset).Limit(input.PageSize).Order("id DESC").Find(&rows)
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "page": input.Page, "page_size": input.PageSize})
}

// ----- Share Blocks -----

var shareBlockFieldType = map[string]string{
	"id":                "int",
	"shareholder_id":    "int",
	"allocation_id":     "int",
	"block_type":        "enum",
	"shares_type":       "enum",
	"block_shares":      "int",
	"paid_shares_to_block":   "int",
	"unpaid_shares_to_block": "int",
	"block_amount_birr": "number",
	"guarantee_amount":  "number",
	"service_fee":       "number",
	"is_released":       "bool",
	"reason":            "string",
	"status":            "enum",
	"approval_status":   "enum",
	"block_date":        "date",
	"release_date":      "date",
	"created_at":        "date",
}

func SearchShareBlocksAdvanced(c *gin.Context) {
	var input AdvSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	offset := NormalizePaging(&input)
	query := database.DB.Model(&models.ShareBlock{}).Preload("Shareholder").Preload("Allocation")
	query = ApplyAdvancedFilters(query, input.Filters, shareBlockFieldType)

	var total int64
	query.Count(&total)
	var rows []models.ShareBlock
	query.Offset(offset).Limit(input.PageSize).Order("id DESC").Find(&rows)
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "page": input.Page, "page_size": input.PageSize})
}

// ----- Certificates -----

var certificateFieldType = map[string]string{
	"id":             "int",
	"shareholder_id": "int",
	"allocation_id":  "int",
	"certificate_no": "string",
	"number_of_shares": "int",
	"par_value":      "number",
	"total_value":    "number",
	"status":         "enum",
	"cert_scope":     "enum",
	"is_printed":     "bool",
	"remark":         "string",
	"issue_date":     "date",
	"printed_at":     "date",
	"created_at":     "date",
}

func SearchCertificatesAdvanced(c *gin.Context) {
	var input AdvSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	offset := NormalizePaging(&input)
	query := database.DB.Model(&models.Certificate{}).Preload("Shareholder").Preload("Allocation")
	query = ApplyAdvancedFilters(query, input.Filters, certificateFieldType)

	var total int64
	query.Count(&total)
	var rows []models.Certificate
	query.Offset(offset).Limit(input.PageSize).Order("id DESC").Find(&rows)
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "page": input.Page, "page_size": input.PageSize})
}

// ----- Allocations (the "Rounds" view) -----

var allocationFieldType = map[string]string{
	"id":               "int",
	"shareholder_id":   "int",
	"subscription_id":  "int",
	"capital_increase_id": "int",
	"allocation_no":    "string",
	"round":            "int",
	"allocated_shares": "int",
	"allocated_amount": "number",
	"status":           "enum",
	"approval_status":  "enum",
	"allocation_date":  "date",
	"created_at":       "date",
}

func SearchAllocationsAdvanced(c *gin.Context) {
	var input AdvSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	offset := NormalizePaging(&input)
	query := database.DB.Model(&models.Allocation{}).Preload("Shareholder").Preload("Subscription")
	query = ApplyAdvancedFilters(query, input.Filters, allocationFieldType)

	var total int64
	query.Count(&total)
	var rows []models.Allocation
	query.Offset(offset).Limit(input.PageSize).Order("id DESC").Find(&rows)
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "page": input.Page, "page_size": input.PageSize})
}

// ----- Dividends -----

var dividendFieldType = map[string]string{
	"id":                  "int",
	"shareholder_id":      "int",
	"dividend_setting_id": "int",
	"fiscal_year":         "string",
	"weighted_avg_shares": "number",
	"gross_dividend":      "number",
	"tax_amount":          "number",
	"net_dividend":        "number",
	"collected_amount":    "number",
	"uncollected_amount":  "number",
	"reinvested_amount":   "number",
	"payment_method":      "enum",
	"is_blocked":          "bool",
	"is_transferred":      "bool",
	"is_transfer_pending": "bool",
	"transfer_to":         "string",
	"transfer_reason":     "enum",
	"status":              "enum",
	"approval_status":     "enum",
	"collection_date":     "date",
	"created_at":          "date",
	// Shareholder name / account fields. These don't live on the dividends
	// table — they're resolved to a set of shareholder IDs first (see
	// SearchDividendsAdvanced) and applied as shareholder_id IN (...). The
	// "shareholders." prefix keys map to the plain shareholders columns.
	"shareholders.first_name":  "string",
	"shareholders.middle_name": "string",
	"shareholders.last_name":   "string",
	"shareholders.account_no":  "string",
}

func SearchDividendsAdvanced(c *gin.Context) {
	var input AdvSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	offset := NormalizePaging(&input)

	// Split filters: shareholder.* ones are resolved to a set of shareholder
	// IDs via a separate query (no fragile JOIN), the rest apply directly to
	// the dividends table. This keeps the main query on the same clean
	// Count/Find pattern every other search uses.
	var shFilters []AdvFilter
	var divFilters []AdvFilter
	for _, f := range input.Filters {
		if strings.HasPrefix(f.Field, "shareholders.") {
			shFilters = append(shFilters, AdvFilter{
				Field:  strings.TrimPrefix(f.Field, "shareholders."),
				Op:     f.Op,
				Value:  f.Value,
				Value2: f.Value2,
			})
		} else {
			divFilters = append(divFilters, f)
		}
	}

	query := database.DB.Model(&models.Dividend{}).
		Preload("Shareholder").Preload("DividendSetting")

	if len(shFilters) > 0 {
		shQuery := database.DB.Model(&models.Shareholder{})
		shQuery = ApplyAdvancedFilters(shQuery, shFilters, shareholderFieldType)
		var ids []uint
		shQuery.Pluck("id", &ids)
		if len(ids) == 0 {
			// No shareholder matched the name filter → no dividends.
			c.JSON(http.StatusOK, gin.H{"data": []any{}, "total": 0, "page": input.Page, "page_size": input.PageSize})
			return
		}
		query = query.Where("shareholder_id IN ?", ids)
	}

	query = ApplyAdvancedFilters(query, divFilters, dividendFieldType)

	var total int64
	query.Count(&total)
	var rows []models.Dividend
	query.Offset(offset).Limit(input.PageSize).Order("id DESC").Find(&rows)

	// Augment with live recomputed values, exactly like GetDividends, so the
	// UI's stored-vs-live columns render correctly instead of showing 0.
	type augmented struct {
		models.Dividend
		LiveWeightedShares float64 `json:"live_weighted_shares"`
		LiveGrossDividend  float64 `json:"live_gross_dividend"`
		LiveTaxAmount      float64 `json:"live_tax_amount"`
		LiveNetDividend    float64 `json:"live_net_dividend"`
	}
	out := make([]augmented, 0, len(rows))
	for _, d := range rows {
		live := computeLiveDividend(d, d.DividendSetting)
		out = append(out, augmented{
			Dividend:           d,
			LiveWeightedShares: live.WeightedShares,
			LiveGrossDividend:  live.Gross,
			LiveTaxAmount:      live.Tax,
			LiveNetDividend:    live.Net,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": out, "total": total, "page": input.Page, "page_size": input.PageSize})
}
