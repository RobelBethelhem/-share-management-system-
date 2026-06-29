package models

import (
	"time"

	"gorm.io/gorm"
)

// User represents system users for authentication
type User struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Username  string         `gorm:"uniqueIndex;size:100;not null" json:"username"`
	Password  string         `gorm:"size:255;not null" json:"-"`
	FullName  string         `gorm:"size:200" json:"full_name"`
	Email     string         `gorm:"size:200" json:"email"`
	Role      string         `gorm:"size:50;default:'user'" json:"role"` // admin, user, approver
	IsActive  bool           `gorm:"default:true" json:"is_active"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// Shareholder represents shareholder personal information
type Shareholder struct {
	ID              uint           `gorm:"primaryKey" json:"id"`
	AccountNo       string         `gorm:"uniqueIndex;size:50;not null" json:"account_no"`
	FirstName       string         `gorm:"size:100;not null" json:"first_name"`
	FirstNameAm     string         `gorm:"size:100" json:"first_name_am"`
	MiddleName      string         `gorm:"size:100" json:"middle_name"`
	MiddleNameAm    string         `gorm:"size:100" json:"middle_name_am"`
	LastName        string         `gorm:"size:100;not null" json:"last_name"`
	LastNameAm      string         `gorm:"size:100" json:"last_name_am"`
	TIN             string         `gorm:"size:50" json:"tin"`
	PassportNo      string         `gorm:"size:50" json:"passport_no"`
	NationalIDNo    string         `gorm:"size:50" json:"national_id_no"`
	Nationality     string         `gorm:"size:100" json:"nationality"`
	NationalityAm   string         `gorm:"size:100" json:"nationality_am"`
	ShareholderType string         `gorm:"size:50;not null" json:"shareholder_type"` // Individual, Joint, Corporate, Association, Economic
	Gender          string         `gorm:"size:10" json:"gender"`
	DateOfBirth     *time.Time     `json:"date_of_birth"`
	Phone           string         `gorm:"size:20" json:"phone"`
	Phone2          string         `gorm:"size:20" json:"phone2"`
	Phone3          string         `gorm:"size:20" json:"phone3"`
	Email           string         `gorm:"size:200" json:"email"`
	Email2          string         `gorm:"size:200" json:"email2"`
	Email3          string         `gorm:"size:200" json:"email3"`
	IsStaff         bool           `gorm:"default:false" json:"is_staff"`
	IsForeign       bool           `gorm:"default:false" json:"is_foreign"`
	CitizenshipStatus string       `gorm:"size:50" json:"citizenship_status"`
	Status          string         `gorm:"size:20;default:'active'" json:"status"` // active, dormant
	Photo           string         `gorm:"size:500" json:"photo"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`

	// Relations
	Address       *ShareholderAddress `gorm:"foreignKey:ShareholderID" json:"address,omitempty"`
	POA           *POA                `gorm:"foreignKey:ShareholderID" json:"poa,omitempty"`
	Subscriptions []Subscription      `gorm:"foreignKey:ShareholderID" json:"subscriptions,omitempty"`
	Investments   []Investment        `gorm:"foreignKey:ShareholderID" json:"investments,omitempty"`
	Dividends     []Dividend          `gorm:"foreignKey:ShareholderID" json:"dividends,omitempty"`
	ShareBlocks   []ShareBlock        `gorm:"foreignKey:ShareholderID" json:"share_blocks,omitempty"`
	Certificates  []Certificate       `gorm:"foreignKey:ShareholderID" json:"certificates,omitempty"`
}

func (s *Shareholder) GetFullName() string {
	name := s.FirstName
	if s.MiddleName != "" {
		name += " " + s.MiddleName
	}
	name += " " + s.LastName
	return name
}

// ShareholderAddress stores address info
type ShareholderAddress struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	ShareholderID  uint           `gorm:"uniqueIndex;not null" json:"shareholder_id"`
	Region         string         `gorm:"size:100" json:"region"`
	RegionAm       string         `gorm:"size:100" json:"region_am"`
	City           string         `gorm:"size:100" json:"city"`
	CityAm         string         `gorm:"size:100" json:"city_am"`
	SubCity        string         `gorm:"size:100" json:"sub_city"`
	SubCityAm      string         `gorm:"size:100" json:"sub_city_am"`
	Woreda         string         `gorm:"size:100" json:"woreda"`
	WoredaAm       string         `gorm:"size:100" json:"woreda_am"`
	Kebele         string         `gorm:"size:100" json:"kebele"`
	KebeleAm       string         `gorm:"size:100" json:"kebele_am"`
	HouseNo        string         `gorm:"size:50" json:"house_no"`
	POBox          string         `gorm:"size:50" json:"po_box"`
	Phone          string         `gorm:"size:20" json:"phone"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

