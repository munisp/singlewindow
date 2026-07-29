// trade-finance-service — Letter of Credit & Bank Guarantee Service
// TradeGateway NGSWTP
//
// Implements trade finance instruments for customs clearance:
//   1. Letter of Credit (LC) — Documentary LC processing
//   2. Bank Guarantee (BG) — Customs bond and duty deferment
//   3. Supply Chain Visibility — Container/cargo tracking
//
// LC Lifecycle:
//   DRAFT → ISSUED → ADVISED → PRESENTED → EXAMINED → SETTLED/DISCREPANT
//
// BG Lifecycle:
//   APPLIED → ISSUED → ACTIVE → CALLED/EXPIRED/CANCELLED
//
// Integration:
//   - TigerBeetle bridge for ledger entries
//   - Kafka for event publishing
//   - PostgreSQL for persistence
//   - SWIFT MT700/MT710 message generation
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
)

// ─── Models ───────────────────────────────────────────────────────────────────

type LetterOfCredit struct {
	ID                 string    `json:"id"`
	LCNumber           string    `json:"lc_number"`
	DeclarationID      string    `json:"declaration_id,omitempty"`
	ApplicantID        string    `json:"applicant_id"`
	ApplicantName      string    `json:"applicant_name"`
	BeneficiaryName    string    `json:"beneficiary_name"`
	BeneficiaryCountry string    `json:"beneficiary_country"`
	IssuingBank        string    `json:"issuing_bank"`
	AdvisingBank       string    `json:"advising_bank,omitempty"`
	Amount             float64   `json:"amount"`
	Currency           string    `json:"currency"`
	ExpiryDate         time.Time `json:"expiry_date"`
	PortOfLoading      string    `json:"port_of_loading"`
	PortOfDischarge    string    `json:"port_of_discharge"`
	GoodsDescription   string    `json:"goods_description"`
	HSCode             string    `json:"hs_code"`
	Incoterms          string    `json:"incoterms"` // CIF, FOB, CFR, etc.
	Status             string    `json:"status"`
	Documents          []string  `json:"documents_required"`
	SWIFTMessage       string    `json:"swift_mt700,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type BankGuarantee struct {
	ID              string    `json:"id"`
	BGNumber        string    `json:"bg_number"`
	DeclarationID   string    `json:"declaration_id,omitempty"`
	TraderID        string    `json:"trader_id"`
	IssuingBank     string    `json:"issuing_bank"`
	BeneficiaryName string    `json:"beneficiary_name"` // NCS
	GuaranteeType   string    `json:"guarantee_type"`   // "customs_bond", "duty_deferment", "transit"
	Amount          float64   `json:"amount"`
	Currency        string    `json:"currency"`
	ValidFrom       time.Time `json:"valid_from"`
	ValidTo         time.Time `json:"valid_to"`
	Status          string    `json:"status"`
	DutyAmount      float64   `json:"duty_amount,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type CargoTrackingEvent struct {
	ID            string    `json:"id"`
	DeclarationID string    `json:"declaration_id"`
	ContainerNo   string    `json:"container_no,omitempty"`
	VesselName    string    `json:"vessel_name,omitempty"`
	VoyageNo      string    `json:"voyage_no,omitempty"`
	EventType     string    `json:"event_type"` // "GATE_IN", "LOADED", "DEPARTED", "ARRIVED", "DISCHARGED", "GATE_OUT"
	Location      string    `json:"location"`
	Latitude      float64   `json:"latitude,omitempty"`
	Longitude     float64   `json:"longitude,omitempty"`
	EventTime     time.Time `json:"event_time"`
	Source        string    `json:"source"` // "PORT_SYSTEM", "SHIPPING_LINE", "CUSTOMS"
	CreatedAt     time.Time `json:"created_at"`
}

// ─── SWIFT MT700 Generator ────────────────────────────────────────────────────

