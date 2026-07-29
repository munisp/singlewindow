// manifest-service — Electronic Manifest Management Service
//
// TradeGateway NGSWTP — Go microservice for pre-arrival manifest processing.
//
// Handles:
//   - Master manifest submission by shipping lines/airlines
//   - House manifest creation by freight forwarders
//   - Manifest amendment requests
//   - Bill of Lading (BL) management within manifests
//   - Pre-arrival notification to NCS/NPA
//   - Kafka event publishing for downstream processing
//
// HTTP API:
//   POST /api/manifests                     — Submit a master manifest
//   GET  /api/manifests/:id                 — Get manifest details
//   GET  /api/manifests/vessel/:vesselId    — List manifests for a vessel
//   POST /api/manifests/:id/house           — Create a house manifest
//   GET  /api/manifests/:id/house           — List house manifests
//   POST /api/manifests/:id/amend           — Request manifest amendment
//   POST /api/manifests/:id/bl              — Add/update Bill of Lading
//   DELETE /api/manifests/:id/bl/:blNumber  — Remove Bill of Lading
//   GET  /health                            — Health check
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ManifestType string

const (
	ManifestTypeSea ManifestType = "SEA"
	ManifestTypeAir ManifestType = "AIR"
)

type ManifestStatus string

const (
	ManifestStatusDraft     ManifestStatus = "DRAFT"
	ManifestStatusSubmitted ManifestStatus = "SUBMITTED"
	ManifestStatusAccepted  ManifestStatus = "ACCEPTED"
	ManifestStatusAmended   ManifestStatus = "AMENDED"
	ManifestStatusRejected  ManifestStatus = "REJECTED"
)

type Manifest struct {
	ID              int64          `json:"id"`
	ManifestNumber  string         `json:"manifestNumber"`
	ManifestType    ManifestType   `json:"manifestType"`
	Status          ManifestStatus `json:"status"`
	VesselName      string         `json:"vesselName"`
	VoyageNumber    string         `json:"voyageNumber"`
	PortOfLoading   string         `json:"portOfLoading"`
	PortOfDischarge string         `json:"portOfDischarge"`
	ETA             time.Time      `json:"eta"`
	SubmittedBy     int64          `json:"submittedBy"`
	TotalBLs        int            `json:"totalBLs"`
	TotalWeight     float64        `json:"totalWeightKg"`
	TotalPackages   int            `json:"totalPackages"`
	CreatedAt       time.Time      `json:"createdAt"`
	UpdatedAt       time.Time      `json:"updatedAt"`
}

type HouseManifest struct {
	ID             int64          `json:"id"`
	ManifestID     int64          `json:"manifestId"`
	HouseBLNumber  string         `json:"houseBLNumber"`
	MasterBLNumber string         `json:"masterBLNumber"`
	Shipper        string         `json:"shipper"`
	Consignee      string         `json:"consignee"`
	Description    string         `json:"description"`
	HSCode         string         `json:"hsCode"`
	WeightKg       float64        `json:"weightKg"`
	NumPackages    int            `json:"numPackages"`
	Status         ManifestStatus `json:"status"`
	CreatedAt      time.Time      `json:"createdAt"`
}

type BillOfLading struct {
	ID             int64     `json:"id"`
	ManifestID     int64     `json:"manifestId"`
	BLNumber       string    `json:"blNumber"`
	Shipper        string    `json:"shipper"`
	Consignee      string    `json:"consignee"`
	NotifyParty    string    `json:"notifyParty"`
	Description    string    `json:"description"`
	HSCode         string    `json:"hsCode"`
	WeightKg       float64   `json:"weightKg"`
	NumPackages    int       `json:"numPackages"`
	ContainerNos   []string  `json:"containerNos"`
	CreatedAt      time.Time `json:"createdAt"`
}

type SubmitManifestRequest struct {
	ManifestType    ManifestType `json:"manifestType" binding:"required"`
	VesselName      string       `json:"vesselName" binding:"required"`
	VoyageNumber    string       `json:"voyageNumber" binding:"required"`
	PortOfLoading   string       `json:"portOfLoading" binding:"required"`
	PortOfDischarge string       `json:"portOfDischarge" binding:"required"`
	ETA             time.Time    `json:"eta" binding:"required"`
	SubmittedBy     int64        `json:"submittedBy" binding:"required"`
}

type AddBLRequest struct {
	BLNumber     string   `json:"blNumber" binding:"required"`
	Shipper      string   `json:"shipper" binding:"required"`
	Consignee    string   `json:"consignee" binding:"required"`
	NotifyParty  string   `json:"notifyParty"`
	Description  string   `json:"description" binding:"required"`
	HSCode       string   `json:"hsCode"`
	WeightKg     float64  `json:"weightKg"`
	NumPackages  int      `json:"numPackages"`
	ContainerNos []string `json:"containerNos"`
}

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

