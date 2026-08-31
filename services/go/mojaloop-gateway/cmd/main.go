// TradeGateway NGSWTP — Mojaloop Gateway Service
// Language: Go 1.25
// Role: Orchestrates the full ILP (Interledger Protocol) payment cycle between
//       the customs duty assessment engine, Mojaloop FSPIOP API, and TigerBeetle
//       double-entry financial ledger. Exposes both HTTP/REST (port 8085) and
//       gRPC (port 9085) interfaces. Publishes payment events to Kafka.
//
// Payment lifecycle (Phase-9 WP-B: REAL integration surfaces, fail-closed):
//   1. Receive payment initiation from tRPC API (declaration ID + method +
//      tariff assessment request)
//   2. Assess duty via the financial-controls tariff engine
//      (POST /v1/tariffs/assess, Idempotency-Key, resilient client) —
//      DUTY_ASSESSMENT_UNAVAILABLE when unconfigured/unreachable; there is NO
//      embedded fallback rate table.
//   3. Request ILP quote: real FSPIOP POST /quotes to the configured switch —
//      NOT_IMPLEMENTED (QUOTE_SWITCH_NOT_CONFIGURED) when MOJALOOP_URL unset.
//   4. Await the REAL signed FSPIOP PUT /quotes/{id} callback (bounded timeout).
//   5. Initiate transfer: real signed FSPIOP POST /transfers.
//   6. TigerBeetle bridge: real POST /api/ledger/transfers/pending (reserve).
//   7. Await the REAL DFSP fulfilment callback PUT /transfers/{id}.
//   8. TigerBeetle bridge: real POST /api/ledger/transfers/post/{pendingId}.
//   9. Publish payment.confirmed to Kafka with an idempotent producer.
//  10. Return settlement confirmation to tRPC API.
//
// The step recorder now records REAL outcomes only: any step whose dependency
// is unconfigured fails the pipeline with a typed error — nothing is
// fabricated, and there are no sleeps simulating latency.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/IBM/sarama"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	"github.com/tradegateway/mojaloop-gateway/internal/dfsp"
	"github.com/tradegateway/mojaloop-gateway/internal/tariff"
	"github.com/tradegateway/mojaloop-gateway/internal/telemetry"
)

// ─── Domain types ─────────────────────────────────────────────────────────────

// PaymentStatus represents the lifecycle state of an ILP payment.
type PaymentStatus string

const (
	StatusInitiated   PaymentStatus = "INITIATED"
	StatusQuoteReq    PaymentStatus = "QUOTE_REQUESTED"
	StatusQuoteRcvd   PaymentStatus = "QUOTE_RECEIVED"
	StatusTransferReq PaymentStatus = "TRANSFER_REQUESTED"
	StatusReserved    PaymentStatus = "TIGERBEETLE_RESERVED"
	StatusFulfilled   PaymentStatus = "TRANSFER_FULFILLED"
	StatusPosted      PaymentStatus = "TIGERBEETLE_POSTED"
	StatusConfirmed   PaymentStatus = "CONFIRMED"
	StatusFailed      PaymentStatus = "FAILED"
	StatusExpired     PaymentStatus = "EXPIRED"
)

// ILPQuote represents a Mojaloop FSPIOP quote response.
type ILPQuote struct {
	QuoteID        string    `json:"quoteId"`
	TransactionID  string    `json:"transactionId"`
	ILPPacket      string    `json:"ilpPacket"`
	Condition      string    `json:"condition"`
	Expiration     time.Time `json:"expiration"`
	TransferAmount struct {
		Amount   string `json:"amount"`
		Currency string `json:"currency"`
	} `json:"transferAmount"`
	PayeeFSPFee struct {
		Amount   string `json:"amount"`
		Currency string `json:"currency"`
	} `json:"payeeFspFee"`
}

// PaymentRecord tracks the full lifecycle of a payment.
type PaymentRecord struct {
	mu            sync.RWMutex
	ID            string        `json:"id"`
	DeclarationID string        `json:"declarationId"`
	TraderID      string        `json:"traderId"`
	Amount        string        `json:"amount"`
	Currency      string        `json:"currency"`
	PaymentMethod string        `json:"paymentMethod"`
	Status        PaymentStatus `json:"status"`
	Quote         *ILPQuote     `json:"quote,omitempty"`
	AssessmentID  string        `json:"assessmentId,omitempty"`
	TransferID    string        `json:"transferId,omitempty"`
	TBPendingID   string        `json:"tbPendingId,omitempty"`
	TBPostedAt    *time.Time    `json:"tbPostedAt,omitempty"`
	Fulfilment    string        `json:"fulfilment,omitempty"`
	ErrorCode     string        `json:"errorCode,omitempty"`
	ErrorMessage  string        `json:"errorMessage,omitempty"`
	InitiatedAt   time.Time     `json:"initiatedAt"`
	ConfirmedAt   *time.Time    `json:"confirmedAt,omitempty"`
	Steps         []PaymentStep `json:"steps"`

	// tariffRequest is the caller-supplied input to the tariff engine. It is
	// required whenever a tariff engine is configured — the gateway never
	// invents assessment inputs.
	tariffRequest *tariff.AssessRequest
}

