package handlers

import (
	"log"
	"net/http"
	"strings"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type resetDataReq struct {
	Confirmation string   `json:"confirmation"`
	Categories   []string `json:"categories"` // empty = full reset (current behavior)
}

// ResetCategory groups a set of related tables that get wiped together.
// The Tables slice MUST include both the main table(s) AND every table
// that has a foreign-key reference to them, so wiping a category never
// leaves orphan rows pointing at deleted parents.
type ResetCategory struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Tables      []string `json:"tables"`
}

// resetCategories is the user-facing menu shown in the Danger Zone UI.
// Order matters — most-used categories come first.
var resetCategories = []ResetCategory{
	{
		Key:         "dividends",
		Label:       "Dividends",
		Description: "All dividend declarations, audit actions, and per-fiscal-year settings.",
		Tables:      []string{"dividends", "dividend_actions", "dividend_settings"},
	},
	{
		Key:         "transfers",
		Label:       "Transfers",
		Description: "All share transfers and their per-allocation lines.",
		Tables:      []string{"transfer_lines", "transfers"},
	},
	{
		Key:         "share_blocks",
		Label:       "Share Blocks",
		Description: "All share blocking / unblocking records.",
		Tables:      []string{"share_blocks"},
	},
	{
		Key:         "certificates",
		Label:       "Certificates",
		Description: "All share certificates.",
		Tables:      []string{"certificates"},
	},
	{
		Key:         "allocations",
		Label:       "Allocations (cascades)",
		Description: "All share allocations PLUS everything that references them: transfers, share blocks, certificates, dividend audit actions, and pending approvals.",
		Tables:      []string{"allocations", "transfer_lines", "transfers", "share_blocks", "certificates", "dividend_actions", "pending_approvals"},
	},
	{
		Key:         "investments",
		Label:       "Investments (cascades)",
		Description: "All investment payments PLUS allocations seeded from them and everything downstream (transfers, dividends, blocks, certificates).",
		Tables:      []string{"investments", "allocations", "transfer_lines", "transfers", "share_blocks", "certificates", "dividend_actions", "dividends", "pending_approvals"},
	},
	{
		Key:         "subscriptions",
		Label:       "Subscriptions (cascades)",
		Description: "All shareholder subscriptions (pre-subscription, confirmation, additional). Cascades to capital-increase campaigns that use them.",
		Tables:      []string{"subscriptions", "ci_additional_requests", "capital_increases"},
	},
	{
		Key:         "capital_increases",
		Label:       "Capital Increases",
		Description: "All capital-increase campaigns and additional requests.",
		Tables:      []string{"ci_additional_requests", "capital_increases"},
	},
	{
		Key:         "pending_approvals",
		Label:       "Pending Approvals",
		Description: "All pending approval queue rows.",
		Tables:      []string{"pending_approvals"},
	},
	{
		Key:         "service_charges",
		Label:       "Service Charges",
		Description: "All service-charge transactions.",
		Tables:      []string{"service_charges"},
	},
	{
		Key:         "agm",
		Label:       "AGM Data",
		Description: "All AGM meetings, attendances, agendas, votes, and proxies.",
		Tables:      []string{"agm_votes", "agm_proxies", "agm_agendas", "agm_attendances", "agm_meetings"},
	},
	{
		Key:         "announcements",
		Label:       "Announcements",
		Description: "All announcements, comments, likes, and views.",
		Tables:      []string{"announcement_comments", "announcement_likes", "announcement_views", "announcements"},
	},
	{
		Key:         "community",
		Label:       "Community",
		Description: "All community groups, members, posts, comments, polls, and votes.",
		Tables:      []string{"poll_votes", "poll_options", "polls", "post_likes", "post_comments", "group_posts", "group_members", "community_groups"},
	},
	{
		Key:         "chat",
		Label:       "Chat",
		Description: "All conversations, messages, reactions, and chat settings.",
		Tables:      []string{"message_reactions", "messages", "conversations", "chat_settings"},
	},
	{
		Key:         "documents",
		Label:       "Documents",
		Description: "All uploaded documents.",
		Tables:      []string{"documents"},
	},
	{
		Key:         "marketplace",
		Label:       "Marketplace",
		Description: "All share listings and trade requests.",
		Tables:      []string{"trade_requests", "share_listings"},
	},
	{
		Key:         "shareholders",
		Label:       "Shareholders (FULL CASCADE)",
		Description: "All shareholders, addresses, POAs, AND all their related business data. Roughly equivalent to a full reset minus the preserved Formulas & Configuration tables.",
		Tables: []string{
			"shareholders", "shareholder_addresses", "poas",
			"investments", "allocations", "transfer_lines", "transfers",
			"share_blocks", "certificates",
			"dividends", "dividend_actions", "dividend_settings",
			"subscriptions", "ci_additional_requests", "capital_increases",
			"pending_approvals", "service_charges",
			"agm_votes", "agm_proxies", "agm_agendas", "agm_attendances", "agm_meetings",
			"device_bindings", "share_splits",
			"announcement_comments", "announcement_likes", "announcement_views", "announcements",
			"poll_votes", "poll_options", "polls", "post_likes", "post_comments",
			"group_posts", "group_members", "community_groups",
			"message_reactions", "messages", "conversations", "chat_settings",
			"documents", "trade_requests", "share_listings",
		},
	},
}

