package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

var allowedDocTypes = map[string]bool{
	".pdf": true, ".doc": true, ".docx": true,
	".xls": true, ".xlsx": true, ".csv": true,
	".png": true, ".jpg": true, ".jpeg": true,
}

var categoryFolders = map[string]string{
	"financial_reports":      "financial_reports",
	"annual_reports":         "annual_reports",
	"agm_documents":          "agm_documents",
	"regulatory_notices":     "regulatory_notices",
	"dividend_announcements": "dividend_announcements",
	"other":                  "other",
}

// ============================================================
// Admin Endpoints
// ============================================================

func UploadDocument(c *gin.Context) {
	userID, _ := c.Get("user_id")

	title := c.PostForm("title")
	description := c.PostForm("description")
	category := c.PostForm("category")

	if title == "" || category == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Title and category are required"})
		return
	}

	folder, ok := categoryFolders[category]
	if !ok {
		folder = "other"
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File is required"})
		return
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if !allowedDocTypes[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File type not allowed. Supported: PDF, Excel, Word, Images"})
		return
	}

	// Create directory
	uploadDir := filepath.Join("uploads", "documents", folder)
	os.MkdirAll(uploadDir, 0755)

	// Generate unique filename
	timestamp := time.Now().UnixMilli()
	uniqueName := fmt.Sprintf("%d_%d%s", timestamp, userID, ext)
	savePath := filepath.Join(uploadDir, uniqueName)

	if err := c.SaveUploadedFile(file, savePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}

	fileURL := fmt.Sprintf("/uploads/documents/%s/%s", folder, uniqueName)

	doc := models.Document{
		Title:       title,
		Description: description,
		Category:    category,
		FileName:    file.Filename,
		FilePath:    fileURL,
		FileType:    strings.TrimPrefix(ext, "."),
		FileSize:    file.Size,
		UploadedBy:  userID.(uint),
	}
	database.DB.Create(&doc)
	database.DB.Preload("Uploader").First(&doc, doc.ID)

	c.JSON(http.StatusCreated, gin.H{"data": doc})
}

func GetDocumentsAdmin(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	category := c.Query("category")
	q := c.Query("q")
	if page < 1 {
		page = 1
	}

	var total int64
	query := database.DB.Model(&models.Document{})
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if q != "" {
		query = query.Where("title LIKE ? OR description LIKE ?", "%"+q+"%", "%"+q+"%")
	}
	query.Count(&total)

	var docs []models.Document
	query.Preload("Uploader").Order("created_at DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).Find(&docs)

	c.JSON(http.StatusOK, gin.H{"data": docs, "total": total})
}

func UpdateDocument(c *gin.Context) {
	id := c.Param("id")
	var doc models.Document
	if err := database.DB.First(&doc, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Document not found"})
		return
	}

	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Category    string `json:"category"`
	}
	c.ShouldBindJSON(&req)
	if req.Title != "" {
		doc.Title = req.Title
	}
	if req.Description != "" {
		doc.Description = req.Description
	}
	if req.Category != "" {
		doc.Category = req.Category
	}
	database.DB.Save(&doc)
	c.JSON(http.StatusOK, gin.H{"data": doc})
}

func DeleteDocument(c *gin.Context) {
	id := c.Param("id")
	var doc models.Document
	if err := database.DB.First(&doc, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Document not found"})
		return
	}
	// Remove file from filesystem
	os.Remove(strings.TrimPrefix(doc.FilePath, "/"))
	database.DB.Delete(&doc)
	c.JSON(http.StatusOK, gin.H{"message": "Document deleted"})
}

func GetDocumentCategories(c *gin.Context) {
	type CatCount struct {
		Category string `json:"category"`
		Count    int64  `json:"count"`
	}
	var results []CatCount
	database.DB.Model(&models.Document{}).
		Select("category, COUNT(*) as count").
		Group("category").Order("count DESC").
		Find(&results)
	c.JSON(http.StatusOK, gin.H{"data": results})
}

// ============================================================
// Shareholder Endpoints (Mobile)
// ============================================================

func GetShareholderDocuments(c *gin.Context) {
	category := c.Query("category")
	q := c.Query("q")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}

	query := database.DB.Model(&models.Document{})
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if q != "" {
		query = query.Where("title LIKE ? OR description LIKE ?", "%"+q+"%", "%"+q+"%")
	}

	var total int64
	query.Count(&total)

	var docs []models.Document
	query.Order("created_at DESC").Offset((page - 1) * 20).Limit(20).Find(&docs)

	c.JSON(http.StatusOK, gin.H{"data": docs, "total": total})
}

func GetShareholderDocCategories(c *gin.Context) {
	type CatCount struct {
		Category string `json:"category"`
		Count    int64  `json:"count"`
	}
	var results []CatCount
	database.DB.Model(&models.Document{}).
		Select("category, COUNT(*) as count").
		Group("category").Order("count DESC").
		Find(&results)
	c.JSON(http.StatusOK, gin.H{"data": results})
}

func DownloadDocument(c *gin.Context) {
	id := c.Param("id")
	var doc models.Document
	if err := database.DB.First(&doc, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Document not found"})
		return
	}
	// Increment download count
	database.DB.Model(&doc).UpdateColumn("downloads", doc.Downloads+1)
	c.JSON(http.StatusOK, gin.H{"data": doc})
}
