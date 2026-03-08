// Payment Service — Duty assessment, Mojaloop payment switching, TigerBeetle ledger
// Language: Go 1.23 | Protocol: gRPC + HTTP REST | DB: PostgreSQL
// Integrates: Mojaloop FSP API, TigerBeetle bridge, Kafka event publishing

package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

// ─── CONFIG ──────────────────────────────────────────────────────────────────

var (
	grpcPort        = getEnv("PAYMENT_GRPC_PORT", "50053")
	httpPort        = getEnv("PAYMENT_HTTP_PORT", "8083")
	dbURL           = getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
	mojaloopBaseURL = getEnv("MOJALOOP_BASE_URL", "http://localhost:3001")
	tigerBeetleAddr = getEnv("TIGERBEETLE_ADDR", "localhost:3000")
	kafkaBrokers    = getEnv("KAFKA_BROKERS", "localhost:9092")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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
	DeclarationID  int64              `json:"declarationId"`
	HSCode         string             `json:"hsCode"`
	CustomsValue   float64            `json:"customsValue"`
	Currency       string             `json:"currency"`
	DutyBreakdown  []DutyLineItem     `json:"dutyBreakdown"`
	TotalDuty      float64            `json:"totalDuty"`
	TotalVAT       float64            `json:"totalVat"`
	TotalLevy      float64            `json:"totalLevy"`
	TotalPayable   float64            `json:"totalPayable"`
	AssessedAt     time.Time          `json:"assessedAt"`
	ValidUntil     time.Time          `json:"validUntil"`
}

type DutyLineItem struct {
	DutyType    string  `json:"dutyType"`
	Description string  `json:"description"`
	Rate        float64 `json:"rate"`
	Base        float64 `json:"base"`
	Amount      float64 `json:"amount"`
}

// HS Code duty rate lookup (simplified — production uses full WCO tariff schedule)
var hsCodeDutyRates = map[string]struct {
	ImportDuty float64
	VAT        float64
	Levy       float64
	Description string
}{
	"8471":  {ImportDuty: 0.00, VAT: 0.125, Levy: 0.005, Description: "Computers & peripherals"},
	"8517":  {ImportDuty: 0.05, VAT: 0.125, Levy: 0.005, Description: "Telephones & mobile devices"},
	"8703":  {ImportDuty: 0.20, VAT: 0.125, Levy: 0.02, Description: "Motor vehicles"},
	"2710":  {ImportDuty: 0.10, VAT: 0.00, Levy: 0.05, Description: "Petroleum products"},
	"1001":  {ImportDuty: 0.05, VAT: 0.00, Levy: 0.01, Description: "Wheat & meslin"},
	"1006":  {ImportDuty: 0.10, VAT: 0.00, Levy: 0.01, Description: "Rice"},
	"3004":  {ImportDuty: 0.00, VAT: 0.00, Levy: 0.005, Description: "Medicaments"},
	"6203":  {ImportDuty: 0.20, VAT: 0.125, Levy: 0.01, Description: "Men's clothing"},
	"9403":  {ImportDuty: 0.20, VAT: 0.125, Levy: 0.01, Description: "Furniture"},
	"default": {ImportDuty: 0.10, VAT: 0.125, Levy: 0.01, Description: "General goods"},
}

func assessDuty(declarationID int64, hsCode string, customsValue float64, currency string) (*DutyAssessment, error) {
	// Look up HS code prefix (4-digit)
	prefix := hsCode
	if len(prefix) > 4 {
		prefix = prefix[:4]
	}

	rates, ok := hsCodeDutyRates[prefix]
	if !ok {
		rates = hsCodeDutyRates["default"]
	}

	importDutyAmt := customsValue * rates.ImportDuty
	vatBase := customsValue + importDutyAmt
	vatAmt := vatBase * rates.VAT
	levyAmt := customsValue * rates.Levy

	assessment := &DutyAssessment{
		DeclarationID: declarationID,
		HSCode:        hsCode,
		CustomsValue:  customsValue,
		Currency:      currency,
		DutyBreakdown: []DutyLineItem{
			{
				DutyType:    "import_duty",
				Description: fmt.Sprintf("Import Duty @ %.1f%% on CIF value", rates.ImportDuty*100),
				Rate:        rates.ImportDuty,
				Base:        customsValue,
				Amount:      importDutyAmt,
			},
			{
				DutyType:    "vat",
				Description: fmt.Sprintf("VAT @ %.1f%% on (CIF + Import Duty)", rates.VAT*100),
				Rate:        rates.VAT,
				Base:        vatBase,
				Amount:      vatAmt,
			},
			{
				DutyType:    "levy",
				Description: fmt.Sprintf("ECOWAS/NHIL Levy @ %.1f%%", rates.Levy*100),
				Rate:        rates.Levy,
				Base:        customsValue,
				Amount:      levyAmt,
			},
		},
		TotalDuty:    importDutyAmt,
		TotalVAT:     vatAmt,
		TotalLevy:    levyAmt,
		TotalPayable: importDutyAmt + vatAmt + levyAmt,
		AssessedAt:   time.Now(),
		ValidUntil:   time.Now().Add(72 * time.Hour),
	}

	return assessment, nil
}

// ─── PAYMENT PROCESSING ───────────────────────────────────────────────────────

func generateReference() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "TG-" + hex.EncodeToString(b)
}

