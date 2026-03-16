// activities — Temporal activity implementations for TradeGateway NGSWTP
// Activities are the actual work units called by workflows.
// Each activity communicates with the appropriate microservice via HTTP.
package activities

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
	temporal "go.temporal.io/sdk/temporal"
)

// ── Result types ──────────────────────────────────────────────────────────────

type ValidationResult struct {
	Valid  bool   `json:"valid"`
	Reason string `json:"reason,omitempty"`
}

type RiskResult struct {
	Score float64 `json:"score"`
	Lane  string  `json:"lane"` // "green", "yellow", "red"
}

type OGAResult struct {
	AllApproved bool `json:"allApproved"`
	AnyRejected bool `json:"anyRejected"`
}

type OGAStatus struct {
	AllApproved bool `json:"allApproved"`
	AnyRejected bool `json:"anyRejected"`
	Pending     int  `json:"pending"`
}

type PermitInfo struct {
	PermitId   int64  `json:"permitId"`
	AgencyCode string `json:"agencyCode"`
	Status     string `json:"status"`
}

type PaymentResult struct {
	Confirmed    bool      `json:"confirmed"`
	InvoiceId    int64     `json:"invoiceId"`
	MojaloopTxID string    `json:"mojaloopTxId,omitempty"`
	PaidAt       time.Time `json:"paidAt,omitempty"`
}

type InvoiceInfo struct {
	InvoiceId   int64   `json:"invoiceId"`
	TotalAmount float64 `json:"totalAmount"`
	Currency    string  `json:"currency"`
}

type PaymentStatus struct {
	Confirmed    bool      `json:"confirmed"`
	Failed       bool      `json:"failed"`
	MojaloopTxID string    `json:"mojaloopTxId,omitempty"`
	PaidAt       time.Time `json:"paidAt,omitempty"`
}

type SanctionsResult struct {
	Hit        bool    `json:"hit"`
	ListName   string  `json:"listName,omitempty"`
	MatchScore float64 `json:"matchScore,omitempty"`
}

// ── Activities struct ─────────────────────────────────────────────────────────

type Activities struct {
	db         *sql.DB
	httpClient *http.Client
	// Service base URLs (from environment)
	declarationSvcURL string
	paymentSvcURL     string
	ogaSvcURL         string
	profileSvcURL     string
	riskEngineSvcURL  string
	cargoSvcURL       string
	sanctionsSvcURL   string
}

// activitiesImpl is an alias used for workflow.RegisterActivity
type activitiesImpl = Activities

func New(dbURL string) *Activities {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		panic(fmt.Sprintf("activities: failed to open db: %v", err))
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(3)
	db.SetConnMaxLifetime(5 * time.Minute)

	return &Activities{
		db:                db,
		httpClient:        &http.Client{Timeout: 30 * time.Second},
		declarationSvcURL: getEnv("DECLARATION_SVC_URL", "http://localhost:8081"),
		paymentSvcURL:     getEnv("PAYMENT_SVC_URL", "http://localhost:8082"),
		ogaSvcURL:         getEnv("OGA_SVC_URL", "http://localhost:8083"),
		profileSvcURL:     getEnv("PROFILE_SVC_URL", "http://localhost:8084"),
		riskEngineSvcURL:  getEnv("RISK_ENGINE_SVC_URL", "http://localhost:8085"),
		cargoSvcURL:       getEnv("CARGO_SVC_URL", "http://localhost:8086"),
		sanctionsSvcURL:   getEnv("SANCTIONS_SVC_URL", "http://localhost:8087"),
	}
}

// ── Declaration activities ────────────────────────────────────────────────────

func (a *Activities) ValidateDeclaration(ctx context.Context, declarationId int64) (*ValidationResult, error) {
	var result struct {
		Valid  bool   `json:"valid"`
		Reason string `json:"reason"`
	}
	err := a.get(ctx, fmt.Sprintf("%s/api/declarations/%d/validate", a.declarationSvcURL, declarationId), &result)
	if err != nil {
		// Fallback: check DB directly
		var status string
		a.db.QueryRowContext(ctx, "SELECT status FROM declarations WHERE id = $1", declarationId).Scan(&status)
		return &ValidationResult{Valid: status != "draft" && status != "", Reason: ""}, nil
	}
	return &ValidationResult{Valid: result.Valid, Reason: result.Reason}, nil
}

