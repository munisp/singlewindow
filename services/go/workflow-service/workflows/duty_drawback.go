// DutyDrawbackWorkflow — Scenario 3: Duty Drawback Refund
// Implements a two-phase saga:
//   Phase 1: TigerBeetle RESERVE debit from NCS Revenue
//   Phase 2: Mojaloop transfer to trader DFSP
//   Phase 3: TigerBeetle COMMIT on Mojaloop success
// Compensation: if Mojaloop fails, TigerBeetle compensating credit restores NCS Revenue.
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ─── INPUT / OUTPUT ───────────────────────────────────────────────────────────

// DrawbackInput is the workflow input for a duty drawback refund.
type DrawbackInput struct {
	ClaimID             int64   `json:"claim_id"`
	TraderID            string  `json:"trader_id"`
	TraderAccountID     string  `json:"trader_account_id"`
	ImportDeclarationID int64   `json:"import_declaration_id"`
	ExportDeclarationID int64   `json:"export_declaration_id"`
	ApprovedAmountMinor int64   `json:"approved_amount_minor"` // in minor units (kobo)
	Currency            string  `json:"currency"`
	DrawbackType        string  `json:"drawback_type"` // "full" | "partial" | "manufacturing"
	ApprovedByOfficerID string  `json:"approved_by_officer_id"`
	NCSRevenueAccountID string  `json:"ncs_revenue_account_id"`
	Ledger              uint32  `json:"ledger"`
}

// DrawbackResult is the final output of the drawback workflow.
type DrawbackResult struct {
	ClaimID         int64     `json:"claim_id"`
	Status          string    `json:"status"` // "paid" | "failed" | "compensated"
	TigerBeetleTxID string    `json:"tigerbeetle_tx_id,omitempty"`
	MojaloopTxID    string    `json:"mojaloop_tx_id,omitempty"`
	CompletedAt     time.Time `json:"completed_at"`
	FailureReason   string    `json:"failure_reason,omitempty"`
}

// ─── WORKFLOW ─────────────────────────────────────────────────────────────────

