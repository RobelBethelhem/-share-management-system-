package handlers

import (
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
)

// ============================================================
// Chat Settings
// ============================================================

func GetChatSettings(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var settings models.ChatSettings
	result := database.DB.Where("shareholder_id = ?", shID).First(&settings)
	if result.Error != nil {
		settings = models.ChatSettings{ShareholderID: shID.(uint)}
		database.DB.Create(&settings)
	}
	c.JSON(http.StatusOK, gin.H{"data": settings})
}

func UpdateChatSettings(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var req struct {
		ShowInvestment *bool `json:"show_investment"`
		ShowPhone      *bool `json:"show_phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	var settings models.ChatSettings
	database.DB.Where("shareholder_id = ?", shID).FirstOrCreate(&settings, models.ChatSettings{ShareholderID: shID.(uint)})

	if req.ShowInvestment != nil {
		settings.ShowInvestment = *req.ShowInvestment
	}
	if req.ShowPhone != nil {
		settings.ShowPhone = *req.ShowPhone
	}
	database.DB.Save(&settings)
	c.JSON(http.StatusOK, gin.H{"data": settings})
}

// ============================================================
// E2E Encryption Keys
// ============================================================

func UploadPublicKey(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var req struct {
		PublicKey string `json:"public_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Public key is required"})
		return
	}

	var settings models.ChatSettings
	database.DB.Where("shareholder_id = ?", shID).FirstOrCreate(&settings, models.ChatSettings{ShareholderID: shID.(uint)})
	settings.PublicKey = req.PublicKey
	database.DB.Save(&settings)
	c.JSON(http.StatusOK, gin.H{"message": "Public key uploaded"})
}

func GetPublicKey(c *gin.Context) {
	id := c.Param("shareholderId")
	var settings models.ChatSettings
	if err := database.DB.Where("shareholder_id = ?", id).First(&settings).Error; err != nil {
		// No settings yet — return empty key (not an error)
		c.JSON(http.StatusOK, gin.H{"public_key": ""})
		return
	}
	c.JSON(http.StatusOK, gin.H{"public_key": settings.PublicKey})
}

// ============================================================
// Contacts
// ============================================================

func GetChatContacts(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	q := c.Query("q")

	var shareholders []models.Shareholder
	query := database.DB.Where("id != ? AND status = ?", shID, "active")
	if q != "" {
		query = query.Where("first_name LIKE ? OR last_name LIKE ? OR account_no LIKE ?",
			"%"+q+"%", "%"+q+"%", "%"+q+"%")
	}
	query.Limit(50).Find(&shareholders)

	// Get chat settings for these shareholders
	var shIDs []uint
	for _, s := range shareholders {
		shIDs = append(shIDs, s.ID)
	}
	var allSettings []models.ChatSettings
	if len(shIDs) > 0 {
		database.DB.Where("shareholder_id IN ?", shIDs).Find(&allSettings)
	}
	settingsMap := make(map[uint]models.ChatSettings)
	for _, s := range allSettings {
		settingsMap[s.ID] = s
	}

	// Get investment info for those who opted in
	type ContactInfo struct {
		ID              uint    `json:"id"`
		AccountNo       string  `json:"account_no"`
		FirstName       string  `json:"first_name"`
		MiddleName      string  `json:"middle_name"`
		LastName        string  `json:"last_name"`
		Phone           string  `json:"phone,omitempty"`
		TotalShares     int64   `json:"total_shares,omitempty"`
		TotalInvested   float64 `json:"total_invested,omitempty"`
		ShowInvestment  bool    `json:"show_investment"`
		ShowPhone       bool    `json:"show_phone"`
		HasPublicKey    bool    `json:"has_public_key"`
	}

	var contacts []ContactInfo
	for _, sh := range shareholders {
		cs := settingsMap[sh.ID]
		ci := ContactInfo{
			ID:             sh.ID,
			AccountNo:      sh.AccountNo,
			FirstName:      sh.FirstName,
			MiddleName:     sh.MiddleName,
			LastName:       sh.LastName,
			ShowInvestment: cs.ShowInvestment,
			ShowPhone:      cs.ShowPhone,
			HasPublicKey:   cs.PublicKey != "",
		}

		if cs.ShowPhone {
			ci.Phone = sh.Phone
		}
		if cs.ShowInvestment {
			database.DB.Model(&models.Investment{}).
				Where("shareholder_id = ? AND status = ? AND approval_status = ?", sh.ID, "active", "approved").
				Select("COALESCE(SUM(number_of_shares), 0)").Scan(&ci.TotalShares)
			database.DB.Model(&models.Investment{}).
				Where("shareholder_id = ? AND status = ? AND approval_status = ?", sh.ID, "active", "approved").
				Select("COALESCE(SUM(amount), 0)").Scan(&ci.TotalInvested)
		}

		contacts = append(contacts, ci)
	}

	c.JSON(http.StatusOK, gin.H{"data": contacts})
}

// ============================================================
// Conversations
// ============================================================

