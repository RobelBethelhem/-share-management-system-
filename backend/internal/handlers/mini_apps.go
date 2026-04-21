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
	"github.com/google/uuid"
)

// ============================================================
// Admin — Mini App CRUD
// ============================================================

func GetMiniApps(c *gin.Context) {
	query := database.DB.Preload("Category")

	if cat := c.Query("category_id"); cat != "" {
		query = query.Where("category_id = ?", cat)
	}
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))

	var total int64
	query.Model(&models.MiniApp{}).Count(&total)

	var apps []models.MiniApp
	offset := (page - 1) * pageSize
	query.Offset(offset).Limit(pageSize).Order("display_order ASC, id ASC").Find(&apps)

	c.JSON(http.StatusOK, gin.H{"data": apps, "total": total, "page": page, "page_size": pageSize})
}

func GetMiniApp(c *gin.Context) {
	id := c.Param("id")
	var app models.MiniApp
	if err := database.DB.Preload("Category").Preload("Permissions").Preload("Settings").
		First(&app, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Mini app not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func CreateMiniApp(c *gin.Context) {
	name := c.PostForm("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	app := models.MiniApp{
		Name:        name,
		Description: c.PostForm("description"),
		RoutePath:   c.PostForm("route_path"),
		AppType:     c.DefaultPostForm("app_type", "internal"),
		LaunchType:  c.DefaultPostForm("launch_type", "screen"),
		Status:      c.DefaultPostForm("status", "active"),
	}

	if catID := c.PostForm("category_id"); catID != "" {
		id, _ := strconv.ParseUint(catID, 10, 32)
		uid := uint(id)
		app.CategoryID = &uid
	}
	if order := c.PostForm("display_order"); order != "" {
		app.DisplayOrder, _ = strconv.Atoi(order)
	}

	// Handle icon upload
	uploadDir := filepath.Join("uploads", "mini-apps")
	os.MkdirAll(uploadDir, 0755)

	if icon, err := c.FormFile("icon"); err == nil {
		ext := strings.ToLower(filepath.Ext(icon.Filename))
		filename := fmt.Sprintf("icon_%s%s", uuid.New().String(), ext)
		savePath := filepath.Join(uploadDir, filename)
		if err := c.SaveUploadedFile(icon, savePath); err == nil {
			app.IconURL = "/uploads/mini-apps/" + filename
		}
	}

	// Handle banner upload
	if banner, err := c.FormFile("banner"); err == nil {
		ext := strings.ToLower(filepath.Ext(banner.Filename))
		filename := fmt.Sprintf("banner_%s%s", uuid.New().String(), ext)
		savePath := filepath.Join(uploadDir, filename)
		if err := c.SaveUploadedFile(banner, savePath); err == nil {
			app.BannerImage = "/uploads/mini-apps/" + filename
		}
	}

	if err := database.DB.Create(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create mini app"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": app, "message": "Mini app created"})
}

func UpdateMiniApp(c *gin.Context) {
	id := c.Param("id")
	var app models.MiniApp
	if err := database.DB.First(&app, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Mini app not found"})
		return
	}

	if name := c.PostForm("name"); name != "" {
		app.Name = name
	}
	if desc := c.PostForm("description"); desc != "" {
		app.Description = desc
	}
	if route := c.PostForm("route_path"); route != "" {
		app.RoutePath = route
	}
	if appType := c.PostForm("app_type"); appType != "" {
		app.AppType = appType
	}
	if launchType := c.PostForm("launch_type"); launchType != "" {
		app.LaunchType = launchType
	}
	if status := c.PostForm("status"); status != "" {
		app.Status = status
	}
	if catID := c.PostForm("category_id"); catID != "" {
		cid, _ := strconv.ParseUint(catID, 10, 32)
		uid := uint(cid)
		app.CategoryID = &uid
	}
	if order := c.PostForm("display_order"); order != "" {
		app.DisplayOrder, _ = strconv.Atoi(order)
	}

	uploadDir := filepath.Join("uploads", "mini-apps")
	os.MkdirAll(uploadDir, 0755)

	if icon, err := c.FormFile("icon"); err == nil {
		ext := strings.ToLower(filepath.Ext(icon.Filename))
		filename := fmt.Sprintf("icon_%s%s", uuid.New().String(), ext)
		savePath := filepath.Join(uploadDir, filename)
		if err := c.SaveUploadedFile(icon, savePath); err == nil {
			app.IconURL = "/uploads/mini-apps/" + filename
		}
	}

	if banner, err := c.FormFile("banner"); err == nil {
		ext := strings.ToLower(filepath.Ext(banner.Filename))
		filename := fmt.Sprintf("banner_%s%s", uuid.New().String(), ext)
		savePath := filepath.Join(uploadDir, filename)
		if err := c.SaveUploadedFile(banner, savePath); err == nil {
			app.BannerImage = "/uploads/mini-apps/" + filename
		}
	}

	database.DB.Save(&app)
	c.JSON(http.StatusOK, gin.H{"data": app, "message": "Mini app updated"})
}

func DeleteMiniApp(c *gin.Context) {
	id := c.Param("id")
	result := database.DB.Delete(&models.MiniApp{}, id)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Mini app not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Mini app deleted"})
}

func UpdateMiniAppStatus(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Status is required"})
		return
	}
	result := database.DB.Model(&models.MiniApp{}).Where("id = ?", id).Update("status", req.Status)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Mini app not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Status updated"})
}

