// mojaloop-service — Real-time Payment Clearing via Mojaloop
//
// TradeGateway NGSWTP — Go microservice integrating Mojaloop for
// customs duty and trade fee payments.
//
// Mojaloop is an open-source real-time payment system used by central banks.
// This service bridges the TradeGateway payment flow with the Mojaloop
// Interledger Protocol (ILP) network and the Central Bank of Nigeria (CBN).
//
// Flow:
//   1. TradeGateway creates a payment request (duty/fee amount)
//   2. This service creates a Mojaloop transfer quote
//   3. Trader approves and initiates the transfer
//   4. Mojaloop clears the payment in real-time
//   5. This service records the ledger entry in TigerBeetle
//   6. Publishes payment.completed event to Kafka
//
// HTTP API:
//   POST /api/payments/quote          — Get a payment quote from Mojaloop
//   POST /api/payments/transfer       — Initiate a Mojaloop transfer
//   GET  /api/payments/:id            — Get payment status
//   GET  /api/payments/declaration/:id — Get payments for a declaration
//   POST /api/payments/callback       — Mojaloop PUT /transfers callback
//   GET  /health                      — Health check
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// generateILPComponents generates a cryptographically secure ILP fulfillment,
// condition, and packet per the Interledger Protocol specification (ILP RFC 0027).
//
// - Fulfillment: 32 random bytes, base64url-encoded (the preimage / secret)
// - Condition:   SHA-256(fulfillment), base64url-encoded (the hash commitment)
// - ILP Packet:  BER-encoded OER ILP Prepare packet, base64-encoded
//
// The fulfillment is stored securely and only revealed to the Mojaloop switch
// upon transfer completion to unlock funds.
// minorUnits converts a major-unit amount to integer minor units with an
// explicit isFinite/>0/overflow guard (SW-12). Money is handled as integer
// minor units from this point — no float money math downstream.
func minorUnits(amount float64) (uint64, error) {
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 || amount > 9e13 {
		return 0, fmt.Errorf("invalid amount %v", amount)
	}
	return uint64(math.Round(amount * 100)), nil
}

// minorToDecimal renders minor units as an exact decimal string (no float).
func minorToDecimal(minor uint64) string {
	return fmt.Sprintf("%d.%02d", minor/100, minor%100)
}

