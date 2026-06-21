// Audit Recovery & Overpayment Refund Workflows — Scenarios 14, 15
// AuditRecoveryWorkflow: post-clearance underpayment recovery
// OverpaymentRefundWorkflow: two-phase refund with TigerBeetle + Mojaloop
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// ─── AUDIT RECOVERY (Scenario 14) ─────────────────────────────────────────────

type AuditRecoveryInput struct {
	AuditID             int64   `json:"audit_id"`
	DeclarationID       int64   `json:"declaration_id"`
	TraderID            string  `json:"trader_id"`
	TraderAccountID     string  `json:"trader_account_id"`
	NCSRevenueAccountID string  `json:"ncs_revenue_account_id"`
	UnderpaidMinor      int64   `json:"underpaid_minor"`
	Currency            string  `json:"currency"`
	Ledger              uint32  `json:"ledger"`
	DemandNoticeRef     string  `json:"demand_notice_ref"`
	OfficerID           string  `json:"officer_id"`
	PaymentDeadline     string  `json:"payment_deadline"` // ISO 8601
}

type AuditRecoveryResult struct {
	AuditID         int64     `json:"audit_id"`
	Status          string    `json:"status"` // "recovered" | "failed" | "escalated"
	TigerBeetleTxID string    `json:"tigerbeetle_tx_id,omitempty"`
	MojaloopTxID    string    `json:"mojaloop_tx_id,omitempty"`
	CompletedAt     time.Time `json:"completed_at"`
}

// AuditRecoveryWorkflow orchestrates post-clearance underpayment recovery.
// It sends a demand notice, waits for payment (up to deadline), then either
// confirms recovery or escalates to enforcement.
func AuditRecoveryWorkflow(ctx workflow.Context, input AuditRecoveryInput) (*AuditRecoveryResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("AuditRecoveryWorkflow started",
		"auditID", input.AuditID,
		"declarationID", input.DeclarationID,
		"underpaidMinor", input.UnderpaidMinor,
	)

	result := &AuditRecoveryResult{AuditID: input.AuditID}

	// Step 1: Send demand notice to trader
	notifyCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(notifyCtx, SendDemandNoticeActivity, DemandNoticeInput{
		TraderID:        input.TraderID,
		AuditID:         input.AuditID,
		DeclarationID:   input.DeclarationID,
		AmountMinor:     input.UnderpaidMinor,
		Currency:        input.Currency,
		DemandNoticeRef: input.DemandNoticeRef,
		Deadline:        input.PaymentDeadline,
	}).Get(ctx, nil)

	// Step 2: Wait for payment signal or deadline
	paymentSignalCh := workflow.GetSignalChannel(ctx, "audit_recovery_payment_received")
	var paymentReceived bool
	var paymentRef string

	deadlineTime, _ := time.Parse(time.RFC3339, input.PaymentDeadline)
	timeoutCtx, cancel := workflow.WithCancel(ctx)
	defer cancel()

	timerFired := workflow.NewTimer(timeoutCtx, time.Until(deadlineTime))
	selector := workflow.NewSelector(ctx)

	selector.AddReceive(paymentSignalCh, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &paymentRef)
		paymentReceived = true
		cancel()
	})
	selector.AddFuture(timerFired, func(f workflow.Future) {
		paymentReceived = false
	})
	selector.Select(ctx)

	if !paymentReceived {
		// Deadline passed — escalate to enforcement
		escalateCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 10 * time.Second,
			RetryPolicy:         defaultRetryPolicy,
		})
		_ = workflow.ExecuteActivity(escalateCtx, EscalateToEnforcementActivity, EnforcementInput{
			AuditID:       input.AuditID,
			TraderID:      input.TraderID,
			DeclarationID: input.DeclarationID,
			AmountMinor:   input.UnderpaidMinor,
			Reason:        "payment_deadline_exceeded",
		}).Get(ctx, nil)
		result.Status = "escalated"
		result.CompletedAt = workflow.Now(ctx)
		return result, nil
	}

	// Step 3: Payment received — record in TigerBeetle
	tbCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	var tbTransfer TigerBeetleTransferResult
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleTransferActivity, TigerBeetleTransferInput{
		IdempotencyKey:  fmt.Sprintf("audit:recovery:%d:%s", input.AuditID, paymentRef),
		DebitAccountID:  input.TraderAccountID,
		CreditAccountID: input.NCSRevenueAccountID,
		AmountMinor:     input.UnderpaidMinor,
		Ledger:          input.Ledger,
		EntryType:       "audit_recovery",
		DeclarationRef:  fmt.Sprintf("audit:%d:decl:%d", input.AuditID, input.DeclarationID),
	}).Get(ctx, &tbTransfer); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("TigerBeetle audit recovery transfer failed: %w", err)
	}
	result.TigerBeetleTxID = tbTransfer.TransferID

	// Step 4: Publish Kafka event
	kafkaCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(kafkaCtx, PublishKafkaEventActivity, KafkaEventInput{
		Topic: "audit.recovery.completed",
		Key:   fmt.Sprintf("audit:%d", input.AuditID),
		Payload: map[string]interface{}{
			"auditId":         input.AuditID,
			"declarationId":   input.DeclarationID,
			"traderId":        input.TraderID,
			"amountMinor":     input.UnderpaidMinor,
			"tigerBeetleTxId": result.TigerBeetleTxID,
		},
	}).Get(ctx, nil)

	result.Status = "recovered"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─── OVERPAYMENT REFUND (Scenario 15) ─────────────────────────────────────────