func ReorderMiniApps(c *gin.Context) {
	var req struct {
		Orders []struct {
			ID    uint `json:"id"`
			Order int  `json:"display_order"`
		} `json:"orders"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	for _, o := range req.Orders {
		database.DB.Model(&models.MiniApp{}).Where("id = ?", o.ID).Update("display_order", o.Order)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Order updated"})
}

// ============================================================
// Admin — Mini App Categories
// ============================================================

func GetMiniAppCategories(c *gin.Context) {
	var categories []models.MiniAppCategory
	database.DB.Order("display_order ASC").Find(&categories)
	c.JSON(http.StatusOK, gin.H{"data": categories})
}

func CreateMiniAppCategory(c *gin.Context) {
	var cat models.MiniAppCategory
	if err := c.ShouldBindJSON(&cat); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Create(&cat)
	c.JSON(http.StatusCreated, gin.H{"data": cat})
}

func UpdateMiniAppCategory(c *gin.Context) {
	id := c.Param("id")
	var cat models.MiniAppCategory
	if err := database.DB.First(&cat, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}
	if err := c.ShouldBindJSON(&cat); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	database.DB.Save(&cat)
	c.JSON(http.StatusOK, gin.H{"data": cat})
}

func DeleteMiniAppCategory(c *gin.Context) {
	id := c.Param("id")
	// Check if any mini apps reference this category
	var count int64
	database.DB.Model(&models.MiniApp{}).Where("category_id = ?", id).Count(&count)
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Cannot delete category with existing mini apps"})
		return
	}
	database.DB.Delete(&models.MiniAppCategory{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "Category deleted"})
}

// ============================================================
// Shareholder — Active Mini Apps
// ============================================================

func GetActiveMiniApps(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")

	// Get shareholder info for permission checking
	var sh models.Shareholder
	database.DB.First(&sh, shID)

	var apps []models.MiniApp
	database.DB.Preload("Category").Preload("Permissions").
		Where("status = ?", "active").
		Order("display_order ASC").Find(&apps)

	// Filter by permissions
	var result []models.MiniApp
	for _, app := range apps {
		if len(app.Permissions) == 0 {
			result = append(result, app)
			continue
		}
		allowed := false
		for _, perm := range app.Permissions {
			statusMatch := perm.RequiredShareholderStatus == "" || perm.RequiredShareholderStatus == sh.Status
			roleMatch := perm.RequiredRole == "" || perm.RequiredRole == "shareholder"
			if statusMatch && roleMatch {
				allowed = true
				break
			}
		}
		if allowed {
			result = append(result, app)
		}
	}

	// Group by category
	type CategoryGroup struct {
		Category *models.MiniAppCategory `json:"category"`
		Apps     []models.MiniApp        `json:"apps"`
	}

	groups := make(map[uint]*CategoryGroup)
	var uncategorized []models.MiniApp

	for _, app := range result {
		if app.CategoryID == nil {
			uncategorized = append(uncategorized, app)
			continue
		}
		if _, ok := groups[*app.CategoryID]; !ok {
			groups[*app.CategoryID] = &CategoryGroup{Category: app.Category}
		}
		groups[*app.CategoryID].Apps = append(groups[*app.CategoryID].Apps, app)
	}

	var grouped []CategoryGroup
	for _, g := range groups {
		grouped = append(grouped, *g)
	}
	if len(uncategorized) > 0 {
		grouped = append(grouped, CategoryGroup{Category: nil, Apps: uncategorized})
	}

	if result == nil {
		result = make([]models.MiniApp, 0)
	}

	_ = time.Now() // ensure time import used

	c.JSON(http.StatusOK, gin.H{"data": result, "grouped": grouped})
}