// verifyFulfilment checks that a presented fulfilment satisfies the stored
// condition: base64url-decode and compare SHA-256(preimage) — timing-safe.
func verifyFulfilment(fulfilmentB64, conditionB64 string) bool {
	preimage, err := base64.RawURLEncoding.DecodeString(fulfilmentB64)
	if err != nil || len(preimage) != 32 {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(conditionB64)
	if err != nil || len(expected) != 32 {
		return false
	}
	hash := sha256.Sum256(preimage)
	return subtle.ConstantTimeCompare(hash[:], expected) == 1
}

// verifyCallbackSignature authenticates a Mojaloop switch callback via
// HMAC-SHA256 over the raw body (FSPIOP-Signature header), timing-safe (SW-M9).
// In production the secret MUST be configured — main() refuses to boot without it.
func verifyCallbackSignature(rawBody []byte, signatureHeader string) bool {
	secret := os.Getenv("MOJALOOP_CALLBACK_SECRET")
	if secret == "" {
		if isProduction() {
			return false
		}
		secret = "dev-callback-secret"
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

func isProduction() bool {
	return os.Getenv("APP_ENV") == "production" || os.Getenv("NODE_ENV") == "production"
}

func generateILPComponents(amountMinor uint64, currency, destinationAccount string) (ilpPacket, condition, fulfillment string, err error) {
	// 1. Generate cryptographically secure 32-byte fulfillment preimage
	preimage := make([]byte, 32)
	if _, err = rand.Read(preimage); err != nil {
		return "", "", "", fmt.Errorf("failed to generate fulfillment preimage: %w", err)
	}

	// 2. Fulfillment = base64url(preimage)
	fulfillment = base64.RawURLEncoding.EncodeToString(preimage)

	// 3. Condition = base64url(SHA-256(preimage))
	hash := sha256.Sum256(preimage)
	condition = base64.RawURLEncoding.EncodeToString(hash[:])

	// 4. Build ILP Prepare packet (OER encoding per ILP RFC 0027).
	// The amount arrives as exact integer minor units (SW-12).
	amountUnits := amountMinor
	expiry := time.Now().UTC().Add(5 * time.Minute)
	expiryStr := expiry.Format("20060102150405") + "000"
	dest := fmt.Sprintf("g.ng.customs.%s", destinationAccount)

	// Encode amount as 8 bytes big-endian
	amountBytes := make([]byte, 8)
	for i := 7; i >= 0; i-- {
		amountBytes[i] = byte(amountUnits & 0xFF)
		amountUnits >>= 8
	}

	// Assemble packet: type(1) + amount(8) + expiry(17) + condition(32) + dest_len(1) + dest + data_len(2)
	var packet []byte
	packet = append(packet, 0x0C) // ILP Prepare packet type
	packet = append(packet, amountBytes...)
	packet = append(packet, []byte(expiryStr)...)
	packet = append(packet, hash[:]...)
	packet = append(packet, byte(len(dest)))
	packet = append(packet, []byte(dest)...)
	packet = append(packet, 0x00, 0x00) // Empty data field

	ilpPacket = base64.StdEncoding.EncodeToString(packet)
	return ilpPacket, condition, fulfillment, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Configuration ────────────────────────────────────────────────────────────

type Config struct {
	Port              string
	DatabaseURL       string
	MojaloopBaseURL   string
	MojaloopFSPID     string // Financial Service Provider ID
	TigerBeetleURL    string
	KafkaBrokers      string
	DaprPort          string
}

func loadConfig() Config {
	return Config{
		Port:            getEnv("PORT", "8099"),
		DatabaseURL:     getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"),
		MojaloopBaseURL: getEnv("MOJALOOP_URL", "http://mojaloop-ml-api-adapter:3000"),
		MojaloopFSPID:   getEnv("MOJALOOP_FSP_ID", "tradegateway-ng"),
		TigerBeetleURL:  getEnv("TIGERBEETLE_BRIDGE_URL", "http://tigerbeetle-bridge:50055"),
		KafkaBrokers:    getEnv("KAFKA_BROKERS", "localhost:9092"),
		DaprPort:        getEnv("DAPR_HTTP_PORT", "3500"),
	}
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentStatus string

const (
	PaymentStatusPending   PaymentStatus = "PENDING"
	PaymentStatusQuoted    PaymentStatus = "QUOTED"
	PaymentStatusInitiated PaymentStatus = "INITIATED"
	PaymentStatusCompleted PaymentStatus = "COMPLETED"
	PaymentStatusFailed    PaymentStatus = "FAILED"
	PaymentStatusRefunded  PaymentStatus = "REFUNDED"
)

type PaymentType string

const (
	PaymentTypeCustomsDuty PaymentType = "CUSTOMS_DUTY"
	PaymentTypeVAT         PaymentType = "VAT"
	PaymentTypeLevy        PaymentType = "LEVY"
	PaymentTypeFee         PaymentType = "FEE"
)

type Payment struct {
	ID            int64         `json:"id"`
	PaymentRef    string        `json:"paymentRef"`
	DeclarationID *int64        `json:"declarationId,omitempty"`
	TraderID      int64         `json:"traderId"`
	PaymentType   PaymentType   `json:"paymentType"`
	Amount        float64       `json:"amount"`
	Currency      string        `json:"currency"`
	Status        PaymentStatus `json:"status"`
	MojaloopTxID  *string       `json:"mojaloopTxId,omitempty"`
	TigerBeetleID *string       `json:"tigerBeetleId,omitempty"`
	QuoteID       *string       `json:"quoteId,omitempty"`
	ILPPacket     *string       `json:"ilpPacket,omitempty"`
	Condition     *string       `json:"condition,omitempty"`
	Fulfillment   *string       `json:"-"` // Never serialised — security-sensitive preimage
	PayerFSP      string        `json:"payerFsp"`
	PayeeFSP      string        `json:"payeeFsp"`
	ErrorMessage  *string       `json:"errorMessage,omitempty"`
	CreatedAt     time.Time     `json:"createdAt"`
	UpdatedAt     time.Time     `json:"updatedAt"`
	CompletedAt   *time.Time    `json:"completedAt,omitempty"`
}

type QuoteRequest struct {
	DeclarationID *int64      `json:"declarationId"`
	TraderID      int64       `json:"traderId" binding:"required"`
	PaymentType   PaymentType `json:"paymentType" binding:"required"`
	Amount        float64     `json:"amount" binding:"required,gt=0"`
	Currency      string      `json:"currency" binding:"required"`
	PayerFSP      string      `json:"payerFsp" binding:"required"`
}

type TransferRequest struct {
	PaymentRef string `json:"paymentRef" binding:"required"`
	QuoteID    string `json:"quoteId" binding:"required"`
}

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

var (
	paymentsInitiated = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "mojaloop_payments_initiated_total", Help: "Total payments initiated"},
		[]string{"payment_type"},
	)
	paymentsCompleted = prometheus.NewCounter(
		prometheus.CounterOpts{Name: "mojaloop_payments_completed_total", Help: "Total payments completed"},
	)
	paymentsFailed = prometheus.NewCounter(
		prometheus.CounterOpts{Name: "mojaloop_payments_failed_total", Help: "Total payments failed"},
	)
	paymentAmountTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "mojaloop_payment_amount_total", Help: "Total payment amount"},
		[]string{"currency"},
	)
)

func init() {
	prometheus.MustRegister(paymentsInitiated, paymentsCompleted, paymentsFailed, paymentAmountTotal)
}

// ─── Store ────────────────────────────────────────────────────────────────────

type PaymentStore struct {
	pool *pgxpool.Pool
}

func NewPaymentStore(pool *pgxpool.Pool) *PaymentStore {
	return &PaymentStore{pool: pool}
}

func (s *PaymentStore) EnsureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS mojaloop_payments (
			id              BIGSERIAL PRIMARY KEY,
			payment_ref     VARCHAR(64) NOT NULL UNIQUE,
			declaration_id  BIGINT,
			trader_id       BIGINT NOT NULL,
			payment_type    VARCHAR(32) NOT NULL,
			amount          NUMERIC(18,2) NOT NULL,
			currency        VARCHAR(3) NOT NULL DEFAULT 'NGN',
			status          VARCHAR(16) NOT NULL DEFAULT 'PENDING',
			mojaloop_tx_id  VARCHAR(128),
			tigerbeetle_id  VARCHAR(128),
			quote_id        VARCHAR(128),
			payer_fsp       VARCHAR(64),
			payee_fsp       VARCHAR(64),
			error_message   TEXT,
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			completed_at    TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_mojaloop_payments_trader ON mojaloop_payments(trader_id);
		CREATE INDEX IF NOT EXISTS idx_mojaloop_payments_declaration ON mojaloop_payments(declaration_id);
		CREATE INDEX IF NOT EXISTS idx_mojaloop_payments_status ON mojaloop_payments(status);
		CREATE INDEX IF NOT EXISTS idx_mojaloop_payments_ref ON mojaloop_payments(payment_ref);
		ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS ilp_packet TEXT;
		ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS condition_hash TEXT;
		ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS fulfillment TEXT;
		ALTER TABLE mojaloop_payments ADD COLUMN IF NOT EXISTS amount_minor BIGINT;
	`)
	return err
}

func (s *PaymentStore) Create(ctx context.Context, p *Payment) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO mojaloop_payments (payment_ref, declaration_id, trader_id, payment_type,
		                               amount, currency, status, payer_fsp, payee_fsp,
		                               ilp_packet, condition_hash, fulfillment)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, created_at, updated_at
	`, p.PaymentRef, p.DeclarationID, p.TraderID, p.PaymentType,
		p.Amount, p.Currency, p.Status, p.PayerFSP, p.PayeeFSP,
		p.ILPPacket, p.Condition, p.Fulfillment).
		Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
}