// DutyDrawbackWorkflow orchestrates the two-phase duty drawback refund saga.
// It is started by the drawback router after a customs officer approves the claim.
func DutyDrawbackWorkflow(ctx workflow.Context, input DrawbackInput) (*DrawbackResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("DutyDrawbackWorkflow started",
		"claimID", input.ClaimID,
		"traderID", input.TraderID,
		"amount", input.ApprovedAmountMinor,
	)

	result := &DrawbackResult{ClaimID: input.ClaimID}

	// Idempotency key: SHA-256(claim_id:drawback:approved_by)
	idempotencyKey := fmt.Sprintf("drawback:%d:%s", input.ClaimID, input.ApprovedByOfficerID)

	// ── STEP 1: Permify authorization check ───────────────────────────────────
	var authOK bool
	authCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	if err := workflow.ExecuteActivity(authCtx, CheckPermifyAuthorizationActivity, PermifyAuthInput{
		SubjectType: "officer",
		SubjectID:   input.ApprovedByOfficerID,
		Resource:    fmt.Sprintf("drawback_claim:%d", input.ClaimID),
		Action:      "approve",
	}).Get(ctx, &authOK); err != nil || !authOK {
		result.Status = "failed"
		result.FailureReason = "authorization denied"
		return result, nil
	}

	// ── STEP 2: TigerBeetle RESERVE — debit NCS Revenue ──────────────────────
	// This creates a PENDING transfer in TigerBeetle (two-phase commit).
	var tbReserveResult TigerBeetleTransferResult
	tbCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleReserveActivity, TigerBeetleTransferInput{
		IdempotencyKey:  idempotencyKey + ":reserve",
		DebitAccountID:  input.NCSRevenueAccountID,
		CreditAccountID: input.TraderAccountID,
		AmountMinor:     input.ApprovedAmountMinor,
		Ledger:          input.Ledger,
		EntryType:       "drawback_reserve",
		DeclarationRef:  fmt.Sprintf("drawback:%d", input.ClaimID),
	}).Get(ctx, &tbReserveResult); err != nil {
		result.Status = "failed"
		result.FailureReason = fmt.Sprintf("TigerBeetle reserve failed: %v", err)
		_ = updateDrawbackClaimStatus(ctx, input.ClaimID, "failed", result.FailureReason)
		return result, nil
	}
	result.TigerBeetleTxID = tbReserveResult.TransferID

	// ── STEP 3: Mojaloop transfer to trader DFSP ──────────────────────────────
	var mojaloopResult MojaloopTransferResult
	mojCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 120 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	mojErr := workflow.ExecuteActivity(mojCtx, MojaloopTransferActivity, MojaloopTransferInput{
		TransferID:      fmt.Sprintf("drawback-%d", input.ClaimID),
		PayerFSP:        "CUSTOMS_AUTHORITY_DFSP",
		PayeeFSP:        "TRADER_DFSP",
		Amount:          input.ApprovedAmountMinor,
		Currency:        input.Currency,
		DeclarationRef:  fmt.Sprintf("drawback:%d", input.ClaimID),
	}).Get(ctx, &mojaloopResult)

	if mojErr != nil || !mojaloopResult.Success {
		// ── COMPENSATION: void the TigerBeetle RESERVE ────────────────────────
		logger.Warn("Mojaloop transfer failed — compensating TigerBeetle reserve",
			"claimID", input.ClaimID,
			"error", mojErr,
		)
		compCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 30 * time.Second,
			RetryPolicy:         criticalRetryPolicy,
		})
		_ = workflow.ExecuteActivity(compCtx, TigerBeetleVoidReserveActivity, TigerBeetleVoidInput{
			ReservedTransferID: tbReserveResult.TransferID,
			Reason:             "mojaloop_transfer_failed",
		}).Get(ctx, nil)

		result.Status = "compensated"
		result.FailureReason = fmt.Sprintf("Mojaloop transfer failed: %v", mojErr)
		_ = updateDrawbackClaimStatus(ctx, input.ClaimID, "failed", result.FailureReason)
		return result, nil
	}

	result.MojaloopTxID = mojaloopResult.TransferID

	// ── STEP 4: TigerBeetle COMMIT — finalize the transfer ────────────────────
	commitCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	if err := workflow.ExecuteActivity(commitCtx, TigerBeetleCommitActivity, TigerBeetleCommitInput{
		ReservedTransferID: tbReserveResult.TransferID,
		MojaloopFulfilment: mojaloopResult.Fulfilment,
	}).Get(ctx, nil); err != nil {
		// TigerBeetle commit failed after Mojaloop success — this is a critical
		// inconsistency. Alert operations team and mark for manual reconciliation.
		logger.Error("CRITICAL: TigerBeetle commit failed after Mojaloop success",
			"claimID", input.ClaimID,
			"tbTxID", tbReserveResult.TransferID,
			"mojaloopTxID", mojaloopResult.TransferID,
		)
		_ = raiseReconciliationAlert(ctx, input.ClaimID, "drawback", tbReserveResult.TransferID, mojaloopResult.TransferID)
		result.Status = "reconciliation_required"
		return result, nil
	}

	// ── STEP 5: Publish Kafka event ────────────────────────────────────────────
	kafkaCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(kafkaCtx, PublishKafkaEventActivity, KafkaEventInput{
		Topic: "payment.drawback.completed",
		Key:   fmt.Sprintf("claim:%d", input.ClaimID),
		Payload: map[string]interface{}{
			"claimId":         input.ClaimID,
			"traderId":        input.TraderID,
			"amountMinor":     input.ApprovedAmountMinor,
			"currency":        input.Currency,
			"tigerBeetleTxId": result.TigerBeetleTxID,
			"mojaloopTxId":    result.MojaloopTxID,
			"completedAt":     workflow.Now(ctx),
		},
	}).Get(ctx, nil)

	// ── STEP 6: Update claim status ────────────────────────────────────────────
	_ = updateDrawbackClaimStatus(ctx, input.ClaimID, "paid", "")

	result.Status = "paid"
	result.CompletedAt = workflow.Now(ctx)
	logger.Info("DutyDrawbackWorkflow completed",
		"claimID", input.ClaimID,
		"tbTxID", result.TigerBeetleTxID,
		"mojaloopTxID", result.MojaloopTxID,
	)
	return result, nil
}

// updateDrawbackClaimStatus is a helper that calls the UpdateDrawbackStatusActivity.
func updateDrawbackClaimStatus(ctx workflow.Context, claimID int64, status, reason string) error {
	updateCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	return workflow.ExecuteActivity(updateCtx, UpdateDrawbackStatusActivity, UpdateDrawbackStatusInput{
		ClaimID: claimID,
		Status:  status,
		Reason:  reason,
	}).Get(ctx, nil)
}

// raiseReconciliationAlert sends a critical alert to the operations team.
func raiseReconciliationAlert(ctx workflow.Context, claimID int64, flowType, tbTxID, mojaloopTxID string) error {
	alertCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 3},
	})
	return workflow.ExecuteActivity(alertCtx, RaiseReconciliationAlertActivity, ReconciliationAlertInput{
		ClaimID:      claimID,
		FlowType:     flowType,
		TBTxID:       tbTxID,
		MojaloopTxID: mojaloopTxID,
	}).Get(ctx, nil)
}