// PaymentStep records each stage of the payment lifecycle for audit and UI trace.
type PaymentStep struct {
	StepID      int           `json:"stepId"`
	Name        string        `json:"name"`
	System      string        `json:"system"`
	Protocol    string        `json:"protocol"`
	Status      PaymentStatus `json:"status"`
	StartedAt   time.Time     `json:"startedAt"`
	CompletedAt *time.Time    `json:"completedAt,omitempty"`
	LatencyMs   int64         `json:"latencyMs,omitempty"`
	Request     interface{}   `json:"request,omitempty"`
	Response    interface{}   `json:"response,omitempty"`
	Error       string        `json:"error,omitempty"`
}

// ─── In-memory store (replace with PostgreSQL in production) ─────────────────

var (
	payments   = make(map[string]*PaymentRecord)
	paymentsMu sync.RWMutex
)

// ─── Typed pipeline errors (fail-closed classification) ──────────────────────

// PipelineErrorCode classifies a pipeline failure for API consumers and
// audit. Every code is terminal: the pipeline never fabricates an outcome.
type PipelineErrorCode string

const (
	// ErrCodeDutyUnavailable: tariff engine unconfigured or unreachable
	// after retries (fail-closed — never an embedded fallback rate).
	ErrCodeDutyUnavailable PipelineErrorCode = "DUTY_ASSESSMENT_UNAVAILABLE"
	// ErrCodeDutyRejected: the engine rejected the assessment request (4xx).
	ErrCodeDutyRejected PipelineErrorCode = "DUTY_ASSESSMENT_REJECTED"
	// ErrCodeQuoteNotConfigured: no Mojaloop switch endpoint configured
	// (MOJALOOP_URL unset) — the FSPIOP quote flow is NOT_IMPLEMENTED here.
	ErrCodeQuoteNotConfigured PipelineErrorCode = "QUOTE_SWITCH_NOT_CONFIGURED"
	// ErrCodeQuoteFailed: the switch rejected the quote or the callback
	// never arrived before the bounded deadline.
	ErrCodeQuoteFailed PipelineErrorCode = "QUOTE_FAILED"
	// ErrCodeTransferFailed: the switch rejected the transfer prepare or the
	// fulfilment callback never arrived / failed verification.
	ErrCodeTransferFailed PipelineErrorCode = "TRANSFER_FAILED"
	// ErrCodeLedgerUnavailable: TigerBeetle bridge unconfigured or failing.
	ErrCodeLedgerUnavailable PipelineErrorCode = "LEDGER_UNAVAILABLE"
	// ErrCodeKafkaNotConfigured: no Kafka broker configured for the
	// payment.confirmed publication (fail-closed — never log-only).
	ErrCodeKafkaNotConfigured PipelineErrorCode = "KAFKA_NOT_CONFIGURED"
	// ErrCodeKafkaPublish: the broker rejected the confirmation event.
	ErrCodeKafkaPublish PipelineErrorCode = "KAFKA_PUBLISH_FAILED"
)

// PipelineError is a typed pipeline failure.
type PipelineError struct {
	Code PipelineErrorCode
	Err  error
}

func (e *PipelineError) Error() string { return fmt.Sprintf("%s: %v", e.Code, e.Err) }
func (e *PipelineError) Unwrap() error { return e.Err }

// ─── Service ─────────────────────────────────────────────────────────────────

type MojaloopGateway struct {
	logger        *zap.Logger
	tariffClient  *tariff.Client // nil when TARIFF_SERVICE_URL unset
	tariffErr     error          // configuration error surfaced at call time
	switchURL     string         // MOJALOOP_URL ("" = unconfigured)
	quoteBuilder  *dfsp.QuoteBuilder
	xferBuilder   *dfsp.TransferBuilder
	cbHandler     *dfsp.CallbackHandler
	dfspID        string
	payeeFspID    string
	payeePartyID  string
	tbBridgeURL   string // TIGERBEETLE_BRIDGE_URL ("" = unconfigured)
	kafkaProducer sarama.SyncProducer
	kafkaBrokers  []string
	callbackWait  time.Duration
	httpClient    *http.Client
}

