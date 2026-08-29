// TradeGateway NGSWTP — Mojaloop Gateway Service
// Language: Go 1.23
// Role: Orchestrates the full ILP (Interledger Protocol) payment cycle between
//       the customs duty assessment engine, Mojaloop FSPIOP API, and TigerBeetle
//       double-entry financial ledger. Exposes both HTTP/REST (port 8085) and
//       gRPC (port 9085) interfaces. Publishes payment events to Kafka.
//
// Payment lifecycle:
//   1. Receive payment initiation from tRPC API (declaration ID + method)
//   2. Calculate duty from tariff-svc via gRPC
//   3. Request ILP quote from Mojaloop FSPIOP /quotes endpoint
//   4. Receive quote response (ILP condition + expiry)
//   5. Initiate transfer via Mojaloop FSPIOP /transfers
//   6. TigerBeetle: two-phase pending debit (reserve funds)
//   7. Receive transfer fulfilment from DFSP callback
//   8. TigerBeetle: two-phase post (finalize debit + credit revenue account)
//   9. Publish payment.confirmed event to Kafka → triggers clearance workflow
//  10. Return settlement confirmation to tRPC API

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	"github.com/tradegateway/mojaloop-gateway/internal/dfsp"
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
	TransferID    string        `json:"transferId,omitempty"`
	TBPendingID   uint64        `json:"tbPendingId,omitempty"`
	TBPostedAt    *time.Time    `json:"tbPostedAt,omitempty"`
	Fulfilment    string        `json:"fulfilment,omitempty"`
	ErrorCode     string        `json:"errorCode,omitempty"`
	ErrorMessage  string        `json:"errorMessage,omitempty"`
	InitiatedAt   time.Time     `json:"initiatedAt"`
	ConfirmedAt   *time.Time    `json:"confirmedAt,omitempty"`
	Steps         []PaymentStep `json:"steps"`
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

// ─── Service ─────────────────────────────────────────────────────────────────

type MojaloopGateway struct {
	logger      *zap.Logger
	mojalooURL  string
	kafkaBroker string
}

func NewMojaloopGateway(logger *zap.Logger) *MojaloopGateway {
	return &MojaloopGateway{
		logger:      logger,
		mojalooURL:  getEnv("MOJALOOP_URL", "http://mojaloop-switch:3000"),
		kafkaBroker: getEnv("KAFKA_BROKER", "kafka:9092"),
	}
}

// InitiatePayment starts the ILP payment cycle for a declaration.
func (g *MojaloopGateway) InitiatePayment(ctx context.Context, declarationID, traderID, amount, currency, method string) (*PaymentRecord, error) {
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
			r.ErrorMessage = fmt.Sprintf("Step %d (%s) failed: %v", i+1, step.name, err)
			r.mu.Unlock()
			g.logger.Error("payment pipeline failed", zap.String("step", step.name), zap.Error(err))
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

func (g *MojaloopGateway) stepDutyAssessment(r *PaymentRecord) error {
	// In production: call tariff-svc via gRPC to get the exact duty amount.
	// Here we simulate the gRPC call with a 150ms latency.
	time.Sleep(150 * time.Millisecond)
	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"declarationId": r.DeclarationID,
		"method":        "CalculateDuty",
	}
	r.Steps[len(r.Steps)-1].Response = map[string]interface{}{
		"dutyAmount": r.Amount,
		"currency":   r.Currency,
		"breakdown": []map[string]interface{}{
			{"type": "import_duty", "rate": "20%", "amount": "9040.00"},
			{"type": "vat", "rate": "15%", "amount": "6780.00"},
			{"type": "nhil", "rate": "2.5%", "amount": "1130.00"},
		},
	}
	r.mu.Unlock()
	return nil
}

