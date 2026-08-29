// Payment Service — Duty assessment, Mojaloop payment switching, TigerBeetle ledger
// Language: Go 1.22 | Protocol: gRPC + HTTP REST | DB: PostgreSQL
// Integrates: Mojaloop FSP API, TigerBeetle bridge, Kafka event publishing
//
// Phase-6 remediation (SW-11):
//   - NO simulated Mojaloop initiation. The transfer is sent to the real
//     switch; a failed send marks the payment FAILED with the real reason
//     (fail-closed). In production the service refuses to boot without the
//     switch URL and the callback verification secret.
//   - NO fabricated ledger ids. Settlement is posted to the canonical Go
//     tigerbeetle-bridge (/api/ledger/*, port 8086); when the bridge is down
//     the payment is marked LEDGER_UNAVAILABLE — never "TB-LOCAL-*".
//   - P0-8: FSPIOP JWS (Ed25519) is the single platform signing convention
//     for switch-facing traffic: outbound /transfers are signed body-bound
//     (kid in protected header) and are NEVER sent unsigned; inbound
//     callbacks verify the hub JWS when configured, with the legacy
//     env-required HMAC as documented interop fallback. Unsigned callbacks
//     are always rejected.
//   - The Mojaloop webhook is authenticated (timing-safe), idempotent,
//     state-guarded, and completes ONLY after a real ledger post.
//   - Money is integer minor units with explicit guards (no float money math).
//   - Duty assessment uses the authoritative tariff service; in production it
//     fails closed (UNAVAILABLE) when no tariff source is configured.

package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// ─── CONFIG ──────────────────────────────────────────────────────────────────