// NewMojaloopGateway wires the REAL integration surfaces from the
// environment. Unconfigured surfaces stay nil/empty and the corresponding
// pipeline step fails closed with a typed error — there are no phantom
// defaults pointing at invented hostnames.
func NewMojaloopGateway(logger *zap.Logger) *MojaloopGateway {
	g := &MojaloopGateway{
		logger:       logger,
		cbHandler:    dfsp.NewCallbackHandler(logger),
		dfspID:       getEnv("MOJALOOP_DFSP_ID", "tradegateway"),
		payeeFspID:   os.Getenv("MOJALOOP_PAYEE_FSP_ID"),
		payeePartyID: os.Getenv("MOJALOOP_PAYEE_PARTY_ID"),
		tbBridgeURL:  strings.TrimRight(os.Getenv("TIGERBEETLE_BRIDGE_URL"), "/"),
		httpClient:   &http.Client{Timeout: 15 * time.Second, Transport: telemetry.Transport(nil)},
		callbackWait: 60 * time.Second,
	}
	if v := os.Getenv("MOJALOOP_CALLBACK_TIMEOUT_MS"); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms > 0 {
			g.callbackWait = time.Duration(ms) * time.Millisecond
		}
	}

	// Tariff engine client (fail-closed when unconfigured/misconfigured).
	if base := os.Getenv("TARIFF_SERVICE_URL"); base != "" {
		client, err := tariff.NewClient(tariff.Config{
			BaseURL:          base,
			StaticToken:      os.Getenv("TARIFF_SERVICE_TOKEN"),
			KeycloakTokenURL: os.Getenv("KEYCLOAK_TOKEN_URL"),
			ClientID:         os.Getenv("TARIFF_SERVICE_CLIENT_ID"),
			ClientSecret:     os.Getenv("TARIFF_SERVICE_CLIENT_SECRET"),
		})
		if err != nil {
			g.tariffErr = err
			logger.Error("tariff client misconfigured — duty assessment will fail closed", zap.Error(err))
		} else {
			g.tariffClient = client
		}
	}

	// Mojaloop switch clients (fail-closed NOT_IMPLEMENTED when unset).
	if sw := strings.TrimRight(os.Getenv("MOJALOOP_URL"), "/"); sw != "" {
		signer, err := dfsp.NewSigner(logger)
		if err != nil {
			logger.Error("FSPIOP signer unavailable — switch steps will fail closed", zap.Error(err))
		} else {
			g.switchURL = sw
			g.quoteBuilder = dfsp.NewQuoteBuilder(sw, g.dfspID, signer, logger)
			if tb, err := dfsp.NewTransferBuilder(sw, g.dfspID, signer, logger); err != nil {
				logger.Error("transfer builder unavailable", zap.Error(err))
			} else {
				g.xferBuilder = tb
			}
		}
	}

	// Kafka idempotent producer for payment.confirmed (fail-closed when unset).
	if brokers := os.Getenv("KAFKA_BROKERS"); brokers != "" {
		g.kafkaBrokers = strings.Split(brokers, ",")
		producer, err := newIdempotentProducer(g.kafkaBrokers)
		if err != nil {
			logger.Error("kafka producer init failed — confirmation step will fail closed", zap.Error(err))
		} else {
			g.kafkaProducer = producer
		}
	}
	return g
}

// newIdempotentProducer builds a sarama SyncProducer with the platform
// idempotence configuration (PRA-116) and env-driven TLS/SASL wiring
// (PRA-118; certs/credentials are env-supplied, tests use plaintext local brokers).
func newIdempotentProducer(brokers []string) (sarama.SyncProducer, error) {
	cfg := sarama.NewConfig()
	cfg.Producer.RequiredAcks = sarama.WaitForAll
	cfg.Producer.Idempotent = true
	cfg.Net.MaxOpenRequests = 1
	cfg.Producer.Retry.Max = 10
	cfg.Producer.Retry.Backoff = 500 * time.Millisecond
	cfg.Producer.Return.Successes = true
	cfg.Producer.Return.Errors = true
	if os.Getenv("KAFKA_TLS_ENABLED") == "true" {
		cfg.Net.TLS.Enable = true
	}
	if os.Getenv("KAFKA_SASL_ENABLED") == "true" {
		cfg.Net.SASL.Enable = true
		cfg.Net.SASL.Mechanism = sarama.SASLTypePlaintext
		cfg.Net.SASL.User = os.Getenv("KAFKA_SASL_USER")
		cfg.Net.SASL.Password = os.Getenv("KAFKA_SASL_PASSWORD")
	}
	return sarama.NewSyncProducer(brokers, cfg)
}

// InitiatePayment starts the ILP payment cycle for a declaration.
// tariffReq is the caller-supplied tariff engine input; it may be nil only
// when no tariff engine is configured (the duty step then fails closed).
func (g *MojaloopGateway) InitiatePayment(ctx context.Context, declarationID, traderID, amount, currency, method string, tariffReq *tariff.AssessRequest) (*PaymentRecord, error) {
	paymentID := fmt.Sprintf("PAY-%s", uuid.New().String()[:12])
	record := &PaymentRecord{
		ID:            paymentID,
		DeclarationID: declarationID,
		TraderID:      traderID,
		Amount:        amount,
		Currency:      currency,
		PaymentMethod: method,
		Status:        StatusInitiated,
		InitiatedAt:   time.Now().UTC(),
		Steps:         make([]PaymentStep, 0, 8),
		tariffRequest: tariffReq,
	}

	paymentsMu.Lock()
	payments[paymentID] = record
	paymentsMu.Unlock()

	// Execute the ILP payment pipeline asynchronously
	go g.executePipeline(context.Background(), record)

	return record, nil
}

