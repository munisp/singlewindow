// Transit Guarantee Workflows — Scenarios 8, 9
// TransitLodgementWorkflow: escrow creation + TigerBeetle transfer
// TransitReleaseWorkflow: exit confirmation → escrow release
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// ─── TRANSIT LODGEMENT (Scenario 8) ──────────────────────────────────────────

type TransitLodgementInput struct {
	TransitID       int64  `json:"transit_id"`
	TraderID        string `json:"trader_id"`
	TraderAccountID string `json:"trader_account_id"`
	EscrowAccountID string `json:"escrow_account_id"`
	AmountMinor     int64  `json:"amount_minor"`
	Currency        string `json:"currency"`
	Ledger          uint32 `json:"ledger"`
	EntryPortCode   string `json:"entry_port_code"`
	ExitPortCode    string `json:"exit_port_code"`
	ExitDeadline    string `json:"exit_deadline"` // ISO 8601
	UCR             string `json:"ucr"`
}

type TransitLodgementResult struct {
	TransitID       int64     `json:"transit_id"`
	Status          string    `json:"status"`
	TigerBeetleTxID string    `json:"tigerbeetle_tx_id"`
	CompletedAt     time.Time `json:"completed_at"`
}

// TransitLodgementWorkflow creates a transit escrow in TigerBeetle and transfers
// the guarantee amount. It is the source of truth — PostgreSQL is updated after
// TigerBeetle confirms the transfer.
func TransitLodgementWorkflow(ctx workflow.Context, input TransitLodgementInput) (*TransitLodgementResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("TransitLodgementWorkflow started", "transitID", input.TransitID, "ucr", input.UCR)

	result := &TransitLodgementResult{TransitID: input.TransitID}

	tbCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})

	// Step 1: Create TigerBeetle transit escrow account
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleCreateAccountActivity, TigerBeetleAccountInput{
		AccountID:   input.EscrowAccountID,
		Ledger:      input.Ledger,
		Label:       fmt.Sprintf("Transit Escrow — UCR:%s", input.UCR),
		AccountType: "credit_normal",
	}).Get(ctx, nil); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("transit escrow account creation failed: %w", err)
	}

	// Step 2: Transfer Trader → Transit Escrow
	var tbTransfer TigerBeetleTransferResult
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleTransferActivity, TigerBeetleTransferInput{
		IdempotencyKey:  fmt.Sprintf("transit:lodgement:%d", input.TransitID),
		DebitAccountID:  input.TraderAccountID,
		CreditAccountID: input.EscrowAccountID,
		AmountMinor:     input.AmountMinor,
		Ledger:          input.Ledger,
		EntryType:       "transit_lodgement",
		DeclarationRef:  fmt.Sprintf("transit:%d", input.TransitID),
	}).Get(ctx, &tbTransfer); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("transit guarantee transfer failed: %w", err)
	}
	result.TigerBeetleTxID = tbTransfer.TransferID

	// Step 3: Publish Kafka event
	kafkaCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(kafkaCtx, PublishKafkaEventActivity, KafkaEventInput{
		Topic: "transit.guarantee.lodged",
		Key:   fmt.Sprintf("transit:%d", input.TransitID),
		Payload: map[string]interface{}{
			"transitId":       input.TransitID,
			"ucr":             input.UCR,
			"traderId":        input.TraderID,
			"amountMinor":     input.AmountMinor,
			"exitDeadline":    input.ExitDeadline,
			"tigerBeetleTxId": result.TigerBeetleTxID,
		},
	}).Get(ctx, nil)

	// Step 4: Update transit status in PostgreSQL
	updateCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(updateCtx, UpdateTransitStatusActivity, UpdateTransitStatusInput{
		TransitID: input.TransitID,
		Status:    "in_transit",
	}).Get(ctx, nil)

	result.Status = "in_transit"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─── TRANSIT RELEASE (Scenario 9) ────────────────────────────────────────────

type TransitReleaseInput struct {
	TransitID       int64  `json:"transit_id"`
	TraderID        string `json:"trader_id"`
	TraderAccountID string `json:"trader_account_id"`
	EscrowAccountID string `json:"escrow_account_id"`
	AmountMinor     int64  `json:"amount_minor"`
	Currency        string `json:"currency"`
	Ledger          uint32 `json:"ledger"`
	ExitConfirmRef  string `json:"exit_confirm_ref"` // from destination customs
	UCR             string `json:"ucr"`
}

type TransitReleaseResult struct {
	TransitID       int64     `json:"transit_id"`
	Status          string    `json:"status"`
	TigerBeetleTxID string    `json:"tigerbeetle_tx_id"`
	CompletedAt     time.Time `json:"completed_at"`
}

// TransitReleaseWorkflow releases the transit escrow back to the trader after
// exit confirmation is received from the destination customs authority.
func TransitReleaseWorkflow(ctx workflow.Context, input TransitReleaseInput) (*TransitReleaseResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("TransitReleaseWorkflow started", "transitID", input.TransitID, "exitRef", input.ExitConfirmRef)

	result := &TransitReleaseResult{TransitID: input.TransitID}

	// Step 1: Verify exit confirmation is authentic (COMESA/WCO CEN check)
	verifyCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	var verified bool
	if err := workflow.ExecuteActivity(verifyCtx, VerifyTransitExitConfirmationActivity, VerifyTransitInput{
		TransitID:      input.TransitID,
		UCR:            input.UCR,
		ExitConfirmRef: input.ExitConfirmRef,
	}).Get(ctx, &verified); err != nil || !verified {
		result.Status = "failed"
		return result, fmt.Errorf("exit confirmation verification failed for transit %d", input.TransitID)
	}

	// Step 2: TigerBeetle transfer Escrow → Trader
	tbCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	var tbTransfer TigerBeetleTransferResult
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleTransferActivity, TigerBeetleTransferInput{
		IdempotencyKey:  fmt.Sprintf("transit:release:%d:%s", input.TransitID, input.ExitConfirmRef),
		DebitAccountID:  input.EscrowAccountID,
		CreditAccountID: input.TraderAccountID,
		AmountMinor:     input.AmountMinor,
		Ledger:          input.Ledger,
		EntryType:       "transit_release",
		DeclarationRef:  fmt.Sprintf("transit:%d", input.TransitID),
	}).Get(ctx, &tbTransfer); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("transit release transfer failed: %w", err)
	}
	result.TigerBeetleTxID = tbTransfer.TransferID

	// Step 3: Publish Kafka event
	kafkaCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(kafkaCtx, PublishKafkaEventActivity, KafkaEventInput{
		Topic: "transit.guarantee.released",
		Key:   fmt.Sprintf("transit:%d", input.TransitID),
		Payload: map[string]interface{}{
			"transitId":       input.TransitID,
			"ucr":             input.UCR,
			"traderId":        input.TraderID,
			"amountMinor":     input.AmountMinor,
			"exitConfirmRef":  input.ExitConfirmRef,
			"tigerBeetleTxId": result.TigerBeetleTxID,
		},
	}).Get(ctx, nil)

	// Step 4: Update transit status
	updateCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(updateCtx, UpdateTransitStatusActivity, UpdateTransitStatusInput{
		TransitID: input.TransitID,
		Status:    "completed",
	}).Get(ctx, nil)

	result.Status = "completed"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}
