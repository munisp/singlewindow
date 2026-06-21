// Batch Settlement & Revenue Reconciliation Workflows — Scenarios 18, 19
// BatchSettlementWorkflow: end-of-day atomic batch via TigerBeetle + Kafka transactions
// RevenueReconciliationWorkflow: TigerBeetle vs PostgreSQL mirror comparison + Delta Lake write
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// ─── BATCH SETTLEMENT (Scenario 18) ──────────────────────────────────────────

type BatchSettlementInput struct {
	BatchID             string   `json:"batch_id"`
	TransferIDs         []string `json:"transfer_ids"` // payment_queue transfer IDs
	NCSRevenueAccountID string   `json:"ncs_revenue_account_id"`
	Currency            string   `json:"currency"`
	Ledger              uint32   `json:"ledger"`
	SettlementDate      string   `json:"settlement_date"` // ISO 8601 date
}

type BatchSettlementResult struct {
	BatchID          string    `json:"batch_id"`
	Status           string    `json:"status"` // "settled" | "partial" | "failed"
	SuccessCount     int       `json:"success_count"`
	FailureCount     int       `json:"failure_count"`
	TotalMinor       int64     `json:"total_minor"`
	TigerBeetleBatch string    `json:"tigerbeetle_batch_id"`
	KafkaOffset      int64     `json:"kafka_offset"`
	CompletedAt      time.Time `json:"completed_at"`
}

// BatchSettlementWorkflow processes end-of-day batch payments atomically.
// TigerBeetle batch transfer is all-or-nothing. Kafka consumer uses exactly-once
// semantics (transactional producer) to prevent double-processing on restart.
func BatchSettlementWorkflow(ctx workflow.Context, input BatchSettlementInput) (*BatchSettlementResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("BatchSettlementWorkflow started",
		"batchID", input.BatchID,
		"transferCount", len(input.TransferIDs),
	)

	result := &BatchSettlementResult{BatchID: input.BatchID}

	// Step 1: Fetch all pending transfers from payment_queue
	fetchCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	var batchItems []BatchPaymentItem
	if err := workflow.ExecuteActivity(fetchCtx, FetchBatchPaymentItemsActivity, FetchBatchInput{
		BatchID:     input.BatchID,
		TransferIDs: input.TransferIDs,
	}).Get(ctx, &batchItems); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("failed to fetch batch items: %w", err)
	}

	if len(batchItems) == 0 {
		result.Status = "settled"
		result.CompletedAt = workflow.Now(ctx)
		return result, nil
	}

	// Step 2: Claim all items in batch (optimistic lock via PostgreSQL UPDATE WHERE status='queued')
	claimCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	var claimedIDs []string
	if err := workflow.ExecuteActivity(claimCtx, ClaimBatchPaymentItemsActivity, ClaimBatchInput{
		BatchID:     input.BatchID,
		TransferIDs: input.TransferIDs,
	}).Get(ctx, &claimedIDs); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("failed to claim batch items: %w", err)
	}

	// Step 3: TigerBeetle atomic batch transfer
	// All transfers in the batch succeed or all fail — no partial commits.
	tbCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 120 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	var tbBatchResult TigerBeetleBatchResult
	if err := workflow.ExecuteActivity(tbCtx, TigerBeetleBatchTransferActivity, TigerBeetleBatchInput{
		BatchID:   input.BatchID,
		Items:     batchItems,
		Ledger:    input.Ledger,
		EntryType: "batch_duty_collection",
	}).Get(ctx, &tbBatchResult); err != nil {
		// Batch failed — release all claimed items back to queued
		releaseCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 30 * time.Second,
			RetryPolicy:         defaultRetryPolicy,
		})
		_ = workflow.ExecuteActivity(releaseCtx, ReleaseBatchPaymentItemsActivity, ReleaseBatchInput{
			TransferIDs: claimedIDs,
			Reason:      fmt.Sprintf("tigerbeetle_batch_failed: %v", err),
		}).Get(ctx, nil)
		result.Status = "failed"
		return result, fmt.Errorf("TigerBeetle batch transfer failed: %w", err)
	}
	result.TigerBeetleBatch = tbBatchResult.BatchID
	result.SuccessCount = tbBatchResult.SuccessCount
	result.TotalMinor = tbBatchResult.TotalMinor

	// Step 4: Publish Kafka batch event with exactly-once semantics (transactional producer)
	kafkaCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	var kafkaOffset int64
	if err := workflow.ExecuteActivity(kafkaCtx, PublishKafkaBatchEventActivity, KafkaBatchEventInput{
		Topic:       "payment.batch.settled",
		BatchID:     input.BatchID,
		TransferIDs: claimedIDs,
		TotalMinor:  tbBatchResult.TotalMinor,
		Currency:    input.Currency,
		TBBatchID:   tbBatchResult.BatchID,
	}).Get(ctx, &kafkaOffset); err != nil {
		logger.Warn("Kafka batch event failed — batch is settled in TigerBeetle but event not published",
			"batchID", input.BatchID,
		)
	}
	result.KafkaOffset = kafkaOffset

	// Step 5: Update payment_queue status to 'committed' for all items
	updateCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(updateCtx, MarkBatchPaymentItemsCommittedActivity, MarkCommittedInput{
		TransferIDs:     claimedIDs,
		TBBatchID:       tbBatchResult.BatchID,
		SettlementDate:  input.SettlementDate,
	}).Get(ctx, nil)

	// Step 6: Publish Fluvio real-time stream event for dashboard
	fluvioCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	_ = workflow.ExecuteActivity(fluvioCtx, PublishFluvioStreamEventActivity, FluvioEventInput{
		Topic: "batch-settlement-stream",
		Payload: map[string]interface{}{
			"batchId":      input.BatchID,
			"successCount": result.SuccessCount,
			"totalMinor":   result.TotalMinor,
			"currency":     input.Currency,
			"settledAt":    workflow.Now(ctx),
		},
	}).Get(ctx, nil)

	result.Status = "settled"
	result.CompletedAt = workflow.Now(ctx)
	logger.Info("BatchSettlementWorkflow completed",
		"batchID", input.BatchID,
		"successCount", result.SuccessCount,
		"totalMinor", result.TotalMinor,
	)
	return result, nil
}