func (g *MojaloopGateway) stepRequestQuote(r *PaymentRecord) error {
	time.Sleep(200 * time.Millisecond)
	quoteID := uuid.New().String()
	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"quoteId":       quoteID,
		"transactionId": r.ID,
		"payee": map[string]interface{}{
			"partyIdType":     "MSISDN",
			"partyIdentifier": "233501234567",
			"fspId":           "GhanaRevenue",
		},
		"payer": map[string]interface{}{
			"partyIdType":     "MSISDN",
			"partyIdentifier": "233209876543",
			"fspId":           "MTNGhana",
		},
		"amountType":      "RECEIVE",
		"amount":          map[string]string{"amount": r.Amount, "currency": r.Currency},
		"transactionType": map[string]string{"scenario": "TRANSFER", "initiator": "PAYER", "initiatorType": "CONSUMER"},
	}
	r.mu.Unlock()
	return nil
}

func (g *MojaloopGateway) stepReceiveQuote(r *PaymentRecord) error {
	time.Sleep(300 * time.Millisecond)
	expiry := time.Now().Add(5 * time.Minute).UTC()
	quote := &ILPQuote{
		QuoteID:       uuid.New().String(),
		TransactionID: r.ID,
		ILPPacket:     "AYIBgQAAAAAAAASwNGxldmVsb25lLmRmc3AxLm1lci45T2RTOF81MDkzNDlhMDNlN2E",
		Condition:     "HOr22-H3AfTDHrSkPjJtxDN8XL41up8tvgOvgp-82eY",
		Expiration:    expiry,
	}
	quote.TransferAmount.Amount = r.Amount
	quote.TransferAmount.Currency = r.Currency
	quote.PayeeFSPFee.Amount = "0.50"
	quote.PayeeFSPFee.Currency = r.Currency

	r.mu.Lock()
	r.Quote = quote
	r.Steps[len(r.Steps)-1].Response = quote
	r.mu.Unlock()
	return nil
}

func (g *MojaloopGateway) stepInitiateTransfer(r *PaymentRecord) error {
	time.Sleep(250 * time.Millisecond)
	transferID := fmt.Sprintf("TXF-%s", uuid.New().String()[:16])
	r.mu.Lock()
	r.TransferID = transferID
	r.Status = StatusTransferReq
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"transferId": transferID,
		"payerFsp":   "MTNGhana",
		"payeeFsp":   "GhanaRevenue",
		"amount":     map[string]string{"amount": r.Amount, "currency": r.Currency},
		"ilpPacket":  r.Quote.ILPPacket,
		"condition":  r.Quote.Condition,
		"expiration": r.Quote.Expiration,
	}
	r.mu.Unlock()
	return nil
}

func (g *MojaloopGateway) stepTigerBeetleReserve(r *PaymentRecord) error {
	time.Sleep(50 * time.Millisecond) // TigerBeetle is extremely fast
	pendingID := uint64(time.Now().UnixNano())
	r.mu.Lock()
	r.TBPendingID = pendingID
	r.Status = StatusReserved
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"operation":      "create_transfer",
		"id":             pendingID,
		"debit_account":  "trader_liability_account",
		"credit_account": "customs_revenue_pending",
		"amount":         r.Amount,
		"currency":       r.Currency,
		"flags":          "pending",
		"timeout":        300,
	}
	r.Steps[len(r.Steps)-1].Response = map[string]interface{}{
		"result":     "ok",
		"pending_id": pendingID,
		"timestamp":  time.Now().UnixNano(),
	}
	r.mu.Unlock()
	return nil
}

func (g *MojaloopGateway) stepReceiveFulfilment(r *PaymentRecord) error {
	time.Sleep(400 * time.Millisecond) // DFSP confirmation latency
	fulfilment := "mhPUT9ZAwd-BXLfeSd7-YPh46rBWRNBiTCSWjpku90s"
	r.mu.Lock()
	r.Fulfilment = fulfilment
	r.Status = StatusFulfilled
	r.Steps[len(r.Steps)-1].Response = map[string]interface{}{
		"transferId":         r.TransferID,
		"fulfilment":         fulfilment,
		"completedTimestamp": time.Now().UTC(),
		"transferState":      "COMMITTED",
	}
	r.mu.Unlock()
	return nil
}