// executePipeline runs the full 8-step ILP payment lifecycle.
func (g *MojaloopGateway) executePipeline(ctx context.Context, r *PaymentRecord) {
	steps := []struct {
		name     string
		system   string
		protocol string
		fn       func(*PaymentRecord) error
	}{
		{"Duty Assessment", "tariff-svc", "gRPC", g.stepDutyAssessment},
		{"ILP Quote Request", "mojaloop-switch", "FSPIOP/REST", g.stepRequestQuote},
		{"Quote Response", "mojaloop-switch", "FSPIOP/REST", g.stepReceiveQuote},
		{"Transfer Initiation", "mojaloop-switch", "FSPIOP/REST", g.stepInitiateTransfer},
		{"TigerBeetle Reserve", "tigerbeetle", "gRPC", g.stepTigerBeetleReserve},
		{"Transfer Fulfilment", "dfsp-connector", "FSPIOP/REST", g.stepReceiveFulfilment},
		{"TigerBeetle Post", "tigerbeetle", "gRPC", g.stepTigerBeetlePost},
		{"Payment Confirmed", "kafka", "Kafka/Avro", g.stepPublishConfirmation},
	}

	for i, step := range steps {
		start := time.Now()
		ps := PaymentStep{
			StepID:    i + 1,
			Name:      step.name,
			System:    step.system,
			Protocol:  step.protocol,
			Status:    StatusInitiated,
			StartedAt: start,
		}

		r.mu.Lock()
		r.Steps = append(r.Steps, ps)
		r.mu.Unlock()

		if err := step.fn(r); err != nil {
			elapsed := time.Since(start).Milliseconds()
			r.mu.Lock()
			r.Steps[i].Status = StatusFailed
			r.Steps[i].Error = err.Error()
			r.Steps[i].LatencyMs = elapsed
			r.Status = StatusFailed
			var perr *PipelineError
			if errors.As(err, &perr) {
				r.ErrorCode = string(perr.Code)
			}
			r.ErrorMessage = fmt.Sprintf("Step %d (%s) failed: %v", i+1, step.name, err)
			r.mu.Unlock()
			g.logger.Error("payment pipeline failed",
				zap.String("step", step.name),
				zap.String("code", r.ErrorCode),
				zap.Error(err))
			return
		}

		elapsed := time.Since(start).Milliseconds()
		now := time.Now().UTC()
		r.mu.Lock()
		r.Steps[i].Status = StatusConfirmed
		r.Steps[i].CompletedAt = &now
		r.Steps[i].LatencyMs = elapsed
		r.mu.Unlock()
	}

	now := time.Now().UTC()
	r.mu.Lock()
	r.Status = StatusConfirmed
	r.ConfirmedAt = &now
	r.mu.Unlock()

	g.logger.Info("payment pipeline completed",
		zap.String("paymentId", r.ID),
		zap.String("declarationId", r.DeclarationID),
	)
}

// ─── Pipeline step implementations ───────────────────────────────────────────
// Every step talks to a REAL external system or fails closed with a typed
// PipelineError. There are no sleeps and no fabricated outcomes: the step
// recorder captures the real request/response/error of each call.

// stepDutyAssessment calls the financial-controls tariff engine
// (POST /v1/tariffs/assess) through the resilient authenticated client.
// Fail-closed: unconfigured engine or missing assessment input is a typed
// error — embedded rates were deleted, there is no fallback.
func (g *MojaloopGateway) stepDutyAssessment(r *PaymentRecord) error {
	if g.tariffClient == nil {
		reason := "TARIFF_SERVICE_URL is not configured — duty assessment cannot be performed and no embedded fallback exists"
		if g.tariffErr != nil {
			reason = g.tariffErr.Error()
		}
		return &PipelineError{Code: ErrCodeDutyUnavailable, Err: errors.New(reason)}
	}
	if r.tariffRequest == nil {
		return &PipelineError{Code: ErrCodeDutyRejected, Err: errors.New("tariffRequest is required — the gateway never invents assessment inputs")}
	}
	req := *r.tariffRequest
	if strings.TrimSpace(req.EntityRef) == "" {
		req.EntityRef = r.DeclarationID
	}

	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"declarationId":  r.DeclarationID,
		"endpoint":       "POST /v1/tariffs/assess",
		"idempotencyKey": r.ID,
		"assessRequest":  req,
	}
	r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	assessment, err := g.tariffClient.Assess(ctx, r.ID, req)
	if err != nil {
		var rejErr *tariff.RejectedError
		if errors.As(err, &rejErr) {
			return &PipelineError{Code: ErrCodeDutyRejected, Err: err}
		}
		return &PipelineError{Code: ErrCodeDutyUnavailable, Err: err}
	}

	r.mu.Lock()
	r.AssessmentID = assessment.AssessmentID
	r.Steps[len(r.Steps)-1].Response = assessment
	r.mu.Unlock()
	return nil
}

// stepRequestQuote sends a REAL FSPIOP POST /quotes to the configured
// Mojaloop switch. Fail-closed NOT_IMPLEMENTED when no switch endpoint is
// configured — a quote is never simulated.
func (g *MojaloopGateway) stepRequestQuote(r *PaymentRecord) error {
	if g.quoteBuilder == nil {
		return &PipelineError{Code: ErrCodeQuoteNotConfigured, Err: errors.New("MOJALOOP_URL is not configured — the FSPIOP quote flow is NOT_IMPLEMENTED without a switch endpoint")}
	}
	if g.payeeFspID == "" || g.payeePartyID == "" {
		return &PipelineError{Code: ErrCodeQuoteFailed, Err: errors.New("MOJALOOP_PAYEE_FSP_ID / MOJALOOP_PAYEE_PARTY_ID are not configured — the payee (revenue authority) cannot be invented")}
	}

	// Pre-generate the quoteId so the callback waiter can be registered
	// BEFORE the request goes on the wire (no callback/registration race).
	quoteID := uuid.New().String()
	awaitCtx, cancel := context.WithTimeout(context.Background(), g.callbackWait)
	r.mu.Lock()
	r.Quote = &ILPQuote{QuoteID: quoteID, TransactionID: r.ID}
	r.mu.Unlock()

	// Waiter registration happens inside AwaitQuote's critical section; the
	// goroutine result is consumed by stepReceiveQuote.
	awaitCh := make(chan struct {
		body *dfsp.QuoteCallbackBody
		err  error
	}, 1)
	go func() {
		body, err := g.cbHandler.AwaitQuote(awaitCtx, quoteID)
		awaitCh <- struct {
			body *dfsp.QuoteCallbackBody
			err  error
		}{body, err}
	}()
	// Stash for stepReceiveQuote.
	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Response = map[string]interface{}{"quoteId": quoteID, "callbackWaitMs": g.callbackWait.Milliseconds()}
	r.mu.Unlock()
	quoteAwaiters.Store(r.ID, &quoteAwait{ch: awaitCh, cancel: cancel})

	ctx, cancelSend := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelSend()
	req, err := g.quoteBuilder.PostQuoteRequest(ctx, dfsp.PostQuoteInput{
		QuoteID:         quoteID,
		TransactionId:   r.ID,
		Scenario:        "TRANSFER",
		PayerIdentifier: r.TraderID,
		PayeeIdType:     "BUSINESS",
		PayeeIdentifier: g.payeePartyID,
		PayeeFspId:      g.payeeFspID,
		Amount:          r.Amount,
		Currency:        r.Currency,
		Note:            fmt.Sprintf("Customs duty payment %s for declaration %s", r.ID, r.DeclarationID),
	})
	if err != nil {
		cancel()
		quoteAwaiters.Delete(r.ID)
		return &PipelineError{Code: ErrCodeQuoteFailed, Err: err}
	}

	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Request = req
	r.mu.Unlock()
	return nil
}

