// TigerBeetle Bridge Service — TradeGateway NGSWTP
// Language: Go 1.23 | Framework: Chi HTTP + gRPC
// Role: Wraps TigerBeetle's binary protocol behind a JSON REST API and gRPC
//       interface. Provides double-entry bookkeeping for all duty payments,
//       penalties, bonds, drawbacks, and refunds.
//
// Account model (WCO financial ledger):
//   Ledger 1 (GHS — Ghana Cedi):
//     Account 1001 — Trader Liability (debit side of duty payments)
//     Account 2001 — Customs Revenue Confirmed (credit side)
//     Account 2002 — Customs Revenue Pending (two-phase reserve)
//     Account 3001 — Bond/Security Deposits
//     Account 4001 — Drawback/Refund Payable
//
// Two-phase payment flow:
//   1. POST /api/ledger/transfers/pending   → reserve funds (debit trader, credit pending)
//   2. POST /api/ledger/transfers/post      → finalize (debit pending, credit confirmed)
//   3. POST /api/ledger/transfers/void      → cancel reservation on payment failure
//
// Endpoints:
//   GET  /health
//   POST /api/ledger/accounts
//   GET  /api/ledger/accounts/:id
//   GET  /api/ledger/accounts/:id/balance
//   POST /api/ledger/transfers
//   POST /api/ledger/transfers/pending
//   POST /api/ledger/transfers/post
//   POST /api/ledger/transfers/void
//   GET  /api/ledger/transfers/:id
//   GET  /api/ledger/accounts/:id/transfers
//   GET  /api/ledger/summary

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

// ─── Configuration ────────────────────────────────────────────────────────────

var (
	httpPort        = getEnv("TB_BRIDGE_HTTP_PORT", "8086")
	grpcPort        = getEnv("TB_BRIDGE_GRPC_PORT", "9086")
	tigerBeetleAddr = getEnv("TIGERBEETLE_ADDR", "tigerbeetle:3000")
)

// ─── Domain types ─────────────────────────────────────────────────────────────

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

// Account represents a TigerBeetle account (128-bit ID stored as hex string).
type Account struct {
	ID                         string          `json:"id"`
	Ledger                     uint32          `json:"ledger"`
	Code                       uint16          `json:"code"`
	AccountType                AccountType     `json:"accountType"`
	Description                string          `json:"description"`
	Currency                   string          `json:"currency"`
	DebitsMustNotExceedCredits bool            `json:"debitsMustNotExceedCredits"`
	DebitsPosted               decimal.Decimal `json:"debitsPosted"`
	CreditsPosted              decimal.Decimal `json:"creditsPosted"`
	DebitsPending              decimal.Decimal `json:"debitsPending"`
	CreditsPending             decimal.Decimal `json:"creditsPending"`
	CreatedAt                  time.Time       `json:"createdAt"`
}

// Balance returns the net balance of an account (credits − debits).
func (a *Account) Balance() decimal.Decimal {
	return a.CreditsPosted.Sub(a.DebitsPosted)
}

// Transfer represents a TigerBeetle transfer (double-entry record).
type Transfer struct {
	ID              string          `json:"id"`
	DebitAccountID  string          `json:"debitAccountId"`
	CreditAccountID string          `json:"creditAccountId"`
	Amount          decimal.Decimal `json:"amount"`
	Currency        string          `json:"currency"`
	Ledger          uint32          `json:"ledger"`
	Code            uint16          `json:"code"`
	Flag            TransferFlag    `json:"flag"`
	PendingID       string          `json:"pendingId,omitempty"`
	Reference       string          `json:"reference,omitempty"`
	Description     string          `json:"description,omitempty"`
	Metadata        interface{}     `json:"metadata,omitempty"`
	IdempotencyKey  string          `json:"idempotencyKey,omitempty"`
	// Timestamps (nanoseconds since epoch, as TigerBeetle stores them)
	Timestamp int64      `json:"timestamp"`
	CreatedAt time.Time  `json:"createdAt"`
	PostedAt  *time.Time `json:"postedAt,omitempty"`
	VoidedAt  *time.Time `json:"voidedAt,omitempty"`
	Status    string     `json:"status"`
}

// ─── In-memory store (simulates TigerBeetle until binary client is wired) ────
// In production, replace with the official tigerbeetle-go client:
//   https://github.com/tigerbeetle/tigerbeetle/tree/main/src/clients/go

type Store struct {
	mu        sync.RWMutex
	accounts  map[string]*Account
	transfers map[string]*Transfer
}

