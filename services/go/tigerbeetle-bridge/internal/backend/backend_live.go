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
//
// Phase-9 WP-B:
//   - tigerbeetle-go bumped to v0.17.9; the v0.17 contract returns SUCCESS
//     results (TransferCreated / AccountCreated = 0xFFFFFFFF) in the result
//     set — they are accepted explicitly, never misreported as errors.
//   - hexToUint128 now parses full 128-bit hex ids (incl. the bridge's own
//     uuid-form transfer ids) — previously any id longer than 64 bits failed.
//   - The restart-fragile metadata cache is rehydrated from TigerBeetle:
//     account metadata is re-validated against the cluster at startup and
//     GetTransfersByAccount/GetRecentTransfers serve REAL cluster history
//     (accounts are created with the History flag) instead of the
//     process-local cache. Metadata TigerBeetle cannot store (free-text
//     description) is served from the cache when present and honestly empty
//     otherwise — never fabricated.
package backend

import (
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"sync"
	"time"

	tb "github.com/tigerbeetle/tigerbeetle-go"
	"go.uber.org/zap"
)

// LiveBackend wraps the official tigerbeetle-go client.
// It maintains a local metadata cache (descriptions, currency, flags) because
// TigerBeetle only stores numeric fields — human-readable metadata lives here.
// The cache is advisory: after a restart, balances and transfer history are
// ALWAYS re-read from the cluster; missing metadata is served honestly empty.
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
	client, err := tb.NewClient(tb.ToUint128(clusterID), []string{tbAddr})
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
	// Rehydrate: confirm every cached account still exists in the cluster and
	// drop cache entries that do not (restart-fragility fix — the cache must
	// never assert accounts the ledger does not hold).
	if err := b.rehydrateAccountMeta(); err != nil {
		logger.Warn("account metadata rehydration failed (fail-open: balances still read live)",
			zap.Error(err))
	}
	logger.Info("TigerBeetle LIVE backend connected",
		zap.String("addr", tbAddr),
		zap.Uint64("clusterId", clusterID))
	return b, nil
}

func (b *LiveBackend) Mode() string { return "live" }
func (b *LiveBackend) Close()       { b.client.Close() }

// ─── ID conversion helpers ────────────────────────────────────────────────────

// hexToUint128 converts an id string to Uint128. Accepted forms:
//   - hex (optionally 0x-prefixed), 1–32 chars — full 128-bit ids supported;
//   - uuid form (32 hex chars with dashes) — the bridge's own generated ids;
//   - decimal string (legacy 64-bit ids).
func hexToUint128(id string) (tb.Uint128, error) {
	clean := strings.TrimPrefix(id, "0x")
	clean = strings.ReplaceAll(clean, "-", "") // uuid form
	if len(clean) >= 1 && len(clean) <= 32 && isHex(clean) {
		return tb.HexStringToUint128(clean)
	}
	// Legacy decimal fallback.
	if n, err := strconv.ParseUint(id, 10, 64); err == nil {
		return tb.ToUint128(n), nil
	}
	return tb.Uint128{}, fmt.Errorf("invalid id %q", id)
}

func isHex(s string) bool {
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}

// uint128ToHex renders a Uint128 as lowercase hex: 32 chars when the upper
// 64 bits are set (uuid-derived ids), 16 chars otherwise (preserves the
// standard account id format "0000000000000001").
func uint128ToHex(u tb.Uint128) string {
	bi := u.BigInt()
	if bi.BitLen() > 64 {
		return fmt.Sprintf("%032x", bi)
	}
	return fmt.Sprintf("%016x", bi.Uint64())
}

// canonicalID normalizes an id string to the uint128ToHex form so metadata
// lookups hit the same key regardless of input spelling (uuid vs hex).
func canonicalID(id string) string {
	u, err := hexToUint128(id)
	if err != nil {
		return id
	}
	return uint128ToHex(u)
}

// ─── Seeding & rehydration ────────────────────────────────────────────────────

func (b *LiveBackend) seedStandardAccounts() error {
	standard := StandardAccounts()
	tbAccounts := make([]tb.Account, 0, len(standard))
	for _, s := range standard {
		id, err := hexToUint128(s.ID)
		if err != nil {
			continue
		}
		tbAccounts = append(tbAccounts, tb.Account{
			ID:     id,
			Ledger: s.Ledger,
			Code:   s.Code,
			// History flag enables GetAccountTransfers / GetAccountBalances
			Flags: tb.AccountFlags{History: true}.ToUint16(),
		})
		acct := s // copy
		acct.CreatedAt = time.Now().UTC()
		b.mu.Lock()
		b.accountMeta[canonicalID(s.ID)] = &acct
		b.mu.Unlock()
	}

	results, err := b.client.CreateAccounts(tbAccounts)
	if err != nil {
		return err
	}
	for _, r := range results {
		// v0.17.9 contract: success results are included (AccountCreated).
		if r.Status == tb.AccountCreated || r.Status == tb.AccountExists {
			continue
		}
		b.logger.Warn("seed account non-idempotent error",
			zap.String("result", r.Status.String()))
	}
	return nil
}