// POA - Power of Attorney information
type POA struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	ShareholderID uint      `gorm:"index;not null" json:"shareholder_id"`
	POAName       string    `gorm:"size:200;not null" json:"poa_name"`
	POAPhone      string    `gorm:"size:20" json:"poa_phone"`
	POAIDNo       string    `gorm:"size:50" json:"poa_id_no"`
	Mandate       string    `gorm:"type:text" json:"mandate"`
	StartDate     *time.Time `json:"start_date"`
	EndDate       *time.Time `json:"end_date"`
	IsActive      bool      `gorm:"default:true" json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// Subscription represents share subscriptions
type Subscription struct {
	ID              uint           `gorm:"primaryKey" json:"id"`
	ShareholderID   uint           `gorm:"index;not null" json:"shareholder_id"`
	SubscriptionNo  string         `gorm:"size:50" json:"subscription_no"`
	Type            string         `gorm:"size:50;not null" json:"type"` // pre-subscription, confirmation, additional
	ShareAmount     float64        `gorm:"type:decimal(18,2);not null" json:"share_amount"`
	NumberOfShares  int64          `gorm:"not null" json:"number_of_shares"`
	ParValue        float64        `gorm:"type:decimal(18,2)" json:"par_value"`
	SubscriptionDate *time.Time    `json:"subscription_date"`
	AmharicDate     string         `gorm:"size:50" json:"amharic_date"` // Ethiopian date, auto-filled from subscription_date
	ExpiryDate      *time.Time     `json:"expiry_date"`
	Status          string         `gorm:"size:30;default:'active'" json:"status"` // active, expired, reversed, extended
	IsProportional  bool           `gorm:"default:false" json:"is_proportional"`
	Remark          string         `gorm:"type:text" json:"remark"`
	ApprovalStatus  string         `gorm:"size:30;default:'pending'" json:"approval_status"`
	RejectionReason string         `gorm:"type:text" json:"rejection_reason"`
	// Capital Increase fields (nullable — legacy rows have CapitalIncreaseID = nil)
	CapitalIncreaseID      *uint      `gorm:"index" json:"capital_increase_id"`
	Round                  int        `gorm:"default:0" json:"round"`
	ShareholderConfirmedAt *time.Time `json:"shareholder_confirmed_at"`
	BaseShares             int64      `gorm:"default:0" json:"base_shares"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`

	Shareholder Shareholder `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
}

// Allocation represents share allocations
type Allocation struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	ShareholderID   uint       `gorm:"index;not null" json:"shareholder_id"`
	SubscriptionID  *uint      `gorm:"index" json:"subscription_id"`
	AllocationNo    string     `gorm:"size:50" json:"allocation_no"`
	Round           int        `gorm:"default:1" json:"round"` // 1st, 2nd, 3rd round
	AllocatedShares int64      `gorm:"not null" json:"allocated_shares"`
	AllocatedAmount float64    `gorm:"type:decimal(18,2)" json:"allocated_amount"`
	AllocationDate  *time.Time `json:"allocation_date"`
	Status          string     `gorm:"size:30;default:'pending'" json:"status"`
	ApprovalStatus  string     `gorm:"size:30;default:'pending'" json:"approval_status"`
	// Capital Increase FK — nullable so existing allocations stay untouched
	CapitalIncreaseID *uint     `gorm:"index" json:"capital_increase_id"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`

	Shareholder  Shareholder  `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
	Subscription Subscription `gorm:"foreignKey:SubscriptionID" json:"subscription,omitempty"`
}

// Investment represents share payment/investment records
type Investment struct {
	ID               uint       `gorm:"primaryKey" json:"id"`
	ShareholderID    uint       `gorm:"index;not null" json:"shareholder_id"`
	PaymentDate      *time.Time `json:"payment_date"`
	AmharicDate      string     `gorm:"size:50" json:"amharic_date"`
	PaymentMethod    string     `gorm:"size:50" json:"payment_method"` // cash, bank_transfer, check, cpo, dividend
	FromAccount      string     `gorm:"size:100" json:"from_account"`
	Amount           float64    `gorm:"type:decimal(18,2);not null" json:"amount"`
	NumberOfShares   int64      `json:"number_of_shares"`
	ParValue         float64    `gorm:"type:decimal(18,2)" json:"par_value"`
	PremiumValue     float64    `gorm:"type:decimal(18,2);default:0" json:"premium_value"`
	ReferenceNo      string     `gorm:"size:100" json:"reference_no"`
	IsStanding       bool       `gorm:"default:false" json:"is_standing"` // standing instruction
	StandingFrequency string    `gorm:"size:30" json:"standing_frequency"` // monthly, quarterly
	Remark           string     `gorm:"type:text" json:"remark"`
	Status           string     `gorm:"size:30;default:'active'" json:"status"`
	ApprovalStatus   string     `gorm:"size:30;default:'pending'" json:"approval_status"`
	RejectionReason  string     `gorm:"type:text" json:"rejection_reason"`
	AllocationID     *uint      `gorm:"index" json:"allocation_id"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`

	Shareholder Shareholder `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
	Allocation  *Allocation `gorm:"foreignKey:AllocationID" json:"allocation,omitempty"`
}

// Transfer represents share transfers between shareholders
type Transfer struct {
	ID                 uint       `gorm:"primaryKey" json:"id"`
	BatchNo            string     `gorm:"size:50;uniqueIndex" json:"batch_no"`
	TransferorID       uint       `gorm:"index;not null" json:"transferor_id"`
	TransfereeID       uint       `gorm:"index;not null" json:"transferee_id"`
	TransferType       string     `gorm:"size:50" json:"transfer_type"` // sale, gift, inheritance, legal_order
	TransferDate       *time.Time `json:"transfer_date"`
	NumberOfShares     int64      `gorm:"not null" json:"number_of_shares"`
	ParValue           float64    `gorm:"type:decimal(18,2)" json:"par_value"`
	TransferAmount     float64    `gorm:"type:decimal(18,2)" json:"transfer_amount"`
	CapitalGainTax     float64    `gorm:"type:decimal(18,2);default:0" json:"capital_gain_tax"`
	ServiceFee         float64    `gorm:"type:decimal(18,2);default:0" json:"service_fee"`
	StampDuty          float64    `gorm:"type:decimal(18,2);default:0" json:"stamp_duty"`
	VAT                float64    `gorm:"type:decimal(18,2);default:0" json:"vat"`
	TotalFees          float64    `gorm:"type:decimal(18,2);default:0" json:"total_fees"`
	DividendIssuedDate *time.Time `json:"dividend_issued_date"`
	AgreedDividendDate *time.Time `json:"agreed_dividend_date"`
	IsFullTransfer     bool       `gorm:"default:false" json:"is_full_transfer"`
	IncludeSubscribed  bool       `gorm:"default:false" json:"include_subscribed"`
	Reason             string     `gorm:"type:text" json:"reason"`
	Status             string     `gorm:"size:30;default:'pending'" json:"status"`
	ApprovalStatus     string     `gorm:"size:30;default:'pending'" json:"approval_status"`
	RejectionReason    string     `gorm:"type:text" json:"rejection_reason"`
	FromAllocationID   *uint      `gorm:"index" json:"from_allocation_id"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`

	ToAllocationID *uint          `gorm:"index" json:"to_allocation_id"`
	Lines          []TransferLine `gorm:"foreignKey:TransferID" json:"lines,omitempty"`

	Transferor     Shareholder `gorm:"foreignKey:TransferorID" json:"transferor,omitempty"`
	Transferee     Shareholder `gorm:"foreignKey:TransfereeID" json:"transferee,omitempty"`
	FromAllocation *Allocation `gorm:"foreignKey:FromAllocationID" json:"from_allocation,omitempty"`
	ToAllocation   *Allocation `gorm:"foreignKey:ToAllocationID" json:"to_allocation,omitempty"`
}

