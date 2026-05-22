package handlers

import (
	"log"
	"net/http"
	"strings"

	"share-management-system/internal/database"

	"github.com/gin-gonic/gin"
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

	// Disable FK checks so we don't need a topologically-sorted truncate order.
	if err := database.DB.Exec("SET FOREIGN_KEY_CHECKS=0").Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer database.DB.Exec("SET FOREIGN_KEY_CHECKS=1")

	cleared := []string{}
	failed := map[string]string{}
	for _, t := range tables {
		if t == "users" {
			continue
		}
		if err := database.DB.Exec("TRUNCATE TABLE `" + t + "`").Error; err != nil {
			failed[t] = err.Error()
			continue
		}
		cleared = append(cleared, t)
	}

	// Re-seed defaults so the system is usable immediately after reset.
	database.SeedDefaultData(database.DB)

	actor, _ := c.Get("username")
	log.Printf("[ADMIN-RESET] user=%v cleared=%d tables failed=%d",
		actor, len(cleared), len(failed))

	c.JSON(http.StatusOK, gin.H{
		"success":        true,
		"cleared_tables": cleared,
		"failed_tables":  failed,
		"preserved":      []string{"users"},
		"message":        "All business data wiped and default settings re-seeded.",
	})
}