type OverpaymentRefundInput struct {
	AuditID             int64  `json:"audit_id"`
	DeclarationID       int64  `json:"declaration_id"`
	TraderID            string `json:"trader_id"`
	TraderAccountID     string `json:"trader_account_id"`
	NCSRevenueAccountID string `json:"ncs_revenue_account_id"`
	OverpaidMinor       int64  `json:"overpaid_minor"`
	Currency            string `json:"currency"`
	Ledger              uint32 `json:"ledger"`
	ApprovedByOfficerID string `json:"approved_by_officer_id"`
}

type OverpaymentRefundResult struct {
	AuditID         int64     `json:"audit_id"`
	Status          string    `json:"status"`
	TigerBeetleTxID string    `json:"tigerbeetle_tx_id,omitempty"`
	MojaloopTxID    string    `json:"mojaloop_tx_id,omitempty"`
	CompletedAt     time.Time `json:"completed_at"`
}

// OverpaymentRefundWorkflow implements the two-phase refund saga:
// TigerBeetle RESERVE → Mojaloop transfer → TigerBeetle COMMIT
// Compensation: if Mojaloop fails, TigerBeetle void restores NCS Revenue.
func OverpaymentRefundWorkflow(ctx workflow.Context, input OverpaymentRefundInput) (*OverpaymentRefundResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("OverpaymentRefundWorkflow started",
		"auditID", input.AuditID,
		"overpaidMinor", input.OverpaidMinor,
	)

	result := &OverpaymentRefundResult{AuditID: input.AuditID}
	idempotencyKey := fmt.Sprintf("overpayment:refund:%d:%s", input.AuditID, input.ApprovedByOfficerID)

	// Step 1: TigerBeetle RESERVE — debit NCS Revenue
	tbCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	var tbReserve TigerBeetleTransferResult
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleReserveActivity, TigerBeetleTransferInput{
		IdempotencyKey:  idempotencyKey + ":reserve",
		DebitAccountID:  input.NCSRevenueAccountID,
		CreditAccountID: input.TraderAccountID,
		AmountMinor:     input.OverpaidMinor,
		Ledger:          input.Ledger,
		EntryType:       "overpayment_reserve",
		DeclarationRef:  fmt.Sprintf("audit:%d:decl:%d", input.AuditID, input.DeclarationID),
	}).Get(ctx, &tbReserve); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("TigerBeetle reserve failed: %w", err)
	}
	result.TigerBeetleTxID = tbReserve.TransferID

	// Step 2: Mojaloop transfer to trader
	var mojResult MojaloopTransferResult
	mojCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 120 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	mojErr := workflow.ExecuteActivity(mojCtx, MojaloopTransferActivity, MojaloopTransferInput{
		TransferID:     fmt.Sprintf("overpay-%d", input.AuditID),
		PayerFSP:       "CUSTOMS_AUTHORITY_DFSP",
		PayeeFSP:       "TRADER_DFSP",
		Amount:         input.OverpaidMinor,
		Currency:       input.Currency,
		DeclarationRef: fmt.Sprintf("overpayment:%d", input.AuditID),
	}).Get(ctx, &mojResult)

	if mojErr != nil || !mojResult.Success {
		// Compensation: void TigerBeetle reserve
		compCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 30 * time.Second,
			RetryPolicy:         criticalRetryPolicy,
		})
		_ = workflow.ExecuteActivity(compCtx, TigerBeetleVoidReserveActivity, TigerBeetleVoidInput{
			ReservedTransferID: tbReserve.TransferID,
			Reason:             "mojaloop_refund_failed",
		}).Get(ctx, nil)
		result.Status = "compensated"
		return result, fmt.Errorf("Mojaloop refund failed: %v", mojErr)
	}
	result.MojaloopTxID = mojResult.TransferID

	// Step 3: TigerBeetle COMMIT
	commitCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	if err := workflow.ExecuteActivity(commitCtx, TigerBeetleCommitActivity, TigerBeetleCommitInput{
		ReservedTransferID: tbReserve.TransferID,
		MojaloopFulfilment: mojResult.Fulfilment,
	}).Get(ctx, nil); err != nil {
		logger.Error("CRITICAL: TigerBeetle commit failed after Mojaloop refund success",
			"auditID", input.AuditID,
			"tbTxID", tbReserve.TransferID,
			"mojaloopTxID", mojResult.TransferID,
		)
		_ = raiseReconciliationAlert(ctx, input.AuditID, "overpayment_refund", tbReserve.TransferID, mojResult.TransferID)
		result.Status = "reconciliation_required"
		return result, nil
	}

	// Step 4: Kafka event
	kafkaCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(kafkaCtx, PublishKafkaEventActivity, KafkaEventInput{
		Topic: "audit.overpayment.refunded",
		Key:   fmt.Sprintf("audit:%d", input.AuditID),
		Payload: map[string]interface{}{
			"auditId":         input.AuditID,
			"declarationId":   input.DeclarationID,
			"traderId":        input.TraderID,
			"amountMinor":     input.OverpaidMinor,
			"tigerBeetleTxId": result.TigerBeetleTxID,
			"mojaloopTxId":    result.MojaloopTxID,
		},
	}).Get(ctx, nil)

	result.Status = "refunded"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}