// rehydrateAccountMeta validates the metadata cache against the cluster at
// startup: cached accounts that do not exist in TigerBeetle are dropped
// (stale after a cluster rebuild); existing ones are kept (balances are
// always read live, so only metadata is cached).
func (b *LiveBackend) rehydrateAccountMeta() error {
	b.mu.RLock()
	ids := make([]tb.Uint128, 0, len(b.accountMeta))
	keys := make([]string, 0, len(b.accountMeta))
	for key := range b.accountMeta {
		tbID, err := hexToUint128(key)
		if err == nil {
			ids = append(ids, tbID)
			keys = append(keys, key)
		}
	}
	b.mu.RUnlock()
	if len(ids) == 0 {
		return nil
	}
	accounts, err := b.client.LookupAccounts(ids)
	if err != nil {
		return fmt.Errorf("rehydrate lookup: %w", err)
	}
	present := make(map[string]bool, len(accounts))
	for _, acc := range accounts {
		present[uint128ToHex(acc.ID)] = true
	}
	b.mu.Lock()
	for _, key := range keys {
		if !present[canonicalID(key)] {
			b.logger.Warn("dropping stale cached account metadata (not in cluster)", zap.String("id", key))
			delete(b.accountMeta, key)
		}
	}
	b.mu.Unlock()
	return nil
}

// ─── Backend implementation ───────────────────────────────────────────────────

func (b *LiveBackend) CreateAccount(a *Account) error {
	id, err := hexToUint128(a.ID)
	if err != nil {
		return err
	}
	tbAcc := tb.Account{
		ID:     id,
		Ledger: a.Ledger,
		Code:   a.Code,
		Flags:  tb.AccountFlags{History: true}.ToUint16(),
	}
	results, err := b.client.CreateAccounts([]tb.Account{tbAcc})
	if err != nil {
		return fmt.Errorf("CreateAccounts: %w", err)
	}
	for _, r := range results {
		// v0.17.9 contract: AccountCreated is a success result; AccountExists
		// is the idempotent replay.
		if r.Status == tb.AccountCreated || r.Status == tb.AccountExists {
			continue
		}
		return fmt.Errorf("CreateAccount error: %s", r.Status)
	}
	a.CreatedAt = time.Now().UTC()
	b.mu.Lock()
	b.accountMeta[canonicalID(a.ID)] = a
	b.mu.Unlock()
	return nil
}