// TransferLine represents one source allocation in a multi-allocation transfer
type TransferLine struct {
	ID                     uint      `gorm:"primaryKey" json:"id"`
	TransferID             uint      `gorm:"index;not null" json:"transfer_id"`
	FromAllocationID       uint      `gorm:"index;not null" json:"from_allocation_id"`
	// FromInvestmentID is the specific paid payment (cohort) this line sells
	// from, when the source was chosen by payment. Null for whole-allocation
	// ("All paid") / unpaid / legacy lines. Recorded for the audit/approval
	// view so an approver sees exactly which purchase (and its date) moved.
	FromInvestmentID       *uint     `gorm:"index" json:"from_investment_id"`
	PaidSharesToTransfer   int64     `json:"paid_shares_to_transfer"`
	UnpaidSharesToTransfer int64     `json:"unpaid_shares_to_transfer"`
	CreatedAt              time.Time `json:"created_at"`

	FromAllocation Allocation  `gorm:"foreignKey:FromAllocationID" json:"from_allocation,omitempty"`
	FromInvestment *Investment `gorm:"foreignKey:FromInvestmentID" json:"from_investment,omitempty"`
}

// DividendSetting represents fiscal year dividend configuration
type DividendSetting struct {
	ID                uint       `gorm:"primaryKey" json:"id"`
	FiscalYear        string     `gorm:"size:20;uniqueIndex;not null" json:"fiscal_year"`
	// ReferenceStartDate is the inclusive START of the dividend period.
	// Used together with ReferenceDate (end) for overlap detection so two
	// fiscal years can't cover the same days. Optional for legacy rows;
	// when nil, the period is treated as (ReferenceDate − DaysInYear + 1)
	// for backward compatibility.
	ReferenceStartDate *time.Time `json:"reference_start_date"`
	ReferenceDate     *time.Time `json:"reference_date"`
	DaysInYear        int        `gorm:"default:365" json:"days_in_year"`
	DeclaredAmount    float64    `gorm:"type:decimal(18,2)" json:"declared_amount"`
	DividendPerShare  float64    `gorm:"type:decimal(18,4)" json:"dividend_per_share"`
	TaxGracePeriod    *time.Time `json:"tax_grace_period"`
	IsProcessed       bool       `gorm:"default:false" json:"is_processed"`
	ProcessedAt       *time.Time `json:"processed_at"`
	Status            string     `gorm:"size:30;default:'draft'" json:"status"` // draft, declared, processed
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// DividendTaxSchedule stores tax brackets
type DividendTaxSchedule struct {
	ID          uint    `gorm:"primaryKey" json:"id"`
	MinAmount   float64 `gorm:"type:decimal(18,2)" json:"min_amount"`
	MaxAmount   float64 `gorm:"type:decimal(18,2)" json:"max_amount"`
	TaxRate     float64 `gorm:"type:decimal(5,2)" json:"tax_rate"`
	Deduction   float64 `gorm:"type:decimal(18,2)" json:"deduction"`
	Description string  `gorm:"size:200" json:"description"`
}

// Dividend represents individual shareholder dividend records
type Dividend struct {
	ID                uint       `gorm:"primaryKey" json:"id"`
	ShareholderID     uint       `gorm:"index;not null" json:"shareholder_id"`
	DividendSettingID uint       `gorm:"index;not null" json:"dividend_setting_id"`
	FiscalYear        string     `gorm:"size:20" json:"fiscal_year"`
	WeightedAvgShares float64    `gorm:"type:decimal(18,4)" json:"weighted_avg_shares"`
	GrossDividend     float64    `gorm:"type:decimal(18,2)" json:"gross_dividend"`
	TaxAmount         float64    `gorm:"type:decimal(18,2)" json:"tax_amount"`
	NetDividend       float64    `gorm:"type:decimal(18,2)" json:"net_dividend"`
	CollectedAmount   float64    `gorm:"type:decimal(18,2);default:0" json:"collected_amount"`
	UncollectedAmount float64    `gorm:"type:decimal(18,2)" json:"uncollected_amount"`
	ReinvestedAmount  float64    `gorm:"type:decimal(18,2);default:0" json:"reinvested_amount"`
	PaymentMethod     string     `gorm:"size:50" json:"payment_method"`
	CollectionDate    *time.Time `json:"collection_date"`
	IsBlocked         bool       `gorm:"default:false" json:"is_blocked"`
	BlockReason       string     `gorm:"type:text" json:"block_reason"`
	IsTransferred     bool       `gorm:"default:false" json:"is_transferred"`
	// IsTransferPending is set when an admin requests a transfer; the row
	// goes through the standard Authorization workflow and only flips
	// IsTransferred=true on approve. TransferTo/TransferReason hold the
	// requested destination while pending.
	IsTransferPending bool       `gorm:"default:false" json:"is_transfer_pending"`
	TransferTo        string     `gorm:"size:200" json:"transfer_to"`
	TransferReason    string     `gorm:"size:50" json:"transfer_reason"` // inheritance, legal_order
	IsTaxReturned     bool       `gorm:"default:false" json:"is_tax_returned"`
	IsPaymentReturned bool       `gorm:"default:false" json:"is_payment_returned"`
	Remark            string     `gorm:"type:text" json:"remark"`
	Status            string     `gorm:"size:30;default:'pending'" json:"status"`
	ApprovalStatus    string     `gorm:"size:30;default:'pending'" json:"approval_status"`
	RejectionReason   string     `gorm:"type:text" json:"rejection_reason"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`

	Shareholder     Shareholder     `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
	DividendSetting DividendSetting `gorm:"foreignKey:DividendSettingID" json:"dividend_setting,omitempty"`
}

// DividendAction is the append-only audit log of everything that happens to a
// dividend after it's been processed (collect, block, release, transfer,
// reinvest, tax/payment return, etc.). Each action links to the parent
// Dividend and optionally to whatever entity it produced (Investment for
// reinvest, Transfer for transfer, etc.).
type DividendAction struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	DividendID    uint      `gorm:"index;not null" json:"dividend_id"`
	ActionType    string    `gorm:"size:30;not null" json:"action_type"` // collect, block, release, transfer, reinvest, tax_return, payment_return
	Amount        float64   `gorm:"type:decimal(18,2)" json:"amount"`
	TaxImpact     float64   `gorm:"type:decimal(18,2);default:0" json:"tax_impact"` // tax recalculated for this action (negative = tax reduction)
	Description   string    `gorm:"size:500" json:"description"`
	InvestmentID  *uint     `gorm:"index" json:"investment_id"`
	TransferID    *uint     `gorm:"index" json:"transfer_id"`
	PaymentMethod string    `gorm:"size:50" json:"payment_method"`
	Remark        string    `gorm:"type:text" json:"remark"`
	ActedByUserID uint      `gorm:"index" json:"acted_by_user_id"`
	ActedAt       time.Time `json:"acted_at"`
	CreatedAt     time.Time `json:"created_at"`
}

// ShareBlock represents share blocking/freezing
type ShareBlock struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	ShareholderID   uint       `gorm:"index;not null" json:"shareholder_id"`
	BlockType       string     `gorm:"size:50;not null" json:"block_type"` // court_order, collateral, pledge, other
	BlockDate       *time.Time `json:"block_date"`
	BlockAmountBirr float64    `gorm:"type:decimal(18,2)" json:"block_amount_birr"`
	BlockShares     int64      `json:"block_shares"`
	GuaranteeAmount float64    `gorm:"type:decimal(18,2)" json:"guarantee_amount"`
	ServiceFee      float64    `gorm:"type:decimal(18,2)" json:"service_fee"`
	Reason          string     `gorm:"type:text" json:"reason"`
	ReleaseDate     *time.Time `json:"release_date"`
	IsReleased      bool       `gorm:"default:false" json:"is_released"`
	// IsReleasePending is set when a release has been requested and is awaiting
	// authorization. The block stays effective (shares stay reserved) until the
	// release is approved; rejecting the release clears this flag.
	IsReleasePending bool      `gorm:"default:false" json:"is_release_pending"`
	Status          string     `gorm:"size:30;default:'active'" json:"status"`
	ApprovalStatus  string     `gorm:"size:30;default:'pending'" json:"approval_status"`
	RejectionReason string     `gorm:"type:text" json:"rejection_reason"`
	AllocationID        *uint      `gorm:"index" json:"allocation_id"`
	SharesType          string     `gorm:"size:20;default:'both'" json:"shares_type"` // paid, unpaid, both
	PaidSharesToBlock   int64      `gorm:"default:0" json:"paid_shares_to_block"`     // explicit paid portion (set by backend)
	UnpaidSharesToBlock int64      `gorm:"default:0" json:"unpaid_shares_to_block"`   // explicit unpaid portion (set by backend)
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`

	Shareholder Shareholder `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
	Allocation  *Allocation `gorm:"foreignKey:AllocationID" json:"allocation,omitempty"`
}

// Certificate represents share certificates
type Certificate struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	ShareholderID  uint       `gorm:"index;not null" json:"shareholder_id"`
	CertificateNo  string     `gorm:"uniqueIndex;size:50;not null" json:"certificate_no"`
	IssueDate      *time.Time `json:"issue_date"`
	NumberOfShares int64      `json:"number_of_shares"`
	ParValue       float64    `gorm:"type:decimal(18,2)" json:"par_value"`
	TotalValue     float64    `gorm:"type:decimal(18,2)" json:"total_value"`
	Status         string     `gorm:"size:30;default:'active'" json:"status"` // active, cancelled, replaced
	PrintedAt      *time.Time `json:"printed_at"`
	IsPrinted      bool       `gorm:"default:false" json:"is_printed"`
	// Scope: "total" = all allocations combined; "per_allocation" = a single allocation
	CertScope    string `gorm:"size:20;default:'total'" json:"cert_scope"`
	AllocationID *uint  `gorm:"index" json:"allocation_id"`
	Remark       string `gorm:"type:text" json:"remark"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`

	Shareholder Shareholder `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
	Allocation  *Allocation `gorm:"foreignKey:AllocationID" json:"allocation,omitempty"`
}

// AGMMeeting represents an Annual General Meeting
type AGMMeeting struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	Title       string         `gorm:"size:300;not null" json:"title"`
	Description string         `gorm:"type:text" json:"description"`
	MeetingDate *time.Time     `json:"meeting_date"`
	MeetingType string         `gorm:"size:20;default:'hybrid'" json:"meeting_type"` // in_person, hybrid, virtual
	AccessCode  string         `gorm:"size:10" json:"access_code"`                   // 6-digit code for in-person verification
	Status      string         `gorm:"size:20;default:'upcoming'" json:"status"`      // upcoming, active, closed
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	Agendas []AGMAgenda `gorm:"foreignKey:MeetingID" json:"agendas,omitempty"`
}