func (a *Activities) UpdateDeclarationStatus(ctx context.Context, declarationId int64, status, notes string) error {
	_, err := a.db.ExecContext(ctx, `
		UPDATE declarations SET status = $1, officer_notes = COALESCE(NULLIF($2,''), officer_notes), updated_at = NOW()
		WHERE id = $3`, status, notes, declarationId)
	return err
}

func (a *Activities) UpdateRiskScore(ctx context.Context, declarationId int64, score float64, lane string) error {
	_, err := a.db.ExecContext(ctx, `
		UPDATE declarations SET risk_score = $1, risk_lane = $2, updated_at = NOW()
		WHERE id = $3`, score, lane, declarationId)
	return err
}

func (a *Activities) IssueClearance(ctx context.Context, declarationId int64) error {
	clearanceRef := fmt.Sprintf("CLR-%d-%d", declarationId, time.Now().UnixMilli())
	_, err := a.db.ExecContext(ctx, `
		UPDATE declarations
		SET status = 'cleared', clearance_ref = $1, cleared_at = NOW(), updated_at = NOW()
		WHERE id = $2`, clearanceRef, declarationId)
	return err
}

// ── Risk activities ───────────────────────────────────────────────────────────

func (a *Activities) ComputeRiskScore(ctx context.Context, input interface{}) (*RiskResult, error) {
	payload, _ := json.Marshal(input)
	var result RiskResult
	err := a.post(ctx, fmt.Sprintf("%s/api/risk/score", a.riskEngineSvcURL), payload, &result)
	if err != nil {
		// Default to yellow lane if risk engine is unavailable
		return &RiskResult{Score: 50, Lane: "yellow"}, nil
	}
	return &result, nil
}

// ── Sanctions activities ──────────────────────────────────────────────────────

func (a *Activities) ScreenSanctions(ctx context.Context, declarationId, traderId int64) (*SanctionsResult, error) {
	payload, _ := json.Marshal(map[string]int64{"declarationId": declarationId, "traderId": traderId})
	var result SanctionsResult
	err := a.post(ctx, fmt.Sprintf("%s/api/sanctions/screen", a.sanctionsSvcURL), payload, &result)
	if err != nil {
		return &SanctionsResult{Hit: false}, nil // Fail open for availability
	}
	return &result, nil
}

// ── OGA activities ────────────────────────────────────────────────────────────

func (a *Activities) CreateOGAPermits(ctx context.Context, declarationId int64, hsCode string) ([]PermitInfo, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, agency_code, status FROM oga_permits WHERE declaration_id = $1`, declarationId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var permits []PermitInfo
	for rows.Next() {
		p := PermitInfo{}
		rows.Scan(&p.PermitId, &p.AgencyCode, &p.Status)
		permits = append(permits, p)
	}
	return permits, rows.Err()
}

func (a *Activities) CheckOGAPermitStatus(ctx context.Context, declarationId int64) (*OGAStatus, error) {
	row := a.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status = 'pending') as pending,
			COUNT(*) FILTER (WHERE status = 'approved') as approved,
			COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
			COUNT(*) as total
		FROM oga_permits WHERE declaration_id = $1`, declarationId)

	var pending, approved, rejected, total int
	row.Scan(&pending, &approved, &rejected, &total)

	return &OGAStatus{
		AllApproved: total > 0 && approved == total,
		AnyRejected: rejected > 0,
		Pending:     pending,
	}, nil
}

func (a *Activities) EscalateSLABreach(ctx context.Context, declarationId int64) error {
	_, err := a.db.ExecContext(ctx, `
		INSERT INTO audit_log (entity_type, entity_id, action, details, created_at)
		VALUES ('declaration', $1, 'oga_sla_breach', 'OGA SLA breach escalated by Temporal', NOW())`,
		declarationId)
	return err
}

// ── Payment activities ────────────────────────────────────────────────────────

