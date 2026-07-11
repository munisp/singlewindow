// OGA Service — Other Government Agencies permit management
// Language: Go 1.23 | Protocol: gRPC + HTTP REST | DB: PostgreSQL
// Handles: permit creation, approval/rejection, SLA tracking, joint inspection

package main

import (
	"context"
	"database/sql"
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
	ogamw "github.com/munisp/singlewindow/services/go/oga-service/internal/middleware"
)

// ─── CONFIG ──────────────────────────────────────────────────────────────────

var (
	grpcPort = getEnv("OGA_GRPC_PORT", "50052")
	httpPort = getEnv("OGA_HTTP_PORT", "8082")
	dbURL    = getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
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

type OGAPermit struct {
	ID              int64     `json:"id"`
	DeclarationID   int64     `json:"declarationId"`
	AgencyCode      string    `json:"agencyCode"`
	AgencyName      string    `json:"agencyName"`
	PermitType      string    `json:"permitType"`
	Status          string    `json:"status"`
	ReferenceNumber string    `json:"referenceNumber"`
	Notes           string    `json:"notes,omitempty"`
	RequestedAt     time.Time `json:"requestedAt"`
	RespondedAt     *time.Time `json:"respondedAt,omitempty"`
	ExpiresAt       *time.Time `json:"expiresAt,omitempty"`
	SLAHours        int       `json:"slaHours"`
	SLABreached     bool      `json:"slaBreached"`
}

type CreatePermitRequest struct {
	DeclarationID int64  `json:"declarationId"`
	AgencyCode    string `json:"agencyCode"`
	AgencyName    string `json:"agencyName"`
	PermitType    string `json:"permitType"`
}

type UpdatePermitRequest struct {
	Status string `json:"status"`
	Notes  string `json:"notes"`
}

// ─── OGA AGENCY REGISTRY ─────────────────────────────────────────────────────

var agencyRegistry = map[string]struct {
	Name     string
	SLAHours int
	Types    []string
}{
	"FDA":    {Name: "Food & Drug Authority", SLAHours: 48, Types: []string{"food_import", "drug_import", "cosmetics"}},
	"EPA":    {Name: "Environmental Protection Agency", SLAHours: 72, Types: []string{"hazardous_goods", "chemicals", "waste"}},
	"MOTI":   {Name: "Ministry of Trade & Industry", SLAHours: 24, Types: []string{"import_permit", "export_permit", "quota"}},
	"MOFEP":  {Name: "Ministry of Finance", SLAHours: 24, Types: []string{"duty_exemption", "tax_relief", "bond"}},
	"GPHA":   {Name: "Ghana Ports & Harbours Authority", SLAHours: 12, Types: []string{"port_clearance", "berth_allocation"}},
	"GSB":    {Name: "Ghana Standards Board", SLAHours: 48, Types: []string{"standards_cert", "quality_inspection"}},
	"CEPS":   {Name: "Customs Excise & Preventive Service", SLAHours: 8, Types: []string{"customs_clearance", "excise_permit"}},
	"NACOB":  {Name: "Narcotics Control Board", SLAHours: 72, Types: []string{"controlled_substance", "precursor_chemical"}},
	"PPRSD":  {Name: "Plant Protection & Regulatory Services", SLAHours: 48, Types: []string{"phytosanitary", "plant_import"}},
	"VBQSD":  {Name: "Veterinary Services", SLAHours: 48, Types: []string{"veterinary_cert", "animal_import", "meat_import"}},
	"GNFS":   {Name: "Ghana National Fire Service", SLAHours: 24, Types: []string{"flammable_goods", "explosives"}},
	"BOST":   {Name: "Bulk Oil Storage & Transportation", SLAHours: 24, Types: []string{"petroleum_import", "fuel_storage"}},
}

// ─── DATABASE QUERIES ─────────────────────────────────────────────────────────

func getPermitsByDeclaration(declarationID int64) ([]OGAPermit, error) {
	rows, err := db.Query(`
		SELECT id, declaration_id, agency_code, agency_name, permit_type, status,
		       reference_number, notes, requested_at, responded_at, expires_at, sla_hours
		FROM oga_permits WHERE declaration_id = $1 ORDER BY requested_at DESC
	`, declarationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var permits []OGAPermit
	for rows.Next() {
		var p OGAPermit
		var notes, refNum sql.NullString
		var respondedAt, expiresAt sql.NullTime
		err := rows.Scan(&p.ID, &p.DeclarationID, &p.AgencyCode, &p.AgencyName,
			&p.PermitType, &p.Status, &refNum, &notes,
			&p.RequestedAt, &respondedAt, &expiresAt, &p.SLAHours)
		if err != nil {
			return nil, err
		}
		p.Notes = notes.String
		p.ReferenceNumber = refNum.String
		if respondedAt.Valid {
			p.RespondedAt = &respondedAt.Time
		}
		if expiresAt.Valid {
			p.ExpiresAt = &expiresAt.Time
		}
		// Check SLA breach
		if p.Status == "pending" || p.Status == "under_review" {
			deadline := p.RequestedAt.Add(time.Duration(p.SLAHours) * time.Hour)
			p.SLABreached = time.Now().After(deadline)
		}
		permits = append(permits, p)
	}
	return permits, nil
}

func getPermitsByAgency(agencyCode string, status string) ([]OGAPermit, error) {
	query := `
		SELECT id, declaration_id, agency_code, agency_name, permit_type, status,
		       reference_number, notes, requested_at, responded_at, expires_at, sla_hours
		FROM oga_permits WHERE agency_code = $1`
	args := []interface{}{agencyCode}
	if status != "" {
		query += " AND status = $2"
		args = append(args, status)
	}
	query += " ORDER BY requested_at DESC LIMIT 100"

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var permits []OGAPermit
	for rows.Next() {
		var p OGAPermit
		var notes, refNum sql.NullString
		var respondedAt, expiresAt sql.NullTime
		err := rows.Scan(&p.ID, &p.DeclarationID, &p.AgencyCode, &p.AgencyName,
			&p.PermitType, &p.Status, &refNum, &notes,
			&p.RequestedAt, &respondedAt, &expiresAt, &p.SLAHours)
		if err != nil {
			return nil, err
		}
		p.Notes = notes.String
		p.ReferenceNumber = refNum.String
		if respondedAt.Valid {
			p.RespondedAt = &respondedAt.Time
		}
		if expiresAt.Valid {
			p.ExpiresAt = &expiresAt.Time
		}
		if p.Status == "pending" || p.Status == "under_review" {
			deadline := p.RequestedAt.Add(time.Duration(p.SLAHours) * time.Hour)
			p.SLABreached = time.Now().After(deadline)
		}
		permits = append(permits, p)
	}
	return permits, nil
}

func createPermit(req CreatePermitRequest) (*OGAPermit, error) {
	agency, ok := agencyRegistry[req.AgencyCode]
	if !ok {
		agency.Name = req.AgencyName
		agency.SLAHours = 48
	}

	refNum := fmt.Sprintf("%s-%d-%d", req.AgencyCode, req.DeclarationID, time.Now().UnixMilli())

	var p OGAPermit
	err := db.QueryRow(`
		INSERT INTO oga_permits (declaration_id, agency_code, agency_name, permit_type, status,
		                         reference_number, requested_at, sla_hours)
		VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), $6)
		RETURNING id, declaration_id, agency_code, agency_name, permit_type, status,
		          reference_number, requested_at, sla_hours
	`, req.DeclarationID, req.AgencyCode, agency.Name, req.PermitType, refNum, agency.SLAHours).
		Scan(&p.ID, &p.DeclarationID, &p.AgencyCode, &p.AgencyName,
			&p.PermitType, &p.Status, &p.ReferenceNumber, &p.RequestedAt, &p.SLAHours)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func updatePermitStatus(permitID int64, status, notes string) (*OGAPermit, error) {
	var p OGAPermit
	var notesVal, refNum sql.NullString
	var respondedAt, expiresAt sql.NullTime

	err := db.QueryRow(`
		UPDATE oga_permits
		SET status = $1, notes = $2, responded_at = NOW(),
		    expires_at = CASE WHEN $1 = 'approved' THEN NOW() + INTERVAL '1 year' ELSE NULL END
		WHERE id = $3
		RETURNING id, declaration_id, agency_code, agency_name, permit_type, status,
		          reference_number, notes, requested_at, responded_at, expires_at, sla_hours
	`, status, notes, permitID).
		Scan(&p.ID, &p.DeclarationID, &p.AgencyCode, &p.AgencyName,
			&p.PermitType, &p.Status, &refNum, &notesVal,
			&p.RequestedAt, &respondedAt, &expiresAt, &p.SLAHours)
	if err != nil {
		return nil, err
	}
	p.Notes = notesVal.String
	p.ReferenceNumber = refNum.String
	if respondedAt.Valid {
		p.RespondedAt = &respondedAt.Time
	}
	if expiresAt.Valid {
		p.ExpiresAt = &expiresAt.Time
	}
	return &p, nil
}

// ─── SLA MONITOR ─────────────────────────────────────────────────────────────

func runSLAMonitor(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			checkSLABreaches()
		}
	}
}

func checkSLABreaches() {
	rows, err := db.Query(`
		SELECT id, agency_code, sla_hours, requested_at
		FROM oga_permits
		WHERE status IN ('pending', 'under_review')
		  AND requested_at + (sla_hours || ' hours')::interval < NOW()
	`)
	if err != nil {
		log.Printf("[SLA Monitor] Query error: %v", err)
		return
	}
	defer rows.Close()

	var breachedIDs []int64
	for rows.Next() {
		var id int64
		var agencyCode string
		var slaHours int
		var requestedAt time.Time
		if err := rows.Scan(&id, &agencyCode, &slaHours, &requestedAt); err == nil {
			breachedIDs = append(breachedIDs, id)
			log.Printf("[SLA Monitor] Breach: permit %d from %s (SLA: %dh, requested: %s)",
				id, agencyCode, slaHours, requestedAt.Format(time.RFC3339))
		}
	}
	log.Printf("[SLA Monitor] Found %d SLA breaches", len(breachedIDs))
}

// ─── HTTP HANDLERS ────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func handleGetPermitsByDeclaration(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeclarationID int64 `json:"declarationId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	permits, err := getPermitsByDeclaration(req.DeclarationID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, permits)
}