func (b *LiveBackend) GetAccount(id string) (*Account, bool) {
	tbID, err := hexToUint128(id)
	if err != nil {
		return nil, false
	}
	accounts, err := b.client.LookupAccounts([]tb.Uint128{tbID})
	if err != nil || len(accounts) == 0 {
		return nil, false
	}
	acc := accounts[0]
	b.mu.RLock()
	meta := b.accountMeta[canonicalID(id)]
	b.mu.RUnlock()

	result := &Account{
		ID:             canonicalID(id),
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

	tbTransfer := tb.Transfer{
		ID:              transferID,
		DebitAccountID:  debitID,
		CreditAccountID: creditID,
		Amount:          tb.ToUint128(uint64(t.Amount)),
		Ledger:          t.Ledger,
		Code:            t.Code,
	}

	now := time.Now().UTC()
	switch t.Flag {
	case FlagPending:
		tbTransfer.Flags = tb.TransferFlags{Pending: true}.ToUint16()
		t.Status = "PENDING"
	case FlagPostPendingTransfer:
		pendingID, err := hexToUint128(t.PendingID)
		if err != nil {
			return fmt.Errorf("invalid pending id: %w", err)
		}
		tbTransfer.PendingID = pendingID
		tbTransfer.Flags = tb.TransferFlags{PostPendingTransfer: true}.ToUint16()
		t.Status = "POSTED"
		t.PostedAt = &now
	case FlagVoidPendingTransfer:
		pendingID, err := hexToUint128(t.PendingID)
		if err != nil {
			return fmt.Errorf("invalid pending id: %w", err)
		}
		tbTransfer.PendingID = pendingID
		tbTransfer.Flags = tb.TransferFlags{VoidPendingTransfer: true}.ToUint16()
		t.Status = "VOIDED"
		t.VoidedAt = &now
	default:
		t.Status = "POSTED"
		t.PostedAt = &now
	}

	results, err := b.client.CreateTransfers([]tb.Transfer{tbTransfer})
	if err != nil {
		return fmt.Errorf("CreateTransfers: %w", err)
	}
	for _, r := range results {
		// v0.17.9 contract: TransferCreated is a SUCCESS result and must not
		// be misreported as an error.
		if r.Status == tb.TransferCreated {
			continue
		}
		return fmt.Errorf("transfer error: %s", r.Status)
	}

	t.CreatedAt = now
	t.Timestamp = now.UnixNano()
	b.mu.Lock()
	b.transferMeta[canonicalID(t.ID)] = t
	b.mu.Unlock()
	return nil
}

func (b *LiveBackend) GetTransfer(id string) (*Transfer, bool) {
	tbID, err := hexToUint128(id)
	if err != nil {
		return nil, false
	}
	transfers, err := b.client.LookupTransfers([]tb.Uint128{tbID})
	if err != nil || len(transfers) == 0 {
		// Fall back to metadata cache
		b.mu.RLock()
		t, ok := b.transferMeta[canonicalID(id)]
		b.mu.RUnlock()
		return t, ok
	}
	raw := transfers[0]
	return b.transferFromTB(raw), true
}

// transferFromTB converts a cluster Transfer to the API shape, enriching it
// with cached metadata when present (reference/description/currency are not
// stored in TigerBeetle).
func (b *LiveBackend) transferFromTB(raw tb.Transfer) *Transfer {
	id := uint128ToHex(raw.ID)
	b.mu.RLock()
	meta := b.transferMeta[id]
	b.mu.RUnlock()

	result := &Transfer{
		ID:              id,
		DebitAccountID:  uint128ToHex(raw.DebitAccountID),
		CreditAccountID: uint128ToHex(raw.CreditAccountID),
		Amount:          bigIntToMinor(raw.Amount.BigInt()),
		Ledger:          raw.Ledger,
		Code:            raw.Code,
		Timestamp:       int64(raw.Timestamp),
		Status:          "POSTED",
		Currency:        "GHS",
	}
	pendingFlag := tb.TransferFlags{Pending: true}.ToUint16()
	if raw.Flags&pendingFlag != 0 {
		result.Status = "PENDING"
		result.Flag = FlagPending
	}
	if raw.PendingID.BigInt().Sign() != 0 {
		result.PendingID = uint128ToHex(raw.PendingID)
	}
	if meta != nil {
		result.Currency = meta.Currency
		result.Reference = meta.Reference
		result.Description = meta.Description
		if meta.Status != "" {
			result.Status = meta.Status
		}
		if meta.Flag != "" {
			result.Flag = meta.Flag
		}
		result.CreatedAt = meta.CreatedAt
		result.PostedAt = meta.PostedAt
		result.VoidedAt = meta.VoidedAt
	}
	return result
}

// GetTransfersByAccount serves REAL cluster history via GetAccountTransfers
// (accounts carry the History flag) — survives restarts, never depends on the
// process-local cache. Falls back to the cache only if the cluster query
// fails.
func (b *LiveBackend) GetTransfersByAccount(accountID string, limit int) []*Transfer {
	tbID, err := hexToUint128(accountID)
	if err != nil {
		return nil
	}
	if limit <= 0 {
		limit = 100
	}
	transfers, err := b.client.GetAccountTransfers(tb.AccountFilter{
		AccountID: tbID,
		Limit:     uint32(limit),
		Flags: tb.AccountFilterFlags{
			Debits:   true,
			Credits:  true,
			Reversed: true, // most recent first
		}.ToUint32(),
	})
	if err == nil {
		result := make([]*Transfer, 0, len(transfers))
		for _, raw := range transfers {
			result = append(result, b.transferFromTB(raw))
		}
		return result
	}
	b.logger.Warn("GetAccountTransfers failed, falling back to metadata cache",
		zap.String("account", accountID), zap.Error(err))
	b.mu.RLock()
	defer b.mu.RUnlock()
	var result []*Transfer
	for _, t := range b.transferMeta {
		if canonicalID(t.DebitAccountID) == canonicalID(accountID) || canonicalID(t.CreditAccountID) == canonicalID(accountID) {
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
	ids := make([]tb.Uint128, 0, len(b.accountMeta))
	for id := range b.accountMeta {
		tbID, err := hexToUint128(id)
		if err == nil {
			ids = append(ids, tbID)
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

// GetRecentTransfers serves the most recent transfers across the cluster via
// QueryTransfers (reversed), falling back to the metadata cache on error.
func (b *LiveBackend) GetRecentTransfers(limit int) []*Transfer {
	if limit <= 0 {
		limit = 100
	}
	transfers, err := b.client.QueryTransfers(tb.QueryFilter{
		Limit: uint32(limit),
		Flags: tb.QueryFilterFlags{Reversed: true}.ToUint32(),
	})
	if err == nil {
		result := make([]*Transfer, 0, len(transfers))
		for _, raw := range transfers {
			result = append(result, b.transferFromTB(raw))
		}
		return result
	}
	b.logger.Warn("QueryTransfers failed, falling back to metadata cache", zap.Error(err))
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
func bigIntToMinor(bi *big.Int) int64 {
	return bi.Int64()
}
