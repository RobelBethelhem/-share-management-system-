package handlers

import (
	"encoding/json"
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
// Admin Announcement Endpoints
// ============================================================

// CreateAnnouncement handles multipart upload for video/image announcements
func CreateAnnouncement(c *gin.Context) {
	userID, _ := c.Get("user_id")

	title := c.PostForm("title")
	description := c.PostForm("description")
	annoType := c.PostForm("type") // "video" or "carousel"

	if title == "" || annoType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Title and type are required"})
		return
	}
	if annoType != "video" && annoType != "carousel" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Type must be 'video' or 'carousel'"})
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Media files are required"})
		return
	}

	files := form.File["media"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "At least one media file is required"})
		return
	}

	// Ensure upload directory exists
	uploadDir := filepath.Join("uploads", "announcements")
	os.MkdirAll(uploadDir, 0755)

	var mediaURLs []string
	var thumbnailURL string

	for i, file := range files {
		ext := strings.ToLower(filepath.Ext(file.Filename))
		filename := fmt.Sprintf("%s%s", uuid.New().String(), ext)
		savePath := filepath.Join(uploadDir, filename)

		if err := c.SaveUploadedFile(file, savePath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
			return
		}

		mediaURL := "/uploads/announcements/" + filename
		mediaURLs = append(mediaURLs, mediaURL)

		// First image as thumbnail for carousels, video itself for videos
		if i == 0 {
			thumbnailURL = mediaURL
		}
	}

	mediaJSON, _ := json.Marshal(mediaURLs)

	announcement := models.Announcement{
		Title:        title,
		Description:  description,
		Type:         annoType,
		MediaURLs:    string(mediaJSON),
		ThumbnailURL: thumbnailURL,
		CreatedBy:    userID.(uint),
		IsActive:     true,
	}

	if err := database.DB.Create(&announcement).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create announcement"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": announcement})
}

// GetAnnouncements returns all announcements for admin
func GetAnnouncements(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * pageSize

	var total int64
	database.DB.Model(&models.Announcement{}).Count(&total)

	var announcements []models.Announcement
	database.DB.Preload("Creator").Order("created_at DESC").
		Offset(offset).Limit(pageSize).Find(&announcements)

	c.JSON(http.StatusOK, gin.H{"data": announcements, "total": total})
}

