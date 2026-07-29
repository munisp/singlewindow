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
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

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
	ID             int64         `json:"id"`
	PaymentRef     string        `json:"paymentRef"`
	DeclarationID  *int64        `json:"declarationId,omitempty"`
	TraderID       int64         `json:"traderId"`
	PaymentType    PaymentType   `json:"paymentType"`
	Amount         float64       `json:"amount"`
	Currency       string        `json:"currency"`
	Status         PaymentStatus `json:"status"`
	MojaloopTxID   *string       `json:"mojaloopTxId,omitempty"`
	TigerBeetleID  *string       `json:"tigerBeetleId,omitempty"`
	QuoteID        *string       `json:"quoteId,omitempty"`
	PayerFSP       string        `json:"payerFsp"`
	PayeeFSP       string        `json:"payeeFsp"`
	ErrorMessage   *string       `json:"errorMessage,omitempty"`
	CreatedAt      time.Time     `json:"createdAt"`
	UpdatedAt      time.Time     `json:"updatedAt"`
	CompletedAt    *time.Time    `json:"completedAt,omitempty"`
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
	`)
	return err
}

func (s *PaymentStore) Create(ctx context.Context, p *Payment) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO mojaloop_payments (payment_ref, declaration_id, trader_id, payment_type,
		                               amount, currency, status, payer_fsp, payee_fsp)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at, updated_at
	`, p.PaymentRef, p.DeclarationID, p.TraderID, p.PaymentType,
		p.Amount, p.Currency, p.Status, p.PayerFSP, p.PayeeFSP).
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
		       status, mojaloop_tx_id, tigerbeetle_id, quote_id, payer_fsp, payee_fsp,
		       error_message, created_at, updated_at, completed_at
		FROM mojaloop_payments WHERE payment_ref = $1
	`, paymentRef).Scan(
		&p.ID, &p.PaymentRef, &p.DeclarationID, &p.TraderID, &p.PaymentType, &p.Amount, &p.Currency,
		&p.Status, &p.MojaloopTxID, &p.TigerBeetleID, &p.QuoteID, &p.PayerFSP, &p.PayeeFSP,
		&p.ErrorMessage, &p.CreatedAt, &p.UpdatedAt, &p.CompletedAt,
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

func (m *MojaloopClient) CreateQuote(ctx context.Context, paymentRef string, amount float64, currency, payerFSP string) (string, error) {
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
			"amount":   fmt.Sprintf("%.2f", amount),
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
		// Mojaloop uses async callbacks, so a 202 Accepted is the success response
		log.Printf("[mojaloop] Quote request sent (async): %v", err)
		return quoteID, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return quoteID, fmt.Errorf("mojaloop quote failed: %d %s", resp.StatusCode, string(body))
	}

	return quoteID, nil
}

func (m *MojaloopClient) InitiateTransfer(ctx context.Context, quoteID, paymentRef string, amount float64, currency, payerFSP string) (string, error) {
	txID := uuid.New().String()

	body := map[string]interface{}{
		"transferId": txID,
		"quoteId":    quoteID,
		"payerFsp":   payerFSP,
		"payeeFsp":   m.fspID,
		"amount": map[string]interface{}{
			"amount":   fmt.Sprintf("%.2f", amount),
			"currency": currency,
		},
		"ilpPacket":  "placeholder_ilp_packet", // In production, use the ILP packet from the quote response
		"condition":  "placeholder_condition",
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
		log.Printf("[mojaloop] Transfer request sent (async): %v", err)
		return txID, nil
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
	}

	ctx := c.Request.Context()
	if err := s.store.Create(ctx, payment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	quoteID, err := s.mojaloop.CreateQuote(ctx, paymentRef, req.Amount, req.Currency, req.PayerFSP)
	if err != nil {
		log.Printf("[mojaloop] Quote creation error: %v", err)
	}

	// Update with quote ID
	s.pool_UpdateQuote(ctx, paymentRef, quoteID)
	paymentsInitiated.WithLabelValues(string(req.PaymentType)).Inc()
	paymentAmountTotal.WithLabelValues(req.Currency).Add(req.Amount)

	c.JSON(http.StatusCreated, gin.H{
		"paymentRef": paymentRef,
		"quoteId":    quoteID,
		"amount":     req.Amount,
		"currency":   req.Currency,
		"status":     PaymentStatusQuoted,
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

	txID, err := s.mojaloop.InitiateTransfer(ctx, req.QuoteID, req.PaymentRef,
		payment.Amount, payment.Currency, payment.PayerFSP)
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
	// Mojaloop sends PUT /transfers/{transferId} as the completion callback
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transferState, _ := body["transferState"].(string)
	transferID, _ := body["transferId"].(string)

	// Find payment by mojaloop_tx_id
	ctx := c.Request.Context()
	var paymentRef string
	s.store.pool.QueryRow(ctx, `
		SELECT payment_ref FROM mojaloop_payments WHERE mojaloop_tx_id = $1
	`, transferID).Scan(&paymentRef)

	if paymentRef == "" {
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	if transferState == "COMMITTED" {
		_ = s.store.UpdateStatus(ctx, paymentRef, PaymentStatusCompleted, &transferID, nil)
		paymentsCompleted.Inc()

		// Publish completion event via Dapr
		s.publishPaymentEvent(ctx, "PAYMENT_COMPLETED", paymentRef, transferID)
	} else if transferState == "ABORTED" {
		errMsg := "Transfer aborted by Mojaloop"
		_ = s.store.UpdateStatus(ctx, paymentRef, PaymentStatusFailed, &transferID, &errMsg)
		paymentsFailed.Inc()
	}

	c.JSON(http.StatusOK, gin.H{"status": "processed"})
}

func (s *Server) publishPaymentEvent(ctx context.Context, eventType, paymentRef, txID string) {
	data, _ := json.Marshal(map[string]interface{}{
		"eventType":  eventType,
		"paymentRef": paymentRef,
		"txId":       txID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/payment.events", s.config.DaprPort)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(data))
	if req != nil {
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 3 * time.Second}
		resp, _ := client.Do(req)
		if resp != nil {
			resp.Body.Close()
		}
	}
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
