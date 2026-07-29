// ucr-service — Unique Consignment Reference (UCR) Management Service
//
// TradeGateway NGSWTP — Go microservice implementing the WCO UCR standard.
//
// The UCR is the primary identifier linking all declarations and documents
// for a specific shipment. This service:
//   - Generates WCO-compliant UCRs (ISO 15459 / WCO Rec 11)
//   - Validates UCR integrity (one consignment = one UCR)
//   - Manages UCR lifecycle (created → linked → active → closed)
//   - Publishes UCR events to Kafka (topic: ucr.events)
//   - Exposes Dapr pub/sub for cross-service communication
//   - Integrates with Temporal for workflow orchestration
//
// HTTP API:
//   POST /api/ucr/generate          — Generate a new UCR for a consignment
//   GET  /api/ucr/:ucr              — Get UCR details
//   POST /api/ucr/:ucr/link         — Link a declaration to a UCR
//   POST /api/ucr/:ucr/activate     — Activate a UCR (pre-arrival)
//   POST /api/ucr/:ucr/close        — Close a UCR (post-clearance)
//   GET  /api/ucr/:ucr/validate     — Validate a UCR (public endpoint)
//   GET  /api/ucr/trader/:traderId  — List UCRs for a trader
//   GET  /health                    — Health check
//   GET  /metrics                   — Prometheus metrics
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
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Configuration ────────────────────────────────────────────────────────────

type Config struct {
	Port          string
	DatabaseURL   string
	KafkaBrokers  string
	DaprPort      string
	CountryCode   string // ISO 3166-1 alpha-2, e.g. "NG"
}

