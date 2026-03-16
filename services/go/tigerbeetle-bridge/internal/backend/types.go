// Package backend defines the Backend interface and shared domain types for
// the TigerBeetle bridge. Two implementations exist:
//
//   - SimBackend (backend_sim.go, build tag: !tigerbeetle)
//     In-memory store with identical HTTP API semantics. Used in development,
//     CI, and any environment where the TigerBeetle binary is not installed.
//
//   - LiveBackend (backend_live.go, build tag: tigerbeetle)
//     Wraps the official tigerbeetle-go CGo client. Used in production.
//     Build with: CGO_ENABLED=1 go build -tags tigerbeetle ./...
//
// Switching between modes requires only a recompile — no code changes.
package backend

import "time"

// AccountType classifies the nature of a ledger account.
type AccountType string

const (
	AccountTraderLiability    AccountType = "TRADER_LIABILITY"
	AccountCustomsRevenuePend AccountType = "CUSTOMS_REVENUE_PENDING"
	AccountCustomsRevenueConf AccountType = "CUSTOMS_REVENUE_CONFIRMED"
	AccountBondDeposit        AccountType = "BOND_DEPOSIT"
	AccountDrawbackPayable    AccountType = "DRAWBACK_PAYABLE"
)

// TransferFlag controls TigerBeetle two-phase commit behaviour.
type TransferFlag string

const (
	FlagNone                TransferFlag = "none"
	FlagPending             TransferFlag = "pending"
	FlagPostPendingTransfer TransferFlag = "post_pending_transfer"
	FlagVoidPendingTransfer TransferFlag = "void_pending_transfer"
)

// Account is the bridge's domain representation of a TigerBeetle account.
// Amounts are stored as int64 minor units (e.g. pesewas for GHS).
type Account struct {
	ID             string      `json:"id"`
	Ledger         uint32      `json:"ledger"`
	Code           uint16      `json:"code"`
	AccountType    AccountType `json:"accountType"`
	Description    string      `json:"description"`
	Currency       string      `json:"currency"`
	DebitsPosted   int64       `json:"debitsPosted"`
	CreditsPosted  int64       `json:"creditsPosted"`
	DebitsPending  int64       `json:"debitsPending"`
	CreditsPending int64       `json:"creditsPending"`
	CreatedAt      time.Time   `json:"createdAt"`
}

// BalanceMinor returns the net balance in minor currency units (credits − debits).
func (a *Account) BalanceMinor() int64 {
	return a.CreditsPosted - a.DebitsPosted
}

// Transfer is the bridge's domain representation of a double-entry transfer.
// Amount is in minor currency units.
type Transfer struct {
	ID              string       `json:"id"`
	DebitAccountID  string       `json:"debitAccountId"`
	CreditAccountID string       `json:"creditAccountId"`
	Amount          int64        `json:"amount"` // minor units
	Currency        string       `json:"currency"`
	Ledger          uint32       `json:"ledger"`
	Code            uint16       `json:"code"`
	Flag            TransferFlag `json:"flag"`
	PendingID       string       `json:"pendingId,omitempty"`
	Reference       string       `json:"reference,omitempty"`
	Description     string       `json:"description,omitempty"`
	Timestamp       int64        `json:"timestamp"`
	CreatedAt       time.Time    `json:"createdAt"`
	PostedAt        *time.Time   `json:"postedAt,omitempty"`
	VoidedAt        *time.Time   `json:"voidedAt,omitempty"`
	Status          string       `json:"status"`
}

// Backend is the single interface both implementations satisfy.
type Backend interface {
	// Mode returns "live" or "simulation".
	Mode() string
	// CreateAccount creates a new ledger account. Returns nil if the account
	// already exists (idempotent).
	CreateAccount(a *Account) error
	// GetAccount returns the account with live balances, or (nil, false).
	GetAccount(id string) (*Account, bool)
	// PostTransfer executes a transfer (immediate, pending, post-pending, or void-pending).
	PostTransfer(t *Transfer) error
	// GetTransfer returns a transfer by ID, or (nil, false).
	GetTransfer(id string) (*Transfer, bool)
	// GetTransfersByAccount returns up to limit transfers for an account.
	GetTransfersByAccount(accountID string, limit int) []*Transfer
	// GetAllAccounts returns all known accounts with live balances.
	GetAllAccounts() []*Account
	// GetRecentTransfers returns the most recent limit transfers.
	GetRecentTransfers(limit int) []*Transfer
	// Close releases any resources held by the backend.
	Close()
}

// StandardAccounts returns the five standard customs authority accounts that
// must be seeded on startup. Both backends call this.
func StandardAccounts() []Account {
	return []Account{
		{ID: "0000000000000001", Ledger: 1, Code: 1001, AccountType: AccountTraderLiability, Description: "Trader Liability — duty obligations", Currency: "GHS"},
		{ID: "0000000000000002", Ledger: 1, Code: 2001, AccountType: AccountCustomsRevenuePend, Description: "Customs Revenue Pending — two-phase reserve", Currency: "GHS"},
		{ID: "0000000000000003", Ledger: 1, Code: 2002, AccountType: AccountCustomsRevenueConf, Description: "Customs Revenue Confirmed — settled duties", Currency: "GHS"},
		{ID: "0000000000000004", Ledger: 1, Code: 3001, AccountType: AccountBondDeposit, Description: "Bond/Security Deposits", Currency: "GHS"},
		{ID: "0000000000000005", Ledger: 1, Code: 4001, AccountType: AccountDrawbackPayable, Description: "Drawback/Refund Payable", Currency: "GHS"},
	}
}