func (s *PaymentStore) UpdateStatus(ctx context.Context, paymentRef string, status PaymentStatus, txID, errMsg *string) error {
	now := time.Now()
	var completedAt *time.Time
	if status == PaymentStatusCompleted {
		completedAt = &now
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE mojaloop_payments SET
		  status = $1, mojaloop_tx_id = COALESCE($2, mojaloop_tx_id),
		  error_message = $3, updated_at = $4, completed_at = COALESCE($5, completed_at)
		WHERE payment_ref = $6
	`, status, txID, errMsg, now, completedAt, paymentRef)
	return err
}

func (s *PaymentStore) GetByRef(ctx context.Context, paymentRef string) (*Payment, error) {
	p := &Payment{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, payment_ref, declaration_id, trader_id, payment_type, amount, currency,
		       status, mojaloop_tx_id, tigerbeetle_id, quote_id, ilp_packet, condition_hash,
		       payer_fsp, payee_fsp, error_message, created_at, updated_at, completed_at
		FROM mojaloop_payments WHERE payment_ref = $1
	`, paymentRef).Scan(
		&p.ID, &p.PaymentRef, &p.DeclarationID, &p.TraderID, &p.PaymentType, &p.Amount, &p.Currency,
		&p.Status, &p.MojaloopTxID, &p.TigerBeetleID, &p.QuoteID, &p.ILPPacket, &p.Condition,
		&p.PayerFSP, &p.PayeeFSP, &p.ErrorMessage, &p.CreatedAt, &p.UpdatedAt, &p.CompletedAt,
	)
	if err != nil {
		return nil, err
	}
	return p, nil
}

