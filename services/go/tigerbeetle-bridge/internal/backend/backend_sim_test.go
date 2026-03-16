//go:build !tigerbeetle

package backend_test

import (
	"fmt"
	"testing"

	"github.com/tradegateway/tigerbeetle-bridge/internal/backend"
)

// newSim creates a fresh simulation backend for each test.
func newSim(t *testing.T) backend.Backend {
	t.Helper()
	// Empty tbAddr → simulation mode (NewBackend ignores the address when !tigerbeetle build tag)
	b, err := backend.NewBackend("", 0)
	if err != nil {
		t.Fatalf("backend.NewBackend: %v", err)
	}
	return b
}

// ─── Mode ─────────────────────────────────────────────────────────────────────

func TestMode_IsSimulation(t *testing.T) {
	b := newSim(t)
	if b.Mode() != "simulation" {
		t.Errorf("expected mode=simulation, got %q", b.Mode())
	}
}

// ─── CreateAccount ────────────────────────────────────────────────────────────

func TestCreateAccount_Success(t *testing.T) {
	b := newSim(t)
	acc := &backend.Account{
		ID:     "acc-001",
		Ledger: 1,
		Code:   100,
	}
	if err := b.CreateAccount(acc); err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}
}

func TestCreateAccount_Idempotent(t *testing.T) {
	b := newSim(t)
	acc := &backend.Account{ID: "acc-idem", Ledger: 1, Code: 100}
	if err := b.CreateAccount(acc); err != nil {
		t.Fatalf("first CreateAccount: %v", err)
	}
	// Second call with same ID must not error (idempotent).
	if err := b.CreateAccount(acc); err != nil {
		t.Fatalf("idempotent CreateAccount: %v", err)
	}
}

// ─── GetAccount ───────────────────────────────────────────────────────────────

func TestGetAccount_NotFound(t *testing.T) {
	b := newSim(t)
	_, found := b.GetAccount("nonexistent-id")
	if found {
		t.Fatal("expected found=false for nonexistent account")
	}
}

func TestGetAccount_Found(t *testing.T) {
	b := newSim(t)
	acc := &backend.Account{ID: "acc-get-001", Ledger: 1, Code: 100}
	_ = b.CreateAccount(acc)

	got, found := b.GetAccount("acc-get-001")
	if !found {
		t.Fatal("expected found=true")
	}
	if got.ID != "acc-get-001" {
		t.Errorf("expected ID=acc-get-001, got %q", got.ID)
	}
}

// ─── PostTransfer (standard) ──────────────────────────────────────────────────

func TestPostTransfer_Success(t *testing.T) {
	b := newSim(t)

	_ = b.CreateAccount(&backend.Account{ID: "trader-1", Ledger: 1, Code: 100})
	_ = b.CreateAccount(&backend.Account{ID: "revenue-1", Ledger: 1, Code: 200})

	tx := &backend.Transfer{
		ID:              "tx-001",
		DebitAccountID:  "trader-1",
		CreditAccountID: "revenue-1",
		Amount:          10000,
		Ledger:          1,
		Code:            1,
		Flag:            backend.FlagNone,
	}
	if err := b.PostTransfer(tx); err != nil {
		t.Fatalf("PostTransfer: %v", err)
	}
}

func TestPostTransfer_Idempotent(t *testing.T) {
	b := newSim(t)

	_ = b.CreateAccount(&backend.Account{ID: "trader-2", Ledger: 1, Code: 100})
	_ = b.CreateAccount(&backend.Account{ID: "revenue-2", Ledger: 1, Code: 200})

	tx := &backend.Transfer{
		ID:              "tx-idem",
		DebitAccountID:  "trader-2",
		CreditAccountID: "revenue-2",
		Amount:          500,
		Ledger:          1,
		Code:            1,
		Flag:            backend.FlagNone,
	}
	if err := b.PostTransfer(tx); err != nil {
		t.Fatalf("first PostTransfer: %v", err)
	}
	// Duplicate must not error.
	if err := b.PostTransfer(tx); err != nil {
		t.Fatalf("idempotent PostTransfer: %v", err)
	}
}