func GetConversations(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")

	var conversations []models.Conversation
	database.DB.Preload("Participant1").Preload("Participant2").
		Where("participant1_id = ? OR participant2_id = ?", shID, shID).
		Order("last_message_at DESC").
		Find(&conversations)

	type ConvResponse struct {
		models.Conversation
		UnreadCount int            `json:"unread_count"`
		LastMessage *models.Message `json:"last_message,omitempty"`
	}

	var result []ConvResponse
	for _, conv := range conversations {
		cr := ConvResponse{Conversation: conv}

		// Unread count
		var unread int64
		database.DB.Model(&models.Message{}).
			Where("conversation_id = ? AND sender_id != ? AND is_read = ?", conv.ID, shID, false).
			Count(&unread)
		cr.UnreadCount = int(unread)

		// Last message
		var lastMsg models.Message
		if err := database.DB.Preload("Sender").
			Where("conversation_id = ?", conv.ID).
			Order("created_at DESC").First(&lastMsg).Error; err == nil {
			cr.LastMessage = &lastMsg
		}

		result = append(result, cr)
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

func CreateConversation(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var req struct {
		RecipientID uint `json:"recipient_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Recipient ID is required"})
		return
	}

	myID := shID.(uint)
	if req.RecipientID == myID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot chat with yourself"})
		return
	}

	// Normalize: smaller ID is Participant1
	p1, p2 := myID, req.RecipientID
	if p1 > p2 {
		p1, p2 = p2, p1
	}

	// Check if conversation already exists
	var existing models.Conversation
	result := database.DB.Preload("Participant1").Preload("Participant2").
		Where("participant1_id = ? AND participant2_id = ?", p1, p2).First(&existing)
	if result.Error == nil {
		c.JSON(http.StatusOK, gin.H{"data": existing})
		return
	}

	conv := models.Conversation{
		Participant1ID: p1,
		Participant2ID: p2,
	}
	database.DB.Create(&conv)
	database.DB.Preload("Participant1").Preload("Participant2").First(&conv, conv.ID)

	c.JSON(http.StatusCreated, gin.H{"data": conv})
}

// ============================================================
// Messages
// ============================================================

func GetMessages(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	convID := c.Param("convId")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}

	// Verify participant
	var conv models.Conversation
	if err := database.DB.First(&conv, convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}
	myID := shID.(uint)
	if conv.Participant1ID != myID && conv.Participant2ID != myID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a participant"})
		return
	}

	offset := (page - 1) * pageSize
	var messages []models.Message
	database.DB.Preload("Sender").Preload("ReplyTo.Sender").Preload("Reactions.Sender").
		Where("conversation_id = ?", convID).
		Order("created_at DESC").
		Offset(offset).Limit(pageSize).
		Find(&messages)

	var total int64
	database.DB.Model(&models.Message{}).Where("conversation_id = ?", convID).Count(&total)

	c.JSON(http.StatusOK, gin.H{"data": messages, "total": total})
}

func SendMessage(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	convID, _ := strconv.ParseUint(c.Param("convId"), 10, 64)

	var conv models.Conversation
	if err := database.DB.First(&conv, convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	myID := shID.(uint)
	if conv.Participant1ID != myID && conv.Participant2ID != myID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a participant"})
		return
	}

	var req struct {
		EncryptedContent string `json:"encrypted_content" binding:"required"`
		Nonce            string `json:"nonce" binding:"required"`
		ReplyToID        *uint  `json:"reply_to_id"`
		IsForwarded      bool   `json:"is_forwarded"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Encrypted content and nonce are required"})
		return
	}

	msg := models.Message{
		ConversationID:   uint(convID),
		SenderID:         myID,
		EncryptedContent: req.EncryptedContent,
		Nonce:            req.Nonce,
		ReplyToID:        req.ReplyToID,
		IsForwarded:      req.IsForwarded,
	}
	database.DB.Create(&msg)

	// Update conversation last_message_at
	now := time.Now()
	database.DB.Model(&conv).UpdateColumn("last_message_at", now)

	database.DB.Preload("Sender").Preload("ReplyTo.Sender").First(&msg, msg.ID)
	c.JSON(http.StatusCreated, gin.H{"data": msg})
}

func MarkMessagesRead(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	convID := c.Param("convId")

	database.DB.Model(&models.Message{}).
		Where("conversation_id = ? AND sender_id != ? AND is_read = ?", convID, shID, false).
		UpdateColumn("is_read", true)

	c.JSON(http.StatusOK, gin.H{"message": "Messages marked as read"})
}

func DeleteMessage(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	msgID := c.Param("msgId")

	var msg models.Message
	if err := database.DB.First(&msg, msgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}
	if msg.SenderID != shID.(uint) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Can only delete own messages"})
		return
	}
	database.DB.Delete(&msg)
	c.JSON(http.StatusOK, gin.H{"message": "Message deleted"})
}

// ============================================================
// Reactions
// ============================================================

func ReactToMessage(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	msgID, _ := strconv.ParseUint(c.Param("msgId"), 10, 64)

	var req struct {
		Emoji string `json:"emoji" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Emoji is required"})
		return
	}

	myID := shID.(uint)

	// Remove existing reaction by this user on this message
	database.DB.Where("message_id = ? AND sender_id = ?", msgID, myID).Delete(&models.MessageReaction{})

	reaction := models.MessageReaction{
		MessageID: uint(msgID),
		SenderID:  myID,
		Emoji:     req.Emoji,
	}
	database.DB.Create(&reaction)
	database.DB.Preload("Sender").First(&reaction, reaction.ID)

	c.JSON(http.StatusOK, gin.H{"data": reaction})
}

func RemoveReaction(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	msgID := c.Param("msgId")

	database.DB.Where("message_id = ? AND sender_id = ?", msgID, shID).Delete(&models.MessageReaction{})
	c.JSON(http.StatusOK, gin.H{"message": "Reaction removed"})
}

func GetUnreadTotal(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")

	var convIDs []uint
	database.DB.Model(&models.Conversation{}).
		Where("participant1_id = ? OR participant2_id = ?", shID, shID).
		Pluck("id", &convIDs)

	var total int64
	if len(convIDs) > 0 {
		database.DB.Model(&models.Message{}).
			Where("conversation_id IN ? AND sender_id != ? AND is_read = ?", convIDs, shID, false).
			Count(&total)
	}

	c.JSON(http.StatusOK, gin.H{"unread": total})
}
