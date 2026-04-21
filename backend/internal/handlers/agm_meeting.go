package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"share-management-system/internal/database"
	"share-management-system/internal/middleware"
	"share-management-system/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// ============================================================
// Proxy Login (Public - no auth required)
// ============================================================

func ProxyLogin(c *gin.Context) {
	var req struct {
		ProxyCode string `json:"proxy_code" binding:"required"`
		IDNumber  string `json:"id_number" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Proxy code and ID number are required"})
		return
	}

	var proxy models.AGMProxy
	if err := database.DB.Preload("Shareholder").
		Where("proxy_code = ?", req.ProxyCode).
		First(&proxy).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid proxy code"})
		return
	}

	// Check proxy status
	if proxy.Status == "pending" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Your proxy authorization is pending admin approval. Please wait.", "status": "pending"})
		return
	}
	if proxy.Status == "rejected" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Your proxy authorization was rejected by the admin.", "status": "rejected"})
		return
	}
	if proxy.Status == "revoked" {
		c.JSON(http.StatusForbidden, gin.H{"error": "This proxy authorization has been revoked.", "status": "revoked"})
		return
	}
	if proxy.Status == "used" {
		// Allow re-login if the meeting is still active/upcoming
		var meeting models.AGMMeeting
		database.DB.First(&meeting, proxy.MeetingID)
		if meeting.Status == "closed" {
			c.JSON(http.StatusForbidden, gin.H{"error": "This proxy code has already been used and the meeting is closed.", "status": "used"})
			return
		}
		// Meeting still active — allow re-login, reset status to approved so flow continues
		proxy.Status = "approved"
	}
	if proxy.Status != "approved" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Proxy authorization is not active.", "status": proxy.Status})
		return
	}

	// Verify ID number
	if proxy.ProxyIDNo != req.IDNumber {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "ID number does not match proxy authorization"})
		return
	}

	sh := proxy.Shareholder
	meetingIDStr := fmt.Sprintf("%d", proxy.MeetingID)

	// Auto-register attendance if not already
	var existingAttendance models.AGMAttendance
	if database.DB.Where("shareholder_id = ? AND agm_year = ?", proxy.ShareholderID, meetingIDStr).
		First(&existingAttendance).Error != nil {

		var totalShares int64
		database.DB.Model(&models.Investment{}).
			Where("shareholder_id = ? AND status = ? AND approval_status = ?", proxy.ShareholderID, "active", "approved").
			Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

		var totalSystemShares int64
		database.DB.Model(&models.Investment{}).
			Where("status = ? AND approval_status = ?", "active", "approved").
			Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalSystemShares)

		votingPower := float64(0)
		if totalSystemShares > 0 {
			votingPower = float64(totalShares) * 100 / float64(totalSystemShares)
		}

		var meeting models.AGMMeeting
		database.DB.First(&meeting, proxy.MeetingID)

		database.DB.Create(&models.AGMAttendance{
			ShareholderID:  proxy.ShareholderID,
			AGMDate:        meeting.MeetingDate,
			AGMYear:        meetingIDStr,
			AttendanceType: "proxy",
			ProxyName:      proxy.ProxyName,
			NumberOfShares: totalShares,
			VotingPower:    votingPower,
			IsPresent:      true,
		})
	}

	// Mark proxy as used
	proxy.Status = "used"
	database.DB.Save(&proxy)

	// Generate JWT with shareholder's identity + proxy role
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"shareholder_id": sh.ID,
		"account_no":     sh.AccountNo,
		"role":           "proxy",
		"proxy_name":     proxy.ProxyName,
		"meeting_id":     proxy.MeetingID,
		"exp":            time.Now().Add(12 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString(middleware.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": tokenString,
		"shareholder": gin.H{
			"id":         sh.ID,
			"first_name": sh.FirstName,
			"last_name":  sh.LastName,
			"account_no": sh.AccountNo,
		},
		"proxy_name": proxy.ProxyName,
		"meeting_id": proxy.MeetingID,
		"is_proxy":   true,
	})
}

// ============================================================
// Admin - Meetings
// ============================================================

func CreateMeeting(c *gin.Context) {
	var req struct {
		Title       string `json:"title" binding:"required"`
		Description string `json:"description"`
		MeetingDate string `json:"meeting_date"`
		MeetingType string `json:"meeting_type"`
		AccessCode  string `json:"access_code"`
		Status      string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Meeting title is required"})
		return
	}

	meeting := models.AGMMeeting{
		Title:       req.Title,
		Description: req.Description,
		MeetingType: "hybrid",
		Status:      "upcoming",
	}
	if req.Status != "" {
		meeting.Status = req.Status
	}
	if req.MeetingType != "" {
		meeting.MeetingType = req.MeetingType
	}
	if req.AccessCode != "" {
		meeting.AccessCode = req.AccessCode
	}
	if req.MeetingDate != "" {
		for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05Z", "2006-01-02", "2006-01-02T15:04:05.000Z"} {
			if t, err := time.Parse(layout, req.MeetingDate); err == nil {
				meeting.MeetingDate = &t
				break
			}
		}
	}

	database.DB.Create(&meeting)
	c.JSON(http.StatusCreated, gin.H{"data": meeting})
}

func GetMeetings(c *gin.Context) {
	var meetings []models.AGMMeeting
	database.DB.Preload("Agendas").Order("meeting_date DESC").Find(&meetings)

	// Enrich with attendance/agenda counts
	type MeetingResponse struct {
		models.AGMMeeting
		AttendeeCount int64 `json:"attendee_count"`
		AgendaCount   int64 `json:"agenda_count"`
		VoteCount     int64 `json:"vote_count"`
	}
	var result []MeetingResponse
	for _, m := range meetings {
		mr := MeetingResponse{AGMMeeting: m}
		database.DB.Model(&models.AGMAttendance{}).Where("agm_year = ?", fmt.Sprintf("%d", m.ID)).Count(&mr.AttendeeCount)
		mr.AgendaCount = int64(len(m.Agendas))
		database.DB.Model(&models.AGMVote{}).Where("meeting_id = ?", m.ID).Count(&mr.VoteCount)
		result = append(result, mr)
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func UpdateMeeting(c *gin.Context) {
	id := c.Param("id")
	var meeting models.AGMMeeting
	if err := database.DB.First(&meeting, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Meeting not found"})
		return
	}
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Status      string `json:"status"`
		MeetingDate string `json:"meeting_date"`
		MeetingType string `json:"meeting_type"`
		AccessCode  string `json:"access_code"`
	}
	c.ShouldBindJSON(&req)
	if req.Title != "" {
		meeting.Title = req.Title
	}
	if req.Description != "" {
		meeting.Description = req.Description
	}
	if req.MeetingType != "" {
		meeting.MeetingType = req.MeetingType
	}
	if req.AccessCode != "" {
		meeting.AccessCode = req.AccessCode
	}
	if req.MeetingDate != "" {
		for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05Z", "2006-01-02", "2006-01-02T15:04:05.000Z"} {
			if t, err := time.Parse(layout, req.MeetingDate); err == nil {
				meeting.MeetingDate = &t
				break
			}
		}
	}
	if req.Status != "" {
		meeting.Status = req.Status
		// If closing meeting, close all agendas
		if req.Status == "closed" {
			database.DB.Model(&models.AGMAgenda{}).Where("meeting_id = ? AND status != ?", meeting.ID, "closed").
				Update("status", "closed")
		}
	}
	database.DB.Save(&meeting)
	c.JSON(http.StatusOK, gin.H{"data": meeting})
}

func DeleteMeeting(c *gin.Context) {
	id := c.Param("id")
	database.DB.Where("meeting_id = ?", id).Delete(&models.AGMAgenda{})
	database.DB.Delete(&models.AGMMeeting{}, id)
	c.JSON(http.StatusOK, gin.H{"message": "Meeting deleted"})
}

// ============================================================
// Admin - Agendas
// ============================================================

func CreateAgenda(c *gin.Context) {
	meetingID, _ := strconv.ParseUint(c.Param("meetingId"), 10, 64)
	var req struct {
		Title       string `json:"title" binding:"required"`
		Description string `json:"description"`
		SortOrder   int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Agenda title is required"})
		return
	}
	agenda := models.AGMAgenda{
		MeetingID:   uint(meetingID),
		Title:       req.Title,
		Description: req.Description,
		SortOrder:   req.SortOrder,
		Status:      "inactive",
	}
	database.DB.Create(&agenda)
	c.JSON(http.StatusCreated, gin.H{"data": agenda})
}

func GetAgendas(c *gin.Context) {
	meetingID := c.Param("meetingId")
	var agendas []models.AGMAgenda
	database.DB.Where("meeting_id = ?", meetingID).Order("sort_order ASC, id ASC").Find(&agendas)

	// Enrich with vote stats
	type AgendaResponse struct {
		models.AGMAgenda
		TotalVotes   int64   `json:"total_votes"`
		AgreeCount   int64   `json:"agree_count"`
		DisagreeCount int64  `json:"disagree_count"`
		NeutralCount int64   `json:"neutral_count"`
		AgreeShares  float64 `json:"agree_shares"`
		DisagreeShares float64 `json:"disagree_shares"`
		NeutralShares float64 `json:"neutral_shares"`
		TotalShares  float64 `json:"total_shares_voted"`
	}
	var result []AgendaResponse
	for _, a := range agendas {
		ar := AgendaResponse{AGMAgenda: a}
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ?", a.ID).Count(&ar.TotalVotes)
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", a.ID, "agree").Count(&ar.AgreeCount)
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", a.ID, "disagree").Count(&ar.DisagreeCount)
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", a.ID, "neutral").Count(&ar.NeutralCount)
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", a.ID, "agree").
			Select("COALESCE(SUM(share_value), 0)").Scan(&ar.AgreeShares)
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", a.ID, "disagree").
			Select("COALESCE(SUM(share_value), 0)").Scan(&ar.DisagreeShares)
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", a.ID, "neutral").
			Select("COALESCE(SUM(share_value), 0)").Scan(&ar.NeutralShares)
		ar.TotalShares = ar.AgreeShares + ar.DisagreeShares + ar.NeutralShares
		result = append(result, ar)
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func UpdateAgenda(c *gin.Context) {
	agendaID := c.Param("agendaId")
	var agenda models.AGMAgenda
	if err := database.DB.First(&agenda, agendaID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agenda not found"})
		return
	}
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		SortOrder   *int   `json:"sort_order"`
	}
	c.ShouldBindJSON(&req)
	if req.Title != "" {
		agenda.Title = req.Title
	}
	if req.Description != "" {
		agenda.Description = req.Description
	}
	if req.SortOrder != nil {
		agenda.SortOrder = *req.SortOrder
	}
	database.DB.Save(&agenda)
	c.JSON(http.StatusOK, gin.H{"data": agenda})
}

func DeleteAgenda(c *gin.Context) {
	agendaID := c.Param("agendaId")
	database.DB.Where("agenda_id = ?", agendaID).Delete(&models.AGMVote{})
	database.DB.Delete(&models.AGMAgenda{}, agendaID)
	c.JSON(http.StatusOK, gin.H{"message": "Agenda deleted"})
}

// ActivateAgenda - only one can be active at a time per meeting
func ActivateAgenda(c *gin.Context) {
	agendaID := c.Param("agendaId")
	var agenda models.AGMAgenda
	if err := database.DB.First(&agenda, agendaID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agenda not found"})
		return
	}

	// Deactivate all other agendas in this meeting
	database.DB.Model(&models.AGMAgenda{}).
		Where("meeting_id = ? AND id != ? AND status = ?", agenda.MeetingID, agenda.ID, "active").
		Update("status", "inactive")

	agenda.Status = "active"
	database.DB.Save(&agenda)
	c.JSON(http.StatusOK, gin.H{"data": agenda, "message": "Agenda activated"})
}

func CloseAgenda(c *gin.Context) {
	agendaID := c.Param("agendaId")
	database.DB.Model(&models.AGMAgenda{}).Where("id = ?", agendaID).Update("status", "closed")
	c.JSON(http.StatusOK, gin.H{"message": "Agenda closed"})
}

// ============================================================
// Admin - Analytics
// ============================================================

func GetAGMAnalytics(c *gin.Context) {
	meetingID := c.Param("meetingId")

	// Total shareholders
	var totalShareholders int64
	database.DB.Model(&models.Shareholder{}).Where("status = ?", "active").Count(&totalShareholders)

	// Total shares in system
	var totalSystemShares int64
	database.DB.Model(&models.Investment{}).
		Where("status = ? AND approval_status = ?", "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalSystemShares)

	// Attendees for this meeting
	var attendeeCount int64
	database.DB.Model(&models.AGMAttendance{}).Where("agm_year = ?", meetingID).Count(&attendeeCount)

	// Total shares attending
	var attendingShares float64
	database.DB.Model(&models.AGMAttendance{}).Where("agm_year = ?", meetingID).
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&attendingShares)

	// Total votes cast
	var totalVotes int64
	database.DB.Model(&models.AGMVote{}).Where("meeting_id = ?", meetingID).Count(&totalVotes)

	attendancePct := float64(0)
	if totalShareholders > 0 {
		attendancePct = float64(attendeeCount) * 100 / float64(totalShareholders)
	}
	sharesPresentPct := float64(0)
	if totalSystemShares > 0 {
		sharesPresentPct = attendingShares * 100 / float64(totalSystemShares)
	}

	c.JSON(http.StatusOK, gin.H{
		"total_shareholders":   totalShareholders,
		"total_system_shares":  totalSystemShares,
		"attendee_count":       attendeeCount,
		"attending_shares":     attendingShares,
		"attendance_pct":       attendancePct,
		"shares_present_pct":   sharesPresentPct,
		"total_votes":          totalVotes,
	})
}

// GetAGMAttendanceList returns attendees for a meeting
func GetAGMAttendanceList(c *gin.Context) {
	meetingID := c.Param("meetingId")
	var attendees []models.AGMAttendance
	database.DB.Preload("Shareholder").Where("agm_year = ?", meetingID).
		Order("created_at DESC").Find(&attendees)
	c.JSON(http.StatusOK, gin.H{"data": attendees})
}

// ============================================================
// Proxy Management
// ============================================================

func generateProxyCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	src := time.Now().UnixNano()
	for i := range b {
		src = src*1103515245 + 12345
		b[i] = chars[((src>>16)&0x7fff)%int64(len(chars))]
	}
	return string(b)
}

// AssignProxy - shareholder authorizes any person (not just shareholders) as proxy
func AssignProxy(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	meetingID, _ := strconv.ParseUint(c.Param("meetingId"), 10, 64)
	myID := shID.(uint)

	var req struct {
		ProxyName  string `json:"proxy_name" binding:"required"`
		ProxyPhone string `json:"proxy_phone"`
		ProxyIDNo  string `json:"proxy_id_no"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Proxy name is required"})
		return
	}

	var meeting models.AGMMeeting
	if err := database.DB.First(&meeting, meetingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Meeting not found"})
		return
	}
	if meeting.Status == "closed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Meeting is already closed"})
		return
	}

	// Cannot assign proxy if already attended
	var existingAttendance models.AGMAttendance
	if database.DB.Where("shareholder_id = ? AND agm_year = ?", myID, fmt.Sprintf("%d", meetingID)).
		First(&existingAttendance).Error == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You already registered attendance. Cannot assign proxy after attending."})
		return
	}

	// Upsert
	var existing models.AGMProxy
	if database.DB.Where("meeting_id = ? AND shareholder_id = ?", meetingID, myID).First(&existing).Error == nil {
		existing.ProxyName = req.ProxyName
		existing.ProxyPhone = req.ProxyPhone
		existing.ProxyIDNo = req.ProxyIDNo
		existing.ProxyCode = generateProxyCode()
		existing.Status = "pending"
		database.DB.Save(&existing)

		// Create new PendingApproval for admin review
		database.DB.Create(&models.PendingApproval{
			EntityType:  "proxy",
			EntityID:    existing.ID,
			Action:      "create",
			RequestedBy: myID,
			Status:      "pending",
			RequestedAt: time.Now(),
		})

		c.JSON(http.StatusOK, gin.H{"data": existing, "message": "Proxy request submitted for admin approval."})
		return
	}

	proxy := models.AGMProxy{
		MeetingID:     uint(meetingID),
		ShareholderID: myID,
		ProxyName:     req.ProxyName,
		ProxyPhone:    req.ProxyPhone,
		ProxyIDNo:     req.ProxyIDNo,
		ProxyCode:     generateProxyCode(),
		Status:        "pending",
	}
	if err := database.DB.Create(&proxy).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy: " + err.Error()})
		return
	}

	// Create PendingApproval for admin
	database.DB.Create(&models.PendingApproval{
		EntityType:  "proxy",
		EntityID:    proxy.ID,
		Action:      "create",
		RequestedBy: myID,
		Status:      "pending",
		RequestedAt: time.Now(),
	})

	c.JSON(http.StatusCreated, gin.H{"data": proxy, "message": "Proxy request submitted for admin approval."})
}