// AGMAgenda represents an agenda item within a meeting
type AGMAgenda struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	MeetingID   uint           `gorm:"index;not null" json:"meeting_id"`
	Title       string         `gorm:"size:500;not null" json:"title"`
	Description string         `gorm:"type:text" json:"description"`
	SortOrder   int            `gorm:"default:0" json:"sort_order"`
	Status      string         `gorm:"size:20;default:'inactive'" json:"status"` // inactive, active, closed
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

// AGMProxy represents a proxy authorization for an AGM meeting
type AGMProxy struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	MeetingID     uint      `gorm:"uniqueIndex:idx_agm_proxy;not null" json:"meeting_id"`
	ShareholderID uint      `gorm:"uniqueIndex:idx_agm_proxy;not null" json:"shareholder_id"`
	ProxyName     string    `gorm:"size:200;not null" json:"proxy_name"`
	ProxyPhone    string    `gorm:"size:20" json:"proxy_phone"`
	ProxyIDNo     string    `gorm:"size:50" json:"proxy_id_no"`
	ProxyCode     string    `gorm:"size:10;uniqueIndex" json:"proxy_code"`
	Status        string    `gorm:"size:20;default:'active'" json:"status"` // active, revoked, used
	RejectionReason string  `gorm:"type:text" json:"rejection_reason"`
	CreatedAt     time.Time `json:"created_at"`

	Shareholder Shareholder `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
}

// AGMVote represents a shareholder's vote on an agenda item
type AGMVote struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	MeetingID  uint      `gorm:"index;not null" json:"meeting_id"`
	AgendaID   uint      `gorm:"uniqueIndex:idx_agm_vote;not null" json:"agenda_id"`
	VoterID    uint      `gorm:"uniqueIndex:idx_agm_vote;not null" json:"voter_id"`
	Vote       string    `gorm:"size:10;not null" json:"vote"` // agree, disagree, neutral
	ShareValue float64   `gorm:"type:decimal(10,4)" json:"share_value"`
	NumShares  int64     `json:"num_shares"`
	CreatedAt  time.Time `json:"created_at"`

	Voter Shareholder `gorm:"foreignKey:VoterID" json:"voter,omitempty"`
}

// AGMAttendance represents AGM attendance records
type AGMAttendance struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	ShareholderID uint       `gorm:"index;not null" json:"shareholder_id"`
	AGMDate       *time.Time `json:"agm_date"`
	AGMYear       string     `gorm:"size:20" json:"agm_year"`
	AttendanceType string    `gorm:"size:30" json:"attendance_type"` // in_person, proxy
	ProxyName     string     `gorm:"size:200" json:"proxy_name"`
	NumberOfShares int64     `json:"number_of_shares"`
	VotingPower   float64    `gorm:"type:decimal(10,4)" json:"voting_power"`
	IsPresent     bool       `gorm:"default:true" json:"is_present"`
	Remark        string     `gorm:"type:text" json:"remark"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`

	Shareholder Shareholder `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
}