func handleGetPermitsByAgency(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AgencyCode string `json:"agencyCode"`
		Status     string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	permits, err := getPermitsByAgency(req.AgencyCode, req.Status)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, permits)
}

func handleCreatePermit(w http.ResponseWriter, r *http.Request) {
	var req CreatePermitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	permit, err := createPermit(req)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, permit)
}

func handleUpdatePermit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PermitID int64  `json:"permitId"`
		Status   string `json:"status"`
		Notes    string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	permit, err := updatePermitStatus(req.PermitID, req.Status, req.Notes)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, permit)
}

func handleGetAgencies(w http.ResponseWriter, r *http.Request) {
	type AgencyInfo struct {
		Code     string   `json:"code"`
		Name     string   `json:"name"`
		SLAHours int      `json:"slaHours"`
		Types    []string `json:"types"`
	}
	var agencies []AgencyInfo
	for code, info := range agencyRegistry {
		agencies = append(agencies, AgencyInfo{
			Code:     code,
			Name:     info.Name,
			SLAHours: info.SLAHours,
			Types:    info.Types,
		})
	}
	writeJSON(w, 200, agencies)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := db.Ping(); err != nil {
		writeJSON(w, 503, map[string]string{"status": "unhealthy", "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "healthy", "service": "oga-service", "version": "1.0.0"})
}

// ─── GRPC SERVER (stub — full implementation uses generated proto code) ───────

type grpcServer struct{}

func startGRPCServer() {
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatalf("[gRPC] Failed to listen: %v", err)
	}
	s := grpc.NewServer()
	reflection.Register(s)
	log.Printf("[gRPC] OGA service listening on :%s", grpcPort)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("[gRPC] Failed to serve: %v", err)
	}
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("[OGA Service] Starting up...")

	if err := initDB(); err != nil {
		log.Fatalf("[OGA Service] DB init failed: %v", err)
	}
	log.Printf("[OGA Service] PostgreSQL connected")

	// Start SLA monitor in background
	ctx := context.Background()
	go runSLAMonitor(ctx)

	// Start gRPC server in background
	go startGRPCServer()

	// Wire Kafka/Dapr middleware (graceful: skipped if brokers unavailable)
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if kafkaBrokers == "" {
		kafkaBrokers = "kafka:9092"
	}
	// Kafka consumer handlers (no-op stubs; real handlers injected in production)
	declHandler := func(_ context.Context, evt ogamw.DeclarationSubmittedEvent) error {
		log.Printf("[OGA Service] Declaration submitted: %d", evt.DeclarationID)
		return nil
	}
	wfHandler := func(_ context.Context, evt ogamw.WorkflowOGADispatchedEvent) error {
		log.Printf("[OGA Service] Workflow dispatched: %s", evt.WorkflowID)
		return nil
	}
	_ = kafkaBrokers // used by middleware via KAFKA_BROKERS env
	mw, mwErr := ogamw.NewMiddlewareClients(declHandler, wfHandler)
	if mwErr == nil && mw != nil {
		log.Printf("[OGA Service] Kafka middleware started")
		defer mw.Close()
	} else if mwErr != nil {
		log.Printf("[OGA Service] Kafka middleware init warning: %v (continuing without Kafka)", mwErr)
	}

	// HTTP REST server
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/permits/by-declaration", handleGetPermitsByDeclaration)
	mux.HandleFunc("/permits/by-agency", handleGetPermitsByAgency)
	mux.HandleFunc("/permits/create", handleCreatePermit)
	mux.HandleFunc("/permits/update", handleUpdatePermit)
	mux.HandleFunc("/agencies", handleGetAgencies)

	srv := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	log.Printf("[OGA Service] HTTP server listening on :%s", httpPort)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[OGA Service] HTTP server failed: %v", err)
	}
}
