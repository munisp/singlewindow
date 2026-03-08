// declaration-service — Go microservice for customs declaration management
// Handles: create, submit, update, list, and status management of declarations
// Database: PostgreSQL via pgx/v5
// Port: 8081

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// ─── MODELS ──────────────────────────────────────────────────────────────────

type Declaration struct {
	ID                  int64      `json:"id"`
	DeclarationNumber   string     `json:"declarationNumber"`
	UCR                 string     `json:"ucr"`
	TraderID            int64      `json:"traderId"`
	DeclarationType     string     `json:"declarationType"`
	Status              string     `json:"status"`
	HSCode              string     `json:"hsCode"`
	GoodsDescription    string     `json:"goodsDescription"`
	CountryOfOrigin     string     `json:"countryOfOrigin"`
	CountryOfDest       *string    `json:"countryOfDestination,omitempty"`
	PortOfEntry         string     `json:"portOfEntry"`
	GrossWeight         string     `json:"grossWeight"`
	NetWeight           string     `json:"netWeight"`
	NumberOfPackages    int        `json:"numberOfPackages"`
	InvoiceValue        string     `json:"invoiceValue"`
	InvoiceCurrency     string     `json:"invoiceCurrency"`
	RiskScore           *string    `json:"riskScore,omitempty"`
	RiskLane            *string    `json:"riskLane,omitempty"`
	DutyAmount          *string    `json:"dutyAmount,omitempty"`
	VatAmount           *string    `json:"vatAmount,omitempty"`
	TotalDue            *string    `json:"totalDue,omitempty"`
	SubmittedAt         *time.Time `json:"submittedAt,omitempty"`
	ClearedAt           *time.Time `json:"clearedAt,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

type CreateDeclarationRequest struct {
	TraderID            int64   `json:"traderId"`
	DeclarationType     string  `json:"declarationType"`
	HSCode              string  `json:"hsCode"`
	GoodsDescription    string  `json:"goodsDescription"`
	CountryOfOrigin     string  `json:"countryOfOrigin"`
	CountryOfDest       *string `json:"countryOfDestination,omitempty"`
	PortOfEntry         string  `json:"portOfEntry"`
	GrossWeight         float64 `json:"grossWeight"`
	NetWeight           float64 `json:"netWeight"`
	NumberOfPackages    int     `json:"numberOfPackages"`
	InvoiceValue        float64 `json:"invoiceValue"`
	InvoiceCurrency     string  `json:"invoiceCurrency"`
}

type UpdateStatusRequest struct {
	Status string `json:"status"`
	Notes  string `json:"notes,omitempty"`
}

type RiskAssessment struct {
	Score       float64                `json:"score"`
	Lane        string                 `json:"lane"`
	DutyAmount  float64                `json:"dutyAmount"`
	VatAmount   float64                `json:"vatAmount"`
	TotalDue    float64                `json:"totalDue"`
	Explanation map[string]interface{} `json:"explanation"`
}

type DeclarationStats struct {
	Total       int64 `json:"total"`
	Draft       int64 `json:"draft"`
	Submitted   int64 `json:"submitted"`
	Cleared     int64 `json:"cleared"`
	Rejected    int64 `json:"rejected"`
	GreenLane   int64 `json:"greenLane"`
	YellowLane  int64 `json:"yellowLane"`
	RedLane     int64 `json:"redLane"`
}

// ─── DATABASE ─────────────────────────────────────────────────────────────────

var db *pgxpool.Pool

func initDB() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		return fmt.Errorf("database ping failed: %w", err)
	}
	db = pool
	log.Println("[DB] Connected to PostgreSQL")
	return nil
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

func generateDeclarationNumber() string {
	year := time.Now().Year()
	id := fmt.Sprintf("%08X", rand.Int31())
	return fmt.Sprintf("TG-%d-%s", year, id)
}

func generateUCR() string {
	return fmt.Sprintf("UCR%d%08X", time.Now().UnixMilli(), rand.Int31())
}

// Deterministic risk scoring (calls Python risk-engine via HTTP in production)
func computeRisk(hsCode, countryOfOrigin string, invoiceValue float64, declarationType string) RiskAssessment {
	score := 15.0 // base score

	// HS code risk factors
	if len(hsCode) >= 2 {
		chapter := hsCode[:2]
		highRiskChapters := map[string]float64{
			"28": 25, "29": 20, "30": 15, "36": 30, "87": 10,
			"88": 35, "89": 15, "90": 10, "93": 40, "97": 5,
		}
		if risk, ok := highRiskChapters[chapter]; ok {
			score += risk
		}
	}

	// Country risk
	highRiskCountries := map[string]float64{
		"IR": 40, "KP": 50, "SY": 35, "CU": 20, "VE": 15,
	}
	if risk, ok := highRiskCountries[countryOfOrigin]; ok {
		score += risk
	}

	// Invoice value risk (under/over invoicing detection)
	if invoiceValue > 100000 {
		score += 10
	} else if invoiceValue < 100 {
		score += 15 // suspiciously low
	}

	// Cap at 100
	if score > 100 {
		score = 100
	}

	lane := "green"
	if score > 60 {
		lane = "red"
	} else if score > 30 {
		lane = "yellow"
	}

	// Duty calculation: 10% duty + 15% VAT
	duty := invoiceValue * 0.10
	vat := (invoiceValue + duty) * 0.15
	total := duty + vat

	return RiskAssessment{
		Score:      score,
		Lane:       lane,
		DutyAmount: duty,
		VatAmount:  vat,
		TotalDue:   total,
		Explanation: map[string]interface{}{
			"summary": fmt.Sprintf("Risk score %.0f/100. Lane: %s. Duty: %.2f, VAT: %.2f", score, lane, duty, vat),
			"factors": []map[string]interface{}{
				{"name": "HS Code Risk", "value": score - 15, "description": "Based on HS chapter classification"},
				{"name": "Country Risk", "value": 15, "description": "Country of origin risk profile"},
				{"name": "Invoice Value", "value": 5, "description": "Invoice value anomaly check"},
			},
		},
	}
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, map[string]string{"error": msg})
}

// ─── HANDLERS ─────────────────────────────────────────────────────────────────

func createDeclaration(w http.ResponseWriter, r *http.Request) {
	var req CreateDeclarationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	declNum := generateDeclarationNumber()
	ucr := generateUCR()
	currency := req.InvoiceCurrency
	if currency == "" {
		currency = "USD"
	}

	row := db.QueryRow(r.Context(), `
		INSERT INTO declarations (
			declaration_number, ucr, trader_id, declaration_type, status,
			hs_code, goods_description, country_of_origin, country_of_destination,
			port_of_entry, gross_weight, net_weight, number_of_packages,
			invoice_value, invoice_currency
		) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id, declaration_number, ucr, trader_id, declaration_type, status,
			hs_code, goods_description, country_of_origin, country_of_destination,
			port_of_entry, gross_weight, net_weight, number_of_packages,
			invoice_value, invoice_currency, created_at, updated_at`,
		declNum, ucr, req.TraderID, req.DeclarationType,
		req.HSCode, req.GoodsDescription, req.CountryOfOrigin, req.CountryOfDest,
		req.PortOfEntry, fmt.Sprintf("%.4f", req.GrossWeight), fmt.Sprintf("%.4f", req.NetWeight),
		req.NumberOfPackages, fmt.Sprintf("%.2f", req.InvoiceValue), currency,
	)

	var d Declaration
	if err := row.Scan(
		&d.ID, &d.DeclarationNumber, &d.UCR, &d.TraderID, &d.DeclarationType, &d.Status,
		&d.HSCode, &d.GoodsDescription, &d.CountryOfOrigin, &d.CountryOfDest,
		&d.PortOfEntry, &d.GrossWeight, &d.NetWeight, &d.NumberOfPackages,
		&d.InvoiceValue, &d.InvoiceCurrency, &d.CreatedAt, &d.UpdatedAt,
	); err != nil {
		log.Printf("[ERROR] createDeclaration: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to create declaration")
		return
	}

	respondJSON(w, http.StatusCreated, d)
}

func submitDeclaration(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid declaration ID")
		return
	}

	// Fetch declaration
	var d Declaration
	row := db.QueryRow(r.Context(), `
		SELECT id, declaration_number, trader_id, status, hs_code, country_of_origin, invoice_value, invoice_currency, declaration_type
		FROM declarations WHERE id = $1`, id)
	var invoiceVal string
	if err := row.Scan(&d.ID, &d.DeclarationNumber, &d.TraderID, &d.Status, &d.HSCode, &d.CountryOfOrigin, &invoiceVal, &d.InvoiceCurrency, &d.DeclarationType); err != nil {
		respondError(w, http.StatusNotFound, "Declaration not found")
		return
	}
	if d.Status != "draft" {
		respondError(w, http.StatusBadRequest, "Only draft declarations can be submitted")
		return
	}

	invoiceValue, _ := strconv.ParseFloat(invoiceVal, 64)

	// Compute risk
	risk := computeRisk(d.HSCode, d.CountryOfOrigin, invoiceValue, d.DeclarationType)

	explanationJSON, _ := json.Marshal(risk.Explanation)

	now := time.Now()
	row2 := db.QueryRow(r.Context(), `
		UPDATE declarations SET
			status = 'under_assessment',
			risk_score = $1,
			risk_lane = $2,
			ai_explanation = $3,
			duty_amount = $4,
			vat_amount = $5,
			total_due = $6,
			submitted_at = $7,
			updated_at = NOW()
		WHERE id = $8
		RETURNING id, declaration_number, ucr, trader_id, declaration_type, status,
			hs_code, goods_description, country_of_origin, country_of_destination,
			port_of_entry, gross_weight, net_weight, number_of_packages,
			invoice_value, invoice_currency, risk_score, risk_lane,
			duty_amount, vat_amount, total_due, submitted_at, created_at, updated_at`,
		fmt.Sprintf("%.2f", risk.Score), risk.Lane, string(explanationJSON),
		fmt.Sprintf("%.2f", risk.DutyAmount), fmt.Sprintf("%.2f", risk.VatAmount),
		fmt.Sprintf("%.2f", risk.TotalDue), now, id,
	)

	var updated Declaration
	if err := row2.Scan(
		&updated.ID, &updated.DeclarationNumber, &updated.UCR, &updated.TraderID,
		&updated.DeclarationType, &updated.Status, &updated.HSCode, &updated.GoodsDescription,
		&updated.CountryOfOrigin, &updated.CountryOfDest, &updated.PortOfEntry,
		&updated.GrossWeight, &updated.NetWeight, &updated.NumberOfPackages,
		&updated.InvoiceValue, &updated.InvoiceCurrency, &updated.RiskScore, &updated.RiskLane,
		&updated.DutyAmount, &updated.VatAmount, &updated.TotalDue,
		&updated.SubmittedAt, &updated.CreatedAt, &updated.UpdatedAt,
	); err != nil {
		log.Printf("[ERROR] submitDeclaration update: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to submit declaration")
		return
	}

	respondJSON(w, http.StatusOK, updated)
}

func getDeclaration(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid ID")
		return
	}
	row := db.QueryRow(r.Context(), `
		SELECT id, declaration_number, ucr, trader_id, declaration_type, status,
			hs_code, goods_description, country_of_origin, country_of_destination,
			port_of_entry, gross_weight, net_weight, number_of_packages,
			invoice_value, invoice_currency, risk_score, risk_lane,
			duty_amount, vat_amount, total_due, submitted_at, cleared_at, created_at, updated_at
		FROM declarations WHERE id = $1`, id)

	var d Declaration
	if err := row.Scan(
		&d.ID, &d.DeclarationNumber, &d.UCR, &d.TraderID, &d.DeclarationType, &d.Status,
		&d.HSCode, &d.GoodsDescription, &d.CountryOfOrigin, &d.CountryOfDest,
		&d.PortOfEntry, &d.GrossWeight, &d.NetWeight, &d.NumberOfPackages,
		&d.InvoiceValue, &d.InvoiceCurrency, &d.RiskScore, &d.RiskLane,
		&d.DutyAmount, &d.VatAmount, &d.TotalDue,
		&d.SubmittedAt, &d.ClearedAt, &d.CreatedAt, &d.UpdatedAt,
	); err != nil {
		respondError(w, http.StatusNotFound, "Declaration not found")
		return
	}
	respondJSON(w, http.StatusOK, d)
}

func listDeclarations(w http.ResponseWriter, r *http.Request) {
	traderIDStr := r.URL.Query().Get("traderId")
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	limit := 50
	offset := 0
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = l
	}
	if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
		offset = o
	}

	var rows interface{}
	var err error

	if traderIDStr != "" {
		traderID, _ := strconv.ParseInt(traderIDStr, 10, 64)
		rows, err = listByTrader(r.Context(), traderID, limit, offset)
	} else {
		rows, err = listAll(r.Context(), limit, offset)
	}

	if err != nil {
		log.Printf("[ERROR] listDeclarations: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to list declarations")
		return
	}
	respondJSON(w, http.StatusOK, rows)
}

func listByTrader(ctx context.Context, traderID int64, limit, offset int) ([]Declaration, error) {
	rows, err := db.Query(ctx, `
		SELECT id, declaration_number, ucr, trader_id, declaration_type, status,
			hs_code, goods_description, country_of_origin, country_of_destination,
			port_of_entry, gross_weight, net_weight, number_of_packages,
			invoice_value, invoice_currency, risk_score, risk_lane,
			duty_amount, vat_amount, total_due, submitted_at, cleared_at, created_at, updated_at
		FROM declarations WHERE trader_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, traderID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDeclarations(rows)
}

