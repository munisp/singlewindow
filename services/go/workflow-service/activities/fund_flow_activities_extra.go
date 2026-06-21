// fund_flow_activities_extra.go — Additional activity implementations for v62.
// These complete the registry.go requirements for batch payment and drawback activities.
package activities

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// ─── KAFKA BATCH ACTIVITY ─────────────────────────────────────────────────────

// PublishKafkaBatchEventActivityImpl publishes a batch of events to Kafka and
// returns the number of messages successfully produced.
func PublishKafkaBatchEventActivityImpl(ctx context.Context, topic string, events []map[string]interface{}) (int64, error) {
	type kafkaRecord struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	var records []kafkaRecord
	for i, ev := range events {
		key := fmt.Sprintf("%s-%d-%d", topic, i, time.Now().UnixNano())
		if k, ok := ev["key"].(string); ok && k != "" {
			key = k
		}
		valBytes, _ := json.Marshal(ev)
		records = append(records, kafkaRecord{Key: key, Value: string(valBytes)})
	}
	body, _ := json.Marshal(map[string]interface{}{"records": records})
	kafkaRestURL := getEnvFF("KAFKA_REST_URL", "http://localhost:8082")
	resp, err := httpClient.Post(
		fmt.Sprintf("%s/topics/%s", kafkaRestURL, topic),
		"application/vnd.kafka.json.v2+json",
		bytes.NewReader(body),
	)
	if err != nil {
		// Graceful degradation — log and return 0 (non-fatal for batch)
		return 0, fmt.Errorf("kafka batch produce failed (broker=%s): %w", kafkaRestURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return 0, fmt.Errorf("kafka batch produce failed [%d]", resp.StatusCode)
	}
	return int64(len(records)), nil
}

// ─── DRAWBACK STATUS ACTIVITY ─────────────────────────────────────────────────

// UpdateDrawbackStatusActivityImpl updates the duty_drawback_claims row status.
func UpdateDrawbackStatusActivityImpl(ctx context.Context, claimID int64, status string) error {
	pgURL := getEnvFF("DATABASE_URL", "postgresql://tradegateway:tradegateway@localhost:5432/tradegateway")
	conn, err := pgx.Connect(ctx, pgURL)
	if err != nil {
		return fmt.Errorf("UpdateDrawbackStatus: db connect: %w", err)
	}
	defer conn.Close(ctx)
	_, err = conn.Exec(ctx,
		`UPDATE duty_drawback_claims SET status = $1, updated_at = NOW() WHERE id = $2`,
		status, claimID,
	)
	return err
}

// ─── BATCH PAYMENT ACTIVITIES ─────────────────────────────────────────────────

// FetchBatchPaymentItemsActivityImpl fetches pending payment_queue items for a batch.
func FetchBatchPaymentItemsActivityImpl(ctx context.Context, batchID string, limit int) ([]map[string]interface{}, error) {
	pgURL := getEnvFF("DATABASE_URL", "postgresql://tradegateway:tradegateway@localhost:5432/tradegateway")
	conn, err := pgx.Connect(ctx, pgURL)
	if err != nil {
		return nil, fmt.Errorf("FetchBatchPaymentItems: db connect: %w", err)
	}
	defer conn.Close(ctx)
	rows, err := conn.Query(ctx,
		`SELECT id, declaration_id, amount_minor, currency, status
		 FROM payment_queue
		 WHERE status = 'pending' AND batch_id IS NULL
		 ORDER BY created_at ASC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []map[string]interface{}
	for rows.Next() {
		var id, declarationID, amountMinor int64
		var currency, status string
		if err := rows.Scan(&id, &declarationID, &amountMinor, &currency, &status); err != nil {
			continue
		}
		items = append(items, map[string]interface{}{
			"id":             id,
			"declaration_id": declarationID,
			"amount_minor":   amountMinor,
			"currency":       currency,
			"status":         status,
		})
	}
	return items, nil
}

// ClaimBatchPaymentItemsActivityImpl marks payment_queue rows as claimed for a batch.
func ClaimBatchPaymentItemsActivityImpl(ctx context.Context, batchID string, itemIDs []int64) ([]string, error) {
	pgURL := getEnvFF("DATABASE_URL", "postgresql://tradegateway:tradegateway@localhost:5432/tradegateway")
	conn, err := pgx.Connect(ctx, pgURL)
	if err != nil {
		return nil, fmt.Errorf("ClaimBatchPaymentItems: db connect: %w", err)
	}
	defer conn.Close(ctx)
	var claimed []string
	for _, id := range itemIDs {
		tag, err := conn.Exec(ctx,
			`UPDATE payment_queue SET batch_id = $1, status = 'claimed', updated_at = NOW()
			 WHERE id = $2 AND status = 'pending'`,
			batchID, id,
		)
		if err == nil && tag.RowsAffected() > 0 {
			claimed = append(claimed, fmt.Sprintf("%d", id))
		}
	}
	return claimed, nil
}

// ReleaseBatchPaymentItemsActivityImpl releases claimed items back to pending (saga compensation).
func ReleaseBatchPaymentItemsActivityImpl(ctx context.Context, batchID, reason string) error {
	pgURL := getEnvFF("DATABASE_URL", "postgresql://tradegateway:tradegateway@localhost:5432/tradegateway")
	conn, err := pgx.Connect(ctx, pgURL)
	if err != nil {
		return fmt.Errorf("ReleaseBatchPaymentItems: db connect: %w", err)
	}
	defer conn.Close(ctx)
	_, err = conn.Exec(ctx,
		`UPDATE payment_queue SET batch_id = NULL, status = 'pending', updated_at = NOW()
		 WHERE batch_id = $1 AND status = 'claimed'`,
		batchID,
	)
	return err
}

// MarkBatchPaymentItemsCommittedActivityImpl marks all claimed items as committed.
func MarkBatchPaymentItemsCommittedActivityImpl(ctx context.Context, batchID, tbBatchID, settlementDate string) error {
	pgURL := getEnvFF("DATABASE_URL", "postgresql://tradegateway:tradegateway@localhost:5432/tradegateway")
	conn, err := pgx.Connect(ctx, pgURL)
	if err != nil {
		return fmt.Errorf("MarkBatchPaymentItemsCommitted: db connect: %w", err)
	}
	defer conn.Close(ctx)
	_, err = conn.Exec(ctx,
		`UPDATE payment_queue
		 SET status = 'committed',
		     tb_batch_id = $1,
		     settlement_date = $2,
		     updated_at = NOW()
		 WHERE batch_id = $3 AND status = 'claimed'`,
		tbBatchID, settlementDate, batchID,
	)
	return err
}

// ─── UNUSED IMPORT GUARDS ─────────────────────────────────────────────────────
// Ensure imported packages are used even if some functions are not called in tests.
var _ = sql.Open
var _ = http.Get