func generateSWIFTMT700(lc *LetterOfCredit) string {
	// Generate SWIFT MT700 (Issue of a Documentary Credit) message
	return fmt.Sprintf(`:27: 1/1
:40A: IRREVOCABLE
:20: %s
:31C: %s
:31D: %s %s
:50: %s
:59: %s
:32B: %s%.2f
:41D: ANY BANK BY NEGOTIATION
:43P: ALLOWED
:43T: ALLOWED
:44A: %s
:44B: %s
:44C: %s
:45A: %s HS:%s %s
:46A: COMMERCIAL INVOICE, PACKING LIST, BILL OF LADING, CERTIFICATE OF ORIGIN
:47A: ALL DOCUMENTS IN ENGLISH
:71B: ALL BANKING CHARGES OUTSIDE NIGERIA FOR ACCOUNT OF BENEFICIARY
:48: 21 DAYS AFTER SHIPMENT DATE
:49: CONFIRM`,
		lc.LCNumber,
		lc.CreatedAt.Format("060102"),
		lc.ExpiryDate.Format("060102"),
		lc.BeneficiaryCountry,
		lc.ApplicantName,
		lc.BeneficiaryName,
		lc.Currency,
		lc.Amount,
		lc.PortOfLoading,
		lc.PortOfDischarge,
		lc.ExpiryDate.Format("060102"),
		lc.GoodsDescription,
		lc.HSCode,
		lc.Incoterms,
	)
}

// ─── Server ───────────────────────────────────────────────────────────────────

type Server struct {
	db *sql.DB
}

// ─── Letter of Credit Handlers ────────────────────────────────────────────────

func (s *Server) createLC(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeclarationID      string    `json:"declaration_id"`
		ApplicantID        string    `json:"applicant_id"`
		ApplicantName      string    `json:"applicant_name"`
		BeneficiaryName    string    `json:"beneficiary_name"`
		BeneficiaryCountry string    `json:"beneficiary_country"`
		IssuingBank        string    `json:"issuing_bank"`
		AdvisingBank       string    `json:"advising_bank"`
		Amount             float64   `json:"amount"`
		Currency           string    `json:"currency"`
		ExpiryDate         time.Time `json:"expiry_date"`
		PortOfLoading      string    `json:"port_of_loading"`
		PortOfDischarge    string    `json:"port_of_discharge"`
		GoodsDescription   string    `json:"goods_description"`
		HSCode             string    `json:"hs_code"`
		Incoterms          string    `json:"incoterms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	lc := LetterOfCredit{
		ID:                 uuid.New().String(),
		LCNumber:           fmt.Sprintf("LC-NG-%s-%s", time.Now().Format("200601"), uuid.New().String()[:8]),
		DeclarationID:      req.DeclarationID,
		ApplicantID:        req.ApplicantID,
		ApplicantName:      req.ApplicantName,
		BeneficiaryName:    req.BeneficiaryName,
		BeneficiaryCountry: req.BeneficiaryCountry,
		IssuingBank:        req.IssuingBank,
		AdvisingBank:       req.AdvisingBank,
		Amount:             req.Amount,
		Currency:           req.Currency,
		ExpiryDate:         req.ExpiryDate,
		PortOfLoading:      req.PortOfLoading,
		PortOfDischarge:    req.PortOfDischarge,
		GoodsDescription:   req.GoodsDescription,
		HSCode:             req.HSCode,
		Incoterms:          req.Incoterms,
		Status:             "ISSUED",
		Documents:          []string{"COMMERCIAL_INVOICE", "PACKING_LIST", "BILL_OF_LADING", "CERTIFICATE_OF_ORIGIN"},
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}
	lc.SWIFTMessage = generateSWIFTMT700(&lc)

	docsJSON, _ := json.Marshal(lc.Documents)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO letters_of_credit
		    (id, lc_number, declaration_id, applicant_id, applicant_name,
		     beneficiary_name, beneficiary_country, issuing_bank, advising_bank,
		     amount, currency, expiry_date, port_of_loading, port_of_discharge,
		     goods_description, hs_code, incoterms, status, documents_required,
		     swift_mt700, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW())
	`, lc.ID, lc.LCNumber, lc.DeclarationID, lc.ApplicantID, lc.ApplicantName,
		lc.BeneficiaryName, lc.BeneficiaryCountry, lc.IssuingBank, lc.AdvisingBank,
		lc.Amount, lc.Currency, lc.ExpiryDate, lc.PortOfLoading, lc.PortOfDischarge,
		lc.GoodsDescription, lc.HSCode, lc.Incoterms, lc.Status, docsJSON, lc.SWIFTMessage)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create LC: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(lc)
}

// ─── Bank Guarantee Handlers ──────────────────────────────────────────────────