func RevokeProxy(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	meetingID := c.Param("meetingId")

	result := database.DB.Model(&models.AGMProxy{}).
		Where("meeting_id = ? AND shareholder_id = ? AND status IN ?", meetingID, shID,
			[]string{"active", "rejected", "pending"}).
		Update("status", "revoked")
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "No proxy found to revoke"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Proxy revoked"})
}

func GetMyProxy(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	meetingID := c.Param("meetingId")

	var proxy models.AGMProxy
	if err := database.DB.Where("meeting_id = ? AND shareholder_id = ? AND status IN ?", meetingID, shID,
		[]string{"pending", "approved", "active", "rejected"}).
		First(&proxy).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"has_proxy": false})
		return
	}

	response := gin.H{"has_proxy": true, "data": proxy}

	// If rejected, include the rejection reason from the approval record
	if proxy.Status == "rejected" {
		var approval models.PendingApproval
		if database.DB.Where("entity_type = ? AND entity_id = ? AND status = ?", "proxy", proxy.ID, "rejected").
			Order("processed_at DESC").First(&approval).Error == nil {
			response["rejection_remark"] = approval.Remark
		}
	}

	c.JSON(http.StatusOK, response)
}

// GetProxyDetail - admin endpoint to get detailed proxy info for approval review
func GetProxyDetail(c *gin.Context) {
	id := c.Param("id")
	var proxy models.AGMProxy
	if err := database.DB.Preload("Shareholder").First(&proxy, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proxy not found"})
		return
	}
	// Get shareholder's shares
	var shares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", proxy.ShareholderID, "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&shares)

	// Get meeting info
	var meeting models.AGMMeeting
	database.DB.First(&meeting, proxy.MeetingID)

	// Get investments summary
	var investments []models.Investment
	database.DB.Where("shareholder_id = ? AND status = ? AND approval_status = ?", proxy.ShareholderID, "active", "approved").
		Order("payment_date DESC").Find(&investments)

	// Total paid
	var totalPaid float64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", proxy.ShareholderID, "active", "approved").
		Select("COALESCE(SUM(amount), 0)").Scan(&totalPaid)

	// Transfers involving this shareholder
	var transferCount int64
	database.DB.Model(&models.Transfer{}).
		Where("(transferor_id = ? OR transferee_id = ?) AND status = ?", proxy.ShareholderID, proxy.ShareholderID, "approved").
		Count(&transferCount)

	c.JSON(http.StatusOK, gin.H{
		"data":           proxy,
		"shares":         shares,
		"meeting":        meeting,
		"investments":    investments,
		"total_paid":     totalPaid,
		"transfer_count": transferCount,
	})
}

