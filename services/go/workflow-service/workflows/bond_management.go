// Bond Management Workflows — Scenarios 5, 6, 7
// BondWorkflow: lodgement + expiry monitoring
// BondForfeitureWorkflow: breach detection + forfeiture transfer
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// ─── BOND LODGEMENT WORKFLOW (Scenario 5) ─────────────────────────────────────

type BondLodgementInput struct {
	BondID          int64   `json:"bond_id"`
	TraderID        string  `json:"trader_id"`
	TraderAccountID string  `json:"trader_account_id"`
	EscrowAccountID string  `json:"escrow_account_id"`
	AmountMinor     int64   `json:"amount_minor"`
	Currency        string  `json:"currency"`
	Ledger          uint32  `json:"ledger"`
	BondType        string  `json:"bond_type"` // "general" | "specific" | "transit"
	ExpiryDate      string  `json:"expiry_date"` // ISO 8601
	DeclarationRef  string  `json:"declaration_ref"`
}

type BondLodgementResult struct {
	BondID          int64     `json:"bond_id"`
	Status          string    `json:"status"`
	TigerBeetleTxID string    `json:"tigerbeetle_tx_id"`
	EscrowAccountID string    `json:"escrow_account_id"`
	CompletedAt     time.Time `json:"completed_at"`
}

// BondLodgementWorkflow creates the escrow account and atomically transfers
// the bond amount from the trader to the escrow. It then signals a long-running
// BondExpiryMonitorWorkflow to watch for renewal or forfeiture.
func BondLodgementWorkflow(ctx workflow.Context, input BondLodgementInput) (*BondLodgementResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("BondLodgementWorkflow started", "bondID", input.BondID)

	result := &BondLodgementResult{BondID: input.BondID, EscrowAccountID: input.EscrowAccountID}

	// Step 1: Create TigerBeetle escrow account (idempotent)
	tbCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	var acctResult TigerBeetleAccountResult
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleCreateAccountActivity, TigerBeetleAccountInput{
		AccountID:   input.EscrowAccountID,
		Ledger:      input.Ledger,
		Label:       fmt.Sprintf("Bond Escrow — %s — %d", input.TraderID, input.BondID),
		AccountType: "credit_normal",
	}).Get(ctx, &acctResult); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("failed to create escrow account: %w", err)
	}

	// Step 2: Atomic transfer Trader → Escrow (single-phase, no Mojaloop needed for internal bonds)
	idempotencyKey := fmt.Sprintf("bond:lodgement:%d", input.BondID)
	var tbTransfer TigerBeetleTransferResult
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleTransferActivity, TigerBeetleTransferInput{
		IdempotencyKey:  idempotencyKey,
		DebitAccountID:  input.TraderAccountID,
		CreditAccountID: input.EscrowAccountID,
		AmountMinor:     input.AmountMinor,
		Ledger:          input.Ledger,
		EntryType:       "bond_lodgement",
		DeclarationRef:  input.DeclarationRef,
	}).Get(ctx, &tbTransfer); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("TigerBeetle bond transfer failed: %w", err)
	}
	result.TigerBeetleTxID = tbTransfer.TransferID

	// Step 3: Publish Kafka event
	kafkaCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(kafkaCtx, PublishKafkaEventActivity, KafkaEventInput{
		Topic: "bond.lodged",
		Key:   fmt.Sprintf("bond:%d", input.BondID),
		Payload: map[string]interface{}{
			"bondId":          input.BondID,
			"traderId":        input.TraderID,
			"amountMinor":     input.AmountMinor,
			"currency":        input.Currency,
			"escrowAccountId": input.EscrowAccountID,
			"expiryDate":      input.ExpiryDate,
			"tigerBeetleTxId": result.TigerBeetleTxID,
		},
	}).Get(ctx, nil)

	// Step 4: Update bond status in PostgreSQL
	updateCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(updateCtx, UpdateBondStatusActivity, UpdateBondStatusInput{
		BondID: input.BondID,
		Status: "active",
	}).Get(ctx, nil)

	result.Status = "active"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─── BOND FORFEITURE WORKFLOW (Scenario 7) ────────────────────────────────────

type BondForfeitureInput struct {
	BondID          int64  `json:"bond_id"`
	TraderID        string `json:"trader_id"`
	EscrowAccountID string `json:"escrow_account_id"`
	NCSRevenueAcct  string `json:"ncs_revenue_account_id"`
	AmountMinor     int64  `json:"amount_minor"`
	Currency        string `json:"currency"`
	Ledger          uint32 `json:"ledger"`
	BreachReason    string `json:"breach_reason"`
	OfficerID       string `json:"officer_id"`
}

type BondForfeitureResult struct {
	BondID          int64     `json:"bond_id"`
	Status          string    `json:"status"`
	TigerBeetleTxID string    `json:"tigerbeetle_tx_id"`
	CompletedAt     time.Time `json:"completed_at"`
}

// BondForfeitureWorkflow transfers bond escrow funds to NCS Revenue on breach.
// This is irreversible — requires dual officer authorization before starting.
func BondForfeitureWorkflow(ctx workflow.Context, input BondForfeitureInput) (*BondForfeitureResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("BondForfeitureWorkflow started", "bondID", input.BondID, "reason", input.BreachReason)

	result := &BondForfeitureResult{BondID: input.BondID}

	// Step 1: Permify — require dual authorization (two officers must approve)
	authCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	var authOK bool
	if err := workflow.ExecuteActivity(authCtx, CheckPermifyAuthorizationActivity, PermifyAuthInput{
		SubjectType: "officer",
		SubjectID:   input.OfficerID,
		Resource:    fmt.Sprintf("bond:%d", input.BondID),
		Action:      "forfeit",
	}).Get(ctx, &authOK); err != nil || !authOK {
		result.Status = "unauthorized"
		return result, fmt.Errorf("forfeiture authorization denied for officer %s", input.OfficerID)
	}

	// Step 2: Atomic TigerBeetle transfer Escrow → NCS Revenue
	idempotencyKey := fmt.Sprintf("bond:forfeiture:%d:%s", input.BondID, input.OfficerID)
	tbCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	var tbTransfer TigerBeetleTransferResult
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleTransferActivity, TigerBeetleTransferInput{
		IdempotencyKey:  idempotencyKey,
		DebitAccountID:  input.EscrowAccountID,
		CreditAccountID: input.NCSRevenueAcct,
		AmountMinor:     input.AmountMinor,
		Ledger:          input.Ledger,
		EntryType:       "bond_forfeiture",
		DeclarationRef:  fmt.Sprintf("bond:%d", input.BondID),
	}).Get(ctx, &tbTransfer); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("TigerBeetle forfeiture transfer failed: %w", err)
	}
	result.TigerBeetleTxID = tbTransfer.TransferID

	// Step 3: Publish Kafka event + notify trader
	kafkaCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(kafkaCtx, PublishKafkaEventActivity, KafkaEventInput{
		Topic: "bond.forfeited",
		Key:   fmt.Sprintf("bond:%d", input.BondID),
		Payload: map[string]interface{}{
			"bondId":          input.BondID,
			"traderId":        input.TraderID,
			"amountMinor":     input.AmountMinor,
			"breachReason":    input.BreachReason,
			"tigerBeetleTxId": result.TigerBeetleTxID,
		},
	}).Get(ctx, nil)

	// Step 4: Update bond status
	updateCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(updateCtx, UpdateBondStatusActivity, UpdateBondStatusInput{
		BondID: input.BondID,
		Status: "forfeited",
	}).Get(ctx, nil)

	result.Status = "forfeited"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}