// quoteAwait carries the in-flight callback waiter between pipeline steps.
type quoteAwait struct {
	ch chan struct {
		body *dfsp.QuoteCallbackBody
		err  error
	}
	cancel context.CancelFunc
}

var quoteAwaiters sync.Map // paymentID → *quoteAwait

type transferAwait struct {
	ch chan struct {
		body *dfsp.TransferCallbackBody
		err  error
	}
	cancel context.CancelFunc
}

var transferAwaiters sync.Map // paymentID → *transferAwait

// stepReceiveQuote consumes the REAL FSPIOP quote callback (signed by the
// Hub, JWS-verified by the callback handler). A timeout or switch error is a
// typed failure — the ILP condition is never fabricated.
func (g *MojaloopGateway) stepReceiveQuote(r *PaymentRecord) error {
	v, ok := quoteAwaiters.Load(r.ID)
	if !ok {
		return &PipelineError{Code: ErrCodeQuoteFailed, Err: errors.New("internal: no quote waiter registered")}
	}
	defer quoteAwaiters.Delete(r.ID)
	await := v.(*quoteAwait)
	defer await.cancel()

	res := <-await.ch
	if res.err != nil {
		return &PipelineError{Code: ErrCodeQuoteFailed, Err: res.err}
	}
	cb := res.body
	expiry, err := time.Parse(time.RFC3339Nano, cb.Expiration)
	if err != nil {
		expiry, err = time.Parse(time.RFC3339, cb.Expiration)
		if err != nil {
			return &PipelineError{Code: ErrCodeQuoteFailed, Err: fmt.Errorf("unparseable quote expiration %q: %w", cb.Expiration, err)}
		}
	}
	if time.Now().After(expiry) {
		return &PipelineError{Code: ErrCodeQuoteFailed, Err: fmt.Errorf("quote %s already expired at %s", cb.QuoteID, cb.Expiration)}
	}

	quote := &ILPQuote{
		QuoteID:       cb.QuoteID,
		TransactionID: cb.TransactionID,
		ILPPacket:     cb.ILPPacket,
		Condition:     cb.Condition,
		Expiration:    expiry,
	}
	quote.TransferAmount.Amount = cb.TransferAmount.Amount
	quote.TransferAmount.Currency = cb.TransferAmount.Currency
	if cb.PayeeFSPFee != nil {
		quote.PayeeFSPFee.Amount = cb.PayeeFSPFee.Amount
		quote.PayeeFSPFee.Currency = cb.PayeeFSPFee.Currency
	}

	r.mu.Lock()
	r.Quote = quote
	r.Status = StatusQuoteRcvd
	r.Steps[len(r.Steps)-1].Response = cb
	r.mu.Unlock()
	return nil
}

