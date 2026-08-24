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
	if err := store.CreateAccount(&Account{ID: "trader-overdraft", Ledger: 1, Currency: "GHS"}); err != nil {
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
