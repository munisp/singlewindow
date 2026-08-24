package main

import (
	"sync"
	"testing"

	"github.com/shopspring/decimal"
)

func TestPostTransferIsIdempotentByKey(t *testing.T) {
	store := NewStore()
	if err := store.CreateAccount(&Account{ID: "trader-test", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAccount(&Account{ID: "revenue-test", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	store.accounts["trader-test"].CreditsPosted = decimal.NewFromInt(100)

	const key = "excise:order:123"
	first := &Transfer{
		ID:              "transfer-first",
		DebitAccountID:  "trader-test",
		CreditAccountID: "revenue-test",
		Amount:          decimal.NewFromInt(100),
		Currency:        "GHS",
		IdempotencyKey:  key,
	}
	second := &Transfer{
		ID:              "transfer-second",
		DebitAccountID:  "trader-test",
		CreditAccountID: "revenue-test",
		Amount:          decimal.NewFromInt(100),
		Currency:        "GHS",
		IdempotencyKey:  key,
	}

	if err := store.PostTransfer(first); err != nil {
		t.Fatal(err)
	}
	if err := store.PostTransfer(second); err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected replay to retain transfer %q, got %q", first.ID, second.ID)
	}
	if transfers := store.GetTransfersByAccount("trader-test", 10); len(transfers) != 1 {
		t.Fatalf("expected one stored transfer, got %d", len(transfers))
	}
}

func TestPostTransferIdempotencyIsConcurrent(t *testing.T) {
	store := NewStore()
	if err := store.CreateAccount(&Account{ID: "trader-race", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAccount(&Account{ID: "revenue-race", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	store.accounts["trader-race"].CreditsPosted = decimal.NewFromInt(100)

	const key = "excise:race:123"
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, id := range []string{"transfer-race-a", "transfer-race-b"} {
		wg.Add(1)
		go func(transferID string) {
			defer wg.Done()
			errs <- store.PostTransfer(&Transfer{
				ID:              transferID,
				DebitAccountID:  "trader-race",
				CreditAccountID: "revenue-race",
				Amount:          decimal.NewFromInt(100),
				Currency:        "GHS",
				IdempotencyKey:  key,
			})
		}(id)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if transfers := store.GetTransfersByAccount("trader-race", 10); len(transfers) != 1 {
		t.Fatalf("expected one stored transfer after concurrent replay, got %d", len(transfers))
	}
}

func TestPostTransferRejectsDebitOverdraft(t *testing.T) {
	store := NewStore()
	if err := store.CreateAccount(&Account{
		ID:                         "trader-overdraft",
		Ledger:                     1,
		Currency:                   "GHS",
		DebitsMustNotExceedCredits: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAccount(&Account{ID: "revenue-overdraft", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	store.accounts["trader-overdraft"].CreditsPosted = decimal.NewFromInt(50)

	err := store.PostTransfer(&Transfer{
		ID:              "transfer-overdraft",
		DebitAccountID:  "trader-overdraft",
		CreditAccountID: "revenue-overdraft",
		Amount:          decimal.NewFromInt(51),
		Currency:        "GHS",
	})
	if err == nil {
		t.Fatal("expected overdraft to be rejected")
	}
	if transfers := store.GetTransfersByAccount("trader-overdraft", 10); len(transfers) != 0 {
		t.Fatalf("expected no transfer after overdraft rejection, got %d", len(transfers))
	}
}

func TestPostTransferOverdraftFlagAndQuotaReversal(t *testing.T) {
	store := NewStore()
	if err := store.CreateAccount(&Account{
		ID:                         "quota-available",
		Ledger:                     1,
		Currency:                   "QTY",
		DebitsMustNotExceedCredits: true,
		CreditsPosted:              decimal.NewFromInt(10),
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAccount(&Account{ID: "quota-allocated", Ledger: 1, Currency: "QTY"}); err != nil {
		t.Fatal(err)
	}

	if err := store.PostTransfer(&Transfer{
		ID:              "quota-allocation",
		DebitAccountID:  "quota-available",
		CreditAccountID: "quota-allocated",
		Amount:          decimal.NewFromInt(6),
		Currency:        "QTY",
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.PostTransfer(&Transfer{
		ID:              "quota-overallocation",
		DebitAccountID:  "quota-available",
		CreditAccountID: "quota-allocated",
		Amount:          decimal.NewFromInt(5),
		Currency:        "QTY",
	}); err == nil {
		t.Fatal("expected quota overdraft to be rejected")
	}
	available, _ := store.GetAccount("quota-available")
	if !available.Balance().Equal(decimal.NewFromInt(4)) {
		t.Fatalf("expected available balance to remain 4 after rejection, got %s", available.Balance())
	}

	if err := store.PostTransfer(&Transfer{
		ID:              "quota-reversal",
		DebitAccountID:  "quota-allocated",
		CreditAccountID: "quota-available",
		Amount:          decimal.NewFromInt(6),
		Currency:        "QTY",
	}); err != nil {
		t.Fatal(err)
	}
	available, _ = store.GetAccount("quota-available")
	if !available.Balance().Equal(decimal.NewFromInt(10)) {
		t.Fatalf("expected reversal to restore 10 QTY, got %s", available.Balance())
	}
	if err := store.PostTransfer(&Transfer{
		ID:              "quota-reallocation",
		DebitAccountID:  "quota-available",
		CreditAccountID: "quota-allocated",
		Amount:          decimal.NewFromInt(4),
		Currency:        "QTY",
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPostTransferDefaultAccountAllowsDutyDebit(t *testing.T) {
	store := NewStore()
	if err := store.CreateAccount(&Account{ID: "trader-duty", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAccount(&Account{ID: "revenue-duty", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	if err := store.PostTransfer(&Transfer{
		ID:              "duty-payment",
		DebitAccountID:  "trader-duty",
		CreditAccountID: "revenue-duty",
		Amount:          decimal.NewFromInt(25),
		Currency:        "GHS",
	}); err != nil {
		t.Fatalf("ordinary money account should allow duty debit: %v", err)
	}
}

func TestPostTransferAlwaysChecksCurrencyAndPendingAmount(t *testing.T) {
	store := NewStore()
	if err := store.CreateAccount(&Account{ID: "currency-debit", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAccount(&Account{ID: "currency-credit", Ledger: 1, Currency: "USD"}); err != nil {
		t.Fatal(err)
	}
	if err := store.PostTransfer(&Transfer{
		ID:              "currency-mismatch",
		DebitAccountID:  "currency-debit",
		CreditAccountID: "currency-credit",
		Amount:          decimal.NewFromInt(1),
		Currency:        "GHS",
	}); err == nil {
		t.Fatal("expected mismatched currency to be rejected")
	}

	if err := store.CreateAccount(&Account{ID: "pending-debit", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAccount(&Account{ID: "pending-credit", Ledger: 1, Currency: "GHS"}); err != nil {
		t.Fatal(err)
	}
	if err := store.PostTransfer(&Transfer{
		ID:              "pending-transfer",
		DebitAccountID:  "pending-debit",
		CreditAccountID: "pending-credit",
		Amount:          decimal.NewFromInt(10),
		Currency:        "GHS",
		Flag:            FlagPending,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.PostTransfer(&Transfer{
		ID:              "pending-overpost",
		DebitAccountID:  "pending-credit",
		CreditAccountID: "pending-debit",
		Amount:          decimal.NewFromInt(11),
		Currency:        "GHS",
		Flag:            FlagPostPendingTransfer,
		PendingID:       "pending-transfer",
	}); err == nil {
		t.Fatal("expected pending transfer over-post to be rejected")
	}
}
