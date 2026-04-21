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

// ============================================================
// Groups
// ============================================================

func CreateGroup(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	var req struct {
		Name        string `json:"name" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group name is required"})
		return
	}

	group := models.CommunityGroup{
		Name:        req.Name,
		Description: req.Description,
		CreatedBy:   shID.(uint),
		MemberCount: 1,
		IsPublic:    true,
	}
	database.DB.Create(&group)

	// Creator auto-joins as admin
	database.DB.Create(&models.GroupMember{
		GroupID:  group.ID,
		MemberID: shID.(uint),
		Role:     "admin",
	})

	database.DB.Preload("Creator").First(&group, group.ID)
	c.JSON(http.StatusCreated, gin.H{"data": group})
}

func GetGroups(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	filter := c.DefaultQuery("filter", "discover") // "my" or "discover"
	q := c.Query("q")

	var groups []models.CommunityGroup
	query := database.DB.Preload("Creator")

	if filter == "my" {
		var groupIDs []uint
		database.DB.Model(&models.GroupMember{}).Where("member_id = ?", shID).Pluck("group_id", &groupIDs)
		if len(groupIDs) == 0 {
			c.JSON(http.StatusOK, gin.H{"data": []interface{}{}})
			return
		}
		query = query.Where("id IN ?", groupIDs)
	}

	if q != "" {
		query = query.Where("name LIKE ? OR description LIKE ?", "%"+q+"%", "%"+q+"%")
	}

	query.Order("member_count DESC, created_at DESC").Limit(50).Find(&groups)

	// Check membership for each group
	var myGroupIDs []uint
	database.DB.Model(&models.GroupMember{}).Where("member_id = ?", shID).Pluck("group_id", &myGroupIDs)
	memberMap := make(map[uint]bool)
	for _, id := range myGroupIDs {
		memberMap[id] = true
	}

	type GroupResponse struct {
		models.CommunityGroup
		IsMember bool `json:"is_member"`
	}

	var result []GroupResponse
	for _, g := range groups {
		result = append(result, GroupResponse{
			CommunityGroup: g,
			IsMember:       memberMap[g.ID],
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

func GetGroupDetail(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	groupID := c.Param("id")

	var group models.CommunityGroup
	if err := database.DB.Preload("Creator").First(&group, groupID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	var member models.GroupMember
	isMember := database.DB.Where("group_id = ? AND member_id = ?", groupID, shID).First(&member).Error == nil

	c.JSON(http.StatusOK, gin.H{
		"data":      group,
		"is_member": isMember,
		"role":      member.Role,
	})
}

func JoinGroup(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	groupID, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var existing models.GroupMember
	if database.DB.Where("group_id = ? AND member_id = ?", groupID, shID).First(&existing).Error == nil {
		c.JSON(http.StatusOK, gin.H{"message": "Already a member"})
		return
	}

	database.DB.Create(&models.GroupMember{
		GroupID:  uint(groupID),
		MemberID: shID.(uint),
		Role:     "member",
	})
	database.DB.Model(&models.CommunityGroup{}).Where("id = ?", groupID).
		UpdateColumn("member_count", database.DB.Raw("member_count + 1"))

	c.JSON(http.StatusOK, gin.H{"message": "Joined group"})
}

func LeaveGroup(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	groupID := c.Param("id")

	result := database.DB.Where("group_id = ? AND member_id = ?", groupID, shID).Delete(&models.GroupMember{})
	if result.RowsAffected > 0 {
		database.DB.Model(&models.CommunityGroup{}).Where("id = ?", groupID).
			UpdateColumn("member_count", database.DB.Raw("GREATEST(member_count - 1, 0)"))
	}
	c.JSON(http.StatusOK, gin.H{"message": "Left group"})
}

func GetGroupMembers(c *gin.Context) {
	groupID := c.Param("id")
	var members []models.GroupMember
	database.DB.Preload("Member").Where("group_id = ?", groupID).
		Order("role ASC, created_at ASC").Find(&members)
	c.JSON(http.StatusOK, gin.H{"data": members})
}

// ============================================================
// Posts
// ============================================================

func CreatePost(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	groupID, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	// Verify membership
	var member models.GroupMember
	if err := database.DB.Where("group_id = ? AND member_id = ?", groupID, shID).First(&member).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Join the group first"})
		return
	}

	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Content is required"})
		return
	}

	post := models.GroupPost{
		GroupID:  uint(groupID),
		AuthorID: shID.(uint),
		Content:  req.Content,
	}
	database.DB.Create(&post)
	database.DB.Preload("Author").First(&post, post.ID)

	c.JSON(http.StatusCreated, gin.H{"data": post})
}

func GetPosts(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	groupID := c.Param("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * 20

	var posts []models.GroupPost
	database.DB.Preload("Author").
		Where("group_id = ?", groupID).
		Order("created_at DESC").
		Offset(offset).Limit(20).
		Find(&posts)

	var total int64
	database.DB.Model(&models.GroupPost{}).Where("group_id = ?", groupID).Count(&total)

	// Check which posts user liked
	var likedPostIDs []uint
	postIDs := make([]uint, len(posts))
	for i, p := range posts {
		postIDs[i] = p.ID
	}
	if len(postIDs) > 0 {
		database.DB.Model(&models.PostLike{}).Where("post_id IN ? AND user_id = ?", postIDs, shID).
			Pluck("post_id", &likedPostIDs)
	}
	likedMap := make(map[uint]bool)
	for _, id := range likedPostIDs {
		likedMap[id] = true
	}

	type PostResponse struct {
		models.GroupPost
		IsLiked bool `json:"is_liked"`
	}

	var result []PostResponse
	for _, p := range posts {
		result = append(result, PostResponse{GroupPost: p, IsLiked: likedMap[p.ID]})
	}

	c.JSON(http.StatusOK, gin.H{"data": result, "total": total})
}

func TogglePostLike(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	postID, _ := strconv.ParseUint(c.Param("postId"), 10, 64)

	var existing models.PostLike
	if database.DB.Where("post_id = ? AND user_id = ?", postID, shID).First(&existing).Error == nil {
		database.DB.Delete(&existing)
		database.DB.Model(&models.GroupPost{}).Where("id = ?", postID).
			UpdateColumn("like_count", database.DB.Raw("GREATEST(like_count - 1, 0)"))
		c.JSON(http.StatusOK, gin.H{"liked": false})
	} else {
		database.DB.Create(&models.PostLike{PostID: uint(postID), UserID: shID.(uint)})
		database.DB.Model(&models.GroupPost{}).Where("id = ?", postID).
			UpdateColumn("like_count", database.DB.Raw("like_count + 1"))
		c.JSON(http.StatusOK, gin.H{"liked": true})
	}
}

func DeletePost(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	postID := c.Param("postId")

	var post models.GroupPost
	if err := database.DB.First(&post, postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}
	if post.AuthorID != shID.(uint) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Can only delete own posts"})
		return
	}
	database.DB.Delete(&post)
	c.JSON(http.StatusOK, gin.H{"message": "Post deleted"})
}

// ============================================================
// Comments
// ============================================================

func GetPostComments(c *gin.Context) {
	postID := c.Param("postId")
	var comments []models.PostComment
	database.DB.Preload("Author").Preload("Replies.Author").
		Where("post_id = ? AND parent_id IS NULL", postID).
		Order("created_at ASC").
		Find(&comments)
	c.JSON(http.StatusOK, gin.H{"data": comments})
}

func CreatePostComment(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	postID, _ := strconv.ParseUint(c.Param("postId"), 10, 64)

	var req struct {
		Content  string `json:"content" binding:"required"`
		ParentID *uint  `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Content is required"})
		return
	}

	comment := models.PostComment{
		PostID:   uint(postID),
		AuthorID: shID.(uint),
		ParentID: req.ParentID,
		Content:  req.Content,
	}
	database.DB.Create(&comment)
	database.DB.Model(&models.GroupPost{}).Where("id = ?", postID).
		UpdateColumn("comment_count", database.DB.Raw("comment_count + 1"))

	database.DB.Preload("Author").First(&comment, comment.ID)
	c.JSON(http.StatusCreated, gin.H{"data": comment})
}