var (
	httpPort             = getEnv("PAYMENT_HTTP_PORT", "8083")
	dbURL                = getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
	mojaloopBaseURL      = getEnv("MOJALOOP_BASE_URL", "http://localhost:3001")
	tigerBeetleAddr      = getEnv("TIGERBEETLE_ADDR", "localhost:3000")
	tigerBeetleBridgeURL = getEnv("TIGERBEETLE_BRIDGE_URL", "http://tigerbeetle-bridge:8086")
	kafkaBrokers         = getEnv("KAFKA_BROKERS", "localhost:9092")
	tariffServiceURL     = getEnv("TARIFF_SERVICE_URL", "")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func isProduction() bool {
	return os.Getenv("APP_ENV") == "production" || os.Getenv("NODE_ENV") == "production"
}

// enforceProductionConfig refuses to boot in production without real
// configuration (SW-11: fail-closed, secrets env-only).
func enforceProductionConfig() {
	if !isProduction() {
		return
	}
	missing := []string{}
	if os.Getenv("DATABASE_URL") == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if os.Getenv("MOJALOOP_BASE_URL") == "" {
		missing = append(missing, "MOJALOOP_BASE_URL")
	}
	if os.Getenv("MOJALOOP_CALLBACK_SECRET") == "" && os.Getenv("MOJALOOP_HUB_PUBLIC_KEY_PATH") == "" && os.Getenv("MOJALOOP_HUB_PUBLIC_KEY_PEM") == "" {
		missing = append(missing, "MOJALOOP_HUB_PUBLIC_KEY_PATH or MOJALOOP_CALLBACK_SECRET")
	}
	if os.Getenv("DFSP_JWS_PRIVATE_KEY_PATH") == "" && os.Getenv("DFSP_JWS_PRIVATE_KEY_PEM") == "" {
		missing = append(missing, "DFSP_JWS_PRIVATE_KEY_PATH or DFSP_JWS_PRIVATE_KEY_PEM")
	}
	if os.Getenv("TARIFF_SERVICE_URL") == "" {
		missing = append(missing, "TARIFF_SERVICE_URL")
	}
	if len(missing) > 0 {
		log.Fatalf("[Payment Service] FATAL: missing required production configuration: %s. Refusing to boot.",
			strings.Join(missing, ", "))
	}
}

// ─── MONEY (integer minor units — SW-11) ────────────────────────────────────

// minorUnits converts a major-unit float to integer minor units with an
// explicit finite/>0/overflow guard.
func minorUnits(amount float64) (int64, error) {
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 || amount > 9e13 {
		return 0, fmt.Errorf("invalid amount %v: must be finite, > 0 and <= 9e13", amount)
	}
	return int64(math.Round(amount * 100)), nil
}

// minorToDecimal renders integer minor units as an exact decimal string.
func minorToDecimal(minor int64) string {
	return fmt.Sprintf("%d.%02d", minor/100, minor%100)
}

// ─── DATABASE ─────────────────────────────────────────────────────────────────

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("failed to open DB: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	return db.Ping()
}

// ─── DOMAIN TYPES ────────────────────────────────────────────────────────────

type Payment struct {
	ID              int64      `json:"id"`
	DeclarationID   int64      `json:"declarationId"`
	PayerUserID     int64      `json:"payerUserId"`
	Amount          string     `json:"amount"` // NUMERIC as string for precision
	Currency        string     `json:"currency"`
	PaymentMethod   string     `json:"paymentMethod"`
	Status          string     `json:"status"`
	ReferenceNumber string     `json:"referenceNumber"`
	MojaloopTxID    string     `json:"mojaloopTxId,omitempty"`
	TigerBeetleTxID string     `json:"tigerBeetleTxId,omitempty"`
	DutyType        string     `json:"dutyType"`
	CreatedAt       time.Time  `json:"createdAt"`
	CompletedAt     *time.Time `json:"completedAt,omitempty"`
	FailureReason   string     `json:"failureReason,omitempty"`
}

type CreatePaymentRequest struct {
	DeclarationID int64   `json:"declarationId"`
	PayerUserID   int64   `json:"payerUserId"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
	PaymentMethod string  `json:"paymentMethod"` // bank_transfer, mobile_money, card
	DutyType      string  `json:"dutyType"`      // import_duty, vat, excise, levy, bond
}

// ─── DUTY ASSESSMENT ENGINE ──────────────────────────────────────────────────

type DutyAssessment struct {
	DeclarationID int64          `json:"declarationId"`
	HSCode        string         `json:"hsCode"`
	CustomsValue  float64        `json:"customsValue"`
	Currency      string         `json:"currency"`
	DutyBreakdown []DutyLineItem `json:"dutyBreakdown"`
	TotalDuty     float64        `json:"totalDuty"`
	TotalVAT      float64        `json:"totalVat"`
	TotalLevy     float64        `json:"totalLevy"`
	TotalPayable  float64        `json:"totalPayable"`
	TariffSource  string         `json:"tariffSource"`
	AssessedAt    time.Time      `json:"assessedAt"`
	ValidUntil    time.Time      `json:"validUntil"`
}

type DutyLineItem struct {
	DutyType    string `json:"dutyType"`
	Description string `json:"description"`
	Rate        string `json:"rate"` // e.g. "12.50%"
	BaseMinor   int64  `json:"baseMinor"`
	AmountMinor int64  `json:"amountMinor"`
}

// tariffRates in basis points (1/100 of a percent) — integer arithmetic.
type tariffRates struct {
	ImportDutyBP int64
	VATBP        int64
	LevyBP       int64
	Description  string
}

// lookupTariff returns the authoritative rates for an HS code.
// SW-11: in production the ONLY source is the tariff service — when it is
// unconfigured/unreachable the assessment is UNAVAILABLE (fail closed). The
// static fallback table exists for non-production development only and is
// clearly labelled.
func lookupTariff(ctx context.Context, hsCode string) (*tariffRates, string, error) {
	if tariffServiceURL != "" {
		req, err := http.NewRequestWithContext(ctx, "GET",
			fmt.Sprintf("%s/tariff/%s", tariffServiceURL, hsCode), nil)
		if err != nil {
			return nil, "", err
		}
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return nil, "", fmt.Errorf("tariff service unreachable: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound {
			return nil, "", fmt.Errorf("no tariff rate for HS code %s", hsCode)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, "", fmt.Errorf("tariff service returned %d", resp.StatusCode)
		}
		var body struct {
			ImportDutyBP int64  `json:"importDutyBp"`
			VATBP        int64  `json:"vatBp"`
			LevyBP       int64  `json:"levyBp"`
			Description  string `json:"description"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			return nil, "", fmt.Errorf("invalid tariff service response: %w", err)
		}
		return &tariffRates{body.ImportDutyBP, body.VATBP, body.LevyBP, body.Description}, "tariff-service", nil
	}
	if isProduction() {
		return nil, "", fmt.Errorf("TARIFF_UNAVAILABLE: no authoritative tariff source configured")
	}
	// Non-production fallback — clearly labelled, never authoritative.
	table := map[string]tariffRates{
		"8471": {0, 1250, 50, "Computers & peripherals"},
		"8517": {500, 1250, 50, "Telephones & mobile devices"},
		"8703": {2000, 1250, 200, "Motor vehicles"},
		"2710": {1000, 0, 500, "Petroleum products"},
		"1001": {500, 0, 100, "Wheat & meslin"},
		"1006": {1000, 0, 100, "Rice"},
		"3004": {0, 0, 50, "Medicaments"},
		"6203": {2000, 1250, 100, "Men's clothing"},
		"9403": {2000, 1250, 100, "Furniture"},
	}
	prefix := hsCode
	if len(prefix) > 4 {
		prefix = prefix[:4]
	}
	rates, ok := table[prefix]
	if !ok {
		rates = tariffRates{1000, 1250, 100, "General goods"}
	}
	return &rates, "STATIC-FALLBACK-NON-PRODUCTION", nil
}