// PendingApproval tracks items needing authorization
type PendingApproval struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	EntityType   string     `gorm:"size:50;not null" json:"entity_type"` // investment, transfer, dividend, block, subscription
	EntityID     uint       `gorm:"not null" json:"entity_id"`
	Action       string     `gorm:"size:30" json:"action"` // create, update, delete
	RequestedBy  uint       `gorm:"index" json:"requested_by"`
	ApprovedBy   *uint      `json:"approved_by"`
	Status       string     `gorm:"size:30;default:'pending'" json:"status"` // pending, approved, rejected
	Remark       string     `gorm:"type:text" json:"remark"`
	// Payload holds a JSON snapshot of a proposed change for approvals where
	// the entity already exists and the change is a diff rather than a new
	// row (currently: shareholder update). Applied on approve, ignored on
	// reject. Empty for create/delete and for entities that flip a status.
	Payload      string     `gorm:"type:text" json:"payload,omitempty"`
	RequestedAt  time.Time  `json:"requested_at"`
	ProcessedAt  *time.Time `json:"processed_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// ServiceCharge records service fees collected
type ServiceCharge struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	ShareholderID uint       `gorm:"index" json:"shareholder_id"`
	ChargeType    string     `gorm:"size:50" json:"charge_type"` // transfer, block, certificate
	Amount        float64    `gorm:"type:decimal(18,2)" json:"amount"`
	ReferenceNo   string     `gorm:"size:100" json:"reference_no"`
	ReferenceType string     `gorm:"size:50" json:"reference_type"`
	ReferenceID   uint       `json:"reference_id"`
	ChargeDate    *time.Time `json:"charge_date"`
	Remark        string     `gorm:"type:text" json:"remark"`
	CreatedAt     time.Time  `json:"created_at"`

	Shareholder Shareholder `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
}

