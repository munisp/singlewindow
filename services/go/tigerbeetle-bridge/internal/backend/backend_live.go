//go:build tigerbeetle

// LiveBackend is the production TigerBeetle backend.
// It is compiled ONLY when the `tigerbeetle` build tag is set:
//
//	CGO_ENABLED=1 go build -tags tigerbeetle ./...
//
// This requires:
//  1. The TigerBeetle binary installed on the build host (the Go client
//     embeds the TB C library via CGo and compiles it at build time).
//  2. A running TigerBeetle cluster reachable at TIGERBEETLE_ADDR.
//
// In production Kubernetes, the Dockerfile.production handles this automatically.
// In development/CI, the !tigerbeetle SimBackend is used instead.
package backend

import (
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"sync"
	"time"

	tb "github.com/tigerbeetle/tigerbeetle-go"
	tb_types "github.com/tigerbeetle/tigerbeetle-go/pkg/types"
	"go.uber.org/zap"
)

// LiveBackend wraps the official tigerbeetle-go client.
// It maintains a local metadata cache (descriptions, currency, flags) because
// TigerBeetle only stores numeric fields — human-readable metadata lives here.
type LiveBackend struct {
	client       tb.Client
	logger       *zap.Logger
	mu           sync.RWMutex
	accountMeta  map[string]*Account  // keyed by hex ID string
	transferMeta map[string]*Transfer // keyed by hex ID string
}

// NewBackend connects to the TigerBeetle cluster and seeds standard accounts.
// Returns an error if the connection fails — caller should fall back to SimBackend.
func NewBackend(tbAddr string, clusterID uint64) (Backend, error) {
	logger, _ := zap.NewProduction()
	client, err := tb.NewClient(tb_types.ToUint128(clusterID), []string{tbAddr})
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle NewClient(%s): %w", tbAddr, err)
	}
	b := &LiveBackend{
		client:       client,
		logger:       logger,
		accountMeta:  make(map[string]*Account),
		transferMeta: make(map[string]*Transfer),
	}
	if err := b.seedStandardAccounts(); err != nil {
		// Non-fatal: accounts may already exist (AccountExists is idempotent)
		logger.Warn("seed accounts warning", zap.Error(err))
	}
	logger.Info("TigerBeetle LIVE backend connected",
		zap.String("addr", tbAddr),
		zap.Uint64("clusterId", clusterID))
	return b, nil
}

func (b *LiveBackend) Mode() string { return "live" }
func (b *LiveBackend) Close()       { b.client.Close() }

// ─── ID conversion helpers ────────────────────────────────────────────────────

// hexToUint128 converts a 16-char hex string (or decimal string) to Uint128.
func hexToUint128(id string) (tb_types.Uint128, error) {
	clean := strings.TrimPrefix(id, "0x")
	n, err := strconv.ParseUint(clean, 16, 64)
	if err != nil {
		// Try decimal
		n2, err2 := strconv.ParseUint(id, 10, 64)
		if err2 != nil {
			return tb_types.Uint128{}, fmt.Errorf("invalid id %q", id)
		}
		return tb_types.ToUint128(n2), nil
	}
	return tb_types.ToUint128(n), nil
}