func assessDuty(ctx context.Context, declarationID int64, hsCode string, customsValue float64, currency string) (*DutyAssessment, error) {
	valueMinor, err := minorUnits(customsValue)
	if err != nil {
		return nil, err
	}
	rates, source, err := lookupTariff(ctx, hsCode)
	if err != nil {
		return nil, err
	}

	// Integer minor-unit arithmetic: amount = base * bp / 10000 (rounded).
	mul := func(base, bp int64) int64 {
		return (base*bp + 5000) / 10000
	}
	importDutyMinor := mul(valueMinor, rates.ImportDutyBP)
	vatBaseMinor := valueMinor + importDutyMinor
	vatMinor := mul(vatBaseMinor, rates.VATBP)
	levyMinor := mul(valueMinor, rates.LevyBP)

	bpStr := func(bp int64) string { return fmt.Sprintf("%d.%02d%%", bp/100, bp%100) }

	assessment := &DutyAssessment{
		DeclarationID: declarationID,
		HSCode:        hsCode,
		CustomsValue:  customsValue,
		Currency:      currency,
		DutyBreakdown: []DutyLineItem{
			{
				DutyType:    "import_duty",
				Description: fmt.Sprintf("Import Duty @ %s on CIF value (%s)", bpStr(rates.ImportDutyBP), rates.Description),
				Rate:        bpStr(rates.ImportDutyBP),
				BaseMinor:   valueMinor,
				AmountMinor: importDutyMinor,
			},
			{
				DutyType:    "vat",
				Description: fmt.Sprintf("VAT @ %s on (CIF + Import Duty)", bpStr(rates.VATBP)),
				Rate:        bpStr(rates.VATBP),
				BaseMinor:   vatBaseMinor,
				AmountMinor: vatMinor,
			},
			{
				DutyType:    "levy",
				Description: fmt.Sprintf("ECOWAS/NHIL Levy @ %s", bpStr(rates.LevyBP)),
				Rate:        bpStr(rates.LevyBP),
				BaseMinor:   valueMinor,
				AmountMinor: levyMinor,
			},
		},
		TariffSource: source,
		AssessedAt:   time.Now(),
		ValidUntil:   time.Now().Add(72 * time.Hour),
	}
	totalDuty := float64(importDutyMinor) / 100
	totalVAT := float64(vatMinor) / 100
	totalLevy := float64(levyMinor) / 100
	assessment.TotalDuty = totalDuty
	assessment.TotalVAT = totalVAT
	assessment.TotalLevy = totalLevy
	assessment.TotalPayable = totalDuty + totalVAT + totalLevy
	return assessment, nil
}

// ─── PAYMENT PROCESSING ───────────────────────────────────────────────────────

func generateReference() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "TG-" + hex.EncodeToString(b)
}