func DeletePostComment(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	commentID := c.Param("commentId")

	var comment models.PostComment
	if err := database.DB.First(&comment, commentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comment not found"})
		return
	}
	if comment.AuthorID != shID.(uint) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Can only delete own comments"})
		return
	}

	var replyCount int64
	database.DB.Model(&models.PostComment{}).Where("parent_id = ?", comment.ID).Count(&replyCount)
	database.DB.Where("parent_id = ?", comment.ID).Delete(&models.PostComment{})
	database.DB.Delete(&comment)
	database.DB.Model(&models.GroupPost{}).Where("id = ?", comment.PostID).
		UpdateColumn("comment_count", database.DB.Raw(fmt.Sprintf("GREATEST(comment_count - %d, 0)", 1+replyCount)))

	c.JSON(http.StatusOK, gin.H{"message": "Comment deleted"})
}

// ============================================================
// Polls
// ============================================================

func CreatePoll(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	groupID, _ := strconv.ParseUint(c.Param("id"), 10, 64)

	var member models.GroupMember
	if err := database.DB.Where("group_id = ? AND member_id = ?", groupID, shID).First(&member).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Join the group first"})
		return
	}

	var req struct {
		Question  string   `json:"question" binding:"required"`
		Options   []string `json:"options" binding:"required"`
		ExpiresIn *int     `json:"expires_in_hours"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Question and options are required"})
		return
	}
	if len(req.Options) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "At least 2 options required"})
		return
	}

	poll := models.Poll{
		GroupID:   uint(groupID),
		CreatorID: shID.(uint),
		Question:  req.Question,
		IsActive:  true,
	}
	if req.ExpiresIn != nil && *req.ExpiresIn > 0 {
		exp := time.Now().Add(time.Duration(*req.ExpiresIn) * time.Hour)
		poll.ExpiresAt = &exp
	}
	database.DB.Create(&poll)

	for _, optText := range req.Options {
		database.DB.Create(&models.PollOption{PollID: poll.ID, Text: optText})
	}

	database.DB.Preload("Creator").Preload("Options").First(&poll, poll.ID)
	c.JSON(http.StatusCreated, gin.H{"data": poll})
}

func GetPolls(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	groupID := c.Param("id")

	var polls []models.Poll
	database.DB.Preload("Creator").Preload("Options").
		Where("group_id = ?", groupID).
		Order("created_at DESC").Find(&polls)

	// Check if user voted on each poll
	pollIDs := make([]uint, len(polls))
	for i, p := range polls {
		pollIDs[i] = p.ID
	}
	votedMap := make(map[uint]bool)
	votedOptionMap := make(map[uint]uint) // pollID -> optionID
	if len(pollIDs) > 0 {
		var votes []models.PollVote
		database.DB.Where("poll_id IN ? AND voter_id = ?", pollIDs, shID).Find(&votes)
		for _, v := range votes {
			votedMap[v.PollID] = true
			votedOptionMap[v.PollID] = v.OptionID
		}
	}

	// Check expiry
	now := time.Now()

	type PollResponse struct {
		models.Poll
		HasVoted    bool  `json:"has_voted"`
		VotedOption *uint `json:"voted_option"` // pointer so null when not voted
		IsExpired   bool  `json:"is_expired"`
	}

	var result []PollResponse
	for _, p := range polls {
		expired := p.ExpiresAt != nil && p.ExpiresAt.Before(now)
		pr := PollResponse{
			Poll:      p,
			HasVoted:  votedMap[p.ID],
			IsExpired: expired,
		}
		if optID, ok := votedOptionMap[p.ID]; ok {
			pr.VotedOption = &optID
		}
		result = append(result, pr)
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

func VoteOnPoll(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	pollID, _ := strconv.ParseUint(c.Param("pollId"), 10, 64)

	var req struct {
		OptionID uint `json:"option_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Option ID is required"})
		return
	}

	var poll models.Poll
	if err := database.DB.First(&poll, pollID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Poll not found"})
		return
	}

	if poll.ExpiresAt != nil && poll.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Poll has expired"})
		return
	}

	// Check if already voted
	var existing models.PollVote
	if database.DB.Where("poll_id = ? AND voter_id = ?", pollID, shID).First(&existing).Error == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already voted"})
		return
	}

	// Verify option belongs to poll
	var option models.PollOption
	if err := database.DB.Where("id = ? AND poll_id = ?", req.OptionID, pollID).First(&option).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid option"})
		return
	}

	database.DB.Create(&models.PollVote{
		PollID:   uint(pollID),
		VoterID:  shID.(uint),
		OptionID: req.OptionID,
	})
	database.DB.Model(&option).UpdateColumn("vote_count", database.DB.Raw("vote_count + 1"))
	database.DB.Model(&poll).UpdateColumn("total_votes", database.DB.Raw("total_votes + 1"))

	// Return updated poll
	database.DB.Preload("Options").First(&poll, pollID)
	c.JSON(http.StatusOK, gin.H{"data": poll})
}

func GetPollDetail(c *gin.Context) {
	shID, _ := c.Get("shareholder_id")
	pollID := c.Param("pollId")

	var poll models.Poll
	if err := database.DB.Preload("Creator").Preload("Options").First(&poll, pollID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Poll not found"})
		return
	}

	var vote models.PollVote
	hasVoted := database.DB.Where("poll_id = ? AND voter_id = ?", pollID, shID).First(&vote).Error == nil

	expired := poll.ExpiresAt != nil && poll.ExpiresAt.Before(time.Now())

	resp := gin.H{
		"data":       poll,
		"has_voted":  hasVoted,
		"is_expired": expired,
	}
	if hasVoted {
		resp["voted_option"] = vote.OptionID
	} else {
		resp["voted_option"] = nil
	}
	c.JSON(http.StatusOK, resp)
}