func (s *Server) createBankGuarantee(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeclarationID string  `json:"declaration_id"`
		TraderID      string  `json:"trader_id"`
		IssuingBank   string  `json:"issuing_bank"`
		GuaranteeType string  `json:"guarantee_type"`
		Amount        float64 `json:"amount"`
		Currency      string  `json:"currency"`
		ValidDays     int     `json:"valid_days"`
		DutyAmount    float64 `json:"duty_amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if req.ValidDays <= 0 {
		req.ValidDays = 365
	}

	bg := BankGuarantee{
		ID:              uuid.New().String(),
		BGNumber:        fmt.Sprintf("BG-NCS-%s-%s", time.Now().Format("200601"), uuid.New().String()[:8]),
		DeclarationID:   req.DeclarationID,
		TraderID:        req.TraderID,
		IssuingBank:     req.IssuingBank,
		BeneficiaryName: "Nigeria Customs Service",
		GuaranteeType:   req.GuaranteeType,
		Amount:          req.Amount,
		Currency:        req.Currency,
		ValidFrom:       time.Now().UTC(),
		ValidTo:         time.Now().UTC().AddDate(0, 0, req.ValidDays),
		Status:          "ACTIVE",
		DutyAmount:      req.DutyAmount,
		CreatedAt:       time.Now().UTC(),
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO bank_guarantees
		    (id, bg_number, declaration_id, trader_id, issuing_bank,
		     beneficiary_name, guarantee_type, amount, currency,
		     valid_from, valid_to, status, duty_amount, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
	`, bg.ID, bg.BGNumber, bg.DeclarationID, bg.TraderID, bg.IssuingBank,
		bg.BeneficiaryName, bg.GuaranteeType, bg.Amount, bg.Currency,
		bg.ValidFrom, bg.ValidTo, bg.Status, bg.DutyAmount)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create BG: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(bg)
}

// ─── Supply Chain Visibility ──────────────────────────────────────────────────

func (s *Server) addTrackingEvent(w http.ResponseWriter, r *http.Request) {
	var event CargoTrackingEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	event.ID = uuid.New().String()
	event.CreatedAt = time.Now().UTC()

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO cargo_tracking_events
		    (id, declaration_id, container_no, vessel_name, voyage_no,
		     event_type, location, latitude, longitude, event_time, source, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
	`, event.ID, event.DeclarationID, event.ContainerNo, event.VesselName,
		event.VoyageNo, event.EventType, event.Location, event.Latitude,
		event.Longitude, event.EventTime, event.Source)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to record tracking event: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(event)
}

func (s *Server) getTrackingHistory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	declarationID := vars["declaration_id"]

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, declaration_id, COALESCE(container_no,''), COALESCE(vessel_name,''),
		       COALESCE(voyage_no,''), event_type, location,
		       COALESCE(latitude,0), COALESCE(longitude,0), event_time, source, created_at
		FROM cargo_tracking_events
		WHERE declaration_id = $1
		ORDER BY event_time ASC
	`, declarationID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var events []CargoTrackingEvent
	for rows.Next() {
		var e CargoTrackingEvent
		if err := rows.Scan(&e.ID, &e.DeclarationID, &e.ContainerNo, &e.VesselName,
			&e.VoyageNo, &e.EventType, &e.Location, &e.Latitude, &e.Longitude,
			&e.EventTime, &e.Source, &e.CreatedAt); err != nil {
			continue
		}
		events = append(events, e)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"declaration_id": declarationID,
		"events":         events,
		"count":          len(events),
	})
}