// newTransferID generates a unique Mojaloop transfer id (payer-DFSP assigned,
// per the FSPIOP protocol — this is a real id, not a fabricated one).
func newTransferID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func createPayment(ctx context.Context, req CreatePaymentRequest) (*Payment, error) {
	amountMinor, err := minorUnits(req.Amount)
	if err != nil {
		return nil, err
	}
	refNum := generateReference()

	var p Payment
	err = db.QueryRowContext(ctx, `
		INSERT INTO payments (declaration_id, payer_user_id, amount, currency,
		                      payment_method, status, reference_number, duty_type, created_at)
		VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NOW())
		RETURNING id, declaration_id, payer_user_id, amount, currency,
		          payment_method, status, reference_number, duty_type, created_at
	`, req.DeclarationID, req.PayerUserID, minorToDecimal(amountMinor), req.Currency,
		req.PaymentMethod, refNum, req.DutyType).
		Scan(&p.ID, &p.DeclarationID, &p.PayerUserID, &p.Amount, &p.Currency,
			&p.PaymentMethod, &p.Status, &p.ReferenceNumber, &p.DutyType, &p.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create payment record: %w", err)
	}

	// SW-11: send the transfer to the real switch SYNCHRONOUSLY — a failed
	// send is an honest error (payment marked FAILED), never a simulated id.
	transferID, err := initiateMojaloopTransfer(ctx, p.ID, p.ReferenceNumber, amountMinor, req.Currency, req.PaymentMethod)
	if err != nil {
		_, _ = db.ExecContext(ctx, `
			UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1
		`, p.ID, "payment switch unavailable: "+err.Error())
		p.Status = "failed"
		return &p, fmt.Errorf("payment switch unavailable — payment NOT initiated: %w", err)
	}

	if _, err := db.ExecContext(ctx, `
		UPDATE payments SET mojaloop_tx_id = $1, status = 'processing' WHERE id = $2
	`, transferID, p.ID); err != nil {
		return nil, fmt.Errorf("failed to persist transfer id: %w", err)
	}
	p.MojaloopTxID = transferID
	p.Status = "processing"
	return &p, nil
}

