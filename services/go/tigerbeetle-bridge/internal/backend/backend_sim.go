//go:build !tigerbeetle

// SimBackend is the in-memory simulation backend.
// It is compiled when the `tigerbeetle` build tag is NOT set (default).
// It provides identical HTTP API semantics to the live TigerBeetle backend,
// making it safe to develop and test against without the TigerBeetle binary.
package backend

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// SimBackend implements Backend using an in-memory map store.
type SimBackend struct {
	mu        sync.RWMutex
	accounts  map[string]*Account
	transfers map[string]*Transfer
}

// NewBackend returns a SimBackend seeded with the standard customs accounts.
// This function is the entry point used by main.go — its signature is the same
// as the live backend's NewBackend so main.go never needs a build tag.
//
// FAIL-CLOSED: the in-memory simulation backend is DEV/CI ONLY. When
// ENVIRONMENT, APP_ENV, or NODE_ENV is "production", boot is refused unless
// the explicit dev opt-in TB_ALLOW_SIM_BACKEND=1 is set. Production must run
// the LiveBackend (build tag `tigerbeetle`, see Dockerfile.production).
func NewBackend(tbAddr string, clusterID uint64) (Backend, error) {
	env := strings.ToLower(firstNonEmpty(
		os.Getenv("ENVIRONMENT"), os.Getenv("APP_ENV"), os.Getenv("NODE_ENV"),
	))
	simOK := os.Getenv("TB_ALLOW_SIM_BACKEND")
	if env == "production" && simOK != "1" {
		return nil, fmt.Errorf(
			"tigerbeetle-bridge: SIM backend is dev-only and refuses to boot in production " +
				"(ENVIRONMENT/APP_ENV/NODE_ENV=production). Build with -tags tigerbeetle for the " +
				"live TigerBeetle backend, or set TB_ALLOW_SIM_BACKEND=1 for local development only")
	}
	if simOK == "1" {
		fmt.Fprintln(os.Stderr, "[TB] WARNING: DEV-ONLY in-memory SimBackend in use (TB_ALLOW_SIM_BACKEND=1) — NOT for production")
	}
	s := &SimBackend{
		accounts:  make(map[string]*Account),
		transfers: make(map[string]*Transfer),
	}
	for _, a := range StandardAccounts() {
		acct := a // copy
		acct.CreatedAt = time.Now().UTC()
		s.accounts[acct.ID] = &acct
	}
	return s, nil
}

func (s *SimBackend) Mode() string { return "simulation" }
func (s *SimBackend) Close()       {}

func (s *SimBackend) CreateAccount(a *Account) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.accounts[a.ID]; exists {
		// Idempotent — treat as success (mirrors TigerBeetle AccountExists behaviour)
		return nil
	}
	a.CreatedAt = time.Now().UTC()
	s.accounts[a.ID] = a
	return nil
}

func (s *SimBackend) GetAccount(id string) (*Account, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	a, ok := s.accounts[id]
	return a, ok
}

func (s *SimBackend) PostTransfer(t *Transfer) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	debit, ok := s.accounts[t.DebitAccountID]
	if !ok {
		return fmt.Errorf("debit account %s not found", t.DebitAccountID)
	}
	credit, ok := s.accounts[t.CreditAccountID]
	if !ok {
		return fmt.Errorf("credit account %s not found", t.CreditAccountID)
	}

	now := time.Now().UTC()
	t.CreatedAt = now
	t.Timestamp = now.UnixNano()

	switch t.Flag {
	case FlagPending:
		debit.DebitsPending += t.Amount
		credit.CreditsPending += t.Amount
		t.Status = "PENDING"

	case FlagPostPendingTransfer:
		pending, ok := s.transfers[t.PendingID]
		if !ok {
			return fmt.Errorf("pending transfer %s not found", t.PendingID)
		}
		pendingDebit := s.accounts[pending.DebitAccountID]
		pendingCredit := s.accounts[pending.CreditAccountID]
		pendingDebit.DebitsPending -= pending.Amount
		pendingCredit.CreditsPending -= pending.Amount
		debit.DebitsPosted += t.Amount
		credit.CreditsPosted += t.Amount
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
		pendingDebit.DebitsPending -= pending.Amount
		pendingCredit.CreditsPending -= pending.Amount
		t.Status = "VOIDED"
		voided := now
		t.VoidedAt = &voided
		pending.Status = "VOIDED"
		pending.VoidedAt = &voided

	default: // FlagNone — immediate transfer
		debit.DebitsPosted += t.Amount
		credit.CreditsPosted += t.Amount
		t.Status = "POSTED"
		posted := now
		t.PostedAt = &posted
	}

	s.transfers[t.ID] = t
	return nil
}

func (s *SimBackend) GetTransfer(id string) (*Transfer, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.transfers[id]
	return t, ok
}

func (s *SimBackend) GetTransfersByAccount(accountID string, limit int) []*Transfer {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*Transfer
	for _, t := range s.transfers {
		if t.DebitAccountID == accountID || t.CreditAccountID == accountID {
			result = append(result, t)
			if len(result) >= limit {
				break
			}
		}
	}
	return result
}

func (s *SimBackend) GetAllAccounts() []*Account {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*Account, 0, len(s.accounts))
	for _, a := range s.accounts {
		result = append(result, a)
	}
	return result
}

func (s *SimBackend) GetRecentTransfers(limit int) []*Transfer {
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