func GetProxyList(c *gin.Context) {
	meetingID := c.Param("meetingId")
	var proxies []models.AGMProxy
	database.DB.Preload("Shareholder").Where("meeting_id = ?", meetingID).
		Order("created_at DESC").Find(&proxies)
	c.JSON(http.StatusOK, gin.H{"data": proxies})
}

// VerifyProxyAttendance - admin registers proxy attendance using the proxy code
func VerifyProxyAttendance(c *gin.Context) {
	var req struct {
		ProxyCode string `json:"proxy_code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Proxy code is required"})
		return
	}

	var proxy models.AGMProxy
	if err := database.DB.Preload("Shareholder").Where("proxy_code = ? AND status = ?", req.ProxyCode, "active").
		First(&proxy).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Invalid or expired proxy code"})
		return
	}

	meetingIDStr := fmt.Sprintf("%d", proxy.MeetingID)

	// Check not already attended
	var existing models.AGMAttendance
	if database.DB.Where("shareholder_id = ? AND agm_year = ?", proxy.ShareholderID, meetingIDStr).
		First(&existing).Error == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Attendance already registered for this shareholder"})
		return
	}

	// Get shareholder's shares
	var totalShares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", proxy.ShareholderID, "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

	var totalSystemShares int64
	database.DB.Model(&models.Investment{}).
		Where("status = ? AND approval_status = ?", "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalSystemShares)

	votingPower := float64(0)
	if totalSystemShares > 0 {
		votingPower = float64(totalShares) * 100 / float64(totalSystemShares)
	}

	var meeting models.AGMMeeting
	database.DB.First(&meeting, proxy.MeetingID)

	attendance := models.AGMAttendance{
		ShareholderID:  proxy.ShareholderID,
		AGMDate:        meeting.MeetingDate,
		AGMYear:        meetingIDStr,
		AttendanceType: "proxy",
		ProxyName:      proxy.ProxyName,
		NumberOfShares: totalShares,
		VotingPower:    votingPower,
		IsPresent:      true,
	}
	database.DB.Create(&attendance)

	// Mark proxy as used
	proxy.Status = "used"
	database.DB.Save(&proxy)

	sh := proxy.Shareholder
	c.JSON(http.StatusCreated, gin.H{
		"data":    attendance,
		"message": fmt.Sprintf("Proxy attendance registered for %s %s (%d shares)", sh.FirstName, sh.LastName, totalShares),
	})
}

// ============================================================
// Shareholder Mobile Endpoints
// ============================================================

func CheckAttendance(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	meetingID := c.Param("meetingId")

	var attendance models.AGMAttendance
	if err := database.DB.Where("shareholder_id = ? AND agm_year = ?", shID, meetingID).
		First(&attendance).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"attended": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"attended": true, "data": attendance})
}

func GetActiveMeetings(c *gin.Context) {
	var meetings []models.AGMMeeting
	database.DB.Where("status IN ?", []string{"upcoming", "active"}).
		Order("meeting_date DESC").Find(&meetings)
	c.JSON(http.StatusOK, gin.H{"data": meetings})
}

func AttendMeeting(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	meetingID, _ := strconv.ParseUint(c.Param("meetingId"), 10, 64)
	myID := shID.(uint)
	meetingIDStr := fmt.Sprintf("%d", meetingID)

	var req struct {
		AttendanceType string `json:"attendance_type"` // in_person, virtual
		AccessCode     string `json:"access_code"`
	}
	c.ShouldBindJSON(&req)

	var meeting models.AGMMeeting
	if err := database.DB.First(&meeting, meetingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Meeting not found"})
		return
	}
	if meeting.Status != "active" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Meeting is not currently active"})
		return
	}

	attendanceType := req.AttendanceType
	if attendanceType == "" {
		attendanceType = "virtual"
	}

	// Block proxy from mobile - proxy attendance is admin-only via proxy code
	if attendanceType == "proxy" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Proxy attendance is registered by the admin at the meeting hall using the proxy code."})
		return
	}

	if meeting.MeetingType == "in_person" && attendanceType == "virtual" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This is an in-person only meeting. Virtual attendance is not allowed."})
		return
	}

	if attendanceType == "in_person" && meeting.AccessCode != "" && req.AccessCode != meeting.AccessCode {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid meeting access code."})
		return
	}

	// Check not already attending
	var existing models.AGMAttendance
	if database.DB.Where("shareholder_id = ? AND agm_year = ?", myID, meetingIDStr).
		First(&existing).Error == nil {
		c.JSON(http.StatusOK, gin.H{"message": "Already registered", "data": existing})
		return
	}

	// Check shareholder hasn't assigned a proxy (they delegated their vote)
	var myProxy models.AGMProxy
	if database.DB.Where("meeting_id = ? AND shareholder_id = ? AND status = ?", meetingID, myID, "active").
		First(&myProxy).Error == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("You assigned %s as your proxy. Revoke the proxy first to attend yourself.", myProxy.ProxyName),
		})
		return
	}

	var totalShares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", myID, "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

	var totalSystemShares int64
	database.DB.Model(&models.Investment{}).
		Where("status = ? AND approval_status = ?", "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalSystemShares)

	votingPower := float64(0)
	if totalSystemShares > 0 {
		votingPower = float64(totalShares) * 100 / float64(totalSystemShares)
	}

	attendance := models.AGMAttendance{
		ShareholderID:  myID,
		AGMDate:        meeting.MeetingDate,
		AGMYear:        meetingIDStr,
		AttendanceType: attendanceType,
		NumberOfShares: totalShares,
		VotingPower:    votingPower,
		IsPresent:      true,
	}
	database.DB.Create(&attendance)

	c.JSON(http.StatusCreated, gin.H{"data": attendance, "message": "Attendance registered"})
}

func GetActiveAgenda(c *gin.Context) {
	meetingID := c.Param("meetingId")
	var agenda models.AGMAgenda
	if err := database.DB.Where("meeting_id = ? AND status = ?", meetingID, "active").First(&agenda).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"data": nil, "message": "No active agenda"})
		return
	}

	// Get vote stats
	var agreeCount, disagreeCount, neutralCount int64
	var agreeShares, disagreeShares, neutralShares float64
	database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", agenda.ID, "agree").Count(&agreeCount)
	database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", agenda.ID, "disagree").Count(&disagreeCount)
	database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", agenda.ID, "neutral").Count(&neutralCount)
	database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", agenda.ID, "agree").
		Select("COALESCE(SUM(share_value), 0)").Scan(&agreeShares)
	database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", agenda.ID, "disagree").
		Select("COALESCE(SUM(share_value), 0)").Scan(&disagreeShares)
	database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", agenda.ID, "neutral").
		Select("COALESCE(SUM(share_value), 0)").Scan(&neutralShares)

	// Check if current shareholder voted
	shID, _ := c.Get("shareholder_id")
	var existingVote models.AGMVote
	hasVoted := database.DB.Where("agenda_id = ? AND voter_id = ?", agenda.ID, shID).First(&existingVote).Error == nil

	totalShares := agreeShares + disagreeShares + neutralShares

	c.JSON(http.StatusOK, gin.H{
		"data": agenda,
		"stats": gin.H{
			"agree_count":    agreeCount,
			"disagree_count": disagreeCount,
			"neutral_count":  neutralCount,
			"agree_shares":   agreeShares,
			"disagree_shares": disagreeShares,
			"neutral_shares": neutralShares,
			"total_shares":   totalShares,
		},
		"has_voted":  hasVoted,
		"voted_for":  existingVote.Vote,
	})
}

func VoteOnAgenda(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	agendaID, _ := strconv.ParseUint(c.Param("agendaId"), 10, 64)

	var req struct {
		Vote string `json:"vote" binding:"required"` // agree, disagree, neutral
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Vote is required (agree/disagree/neutral)"})
		return
	}
	if req.Vote != "agree" && req.Vote != "disagree" && req.Vote != "neutral" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Vote must be agree, disagree, or neutral"})
		return
	}

	// Check agenda is active
	var agenda models.AGMAgenda
	if err := database.DB.First(&agenda, agendaID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agenda not found"})
		return
	}
	if agenda.Status != "active" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This agenda is not currently open for voting"})
		return
	}

	// Check attendance
	var attendance models.AGMAttendance
	if err := database.DB.Where("shareholder_id = ? AND agm_year = ?", shID, fmt.Sprintf("%d", agenda.MeetingID)).
		First(&attendance).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "You must register attendance before voting"})
		return
	}

	// Check not already voted
	var existing models.AGMVote
	if database.DB.Where("agenda_id = ? AND voter_id = ?", agendaID, shID).First(&existing).Error == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You have already voted on this agenda"})
		return
	}

	// Calculate share weight
	var totalShares int64
	database.DB.Model(&models.Investment{}).
		Where("shareholder_id = ? AND status = ? AND approval_status = ?", shID, "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalShares)

	var totalSystemShares int64
	database.DB.Model(&models.Investment{}).
		Where("status = ? AND approval_status = ?", "active", "approved").
		Select("COALESCE(SUM(number_of_shares), 0)").Scan(&totalSystemShares)

	shareValue := float64(0)
	if totalSystemShares > 0 {
		shareValue = float64(totalShares) * 100 / float64(totalSystemShares)
	}

	vote := models.AGMVote{
		MeetingID:  agenda.MeetingID,
		AgendaID:   uint(agendaID),
		VoterID:    shID.(uint),
		Vote:       req.Vote,
		ShareValue: shareValue,
		NumShares:  totalShares,
	}
	database.DB.Create(&vote)

	c.JSON(http.StatusCreated, gin.H{"data": vote, "message": "Vote recorded"})
}

func GetMeetingAgendas(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	meetingID := c.Param("meetingId")

	var agendas []models.AGMAgenda
	database.DB.Where("meeting_id = ?", meetingID).Order("sort_order ASC, id ASC").Find(&agendas)

	type AgendaWithVote struct {
		models.AGMAgenda
		HasVoted  bool   `json:"has_voted"`
		MyVote    string `json:"my_vote"`
		Stats     gin.H  `json:"stats"`
	}

	var result []AgendaWithVote
	for _, a := range agendas {
		aw := AgendaWithVote{AGMAgenda: a}

		var existingVote models.AGMVote
		if database.DB.Where("agenda_id = ? AND voter_id = ?", a.ID, shID).First(&existingVote).Error == nil {
			aw.HasVoted = true
			aw.MyVote = existingVote.Vote
		}

		var agreeS, disagreeS, neutralS float64
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", a.ID, "agree").
			Select("COALESCE(SUM(share_value), 0)").Scan(&agreeS)
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", a.ID, "disagree").
			Select("COALESCE(SUM(share_value), 0)").Scan(&disagreeS)
		database.DB.Model(&models.AGMVote{}).Where("agenda_id = ? AND vote = ?", a.ID, "neutral").
			Select("COALESCE(SUM(share_value), 0)").Scan(&neutralS)
		total := agreeS + disagreeS + neutralS

		aw.Stats = gin.H{
			"agree_shares": agreeS, "disagree_shares": disagreeS, "neutral_shares": neutralS,
			"total_shares": total,
		}
		result = append(result, aw)
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}