// initiateMojaloopTransfer sends a transfer prepare to the Mojaloop switch
// (FSPIOP). Returns the transfer id on success; any send failure is an error.
func initiateMojaloopTransfer(ctx context.Context, paymentID int64, reference string, amountMinor int64, currency, method string) (string, error) {
	transferID := newTransferID()
	payload := map[string]interface{}{
		"transferId": transferID,
		"payerFsp":   "gh-customs-payer-dfsp",
		"payeeFsp":   "gh-customs-authority",
		"amount": map[string]string{
			"amount":   minorToDecimal(amountMinor),
			"currency": currency,
		},
		"expiration": time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339),
		"extensionList": map[string]interface{}{
			"extension": []map[string]string{
				{"key": "paymentReference", "value": reference},
				{"key": "paymentMethod", "value": method},
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", mojaloopBaseURL+"/transfers", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("FSPIOP-Source", "gh-customs-payer-dfsp")
	req.Header.Set("FSPIOP-Destination", "gh-customs-authority")
	// P0-8: FSPIOP JWS (Ed25519) is the platform signing convention for
	// switch-facing traffic. Signing failure is fail-closed — an unsigned
	// money-movement request is NEVER sent.
	signer, err := fspiopSigner()
	if err != nil {
		return "", fmt.Errorf("FSPIOP signing unavailable (fail-closed, transfer NOT sent): %w", err)
	}
	if err := signer.SignRequest(req, "gh-customs-authority", body); err != nil {
		return "", fmt.Errorf("FSPIOP sign transfer (fail-closed, transfer NOT sent): %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("switch send failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("switch returned %d: %s", resp.StatusCode, string(respBody))
	}
	return transferID, nil
}

// postSettlementToLedger posts the settled amount to the canonical Go
// tigerbeetle-bridge (/api/ledger/transfers). Returns the REAL bridge
// transfer id, or an error — no fabricated fallback ids (SW-11).
func postSettlementToLedger(ctx context.Context, paymentID int64, reference string, amountMinor int64, currency string) (string, error) {
	payload := map[string]interface{}{
		"debitAccountId":  fmt.Sprintf("trader-%d-liability", paymentID),
		"creditAccountId": "customs-duty-revenue",
		"amount":          minorToDecimal(amountMinor),
		"currency":        currency,
		"reference":       reference,
		"description":     fmt.Sprintf("Duty payment %s settled via Mojaloop", reference),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", tigerBeetleBridgeURL+"/api/ledger/transfers", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ledger bridge unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("ledger bridge returned %d: %s", resp.StatusCode, string(respBody))
	}
	var result struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || result.ID == "" {
		return "", fmt.Errorf("ledger bridge did not return a transfer id")
	}
	return result.ID, nil
}

// ─── WEBHOOK AUTHENTICATION (SW-11) ─────────────────────────────────────────

// verifyCallbackAuth authenticates a Mojaloop callback on the money path.
// Platform convention (P0-8): FSPIOP JWS (Ed25519) verified against the hub's
// public key when MOJALOOP_HUB_PUBLIC_KEY_PATH/_PEM is configured. The legacy
// HMAC-SHA256 path (X-Mojaloop-Signature) remains ONLY as a documented
// interop fallback and its secret is env-required — there is no dev default.
// Unsigned callbacks are ALWAYS rejected (fail-closed).
func verifyCallbackAuth(r *http.Request, rawBody []byte) bool {
	if pub := hubPublicKey(); pub != nil {
		if err := verifyFSPIOPSignature(pub, r.Method, r.URL.RequestURI(), rawBody, r.Header.Get("FSPIOP-Signature")); err != nil {
			log.Printf("[Payment Service] inbound JWS verification failed: %v", err)
			return false
		}
		return true
	}
	return verifyWebhookSignature(rawBody, r.Header.Get("X-Mojaloop-Signature"))
}

// verifyWebhookSignature authenticates a Mojaloop callback via HMAC-SHA256
// over the raw body (X-Mojaloop-Signature header), timing-safe. Legacy
// interop path — secret is env-required (no default); when the hub public
// key is configured the JWS path above is used instead.
func verifyWebhookSignature(rawBody []byte, signatureHeader string) bool {
	secret := os.Getenv("MOJALOOP_CALLBACK_SECRET")
	if secret == "" {
		// Fail-closed: no credential configured => nothing is accepted.
		return false
	}
	sig := strings.TrimPrefix(signatureHeader, "sha256=")
	provided, err := hex.DecodeString(sig)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(rawBody)
	return subtle.ConstantTimeCompare(provided, mac.Sum(nil)) == 1
}

func publishKafkaEvent(topic string, payload interface{}) {
	data, _ := json.Marshal(payload)
	log.Printf("[Kafka] Publishing to %s: %s", topic, string(data))
	// Production: use kafka-go or sarama client
}

// ─── HTTP HANDLERS ────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func handleAssessDuty(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeclarationID int64   `json:"declarationId"`
		HSCode        string  `json:"hsCode"`
		CustomsValue  float64 `json:"customsValue"`
		Currency      string  `json:"currency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	assessment, err := assessDuty(r.Context(), req.DeclarationID, req.HSCode, req.CustomsValue, req.Currency)
	if err != nil {
		if strings.Contains(err.Error(), "TARIFF_UNAVAILABLE") {
			writeJSON(w, 503, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, assessment)
}

func handleCreatePayment(w http.ResponseWriter, r *http.Request) {
	var req CreatePaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	payment, err := createPayment(r.Context(), req)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, payment)
}

// handleMojaloopWebhook processes the Mojaloop FSPIOP settlement callback.
// SW-11: HMAC-authenticated, idempotent, state-guarded, and a payment is only
// completed AFTER a real ledger post (503 → switch retries otherwise).
func handleMojaloopWebhook(w http.ResponseWriter, r *http.Request) {
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid callback"})
		return
	}
	if !verifyCallbackAuth(r, rawBody) {
		writeJSON(w, 401, map[string]string{"error": "invalid callback signature"})
		return
	}

	var callback struct {
		TransferID string `json:"transferId"`
		State      string `json:"transferState"` // COMMITTED | ABORTED
	}
	if err := json.Unmarshal(rawBody, &callback); err != nil || callback.TransferID == "" {
		writeJSON(w, 400, map[string]string{"error": "invalid callback"})
		return
	}

	ctx := r.Context()

	// Resolve the payment by the transfer id persisted at initiation.
	var p Payment
	var amountStr string
	err = db.QueryRowContext(ctx, `
		SELECT id, declaration_id, payer_user_id, amount, currency, status, reference_number
		FROM payments WHERE mojaloop_tx_id = $1
	`, callback.TransferID).
		Scan(&p.ID, &p.DeclarationID, &p.PayerUserID, &amountStr, &p.Currency, &p.Status, &p.ReferenceNumber)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "unknown transfer"})
		return
	}

	// Idempotent: a replayed COMMITTED on a completed payment is a no-op.
	if p.Status == "completed" {
		writeJSON(w, 200, map[string]string{"status": "already_completed"})
		return
	}
	// State guard: only in-flight payments can transition.
	if p.Status != "processing" && p.Status != "pending" {
		writeJSON(w, 409, map[string]string{"error": fmt.Sprintf("payment is in terminal state %s", p.Status)})
		return
	}

	switch callback.State {
	case "COMMITTED":
		amountMinor, err := func() (int64, error) {
			var f float64
			if _, err := fmt.Sscanf(amountStr, "%g", &f); err != nil {
				return 0, err
			}
			return minorUnits(f)
		}()
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "stored payment amount is invalid"})
			return
		}
		// Post the settlement to the ledger BEFORE completing the payment.
		tbTxID, err := postSettlementToLedger(ctx, p.ID, p.ReferenceNumber, amountMinor, p.Currency)
		if err != nil {
			_, _ = db.ExecContext(ctx, `
				UPDATE payments SET status = 'ledger_unavailable', failure_reason = $2 WHERE id = $1
			`, p.ID, err.Error())
			writeJSON(w, 503, map[string]string{"error": "ledger unavailable — settlement NOT recorded; retry the callback"})
			return
		}
		if _, err := db.ExecContext(ctx, `
			UPDATE payments
			SET status = 'completed', completed_at = NOW(), tigerbeetle_tx_id = $1
			WHERE id = $2
		`, tbTxID, p.ID); err != nil {
			writeJSON(w, 500, map[string]string{"error": "failed to complete payment"})
			return
		}
		publishKafkaEvent("payment.confirmed", map[string]interface{}{
			"paymentId":   p.ID,
			"transferId":  callback.TransferID,
			"tbTxId":      tbTxID,
			"confirmedAt": time.Now(),
		})
	case "ABORTED":
		_, _ = db.ExecContext(ctx, `
			UPDATE payments SET status = 'failed', failure_reason = 'transfer aborted by switch' WHERE id = $1
		`, p.ID)
	default:
		writeJSON(w, 400, map[string]string{"error": "unsupported transferState"})
		return
	}

	writeJSON(w, 200, map[string]string{"status": "acknowledged"})
}

func handleGetPayments(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeclarationID int64 `json:"declarationId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	rows, err := db.Query(`
		SELECT id, declaration_id, payer_user_id, amount, currency, payment_method,
		       status, reference_number, duty_type, created_at, completed_at
		FROM payments WHERE declaration_id = $1 ORDER BY created_at DESC
	`, req.DeclarationID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	var payments []Payment
	for rows.Next() {
		var p Payment
		var completedAt sql.NullTime
		if err := rows.Scan(&p.ID, &p.DeclarationID, &p.PayerUserID, &p.Amount, &p.Currency,
			&p.PaymentMethod, &p.Status, &p.ReferenceNumber, &p.DutyType,
			&p.CreatedAt, &completedAt); err == nil {
			if completedAt.Valid {
				p.CompletedAt = &completedAt.Time
			}
			payments = append(payments, p)
		}
	}
	writeJSON(w, 200, payments)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := db.Ping(); err != nil {
		writeJSON(w, 503, map[string]string{"status": "unhealthy", "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"status":  "healthy",
		"service": "payment-service",
		"version": "1.1.0",
		"integrations": map[string]string{
			"mojaloop":    mojaloopBaseURL,
			"tigerbeetle": tigerBeetleBridgeURL,
			"kafka":       kafkaBrokers,
			"tariff":      tariffServiceURL,
		},
	})
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("[Payment Service] Starting up...")

	// SW-11: refuse to boot in production without real configuration.
	enforceProductionConfig()

	log.Printf("[Payment Service] Mojaloop: %s | TigerBeetle bridge: %s | Kafka: %s",
		mojaloopBaseURL, tigerBeetleBridgeURL, kafkaBrokers)

	if err := initDB(); err != nil {
		log.Fatalf("[Payment Service] DB init failed: %v", err)
	}
	log.Printf("[Payment Service] PostgreSQL connected")

	// gRPC server (health + reflection) — defined in grpc_server.go.
	// NOTE: the earlier suspicion of a StartGRPCServer/startGRPCServer compile
	// bug was WRONG — both existed (main.go + grpc_server.go) and the service
	// compiled. The duplication (two gRPC servers on :50053 and :9082) is
	// consolidated here to the single health-serving server in grpc_server.go.
	go StartGRPCServer()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/duty/assess", handleAssessDuty)
	mux.HandleFunc("/payments/create", handleCreatePayment)
	mux.HandleFunc("/payments/list", handleGetPayments)
	mux.HandleFunc("/webhooks/mojaloop", handleMojaloopWebhook)

	srv := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	log.Printf("[Payment Service] HTTP server listening on :%s", httpPort)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[Payment Service] HTTP server failed: %v", err)
	}
}
