// tigerbeetle_lakehouse.go — TigerBeetle financial ledger and Delta Lakehouse
// integration for warehouse-service.
//
// TigerBeetle: Records financial adjustments discovered during post-clearance audit
//              (duty underpayments, overpayments, penalties) as immutable ledger entries.
//              Uses TigerBeetle's gRPC-over-HTTP2 API via the tigerbeetle-go client.
//
// Lakehouse:   Writes audit case records and findings to the Delta Lake via the
//              Lakehouse HTTP ingest API for analytics, compliance reporting, and
//              executive dashboards.
package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"
)

// ─── TigerBeetle Client ───────────────────────────────────────────────────────

type TigerBeetleClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewTigerBeetleClient() *TigerBeetleClient {
	base := os.Getenv("TIGERBEETLE_HTTP_URL")
	if base == "" {
		base = "http://tigerbeetle-bridge:8099"
	}
	return &TigerBeetleClient{
		baseURL:    base,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		logger:     slog.Default().With("component", "tigerbeetle", "service", "warehouse-service"),
	}
}

// TigerBeetleTransfer represents a double-entry transfer in the financial ledger.
type TigerBeetleTransfer struct {
	ID              string `json:"id"`               // UUID v4 → uint128 in TB
	DebitAccountID  string `json:"debit_account_id"` // Trader's duty account
	CreditAccountID string `json:"credit_account_id"` // Government revenue account
	Amount          uint64 `json:"amount"`            // In minor currency units (kobo)
	Ledger          uint32 `json:"ledger"`            // 1 = NGN customs duties
	Code            uint16 `json:"code"`              // 1001=duty, 1002=penalty, 1003=interest
	UserData        string `json:"user_data"`         // JSON: {declaration_id, audit_case_id}
	Flags           uint16 `json:"flags"`             // 0=normal, 2=pending
}

// RecordAuditAdjustment records a financial adjustment discovered during audit.
// Used for duty underpayments (debit trader, credit revenue) or overpayments (reverse).
func (t *TigerBeetleClient) RecordAuditAdjustment(ctx context.Context, transfer TigerBeetleTransfer) error {
	data, _ := json.Marshal(map[string]interface{}{
		"transfers": []TigerBeetleTransfer{transfer},
	})
	url := fmt.Sprintf("%s/transfers", t.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build tigerbeetle request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.httpClient.Do(req)
	if err != nil {
		t.logger.Error("tigerbeetle transfer failed", "transfer_id", transfer.ID, "error", err)
		return fmt.Errorf("tigerbeetle transfer: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("tigerbeetle transfer: status %d", resp.StatusCode)
	}
	t.logger.Info("tigerbeetle audit adjustment recorded",
		"transfer_id", transfer.ID,
		"amount", transfer.Amount,
		"code", transfer.Code)
	return nil
}

// GetAccountBalance retrieves the current balance of a trader's duty account.
func (t *TigerBeetleClient) GetAccountBalance(ctx context.Context, accountID string) (uint64, error) {
	url := fmt.Sprintf("%s/accounts/%s/balance", t.baseURL, accountID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := t.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("get account balance: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		DebitsPosted  uint64 `json:"debits_posted"`
		CreditsPosted uint64 `json:"credits_posted"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, nil
	}
	return result.CreditsPosted - result.DebitsPosted, nil
}

// ─── Lakehouse Client ─────────────────────────────────────────────────────────

type LakehouseClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewLakehouseClient() *LakehouseClient {
	base := os.Getenv("LAKEHOUSE_HTTP_URL")
	if base == "" {
		base = "http://lakehouse-ingest:8097"
	}
	return &LakehouseClient{
		baseURL:    base,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     slog.Default().With("component", "lakehouse", "service", "warehouse-service"),
	}
}

// AuditCaseRecord is the schema for the audit_cases Delta table.
type AuditCaseRecord struct {
	AuditCaseID    string    `json:"audit_case_id"`
	DeclarationID  string    `json:"declaration_id"`
	UCR            string    `json:"ucr"`
	TraderID       string    `json:"trader_id"`
	TraderName     string    `json:"trader_name"`
	HSCode         string    `json:"hs_code"`
	CustomsValue   float64   `json:"customs_value"`
	DutyPaid       float64   `json:"duty_paid"`
	DutyAssessed   float64   `json:"duty_assessed"`
	Discrepancy    float64   `json:"discrepancy"`
	RiskScore      float64   `json:"risk_score"`
	SelectionBasis string    `json:"selection_basis"` // RANDOM, RISK_BASED, INTELLIGENCE
	Status         string    `json:"status"`          // OPEN, IN_PROGRESS, CLOSED, ESCALATED
	Findings       string    `json:"findings"`        // JSON array of findings
	OfficerID      string    `json:"officer_id"`
	OpenedAt       time.Time `json:"opened_at"`
	ClosedAt       *time.Time `json:"closed_at,omitempty"`
	PartitionDate  string    `json:"partition_date"` // YYYY-MM-DD for Delta partitioning
}

// IngestAuditCase writes an audit case record to the Delta Lake audit_cases table.
func (l *LakehouseClient) IngestAuditCase(ctx context.Context, record AuditCaseRecord) error {
	if record.PartitionDate == "" {
		record.PartitionDate = record.OpenedAt.Format("2006-01-02")
	}
	payload := map[string]interface{}{
		"table":   "audit_cases",
		"records": []AuditCaseRecord{record},
	}
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/ingest", l.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build lakehouse request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := l.httpClient.Do(req)
	if err != nil {
		l.logger.Warn("lakehouse ingest failed (non-fatal)", "table", "audit_cases", "error", err)
		return nil // Non-fatal: primary store is PostgreSQL
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		l.logger.Warn("lakehouse ingest non-2xx", "status", resp.StatusCode)
		return nil
	}
	l.logger.Info("audit case ingested to lakehouse", "audit_case_id", record.AuditCaseID)
	return nil
}

// IngestAuditFinding writes individual audit findings to the audit_findings Delta table.
func (l *LakehouseClient) IngestAuditFinding(ctx context.Context, finding map[string]interface{}) error {
	finding["partition_date"] = time.Now().Format("2006-01-02")
	payload := map[string]interface{}{
		"table":   "audit_findings",
		"records": []map[string]interface{}{finding},
	}
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/ingest", l.baseURL)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	resp, err := l.httpClient.Do(req)
	if err != nil {
		l.logger.Warn("lakehouse finding ingest failed", "error", err)
		return nil
	}
	defer resp.Body.Close()
	return nil
}

// ─── Combined Financial + Analytics Clients ───────────────────────────────────

type FinancialAnalyticsClients struct {
	TigerBeetle *TigerBeetleClient
	Lakehouse   *LakehouseClient
}

func NewFinancialAnalyticsClients() *FinancialAnalyticsClients {
	return &FinancialAnalyticsClients{
		TigerBeetle: NewTigerBeetleClient(),
		Lakehouse:   NewLakehouseClient(),
	}
}