// ─── Mojaloop Client ──────────────────────────────────────────────────────────

type MojaloopClient struct {
	baseURL string
	fspID   string
	client  *http.Client
}

func NewMojaloopClient(baseURL, fspID string) *MojaloopClient {
	return &MojaloopClient{
		baseURL: baseURL,
		fspID:   fspID,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

type MojaloopQuoteRequest struct {
	QuoteID     string `json:"quoteId"`
	TransactionID string `json:"transactionId"`
	Payer       map[string]interface{} `json:"payer"`
	Payee       map[string]interface{} `json:"payee"`
	AmountType  string `json:"amountType"`
	Amount      map[string]interface{} `json:"amount"`
	TransactionType map[string]interface{} `json:"transactionType"`
	Note        string `json:"note"`
}

func (m *MojaloopClient) CreateQuote(ctx context.Context, paymentRef string, amountMinor uint64, currency, payerFSP string) (string, error) {
	quoteID := uuid.New().String()
	txID := uuid.New().String()

	body := MojaloopQuoteRequest{
		QuoteID:       quoteID,
		TransactionID: txID,
		Payer: map[string]interface{}{
			"partyIdInfo": map[string]interface{}{
				"partyIdType":      "BUSINESS",
				"partyIdentifier":  payerFSP,
				"fspId":            payerFSP,
			},
		},
		Payee: map[string]interface{}{
			"partyIdInfo": map[string]interface{}{
				"partyIdType":     "GOVERNMENT",
				"partyIdentifier": "NCS-CUSTOMS-DUTY",
				"fspId":           m.fspID,
			},
		},
		AmountType: "RECEIVE",
		Amount: map[string]interface{}{
			"amount":   minorToDecimal(amountMinor),
			"currency": currency,
		},
		TransactionType: map[string]interface{}{
			"scenario":    "TRANSFER",
			"subScenario": "CUSTOMS_DUTY",
			"initiator":   "PAYER",
			"initiatorType": "BUSINESS",
		},
		Note: fmt.Sprintf("TradeGateway payment ref: %s", paymentRef),
	}

	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "POST", m.baseURL+"/quotes", bytes.NewReader(data))
	if err != nil {
		return quoteID, err
	}
	req.Header.Set("Content-Type", "application/vnd.interoperability.quotes+json;version=1.0")
	req.Header.Set("FSPIOP-Source", m.fspID)
	req.Header.Set("FSPIOP-Destination", payerFSP)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))

	resp, err := m.client.Do(req)
	if err != nil {
		// SW-M9: a failed send is an ERROR, not a success — the caller marks
		// the payment failed and returns a retryable 503.
		return quoteID, fmt.Errorf("mojaloop quote send failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return quoteID, fmt.Errorf("mojaloop quote failed: %d %s", resp.StatusCode, string(body))
	}

	return quoteID, nil
}