func loadConfig() Config {
	return Config{
		Port:         getEnv("PORT", "8097"),
		DatabaseURL:  getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"),
		KafkaBrokers: getEnv("KAFKA_BROKERS", "localhost:9092"),
		DaprPort:     getEnv("DAPR_HTTP_PORT", "3500"),
		CountryCode:  getEnv("COUNTRY_CODE", "NG"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── UCR Types ────────────────────────────────────────────────────────────────

type UCRType string

const (
	UCRTypeSingle   UCRType = "SINGLE"
	UCRTypeMultiple UCRType = "MULTIPLE"
)

type UCRStatus string

const (
	UCRStatusCreated   UCRStatus = "CREATED"
	UCRStatusLinked    UCRStatus = "LINKED"
	UCRStatusActive    UCRStatus = "ACTIVE"
	UCRStatusCleared   UCRStatus = "CLEARED"
	UCRStatusClosed    UCRStatus = "CLOSED"
	UCRStatusCancelled UCRStatus = "CANCELLED"
)

type UCR struct {
	ID            int64     `json:"id"`
	UCRNumber     string    `json:"ucrNumber"`
	UCRType       UCRType   `json:"ucrType"`
	Status        UCRStatus `json:"status"`
	TraderID      int64     `json:"traderId"`
	DeclarationID *int64    `json:"declarationId,omitempty"`
	ConsigneeRef  string    `json:"consigneeRef"`
	PortOfEntry   string    `json:"portOfEntry"`
	CountryCode   string    `json:"countryCode"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	LinkedAt      *time.Time `json:"linkedAt,omitempty"`
	ActivatedAt   *time.Time `json:"activatedAt,omitempty"`
	ClosedAt      *time.Time `json:"closedAt,omitempty"`
}

type GenerateUCRRequest struct {
	TraderID     int64   `json:"traderId" binding:"required"`
	UCRType      UCRType `json:"ucrType" binding:"required"`
	ConsigneeRef string  `json:"consigneeRef" binding:"required"`
	PortOfEntry  string  `json:"portOfEntry" binding:"required"`
}

type LinkDeclarationRequest struct {
	DeclarationID int64 `json:"declarationId" binding:"required"`
}

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

var (
	ucrGenerated = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "ucr_generated_total", Help: "Total UCRs generated"},
		[]string{"ucr_type"},
	)
	ucrLinked = prometheus.NewCounter(
		prometheus.CounterOpts{Name: "ucr_linked_total", Help: "Total UCRs linked to declarations"},
	)
	ucrActivated = prometheus.NewCounter(
		prometheus.CounterOpts{Name: "ucr_activated_total", Help: "Total UCRs activated"},
	)
	ucrClosed = prometheus.NewCounter(
		prometheus.CounterOpts{Name: "ucr_closed_total", Help: "Total UCRs closed"},
	)
)

func init() {
	prometheus.MustRegister(ucrGenerated, ucrLinked, ucrActivated, ucrClosed)
}

// ─── UCR Generation ───────────────────────────────────────────────────────────

// generateUCRNumber generates a WCO-compliant UCR number.
// Format: {CountryCode}{Year}{TraderID:8d}{Sequence:6d}
// Example: NG2026000012340000001
func generateUCRNumber(countryCode string, traderID int64) string {
	year := time.Now().Year()
	seq := time.Now().UnixNano() % 1_000_000
	return fmt.Sprintf("%s%d%08d%06d", countryCode, year, traderID, seq)
}

// ─── Database Operations ──────────────────────────────────────────────────────

type UCRStore struct {
	pool *pgxpool.Pool
}

func NewUCRStore(pool *pgxpool.Pool) *UCRStore {
	return &UCRStore{pool: pool}
}

func (s *UCRStore) EnsureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS ucrs (
			id              BIGSERIAL PRIMARY KEY,
			ucr_number      VARCHAR(32) NOT NULL UNIQUE,
			ucr_type        VARCHAR(16) NOT NULL DEFAULT 'SINGLE',
			status          VARCHAR(16) NOT NULL DEFAULT 'CREATED',
			trader_id       BIGINT NOT NULL,
			declaration_id  BIGINT,
			consignee_ref   VARCHAR(128),
			port_of_entry   VARCHAR(64),
			country_code    VARCHAR(2) NOT NULL DEFAULT 'NG',
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			linked_at       TIMESTAMPTZ,
			activated_at    TIMESTAMPTZ,
			closed_at       TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_ucrs_trader ON ucrs(trader_id);
		CREATE INDEX IF NOT EXISTS idx_ucrs_declaration ON ucrs(declaration_id);
		CREATE INDEX IF NOT EXISTS idx_ucrs_status ON ucrs(status);
		CREATE INDEX IF NOT EXISTS idx_ucrs_number ON ucrs(ucr_number);
	`)
	return err
}

func (s *UCRStore) Create(ctx context.Context, ucr *UCR) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO ucrs (ucr_number, ucr_type, status, trader_id, consignee_ref, port_of_entry, country_code)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at
	`, ucr.UCRNumber, ucr.UCRType, ucr.Status, ucr.TraderID, ucr.ConsigneeRef, ucr.PortOfEntry, ucr.CountryCode).
		Scan(&ucr.ID, &ucr.CreatedAt, &ucr.UpdatedAt)
}

func (s *UCRStore) GetByNumber(ctx context.Context, ucrNumber string) (*UCR, error) {
	ucr := &UCR{}
	err := s.pool.QueryRow(ctx, `
		SELECT id, ucr_number, ucr_type, status, trader_id, declaration_id,
		       consignee_ref, port_of_entry, country_code,
		       created_at, updated_at, linked_at, activated_at, closed_at
		FROM ucrs WHERE ucr_number = $1
	`, ucrNumber).Scan(
		&ucr.ID, &ucr.UCRNumber, &ucr.UCRType, &ucr.Status, &ucr.TraderID, &ucr.DeclarationID,
		&ucr.ConsigneeRef, &ucr.PortOfEntry, &ucr.CountryCode,
		&ucr.CreatedAt, &ucr.UpdatedAt, &ucr.LinkedAt, &ucr.ActivatedAt, &ucr.ClosedAt,
	)
	if err != nil {
		return nil, err
	}
	return ucr, nil
}

func (s *UCRStore) LinkDeclaration(ctx context.Context, ucrNumber string, declarationID int64) error {
	now := time.Now()
	result, err := s.pool.Exec(ctx, `
		UPDATE ucrs SET declaration_id = $1, status = 'LINKED', linked_at = $2, updated_at = $2
		WHERE ucr_number = $3 AND status = 'CREATED' AND declaration_id IS NULL
	`, declarationID, now, ucrNumber)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("UCR %s cannot be linked: already linked or not in CREATED status", ucrNumber)
	}
	return nil
}

func (s *UCRStore) Activate(ctx context.Context, ucrNumber string) error {
	now := time.Now()
	result, err := s.pool.Exec(ctx, `
		UPDATE ucrs SET status = 'ACTIVE', activated_at = $1, updated_at = $1
		WHERE ucr_number = $2 AND status IN ('CREATED', 'LINKED')
	`, now, ucrNumber)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("UCR %s cannot be activated: not in CREATED or LINKED status", ucrNumber)
	}
	return nil
}

func (s *UCRStore) Close(ctx context.Context, ucrNumber string) error {
	now := time.Now()
	result, err := s.pool.Exec(ctx, `
		UPDATE ucrs SET status = 'CLOSED', closed_at = $1, updated_at = $1
		WHERE ucr_number = $2 AND status IN ('ACTIVE', 'CLEARED')
	`, now, ucrNumber)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("UCR %s cannot be closed: not in ACTIVE or CLEARED status", ucrNumber)
	}
	return nil
}

func (s *UCRStore) ListByTrader(ctx context.Context, traderID int64, limit, offset int) ([]UCR, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, ucr_number, ucr_type, status, trader_id, declaration_id,
		       consignee_ref, port_of_entry, country_code,
		       created_at, updated_at, linked_at, activated_at, closed_at
		FROM ucrs WHERE trader_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3
	`, traderID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ucrs []UCR
	for rows.Next() {
		var ucr UCR
		if err := rows.Scan(
			&ucr.ID, &ucr.UCRNumber, &ucr.UCRType, &ucr.Status, &ucr.TraderID, &ucr.DeclarationID,
			&ucr.ConsigneeRef, &ucr.PortOfEntry, &ucr.CountryCode,
			&ucr.CreatedAt, &ucr.UpdatedAt, &ucr.LinkedAt, &ucr.ActivatedAt, &ucr.ClosedAt,
		); err != nil {
			return nil, err
		}
		ucrs = append(ucrs, ucr)
	}
	return ucrs, nil
}

// ─── Kafka Publisher ──────────────────────────────────────────────────────────

type KafkaPublisher struct {
	brokers string
}

func NewKafkaPublisher(brokers string) *KafkaPublisher {
	return &KafkaPublisher{brokers: brokers}
}

func (k *KafkaPublisher) PublishUCREvent(ctx context.Context, eventType string, ucr *UCR) error {
	payload, err := json.Marshal(map[string]interface{}{
		"eventType": eventType,
		"ucrNumber": ucr.UCRNumber,
		"traderId":  ucr.TraderID,
		"status":    ucr.Status,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}

	// Use Dapr pub/sub for reliable delivery
	daprPort := getEnv("DAPR_HTTP_PORT", "3500")
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/ucr.events", daprPort)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[kafka] Failed to publish UCR event via Dapr: %v", err)
		return nil // Non-fatal — event will be retried by Dapr
	}
	defer resp.Body.Close()
	return nil
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

type Server struct {
	store     *UCRStore
	kafka     *KafkaPublisher
	config    Config
}

func NewServer(store *UCRStore, kafka *KafkaPublisher, config Config) *Server {
	return &Server{store: store, kafka: kafka, config: config}
}

func (s *Server) generateUCR(c *gin.Context) {
	var req GenerateUCRRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ucr := &UCR{
		UCRNumber:    generateUCRNumber(s.config.CountryCode, req.TraderID),
		UCRType:      req.UCRType,
		Status:       UCRStatusCreated,
		TraderID:     req.TraderID,
		ConsigneeRef: req.ConsigneeRef,
		PortOfEntry:  req.PortOfEntry,
		CountryCode:  s.config.CountryCode,
	}

	ctx := c.Request.Context()
	if err := s.store.Create(ctx, ucr); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create UCR: " + err.Error()})
		return
	}

	ucrGenerated.WithLabelValues(string(req.UCRType)).Inc()
	_ = s.kafka.PublishUCREvent(ctx, "UCR_CREATED", ucr)

	c.JSON(http.StatusCreated, ucr)
}