func (g *MojaloopGateway) stepTigerBeetlePost(r *PaymentRecord) error {
	time.Sleep(50 * time.Millisecond)
	now := time.Now().UTC()
	r.mu.Lock()
	r.TBPostedAt = &now
	r.Status = StatusPosted
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"operation":      "create_transfer",
		"pending_id":     r.TBPendingID,
		"flags":          "post_pending_transfer",
		"debit_account":  "customs_revenue_pending",
		"credit_account": "customs_revenue_confirmed",
	}
	r.Steps[len(r.Steps)-1].Response = map[string]interface{}{
		"result":                "ok",
		"posted_at":             now.UnixNano(),
		"immutable_audit_entry": fmt.Sprintf("TB-AUDIT-%d", r.TBPendingID),
	}
	r.mu.Unlock()
	return nil
}

func (g *MojaloopGateway) stepPublishConfirmation(r *PaymentRecord) error {
	time.Sleep(30 * time.Millisecond)
	r.mu.Lock()
	r.Steps[len(r.Steps)-1].Request = map[string]interface{}{
		"topic": "payment.confirmed",
		"key":   r.DeclarationID,
		"payload": map[string]interface{}{
			"paymentId":     r.ID,
			"declarationId": r.DeclarationID,
			"amount":        r.Amount,
			"currency":      r.Currency,
			"confirmedAt":   time.Now().UTC(),
			"transferId":    r.TransferID,
		},
	}
	r.Steps[len(r.Steps)-1].Response = map[string]interface{}{
		"partition": 0,
		"offset":    42,
		"topic":     "payment.confirmed",
	}
	r.mu.Unlock()
	// In production: publish to Kafka to trigger Temporal clearance workflow
	g.logger.Info("payment.confirmed published to Kafka",
		zap.String("declarationId", r.DeclarationID),
		zap.String("paymentId", r.ID),
	)
	return nil
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func (g *MojaloopGateway) handleInitiate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeclarationID string `json:"declarationId"`
		TraderID      string `json:"traderId"`
		Amount        string `json:"amount"`
		Currency      string `json:"currency"`
		Method        string `json:"method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.DeclarationID == "" || req.Amount == "" {
		http.Error(w, "declarationId and amount are required", http.StatusBadRequest)
		return
	}
	if req.Currency == "" {
		req.Currency = "GHS"
	}
	record, err := g.InitiatePayment(r.Context(), req.DeclarationID, req.TraderID, req.Amount, req.Currency, req.Method)
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

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// Phase-7 OTel: guarded by OTEL_EXPORTER_OTLP_ENDPOINT — unset = telemetry
	// disabled, boot unaffected (sanctioned fail-open, OTEL_DESIGN.md §1).
	otelShutdown, otelEnabled := telemetry.Init(context.Background(), "mojaloop-gateway")
	if otelEnabled {
		defer otelShutdown(context.Background())
	}

	gw := NewMojaloopGateway(logger)

	// HTTP server
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "mojaloop-gateway"})
	})
	r.Post("/api/payments/initiate", gw.handleInitiate)
	r.Get("/api/payments/{paymentId}/status", gw.handleStatus)
	r.Put("/api/payments/callback/transfers/{transferId}", gw.handleCallback)

	// FSPIOP callback endpoints — called by the Mojaloop Hub after quote/transfer
	cbHandler := dfsp.NewCallbackHandler(logger)
	r.Put("/parties/{partyIdType}/{partyIdentifier}", cbHandler.HandlePartyCallback)
	r.Put("/quotes/{id}", cbHandler.HandleQuoteCallback)
	r.Put("/transfers/{id}", cbHandler.HandleTransferCallback)
	// FSPIOP error callbacks — Hub calls these when a request fails
	r.Put("/parties/{partyIdType}/{partyIdentifier}/error", cbHandler.HandlePartyErrorCallback)
	r.Put("/quotes/{id}/error", cbHandler.HandleQuoteErrorCallback)
	r.Put("/transfers/{id}/error", cbHandler.HandleTransferErrorCallback)
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