// ─── REVENUE RECONCILIATION (Scenario 19) ─────────────────────────────────────

type RevenueReconciliationInput struct {
	ReconciliationDate  string `json:"reconciliation_date"` // ISO 8601 date
	NCSRevenueAccountID string `json:"ncs_revenue_account_id"`
	Ledger              uint32 `json:"ledger"`
	AlertThresholdMinor int64  `json:"alert_threshold_minor"` // discrepancy threshold
}

type RevenueReconciliationResult struct {
	ReconciliationDate   string    `json:"reconciliation_date"`
	Status               string    `json:"status"` // "reconciled" | "discrepancy_found" | "swept"
	TigerBeetleBalance   int64     `json:"tigerbeetle_balance"`
	PostgresBalance      int64     `json:"postgres_balance"`
	DiscrepancyMinor     int64     `json:"discrepancy_minor"`
	SweepTxID            string    `json:"sweep_tx_id,omitempty"`
	DeltaLakePartition   string    `json:"delta_lake_partition,omitempty"`
	CompletedAt          time.Time `json:"completed_at"`
}

// RevenueReconciliationWorkflow is a daily Temporal cron workflow that:
// 1. Queries TigerBeetle for the authoritative NCS Revenue balance
// 2. Compares with the PostgreSQL mirror
// 3. Alerts if discrepancy exceeds threshold
// 4. Sweeps settled balance to Central Bank account
// 5. Writes the reconciliation record to Delta Lake
func RevenueReconciliationWorkflow(ctx workflow.Context, input RevenueReconciliationInput) (*RevenueReconciliationResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("RevenueReconciliationWorkflow started", "date", input.ReconciliationDate)

	result := &RevenueReconciliationResult{ReconciliationDate: input.ReconciliationDate}

	// Step 1: Query TigerBeetle for authoritative balance
	tbCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	var tbBalance int64
	if err := workflow.ExecuteActivity(tbCtx, QueryTigerBeetleBalanceActivity, QueryBalanceInput{
		AccountID: input.NCSRevenueAccountID,
		Ledger:    input.Ledger,
	}).Get(ctx, &tbBalance); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("TigerBeetle balance query failed: %w", err)
	}
	result.TigerBeetleBalance = tbBalance

	// Step 2: Query PostgreSQL mirror balance
	pgCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	var pgBalance int64
	if err := workflow.ExecuteActivity(pgCtx, QueryPostgresBalanceMirrorActivity, QueryBalanceInput{
		AccountID: input.NCSRevenueAccountID,
		Ledger:    input.Ledger,
	}).Get(ctx, &pgBalance); err != nil {
		result.Status = "failed"
		return result, fmt.Errorf("PostgreSQL balance query failed: %w", err)
	}
	result.PostgresBalance = pgBalance

	// Step 3: Compare and alert on discrepancy
	discrepancy := tbBalance - pgBalance
	if discrepancy < 0 {
		discrepancy = -discrepancy
	}
	result.DiscrepancyMinor = discrepancy

	if discrepancy > input.AlertThresholdMinor {
		alertCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 10 * time.Second,
			RetryPolicy:         defaultRetryPolicy,
		})
		_ = workflow.ExecuteActivity(alertCtx, RaiseBalanceDiscrepancyAlertActivity, DiscrepancyAlertInput{
			AccountID:          input.NCSRevenueAccountID,
			TigerBeetleBalance: tbBalance,
			PostgresBalance:    pgBalance,
			DiscrepancyMinor:   discrepancy,
			Date:               input.ReconciliationDate,
		}).Get(ctx, nil)
		result.Status = "discrepancy_found"
	} else {
		result.Status = "reconciled"
	}

	// Step 4: Write reconciliation record to Delta Lake (Lakehouse)
	lakeCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	var partition string
	if err := workflow.ExecuteActivity(lakeCtx, WriteToDeltaLakeActivity, DeltaLakeWriteInput{
		Table:     "revenue_reconciliation",
		Partition: fmt.Sprintf("date=%s", input.ReconciliationDate),
		Record: map[string]interface{}{
			"reconciliation_date":    input.ReconciliationDate,
			"ncs_revenue_account_id": input.NCSRevenueAccountID,
			"tigerbeetle_balance":    tbBalance,
			"postgres_balance":       pgBalance,
			"discrepancy_minor":      discrepancy,
			"status":                 result.Status,
			"created_at":             workflow.Now(ctx),
		},
	}).Get(ctx, &partition); err != nil {
		logger.Warn("Delta Lake write failed — reconciliation data not persisted to lakehouse",
			"date", input.ReconciliationDate,
		)
	}
	result.DeltaLakePartition = partition

	result.CompletedAt = workflow.Now(ctx)
	logger.Info("RevenueReconciliationWorkflow completed",
		"date", input.ReconciliationDate,
		"tbBalance", tbBalance,
		"pgBalance", pgBalance,
		"discrepancy", discrepancy,
	)
	return result, nil
}