func (m *MojaloopClient) InitiateTransfer(ctx context.Context, quoteID, paymentRef string, amountMinor uint64, currency, payerFSP, ilpPacket, condition string) (string, error) {
	txID := uuid.New().String()

	body := map[string]interface{}{
		"transferId": txID,
		"quoteId":    quoteID,
		"payerFsp":   payerFSP,
		"payeeFsp":   m.fspID,
		"amount": map[string]interface{}{
			"amount":   minorToDecimal(amountMinor),
			"currency": currency,
		},
		// ilpPacket and condition are sourced from the DB (set during createQuote via generateILPComponents
		// or updated from the Mojaloop PUT /quotes/{quoteId} callback). They are passed in by the caller.
		"ilpPacket":  ilpPacket,
		"condition":  condition,
		"expiration": time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339),
	}

	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "POST", m.baseURL+"/transfers", bytes.NewReader(data))
	if err != nil {
		return txID, err
	}
	req.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.0")
	req.Header.Set("FSPIOP-Source", payerFSP)
	req.Header.Set("FSPIOP-Destination", m.fspID)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))

	resp, err := m.client.Do(req)
	if err != nil {
		// SW-M9: honest failure — the payment is marked FAILED with the real
		// reason and the caller returns a retryable error status.
		return txID, fmt.Errorf("mojaloop transfer send failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return txID, fmt.Errorf("mojaloop transfer failed: %d %s", resp.StatusCode, string(body))
	}

	return txID, nil
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

type Server struct {
	store    *PaymentStore
	mojaloop *MojaloopClient
	config   Config
}

func (s *Server) createQuote(c *gin.Context) {
	var req QuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	paymentRef := fmt.Sprintf("TG-%d-%s", time.Now().UnixNano(), uuid.New().String()[:8])
	ctx := c.Request.Context()

	// SW-12: exact integer minor units with an explicit guard.
	amountMinor, err := minorUnits(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate ILP components locally as fallback (Mojaloop switch may provide these via callback)
	destAccount := fmt.Sprintf("ncs-duty")
	if req.DeclarationID != nil {
		destAccount = fmt.Sprintf("ncs-duty-%d", *req.DeclarationID)
	}
	ilpPacket, condition, fulfillment, err := generateILPComponents(amountMinor, req.Currency, destAccount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ILP generation failed: " + err.Error()})
		return
	}

	payment := &Payment{
		PaymentRef:    paymentRef,
		DeclarationID: req.DeclarationID,
		TraderID:      req.TraderID,
		PaymentType:   req.PaymentType,
		Amount:        req.Amount,
		Currency:      req.Currency,
		Status:        PaymentStatusPending,
		PayerFSP:      req.PayerFSP,
		PayeeFSP:      s.config.MojaloopFSPID,
		ILPPacket:     &ilpPacket,
		Condition:     &condition,
		Fulfillment:   &fulfillment,
	}

	if err := s.store.Create(ctx, payment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Send quote request to the Mojaloop switch.
	// SW-M9: a failed quote send is an honest, retryable error — the payment is
	// marked FAILED with the real reason; nothing is logged-as-success.
	quoteID, err := s.mojaloop.CreateQuote(ctx, paymentRef, amountMinor, req.Currency, req.PayerFSP)
	if err != nil {
		errMsg := err.Error()
		_ = s.store.UpdateStatus(ctx, paymentRef, PaymentStatusFailed, nil, &errMsg)
		paymentsFailed.Inc()
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":      "payment switch unavailable — quote NOT created; retry later",
			"detail":     errMsg,
			"paymentRef": paymentRef,
			"status":     PaymentStatusFailed,
		})
		return
	}
	s.pool_UpdateQuote(ctx, paymentRef, quoteID)

	paymentsInitiated.WithLabelValues(string(req.PaymentType)).Inc()
	paymentAmountTotal.WithLabelValues(req.Currency).Add(req.Amount)

	c.JSON(http.StatusCreated, gin.H{
		"paymentRef":       paymentRef,
		"quoteId":          quoteID,
		"ilpPacket":        ilpPacket,
		"condition":        condition,
		"amount":           req.Amount,
		"amountMinorUnits": amountMinor,
		"currency":         req.Currency,
		"status":           PaymentStatusQuoted,
	})
}

func (s *Server) pool_UpdateQuote(ctx context.Context, paymentRef, quoteID string) {
	s.store.pool.Exec(ctx, `
		UPDATE mojaloop_payments SET quote_id = $1, status = 'QUOTED', updated_at = NOW()
		WHERE payment_ref = $2
	`, quoteID, paymentRef)
}

func (s *Server) initiateTransfer(c *gin.Context) {
	var req TransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	payment, err := s.store.GetByRef(ctx, req.PaymentRef)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Payment not found"})
		return
	}

	// Read ILP packet and condition from DB (generated at quote time or updated from Mojaloop callback)
	ilpPacket := ""
	condition := ""
	if payment.ILPPacket != nil {
		ilpPacket = *payment.ILPPacket
	}
	if payment.Condition != nil {
		condition = *payment.Condition
	}
	if ilpPacket == "" || condition == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ILP packet or condition not available — quote must be created first"})
		return
	}
	amountMinor, err := minorUnits(payment.Amount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "stored payment amount is invalid: " + err.Error()})
		return
	}
	txID, err := s.mojaloop.InitiateTransfer(ctx, req.QuoteID, req.PaymentRef,
		amountMinor, payment.Currency, payment.PayerFSP, ilpPacket, condition)
	if err != nil {
		errMsg := err.Error()
		_ = s.store.UpdateStatus(ctx, req.PaymentRef, PaymentStatusFailed, nil, &errMsg)
		paymentsFailed.Inc()
		c.JSON(http.StatusBadGateway, gin.H{"error": "Transfer initiation failed: " + err.Error()})
		return
	}

	_ = s.store.UpdateStatus(ctx, req.PaymentRef, PaymentStatusInitiated, &txID, nil)

	c.JSON(http.StatusOK, gin.H{
		"paymentRef":    req.PaymentRef,
		"transferId":    txID,
		"status":        PaymentStatusInitiated,
		"message":       "Transfer initiated. Awaiting Mojaloop confirmation callback.",
	})
}