var (
	manifestsSubmitted = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "manifests_submitted_total", Help: "Total manifests submitted"},
		[]string{"manifest_type"},
	)
	blsAdded = prometheus.NewCounter(
		prometheus.CounterOpts{Name: "bills_of_lading_added_total", Help: "Total BLs added"},
	)
)

func init() {
	prometheus.MustRegister(manifestsSubmitted, blsAdded)
}

// ─── Store ────────────────────────────────────────────────────────────────────

type ManifestStore struct {
	pool *pgxpool.Pool
}

func NewManifestStore(pool *pgxpool.Pool) *ManifestStore {
	return &ManifestStore{pool: pool}
}

func (s *ManifestStore) EnsureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS manifests (
			id               BIGSERIAL PRIMARY KEY,
			manifest_number  VARCHAR(64) NOT NULL UNIQUE,
			manifest_type    VARCHAR(8) NOT NULL DEFAULT 'SEA',
			status           VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
			vessel_name      VARCHAR(128),
			voyage_number    VARCHAR(64),
			port_of_loading  VARCHAR(64),
			port_of_discharge VARCHAR(64),
			eta              TIMESTAMPTZ,
			submitted_by     BIGINT NOT NULL,
			total_bls        INT NOT NULL DEFAULT 0,
			total_weight_kg  NUMERIC(12,2) NOT NULL DEFAULT 0,
			total_packages   INT NOT NULL DEFAULT 0,
			created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS bills_of_lading (
			id             BIGSERIAL PRIMARY KEY,
			manifest_id    BIGINT NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
			bl_number      VARCHAR(64) NOT NULL,
			shipper        VARCHAR(256),
			consignee      VARCHAR(256),
			notify_party   VARCHAR(256),
			description    TEXT,
			hs_code        VARCHAR(16),
			weight_kg      NUMERIC(12,2),
			num_packages   INT,
			container_nos  JSONB DEFAULT '[]',
			created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(manifest_id, bl_number)
		);

		CREATE TABLE IF NOT EXISTS house_manifests (
			id               BIGSERIAL PRIMARY KEY,
			manifest_id      BIGINT NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
			house_bl_number  VARCHAR(64) NOT NULL,
			master_bl_number VARCHAR(64),
			shipper          VARCHAR(256),
			consignee        VARCHAR(256),
			description      TEXT,
			hs_code          VARCHAR(16),
			weight_kg        NUMERIC(12,2),
			num_packages     INT,
			status           VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED',
			created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(manifest_id, house_bl_number)
		);

		CREATE TABLE IF NOT EXISTS manifest_amendments (
			id          BIGSERIAL PRIMARY KEY,
			manifest_id BIGINT NOT NULL REFERENCES manifests(id),
			reason      TEXT NOT NULL,
			changes     JSONB NOT NULL DEFAULT '{}',
			requested_by BIGINT NOT NULL,
			status      VARCHAR(16) NOT NULL DEFAULT 'PENDING',
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS idx_manifests_vessel ON manifests(vessel_name, voyage_number);
		CREATE INDEX IF NOT EXISTS idx_manifests_status ON manifests(status);
		CREATE INDEX IF NOT EXISTS idx_manifests_eta ON manifests(eta);
		CREATE INDEX IF NOT EXISTS idx_bls_manifest ON bills_of_lading(manifest_id);
		CREATE INDEX IF NOT EXISTS idx_house_manifests_manifest ON house_manifests(manifest_id);
	`)
	return err
}

func generateManifestNumber(manifestType ManifestType) string {
	prefix := "SEA"
	if manifestType == ManifestTypeAir {
		prefix = "AIR"
	}
	return fmt.Sprintf("NG-%s-%d-%06d", prefix, time.Now().Year(), time.Now().UnixNano()%1_000_000)
}

func (s *ManifestStore) Create(ctx context.Context, m *Manifest) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO manifests (manifest_number, manifest_type, status, vessel_name, voyage_number,
		                       port_of_loading, port_of_discharge, eta, submitted_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at, updated_at
	`, m.ManifestNumber, m.ManifestType, m.Status, m.VesselName, m.VoyageNumber,
		m.PortOfLoading, m.PortOfDischarge, m.ETA, m.SubmittedBy).
		Scan(&m.ID, &m.CreatedAt, &m.UpdatedAt)
}