func NewStore() *Store {
	s := &Store{
		accounts:  make(map[string]*Account),
		transfers: make(map[string]*Transfer),
	}
	// Seed the standard customs authority accounts
	s.seedAccounts()
	return s
}

func (s *Store) seedAccounts() {
	standard := []struct {
		id          string
		code        uint16
		accountType AccountType
		desc        string
	}{
		{"0000000000000001", 1001, AccountTraderLiability, "Trader Liability — duty obligations"},
		{"0000000000000002", 2001, AccountCustomsRevenuePend, "Customs Revenue Pending — two-phase reserve"},
		{"0000000000000003", 2002, AccountCustomsRevenueConf, "Customs Revenue Confirmed — settled duties"},
		{"0000000000000004", 3001, AccountBondDeposit, "Bond/Security Deposits"},
		{"0000000000000005", 4001, AccountDrawbackPayable, "Drawback/Refund Payable"},
	}
	for _, a := range standard {
		s.accounts[a.id] = &Account{
			ID:          a.id,
			Ledger:      1,
			Code:        a.code,
			AccountType: a.accountType,
			Description: a.desc,
			Currency:    "GHS",
			CreatedAt:   time.Now().UTC(),
		}
	}
}

func (s *Store) CreateAccount(a *Account) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.accounts[a.ID]; exists {
		return fmt.Errorf("account %s already exists", a.ID)
	}
	a.CreatedAt = time.Now().UTC()
	s.accounts[a.ID] = a
	return nil
}

func (s *Store) GetAccount(id string) (*Account, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	a, ok := s.accounts[id]
	return a, ok
}

func (s *Store) PostTransfer(t *Transfer) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if t.IdempotencyKey != "" {
		for _, existing := range s.transfers {
			if existing.IdempotencyKey == t.IdempotencyKey {
				*t = *existing
				return nil
			}
		}
	}

	debit, ok := s.accounts[t.DebitAccountID]
	if !ok {
		return fmt.Errorf("debit account %s not found", t.DebitAccountID)
	}
	credit, ok := s.accounts[t.CreditAccountID]
	if !ok {
		return fmt.Errorf("credit account %s not found", t.CreditAccountID)
	}
	if debit.Currency != t.Currency || credit.Currency != t.Currency {
		return fmt.Errorf("transfer currency %s does not match both account currencies", t.Currency)
	}

	now := time.Now().UTC()
	t.CreatedAt = now
	t.Timestamp = now.UnixNano()

	switch t.Flag {
	case FlagPending:
		available := debit.CreditsPosted.Sub(debit.DebitsPosted).Sub(debit.DebitsPending)
		if debit.DebitsMustNotExceedCredits && available.LessThan(t.Amount) {
			return fmt.Errorf("insufficient available balance in debit account %s", debit.ID)
		}
		debit.DebitsPending = debit.DebitsPending.Add(t.Amount)
		credit.CreditsPending = credit.CreditsPending.Add(t.Amount)
		t.Status = "PENDING"

	case FlagPostPendingTransfer:
		// Resolve the pending transfer
		pending, ok := s.transfers[t.PendingID]
		if !ok {
			return fmt.Errorf("pending transfer %s not found", t.PendingID)
		}
		if t.Amount.GreaterThan(pending.Amount) {
			return fmt.Errorf("posted amount exceeds pending transfer %s", t.PendingID)
		}
		// Move from pending to posted
		pendingDebit := s.accounts[pending.DebitAccountID]
		pendingCredit := s.accounts[pending.CreditAccountID]
		pendingDebit.DebitsPending = pendingDebit.DebitsPending.Sub(pending.Amount)
		pendingCredit.CreditsPending = pendingCredit.CreditsPending.Sub(pending.Amount)
		debit.DebitsPosted = debit.DebitsPosted.Add(t.Amount)
		credit.CreditsPosted = credit.CreditsPosted.Add(t.Amount)
		t.Status = "POSTED"
		posted := now
		t.PostedAt = &posted
		pending.Status = "POSTED"
		pending.PostedAt = &posted

	case FlagVoidPendingTransfer:
		pending, ok := s.transfers[t.PendingID]
		if !ok {
			return fmt.Errorf("pending transfer %s not found", t.PendingID)
		}
		pendingDebit := s.accounts[pending.DebitAccountID]
		pendingCredit := s.accounts[pending.CreditAccountID]
		pendingDebit.DebitsPending = pendingDebit.DebitsPending.Sub(pending.Amount)
		pendingCredit.CreditsPending = pendingCredit.CreditsPending.Sub(pending.Amount)
		t.Status = "VOIDED"
		voided := now
		t.VoidedAt = &voided
		pending.Status = "VOIDED"
		pending.VoidedAt = &voided

	default:
		// Immediate (non-pending) transfer
		available := debit.CreditsPosted.Sub(debit.DebitsPosted).Sub(debit.DebitsPending)
		if debit.DebitsMustNotExceedCredits && available.LessThan(t.Amount) {
			return fmt.Errorf("insufficient available balance in debit account %s", debit.ID)
		}
		debit.DebitsPosted = debit.DebitsPosted.Add(t.Amount)
		credit.CreditsPosted = credit.CreditsPosted.Add(t.Amount)
		t.Status = "POSTED"
		posted := now
		t.PostedAt = &posted
	}

	s.transfers[t.ID] = t
	return nil
}