// stepInitiateTransfer sends a REAL signed FSPIOP POST /transfers (prepare
// leg) carrying the ILP packet and condition from the received quote.
func (g *MojaloopGateway) stepInitiateTransfer(r *PaymentRecord) error {
	if g.xferBuilder == nil {
		return &PipelineError{Code: ErrCodeQuoteNotConfigured, Err: errors.New("MOJALOOP_URL is not configured — the FSPIOP transfer flow is NOT_IMPLEMENTED without a switch endpoint")}
	}
	r.mu.RLock()
	quote := r.Quote
	r.mu.RUnlock()
	if quote == nil || quote.Condition == "" || quote.ILPPacket == "" {
		return &PipelineError{Code: ErrCodeTransferFailed, Err: errors.New("no verified quote with an ILP condition is available — refusing to send a transfer without one")}
	}

	// Pre-generate the transferId so the fulfilment-callback waiter is
	// registered BEFORE the prepare goes on the wire (no race with a fast hub).
	transferID := uuid.New().String()
	awaitCtx, cancel := context.WithTimeout(context.Background(), g.callbackWait)
	awaitCh := make(chan struct {
		body *dfsp.TransferCallbackBody
		err  error
	}, 1)
	go func() {
		body, err := g.cbHandler.AwaitTransfer(awaitCtx, transferID)
		awaitCh <- struct {
			body *dfsp.TransferCallbackBody
			err  error
		}{body, err}
	}()
	transferAwaiters.Store(r.ID, &transferAwait{ch: awaitCh, cancel: cancel})

	ctx, cancelSend := context.WithTimeout(context.Background(), 30*time.Second)
	sentID, err := g.xferBuilder.PostTransfer(ctx, dfsp.PostTransferInput{
		TransferID: transferID,
		PayeeFspId: g.payeeFspID,
		Amount:     r.Amount,
		Currency:   r.Currency,
		ILPPacket:  quote.ILPPacket,
		Condition:  quote.Condition,
		Expiration: quote.Expiration,
	})
	cancelSend()
	if err != nil {
		cancel()
		transferAwaiters.Delete(r.ID)
		return &PipelineError{Code: ErrCodeTransferFailed, Err: err}
	}
	if sentID != transferID {
		cancel()
		transferAwaiters.Delete(r.ID)
		return &PipelineError{Code: ErrCodeTransferFailed, Err: fmt.Errorf("internal: sent transferId %s != pre-registered %s", sentID, transferID)}
	}

	// Bind the ILP condition to the REAL transferId for fulfilment
	// verification in the transfer callback handler.
	g.cbHandler.StorePendingILP(transferID, quote.Condition)

	r.mu.Lock()
	r.TransferID = transferID
	r.Status = StatusTransferReq
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"transferId": transferID,
		"payerFsp":   g.dfspID,
		"payeeFsp":   g.payeeFspID,
		"amount":     map[string]string{"amount": r.Amount, "currency": r.Currency},
		"ilpPacket":  quote.ILPPacket,
		"condition":  quote.Condition,
		"expiration": quote.Expiration,
	}
	r.mu.Unlock()
	return nil
}

// stepTigerBeetleReserve reserves the funds via a REAL pending transfer on
// the TigerBeetle bridge (trader liability → customs revenue pending).
func (g *MojaloopGateway) stepTigerBeetleReserve(r *PaymentRecord) error {
	if g.tbBridgeURL == "" {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: errors.New("TIGERBEETLE_BRIDGE_URL is not configured — funds cannot be reserved without the ledger bridge")}
	}
	amountMinor, err := parseDecimalMinor(r.Amount)
	if err != nil {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: fmt.Errorf("payment amount %q is not a valid decimal: %w", r.Amount, err)}
	}
	payload := map[string]interface{}{
		// Standard seeded accounts (tigerbeetle-bridge StandardAccounts):
		// 0000000000000001 trader liability, 0000000000000002 revenue pending.
		"debitAccountId":  "0000000000000001",
		"creditAccountId": "0000000000000002",
		"amount":          amountMinor,
		"currency":        r.Currency,
		"reference":       r.ID,
		"description":     fmt.Sprintf("Two-phase reserve for payment %s (declaration %s)", r.ID, r.DeclarationID),
	}
	body, _ := json.Marshal(payload)

	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Request = payload
	r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.tbBridgeURL+"/api/ledger/transfers/pending", bytes.NewReader(body))
	if err != nil {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: err}
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: fmt.Errorf("ledger bridge unreachable: %w", err)}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: fmt.Errorf("ledger bridge returned %d: %s", resp.StatusCode, truncateStr(string(respBody), 256))}
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &created); err != nil || created.ID == "" {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: errors.New("ledger bridge did not return a pending transfer id")}
	}

	r.mu.Lock()
	r.TBPendingID = created.ID
	r.Status = StatusReserved
	r.Steps[len(r.Steps)-1].Response = json.RawMessage(respBody)
	r.mu.Unlock()
	return nil
}

// stepReceiveFulfilment awaits the REAL signed DFSP transfer callback.
// The callback handler verifies the Hub JWS and the ILP fulfilment against
// the stored condition before this step sees the result.
func (g *MojaloopGateway) stepReceiveFulfilment(r *PaymentRecord) error {
	v, ok := transferAwaiters.Load(r.ID)
	if !ok {
		return &PipelineError{Code: ErrCodeTransferFailed, Err: errors.New("internal: no transfer waiter registered")}
	}
	defer transferAwaiters.Delete(r.ID)
	await := v.(*transferAwait)
	defer await.cancel()

	res := <-await.ch
	if res.err != nil {
		return &PipelineError{Code: ErrCodeTransferFailed, Err: res.err}
	}

	r.mu.Lock()
	r.Fulfilment = res.body.Fulfilment
	r.Status = StatusFulfilled
	r.Steps[len(r.Steps)-1].Response = map[string]interface{}{
		"transferId":         res.body.TransferID,
		"fulfilment":         res.body.Fulfilment,
		"completedTimestamp": res.body.CompletedAt,
		"transferState":      res.body.TransferState,
	}
	r.mu.Unlock()
	return nil
}

