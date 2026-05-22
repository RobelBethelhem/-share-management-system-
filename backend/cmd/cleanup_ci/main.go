// cleanup_ci is a one-shot maintenance tool that wipes ALL Capital Increase
// data (campaigns, their pre-subscriptions, confirmations, allocations, and
// additional requests) while leaving every other table untouched.
//
// Usage (from D:\share_management_system\backend):
//
//	go run ./cmd/cleanup_ci
//
// It refuses to run if any Investment payment row is linked to a CI
// allocation — those would be real money records and need to be reversed
// through the normal UI first.
package main

import (
	"fmt"
	"log"

	"share-management-system/internal/config"
	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"gorm.io/gorm"
)

func main() {
	cfg := config.Load()
	fmt.Printf(">> Connecting to %s@%s:%s/%s\n", cfg.DBUser, cfg.DBHost, cfg.DBPort, cfg.DBName)
	db := database.Initialize(cfg)

	// What we're about to delete — print first so the operator sees the scope.
	var cis []models.CapitalIncrease
	db.Find(&cis)
	var allocCount, reqCount int64
	var subCount int64
	db.Model(&models.Allocation{}).Where("capital_increase_id IS NOT NULL").Count(&allocCount)
	db.Model(&models.CIAdditionalRequest{}).Count(&reqCount)
	db.Unscoped().Model(&models.Subscription{}).Where("capital_increase_id IS NOT NULL").Count(&subCount)

	fmt.Println("---------------------------------------------------------")
	fmt.Println("Capital Increase cleanup — about to remove:")
	fmt.Printf("  CapitalIncrease campaigns      : %d\n", len(cis))
	for _, ci := range cis {
		fmt.Printf("     - #%d %q  (status=%s, total=%d, allocated=%d)\n",
			ci.ID, ci.Label, ci.Status, ci.TotalNewShares, ci.AllocatedShares)
	}
	fmt.Printf("  CI-linked Subscriptions        : %d\n", subCount)
	fmt.Printf("  CI-linked Allocations          : %d\n", allocCount)
	fmt.Printf("  CIAdditionalRequest rows       : %d\n", reqCount)
	fmt.Println("All other data (shareholders, non-CI subscriptions/allocations,")
	fmt.Println("investments, dividends, users, etc.) will be preserved.")
	fmt.Println("---------------------------------------------------------")

	ciCount := int64(len(cis))

	if ciCount == 0 && subCount == 0 && allocCount == 0 && reqCount == 0 {
		fmt.Println("Nothing to wipe — already clean.")
		return
	}

	// Safety: refuse if any Investment is linked to a CI allocation.
	var ciAllocIDs []uint
	db.Model(&models.Allocation{}).
		Where("capital_increase_id IS NOT NULL").
		Pluck("id", &ciAllocIDs)
	if len(ciAllocIDs) > 0 {
		var linkedInv int64
		db.Model(&models.Investment{}).
			Where("allocation_id IN ?", ciAllocIDs).
			Count(&linkedInv)
		if linkedInv > 0 {
			log.Fatalf("Refusing: %d Investment rows are linked to CI allocations. "+
				"Reverse those payments through the admin UI first.", linkedInv)
		}
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("1 = 1").Delete(&models.CIAdditionalRequest{}).Error; err != nil {
			return err
		}
		if err := tx.Where("capital_increase_id IS NOT NULL").Delete(&models.Allocation{}).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Where("capital_increase_id IS NOT NULL").Delete(&models.Subscription{}).Error; err != nil {
			return err
		}
		return tx.Where("1 = 1").Delete(&models.CapitalIncrease{}).Error
	})
	if err != nil {
		log.Fatalf("Cleanup failed: %v", err)
	}

	fmt.Println("✓ Capital Increase data wiped. You can now restart the backend and create a fresh campaign.")
}
