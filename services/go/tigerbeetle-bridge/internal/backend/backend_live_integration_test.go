//go:build tigerbeetle

// Live-TB-gated integration tests for the singlewindow ledger paths:
// account provisioning, transfer creation (immediate + two-phase
// pending/post), and idempotency replay — against a REAL local TigerBeetle
// 0.17.9 cluster.
//
// Gate: TIGERBEETLE_TEST_ADDRESS (e.g. 127.0.0.1:3000). Unset = honest skip
// with the documented environment blockers (io_uring seccomp + 4GB OOM on
// this verification host — see blueeconomy-review LOCAL_STACK.md).
package backend

import (
	"fmt"
	"os"
	"testing"
	"time"
)

func liveBackend(t *testing.T) *LiveBackend {
	t.Helper()
	addr := os.Getenv("TIGERBEETLE_TEST_ADDRESS")
	if addr == "" {
		t.Skip("TIGERBEETLE_TEST_ADDRESS not set — skipping live-TB integration test " +
			"(documented environment blockers: io_uring seccomp + 4GB OOM; run against a real " +
			"0.17.9 cluster where available)")
	}
	be, err := NewBackend(addr, 0)
	if err != nil {
		t.Skipf("TigerBeetle cluster at %s unreachable: %v — skipping live test", addr, err)
	}
	lb := be.(*LiveBackend)
	t.Cleanup(lb.Close)
	return lb
}

func TestLiveAccountProvisioning(t *testing.T) {
	lb := liveBackend(t)
	id := fmt.Sprintf("%016x", uint64(time.Now().UnixNano())&0xFFFFFFFFFFFF)
	acct := &Account{
		ID:          id,
		AccountType: "trader_liability",
		Description: "live test account",
		Ledger:      1,
		Code:        10,
		Currency:    "GHS",
	}
	if err := lb.CreateAccount(acct); err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}
	got, ok := lb.GetAccount(id)
	if !ok {
		t.Fatalf("GetAccount(%s) not found after create", id)
	}
	if got.Ledger != 1 || got.Code != 10 || got.Description != "live test account" {
		t.Fatalf("account mismatch: %+v", got)
	}
	// Idempotent replay: re-creating the same account must succeed (AccountExists).
	if err := lb.CreateAccount(acct); err != nil {
		t.Fatalf("idempotent account replay must succeed: %v", err)
	}
}