// UpdateAnnouncement updates an announcement's text fields
func UpdateAnnouncement(c *gin.Context) {
	id := c.Param("id")
	var announcement models.Announcement
	if err := database.DB.First(&announcement, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Announcement not found"})
		return
	}

	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		IsActive    *bool  `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if req.Title != "" {
		announcement.Title = req.Title
	}
	if req.Description != "" {
		announcement.Description = req.Description
	}
	if req.IsActive != nil {
		announcement.IsActive = *req.IsActive
	}

	database.DB.Save(&announcement)
	c.JSON(http.StatusOK, gin.H{"data": announcement})
}

// DeleteAnnouncement soft-deletes an announcement
func DeleteAnnouncement(c *gin.Context) {
	id := c.Param("id")
	if err := database.DB.Delete(&models.Announcement{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Announcement deleted"})
}

// ============================================================
// Shareholder Feed Endpoints (Mobile)
// ============================================================

// GetFeeds returns paginated announcements for the mobile feed
func GetFeeds(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * pageSize

	var total int64
	database.DB.Model(&models.Announcement{}).Where("is_active = ?", true).Count(&total)

	var announcements []models.Announcement
	database.DB.Where("is_active = ?", true).
		Order("created_at DESC").
		Offset(offset).Limit(pageSize).
		Find(&announcements)

	// Get liked announcement IDs for this shareholder
	var likedIDs []uint
	database.DB.Model(&models.AnnouncementLike{}).
		Where("shareholder_id = ?", shID).
		Pluck("announcement_id", &likedIDs)
	likedMap := make(map[uint]bool)
	for _, id := range likedIDs {
		likedMap[id] = true
	}

	// Build response with is_liked field
	type FeedItem struct {
		models.Announcement
		IsLiked bool `json:"is_liked"`
	}

	var feeds []FeedItem
	for _, a := range announcements {
		// Track unique views per shareholder
		view := models.AnnouncementView{
			AnnouncementID: a.ID,
			ShareholderID:  shID.(uint),
		}
		result := database.DB.Where("announcement_id = ? AND shareholder_id = ?", a.ID, shID).FirstOrCreate(&view)
		if result.RowsAffected > 0 {
			// New unique view — increment count
			database.DB.Model(&models.Announcement{}).Where("id = ?", a.ID).
				UpdateColumn("view_count", database.DB.Raw("view_count + 1"))
			a.ViewCount++
		}

		feeds = append(feeds, FeedItem{
			Announcement: a,
			IsLiked:      likedMap[a.ID],
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": feeds, "total": total, "page": page})
}

// ToggleLike toggles a like on an announcement
func ToggleLike(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	annoID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid announcement ID"})
		return
	}

	var existing models.AnnouncementLike
	result := database.DB.Where("announcement_id = ? AND shareholder_id = ?", annoID, shID).First(&existing)

	if result.Error == nil {
		// Unlike
		database.DB.Delete(&existing)
		database.DB.Model(&models.Announcement{}).Where("id = ?", annoID).
			UpdateColumn("like_count", database.DB.Raw("GREATEST(like_count - 1, 0)"))
		c.JSON(http.StatusOK, gin.H{"liked": false})
	} else {
		// Like
		like := models.AnnouncementLike{
			AnnouncementID: uint(annoID),
			ShareholderID:  shID.(uint),
		}
		database.DB.Create(&like)
		database.DB.Model(&models.Announcement{}).Where("id = ?", annoID).
			UpdateColumn("like_count", database.DB.Raw("like_count + 1"))
		c.JSON(http.StatusOK, gin.H{"liked": true})
	}
}

// GetComments returns comments for an announcement
func GetComments(c *gin.Context) {
	annoID := c.Param("id")

	var comments []models.AnnouncementComment
	database.DB.Preload("Shareholder").Preload("Replies.Shareholder").
		Where("announcement_id = ? AND parent_id IS NULL", annoID).
		Order("created_at DESC").
		Find(&comments)

	c.JSON(http.StatusOK, gin.H{"data": comments})
}

// CreateComment adds a comment or reply to an announcement
func CreateComment(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	annoID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid announcement ID"})
		return
	}

	var req struct {
		Content  string `json:"content" binding:"required"`
		ParentID *uint  `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Content is required"})
		return
	}

	comment := models.AnnouncementComment{
		AnnouncementID: uint(annoID),
		ShareholderID:  shID.(uint),
		ParentID:       req.ParentID,
		Content:        req.Content,
	}

	if err := database.DB.Create(&comment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to post comment"})
		return
	}

	// Update comment count
	database.DB.Model(&models.Announcement{}).Where("id = ?", annoID).
		UpdateColumn("comment_count", database.DB.Raw("comment_count + 1"))

	// Load shareholder for response
	database.DB.Preload("Shareholder").First(&comment, comment.ID)

	c.JSON(http.StatusCreated, gin.H{"data": comment})
}

// DeleteComment removes a comment (own comments only)
func DeleteComment(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	commentID := c.Param("commentId")

	var comment models.AnnouncementComment
	if err := database.DB.First(&comment, commentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comment not found"})
		return
	}

	if comment.ShareholderID != shID.(uint) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Cannot delete others' comments"})
		return
	}

	// Count replies to adjust comment count
	var replyCount int64
	database.DB.Model(&models.AnnouncementComment{}).Where("parent_id = ?", comment.ID).Count(&replyCount)

	database.DB.Delete(&comment)
	// Also delete replies
	database.DB.Where("parent_id = ?", comment.ID).Delete(&models.AnnouncementComment{})

	database.DB.Model(&models.Announcement{}).Where("id = ?", comment.AnnouncementID).
		UpdateColumn("comment_count", database.DB.Raw(fmt.Sprintf("GREATEST(comment_count - %d, 0)", 1+replyCount)))

	c.JSON(http.StatusOK, gin.H{"message": "Comment deleted"})
}

// FormatTimeAgo returns a human-readable time string
func FormatTimeAgo(t time.Time) string {
	d := time.Since(t)
	switch {
	case d.Hours() >= 24*365:
		return fmt.Sprintf("%dy", int(d.Hours()/(24*365)))
	case d.Hours() >= 24*30:
		return fmt.Sprintf("%dmo", int(d.Hours()/(24*30)))
	case d.Hours() >= 24*7:
		return fmt.Sprintf("%dw", int(d.Hours()/(24*7)))
	case d.Hours() >= 24:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	case d.Hours() >= 1:
		return fmt.Sprintf("%dh", int(d.Hours()))
	case d.Minutes() >= 1:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	default:
		return "now"
	}
}
