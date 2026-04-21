package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

// nextCertNo generates a sequential certificate number like CERT-202603-0001
func nextCertNo() string {
	var count int64
	database.DB.Model(&models.Certificate{}).Count(&count)
	return fmt.Sprintf("CERT-%s-%04d", time.Now().Format("200601"), count+1)
}

func GetCertificates(c *gin.Context) {
	query := database.DB.Preload("Shareholder").Preload("Allocation")

	if shID := c.Query("shareholder_id"); shID != "" {
		query = query.Where("shareholder_id = ?", shID)
	}
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if scope := c.Query("cert_scope"); scope != "" {
		query = query.Where("cert_scope = ?", scope)
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	var total int64
	query.Model(&models.Certificate{}).Count(&total)
	offset := (page - 1) * pageSize

	var certs []models.Certificate
	query.Offset(offset).Limit(pageSize).Order("id DESC").Find(&certs)

	c.JSON(http.StatusOK, gin.H{"data": certs, "total": total, "page": page, "page_size": pageSize})
}

func GetCertificate(c *gin.Context) {
	id := c.Param("id")
	var cert models.Certificate
	if err := database.DB.Preload("Shareholder").Preload("Shareholder.Address").
		Preload("Allocation").Preload("Allocation.Subscription").
		First(&cert, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Certificate not found"})
		return
	}
	c.JSON(http.StatusOK, cert)
}

func CreateCertificate(c *gin.Context) {
	var input struct {
		ShareholderID uint    `json:"shareholder_id" binding:"required"`
		CertificateNo string  `json:"certificate_no"`
		IssueDate     *string `json:"issue_date"`
		CertScope     string  `json:"cert_scope"` // "total" or "per_allocation"
		AllocationID  *uint   `json:"allocation_id"`
		ParValue      float64 `json:"par_value"`
		Remark        string  `json:"remark"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.CertScope == "" {
		input.CertScope = "total"
	}
	if input.CertScope != "total" && input.CertScope != "per_allocation" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cert_scope must be 'total' or 'per_allocation'"})
		return
	}
	if input.CertScope == "per_allocation" && input.AllocationID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "allocation_id is required for per_allocation scope"})
		return
	}

	// Verify shareholder exists
	var sh models.Shareholder
	if err := database.DB.First(&sh, input.ShareholderID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Shareholder not found"})
		return
	}

	// Par value from bank capital if not provided
	if input.ParValue <= 0 {
		var bc models.BankCapital
		if err := database.DB.First(&bc).Error; err == nil {
			input.ParValue = bc.ParValuePerShare
		}
	}

	var numberOfShares int64

	if input.CertScope == "per_allocation" {
		// Validate allocation belongs to shareholder
		var alloc models.Allocation
		if err := database.DB.First(&alloc, *input.AllocationID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Allocation not found"})
			return
		}
		if alloc.ShareholderID != input.ShareholderID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Allocation does not belong to this shareholder"})
			return
		}
		numberOfShares = alloc.AllocatedShares
	} else {
		// Sum all allocations — no approval_status filter, matching GetShareholderInvestmentSummary
		database.DB.Model(&models.Allocation{}).
			Where("shareholder_id = ?", input.ShareholderID).
			Select("COALESCE(SUM(allocated_shares), 0)").Scan(&numberOfShares)
	}

	if numberOfShares <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No shares found for the selected scope"})
		return
	}

	// Auto-generate certificate number if not provided
	certNo := input.CertificateNo
	if certNo == "" {
		certNo = nextCertNo()
	}

	// Check uniqueness
	var existing int64
	database.DB.Model(&models.Certificate{}).Where("certificate_no = ?", certNo).Count(&existing)
	if existing > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("Certificate number '%s' already exists", certNo)})
		return
	}

	var issueDate *time.Time
	if input.IssueDate != nil && *input.IssueDate != "" {
		t, err := time.Parse(time.RFC3339, *input.IssueDate)
		if err != nil {
			// Try date-only format
			t, err = time.Parse("2006-01-02", *input.IssueDate)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid issue_date format"})
				return
			}
		}
		issueDate = &t
	}

	cert := models.Certificate{
		ShareholderID:  input.ShareholderID,
		CertificateNo:  certNo,
		IssueDate:      issueDate,
		NumberOfShares: numberOfShares,
		ParValue:       input.ParValue,
		TotalValue:     float64(numberOfShares) * input.ParValue,
		Status:         "active",
		CertScope:      input.CertScope,
		AllocationID:   input.AllocationID,
		Remark:         input.Remark,
	}

	if err := database.DB.Create(&cert).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create certificate"})
		return
	}

	// Reload with associations
	database.DB.Preload("Shareholder").Preload("Allocation").First(&cert, cert.ID)

	c.JSON(http.StatusCreated, gin.H{
		"message": "Certificate created",
		"id":      cert.ID,
		"cert_no": cert.CertificateNo,
		"data":    cert,
	})
}

func UpdateCertificate(c *gin.Context) {
	id := c.Param("id")
	var cert models.Certificate
	if err := database.DB.First(&cert, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Certificate not found"})
		return
	}
	var input struct {
		Status  string `json:"status"`
		Remark  string `json:"remark"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updates := map[string]interface{}{}
	if input.Status != "" {
		updates["status"] = input.Status
	}
	if input.Remark != "" {
		updates["remark"] = input.Remark
	}
	database.DB.Model(&cert).Updates(updates)
	c.JSON(http.StatusOK, gin.H{"message": "Certificate updated"})
}

func PrintCertificate(c *gin.Context) {
	id := c.Param("id")
	now := time.Now()
	database.DB.Model(&models.Certificate{}).Where("id = ?", id).
		Updates(map[string]interface{}{"is_printed": true, "printed_at": now})
	c.JSON(http.StatusOK, gin.H{"message": "Certificate marked as printed"})
}

// GenerateCertNo returns a suggested certificate number for the frontend
func GenerateCertNo(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"cert_no": nextCertNo()})
}