// uint128ToHex converts a Uint128 to a 16-char lowercase hex string.
func uint128ToHex(u tb_types.Uint128) string {
	bi := u.BigInt()
	return fmt.Sprintf("%016x", bi.Uint64())
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

func (b *LiveBackend) seedStandardAccounts() error {
	standard := StandardAccounts()
	tbAccounts := make([]tb_types.Account, 0, len(standard))
	for _, s := range standard {
		id, err := hexToUint128(s.ID)
		if err != nil {
			continue
		}
		tbAccounts = append(tbAccounts, tb_types.Account{
			ID:     id,
			Ledger: s.Ledger,
			Code:   s.Code,
			// History flag enables GetAccountTransfers / GetAccountBalances
			Flags: tb_types.AccountFlags{History: true}.ToUint16(),
		})
		acct := s // copy
		acct.CreatedAt = time.Now().UTC()
		b.mu.Lock()
		b.accountMeta[s.ID] = &acct
		b.mu.Unlock()
	}

	results, err := b.client.CreateAccounts(tbAccounts)
	if err != nil {
		return err
	}
	for _, r := range results {
		if r.Result != tb_types.AccountExists {
			b.logger.Warn("seed account non-idempotent error",
				zap.Uint32("index", r.Index),
				zap.String("result", r.Result.String()))
		}
	}
	return nil
}

// ─── Backend implementation ───────────────────────────────────────────────────

func (b *LiveBackend) CreateAccount(a *Account) error {
	id, err := hexToUint128(a.ID)
	if err != nil {
		return err
	}
	tbAcc := tb_types.Account{
		ID:     id,
		Ledger: a.Ledger,
		Code:   a.Code,
		Flags:  tb_types.AccountFlags{History: true}.ToUint16(),
	}
	results, err := b.client.CreateAccounts([]tb_types.Account{tbAcc})
	if err != nil {
		return fmt.Errorf("CreateAccounts: %w", err)
	}
	for _, r := range results {
		if r.Result != tb_types.AccountExists {
			return fmt.Errorf("CreateAccount error at index %d: %s", r.Index, r.Result)
		}
	}
	a.CreatedAt = time.Now().UTC()
	b.mu.Lock()
	b.accountMeta[a.ID] = a
	b.mu.Unlock()
	return nil
}

func (b *LiveBackend) GetAccount(id string) (*Account, bool) {
	tbID, err := hexToUint128(id)
	if err != nil {
		return nil, false
	}
	accounts, err := b.client.LookupAccounts([]tb_types.Uint128{tbID})
	if err != nil || len(accounts) == 0 {
		return nil, false
	}
	acc := accounts[0]
	b.mu.RLock()
	meta := b.accountMeta[id]
	b.mu.RUnlock()

	result := &Account{
		ID:             id,
		Ledger:         acc.Ledger,
		Code:           acc.Code,
		DebitsPosted:   bigIntToMinor(acc.DebitsPosted.BigInt()),
		CreditsPosted:  bigIntToMinor(acc.CreditsPosted.BigInt()),
		DebitsPending:  bigIntToMinor(acc.DebitsPending.BigInt()),
		CreditsPending: bigIntToMinor(acc.CreditsPending.BigInt()),
		Currency:       "GHS",
	}
	if meta != nil {
		result.AccountType = meta.AccountType
		result.Description = meta.Description
		result.Currency = meta.Currency
		result.CreatedAt = meta.CreatedAt
	}
	return result, true
}

func (b *LiveBackend) PostTransfer(t *Transfer) error {
	debitID, err := hexToUint128(t.DebitAccountID)
	if err != nil {
		return fmt.Errorf("invalid debit account id: %w", err)
	}
	creditID, err := hexToUint128(t.CreditAccountID)
	if err != nil {
		return fmt.Errorf("invalid credit account id: %w", err)
	}
	transferID, err := hexToUint128(t.ID)
	if err != nil {
		return fmt.Errorf("invalid transfer id: %w", err)
	}

	tbTransfer := tb_types.Transfer{
		ID:              transferID,
		DebitAccountID:  debitID,
		CreditAccountID: creditID,
		Amount:          tb_types.ToUint128(uint64(t.Amount)),
		Ledger:          t.Ledger,
		Code:            t.Code,
	}

	now := time.Now().UTC()
	switch t.Flag {
	case FlagPending:
		tbTransfer.Flags = tb_types.TransferFlags{Pending: true}.ToUint16()
		t.Status = "PENDING"
	case FlagPostPendingTransfer:
		pendingID, err := hexToUint128(t.PendingID)
		if err != nil {
			return fmt.Errorf("invalid pending id: %w", err)
		}
		tbTransfer.PendingID = pendingID
		tbTransfer.Flags = tb_types.TransferFlags{PostPendingTransfer: true}.ToUint16()
		t.Status = "POSTED"
		t.PostedAt = &now
	case FlagVoidPendingTransfer:
		pendingID, err := hexToUint128(t.PendingID)
		if err != nil {
			return fmt.Errorf("invalid pending id: %w", err)
		}
		tbTransfer.PendingID = pendingID
		tbTransfer.Flags = tb_types.TransferFlags{VoidPendingTransfer: true}.ToUint16()
		t.Status = "VOIDED"
		t.VoidedAt = &now
	default:
		t.Status = "POSTED"
		t.PostedAt = &now
	}

	results, err := b.client.CreateTransfers([]tb_types.Transfer{tbTransfer})
	if err != nil {
		return fmt.Errorf("CreateTransfers: %w", err)
	}
	for _, r := range results {
		return fmt.Errorf("transfer error at index %d: %s", r.Index, r.Result)
	}

	t.CreatedAt = now
	t.Timestamp = now.UnixNano()
	b.mu.Lock()
	b.transferMeta[t.ID] = t
	b.mu.Unlock()
	return nil
}

func (b *LiveBackend) GetTransfer(id string) (*Transfer, bool) {
	tbID, err := hexToUint128(id)
	if err != nil {
		return nil, false
	}
	transfers, err := b.client.LookupTransfers([]tb_types.Uint128{tbID})
	if err != nil || len(transfers) == 0 {
		// Fall back to metadata cache
		b.mu.RLock()
		t, ok := b.transferMeta[id]
		b.mu.RUnlock()
		return t, ok
	}
	raw := transfers[0]
	b.mu.RLock()
	meta := b.transferMeta[id]
	b.mu.RUnlock()

	result := &Transfer{
		ID:              uint128ToHex(raw.ID),
		DebitAccountID:  uint128ToHex(raw.DebitAccountID),
		CreditAccountID: uint128ToHex(raw.CreditAccountID),
		Amount:          bigIntToMinor(raw.Amount.BigInt()),
		Ledger:          raw.Ledger,
		Code:            raw.Code,
		Timestamp:       int64(raw.Timestamp),
		Status:          "POSTED",
		Currency:        "GHS",
	}
	if meta != nil {
		result.Currency = meta.Currency
		result.Reference = meta.Reference
		result.Description = meta.Description
		result.Flag = meta.Flag
		result.PendingID = meta.PendingID
		result.CreatedAt = meta.CreatedAt
		result.PostedAt = meta.PostedAt
		result.VoidedAt = meta.VoidedAt
		result.Status = meta.Status
	}
	return result, true
}

func (b *LiveBackend) GetTransfersByAccount(accountID string, limit int) []*Transfer {
	b.mu.RLock()
	defer b.mu.RUnlock()
	var result []*Transfer
	for _, t := range b.transferMeta {
		if t.DebitAccountID == accountID || t.CreditAccountID == accountID {
			result = append(result, t)
			if len(result) >= limit {
				break
			}
		}
	}
	return result
}

func (b *LiveBackend) GetAllAccounts() []*Account {
	b.mu.RLock()
	ids := make([]tb_types.Uint128, 0, len(b.accountMeta))
	idStrs := make([]string, 0, len(b.accountMeta))
	for id := range b.accountMeta {
		tbID, err := hexToUint128(id)
		if err == nil {
			ids = append(ids, tbID)
			idStrs = append(idStrs, id)
		}
	}
	b.mu.RUnlock()

	accounts, err := b.client.LookupAccounts(ids)
	if err != nil || len(accounts) == 0 {
		// Return metadata cache on TB error
		b.mu.RLock()
		result := make([]*Account, 0, len(b.accountMeta))
		for _, a := range b.accountMeta {
			result = append(result, a)
		}
		b.mu.RUnlock()
		return result
	}

	b.mu.RLock()
	result := make([]*Account, 0, len(accounts))
	for _, acc := range accounts {
		id := uint128ToHex(acc.ID)
		meta := b.accountMeta[id]
		a := &Account{
			ID:             id,
			Ledger:         acc.Ledger,
			Code:           acc.Code,
			DebitsPosted:   bigIntToMinor(acc.DebitsPosted.BigInt()),
			CreditsPosted:  bigIntToMinor(acc.CreditsPosted.BigInt()),
			DebitsPending:  bigIntToMinor(acc.DebitsPending.BigInt()),
			CreditsPending: bigIntToMinor(acc.CreditsPending.BigInt()),
			Currency:       "GHS",
		}
		if meta != nil {
			a.AccountType = meta.AccountType
			a.Description = meta.Description
			a.Currency = meta.Currency
			a.CreatedAt = meta.CreatedAt
		}
		result = append(result, a)
	}
	b.mu.RUnlock()
	return result
}

func (b *LiveBackend) GetRecentTransfers(limit int) []*Transfer {
	b.mu.RLock()
	defer b.mu.RUnlock()
	result := make([]*Transfer, 0, len(b.transferMeta))
	for _, t := range b.transferMeta {
		result = append(result, t)
	}
	if len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// bigIntToMinor converts a *big.Int (TigerBeetle Uint128 value) to int64.
// TigerBeetle stores amounts as 128-bit unsigned integers; we use the lower 64 bits.
func bigIntToMinor(bi big.Int) int64 {
	return bi.Int64()
}