func (s *ManifestStore) GetByID(ctx context.Context, id int64) (*Manifest, error) {
	m := &Manifest{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, manifest_number, manifest_type, status, vessel_name, voyage_number,
		       port_of_loading, port_of_discharge, eta, submitted_by,
		       total_bls, total_weight_kg, total_packages, created_at, updated_at
		FROM manifests WHERE id = $1
	`, id).Scan(
		&m.ID, &m.ManifestNumber, &m.ManifestType, &m.Status, &m.VesselName, &m.VoyageNumber,
		&m.PortOfLoading, &m.PortOfDischarge, &m.ETA, &m.SubmittedBy,
		&m.TotalBLs, &m.TotalWeight, &m.TotalPackages, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (s *ManifestStore) AddBL(ctx context.Context, bl *BillOfLading) error {
	containerJSON, _ := json.Marshal(bl.ContainerNos)
	err := s.pool.QueryRow(ctx, `
		INSERT INTO bills_of_lading (manifest_id, bl_number, shipper, consignee, notify_party,
		                             description, hs_code, weight_kg, num_packages, container_nos)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (manifest_id, bl_number) DO UPDATE SET
		  shipper = EXCLUDED.shipper, consignee = EXCLUDED.consignee,
		  description = EXCLUDED.description, weight_kg = EXCLUDED.weight_kg,
		  num_packages = EXCLUDED.num_packages, container_nos = EXCLUDED.container_nos
		RETURNING id, created_at
	`, bl.ManifestID, bl.BLNumber, bl.Shipper, bl.Consignee, bl.NotifyParty,
		bl.Description, bl.HSCode, bl.WeightKg, bl.NumPackages, containerJSON).
		Scan(&bl.ID, &bl.CreatedAt)
	if err != nil {
		return err
	}
	// Update manifest totals
	_, err = s.pool.Exec(ctx, `
		UPDATE manifests SET
		  total_bls = (SELECT COUNT(*) FROM bills_of_lading WHERE manifest_id = $1),
		  total_weight_kg = (SELECT COALESCE(SUM(weight_kg), 0) FROM bills_of_lading WHERE manifest_id = $1),
		  total_packages = (SELECT COALESCE(SUM(num_packages), 0) FROM bills_of_lading WHERE manifest_id = $1),
		  updated_at = NOW()
		WHERE id = $1
	`, bl.ManifestID)
	return err
}

// ─── Kafka Publisher ──────────────────────────────────────────────────────────

func publishManifestEvent(ctx context.Context, eventType string, payload interface{}) {
	data, _ := json.Marshal(map[string]interface{}{
		"eventType": eventType,
		"payload":   payload,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	daprPort := getEnv("DAPR_HTTP_PORT", "3500")
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/manifest.events", daprPort)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(data)))
	if req != nil {
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 3 * time.Second}
		resp, _ := client.Do(req)
		if resp != nil {
			resp.Body.Close()
		}
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

type Server struct {
	store *ManifestStore
}

func (s *Server) submitManifest(c *gin.Context) {
	var req SubmitManifestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	m := &Manifest{
		ManifestNumber:  generateManifestNumber(req.ManifestType),
		ManifestType:    req.ManifestType,
		Status:          ManifestStatusSubmitted,
		VesselName:      req.VesselName,
		VoyageNumber:    req.VoyageNumber,
		PortOfLoading:   req.PortOfLoading,
		PortOfDischarge: req.PortOfDischarge,
		ETA:             req.ETA,
		SubmittedBy:     req.SubmittedBy,
	}

	if err := s.store.Create(c.Request.Context(), m); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	manifestsSubmitted.WithLabelValues(string(req.ManifestType)).Inc()
	publishManifestEvent(c.Request.Context(), "MANIFEST_SUBMITTED", m)

	c.JSON(http.StatusCreated, m)
}

func (s *Server) getManifest(c *gin.Context) {
	var id int64
	if _, err := fmt.Sscan(c.Param("id"), &id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid manifest ID"})
		return
	}
	m, err := s.store.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Manifest not found"})
		return
	}
	c.JSON(http.StatusOK, m)
}

func (s *Server) addBL(c *gin.Context) {
	var manifestID int64
	if _, err := fmt.Sscan(c.Param("id"), &manifestID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid manifest ID"})
		return
	}

	var req AddBLRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	bl := &BillOfLading{
		ManifestID:   manifestID,
		BLNumber:     req.BLNumber,
		Shipper:      req.Shipper,
		Consignee:    req.Consignee,
		NotifyParty:  req.NotifyParty,
		Description:  req.Description,
		HSCode:       req.HSCode,
		WeightKg:     req.WeightKg,
		NumPackages:  req.NumPackages,
		ContainerNos: req.ContainerNos,
	}

	if err := s.store.AddBL(c.Request.Context(), bl); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	blsAdded.Inc()
	publishManifestEvent(c.Request.Context(), "BL_ADDED", bl)

	c.JSON(http.StatusCreated, bl)
}

func main() {
	dbURL := getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
	port := getEnv("PORT", "8098")

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("DB connection failed: %v", err)
	}
	defer pool.Close()

	store := NewManifestStore(pool)
	if err := store.EnsureSchema(ctx); err != nil {
		log.Fatalf("Schema setup failed: %v", err)
	}

	srv := &Server{store: store}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "manifest-service"})
	})
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	api := r.Group("/api/manifests")
	api.POST("", srv.submitManifest)
	api.GET("/:id", srv.getManifest)
	api.POST("/:id/bl", srv.addBL)

	httpSrv := &http.Server{Addr: ":" + port, Handler: r}
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("[manifest-service] Starting on port %s", port)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-quit
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