// BankCapital stores authorized bank capital info
type BankCapital struct {
	ID               uint       `gorm:"primaryKey" json:"id"`
	AuthorizedCapital float64   `gorm:"type:decimal(18,2)" json:"authorized_capital"`
	PaidUpCapital    float64    `gorm:"type:decimal(18,2)" json:"paid_up_capital"`
	ParValuePerShare float64    `gorm:"type:decimal(18,2)" json:"par_value_per_share"`
	TotalShares      int64      `json:"total_shares"`
	EffectiveDate    *time.Time `json:"effective_date"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// SystemSetting stores dynamic configuration (e.g., tax formula)
type SystemSetting struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	Key         string `gorm:"uniqueIndex;size:100;not null" json:"key"`
	Value       string `gorm:"type:text;not null" json:"value"`
	Description string `gorm:"size:500" json:"description"`
}

// Announcement represents admin-published content for the mobile feed
type Announcement struct {
	ID           uint           `gorm:"primaryKey" json:"id"`
	Title        string         `gorm:"size:200;not null" json:"title"`
	Description  string         `gorm:"type:text" json:"description"`
	Type         string         `gorm:"size:20;not null" json:"type"` // video, carousel
	MediaURLs    string         `gorm:"type:text" json:"media_urls"` // JSON array of paths
	ThumbnailURL string         `gorm:"size:500" json:"thumbnail_url"`
	CreatedBy    uint           `gorm:"index" json:"created_by"`
	IsActive     bool           `gorm:"default:true" json:"is_active"`
	ViewCount    int64          `gorm:"default:0" json:"view_count"`
	LikeCount    int64          `gorm:"default:0" json:"like_count"`
	CommentCount int64          `gorm:"default:0" json:"comment_count"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`

	Creator User `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
}

// AnnouncementLike tracks which shareholders liked an announcement
type AnnouncementLike struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	AnnouncementID uint      `gorm:"uniqueIndex:idx_announcement_like;not null" json:"announcement_id"`
	ShareholderID  uint      `gorm:"uniqueIndex:idx_announcement_like;not null" json:"shareholder_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// AnnouncementView tracks unique views per shareholder
type AnnouncementView struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	AnnouncementID uint      `gorm:"uniqueIndex:idx_announcement_view;not null" json:"announcement_id"`
	ShareholderID  uint      `gorm:"uniqueIndex:idx_announcement_view;not null" json:"shareholder_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// AnnouncementComment stores comments and replies on announcements
type AnnouncementComment struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	AnnouncementID uint           `gorm:"index;not null" json:"announcement_id"`
	ShareholderID  uint           `gorm:"index;not null" json:"shareholder_id"`
	ParentID       *uint          `gorm:"index" json:"parent_id"`
	Content        string         `gorm:"type:text;not null" json:"content"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`

	Shareholder Shareholder          `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
	Replies     []AnnouncementComment `gorm:"foreignKey:ParentID" json:"replies,omitempty"`
}

// ShareListing represents a sell listing on the shareholder marketplace
type ShareListing struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	SellerID       uint           `gorm:"index;not null" json:"seller_id"`
	NumberOfShares int64          `gorm:"not null" json:"number_of_shares"`
	PricePerShare  float64        `gorm:"type:decimal(18,2);not null" json:"price_per_share"`
	TotalValue     float64        `gorm:"type:decimal(18,2);not null" json:"total_value"`
	Status         string         `gorm:"size:30;default:'active'" json:"status"` // active, pending, completed, cancelled
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`

	Seller Shareholder `gorm:"foreignKey:SellerID" json:"seller,omitempty"`
}

// TradeRequest represents a buy request on a marketplace listing
type TradeRequest struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	ListingID      uint       `gorm:"index;not null" json:"listing_id"`
	SellerID       uint       `gorm:"index;not null" json:"seller_id"`
	BuyerID        uint       `gorm:"index;not null" json:"buyer_id"`
	NumberOfShares int64      `gorm:"not null" json:"number_of_shares"`
	PricePerShare  float64    `gorm:"type:decimal(18,2);not null" json:"price_per_share"`
	TotalValue     float64    `gorm:"type:decimal(18,2);not null" json:"total_value"`
	Status         string     `gorm:"size:30;default:'pending'" json:"status"` // pending, approved, rejected, completed
	RejectionReason string    `gorm:"type:text" json:"rejection_reason"`
	TransferID     *uint      `json:"transfer_id"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`

	Listing ShareListing `gorm:"foreignKey:ListingID" json:"listing,omitempty"`
	Seller  Shareholder  `gorm:"foreignKey:SellerID" json:"seller,omitempty"`
	Buyer   Shareholder  `gorm:"foreignKey:BuyerID" json:"buyer,omitempty"`
}

// Document represents a file in the shareholder document center
type Document struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	Title       string         `gorm:"size:300;not null" json:"title"`
	Description string         `gorm:"type:text" json:"description"`
	Category    string         `gorm:"size:100;not null;index" json:"category"`
	FileName    string         `gorm:"size:300;not null" json:"file_name"`
	FilePath    string         `gorm:"size:500;not null" json:"file_path"`
	FileType    string         `gorm:"size:20;not null" json:"file_type"`
	FileSize    int64          `gorm:"not null" json:"file_size"`
	UploadedBy  uint           `gorm:"index;not null" json:"uploaded_by"`
	Downloads   int64          `gorm:"default:0" json:"downloads"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	Uploader User `gorm:"foreignKey:UploadedBy" json:"uploader,omitempty"`
}

// CommunityGroup represents a shareholder discussion group
type CommunityGroup struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	Name        string         `gorm:"size:200;not null" json:"name"`
	Description string         `gorm:"type:text" json:"description"`
	AvatarURL   string         `gorm:"size:500" json:"avatar_url"`
	CreatedBy   uint           `gorm:"index;not null" json:"created_by"`
	MemberCount int64          `gorm:"default:0" json:"member_count"`
	IsPublic    bool           `gorm:"default:true" json:"is_public"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	Creator Shareholder `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
}

// GroupMember tracks group membership
type GroupMember struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	GroupID   uint      `gorm:"uniqueIndex:idx_group_member;not null" json:"group_id"`
	MemberID  uint      `gorm:"uniqueIndex:idx_group_member;not null" json:"member_id"`
	Role      string    `gorm:"size:20;default:'member'" json:"role"` // admin, member
	CreatedAt time.Time `json:"created_at"`

	Member Shareholder `gorm:"foreignKey:MemberID" json:"member,omitempty"`
}

// GroupPost represents a discussion post in a group
type GroupPost struct {
	ID           uint           `gorm:"primaryKey" json:"id"`
	GroupID      uint           `gorm:"index;not null" json:"group_id"`
	AuthorID     uint           `gorm:"index;not null" json:"author_id"`
	Content      string         `gorm:"type:text;not null" json:"content"`
	Attachments  string         `gorm:"type:text" json:"attachments"` // JSON array
	LikeCount    int64          `gorm:"default:0" json:"like_count"`
	CommentCount int64          `gorm:"default:0" json:"comment_count"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`

	Author Shareholder    `gorm:"foreignKey:AuthorID" json:"author,omitempty"`
	Group  CommunityGroup `gorm:"foreignKey:GroupID" json:"group,omitempty"`
}

// PostComment represents a comment on a discussion post
type PostComment struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	PostID    uint           `gorm:"index;not null" json:"post_id"`
	AuthorID  uint           `gorm:"index;not null" json:"author_id"`
	ParentID  *uint          `gorm:"index" json:"parent_id"`
	Content   string         `gorm:"type:text;not null" json:"content"`
	CreatedAt time.Time      `json:"created_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Author  Shareholder   `gorm:"foreignKey:AuthorID" json:"author,omitempty"`
	Replies []PostComment `gorm:"foreignKey:ParentID" json:"replies,omitempty"`
}

