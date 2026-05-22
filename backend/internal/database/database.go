package database

import (
	"fmt"
	"log"
	"os"

	"share-management-system/internal/config"
	"share-management-system/internal/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func Initialize(cfg *config.Config) *gorm.DB {
	var err error
	DB, err = gorm.Open(mysql.Open(cfg.DSN()), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	err = DB.AutoMigrate(
		&models.User{},
		&models.Shareholder{},
		&models.ShareholderAddress{},
		&models.POA{},
		&models.Subscription{},
		&models.Allocation{},
		&models.Investment{},
		&models.Transfer{},
		&models.TransferLine{},
		&models.DividendSetting{},
		&models.DividendTaxSchedule{},
		&models.Dividend{},
		&models.DividendAction{},
		&models.ShareBlock{},
		&models.Certificate{},
		&models.AGMAttendance{},
		&models.PendingApproval{},
		&models.ServiceCharge{},
		&models.BankCapital{},
		&models.SystemSetting{},
		&models.ShareSplit{},
		&models.DeviceBinding{},
		&models.Announcement{},
		&models.AnnouncementLike{},
		&models.AnnouncementView{},
		&models.AnnouncementComment{},
		&models.AGMMeeting{},
		&models.AGMAgenda{},
		&models.AGMProxy{},
		&models.AGMVote{},
		&models.ShareListing{},
		&models.TradeRequest{},
		&models.Document{},
		&models.CommunityGroup{},
		&models.GroupMember{},
		&models.GroupPost{},
		&models.PostComment{},
		&models.PostLike{},
		&models.Poll{},
		&models.PollOption{},
		&models.PollVote{},
		&models.ChatSettings{},
		&models.Conversation{},
		&models.Message{},
		&models.MessageReaction{},
		&models.MiniAppCategory{},
		&models.MiniApp{},
		&models.MiniAppPermission{},
		&models.MiniAppSetting{},
		&models.CapitalIncrease{},
		&models.CIAdditionalRequest{},
	)
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Drop legacy proxy_shareholder_id column if it exists
	// Must drop foreign key constraint first, otherwise MySQL silently refuses the DROP COLUMN
	var fkName string
	DB.Raw(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'agm_proxies'
		AND COLUMN_NAME = 'proxy_shareholder_id'
		AND REFERENCED_TABLE_NAME IS NOT NULL`).Scan(&fkName)
	if fkName != "" {
		DB.Exec("ALTER TABLE agm_proxies DROP FOREIGN KEY " + fkName)
	}
	DB.Exec("ALTER TABLE agm_proxies DROP COLUMN proxy_shareholder_id")

	seedDefaultData(DB)

	fmt.Println("Database connected and migrated successfully")
	return DB
}

func seedDefaultData(db *gorm.DB) {
	var count int64
	db.Model(&models.User{}).Count(&count)
	if count == 0 {
		hashedPw, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
		admin := models.User{
			Username: "admin",
			Password: string(hashedPw),
			FullName: "System Administrator",
			Email:    "admin@shareadmin.com",
			Role:     "admin",
			IsActive: true,
		}
		db.Create(&admin)
		fmt.Println("Default admin user created (admin / admin123)")
	}

	db.Model(&models.BankCapital{}).Count(&count)
	if count == 0 {
		bc := models.BankCapital{
			AuthorizedCapital: 10000000000,
			PaidUpCapital:     0,
			ParValuePerShare:  1000,
			TotalShares:       10000000,
		}
		db.Create(&bc)
	}

	db.Model(&models.DividendTaxSchedule{}).Count(&count)
	if count == 0 {
		schedules := []models.DividendTaxSchedule{
			{MinAmount: 0, MaxAmount: 600, TaxRate: 0, Deduction: 0, Description: "Exempt"},
			{MinAmount: 601, MaxAmount: 1650, TaxRate: 10, Deduction: 60, Description: "10%"},
			{MinAmount: 1651, MaxAmount: 3200, TaxRate: 15, Deduction: 142.5, Description: "15%"},
			{MinAmount: 3201, MaxAmount: 5250, TaxRate: 20, Deduction: 302.5, Description: "20%"},
			{MinAmount: 5251, MaxAmount: 7800, TaxRate: 25, Deduction: 565, Description: "25%"},
			{MinAmount: 7801, MaxAmount: 10000000, TaxRate: 30, Deduction: 955, Description: "30%"},
		}
		db.Create(&schedules)
	}

	// Seed default tax formula
	db.Model(&models.SystemSetting{}).Where("`key` = ?", "tax_formula").Count(&count)
	if count == 0 {
		db.Create(&models.SystemSetting{
			Key:         "tax_formula",
			Value:       "(amount * rate / 100) - deduction",
			Description: "Formula for calculating dividend tax. Variables: amount, rate, deduction, min, max.",
		})
	}

	// Seed default share calculation formula — shares × days_held ÷ days_in_year.
	// The formula is evaluated PER INVESTMENT (per payment event), so `shares`
	// here is the number of shares represented by that single Investment row
	// and `days_held` is from that payment's date to the dividend reference
	// date. Sums across all of the shareholder's investments to give a
	// payment-by-payment weighted average — this is the standard banking
	// practice and correctly handles partial payments (each chunk contributes
	// only from its own payment date).
	db.Model(&models.SystemSetting{}).Where("`key` = ?", "share_calc_formula").Count(&count)
	if count == 0 {
		db.Create(&models.SystemSetting{
			Key:         "share_calc_formula",
			Value:       "shares * days_held / days_in_year",
			Description: "Formula for calculating eligible shares per investment. Per-investment: shares, amount, days_held, days_in_year, par_value, premium. Per-shareholder: total_shares, total_paid, paid_shares, blocked_shares, free_shares, subscription_shares. Company: paid_up_capital, authorized_capital, company_par_value, total_company_shares.",
		})
	}

	// Seed transfer fee formula
	db.Model(&models.SystemSetting{}).Where("`key` = ?", "transfer_fee_formula").Count(&count)
	if count == 0 {
		db.Create(&models.SystemSetting{
			Key:         "transfer_fee_formula",
			Value:       "shares * par_value * 0.02",
			Description: "Formula for calculating transfer service fee. Variables: shares, par_value, price_per_share, total_value.",
		})
	}

	// Seed dividend tax rate
	db.Model(&models.SystemSetting{}).Where("`key` = ?", "dividend_tax_rate").Count(&count)
	if count == 0 {
		db.Create(&models.SystemSetting{
			Key:         "dividend_tax_rate",
			Value:       "10",
			Description: "Default dividend tax rate percentage. Used when tax brackets are not applicable.",
		})
	}

	// Seed transfer fee rates and the new rule overrides:
	//   - stamp duty supports a fixed-amount mode (default) OR a percent mode
	//     (set transfer_stamp_duty_type=percent to switch back to %-based)
	//   - service fee has a per-transfer floor for low-share transfers
	//     (<100 shares minimum 1,000 ETB) and a hard cap (20,000 ETB).
	// The CGT rate stays at 15%, but it is now applied to the capital GAIN
	// (selling price − cost basis), not the gross transfer value. The cost
	// basis is read per-line from the source allocation's AllocatedAmount.
	transferSettings := []models.SystemSetting{
		{Key: "capital_gain_tax_rate", Value: "15", Description: "Capital gain tax rate on share transfers (percentage). Applied to (selling_price - cost_basis_per_share) * shares."},
		{Key: "transfer_service_fee_rate", Value: "1", Description: "Service fee rate on share transfers (percentage). Applied to transfer value, then bounded by min/max."},
		{Key: "transfer_service_fee_min_low_shares", Value: "1000", Description: "Minimum service fee in ETB when transferring fewer than the low-shares threshold."},
		{Key: "transfer_service_fee_low_shares_threshold", Value: "100", Description: "If number of shares is below this threshold, the low-shares service-fee minimum applies."},
		{Key: "transfer_service_fee_max", Value: "20000", Description: "Maximum service fee in ETB — the service fee will be capped at this amount."},
		{Key: "transfer_stamp_duty_type", Value: "fixed", Description: "Stamp-duty calculation mode. 'fixed' = flat ETB amount (uses transfer_stamp_duty_amount). 'percent' = % of transfer value (uses transfer_stamp_duty_rate)."},
		{Key: "transfer_stamp_duty_amount", Value: "5", Description: "Flat stamp-duty amount in ETB, applied when transfer_stamp_duty_type = 'fixed'."},
		{Key: "transfer_stamp_duty_rate", Value: "0.5", Description: "Stamp-duty rate (percentage), applied when transfer_stamp_duty_type = 'percent'."},
		{Key: "transfer_vat_rate", Value: "15", Description: "VAT rate applied on the transfer service fee (percentage)."},
	}
	for _, ts := range transferSettings {
		db.Model(&models.SystemSetting{}).Where("`key` = ?", ts.Key).Count(&count)
		if count == 0 {
			db.Create(&ts)
		}
	}

	// Seed mini app categories
	miniAppCategories := []models.MiniAppCategory{
		{Name: "Investment", Icon: "trending-up", DisplayOrder: 1},
		{Name: "Governance", Icon: "shield-checkmark", DisplayOrder: 2},
		{Name: "Community", Icon: "people", DisplayOrder: 3},
		{Name: "Financial Services", Icon: "wallet", DisplayOrder: 4},
	}
	for _, cat := range miniAppCategories {
		db.Model(&models.MiniAppCategory{}).Where("name = ?", cat.Name).Count(&count)
		if count == 0 {
			db.Create(&cat)
		}
	}

	// Seed e-commerce WebView mini app (upsert so route_path is always correct)
	var ecommerceApp models.MiniApp
	db.Where("name = ?", "E-Commerce Store").First(&ecommerceApp)
	var financialCat models.MiniAppCategory
	db.Where("name = ?", "Financial Services").First(&financialCat)
	ecommerceApp.Name = "E-Commerce Store"
	ecommerceApp.Description = "Demo e-commerce store for testing WebView mini apps"
	ecommerceApp.LaunchType = "webview"
	publicBase := os.Getenv("PUBLIC_BACKEND_URL")
	if publicBase == "" {
		publicBase = "http://localhost:8080"
	}
	ecommerceApp.RoutePath = publicBase + "/mini-apps/ecommerce/index.html"
	ecommerceApp.AppType = "external"
	ecommerceApp.Status = "active"
	ecommerceApp.DisplayOrder = 1
	if financialCat.ID != 0 {
		ecommerceApp.CategoryID = &financialCat.ID
	}
	db.Save(&ecommerceApp)
}