// GetResetCategories returns the predefined wipe categories for the
// Danger Zone UI to render as checkboxes.
func GetResetCategories(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"categories": resetCategories})
}

// ResetData supports two modes:
//
//	(a) Full reset — when req.Categories is empty.  Wipes EVERY table except
//	    `users` and the preserved Formulas & Configuration set, then re-seeds
//	    defaults.  Same behaviour as before this endpoint gained categories.
//
//	(b) Selective reset — when req.Categories has one or more keys from
//	    resetCategories.  Wipes only those categories' tables (each category
//	    already includes its FK-dependent tables, so no orphan rows remain).
//	    Defaults are NOT re-seeded because the preserved tables weren't
//	    touched.
//
// Either way, the body MUST contain {"confirmation":"RESET"}.
func ResetData(c *gin.Context) {
	var req resetDataReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if strings.TrimSpace(req.Confirmation) != "RESET" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Confirmation token does not match. Type RESET exactly.",
		})
		return
	}

	tablesToWipe := map[string]bool{}
	preservedList := []string{}
	mode := "full"
	usedCategories := []string{}

	if len(req.Categories) == 0 {
		// (a) FULL RESET — same behaviour as the original endpoint.
		preservedModels := []interface{}{
			&models.User{}, &models.SystemSetting{}, &models.BankCapital{},
			&models.DividendTaxSchedule{}, &models.MiniAppCategory{}, &models.MiniApp{},
		}
		preserved := map[string]bool{}
		for _, m := range preservedModels {
			stmt := &gorm.Statement{DB: database.DB}
			if err := stmt.Parse(m); err == nil && stmt.Schema != nil {
				preserved[stmt.Schema.Table] = true
				preservedList = append(preservedList, stmt.Schema.Table)
			}
		}
		var allTables []string
		if err := database.DB.Raw("SHOW TABLES").Scan(&allTables).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		for _, t := range allTables {
			if !preserved[t] {
				tablesToWipe[t] = true
			}
		}
	} else {
		// (b) SELECTIVE RESET — collect tables from the requested categories.
		mode = "selective"
		categoryIndex := map[string]ResetCategory{}
		for _, c := range resetCategories {
			categoryIndex[c.Key] = c
		}
		invalid := []string{}
		for _, key := range req.Categories {
			cat, ok := categoryIndex[key]
			if !ok {
				invalid = append(invalid, key)
				continue
			}
			usedCategories = append(usedCategories, cat.Key)
			for _, t := range cat.Tables {
				tablesToWipe[t] = true
			}
		}
		if len(invalid) > 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":            "Unknown category keys",
				"invalid_keys":     invalid,
				"available_keys":   keysOfCategories(),
			})
			return
		}
	}

	// FK checks off so truncate order doesn't matter. TiDB doesn't enforce
	// FKs by default but the call is harmless on TiDB and required on real
	// MySQL where the deploy may eventually land.
	if err := database.DB.Exec("SET FOREIGN_KEY_CHECKS=0").Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer database.DB.Exec("SET FOREIGN_KEY_CHECKS=1")

	cleared := []string{}
	failed := map[string]string{}
	for t := range tablesToWipe {
		if err := database.DB.Exec("TRUNCATE TABLE `" + t + "`").Error; err != nil {
			failed[t] = err.Error()
			continue
		}
		cleared = append(cleared, t)
	}

	// Only re-seed defaults on a full reset. On a selective reset the
	// preserved configuration tables weren't touched, so seeding would
	// be a no-op anyway — but skipping it avoids unnecessary writes.
	if mode == "full" {
		database.SeedDefaultData(database.DB)
	}

	actor, _ := c.Get("username")
	log.Printf("[ADMIN-RESET] user=%v mode=%s categories=%v cleared=%d failed=%d",
		actor, mode, usedCategories, len(cleared), len(failed))

	resp := gin.H{
		"success":        true,
		"mode":           mode,
		"cleared_tables": cleared,
		"failed_tables":  failed,
	}
	if mode == "full" {
		resp["preserved"] = preservedList
		resp["message"] = "Business data wiped. Formulas, configuration, login accounts preserved."
	} else {
		resp["categories_wiped"] = usedCategories
		resp["message"] = "Selected categories wiped. All other business data and configuration preserved."
	}
	c.JSON(http.StatusOK, resp)
}

func keysOfCategories() []string {
	out := make([]string, 0, len(resetCategories))
	for _, c := range resetCategories {
		out = append(out, c.Key)
	}
	return out
}