// stepTigerBeetlePost finalizes the reserve via a REAL post-pending call on
// the TigerBeetle bridge.
func (g *MojaloopGateway) stepTigerBeetlePost(r *PaymentRecord) error {
	if g.tbBridgeURL == "" {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: errors.New("TIGERBEETLE_BRIDGE_URL is not configured — the reserve cannot be posted without the ledger bridge")}
	}
	r.mu.RLock()
	pendingID := r.TBPendingID
	r.mu.RUnlock()
	if pendingID == "" {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: errors.New("no pending transfer id recorded — nothing real to post")}
	}

	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"endpoint":  "POST /api/ledger/transfers/post/{pendingId}",
		"pendingId": pendingID,
	}
	r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.tbBridgeURL+"/api/ledger/transfers/post/"+pendingID, nil)
	if err != nil {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: err}
	}
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: fmt.Errorf("ledger bridge unreachable: %w", err)}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return &PipelineError{Code: ErrCodeLedgerUnavailable, Err: fmt.Errorf("ledger bridge returned %d: %s", resp.StatusCode, truncateStr(string(respBody), 256))}
	}

	now := time.Now().UTC()
	r.mu.Lock()
	r.TBPostedAt = &now
	r.Status = StatusPosted
	r.Steps[len(r.Steps)-1].Response = json.RawMessage(respBody)
	r.mu.Unlock()
	return nil
}

// stepPublishConfirmation publishes payment.confirmed to Kafka with an
// idempotent producer (acks=all, enable.idempotence). Fail-closed when no
// broker is configured — never a silent log line.
func (g *MojaloopGateway) stepPublishConfirmation(r *PaymentRecord) error {
	if g.kafkaProducer == nil {
		return &PipelineError{Code: ErrCodeKafkaNotConfigured, Err: errors.New("KAFKA_BROKERS is not configured — payment.confirmed cannot be published (fail-closed, no log-only stub)")}
	}
	event := map[string]interface{}{
		"eventType":     "payment.confirmed",
		"paymentId":     r.ID,
		"declarationId": r.DeclarationID,
		"amount":        r.Amount,
		"currency":      r.Currency,
		"confirmedAt":   time.Now().UTC(),
		"transferId":    r.TransferID,
		"tbPendingId":   r.TBPendingID,
	}
	data, err := json.Marshal(event)
	if err != nil {
		return &PipelineError{Code: ErrCodeKafkaPublish, Err: err}
	}
	msg := &sarama.ProducerMessage{
		Topic: "payment.confirmed",
		Key:   sarama.StringEncoder(r.DeclarationID),
		Value: sarama.ByteEncoder(data),
	}
	telemetry.InjectKafka(context.Background(), msg)

	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"topic":   "payment.confirmed",
		"key":     r.DeclarationID,
		"payload": event,
	}
	r.mu.Unlock()

	partition, offset, err := g.kafkaProducer.SendMessage(msg)
	if err != nil {
		return &PipelineError{Code: ErrCodeKafkaPublish, Err: fmt.Errorf("publish payment.confirmed: %w", err)}
	}

	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Response = map[string]interface{}{
		"topic":     "payment.confirmed",
		"partition": partition,
		"offset":    offset,
	}
	r.mu.Unlock()
	g.logger.Info("payment.confirmed published to Kafka",
		zap.String("declarationId", r.DeclarationID),
		zap.String("paymentId", r.ID),
		zap.Int32("partition", partition),
		zap.Int64("offset", offset),
	)
	return nil
}

// parseDecimalMinor parses a decimal string (e.g. "1500.00") into integer
// minor units without float arithmetic. Max 2 decimal places.
func parseDecimalMinor(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, errors.New("empty amount")
	}
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}
	parts := strings.SplitN(s, ".", 2)
	if len(parts) == 0 || parts[0] == "" {
		return 0, fmt.Errorf("invalid decimal %q", s)
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid decimal %q: %w", s, err)
	}
	frac := int64(0)
	if len(parts) == 2 {
		if len(parts[1]) > 2 {
			return 0, fmt.Errorf("amount %q has more than 2 decimal places", s)
		}
		fs := parts[1]
		for len(fs) < 2 {
			fs += "0"
		}
		frac, err = strconv.ParseInt(fs, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid decimal %q: %w", s, err)
		}
	}
	minor := whole*100 + frac
	if neg {
		minor = -minor
	}
	if minor <= 0 {
		return 0, fmt.Errorf("amount %q must be positive", s)
	}
	return minor, nil
}

