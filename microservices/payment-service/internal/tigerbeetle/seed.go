// seed.go — Standard account seeding for the TradeGateway payment ledger.
// Called once at payment-service startup to ensure the five canonical
// TigerBeetle accounts exist before any payment flow is attempted.
//
// Accounts:
//   - customs-duty-revenue          (code 2000) — settled duty revenue
//   - customs-duty-revenue-pending  (code 2001) — two-phase pending reserve
//   - trader-liability-pool         (code 1000) — aggregate trader escrow
//   - bond-deposit                  (code 3000) — AEO/bond security deposits
//   - drawback-payable              (code 3001) — duty drawback refund liability
//
// The seeding is idempotent: the mock client stores accounts in a map keyed by
// ID, and the real TigerBeetle HTTP client returns a conflict error for
// duplicate IDs which we intentionally ignore.
package tigerbeetle

import (
	"context"
	"log"
	"time"
)

// StandardAccounts returns the five canonical ledger accounts that must exist
// before any payment transfer can be posted.
func StandardAccounts() []Account {
	return []Account{
		{
			ID:     "customs-duty-revenue",
			Ledger: LedgerGHS,
			Code:   CodeDutyRevenue,
		},
		{
			ID:     "customs-duty-revenue-pending",
			Ledger: LedgerGHS,
			Code:   CodeDutyRevenue + 1, // 2001 — pending reserve bucket
		},
		{
			ID:     "trader-liability-pool",
			Ledger: LedgerGHS,
			Code:   CodeTraderDeposit,
		},
		{
			ID:     "bond-deposit",
			Ledger: LedgerGHS,
			Code:   CodeRefundLiability - 1, // 2999 — bond/security deposits
		},
		{
			ID:     "drawback-payable",
			Ledger: LedgerGHS,
			Code:   CodeRefundLiability, // 3000 — duty drawback refund liability
		},
	}
}

// SeedAccounts ensures the five standard accounts exist in TigerBeetle.
// It retries up to maxAttempts times with a short backoff to handle the case
// where the TigerBeetle bridge starts slightly after the payment-service.
// Duplicate-account errors (HTTP 409 / "already exists") are silently ignored.
func SeedAccounts(tb Client) {
	const maxAttempts = 5
	accounts := StandardAccounts()

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := tb.CreateAccounts(ctx, accounts)
		cancel()

		if err == nil {
			log.Printf("[payment-service] TigerBeetle: %d standard accounts seeded successfully", len(accounts))
			return
		}

		// "already exists" / conflict is not a real error — the accounts are there.
		// We detect it by the error message substring used by both the mock and
		// the HTTP client.
		if isConflictError(err) {
			log.Printf("[payment-service] TigerBeetle: standard accounts already exist (idempotent seed OK)")
			return
		}

		log.Printf("[payment-service] TigerBeetle seed attempt %d/%d failed: %v", attempt, maxAttempts, err)
		if attempt < maxAttempts {
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}
	}

	// Non-fatal: log a warning but do not crash the service.
	// Payments will fail at runtime if accounts are truly missing, which is
	// surfaced via the existing TigerBeetle error handling in handlers.go.
	log.Printf("[payment-service] WARNING: TigerBeetle standard account seeding failed after %d attempts — ledger may reject transfers", maxAttempts)
}

// isConflictError returns true when the error indicates the account already
// exists. Both the mock client and the HTTP bridge surface this as a string
// containing "already exists" or "conflict".
func isConflictError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	for _, substr := range []string{"already exists", "conflict", "409"} {
		if contains(msg, substr) {
			return true
		}
	}
	return false
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsRune(s, substr))
}

func containsRune(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