// PostLike tracks likes on posts
type PostLike struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	PostID    uint      `gorm:"uniqueIndex:idx_post_like;not null" json:"post_id"`
	UserID    uint      `gorm:"uniqueIndex:idx_post_like;not null" json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
}

// Poll represents a poll within a group
type Poll struct {
	ID         uint           `gorm:"primaryKey" json:"id"`
	GroupID    uint           `gorm:"index;not null" json:"group_id"`
	CreatorID  uint           `gorm:"index;not null" json:"creator_id"`
	Question   string         `gorm:"type:text;not null" json:"question"`
	ExpiresAt  *time.Time     `json:"expires_at"`
	TotalVotes int64          `gorm:"default:0" json:"total_votes"`
	IsActive   bool           `gorm:"default:true" json:"is_active"`
	CreatedAt  time.Time      `json:"created_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`

	Creator Shareholder  `gorm:"foreignKey:CreatorID" json:"creator,omitempty"`
	Options []PollOption `gorm:"foreignKey:PollID" json:"options,omitempty"`
}

// PollOption represents an option in a poll
type PollOption struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	PollID    uint   `gorm:"index;not null" json:"poll_id"`
	Text      string `gorm:"size:500;not null" json:"text"`
	VoteCount int64  `gorm:"default:0" json:"vote_count"`
}

// PollVote tracks individual votes
type PollVote struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	PollID    uint      `gorm:"uniqueIndex:idx_poll_vote;not null" json:"poll_id"`
	VoterID   uint      `gorm:"uniqueIndex:idx_poll_vote;not null" json:"voter_id"`
	OptionID  uint      `gorm:"index;not null" json:"option_id"`
	CreatedAt time.Time `json:"created_at"`
}

// ChatSettings stores shareholder privacy preferences for chat
type ChatSettings struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	ShareholderID  uint      `gorm:"uniqueIndex;not null" json:"shareholder_id"`
	ShowInvestment bool      `gorm:"default:false" json:"show_investment"`
	ShowPhone      bool      `gorm:"default:false" json:"show_phone"`
	PublicKey      string    `gorm:"type:text" json:"public_key"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Conversation represents a chat between two shareholders
type Conversation struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	Participant1ID uint       `gorm:"uniqueIndex:idx_conv_pair;not null" json:"participant1_id"`
	Participant2ID uint       `gorm:"uniqueIndex:idx_conv_pair;not null" json:"participant2_id"`
	LastMessageAt  *time.Time `json:"last_message_at"`
	CreatedAt      time.Time  `json:"created_at"`

	Participant1 Shareholder `gorm:"foreignKey:Participant1ID" json:"participant1,omitempty"`
	Participant2 Shareholder `gorm:"foreignKey:Participant2ID" json:"participant2,omitempty"`
}

// Message stores an E2E encrypted chat message
type Message struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	ConversationID   uint           `gorm:"index;not null" json:"conversation_id"`
	SenderID         uint           `gorm:"index;not null" json:"sender_id"`
	EncryptedContent string         `gorm:"type:text;not null" json:"encrypted_content"`
	Nonce            string         `gorm:"size:100;not null" json:"nonce"`
	ReplyToID        *uint          `gorm:"index" json:"reply_to_id"`
	IsForwarded      bool           `gorm:"default:false" json:"is_forwarded"`
	IsRead           bool           `gorm:"default:false" json:"is_read"`
	CreatedAt        time.Time      `json:"created_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`

	Sender    Shareholder       `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
	ReplyTo   *Message          `gorm:"foreignKey:ReplyToID" json:"reply_to,omitempty"`
	Reactions []MessageReaction `gorm:"foreignKey:MessageID" json:"reactions,omitempty"`
}

// MessageReaction stores emoji reactions on messages
type MessageReaction struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	MessageID uint      `gorm:"uniqueIndex:idx_msg_reaction;not null" json:"message_id"`
	SenderID  uint      `gorm:"uniqueIndex:idx_msg_reaction;not null" json:"sender_id"`
	Emoji     string    `gorm:"size:10;not null" json:"emoji"`
	CreatedAt time.Time `json:"created_at"`

	Sender Shareholder `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
}