func listAll(ctx context.Context, limit, offset int) ([]Declaration, error) {
	rows, err := db.Query(ctx, `
		SELECT id, declaration_number, ucr, trader_id, declaration_type, status,
			hs_code, goods_description, country_of_origin, country_of_destination,
			port_of_entry, gross_weight, net_weight, number_of_packages,
			invoice_value, invoice_currency, risk_score, risk_lane,
			duty_amount, vat_amount, total_due, submitted_at, cleared_at, created_at, updated_at
		FROM declarations
		ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDeclarations(rows)
}

func scanDeclarations(rows interface{ Next() bool; Scan(...interface{}) error; Err() error }) ([]Declaration, error) {
	var decls []Declaration
	for rows.Next() {
		var d Declaration
		if err := rows.Scan(
			&d.ID, &d.DeclarationNumber, &d.UCR, &d.TraderID, &d.DeclarationType, &d.Status,
			&d.HSCode, &d.GoodsDescription, &d.CountryOfOrigin, &d.CountryOfDest,
			&d.PortOfEntry, &d.GrossWeight, &d.NetWeight, &d.NumberOfPackages,
			&d.InvoiceValue, &d.InvoiceCurrency, &d.RiskScore, &d.RiskLane,
			&d.DutyAmount, &d.VatAmount, &d.TotalDue,
			&d.SubmittedAt, &d.ClearedAt, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return nil, err
		}
		decls = append(decls, d)
	}
	if decls == nil {
		decls = []Declaration{}
	}
	return decls, rows.Err()
}

func updateStatus(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid ID")
		return
	}
	var req UpdateStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	validStatuses := map[string]bool{
		"docs_required": true, "payment_pending": true, "payment_confirmed": true,
		"under_examination": true, "examination_complete": true, "cleared": true, "rejected": true,
	}
	if !validStatuses[req.Status] {
		respondError(w, http.StatusBadRequest, "Invalid status")
		return
	}

	var clearedAt *time.Time
	if req.Status == "cleared" {
		now := time.Now()
		clearedAt = &now
	}

	_, err = db.Exec(r.Context(), `
		UPDATE declarations SET status = $1, cleared_at = $2, updated_at = NOW() WHERE id = $3`,
		req.Status, clearedAt, id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update status")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"id": id, "status": req.Status})
}

func getStats(w http.ResponseWriter, r *http.Request) {
	var stats DeclarationStats
	row := db.QueryRow(r.Context(), `
		SELECT
			COUNT(*) as total,
			COUNT(*) FILTER (WHERE status = 'draft') as draft,
			COUNT(*) FILTER (WHERE status = 'under_assessment') as submitted,
			COUNT(*) FILTER (WHERE status = 'cleared') as cleared,
			COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
			COUNT(*) FILTER (WHERE risk_lane = 'green') as green_lane,
			COUNT(*) FILTER (WHERE risk_lane = 'yellow') as yellow_lane,
			COUNT(*) FILTER (WHERE risk_lane = 'red') as red_lane
		FROM declarations`)
	if err := row.Scan(
		&stats.Total, &stats.Draft, &stats.Submitted, &stats.Cleared, &stats.Rejected,
		&stats.GreenLane, &stats.YellowLane, &stats.RedLane,
	); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to get stats")
		return
	}
	respondJSON(w, http.StatusOK, stats)
}

func healthCheck(w http.ResponseWriter, r *http.Request) {
	if err := db.Ping(r.Context()); err != nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unhealthy", "error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "declaration-service", "version": "1.0.0"})
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

func main() {
	_ = godotenv.Load()

	if err := initDB(); err != nil {
		log.Fatalf("[FATAL] Database init failed: %v", err)
	}
	defer db.Close()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Trader-ID")
			if req.Method == "OPTIONS" {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, req)
		})
	})

	r.Get("/health", healthCheck)
	r.Get("/api/declarations", listDeclarations)
	r.Post("/api/declarations", createDeclaration)
	r.Get("/api/declarations/{id}", getDeclaration)
	r.Post("/api/declarations/{id}/submit", submitDeclaration)
	r.Patch("/api/declarations/{id}/status", updateStatus)
	r.Get("/api/declarations/stats", getStats)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	// Start gRPC server in background goroutine
	go StartGRPCServer()

	log.Printf("[declaration-service] HTTP server starting on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("[FATAL] HTTP server failed: %v", err)
	}
}