func (s *Server) handleCallback(c *gin.Context) {
	// Mojaloop sends PUT /transfers/{transferId} as the completion callback.
	//
	// SW-M9: the callback is AUTHENTICATED (HMAC-SHA256 FSPIOP-Signature over
	// the raw body, timing-safe), the fulfilment is VERIFIED against the stored
	// condition, and transitions are IDEMPOTENT — a replayed COMMITTED never
	// completes twice or republishes the event.
	rawBody, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid callback body"})
		return
	}
	if !verifyCallbackSignature(rawBody, c.GetHeader("FSPIOP-Signature")) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid callback signature"})
		return
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rawBody, &body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transferState, _ := body["transferState"].(string)
	transferID, _ := body["transferId"].(string)
	if transferID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "transferId is required"})
		return
	}

	// Find payment by mojaloop_tx_id (persisted at initiation)
	ctx := c.Request.Context()
	var paymentRef, currentStatus string
	var conditionHash *string
	err = s.store.pool.QueryRow(ctx, `
		SELECT payment_ref, status, condition_hash FROM mojaloop_payments WHERE mojaloop_tx_id = $1
	`, transferID).Scan(&paymentRef, &currentStatus, &conditionHash)
	if err != nil || paymentRef == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown transfer"})
		return
	}

	// Idempotent replay: already in a terminal state.
	if currentStatus == string(PaymentStatusCompleted) {
		c.JSON(http.StatusOK, gin.H{"status": "already_completed", "idempotent": true})
		return
	}
	if currentStatus == string(PaymentStatusFailed) {
		c.JSON(http.StatusConflict, gin.H{"error": "transfer is already in terminal state FAILED"})
		return
	}

	if transferState == "COMMITTED" {
		// Verify the fulfilment against the condition stored at initiation.
		fulfilment, _ := body["fulfilment"].(string)
		if conditionHash == nil || *conditionHash == "" || fulfilment == "" || !verifyFulfilment(fulfilment, *conditionHash) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "fulfilment does not satisfy the transfer condition"})
			return
		}

		// SW-M17: publish the money-state event SYNCHRONOUSLY before the status
		// flip; on failure return 503 so the switch retries (status unchanged).
		if err := s.publishPaymentEvent(ctx, "PAYMENT_COMPLETED", paymentRef, transferID); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "event publish failed — transfer NOT completed; retry the callback"})
			return
		}
		if err := s.store.UpdateStatus(ctx, paymentRef, PaymentStatusCompleted, &transferID, nil); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		paymentsCompleted.Inc()
	} else if transferState == "ABORTED" {
		errMsg := "Transfer aborted by Mojaloop"
		if e, _ := body["errorInformation"].(map[string]interface{}); e != nil {
			if d, _ := e["errorDescription"].(string); d != "" {
				errMsg = d
			}
		}
		_ = s.store.UpdateStatus(ctx, paymentRef, PaymentStatusFailed, &transferID, &errMsg)
		paymentsFailed.Inc()
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported transferState"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "processed"})
}