func (a *Activities) CreateDutyInvoice(ctx context.Context, declarationId, traderId int64, declaredValue float64) (*InvoiceInfo, error) {
	// Calculate duties (simplified: 20% CIF value)
	dutyAmount := declaredValue * 0.20
	totalAmount := dutyAmount + (dutyAmount * 0.025) // + 2.5% processing fee

	var invoiceId int64
	err := a.db.QueryRowContext(ctx, `
		INSERT INTO payment_invoices (declaration_id, trader_id, duty_amount, processing_fee, total_amount, currency, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'GHS', 'pending', NOW(), NOW())
		ON CONFLICT (declaration_id) DO UPDATE SET updated_at = NOW()
		RETURNING id`,
		declarationId, traderId, dutyAmount, dutyAmount*0.025, totalAmount).Scan(&invoiceId)
	if err != nil {
		return nil, err
	}
	return &InvoiceInfo{InvoiceId: invoiceId, TotalAmount: totalAmount, Currency: "GHS"}, nil
}

func (a *Activities) CheckPaymentStatus(ctx context.Context, invoiceId int64) (*PaymentStatus, error) {
	row := a.db.QueryRowContext(ctx, `
		SELECT status, mojaloop_tx_id, paid_at FROM payment_invoices WHERE id = $1`, invoiceId)

	var status string
	var mojaloopTxID sql.NullString
	var paidAt sql.NullTime
	row.Scan(&status, &mojaloopTxID, &paidAt)

	return &PaymentStatus{
		Confirmed:    status == "paid",
		Failed:       status == "failed" || status == "expired",
		MojaloopTxID: mojaloopTxID.String,
		PaidAt:       paidAt.Time,
	}, nil
}

// ConfirmPaymentInput holds the parameters for the ConfirmPayment activity.
type ConfirmPaymentInput struct {
	InvoiceID    int64  `json:"invoiceId"`
	MojaloopTxID string `json:"mojaloopTxId"`
	TBTxID       string `json:"tbTxId"`
	Method       string `json:"method"`
}

// ConfirmPaymentResult is returned by the ConfirmPayment activity.
type ConfirmPaymentResult struct {
	InvoiceID int64  `json:"invoiceId"`
	Status    string `json:"status"` // "paid" or "already_confirmed"
}