func truncateStr(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func (g *MojaloopGateway) handleInitiate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeclarationID string                `json:"declarationId"`
		TraderID      string                `json:"traderId"`
		Amount        string                `json:"amount"`
		Currency      string                `json:"currency"`
		Method        string                `json:"method"`
		TariffRequest *tariff.AssessRequest `json:"tariffRequest,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.DeclarationID == "" || req.Amount == "" {
		http.Error(w, "declarationId and amount are required", http.StatusBadRequest)
		return
	}
	if _, err := parseDecimalMinor(req.Amount); err != nil {
		http.Error(w, "amount must be a positive decimal: "+err.Error(), http.StatusBadRequest)
		return
	}
	// Fail-closed at the edge: when a tariff engine is configured the caller
	// MUST supply the assessment input — the gateway never invents one.
	if g.tariffClient != nil && req.TariffRequest == nil {
		http.Error(w, "tariffRequest is required when a tariff engine is configured (the gateway never invents assessment inputs)", http.StatusBadRequest)
		return
	}
	if req.Currency == "" {
		req.Currency = "GHS"
	}
	record, err := g.InitiatePayment(r.Context(), req.DeclarationID, req.TraderID, req.Amount, req.Currency, req.Method, req.TariffRequest)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(record)
}

func (g *MojaloopGateway) handleStatus(w http.ResponseWriter, r *http.Request) {
	paymentID := chi.URLParam(r, "paymentId")
	paymentsMu.RLock()
	record, ok := payments[paymentID]
	paymentsMu.RUnlock()
	if !ok {
		http.Error(w, "payment not found", http.StatusNotFound)
		return
	}
	record.mu.RLock()
	defer record.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(record)
}

func (g *MojaloopGateway) handleCallback(w http.ResponseWriter, r *http.Request) {
	// Receives DFSP fulfilment callbacks from Mojaloop switch
	var cb struct {
		TransferID string `json:"transferId"`
		Fulfilment string `json:"fulfilment"`
		State      string `json:"transferState"`
	}
	if err := json.NewDecoder(r.Body).Decode(&cb); err != nil {
		http.Error(w, "invalid callback body", http.StatusBadRequest)
		return
	}
	g.logger.Info("DFSP callback received",
		zap.String("transferId", cb.TransferID),
		zap.String("state", cb.State),
	)
	w.WriteHeader(http.StatusOK)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// routes builds the HTTP router — used by main() and by integration tests.
func (g *MojaloopGateway) routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"service": "mojaloop-gateway",
			// Honest integration surface inventory — each entry is REAL when
			// configured, and the corresponding pipeline step fails closed
			// with a typed error when it is not.
			"integrations": map[string]bool{
				"tariffEngine":      g.tariffClient != nil,
				"mojaloopSwitch":    g.quoteBuilder != nil,
				"tigerbeetleBridge": g.tbBridgeURL != "",
				"kafka":             g.kafkaProducer != nil,
			},
		})
	})
	r.Post("/api/payments/initiate", g.handleInitiate)
	r.Get("/api/payments/{paymentId}/status", g.handleStatus)
	r.Put("/api/payments/callback/transfers/{transferId}", g.handleCallback)

	// FSPIOP callback endpoints — called by the Mojaloop Hub after quote/transfer.
	// The SAME handler instance serves the pipeline's callback waiters.
	cbHandler := g.cbHandler
	r.Put("/parties/{partyIdType}/{partyIdentifier}", cbHandler.HandlePartyCallback)
	r.Put("/quotes/{id}", cbHandler.HandleQuoteCallback)
	r.Put("/transfers/{id}", cbHandler.HandleTransferCallback)
	r.Put("/parties/{partyIdType}/{partyIdentifier}/error", cbHandler.HandlePartyErrorCallback)
	r.Put("/quotes/{id}/error", cbHandler.HandleQuoteErrorCallback)
	r.Put("/transfers/{id}/error", cbHandler.HandleTransferErrorCallback)
	return r
}

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// Phase-9: refuse to boot in production without the real integration
	// surfaces configured (fail-closed; no phantom defaults).
	if os.Getenv("APP_ENV") == "production" || os.Getenv("NODE_ENV") == "production" {
		missing := []string{}
		for _, key := range []string{"TARIFF_SERVICE_URL", "MOJALOOP_URL", "MOJALOOP_PAYEE_FSP_ID", "MOJALOOP_PAYEE_PARTY_ID", "TIGERBEETLE_BRIDGE_URL", "KAFKA_BROKERS"} {
			if os.Getenv(key) == "" {
				missing = append(missing, key)
			}
		}
		if len(missing) > 0 {
			logger.Fatal("missing required production configuration — refusing to boot",
				zap.Strings("missing", missing))
		}
	}

	// Phase-7 OTel: guarded by OTEL_EXPORTER_OTLP_ENDPOINT — unset = telemetry
	// disabled, boot unaffected (sanctioned fail-open, OTEL_DESIGN.md §1).
	otelShutdown, otelEnabled := telemetry.Init(context.Background(), "mojaloop-gateway")
	if otelEnabled {
		defer otelShutdown(context.Background())
	}

	gw := NewMojaloopGateway(logger)
	if gw.kafkaProducer != nil {
		defer gw.kafkaProducer.Close()
	}

	// HTTP server
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Mount("/", gw.routes())
	// DFSP JWKS endpoint — Hub fetches this to verify outbound DFSP signatures
	dfspSigner, _ := dfsp.NewSigner(logger)
	r.Get("/dfsp/jwks.json", dfspSigner.JWKSHandler())

	httpPort := getEnv("HTTP_PORT", "8085")
	httpServer := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      telemetry.Handler("mojaloop-gateway.http", r),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	// gRPC server
	grpcPort := getEnv("GRPC_PORT", "9085")
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		logger.Fatal("failed to listen for gRPC", zap.Error(err))
	}
	grpcServer := grpc.NewServer()
	healthSvc := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthSvc)
	healthSvc.SetServingStatus("mojaloop-gateway", grpc_health_v1.HealthCheckResponse_SERVING)
	reflection.Register(grpcServer)

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("Mojaloop Gateway HTTP server starting", zap.String("port", httpPort))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("HTTP server error", zap.Error(err))
		}
	}()

	go func() {
		logger.Info("Mojaloop Gateway gRPC server starting", zap.String("port", grpcPort))
		if err := grpcServer.Serve(lis); err != nil {
			logger.Fatal("gRPC server error", zap.Error(err))
		}
	}()

	<-quit
	logger.Info("Shutting down Mojaloop Gateway...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	httpServer.Shutdown(ctx)
	grpcServer.GracefulStop()
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
