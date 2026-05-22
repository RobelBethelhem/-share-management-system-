package main

import (
	"log"
	"os"
	"strings"

	"share-management-system/internal/config"
	"share-management-system/internal/database"
	"share-management-system/internal/handlers"
	"share-management-system/internal/middleware"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()
	middleware.SetJWTSecret(cfg.JWTSecret)
	database.Initialize(cfg)

	r := gin.Default()
	r.MaxMultipartMemory = 100 << 20 // 100 MB max upload

	uploadDir := getEnv("UPLOAD_DIR", "./uploads")
	miniAppsDir := getEnv("MINI_APPS_DIR", "../mini_apps/ecommerce")
	r.Static("/uploads", uploadDir)
	r.Static("/mini-apps/ecommerce", miniAppsDir)

	// CORS — localhost origins are always allowed; production origins via ALLOWED_ORIGINS env (comma-separated)
	origins := []string{"http://localhost:5173", "http://localhost:5174", "http://localhost:3000", "http://localhost:8081", "http://localhost:19006"}
	if extra := os.Getenv("ALLOWED_ORIGINS"); extra != "" {
		for _, o := range strings.Split(extra, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				origins = append(origins, trimmed)
			}
		}
	}
	r.Use(cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowCredentials: true,
	}))

	// Public routes
	r.POST("/api/login", handlers.Login)
	r.POST("/api/shareholder/login", handlers.ShareholderLogin)
	r.POST("/api/shareholder/pin-login", handlers.PinLogin)
	r.POST("/api/shareholder/proxy-login", handlers.ProxyLogin)

	// Shareholder mobile API (separate auth)
	shApi := r.Group("/api/shareholder")
	shApi.Use(middleware.ShareholderAuthMiddleware())
	{
		shApi.POST("/setup-pin", handlers.SetupPin)
		shApi.GET("/profile", handlers.ShareholderProfile)
		shApi.GET("/feeds", handlers.GetFeeds)
		shApi.POST("/feeds/:id/like", handlers.ToggleLike)
		shApi.GET("/feeds/:id/comments", handlers.GetComments)
		shApi.POST("/feeds/:id/comments", handlers.CreateComment)
		shApi.DELETE("/feeds/comments/:commentId", handlers.DeleteComment)

		// Chat
		shApi.GET("/chat/settings", handlers.GetChatSettings)
		shApi.PUT("/chat/settings", handlers.UpdateChatSettings)
		shApi.POST("/chat/keys", handlers.UploadPublicKey)
		shApi.GET("/chat/keys/:shareholderId", handlers.GetPublicKey)
		shApi.GET("/chat/contacts", handlers.GetChatContacts)
		shApi.GET("/chat/conversations", handlers.GetConversations)
		shApi.POST("/chat/conversations", handlers.CreateConversation)
		shApi.GET("/chat/conversations/:convId/messages", handlers.GetMessages)
		shApi.POST("/chat/conversations/:convId/messages", handlers.SendMessage)
		shApi.PUT("/chat/conversations/:convId/read", handlers.MarkMessagesRead)
		shApi.DELETE("/chat/messages/:msgId", handlers.DeleteMessage)
		shApi.POST("/chat/messages/:msgId/react", handlers.ReactToMessage)
		shApi.DELETE("/chat/messages/:msgId/react", handlers.RemoveReaction)
		shApi.GET("/chat/unread", handlers.GetUnreadTotal)

		// Document Center
		// Marketplace
		// AGM (Mobile)
		shApi.GET("/agm/meetings", handlers.GetActiveMeetings)
		shApi.POST("/agm/meetings/:meetingId/attend", handlers.AttendMeeting)
		shApi.GET("/agm/meetings/:meetingId/check-attendance", handlers.CheckAttendance)
		shApi.POST("/agm/meetings/:meetingId/assign-proxy", handlers.AssignProxy)
		shApi.DELETE("/agm/meetings/:meetingId/revoke-proxy", handlers.RevokeProxy)
		shApi.GET("/agm/meetings/:meetingId/my-proxy", handlers.GetMyProxy)
		shApi.GET("/agm/meetings/:meetingId/agendas", handlers.GetMeetingAgendas)
		shApi.GET("/agm/meetings/:meetingId/active-agenda", handlers.GetActiveAgenda)
		shApi.POST("/agm/agendas/:agendaId/vote", handlers.VoteOnAgenda)

		shApi.GET("/marketplace/listings", handlers.GetListings)
		shApi.GET("/marketplace/listings/:id", handlers.GetListingDetail)
		shApi.POST("/marketplace/listings", handlers.CreateListing)
		shApi.POST("/marketplace/listings/:id/cancel", handlers.CancelListing)
		shApi.POST("/marketplace/listings/:id/buy", handlers.BuyShares)
		shApi.GET("/marketplace/my-trades", handlers.GetMyTrades)
		shApi.GET("/marketplace/available-shares", handlers.GetAvailableShares)

		shApi.GET("/documents", handlers.GetShareholderDocuments)
		shApi.GET("/documents/categories", handlers.GetShareholderDocCategories)
		shApi.GET("/documents/:id/download", handlers.DownloadDocument)

		// Community
		shApi.POST("/community/groups", handlers.CreateGroup)
		shApi.GET("/community/groups", handlers.GetGroups)
		shApi.GET("/community/groups/:id", handlers.GetGroupDetail)
		shApi.POST("/community/groups/:id/join", handlers.JoinGroup)
		shApi.POST("/community/groups/:id/leave", handlers.LeaveGroup)
		shApi.GET("/community/groups/:id/members", handlers.GetGroupMembers)
		shApi.GET("/community/groups/:id/posts", handlers.GetPosts)
		shApi.POST("/community/groups/:id/posts", handlers.CreatePost)
		shApi.POST("/community/posts/:postId/like", handlers.TogglePostLike)
		shApi.DELETE("/community/posts/:postId", handlers.DeletePost)
		shApi.GET("/community/posts/:postId/comments", handlers.GetPostComments)
		shApi.POST("/community/posts/:postId/comments", handlers.CreatePostComment)
		shApi.DELETE("/community/comments/:commentId", handlers.DeletePostComment)
		shApi.POST("/community/groups/:id/polls", handlers.CreatePoll)
		shApi.GET("/community/groups/:id/polls", handlers.GetPolls)
		shApi.POST("/community/polls/:pollId/vote", handlers.VoteOnPoll)
		shApi.GET("/community/polls/:pollId", handlers.GetPollDetail)
		shApi.GET("/dashboard", handlers.ShareholderDashboard)
		shApi.GET("/investments", handlers.ShareholderInvestments)
		shApi.GET("/dividends", handlers.ShareholderDividends)
		shApi.GET("/transfers", handlers.ShareholderTransfers)
		shApi.GET("/certificates", handlers.ShareholderCertificates)
		shApi.GET("/blocks", handlers.ShareholderBlocks)
		shApi.GET("/mini-apps", handlers.GetActiveMiniApps)
		shApi.GET("/lookup", handlers.LookupShareholder)
	}

	// Protected routes
	api := r.Group("/api")
	api.Use(middleware.AuthMiddleware())
	{
		// Auth
		api.GET("/profile", handlers.GetProfile)
		api.POST("/register", handlers.Register) // Admin only in practice

		// Dashboard
		api.GET("/dashboard", handlers.GetDashboard)

		// Shareholders
		api.GET("/shareholders", handlers.GetShareholders)
		api.GET("/shareholders/search", handlers.SearchShareholders)
		api.POST("/shareholders/search-advanced", handlers.SearchShareholdersAdvanced)
		api.POST("/investments/search-advanced", handlers.SearchInvestmentsAdvanced)
		api.POST("/subscriptions/search-advanced", handlers.SearchSubscriptionsAdvanced)
		api.POST("/transfers/search-advanced", handlers.SearchTransfersAdvanced)
		api.POST("/share-blocks/search-advanced", handlers.SearchShareBlocksAdvanced)
		api.POST("/certificates/search-advanced", handlers.SearchCertificatesAdvanced)
		api.POST("/allocations/search-advanced", handlers.SearchAllocationsAdvanced)
		api.GET("/shareholders/:id", handlers.GetShareholder)
		api.POST("/shareholders", handlers.CreateShareholder)
		api.PUT("/shareholders/:id", handlers.UpdateShareholder)
		api.DELETE("/shareholders/:id", handlers.DeleteShareholder)
		api.POST("/shareholders/:id/poa", handlers.CreatePOA)
		api.PUT("/shareholders/:id/poa/:poaId", handlers.UpdatePOA)
		api.GET("/shareholders/:id/investment-summary", handlers.GetShareholderInvestmentSummary)

		// Subscriptions
		api.GET("/subscriptions", handlers.GetSubscriptions)
		api.GET("/subscriptions/:id", handlers.GetSubscription)
		api.POST("/subscriptions", handlers.CreateSubscription)
		api.PUT("/subscriptions/:id", handlers.UpdateSubscription)
		api.DELETE("/subscriptions/:id", handlers.DeleteSubscription)
		api.POST("/subscriptions/:id/reverse", handlers.ReverseSubscription)
		api.POST("/subscriptions/:id/extend", handlers.ExtendSubscription)
		api.POST("/subscriptions/pre-subscribe", handlers.PreSubscribe)

		// Allocations
		api.GET("/allocations", handlers.GetAllocations)
		api.POST("/allocations", handlers.CreateAllocation)
		api.PUT("/allocations/:id", handlers.UpdateAllocation)
		api.POST("/allocations/from-subscriptions", handlers.AllocateFromSubscriptions)

		// Capital Increase — proportional multi-round share allocation.
		// Read endpoints are open to any logged-in user; mutations require admin.
		api.GET("/capital-increases", handlers.GetCapitalIncreases)
		api.GET("/capital-increases/:id", handlers.GetCapitalIncrease)
		api.GET("/capital-increases/:id/summary", handlers.GetCISummary)
		api.GET("/capital-increases/:id/subscriptions", handlers.GetCISubscriptions)
		api.GET("/capital-increases/:id/rounds/:round/preview", middleware.AdminOnly(), handlers.PreviewCIRound)
		api.GET("/capital-increases/:id/additional-requests", handlers.GetCIAdditionalRequests)
		api.GET("/ci-additional-requests", handlers.ListAllCIAdditionalRequests)
		api.POST("/capital-increases", middleware.AdminOnly(), handlers.CreateCapitalIncrease)
		api.PUT("/capital-increases/:id", middleware.AdminOnly(), handlers.UpdateCapitalIncrease)
		api.POST("/capital-increases/:id/start", middleware.AdminOnly(), handlers.StartCapitalIncrease)
		api.POST("/capital-increases/:id/run-round", middleware.AdminOnly(), handlers.RunCIRound)
		api.POST("/capital-increases/:id/subscriptions/:subId/confirm", middleware.AdminOnly(), handlers.ConfirmCISubscription)
		api.POST("/capital-increases/:id/subscriptions/:subId/reverse", middleware.AdminOnly(), handlers.ReverseCISubscription)
		api.POST("/capital-increases/:id/close-round", middleware.AdminOnly(), handlers.CloseCIRound)
		api.POST("/capital-increases/:id/open-additional", middleware.AdminOnly(), handlers.OpenCIAdditional)
		api.POST("/capital-increases/:id/close", middleware.AdminOnly(), handlers.CloseCapitalIncrease)
		api.DELETE("/capital-increases/:id", middleware.AdminOnly(), handlers.DeleteCapitalIncrease)
		api.POST("/capital-increases/:id/additional-requests", handlers.CreateCIAdditionalRequest)
		api.POST("/capital-increases/:id/additional-requests/:reqId/approve", middleware.AdminOnly(), handlers.ApproveCIAdditionalRequest)
		api.POST("/capital-increases/:id/additional-requests/:reqId/reject", middleware.AdminOnly(), handlers.RejectCIAdditionalRequest)

		// Investments
		api.GET("/investments", handlers.GetInvestments)
		api.GET("/investments/:id", handlers.GetInvestment)
		api.POST("/investments", handlers.CreateInvestment)
		api.PUT("/investments/:id", handlers.UpdateInvestment)

		// Transfers
		api.GET("/transfers", handlers.GetTransfers)
		api.GET("/transfers/:id", handlers.GetTransfer)
		api.POST("/transfers", handlers.CreateTransfer)
		api.POST("/transfers/:id/approve", handlers.ApproveTransfer)
		api.POST("/transfers/:id/reject", handlers.RejectTransfer)
		api.POST("/transfers/calculate-fees", handlers.CalculateTransferFees)

		// Dividend Settings
		api.GET("/dividend-settings", handlers.GetDividendSettings)
		api.POST("/dividend-settings", handlers.CreateDividendSetting)
		api.PUT("/dividend-settings/:id", handlers.UpdateDividendSetting)
		api.POST("/dividend-settings/:id/process", handlers.ProcessDividend)
		api.DELETE("/dividend-settings/:id", middleware.AdminOnly(), handlers.DeleteDividendSetting)
		api.GET("/dividend-settings/dps-summary", handlers.GetDPSSummary)

		// Dividends
		api.GET("/dividends", handlers.GetDividends)
		api.GET("/dividends/:id", handlers.GetDividend)
		api.POST("/dividends/:id/collect", handlers.CollectDividend)
		api.POST("/dividends/:id/block", handlers.BlockDividend)
		api.POST("/dividends/:id/release", handlers.ReleaseDividend)
		api.POST("/dividends/:id/transfer", handlers.TransferDividend)
		api.POST("/dividends/:id/tax-return", handlers.ReturnDividendTax)
		api.POST("/dividends/:id/payment-return", handlers.ReturnDividendPayment)
		api.POST("/dividends/:id/reinvest", handlers.ReinvestDividend)
		api.GET("/dividends/:id/breakdown", handlers.GetDividendBreakdown)
		api.GET("/dividends/:id/history", handlers.GetDividendHistory)

		// Dividend Tax Schedules
		api.GET("/dividend-tax-schedules", handlers.GetDividendTaxSchedules)
		api.PUT("/dividend-tax-schedules", handlers.UpdateDividendTaxSchedule)
		api.POST("/dividend-tax-schedules", handlers.CreateDividendTaxBracket)
		api.PUT("/dividend-tax-schedules/:id", handlers.UpdateDividendTaxBracket)
		api.DELETE("/dividend-tax-schedules/:id", handlers.DeleteDividendTaxBracket)

		// System Settings
		api.GET("/system-settings", handlers.GetSystemSettings)
		api.GET("/system-settings/:key", handlers.GetSystemSetting)
		api.POST("/system-settings", handlers.CreateSystemSetting)
		api.PUT("/system-settings/:key", handlers.UpdateSystemSetting)
		api.DELETE("/system-settings/:key", handlers.DeleteSystemSetting)
		api.POST("/system-settings/test-formula", handlers.TestFormula)

		// Bank Capital
		api.GET("/bank-capital", handlers.GetBankCapital)
		api.PUT("/bank-capital", handlers.UpdateBankCapital)

		// Share Splits
		api.GET("/share-splits", handlers.GetShareSplits)
		api.POST("/share-splits", handlers.CreateShareSplit)
		api.PUT("/share-splits/:id", handlers.UpdateShareSplit)
		api.POST("/share-splits/:id/process", handlers.ProcessShareSplit)

		// Share Blocks
		api.GET("/share-blocks", handlers.GetShareBlocks)
		api.GET("/share-blocks/:id", handlers.GetShareBlock)
		api.POST("/share-blocks", handlers.CreateShareBlock)
		api.POST("/share-blocks/:id/release", handlers.ReleaseShareBlock)

		// Certificates
		api.GET("/certificates", handlers.GetCertificates)
		api.GET("/certificates/next-no", handlers.GenerateCertNo)
		api.GET("/certificates/:id", handlers.GetCertificate)
		api.POST("/certificates", handlers.CreateCertificate)
		api.PUT("/certificates/:id", handlers.UpdateCertificate)
		api.POST("/certificates/:id/print", handlers.PrintCertificate)

		// AGM
		api.GET("/agm-attendance", handlers.GetAGMAttendance)
		api.POST("/agm-attendance", handlers.CreateAGMAttendance)
		api.POST("/agm-attendance/bulk", handlers.BulkCreateAGMAttendance)

		// Approvals
		api.GET("/approvals", handlers.GetPendingApprovals)
		api.POST("/approvals/:id/approve", handlers.ApproveItem)
		api.POST("/approvals/:id/reject", handlers.RejectItem)
		api.POST("/approve-entity/:entity_type/:entity_id", handlers.ApproveByEntity)
		api.POST("/reject-entity/:entity_type/:entity_id", handlers.RejectByEntity)

		// AGM (Admin)
		api.POST("/agm/meetings", handlers.CreateMeeting)
		api.GET("/agm/meetings", handlers.GetMeetings)
		api.PUT("/agm/meetings/:id", handlers.UpdateMeeting)
		api.DELETE("/agm/meetings/:id", handlers.DeleteMeeting)
		api.POST("/agm/meetings/:meetingId/agendas", handlers.CreateAgenda)
		api.GET("/agm/meetings/:meetingId/agendas", handlers.GetAgendas)
		api.PUT("/agm/agendas/:agendaId", handlers.UpdateAgenda)
		api.DELETE("/agm/agendas/:agendaId", handlers.DeleteAgenda)
		api.POST("/agm/agendas/:agendaId/activate", handlers.ActivateAgenda)
		api.POST("/agm/agendas/:agendaId/close", handlers.CloseAgenda)
		api.GET("/agm/meetings/:meetingId/analytics", handlers.GetAGMAnalytics)
		api.GET("/agm/meetings/:meetingId/attendance", handlers.GetAGMAttendanceList)
		api.GET("/agm/meetings/:meetingId/proxies", handlers.GetProxyList)
		api.GET("/agm/proxy/:id", handlers.GetProxyDetail)
		api.POST("/agm/proxy/verify", handlers.VerifyProxyAttendance)

		// Marketplace (admin)
		api.GET("/marketplace/trades", handlers.GetTradeRequests)
		api.GET("/marketplace/trades/:id", handlers.GetTradeRequestDetail)

		// Documents
		api.GET("/documents", handlers.GetDocumentsAdmin)
		api.POST("/documents", handlers.UploadDocument)
		api.PUT("/documents/:id", handlers.UpdateDocument)
		api.DELETE("/documents/:id", handlers.DeleteDocument)
		api.GET("/documents/categories", handlers.GetDocumentCategories)

		// Announcements
		api.GET("/announcements", handlers.GetAnnouncements)
		api.POST("/announcements", handlers.CreateAnnouncement)
		api.PUT("/announcements/:id", handlers.UpdateAnnouncement)
		api.DELETE("/announcements/:id", handlers.DeleteAnnouncement)

		// Utilities
		api.GET("/utils/gregorian-to-ethiopian", handlers.ConvertToEthiopian)

		// Mini Apps
		api.GET("/mini-apps", handlers.GetMiniApps)
		api.GET("/mini-apps/:id", handlers.GetMiniApp)
		api.POST("/mini-apps", handlers.CreateMiniApp)
		api.PUT("/mini-apps/:id", handlers.UpdateMiniApp)
		api.DELETE("/mini-apps/:id", handlers.DeleteMiniApp)
		api.PUT("/mini-apps/:id/status", handlers.UpdateMiniAppStatus)
		api.PUT("/mini-apps/reorder", handlers.ReorderMiniApps)
		api.GET("/mini-app-categories", handlers.GetMiniAppCategories)
		api.POST("/mini-app-categories", handlers.CreateMiniAppCategory)
		api.PUT("/mini-app-categories/:id", handlers.UpdateMiniAppCategory)
		api.DELETE("/mini-app-categories/:id", handlers.DeleteMiniAppCategory)

		// Reports
		reports := api.Group("/reports")
		{
			reports.GET("/master-data", handlers.MasterDataReport)
			reports.GET("/shareholder-statement/:id", handlers.ShareholderStatement)
			reports.GET("/subscriptions", handlers.SubscriptionReport)
			reports.GET("/investments", handlers.InvestmentReport)
			reports.GET("/registration-book", handlers.RegistrationBookReport)
			reports.GET("/transfers", handlers.TransferReport)
			reports.GET("/dividends", handlers.DividendReport)
			reports.GET("/dividend-tax", handlers.DividendTaxReport)
			reports.GET("/blocks", handlers.BlockReport)
			reports.GET("/certificates", handlers.CertificateReport)
			reports.GET("/foreign-shareholders", handlers.ForeignShareholdersReport)
			reports.GET("/staff-shareholders", handlers.StaffShareholdersReport)
			reports.GET("/top-shareholders", handlers.TopShareholdersReport)
			reports.GET("/service-charges", handlers.ServiceChargeReport)
			reports.GET("/dormant-shareholders", handlers.DormantShareholdersReport)
			reports.GET("/daily-schedules", handlers.DailySchedulesReport)
			reports.GET("/influential-shareholders", handlers.InfluentialShareholdersReport)
			reports.GET("/allocations", handlers.AllocationReport)
		}
	}

	// Honor $PORT when set (Railway/Render/Fly inject it); else fall back to SERVER_PORT from config
	port := os.Getenv("PORT")
	if port == "" {
		port = cfg.ServerPort
	}
	log.Printf("Server starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