// publishPaymentEvent publishes a payment event via Dapr.
// SW-M17: synchronous with error propagation — no fire-and-forget on
// money-state transitions.
func (s *Server) publishPaymentEvent(ctx context.Context, eventType, paymentRef, txID string) error {
	data, err := json.Marshal(map[string]interface{}{
		"eventType":  eventType,
		"paymentRef": paymentRef,
		"txId":       txID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/payment.events", s.config.DaprPort)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("publish failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("publish returned %d", resp.StatusCode)
	}
	return nil
}

func (s *Server) getPayment(c *gin.Context) {
	paymentRef := c.Param("id")
	payment, err := s.store.GetByRef(c.Request.Context(), paymentRef)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Payment not found"})
		return
	}
	c.JSON(http.StatusOK, payment)
}

func main() {
	// SW-M9: the callback verification secret is mandatory in production.
	if isProduction() && os.Getenv("MOJALOOP_CALLBACK_SECRET") == "" {
		log.Fatal("[mojaloop-service] FATAL: MOJALOOP_CALLBACK_SECRET must be set in production (callback authentication). Refusing to boot.")
	}
	cfg := loadConfig()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("DB connection failed: %v", err)
	}
	defer pool.Close()

	store := NewPaymentStore(pool)
	if err := store.EnsureSchema(ctx); err != nil {
		log.Fatalf("Schema setup failed: %v", err)
	}

	mojaloop := NewMojaloopClient(cfg.MojaloopBaseURL, cfg.MojaloopFSPID)
	srv := &Server{store: store, mojaloop: mojaloop, config: cfg}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "mojaloop-service"})
	})
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	api := r.Group("/api/payments")
	api.POST("/quote", srv.createQuote)
	api.POST("/transfer", srv.initiateTransfer)
	api.GET("/:id", srv.getPayment)
	api.PUT("/callback", srv.handleCallback)

	httpSrv := &http.Server{Addr: ":" + cfg.Port, Handler: r}
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("[mojaloop-service] Starting on port %s", cfg.Port)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-quit
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