// ─── GetTransfer ──────────────────────────────────────────────────────────────

func TestGetTransfer_NotFound(t *testing.T) {
	b := newSim(t)
	_, found := b.GetTransfer("nonexistent-tx")
	if found {
		t.Fatal("expected found=false for nonexistent transfer")
	}
}

func TestGetTransfer_Found(t *testing.T) {
	b := newSim(t)

	_ = b.CreateAccount(&backend.Account{ID: "trader-5", Ledger: 1, Code: 100})
	_ = b.CreateAccount(&backend.Account{ID: "revenue-5", Ledger: 1, Code: 200})

	tx := &backend.Transfer{
		ID:              "tx-get-001",
		DebitAccountID:  "trader-5",
		CreditAccountID: "revenue-5",
		Amount:          100,
		Ledger:          1,
		Code:            1,
		Flag:            backend.FlagNone,
	}
	_ = b.PostTransfer(tx)

	got, found := b.GetTransfer("tx-get-001")
	if !found {
		t.Fatal("expected found=true")
	}
	if got.ID != "tx-get-001" {
		t.Errorf("expected ID=tx-get-001, got %q", got.ID)
	}
	if got.Amount != 100 {
		t.Errorf("expected Amount=100, got %d", got.Amount)
	}
}

// ─── Two-Phase: Post-Pending ──────────────────────────────────────────────────

func TestTwoPhase_PostPending(t *testing.T) {
	b := newSim(t)

	_ = b.CreateAccount(&backend.Account{ID: "trader-3", Ledger: 1, Code: 100})
	_ = b.CreateAccount(&backend.Account{ID: "revenue-3", Ledger: 1, Code: 200})

	// Step 1: create PENDING transfer.
	pending := &backend.Transfer{
		ID:              "tx-pending-001",
		DebitAccountID:  "trader-3",
		CreditAccountID: "revenue-3",
		Amount:          2000,
		Ledger:          1,
		Code:            1,
		Flag:            backend.FlagPending,
	}
	if err := b.PostTransfer(pending); err != nil {
		t.Fatalf("PostTransfer (pending): %v", err)
	}

	// Step 2: post the pending transfer.
	post := &backend.Transfer{
		ID:              "tx-pending-001-post",
		DebitAccountID:  "trader-3",
		CreditAccountID: "revenue-3",
		Amount:          2000,
		PendingID:       "tx-pending-001",
		Ledger:          1,
		Code:            1,
		Flag:            backend.FlagPostPendingTransfer,
	}
	if err := b.PostTransfer(post); err != nil {
		t.Fatalf("PostTransfer (post-pending): %v", err)
	}
}

// ─── Two-Phase: Void-Pending ──────────────────────────────────────────────────

func TestTwoPhase_VoidPending(t *testing.T) {
	b := newSim(t)

	_ = b.CreateAccount(&backend.Account{ID: "trader-4", Ledger: 1, Code: 100})
	_ = b.CreateAccount(&backend.Account{ID: "revenue-4", Ledger: 1, Code: 200})

	pending := &backend.Transfer{
		ID:              "tx-void-001",
		DebitAccountID:  "trader-4",
		CreditAccountID: "revenue-4",
		Amount:          3000,
		Ledger:          1,
		Code:            1,
		Flag:            backend.FlagPending,
	}
	_ = b.PostTransfer(pending)

	void := &backend.Transfer{
		ID:              "tx-void-001-void",
		DebitAccountID:  "trader-4",
		CreditAccountID: "revenue-4",
		Amount:          3000,
		PendingID:       "tx-void-001",
		Ledger:          1,
		Code:            1,
		Flag:            backend.FlagVoidPendingTransfer,
	}
	if err := b.PostTransfer(void); err != nil {
		t.Fatalf("PostTransfer (void-pending): %v", err)
	}
}

// ─── GetTransfersByAccount ────────────────────────────────────────────────────