func TestLiveTransferCreateAndIdempotentReplay(t *testing.T) {
	lb := liveBackend(t)
	nonce := uint64(time.Now().UnixNano()) & 0xFFFFFFFFFFFF
	debitID := fmt.Sprintf("%016x", nonce|0x10000)
	creditID := fmt.Sprintf("%016x", nonce|0x20000)
	for i, id := range []string{debitID, creditID} {
		if err := lb.CreateAccount(&Account{ID: id, AccountType: "test", Description: "live", Ledger: 1, Code: uint16(20 + i), Currency: "GHS"}); err != nil {
			t.Fatalf("CreateAccount %s: %v", id, err)
		}
	}
	// Fund the debit account from the seeded trader liability account.
	fundID := fmt.Sprintf("f%015x", nonce)
	if err := lb.PostTransfer(&Transfer{
		ID: fundID, DebitAccountID: "0000000000000001", CreditAccountID: debitID,
		Amount: 100000, Ledger: 1, Code: 1, Currency: "GHS",
	}); err != nil {
		t.Fatalf("funding transfer: %v", err)
	}

	// Immediate transfer.
	txID := fmt.Sprintf("a%015x", nonce)
	tx := &Transfer{
		ID: txID, DebitAccountID: debitID, CreditAccountID: creditID,
		Amount: 2500, Ledger: 1, Code: 1, Currency: "GHS", Reference: "LIVE-1",
	}
	if err := lb.PostTransfer(tx); err != nil {
		t.Fatalf("PostTransfer: %v", err)
	}
	// Idempotency replay: SAME id + same fields must succeed (TransferExists
	// is NOT returned for an identical replay — TigerBeetle treats it as a
	// duplicate success in v0.17); a CONFLICTING replay must fail.
	if err := lb.PostTransfer(tx); err != nil {
		t.Fatalf("identical transfer replay must be idempotent-ok: %v", err)
	}
	conflict := *tx
	conflict.Amount = 9999
	if err := lb.PostTransfer(&conflict); err == nil {
		t.Fatal("conflicting transfer replay must be rejected (exists_with_different_flags/amount)")
	}

	got, ok := lb.GetTransfer(txID)
	if !ok {
		t.Fatalf("GetTransfer(%s) not found", txID)
	}
	if got.Amount != 2500 || got.DebitAccountID != debitID || got.CreditAccountID != creditID {
		t.Fatalf("transfer mismatch: %+v", got)
	}

	// Two-phase: pending reserve then post.
	pendID := fmt.Sprintf("b%015x", nonce)
	if err := lb.PostTransfer(&Transfer{
		ID: pendID, DebitAccountID: debitID, CreditAccountID: creditID,
		Amount: 1000, Ledger: 1, Code: 1, Currency: "GHS", Flag: FlagPending,
	}); err != nil {
		t.Fatalf("pending transfer: %v", err)
	}
	postID := fmt.Sprintf("c%015x", nonce)
	if err := lb.PostTransfer(&Transfer{
		ID: postID, DebitAccountID: debitID, CreditAccountID: creditID,
		Amount: 1000, Ledger: 1, Code: 1, Currency: "GHS",
		Flag: FlagPostPendingTransfer, PendingID: pendID,
	}); err != nil {
		t.Fatalf("post pending transfer: %v", err)
	}

	// Cluster history must serve the account's transfers (restart-safe path).
	history := lb.GetTransfersByAccount(creditID, 50)
	if len(history) < 3 {
		t.Fatalf("expected >=3 transfers in cluster history, got %d", len(history))
	}
	seen := map[string]bool{}
	for _, h := range history {
		seen[h.ID] = true
	}
	for _, want := range []string{txID, pendID, postID} {
		if !seen[want] {
			t.Fatalf("transfer %s missing from cluster history: %v", want, seen)
		}
	}
}

// TestLiveUUIDTransferIDs — the bridge's HTTP layer generates uuid transfer
// ids; the v0.17.9 backend must accept them (previously rejected by the
// 64-bit hex parser).
func TestLiveUUIDTransferIDs(t *testing.T) {
	lb := liveBackend(t)
	nonce := uint64(time.Now().UnixNano()) & 0xFFFFFFFFFFFF
	debitID := fmt.Sprintf("%016x", nonce|0x30000)
	creditID := fmt.Sprintf("%016x", nonce|0x40000)
	for i, id := range []string{debitID, creditID} {
		if err := lb.CreateAccount(&Account{ID: id, AccountType: "test", Description: "live", Ledger: 1, Code: uint16(30 + i), Currency: "GHS"}); err != nil {
			t.Fatalf("CreateAccount %s: %v", id, err)
		}
	}
	if err := lb.PostTransfer(&Transfer{
		ID: fmt.Sprintf("d%015x", nonce), DebitAccountID: "0000000000000001", CreditAccountID: debitID,
		Amount: 5000, Ledger: 1, Code: 1, Currency: "GHS",
	}); err != nil {
		t.Fatalf("funding: %v", err)
	}
	uuidID := fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", uint32(nonce), 0x1111, 0x4222, 0x8333, nonce&0xFFFFFFFFFFFF)
	if err := lb.PostTransfer(&Transfer{
		ID: uuidID, DebitAccountID: debitID, CreditAccountID: creditID,
		Amount: 700, Ledger: 1, Code: 1, Currency: "GHS",
	}); err != nil {
		t.Fatalf("uuid-id transfer rejected (128-bit parse regression): %v", err)
	}
	got, ok := lb.GetTransfer(uuidID)
	if !ok {
		t.Fatalf("GetTransfer(%s) not found", uuidID)
	}
	if got.Amount != 700 {
		t.Fatalf("uuid transfer mismatch: %+v", got)
	}
}
