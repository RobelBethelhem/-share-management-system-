package handlers

import (
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

var ethMonths = []string{
	"Meskerem", "Tikimt", "Hidar", "Tahsas", "Tir", "Yekatit",
	"Megabit", "Miyazya", "Ginbot", "Sene", "Hamle", "Nehase", "Pagume",
}

var ethMonthsAmharic = []string{
	"መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት",
	"መጋቢት", "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ",
}

// GregorianToEthiopian converts a Gregorian date to Ethiopian date
func GregorianToEthiopian(gYear, gMonth, gDay int) (ethYear, ethMonth, ethDay int) {
	gDate := time.Date(gYear, time.Month(gMonth), gDay, 0, 0, 0, 0, time.UTC)

	// Ethiopian year that could start in this Gregorian year
	ethYear = gYear - 7
	septDay := 11
	if ethYear%4 == 0 {
		septDay = 12
	}
	newYear := time.Date(gYear, time.September, septDay, 0, 0, 0, 0, time.UTC)

	if gDate.Before(newYear) {
		ethYear = gYear - 8
		septDay = 11
		if ethYear%4 == 0 {
			septDay = 12
		}
		newYear = time.Date(gYear-1, time.September, septDay, 0, 0, 0, 0, time.UTC)
	}

	diffDays := int(math.Round(gDate.Sub(newYear).Hours() / 24))

	ethMonth = diffDays/30 + 1
	ethDay = diffDays%30 + 1

	return ethYear, ethMonth, ethDay
}

// ConvertToEthiopian is the API handler
func ConvertToEthiopian(c *gin.Context) {
	dateStr := c.Query("date")
	if dateStr == "" {
		dateStr = time.Now().Format("2006-01-02")
	}

	t, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid date format. Use YYYY-MM-DD"})
		return
	}

	ethYear, ethMonth, ethDay := GregorianToEthiopian(t.Year(), int(t.Month()), t.Day())

	monthName := "Pagume"
	monthAmharic := "ጳጉሜ"
	if ethMonth >= 1 && ethMonth <= 13 {
		monthName = ethMonths[ethMonth-1]
		monthAmharic = ethMonthsAmharic[ethMonth-1]
	}

	c.JSON(http.StatusOK, gin.H{
		"gregorian":     dateStr,
		"ethiopian":     fmt.Sprintf("%d/%02d/%02d", ethYear, ethMonth, ethDay),
		"year":          ethYear,
		"month":         ethMonth,
		"day":           ethDay,
		"month_name":    monthName,
		"month_amharic": monthAmharic,
		"long_format":   fmt.Sprintf("%s %d, %d", monthName, ethDay, ethYear),
	})
}