func TestGetTransfersByAccount_Empty(t *testing.T) {
	b := newSim(t)
	_ = b.CreateAccount(&backend.Account{ID: "acc-empty", Ledger: 1, Code: 100})
	txs := b.GetTransfersByAccount("acc-empty", 10)
	if len(txs) != 0 {
		t.Errorf("expected 0 transfers, got %d", len(txs))
	}
}

func TestGetTransfersByAccount_ReturnsOwn(t *testing.T) {
	b := newSim(t)

	_ = b.CreateAccount(&backend.Account{ID: "trader-6", Ledger: 1, Code: 100})
	_ = b.CreateAccount(&backend.Account{ID: "revenue-6", Ledger: 1, Code: 200})

	for i := 0; i < 3; i++ {
		_ = b.PostTransfer(&backend.Transfer{
			ID:              fmt.Sprintf("tx-list-%d", i),
			DebitAccountID:  "trader-6",
			CreditAccountID: "revenue-6",
			Amount:          int64(100 * (i + 1)),
			Ledger:          1,
			Code:            1,
			Flag:            backend.FlagNone,
		})
	}

	txs := b.GetTransfersByAccount("trader-6", 10)
	if len(txs) != 3 {
		t.Errorf("expected 3 transfers, got %d", len(txs))
	}
}

// ─── GetAllAccounts ───────────────────────────────────────────────────────────

func TestGetAllAccounts_IncludesCreated(t *testing.T) {
	b := newSim(t)
	_ = b.CreateAccount(&backend.Account{ID: "acc-all-1", Ledger: 1, Code: 100})
	_ = b.CreateAccount(&backend.Account{ID: "acc-all-2", Ledger: 1, Code: 200})

	accs := b.GetAllAccounts()
	found := 0
	for _, a := range accs {
		if a.ID == "acc-all-1" || a.ID == "acc-all-2" {
			found++
		}
	}
	if found < 2 {
		t.Errorf("expected at least 2 created accounts in GetAllAccounts, found %d", found)
	}
}

// ─── GetRecentTransfers ───────────────────────────────────────────────────────

func TestGetRecentTransfers_LimitRespected(t *testing.T) {
	b := newSim(t)

	_ = b.CreateAccount(&backend.Account{ID: "trader-7", Ledger: 1, Code: 100})
	_ = b.CreateAccount(&backend.Account{ID: "revenue-7", Ledger: 1, Code: 200})

	for i := 0; i < 5; i++ {
		_ = b.PostTransfer(&backend.Transfer{
			ID:              fmt.Sprintf("tx-recent-%d", i),
			DebitAccountID:  "trader-7",
			CreditAccountID: "revenue-7",
			Amount:          int64(50 * (i + 1)),
			Ledger:          1,
			Code:            1,
			Flag:            backend.FlagNone,
		})
	}

	recent := b.GetRecentTransfers(3)
	if len(recent) > 3 {
		t.Errorf("expected at most 3 recent transfers, got %d", len(recent))
	}
}

// ─── Concurrent safety ────────────────────────────────────────────────────────

func TestPostTransfer_ConcurrentSafe(t *testing.T) {
	b := newSim(t)

	_ = b.CreateAccount(&backend.Account{ID: "trader-conc", Ledger: 1, Code: 100})
	_ = b.CreateAccount(&backend.Account{ID: "revenue-conc", Ledger: 1, Code: 200})

	done := make(chan error, 10)
	for i := 0; i < 10; i++ {
		go func(n int) {
			tx := &backend.Transfer{
				ID:              fmt.Sprintf("tx-conc-%d", n),
				DebitAccountID:  "trader-conc",
				CreditAccountID: "revenue-conc",
				Amount:          int64(100 * (n + 1)),
				Ledger:          1,
				Code:            1,
				Flag:            backend.FlagNone,
			}
			done <- b.PostTransfer(tx)
		}(i)
	}
	for i := 0; i < 10; i++ {
		if err := <-done; err != nil {
			t.Errorf("concurrent PostTransfer[%d]: %v", i, err)
		}
	}
}