func (s *Store) GetTransfer(id string) (*Transfer, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.transfers[id]
	return t, ok
}

func (s *Store) GetTransferByIdempotencyKey(key string) (*Transfer, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, transfer := range s.transfers {
		if transfer.IdempotencyKey == key {
			return transfer, true
		}
	}
	return nil, false
}

func (s *Store) GetTransfersByAccount(accountID string, limit int) []*Transfer {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*Transfer
	for _, t := range s.transfers {
		if t.DebitAccountID == accountID || t.CreditAccountID == accountID {
			result = append(result, t)
		}
		if len(result) >= limit {
			break
		}
	}
	return result
}

func (s *Store) GetAllAccounts() []*Account {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*Account, 0, len(s.accounts))
	for _, a := range s.accounts {
		result = append(result, a)
	}
	return result
}

func (s *Store) GetRecentTransfers(limit int) []*Transfer {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*Transfer, 0, len(s.transfers))
	for _, t := range s.transfers {
		result = append(result, t)
	}
	if len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result
}

// ─── Service ──────────────────────────────────────────────────────────────────

type TigerBeetleBridge struct {
	logger *zap.Logger
	store  *Store
	tbAddr string
}

func NewBridge(logger *zap.Logger) *TigerBeetleBridge {
	return &TigerBeetleBridge{
		logger: logger,
		store:  NewStore(),
		tbAddr: tigerBeetleAddr,
	}
}

// ─── HTTP handlers ─────────────────────────────────────────────────────────────

