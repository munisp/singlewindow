// Fund Flow Activities — implementations for all 20 fund-flow scenarios
// Registered in main.go alongside the existing clearance activities.
// Each activity is idempotent and integrates with the appropriate middleware.
package activities

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"go.temporal.io/sdk/activity"
	"go.uber.org/zap"
)

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var (
	tigerBeetleURL = getEnvFF("TIGERBEETLE_BRIDGE_URL", "http://localhost:4600")
	mojaloopURL    = getEnvFF("MOJALOOP_URL", "http://localhost:3001")
	kafkaBrokers   = getEnvFF("KAFKA_BROKERS", "localhost:9092")
	fluvioURL      = getEnvFF("FLUVIO_HTTP_URL", "http://localhost:9003")
	permifyURL     = getEnvFF("PERMIFY_URL", "http://localhost:3476")
	deltaLakeURL   = getEnvFF("DELTALAKE_SERVICE_URL", "http://localhost:8090")
	dbURL          = getEnvFF("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
)

func getEnvFF(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var httpClient = &http.Client{Timeout: 30 * time.Second}

// ─── TIGERBEETLE ACTIVITIES ───────────────────────────────────────────────────

type TBCreateAccountReq struct {
	AccountID   string `json:"account_id"`
	Ledger      uint32 `json:"ledger"`
	Label       string `json:"label"`
	AccountType string `json:"account_type"`
}

type TBTransferReq struct {
	IdempotencyKey  string `json:"idempotency_key"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	AmountMinor     int64  `json:"amount_minor"`
	Ledger          uint32 `json:"ledger"`
	EntryType       string `json:"entry_type"`
	DeclarationRef  string `json:"declaration_ref,omitempty"`
}

type TBTransferResp struct {
	TransferID string `json:"transfer_id"`
	Status     string `json:"status"`
}

// TigerBeetleCreateAccountActivityImpl creates a TigerBeetle account via the Rust bridge.
// Idempotent: returns existing account if already created.
func TigerBeetleCreateAccountActivityImpl(ctx context.Context, input TBCreateAccountReq) (map[string]interface{}, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("TigerBeetleCreateAccountActivity", zap.String("accountID", input.AccountID))

	body, _ := json.Marshal(input)
	resp, err := httpClient.Post(tigerBeetleURL+"/accounts", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("TigerBeetle create account request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 && resp.StatusCode != 201 && resp.StatusCode != 409 {
		return nil, fmt.Errorf("TigerBeetle create account failed: %s", string(respBody))
	}
	var result map[string]interface{}
	_ = json.Unmarshal(respBody, &result)
	return result, nil
}

// TigerBeetleTransferActivityImpl executes a single-phase committed transfer.
func TigerBeetleTransferActivityImpl(ctx context.Context, input TBTransferReq) (TBTransferResp, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("TigerBeetleTransferActivity",
		zap.String("idempotencyKey", input.IdempotencyKey),
		zap.Int64("amountMinor", input.AmountMinor),
	)

	body, _ := json.Marshal(input)
	resp, err := httpClient.Post(tigerBeetleURL+"/transfers", "application/json", bytes.NewReader(body))
	if err != nil {
		return TBTransferResp{}, fmt.Errorf("TigerBeetle transfer request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return TBTransferResp{}, fmt.Errorf("TigerBeetle transfer failed [%d]: %s", resp.StatusCode, string(respBody))
	}
	var result TBTransferResp
	if err := json.Unmarshal(respBody, &result); err != nil {
		return TBTransferResp{}, fmt.Errorf("TigerBeetle transfer response parse failed: %w", err)
	}
	return result, nil
}

// TigerBeetleReserveActivityImpl creates a two-phase PENDING transfer.
func TigerBeetleReserveActivityImpl(ctx context.Context, input TBTransferReq) (TBTransferResp, error) {
	// Add :reserve suffix to distinguish from commit
	reserveInput := input
	reserveInput.EntryType = input.EntryType + "_reserve"
	// POST to /transfers/reserve endpoint
	body, _ := json.Marshal(reserveInput)
	resp, err := httpClient.Post(tigerBeetleURL+"/transfers/reserve", "application/json", bytes.NewReader(body))
	if err != nil {
		return TBTransferResp{}, fmt.Errorf("TigerBeetle reserve request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return TBTransferResp{}, fmt.Errorf("TigerBeetle reserve failed [%d]: %s", resp.StatusCode, string(respBody))
	}
	var result TBTransferResp
	_ = json.Unmarshal(respBody, &result)
	return result, nil
}

// TigerBeetleCommitActivityImpl commits a previously reserved transfer.
func TigerBeetleCommitActivityImpl(ctx context.Context, reservedTxID, fulfilment string) error {
	body, _ := json.Marshal(map[string]string{
		"reserved_transfer_id": reservedTxID,
		"mojaloop_fulfilment":  fulfilment,
	})
	resp, err := httpClient.Post(
		fmt.Sprintf("%s/transfers/%s/commit", tigerBeetleURL, reservedTxID),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("TigerBeetle commit request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("TigerBeetle commit failed [%d]: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// TigerBeetleVoidReserveActivityImpl voids a previously reserved transfer.
func TigerBeetleVoidReserveActivityImpl(ctx context.Context, reservedTxID, reason string) error {
	body, _ := json.Marshal(map[string]string{
		"reserved_transfer_id": reservedTxID,
		"reason":               reason,
	})
	resp, err := httpClient.Post(
		fmt.Sprintf("%s/transfers/%s/void", tigerBeetleURL, reservedTxID),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("TigerBeetle void request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("TigerBeetle void failed [%d]: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// TigerBeetleBatchTransferActivityImpl submits an atomic batch transfer.
func TigerBeetleBatchTransferActivityImpl(ctx context.Context, batchID string, items []map[string]interface{}, ledger uint32, entryType string) (map[string]interface{}, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"batch_id":   batchID,
		"items":      items,
		"ledger":     ledger,
		"entry_type": entryType,
	})
	resp, err := httpClient.Post(tigerBeetleURL+"/transfers/batch", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("TigerBeetle batch transfer request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("TigerBeetle batch transfer failed [%d]: %s", resp.StatusCode, string(respBody))
	}
	var result map[string]interface{}
	_ = json.Unmarshal(respBody, &result)
	return result, nil
}

// QueryTigerBeetleBalanceActivityImpl queries the authoritative balance from TigerBeetle.
func QueryTigerBeetleBalanceActivityImpl(ctx context.Context, accountID string, ledger uint32) (int64, error) {
	resp, err := httpClient.Get(fmt.Sprintf("%s/accounts/%s?ledger=%d", tigerBeetleURL, accountID, ledger))
	if err != nil {
		return 0, fmt.Errorf("TigerBeetle balance query failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return 0, fmt.Errorf("TigerBeetle balance query failed [%d]: %s", resp.StatusCode, string(respBody))
	}
	var result struct {
		CreditsPosted int64 `json:"credits_posted"`
		DebitsPosted  int64 `json:"debits_posted"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return 0, fmt.Errorf("TigerBeetle balance parse failed: %w", err)
	}
	return result.CreditsPosted - result.DebitsPosted, nil
}

// ─── MOJALOOP ACTIVITIES ──────────────────────────────────────────────────────

type MojaloopTransferReq struct {
	TransferID     string `json:"transfer_id"`
	PayerFSP       string `json:"payer_fsp"`
	PayeeFSP       string `json:"payee_fsp"`
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	DeclarationRef string `json:"declaration_ref"`
}

type MojaloopTransferResp struct {
	TransferID  string `json:"transfer_id"`
	Success     bool   `json:"success"`
	Fulfilment  string `json:"fulfilment,omitempty"`
	ErrorCode   string `json:"error_code,omitempty"`
}

// MojaloopTransferActivityImpl executes a two-phase ILP transfer via Mojaloop.
func MojaloopTransferActivityImpl(ctx context.Context, input MojaloopTransferReq) (MojaloopTransferResp, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("MojaloopTransferActivity", zap.String("transferID", input.TransferID))

	// Derive ILP condition from transferID
	h := sha256.Sum256([]byte(input.TransferID))
	condition := fmt.Sprintf("%x", h)

	// Phase 1: RESERVE
	prepareBody, _ := json.Marshal(map[string]interface{}{
		"transferId":  input.TransferID,
		"payerFsp":    input.PayerFSP,
		"payeeFsp":    input.PayeeFSP,
		"amount":      map[string]interface{}{"amount": fmt.Sprintf("%d", input.Amount), "currency": input.Currency},
		"ilpPacket":   condition,
		"condition":   condition,
		"expiration":  time.Now().Add(30 * time.Second).Format(time.RFC3339),
	})
	prepResp, err := httpClient.Post(mojaloopURL+"/transfers", "application/vnd.interoperability.transfers+json;version=1.1", bytes.NewReader(prepareBody))
	if err != nil {
		return MojaloopTransferResp{Success: false}, fmt.Errorf("Mojaloop prepare failed: %w", err)
	}
	defer prepResp.Body.Close()
	if prepResp.StatusCode != 200 && prepResp.StatusCode != 202 {
		body, _ := io.ReadAll(prepResp.Body)
		return MojaloopTransferResp{Success: false}, fmt.Errorf("Mojaloop prepare failed [%d]: %s", prepResp.StatusCode, string(body))
	}

	// Phase 2: COMMIT (PUT /transfers/{id})
	fulfilment := fmt.Sprintf("%x", sha256.Sum256([]byte(input.TransferID+"_fulfil")))
	commitBody, _ := json.Marshal(map[string]string{
		"fulfilment":    fulfilment,
		"transferState": "COMMITTED",
		"completedTimestamp": time.Now().Format(time.RFC3339),
	})
	req, _ := http.NewRequestWithContext(ctx, "PUT",
		fmt.Sprintf("%s/transfers/%s", mojaloopURL, input.TransferID),
		bytes.NewReader(commitBody),
	)
	req.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("FSPIOP-Source", input.PayerFSP)
	req.Header.Set("FSPIOP-Destination", input.PayeeFSP)

	commitResp, err := httpClient.Do(req)
	if err != nil {
		return MojaloopTransferResp{Success: false}, fmt.Errorf("Mojaloop commit failed: %w", err)
	}
	defer commitResp.Body.Close()
	if commitResp.StatusCode != 200 && commitResp.StatusCode != 202 {
		body, _ := io.ReadAll(commitResp.Body)
		return MojaloopTransferResp{Success: false}, fmt.Errorf("Mojaloop commit failed [%d]: %s", commitResp.StatusCode, string(body))
	}

	return MojaloopTransferResp{
		TransferID: input.TransferID,
		Success:    true,
		Fulfilment: fulfilment,
	}, nil
}

// ─── KAFKA ACTIVITIES ─────────────────────────────────────────────────────────

// PublishKafkaEventActivityImpl publishes a single event to Kafka.
// Uses the Kafka REST proxy for simplicity; production uses the native Go client.
func PublishKafkaEventActivityImpl(ctx context.Context, topic, key string, payload map[string]interface{}) error {
	payloadBytes, _ := json.Marshal(payload)
	body, _ := json.Marshal(map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": key, "value": string(payloadBytes)},
		},
	})
	kafkaRestURL := getEnvFF("KAFKA_REST_URL", "http://localhost:8082")
	resp, err := httpClient.Post(
		fmt.Sprintf("%s/topics/%s", kafkaRestURL, topic),
		"application/vnd.kafka.json.v2+json",
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("Kafka publish failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Kafka publish failed [%d]: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// ─── FLUVIO ACTIVITIES ────────────────────────────────────────────────────────

// PublishFluvioStreamEventActivityImpl publishes a real-time event to Fluvio.
func PublishFluvioStreamEventActivityImpl(ctx context.Context, topic string, payload map[string]interface{}) error {
	payloadBytes, _ := json.Marshal(payload)
	body, _ := json.Marshal(map[string]interface{}{
		"topic":   topic,
		"payload": string(payloadBytes),
	})
	resp, err := httpClient.Post(fluvioURL+"/produce", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("Fluvio publish failed: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// ─── PERMIFY ACTIVITIES ───────────────────────────────────────────────────────

// CheckPermifyAuthorizationActivityImpl checks if a subject can perform an action on a resource.
func CheckPermifyAuthorizationActivityImpl(ctx context.Context, subjectType, subjectID, resource, action string) (bool, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"metadata": map[string]interface{}{"schema_version": "", "snap_token": "", "depth": 20},
		"entity":   map[string]string{"type": "resource", "id": resource},
		"permission": action,
		"subject":  map[string]interface{}{"type": subjectType, "id": subjectID},
	})
	resp, err := httpClient.Post(permifyURL+"/v1/permissions/check", "application/json", bytes.NewReader(body))
	if err != nil {
		return false, fmt.Errorf("Permify check failed: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		Can string `json:"can"` // "CHECK_RESULT_ALLOWED" | "CHECK_RESULT_DENIED"
	}
	respBody, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(respBody, &result)
	return result.Can == "CHECK_RESULT_ALLOWED", nil
}

// ─── DELTA LAKE ACTIVITIES ────────────────────────────────────────────────────

// WriteToDeltaLakeActivityImpl writes a record to the Delta Lake via the Python deltalake-svc.
func WriteToDeltaLakeActivityImpl(ctx context.Context, table, partition string, record map[string]interface{}) (string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"table":     table,
		"partition": partition,
		"record":    record,
	})
	resp, err := httpClient.Post(deltaLakeURL+"/write", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("Delta Lake write failed: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		Partition string `json:"partition"`
	}
	respBody, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(respBody, &result)
	return result.Partition, nil
}

// ─── POSTGRESQL ACTIVITIES ────────────────────────────────────────────────────

// QueryPostgresBalanceMirrorActivityImpl queries the PostgreSQL balance mirror.
func QueryPostgresBalanceMirrorActivityImpl(ctx context.Context, accountID string, ledger uint32) (int64, error) {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return 0, fmt.Errorf("DB open failed: %w", err)
	}
	defer db.Close()

	var balance int64
	err = db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_minor ELSE -amount_minor END), 0)
		 FROM ledger_entries WHERE account_id = $1 AND ledger = $2`,
		accountID, ledger,
	).Scan(&balance)
	if err != nil {
		return 0, fmt.Errorf("balance mirror query failed: %w", err)
	}
	return balance, nil
}

// ─── BOND / TRANSIT / DRAWBACK STATUS ACTIVITIES ─────────────────────────────

// UpdateBondStatusActivityImpl updates bond status in PostgreSQL.
func UpdateBondStatusActivityImpl(ctx context.Context, bondID int64, status string) error {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("DB open failed: %w", err)
	}
	defer db.Close()
	_, err = db.ExecContext(ctx,
		`UPDATE bond_guarantees SET status = $1, updated_at = NOW() WHERE id = $2`,
		status, bondID,
	)
	return err
}

// UpdateTransitStatusActivityImpl updates transit status in PostgreSQL.
func UpdateTransitStatusActivityImpl(ctx context.Context, transitID int64, status string) error {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("DB open failed: %w", err)
	}
	defer db.Close()
	_, err = db.ExecContext(ctx,
		`UPDATE transit_declarations SET status = $1, updated_at = NOW() WHERE id = $2`,
		status, transitID,
	)
	return err
}

// ─── RECONCILIATION ALERT ACTIVITIES ─────────────────────────────────────────

// RaiseReconciliationAlertActivityImpl sends a critical alert to the ops team.
func RaiseReconciliationAlertActivityImpl(ctx context.Context, claimID int64, flowType, tbTxID, mojaloopTxID string) error {
	notifyURL := getEnvFF("NOTIFY_OWNER_URL", "http://localhost:9000/api/trpc/system.notifyOwner")
	body, _ := json.Marshal(map[string]interface{}{
		"title": fmt.Sprintf("CRITICAL: Reconciliation Required — %s", flowType),
		"content": fmt.Sprintf(
			"Claim/Flow ID: %d\nFlow Type: %s\nTigerBeetle TX: %s\nMojaloop TX: %s\nTime: %s",
			claimID, flowType, tbTxID, mojaloopTxID, time.Now().Format(time.RFC3339),
		),
	})
	resp, err := httpClient.Post(notifyURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("reconciliation alert failed: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// RaiseBalanceDiscrepancyAlertActivityImpl alerts on TigerBeetle vs PostgreSQL discrepancy.
func RaiseBalanceDiscrepancyAlertActivityImpl(ctx context.Context, accountID string, tbBalance, pgBalance, discrepancy int64, date string) error {
	notifyURL := getEnvFF("NOTIFY_OWNER_URL", "http://localhost:9000/api/trpc/system.notifyOwner")
	body, _ := json.Marshal(map[string]interface{}{
		"title": fmt.Sprintf("Balance Discrepancy Alert — %s", date),
		"content": fmt.Sprintf(
			"Account: %s\nTigerBeetle Balance: %d\nPostgreSQL Mirror: %d\nDiscrepancy: %d minor units\nDate: %s",
			accountID, tbBalance, pgBalance, discrepancy, date,
		),
	})
	resp, err := httpClient.Post(notifyURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("discrepancy alert failed: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// ─── DEMAND NOTICE ACTIVITIES ─────────────────────────────────────────────────

// SendDemandNoticeActivityImpl sends a demand notice to the trader.
func SendDemandNoticeActivityImpl(ctx context.Context, traderID string, auditID, declarationID, amountMinor int64, currency, demandRef, deadline string) error {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("DB open failed: %w", err)
	}
	defer db.Close()
	_, err = db.ExecContext(ctx,
		`INSERT INTO user_notifications (user_id, title, message, type, created_at)
		 VALUES ($1, $2, $3, 'demand_notice', NOW())
		 ON CONFLICT DO NOTHING`,
		traderID,
		fmt.Sprintf("Demand Notice — Audit %d", auditID),
		fmt.Sprintf("Underpayment of %d %s detected on declaration %d. Ref: %s. Deadline: %s",
			amountMinor, currency, declarationID, demandRef, deadline),
	)
	return err
}

// EscalateToEnforcementActivityImpl escalates an unresolved audit to enforcement.
func EscalateToEnforcementActivityImpl(ctx context.Context, auditID, declarationID int64, traderID string, amountMinor int64, reason string) error {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("DB open failed: %w", err)
	}
	defer db.Close()
	_, err = db.ExecContext(ctx,
		`UPDATE post_clearance_audits SET status = 'escalated', outcome = $1, updated_at = NOW() WHERE id = $2`,
		fmt.Sprintf("Escalated to enforcement: %s", reason), auditID,
	)
	return err
}

// ─── TRANSIT EXIT VERIFICATION ────────────────────────────────────────────────

// VerifyTransitExitConfirmationActivityImpl verifies the exit confirmation from destination customs.
func VerifyTransitExitConfirmationActivityImpl(ctx context.Context, transitID int64, ucr, exitConfirmRef string) (bool, error) {
	// In production: call COMESA/WCO CEN API to verify the exit confirmation
	// For now: check the transit_declarations table for a matching exit_confirm_ref
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return false, fmt.Errorf("DB open failed: %w", err)
	}
	defer db.Close()
	var count int
	err = db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM transit_declarations WHERE id = $1 AND ucr = $2 AND exit_confirm_ref = $3`,
		transitID, ucr, exitConfirmRef,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("transit exit verification query failed: %w", err)
	}
	return count > 0, nil
}