// ConfirmPayment calls the payment-service /confirm endpoint.
// Returns a non-retryable error on 4xx (bad request / not found).
// Returns a retryable error on 5xx (TigerBeetle unavailable, DB error).
func (a *Activities) ConfirmPayment(ctx context.Context, input ConfirmPaymentInput) (*ConfirmPaymentResult, error) {
	payload, _ := json.Marshal(map[string]string{
		"mojaloopTxId": input.MojaloopTxID,
		"tbTxId":       input.TBTxID,
		"method":       input.Method,
	})
	url := fmt.Sprintf("%s/api/payments/invoices/%d/confirm", a.paymentSvcURL, input.InvoiceID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("build confirm request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.httpClient.Do(req)
	if err != nil {
		// Network error — retryable
		return nil, fmt.Errorf("confirm payment network error: %w", err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		return &ConfirmPaymentResult{InvoiceID: input.InvoiceID, Status: "paid"}, nil
	case resp.StatusCode == http.StatusConflict:
		// 409 = already confirmed (idempotent) — treat as success
		return &ConfirmPaymentResult{InvoiceID: input.InvoiceID, Status: "already_confirmed"}, nil
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		// 4xx = bad request / not found — non-retryable
		return nil, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("confirm payment rejected: HTTP %d", resp.StatusCode),
			"NON_RETRYABLE_PAYMENT_ERROR",
			nil,
		)
	default:
		// 5xx = TigerBeetle / DB error — retryable
		return nil, fmt.Errorf("confirm payment server error: HTTP %d (retryable)", resp.StatusCode)
	}
}

func (a *Activities) SendPaymentReminder(ctx context.Context, traderId, invoiceId int64) error {
	_, err := a.db.ExecContext(ctx, `
		INSERT INTO notifications (user_id, type, title, message, created_at)
		VALUES ($1, 'payment_reminder', 'Payment Reminder', $2, NOW())`,
		traderId, fmt.Sprintf("Invoice #%d is pending payment. Please pay within 48 hours to avoid cancellation.", invoiceId))
	return err
}

func (a *Activities) ExpireInvoice(ctx context.Context, invoiceId int64) error {
	_, err := a.db.ExecContext(ctx, `
		UPDATE payment_invoices SET status = 'expired', updated_at = NOW() WHERE id = $1`, invoiceId)
	return err
}

// ── Cargo activities ──────────────────────────────────────────────────────────

func (a *Activities) NotifyPortOperator(ctx context.Context, declarationId int64) error {
	payload, _ := json.Marshal(map[string]int64{"declarationId": declarationId})
	return a.post(ctx, fmt.Sprintf("%s/api/cargo/notify-release", a.cargoSvcURL), payload, nil)
}

func (a *Activities) CheckCargoReleaseStatus(ctx context.Context, declarationId int64) (bool, error) {
	var released bool
	a.db.QueryRowContext(ctx, `
		SELECT released_at IS NOT NULL FROM cargo_tracking WHERE declaration_id = $1`, declarationId).Scan(&released)
	return released, nil
}

func (a *Activities) EscalateCargoRelease(ctx context.Context, declarationId int64) error {
	_, err := a.db.ExecContext(ctx, `
		INSERT INTO audit_log (entity_type, entity_id, action, details, created_at)
		VALUES ('declaration', $1, 'cargo_release_escalated', 'Cargo release SLA breach escalated', NOW())`,
		declarationId)
	return err
}

// ── Notification activities ───────────────────────────────────────────────────

func (a *Activities) NotifyTrader(ctx context.Context, traderId, declarationId int64, eventType string) error {
	messages := map[string]string{
		"cleared":         "Your customs declaration has been cleared.",
		"cargo_released":  "Your cargo has been released from the port.",
		"audit_scheduled": "A post-clearance audit has been scheduled for your declaration.",
		"payment_pending": "Your duty payment is pending. Please complete payment to proceed.",
	}
	msg := messages[eventType]
	if msg == "" {
		msg = fmt.Sprintf("Declaration %d status update: %s", declarationId, eventType)
	}

	_, err := a.db.ExecContext(ctx, `
		INSERT INTO notifications (user_id, type, title, message, created_at)
		VALUES ($1, $2, 'Declaration Update', $3, NOW())`,
		traderId, eventType, msg)
	return err
}

// ── AEO activities ────────────────────────────────────────────────────────────

func (a *Activities) ValidateAEOEligibility(ctx context.Context, profileId int64) (bool, error) {
	var eligible bool
	a.db.QueryRowContext(ctx, `
		SELECT compliance_score >= 95 AND total_declarations >= 50
		FROM trader_profiles WHERE id = $1`, profileId).Scan(&eligible)
	return eligible, nil
}

func (a *Activities) AssignAEOAuditor(ctx context.Context, profileId int64) error {
	_, err := a.db.ExecContext(ctx, `
		UPDATE trader_profiles SET aeo_status = 'under_audit', updated_at = NOW() WHERE id = $1`, profileId)
	return err
}

func (a *Activities) ReviewAEOAudit(ctx context.Context, profileId int64) (bool, error) {
	// In production: check audit results from auditor portal
	// For now: auto-pass if compliance score >= 95
	var passed bool
	a.db.QueryRowContext(ctx, `
		SELECT compliance_score >= 95 FROM trader_profiles WHERE id = $1`, profileId).Scan(&passed)
	return passed, nil
}

func (a *Activities) GrantAEOCertificate(ctx context.Context, profileId int64, tier string) error {
	_, err := a.db.ExecContext(ctx, `
		UPDATE trader_profiles SET aeo_status = 'certified', aeo_tier = $1, updated_at = NOW()
		WHERE id = $2`, tier, profileId)
	return err
}

func (a *Activities) RejectAEOApplication(ctx context.Context, profileId int64, reason string) error {
	_, err := a.db.ExecContext(ctx, `
		UPDATE trader_profiles SET aeo_status = 'rejected', updated_at = NOW() WHERE id = $1`, profileId)
	return err
}

// ── Duty drawback activities ──────────────────────────────────────────────────

func (a *Activities) VerifyImportDeclaration(ctx context.Context, declarationId int64) (bool, error) {
	var exists bool
	a.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM declarations WHERE id = $1 AND status = 'cleared' AND declaration_type = 'import')`,
		declarationId).Scan(&exists)
	return exists, nil
}

func (a *Activities) VerifyExportDeclaration(ctx context.Context, declarationId int64) error {
	return nil // Simplified
}

func (a *Activities) CalculateDutyDrawback(ctx context.Context, declarationId int64, claimAmount float64) (float64, error) {
	// 99% of duties paid are eligible for drawback
	return claimAmount * 0.99, nil
}

func (a *Activities) ProcessDutyRefund(ctx context.Context, claimId, traderId int64, amount float64) error {
	payload, _ := json.Marshal(map[string]interface{}{
		"claimId":  claimId,
		"traderId": traderId,
		"amount":   amount,
		"type":     "duty_drawback",
	})
	return a.post(ctx, fmt.Sprintf("%s/api/payments/refund", a.paymentSvcURL), payload, nil)
}

// ── Post-clearance audit activities ──────────────────────────────────────────

func (a *Activities) ReviewAuditDocuments(ctx context.Context, auditId int64) ([]string, error) {
	// In production: check audit document review results
	return []string{}, nil // No findings by default
}

func (a *Activities) CloseAudit(ctx context.Context, auditId int64, outcome string) error {
	_, err := a.db.ExecContext(ctx, `
		INSERT INTO audit_log (entity_type, entity_id, action, details, created_at)
		VALUES ('audit', $1, 'audit_closed', $2, NOW())`, auditId, outcome)
	return err
}

func (a *Activities) IssuePenaltyNotice(ctx context.Context, auditId int64, findings []string) error {
	findingsJSON, _ := json.Marshal(findings)
	_, err := a.db.ExecContext(ctx, `
		INSERT INTO audit_log (entity_type, entity_id, action, details, created_at)
		VALUES ('audit', $1, 'penalty_issued', $2, NOW())`, auditId, string(findingsJSON))
	return err
}

// ── ASEAN Single Window activities ────────────────────────────────────────────

func (a *Activities) SendASEANMessage(ctx context.Context, declarationId int64, partnerCountry, messageType, payload string) (string, error) {
	messageId := fmt.Sprintf("ASEAN-%s-%d-%d", partnerCountry, declarationId, time.Now().UnixMilli())
	_, err := a.db.ExecContext(ctx, `
		INSERT INTO asean_messages (message_id, declaration_id, partner_country, message_type, payload, status, created_at)
		VALUES ($1, $2, $3, $4, $5, 'sent', NOW())
		ON CONFLICT (message_id) DO NOTHING`,
		messageId, declarationId, partnerCountry, messageType, payload)
	return messageId, err
}

func (a *Activities) CheckASEANAck(ctx context.Context, messageId string) (bool, error) {
	var acked bool
	a.db.QueryRowContext(ctx, `
		SELECT status = 'acknowledged' FROM asean_messages WHERE message_id = $1`, messageId).Scan(&acked)
	return acked, nil
}

func (a *Activities) RetryASEANMessage(ctx context.Context, messageId string) error {
	_, err := a.db.ExecContext(ctx, `
		UPDATE asean_messages SET status = 'retrying', updated_at = NOW() WHERE message_id = $1`, messageId)
	return err
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

func (a *Activities) get(ctx context.Context, url string, result interface{}) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("GET %s returned %d", url, resp.StatusCode)
	}
	if result != nil {
		return json.NewDecoder(resp.Body).Decode(result)
	}
	return nil
}

func (a *Activities) post(ctx context.Context, url string, payload []byte, result interface{}) error {
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("POST %s returned %d", url, resp.StatusCode)
	}
	if result != nil {
		return json.NewDecoder(resp.Body).Decode(result)
	}
	return nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