func (s *Server) getLC(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	lcID := vars["id"]
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var lc LetterOfCredit
	var docsJSON []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT id, lc_number, COALESCE(declaration_id,''), applicant_id, applicant_name,
		       beneficiary_name, beneficiary_country, issuing_bank, COALESCE(advising_bank,''),
		       amount, currency, expiry_date, port_of_loading, port_of_discharge,
		       goods_description, hs_code, incoterms, status, documents_required,
		       COALESCE(swift_mt700,''), created_at, updated_at
		FROM letters_of_credit WHERE id = $1
	`, lcID).Scan(
		&lc.ID, &lc.LCNumber, &lc.DeclarationID, &lc.ApplicantID, &lc.ApplicantName,
		&lc.BeneficiaryName, &lc.BeneficiaryCountry, &lc.IssuingBank, &lc.AdvisingBank,
		&lc.Amount, &lc.Currency, &lc.ExpiryDate, &lc.PortOfLoading, &lc.PortOfDischarge,
		&lc.GoodsDescription, &lc.HSCode, &lc.Incoterms, &lc.Status, &docsJSON,
		&lc.SWIFTMessage, &lc.CreatedAt, &lc.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		http.Error(w, "LC not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.Unmarshal(docsJSON, &lc.Documents)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(lc)
}

func (s *Server) listLC(w http.ResponseWriter, r *http.Request) {
	declarationID := r.URL.Query().Get("declaration_id")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var rows *sql.Rows
	var err error
	if declarationID != "" {
		rows, err = s.db.QueryContext(ctx, `SELECT id, lc_number, status, amount, currency, expiry_date, created_at FROM letters_of_credit WHERE declaration_id = $1 ORDER BY created_at DESC`, declarationID)
	} else {
		rows, err = s.db.QueryContext(ctx, `SELECT id, lc_number, status, amount, currency, expiry_date, created_at FROM letters_of_credit ORDER BY created_at DESC LIMIT 50`)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type LCSummary struct {
		ID string `json:"id"`
		LCNumber string `json:"lc_number"`
		Status string `json:"status"`
		Amount float64 `json:"amount"`
		Currency string `json:"currency"`
		ExpiryDate time.Time `json:"expiry_date"`
		CreatedAt time.Time `json:"created_at"`
	}
	var lcs []LCSummary
	for rows.Next() {
		var lc LCSummary
		if err := rows.Scan(&lc.ID, &lc.LCNumber, &lc.Status, &lc.Amount, &lc.Currency, &lc.ExpiryDate, &lc.CreatedAt); err != nil {
			continue
		}
		lcs = append(lcs, lc)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"letters_of_credit": lcs, "count": len(lcs)})
}

func (s *Server) getBG(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	bgID := vars["id"]
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var bg BankGuarantee
	err := s.db.QueryRowContext(ctx, `
		SELECT id, bg_number, COALESCE(declaration_id,''), trader_id, issuing_bank,
		       beneficiary_name, guarantee_type, amount, currency, valid_from, valid_to,
		       status, COALESCE(duty_amount,0), created_at
		FROM bank_guarantees WHERE id = $1
	`, bgID).Scan(
		&bg.ID, &bg.BGNumber, &bg.DeclarationID, &bg.TraderID, &bg.IssuingBank,
		&bg.BeneficiaryName, &bg.GuaranteeType, &bg.Amount, &bg.Currency,
		&bg.ValidFrom, &bg.ValidTo, &bg.Status, &bg.DutyAmount, &bg.CreatedAt,
	)
	if err == sql.ErrNoRows {
		http.Error(w, "Bank Guarantee not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(bg)
}

func (s *Server) listBG(w http.ResponseWriter, r *http.Request) {
	traderID := r.URL.Query().Get("trader_id")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var rows *sql.Rows
	var err error
	if traderID != "" {
		rows, err = s.db.QueryContext(ctx, `SELECT id, bg_number, guarantee_type, amount, currency, valid_to, status, created_at FROM bank_guarantees WHERE trader_id = $1 ORDER BY created_at DESC`, traderID)
	} else {
		rows, err = s.db.QueryContext(ctx, `SELECT id, bg_number, guarantee_type, amount, currency, valid_to, status, created_at FROM bank_guarantees ORDER BY created_at DESC LIMIT 50`)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type BGSummary struct {
		ID string `json:"id"`
		BGNumber string `json:"bg_number"`
		GuaranteeType string `json:"guarantee_type"`
		Amount float64 `json:"amount"`
		Currency string `json:"currency"`
		ValidTo time.Time `json:"valid_to"`
		Status string `json:"status"`
		CreatedAt time.Time `json:"created_at"`
	}
	var bgs []BGSummary
	for rows.Next() {
		var bg BGSummary
		if err := rows.Scan(&bg.ID, &bg.BGNumber, &bg.GuaranteeType, &bg.Amount, &bg.Currency, &bg.ValidTo, &bg.Status, &bg.CreatedAt); err != nil {
			continue
		}
		bgs = append(bgs, bg)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"bank_guarantees": bgs, "count": len(bgs)})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "trade-finance-service"})
}

// ─── Schema Bootstrap ─────────────────────────────────────────────────────────

func (s *Server) ensureSchema() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS letters_of_credit (
		    id                  VARCHAR(36) PRIMARY KEY,
		    lc_number           VARCHAR(50) UNIQUE NOT NULL,
		    declaration_id      VARCHAR(36),
		    applicant_id        VARCHAR(36),
		    applicant_name      VARCHAR(200),
		    beneficiary_name    VARCHAR(200),
		    beneficiary_country VARCHAR(3),
		    issuing_bank        VARCHAR(100),
		    advising_bank       VARCHAR(100),
		    amount              NUMERIC(15,2),
		    currency            VARCHAR(3) DEFAULT 'USD',
		    expiry_date         TIMESTAMPTZ,
		    port_of_loading     VARCHAR(10),
		    port_of_discharge   VARCHAR(10),
		    goods_description   TEXT,
		    hs_code             VARCHAR(10),
		    incoterms           VARCHAR(10),
		    status              VARCHAR(20) DEFAULT 'ISSUED',
		    documents_required  JSONB DEFAULT '[]',
		    swift_mt700         TEXT,
		    created_at          TIMESTAMPTZ DEFAULT NOW(),
		    updated_at          TIMESTAMPTZ DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS bank_guarantees (
		    id                  VARCHAR(36) PRIMARY KEY,
		    bg_number           VARCHAR(50) UNIQUE NOT NULL,
		    declaration_id      VARCHAR(36),
		    trader_id           VARCHAR(36),
		    issuing_bank        VARCHAR(100),
		    beneficiary_name    VARCHAR(200),
		    guarantee_type      VARCHAR(30),
		    amount              NUMERIC(15,2),
		    currency            VARCHAR(3) DEFAULT 'NGN',
		    valid_from          TIMESTAMPTZ,
		    valid_to            TIMESTAMPTZ,
		    status              VARCHAR(20) DEFAULT 'ACTIVE',
		    duty_amount         NUMERIC(15,2),
		    created_at          TIMESTAMPTZ DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS cargo_tracking_events (
		    id                  VARCHAR(36) PRIMARY KEY,
		    declaration_id      VARCHAR(36) NOT NULL,
		    container_no        VARCHAR(20),
		    vessel_name         VARCHAR(100),
		    voyage_no           VARCHAR(20),
		    event_type          VARCHAR(30) NOT NULL,
		    location            VARCHAR(100),
		    latitude            NUMERIC(10,6),
		    longitude           NUMERIC(10,6),
		    event_time          TIMESTAMPTZ NOT NULL,
		    source              VARCHAR(30),
		    created_at          TIMESTAMPTZ DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS idx_lc_declaration ON letters_of_credit(declaration_id);
		CREATE INDEX IF NOT EXISTS idx_bg_trader ON bank_guarantees(trader_id);
		CREATE INDEX IF NOT EXISTS idx_tracking_declaration ON cargo_tracking_events(declaration_id);
		CREATE INDEX IF NOT EXISTS idx_tracking_container ON cargo_tracking_events(container_no);
	`)
	return err
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	dbURL := getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)

	srv := &Server{db: db}
	if err := srv.ensureSchema(); err != nil {
		log.Fatalf("Schema migration failed: %v", err)
	}

	r := mux.NewRouter()
	r.HandleFunc("/v1/health", srv.health).Methods("GET")
	r.HandleFunc("/v1/letters-of-credit", srv.createLC).Methods("POST")
	r.HandleFunc("/v1/letters-of-credit", srv.listLC).Methods("GET")
	r.HandleFunc("/v1/letters-of-credit/{id}", srv.getLC).Methods("GET")
	r.HandleFunc("/v1/bank-guarantees", srv.createBankGuarantee).Methods("POST")
	r.HandleFunc("/v1/bank-guarantees", srv.listBG).Methods("GET")
	r.HandleFunc("/v1/bank-guarantees/{id}", srv.getBG).Methods("GET")
	r.HandleFunc("/v1/tracking/{declaration_id}/events", srv.addTrackingEvent).Methods("POST")
	r.HandleFunc("/v1/tracking/{declaration_id}", srv.getTrackingHistory).Methods("GET")

	port := getEnv("PORT", "8097")
	log.Printf("Trade Finance Service listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