func (b *TigerBeetleBridge) handleCreateAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID                         string      `json:"id"`
		Ledger                     uint32      `json:"ledger"`
		Code                       uint16      `json:"code"`
		AccountType                AccountType `json:"accountType"`
		Description                string      `json:"description"`
		Currency                   string      `json:"currency"`
		DebitsMustNotExceedCredits bool        `json:"debitsMustNotExceedCredits"`
		InitialBalance             string      `json:"initialBalance,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.ID == "" {
		req.ID = uuid.New().String()
	}
	if req.Currency == "" {
		req.Currency = "GHS"
	}
	if req.Ledger == 0 {
		req.Ledger = 1
	}
	initialBalance := decimal.Zero
	if req.InitialBalance != "" {
		parsed, parseErr := decimal.NewFromString(req.InitialBalance)
		if parseErr != nil || parsed.IsNegative() {
			jsonError(w, "initialBalance must be a non-negative decimal", http.StatusBadRequest)
			return
		}
		initialBalance = parsed
	}
	acct := &Account{
		ID:                         req.ID,
		Ledger:                     req.Ledger,
		Code:                       req.Code,
		AccountType:                req.AccountType,
		Description:                req.Description,
		Currency:                   req.Currency,
		DebitsMustNotExceedCredits: req.DebitsMustNotExceedCredits,
		CreditsPosted:              initialBalance,
	}
	if err := b.store.CreateAccount(acct); err != nil {
		jsonError(w, err.Error(), http.StatusConflict)
		return
	}
	b.logger.Info("account created", zap.String("id", acct.ID), zap.String("type", string(acct.AccountType)))
	jsonOK(w, acct)
}

func (b *TigerBeetleBridge) handleGetAccount(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	acct, ok := b.store.GetAccount(id)
	if !ok {
		jsonError(w, "account not found", http.StatusNotFound)
		return
	}
	jsonOK(w, acct)
}

func (b *TigerBeetleBridge) handleGetBalance(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	acct, ok := b.store.GetAccount(id)
	if !ok {
		jsonError(w, "account not found", http.StatusNotFound)
		return
	}
	jsonOK(w, map[string]interface{}{
		"accountId":      acct.ID,
		"currency":       acct.Currency,
		"balance":        acct.Balance(),
		"debitsPosted":   acct.DebitsPosted,
		"creditsPosted":  acct.CreditsPosted,
		"debitsPending":  acct.DebitsPending,
		"creditsPending": acct.CreditsPending,
		"timestamp":      time.Now().UTC(),
	})
}

func (b *TigerBeetleBridge) handlePostTransfer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DebitAccountID  string      `json:"debitAccountId"`
		CreditAccountID string      `json:"creditAccountId"`
		Amount          string      `json:"amount"`
		Currency        string      `json:"currency"`
		Ledger          uint32      `json:"ledger"`
		Code            uint16      `json:"code"`
		Flag            string      `json:"flag"`
		PendingID       string      `json:"pendingId,omitempty"`
		Reference       string      `json:"reference,omitempty"`
		Description     string      `json:"description,omitempty"`
		Metadata        interface{} `json:"metadata,omitempty"`
		IdempotencyKey  string      `json:"idempotencyKey,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.DebitAccountID == "" || req.CreditAccountID == "" || req.Amount == "" {
		jsonError(w, "debitAccountId, creditAccountId, and amount are required", http.StatusBadRequest)
		return
	}
	if req.IdempotencyKey != "" {
		if existing, found := b.store.GetTransferByIdempotencyKey(req.IdempotencyKey); found {
			jsonOK(w, existing)
			return
		}
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || amount.IsNegative() || amount.IsZero() {
		jsonError(w, "amount must be a positive decimal", http.StatusBadRequest)
		return
	}
	if req.Currency == "" {
		req.Currency = "GHS"
	}
	if req.Ledger == 0 {
		req.Ledger = 1
	}
	flag := TransferFlag(req.Flag)
	if flag == "" {
		flag = FlagNone
	}
	t := &Transfer{
		ID:              uuid.New().String(),
		DebitAccountID:  req.DebitAccountID,
		CreditAccountID: req.CreditAccountID,
		Amount:          amount,
		Currency:        req.Currency,
		Ledger:          req.Ledger,
		Code:            req.Code,
		Flag:            flag,
		PendingID:       req.PendingID,
		Reference:       req.Reference,
		Description:     req.Description,
		Metadata:        req.Metadata,
		IdempotencyKey:  req.IdempotencyKey,
	}
	if err := b.store.PostTransfer(t); err != nil {
		jsonError(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	b.logger.Info("transfer posted",
		zap.String("id", t.ID),
		zap.String("flag", string(t.Flag)),
		zap.String("amount", t.Amount.String()),
		zap.String("status", t.Status),
	)
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handlePendingTransfer(w http.ResponseWriter, r *http.Request) {
	// Convenience endpoint: always sets flag=pending
	var req struct {
		DebitAccountID  string      `json:"debitAccountId"`
		CreditAccountID string      `json:"creditAccountId"`
		Amount          string      `json:"amount"`
		Currency        string      `json:"currency"`
		Reference       string      `json:"reference,omitempty"`
		Description     string      `json:"description,omitempty"`
		Metadata        interface{} `json:"metadata,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || !amount.IsPositive() {
		jsonError(w, "amount must be a positive decimal", http.StatusBadRequest)
		return
	}
	if req.Currency == "" {
		req.Currency = "GHS"
	}
	t := &Transfer{
		ID:              uuid.New().String(),
		DebitAccountID:  req.DebitAccountID,
		CreditAccountID: req.CreditAccountID,
		Amount:          amount,
		Currency:        req.Currency,
		Ledger:          1,
		Flag:            FlagPending,
		Reference:       req.Reference,
		Description:     req.Description,
		Metadata:        req.Metadata,
	}
	if err := b.store.PostTransfer(t); err != nil {
		jsonError(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	b.logger.Info("pending transfer created", zap.String("id", t.ID), zap.String("amount", t.Amount.String()))
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handlePostPending(w http.ResponseWriter, r *http.Request) {
	pendingID := chi.URLParam(r, "pendingId")
	pending, ok := b.store.GetTransfer(pendingID)
	if !ok {
		jsonError(w, "pending transfer not found", http.StatusNotFound)
		return
	}
	// Post: debit customs_revenue_pending, credit customs_revenue_confirmed
	t := &Transfer{
		ID:              uuid.New().String(),
		DebitAccountID:  pending.CreditAccountID, // reverse: pending credit becomes debit
		CreditAccountID: "0000000000000003",      // customs_revenue_confirmed
		Amount:          pending.Amount,
		Currency:        pending.Currency,
		Ledger:          1,
		Flag:            FlagPostPendingTransfer,
		PendingID:       pendingID,
		Reference:       pending.Reference,
		Description:     fmt.Sprintf("Post of pending transfer %s", pendingID),
	}
	if err := b.store.PostTransfer(t); err != nil {
		jsonError(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	b.logger.Info("pending transfer posted", zap.String("pendingId", pendingID), zap.String("postId", t.ID))
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handleVoidPending(w http.ResponseWriter, r *http.Request) {
	pendingID := chi.URLParam(r, "pendingId")
	pending, ok := b.store.GetTransfer(pendingID)
	if !ok {
		jsonError(w, "pending transfer not found", http.StatusNotFound)
		return
	}
	t := &Transfer{
		ID:              uuid.New().String(),
		DebitAccountID:  pending.DebitAccountID,
		CreditAccountID: pending.CreditAccountID,
		Amount:          pending.Amount,
		Currency:        pending.Currency,
		Ledger:          1,
		Flag:            FlagVoidPendingTransfer,
		PendingID:       pendingID,
		Description:     fmt.Sprintf("Void of pending transfer %s", pendingID),
	}
	if err := b.store.PostTransfer(t); err != nil {
		jsonError(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	b.logger.Info("pending transfer voided", zap.String("pendingId", pendingID))
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handleGetTransfer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	t, ok := b.store.GetTransfer(id)
	if !ok {
		jsonError(w, "transfer not found", http.StatusNotFound)
		return
	}
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handleGetAccountTransfers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	transfers := b.store.GetTransfersByAccount(id, limit)
	jsonOK(w, map[string]interface{}{
		"accountId": id,
		"transfers": transfers,
		"count":     len(transfers),
	})
}

func (b *TigerBeetleBridge) handleSummary(w http.ResponseWriter, r *http.Request) {
	accounts := b.store.GetAllAccounts()
	recentTransfers := b.store.GetRecentTransfers(20)

	totalRevenue := decimal.Zero
	pendingRevenue := decimal.Zero
	for _, a := range accounts {
		if a.AccountType == AccountCustomsRevenueConf {
			totalRevenue = totalRevenue.Add(a.CreditsPosted)
		}
		if a.AccountType == AccountCustomsRevenuePend {
			pendingRevenue = pendingRevenue.Add(a.CreditsPending)
		}
	}

	jsonOK(w, map[string]interface{}{
		"accounts":        accounts,
		"recentTransfers": recentTransfers,
		"summary": map[string]interface{}{
			"totalRevenueConfirmed": totalRevenue,
			"totalRevenuePending":   pendingRevenue,
			"currency":              "GHS",
			"timestamp":             time.Now().UTC(),
			"tigerBeetleAddr":       b.tbAddr,
			"mode":                  "simulation", // change to "live" when TB binary client is wired
		},
	})
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	bridge := NewBridge(logger)

	// HTTP router
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Service", "tigerbeetle-bridge")
			next.ServeHTTP(w, r)
		})
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, map[string]interface{}{
			"status":  "ok",
			"service": "tigerbeetle-bridge",
			"tbAddr":  tigerBeetleAddr,
		})
	})

	r.Route("/api/ledger", func(r chi.Router) {
		r.Post("/accounts", bridge.handleCreateAccount)
		r.Get("/accounts/{id}", bridge.handleGetAccount)
		r.Get("/accounts/{id}/balance", bridge.handleGetBalance)
		r.Get("/accounts/{id}/transfers", bridge.handleGetAccountTransfers)

		r.Post("/transfers", bridge.handlePostTransfer)
		r.Post("/transfers/pending", bridge.handlePendingTransfer)
		r.Post("/transfers/post/{pendingId}", bridge.handlePostPending)
		r.Post("/transfers/void/{pendingId}", bridge.handleVoidPending)
		r.Get("/transfers/{id}", bridge.handleGetTransfer)

		r.Get("/summary", bridge.handleSummary)
	})

	// gRPC server (health check + reflection for service mesh)
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		logger.Fatal("failed to listen for gRPC", zap.Error(err))
	}
	grpcServer := grpc.NewServer()
	healthSvc := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthSvc)
	healthSvc.SetServingStatus("tigerbeetle-bridge", grpc_health_v1.HealthCheckResponse_SERVING)
	reflection.Register(grpcServer)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	httpServer := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		logger.Info("TigerBeetle Bridge HTTP server starting", zap.String("port", httpPort))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("HTTP server error", zap.Error(err))
		}
	}()

	go func() {
		logger.Info("TigerBeetle Bridge gRPC server starting", zap.String("port", grpcPort))
		if err := grpcServer.Serve(lis); err != nil {
			logger.Fatal("gRPC server error", zap.Error(err))
		}
	}()

	<-quit
	logger.Info("Shutting down TigerBeetle Bridge...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	httpServer.Shutdown(ctx)
	grpcServer.GracefulStop()
}