func createPayment(ctx context.Context, req CreatePaymentRequest) (*Payment, error) {
	refNum := generateReference()

	var p Payment
	err := db.QueryRowContext(ctx, `
		INSERT INTO payments (declaration_id, payer_user_id, amount, currency,
		                      payment_method, status, reference_number, duty_type, created_at)
		VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NOW())
		RETURNING id, declaration_id, payer_user_id, amount, currency,
		          payment_method, status, reference_number, duty_type, created_at
	`, req.DeclarationID, req.PayerUserID, req.Amount, req.Currency,
		req.PaymentMethod, refNum, req.DutyType).
		Scan(&p.ID, &p.DeclarationID, &p.PayerUserID, &p.Amount, &p.Currency,
			&p.PaymentMethod, &p.Status, &p.ReferenceNumber, &p.DutyType, &p.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create payment record: %w", err)
	}

	// Initiate Mojaloop transfer (async — webhook will confirm)
	go initiateMojaloopTransfer(p.ID, p.ReferenceNumber, req.Amount, req.Currency, req.PaymentMethod)

	return &p, nil
}

// initiateMojaloopTransfer sends a payment initiation to the Mojaloop FSP
// In production this uses the full Mojaloop API (ISO 20022 / FSPIOP)
func initiateMojaloopTransfer(paymentID int64, reference string, amount float64, currency, method string) {
	log.Printf("[Mojaloop] Initiating transfer: paymentID=%d ref=%s amount=%.2f %s method=%s",
		paymentID, reference, amount, currency, method)

	// Simulate Mojaloop transfer initiation
	// Production: POST to /transfers with FSPIOP headers
	mojaloopTxID := "ML-" + reference

	// Update payment with Mojaloop transaction ID
	_, err := db.Exec(`
		UPDATE payments SET mojaloop_tx_id = $1, status = 'processing'
		WHERE id = $2
	`, mojaloopTxID, paymentID)
	if err != nil {
		log.Printf("[Mojaloop] Failed to update payment %d: %v", paymentID, err)
		return
	}

	// Simulate TigerBeetle double-entry ledger recording
	recordTigerBeetleEntry(paymentID, reference, amount, currency)
}

// recordTigerBeetleEntry creates a double-entry in TigerBeetle
// Debit: Trader liability account | Credit: Customs revenue account
func recordTigerBeetleEntry(paymentID int64, reference string, amount float64, currency string) {
	log.Printf("[TigerBeetle] Recording double-entry: paymentID=%d ref=%s amount=%.2f %s",
		paymentID, reference, amount, currency)

	// TigerBeetle account IDs (pre-provisioned)
	// Account 1001: Customs Revenue Account (credit)
	// Account 2001: Trader Liability Account (debit)
	tbTxID := fmt.Sprintf("TB-%s-%d", reference, time.Now().UnixNano())

	_, err := db.Exec(`
		UPDATE payments SET tigerbeetle_tx_id = $1
		WHERE id = $2
	`, tbTxID, paymentID)
	if err != nil {
		log.Printf("[TigerBeetle] Failed to update payment %d: %v", paymentID, err)
	}

	log.Printf("[TigerBeetle] Entry recorded: txID=%s", tbTxID)
}

func confirmPayment(ctx context.Context, paymentID int64, mojaloopConfirmation string) error {
	_, err := db.ExecContext(ctx, `
		UPDATE payments
		SET status = 'completed', completed_at = NOW(), mojaloop_tx_id = $1
		WHERE id = $2
	`, mojaloopConfirmation, paymentID)
	if err != nil {
		return fmt.Errorf("failed to confirm payment: %w", err)
	}

	// Publish payment.confirmed event to Kafka
	publishKafkaEvent("payment.confirmed", map[string]interface{}{
		"paymentId":   paymentID,
		"confirmedAt": time.Now(),
	})

	return nil
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
	assessment, err := assessDuty(req.DeclarationID, req.HSCode, req.CustomsValue, req.Currency)
	if err != nil {
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
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, payment)
}

func handleMojaloopWebhook(w http.ResponseWriter, r *http.Request) {
	// Mojaloop FSPIOP callback — confirms transfer settlement
	var callback struct {
		TransferID string `json:"transferId"`
		PaymentID  int64  `json:"paymentId"`
		State      string `json:"transferState"` // COMMITTED | ABORTED
	}
	if err := json.NewDecoder(r.Body).Decode(&callback); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid callback"})
		return
	}

	if callback.State == "COMMITTED" {
		if err := confirmPayment(r.Context(), callback.PaymentID, callback.TransferID); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
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
		"version": "1.0.0",
		"integrations": map[string]string{
			"mojaloop":    mojaloopBaseURL,
			"tigerbeetle": tigerBeetleAddr,
			"kafka":       kafkaBrokers,
		},
	})
}

// ─── GRPC SERVER ─────────────────────────────────────────────────────────────

func startGRPCServer() {
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatalf("[gRPC] Failed to listen: %v", err)
	}
	s := grpc.NewServer()
	reflection.Register(s)
	log.Printf("[gRPC] Payment service listening on :%s", grpcPort)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("[gRPC] Failed to serve: %v", err)
	}
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("[Payment Service] Starting up...")
	log.Printf("[Payment Service] Mojaloop: %s | TigerBeetle: %s | Kafka: %s",
		mojaloopBaseURL, tigerBeetleAddr, kafkaBrokers)

	if err := initDB(); err != nil {
		log.Fatalf("[Payment Service] DB init failed: %v", err)
	}
	log.Printf("[Payment Service] PostgreSQL connected")

	go startGRPCServer()

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

	go StartGRPCServer()
	log.Printf("[Payment Service] HTTP server listening on :%s", httpPort)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[Payment Service] HTTP server failed: %v", err)
	}
}
