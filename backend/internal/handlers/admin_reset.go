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
	Confirmation string `json:"confirmation"`
}

// ResetData wipes every table in the schema except `users`, then re-seeds
// the default system settings, bank capital, tax schedule, and mini-app
// categories so the system is immediately usable.
//
// The request body MUST contain {"confirmation":"RESET"} as a guard against
// accidental fat-finger calls. The endpoint is gated by AdminOnly at the
// route layer.
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

	var tables []string
	if err := database.DB.Raw("SHOW TABLES").Scan(&tables).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Tables to keep — login accounts + Formulas & Configuration. These are
	// not business data and the operator's customizations (custom tax brackets,
	// edited transfer fee formula, adjusted par value, etc.) must survive a
	// reset. SeedDefaultData is still called afterwards as a safety net so
	// any missing default rows reappear.
	//
	// Names are derived from the GORM models themselves (via Statement.Parse)
	// so they always match what AutoMigrate created — no risk of drift if
	// GORM's pluralization changes or a model gains a TableName() override.
	preservedModels := []interface{}{
		&models.User{},                // admin login accounts
		&models.SystemSetting{},       // tax_formula, share_calc_formula, transfer fees, tax rate
		&models.BankCapital{},         // authorized capital, par value, total shares
		&models.DividendTaxSchedule{}, // dividend tax brackets
		&models.MiniAppCategory{},     // mini-app categories
		&models.MiniApp{},             // mini-app registry
	}
	preserved := map[string]bool{}
	preservedList := []string{}
	for _, m := range preservedModels {
		stmt := &gorm.Statement{DB: database.DB}
		if err := stmt.Parse(m); err == nil && stmt.Schema != nil {
			preserved[stmt.Schema.Table] = true
			preservedList = append(preservedList, stmt.Schema.Table)
		}
	}

	// Disable FK checks so we don't need a topologically-sorted truncate order.
	if err := database.DB.Exec("SET FOREIGN_KEY_CHECKS=0").Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer database.DB.Exec("SET FOREIGN_KEY_CHECKS=1")

	cleared := []string{}
	failed := map[string]string{}
	for _, t := range tables {
		if preserved[t] {
			continue
		}
		if err := database.DB.Exec("TRUNCATE TABLE `" + t + "`").Error; err != nil {
			failed[t] = err.Error()
			continue
		}
		cleared = append(cleared, t)
	}

	// Re-seed defaults — idempotent (each block checks count == 0 first), so
	// preserved customizations are NOT overwritten; only missing rows reappear.
	database.SeedDefaultData(database.DB)

	actor, _ := c.Get("username")
	log.Printf("[ADMIN-RESET] user=%v cleared=%d tables failed=%d",
		actor, len(cleared), len(failed))

	c.JSON(http.StatusOK, gin.H{
		"success":        true,
		"cleared_tables": cleared,
		"failed_tables":  failed,
		"preserved":      preservedList,
		"message":        "Business data wiped. Formulas, configuration, login accounts preserved.",
	})
}