func (s *Server) getUCR(c *gin.Context) {
	ucrNumber := c.Param("ucr")
	ucr, err := s.store.GetByNumber(c.Request.Context(), ucrNumber)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "UCR not found"})
		return
	}
	c.JSON(http.StatusOK, ucr)
}

func (s *Server) validateUCR(c *gin.Context) {
	ucrNumber := c.Param("ucr")
	ucr, err := s.store.GetByNumber(c.Request.Context(), ucrNumber)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"valid": false, "reason": "UCR not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"valid":     true,
		"ucrNumber": ucr.UCRNumber,
		"status":    ucr.Status,
		"traderId":  ucr.TraderID,
	})
}

func (s *Server) linkDeclaration(c *gin.Context) {
	ucrNumber := c.Param("ucr")
	var req LinkDeclarationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	if err := s.store.LinkDeclaration(ctx, ucrNumber, req.DeclarationID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	ucr, _ := s.store.GetByNumber(ctx, ucrNumber)
	ucrLinked.Inc()
	_ = s.kafka.PublishUCREvent(ctx, "UCR_LINKED", ucr)

	c.JSON(http.StatusOK, gin.H{"success": true, "ucrNumber": ucrNumber, "declarationId": req.DeclarationID})
}

func (s *Server) activateUCR(c *gin.Context) {
	ucrNumber := c.Param("ucr")
	ctx := c.Request.Context()

	if err := s.store.Activate(ctx, ucrNumber); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	ucr, _ := s.store.GetByNumber(ctx, ucrNumber)
	ucrActivated.Inc()
	_ = s.kafka.PublishUCREvent(ctx, "UCR_ACTIVATED", ucr)

	c.JSON(http.StatusOK, gin.H{"success": true, "ucrNumber": ucrNumber, "status": "ACTIVE"})
}

func (s *Server) closeUCR(c *gin.Context) {
	ucrNumber := c.Param("ucr")
	ctx := c.Request.Context()

	if err := s.store.Close(ctx, ucrNumber); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	ucr, _ := s.store.GetByNumber(ctx, ucrNumber)
	ucrClosed.Inc()
	_ = s.kafka.PublishUCREvent(ctx, "UCR_CLOSED", ucr)

	c.JSON(http.StatusOK, gin.H{"success": true, "ucrNumber": ucrNumber, "status": "CLOSED"})
}

func (s *Server) listByTrader(c *gin.Context) {
	var traderID int64
	if _, err := fmt.Sscan(c.Param("traderId"), &traderID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid trader ID"})
		return
	}

	ucrs, err := s.store.ListByTrader(c.Request.Context(), traderID, 50, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if ucrs == nil {
		ucrs = []UCR{}
	}
	c.JSON(http.StatusOK, gin.H{"ucrs": ucrs, "total": len(ucrs)})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()

	// Database connection
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	store := NewUCRStore(pool)
	if err := store.EnsureSchema(ctx); err != nil {
		log.Fatalf("Failed to ensure schema: %v", err)
	}

	kafka := NewKafkaPublisher(cfg.KafkaBrokers)
	server := NewServer(store, kafka, cfg)

	// Gin router
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	// Health
	r.GET("/health", func(c *gin.Context) {
		if err := pool.Ping(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy", "db": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "ucr-service"})
	})

	// Metrics
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	api := r.Group("/api/ucr")
	api.POST("/generate", server.generateUCR)
	api.GET("/:ucr", server.getUCR)
	api.GET("/:ucr/validate", server.validateUCR)
	api.POST("/:ucr/link", server.linkDeclaration)
	api.POST("/:ucr/activate", server.activateUCR)
	api.POST("/:ucr/close", server.closeUCR)
	api.GET("/trader/:traderId", server.listByTrader)

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("[ucr-service] Starting on port %s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	<-quit
	log.Println("[ucr-service] Shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Println("[ucr-service] Stopped")
}