// DeviceBinding stores device-shareholder PIN bindings for mobile login
type DeviceBinding struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	ShareholderID  uint      `gorm:"index;not null" json:"shareholder_id"`
	DeviceID       string    `gorm:"uniqueIndex;size:255;not null" json:"device_id"`
	PinHash        string    `gorm:"size:255;not null" json:"-"`
	DeviceName     string    `gorm:"size:200" json:"device_name"`
	FailedAttempts int       `gorm:"default:0" json:"failed_attempts"`
	IsLocked       bool      `gorm:"default:false" json:"is_locked"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`

	Shareholder Shareholder `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
}

// ShareSplit records share split events
type ShareSplit struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	SplitDate     *time.Time `json:"split_date"`
	SplitRatio    string     `gorm:"size:20" json:"split_ratio"` // e.g., "2:1"
	OldParValue   float64    `gorm:"type:decimal(18,2)" json:"old_par_value"`
	NewParValue   float64    `gorm:"type:decimal(18,2)" json:"new_par_value"`
	Status        string     `gorm:"size:30;default:'pending'" json:"status"`
	ProcessedAt   *time.Time `json:"processed_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// ============================================================
// Mini App Platform
// ============================================================

// MiniAppCategory groups mini apps into categories
type MiniAppCategory struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Name         string    `gorm:"size:100;not null" json:"name"`
	Icon         string    `gorm:"size:100" json:"icon"`
	DisplayOrder int       `gorm:"default:0" json:"display_order"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// MiniApp represents a pluggable mini application in the platform
type MiniApp struct {
	ID           uint           `gorm:"primaryKey" json:"id"`
	Name         string         `gorm:"size:200;not null" json:"name"`
	Description  string         `gorm:"type:text" json:"description"`
	IconURL      string         `gorm:"size:500" json:"icon_url"`
	BannerImage  string         `gorm:"size:500" json:"banner_image"`
	RoutePath    string         `gorm:"size:500" json:"route_path"`
	AppType      string         `gorm:"size:20;default:'internal'" json:"app_type"`   // internal, external
	LaunchType   string         `gorm:"size:20;default:'screen'" json:"launch_type"`  // screen, webview, api
	CategoryID   *uint          `gorm:"index" json:"category_id"`
	DisplayOrder int            `gorm:"default:0" json:"display_order"`
	Status       string         `gorm:"size:20;default:'active'" json:"status"` // active, inactive
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`

	Category    *MiniAppCategory  `gorm:"foreignKey:CategoryID" json:"category,omitempty"`
	Permissions []MiniAppPermission `gorm:"foreignKey:MiniAppID" json:"permissions,omitempty"`
	Settings    []MiniAppSetting  `gorm:"foreignKey:MiniAppID" json:"settings,omitempty"`
}

// MiniAppPermission defines access requirements for a mini app
type MiniAppPermission struct {
	ID                      uint   `gorm:"primaryKey" json:"id"`
	MiniAppID               uint   `gorm:"index;not null" json:"mini_app_id"`
	RequiredRole            string `gorm:"size:50" json:"required_role"`
	RequiredShareholderStatus string `gorm:"size:50" json:"required_shareholder_status"`
}

// MiniAppSetting stores key-value configuration for a mini app
type MiniAppSetting struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	MiniAppID   uint   `gorm:"index;not null" json:"mini_app_id"`
	ConfigKey   string `gorm:"size:100;not null" json:"config_key"`
	ConfigValue string `gorm:"type:text" json:"config_value"`
}

// ============================================================
// Capital Increase Share Allocation
// ============================================================

// CapitalIncrease represents one issuance of new shares to existing shareholders,
// distributed proportionally across multiple whole-number rounds.
type CapitalIncrease struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	Label           string     `gorm:"size:200;not null" json:"label"`
	TotalNewShares  int64      `gorm:"not null" json:"total_new_shares"`
	ParValue        float64    `gorm:"type:decimal(18,2);not null" json:"par_value"`
	MaxAutoRounds   int        `gorm:"default:3" json:"max_auto_rounds"`
	CurrentRound    int        `gorm:"default:0" json:"current_round"`
	AllocatedShares int64      `gorm:"default:0" json:"allocated_shares"`
	Status          string     `gorm:"size:30;default:'draft'" json:"status"` // draft, round_open, additional_open, closed
	Remark          string     `gorm:"type:text" json:"remark"`
	StartedAt       *time.Time `json:"started_at"`
	ClosedAt        *time.Time `json:"closed_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// CIAdditionalRequest is a shareholder's request for more shares.
// In the iterative flow, requests are created during a round's confirmation
// phase and then capped against the shareholder's allocation in the next round.
// FulfilledShares is incremented every time a confirmation eats into the request.
// Status flows: pending → partial → fulfilled, or pending → expired/rejected.
// (approved/rejected remain available for the standalone admin-managed phase
// that runs after MaxAutoRounds is exhausted.)
type CIAdditionalRequest struct {
	ID                uint      `gorm:"primaryKey" json:"id"`
	CapitalIncreaseID uint      `gorm:"index;not null" json:"capital_increase_id"`
	ShareholderID     uint      `gorm:"index;not null" json:"shareholder_id"`
	Round             int       `gorm:"default:0" json:"round"` // round whose confirmation phase produced this request
	RequestedShares   int64     `gorm:"not null" json:"requested_shares"`
	FulfilledShares   int64     `gorm:"default:0" json:"fulfilled_shares"` // running count of confirmed-against shares
	ApprovedShares    int64     `gorm:"default:0" json:"approved_shares"`  // manual admin approval (post-MaxAutoRounds path)
	Status            string    `gorm:"size:20;default:'pending'" json:"status"`
	Note              string    `gorm:"size:500" json:"note"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`

	Shareholder     Shareholder     `gorm:"foreignKey:ShareholderID" json:"shareholder,omitempty"`
	CapitalIncrease CapitalIncrease `gorm:"foreignKey:CapitalIncreaseID" json:"capital_increase,omitempty"`
}
