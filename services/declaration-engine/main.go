// declaration-engine — TradeGateway NGSWTP
//
// Go gRPC microservice implementing the declaration lifecycle:
//   create → submitted → assessed → cleared | rejected
//
// Middleware integrations:
//   - PostgreSQL (pgx/v5) — persistent declaration storage
//   - Kafka (segmentio/kafka-go) — domain event publishing
//   - Redis (go-redis/v9) — idempotency keys and rate limiting
//   - Temporal (go.temporal.io/sdk) — durable workflow triggers for YELLOW/RED lanes
//   - Prometheus — metrics on :9090/metrics
//
// Environment variables:
//   GRPC_PORT        (default: 50051)
//   DATABASE_URL     PostgreSQL connection string
//   KAFKA_BROKERS    comma-separated broker list
//   REDIS_URL        Redis connection URL
//   TEMPORAL_ADDRESS Temporal frontend address
//   TEMPORAL_NAMESPACE (default: tradegateway)

package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/segmentio/kafka-go"
	"go.temporal.io/sdk/client"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	declarationv1 "github.com/tradegateway/ngswtp/proto/declaration/v1"
)

// ─── Metrics ─────────────────────────────────────────────────────────────────

var (
	declarationsCreated = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "declarations_created_total",
		Help: "Total declarations created",
	})
	declarationsSubmitted = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "declarations_submitted_total",
		Help: "Total declarations submitted",
	})
	declarationsCleared = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "declarations_cleared_total",
		Help: "Total declarations cleared",
	})
	declarationsRejected = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "declarations_rejected_total",
		Help: "Total declarations rejected",
	})
	grpcRequestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grpc_request_duration_seconds",
		Help:    "gRPC request duration",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "status"})
)

func init() {
	prometheus.MustRegister(declarationsCreated, declarationsSubmitted,
		declarationsCleared, declarationsRejected, grpcRequestDuration)
}

// ─── Domain types ─────────────────────────────────────────────────────────────

type DeclarationStatus string

const (
	StatusDraft      DeclarationStatus = "draft"
	StatusSubmitted  DeclarationStatus = "submitted"
	StatusAssessed   DeclarationStatus = "assessed"
	StatusCleared    DeclarationStatus = "cleared"
	StatusRejected   DeclarationStatus = "rejected"
	StatusAmended    DeclarationStatus = "amended"
)

// Valid state machine transitions
var allowedTransitions = map[DeclarationStatus][]DeclarationStatus{
	StatusDraft:     {StatusSubmitted},
	StatusSubmitted: {StatusAssessed, StatusRejected},
	StatusAssessed:  {StatusCleared, StatusRejected},
	StatusCleared:   {StatusAmended},
	StatusRejected:  {},
}

func canTransition(from, to DeclarationStatus) bool {
	allowed, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}

// ─── Server ───────────────────────────────────────────────────────────────────

type declarationServer struct {
	declarationv1.UnimplementedDeclarationServiceServer
	db       *pgxpool.Pool
	redis    *redis.Client
	kafka    *kafka.Writer
	temporal client.Client
	logger   zerolog.Logger
}

func newDeclarationServer(
	db *pgxpool.Pool,
	rdb *redis.Client,
	kw *kafka.Writer,
	tc client.Client,
) *declarationServer {
	return &declarationServer{
		db:       db,
		redis:    rdb,
		kafka:    kw,
		temporal: tc,
		logger:   log.With().Str("service", "declaration-engine").Logger(),
	}
}

// generateUCR produces a WCO-compliant Unique Consignment Reference.
// Format: NG + YYYYMMDD + 8-char random hex
func generateUCR() string {
	b := make([]byte, 4)
	rand.Read(b)
	return fmt.Sprintf("NG%s%s", time.Now().UTC().Format("20060102"), hex.EncodeToString(b))
}

// publishEvent sends a domain event to Kafka.
func (s *declarationServer) publishEvent(ctx context.Context, topic, eventType, declarationID string, payload []byte) {
	msg := kafka.Message{
		Topic: topic,
		Key:   []byte(declarationID),
		Value: payload,
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte(eventType)},
			{Key: "service", Value: []byte("declaration-engine")},
			{Key: "timestamp", Value: []byte(time.Now().UTC().Format(time.RFC3339))},
		},
	}
	if err := s.kafka.WriteMessages(ctx, msg); err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("Failed to publish Kafka event")
	}
}

// ─── gRPC Handlers ────────────────────────────────────────────────────────────

func (s *declarationServer) CreateDeclaration(ctx context.Context, req *declarationv1.CreateDeclarationRequest) (*declarationv1.DeclarationResponse, error) {
	start := time.Now()
	defer func() {
		grpcRequestDuration.WithLabelValues("CreateDeclaration", "OK").Observe(time.Since(start).Seconds())
	}()

	if req.TraderId == "" || req.HsCode == "" {
		return nil, status.Error(codes.InvalidArgument, "trader_id and hs_code are required")
	}

	// Validate HS code format (6-10 digits)
	hsCode := strings.ReplaceAll(req.HsCode, ".", "")
	if len(hsCode) < 6 || len(hsCode) > 10 {
		return nil, status.Error(codes.InvalidArgument, "hs_code must be 6-10 digits")
	}

	id := uuid.New().String()
	ucr := generateUCR()
	now := time.Now().UTC()

	_, err := s.db.Exec(ctx, `
		INSERT INTO declarations (
			id, ucr, trader_id, hs_code, goods_description,
			country_of_origin, port_of_entry, gross_weight, net_weight,
			number_of_packages, invoice_value, invoice_currency,
			declaration_type, status, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
		)`,
		id, ucr, req.TraderId, req.HsCode, req.GoodsDescription,
		req.CountryOfOrigin, req.PortOfEntry, req.GrossWeight, req.NetWeight,
		req.NumberOfPackages, req.InvoiceValue, req.InvoiceCurrency,
		req.DeclarationType, string(StatusDraft), now, now,
	)
	if err != nil {
		s.logger.Error().Err(err).Msg("Failed to insert declaration")
		return nil, status.Error(codes.Internal, "failed to create declaration")
	}

	declarationsCreated.Inc()
	s.logger.Info().Str("id", id).Str("ucr", ucr).Str("trader_id", req.TraderId).Msg("Declaration created")

	return &declarationv1.DeclarationResponse{
		Id:              id,
		Ucr:             ucr,
		TraderId:        req.TraderId,
		Status:          string(StatusDraft),
		HsCode:          req.HsCode,
		GoodsDescription: req.GoodsDescription,
		CountryOfOrigin: req.CountryOfOrigin,
		PortOfEntry:     req.PortOfEntry,
		InvoiceValue:    req.InvoiceValue,
		InvoiceCurrency: req.InvoiceCurrency,
		DeclarationType: req.DeclarationType,
		CreatedAt:       timestamppb.New(now),
		UpdatedAt:       timestamppb.New(now),
	}, nil
}

func (s *declarationServer) SubmitDeclaration(ctx context.Context, req *declarationv1.SubmitDeclarationRequest) (*declarationv1.DeclarationResponse, error) {
	start := time.Now()
	defer func() {
		grpcRequestDuration.WithLabelValues("SubmitDeclaration", "OK").Observe(time.Since(start).Seconds())
	}()

	// Idempotency check via Redis
	idempKey := fmt.Sprintf("submit:%s", req.DeclarationId)
	if set, _ := s.redis.SetNX(ctx, idempKey, "1", 30*time.Second).Result(); !set {
		// Already submitted — return current state
		return s.GetDeclaration(ctx, &declarationv1.GetDeclarationRequest{
			DeclarationId: req.DeclarationId,
			RequesterId:   req.TraderId,
		})
	}

	// Fetch current declaration
	var currentStatus string
	var traderID string
	err := s.db.QueryRow(ctx,
		`SELECT status, trader_id FROM declarations WHERE id = $1`,
		req.DeclarationId,
	).Scan(&currentStatus, &traderID)
	if err != nil {
		return nil, status.Error(codes.NotFound, "declaration not found")
	}

	// Ownership check
	if traderID != req.TraderId {
		return nil, status.Error(codes.PermissionDenied, "declaration does not belong to this trader")
	}

	// State machine validation
	if !canTransition(DeclarationStatus(currentStatus), StatusSubmitted) {
		return nil, status.Errorf(codes.FailedPrecondition,
			"cannot submit declaration in status %s", currentStatus)
	}

	now := time.Now().UTC()
	_, err = s.db.Exec(ctx,
		`UPDATE declarations SET status = $1, updated_at = $2 WHERE id = $3`,
		string(StatusSubmitted), now, req.DeclarationId,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to update declaration status")
	}

	declarationsSubmitted.Inc()

	// Publish DECLARATION_SUBMITTED event to Kafka
	payload := fmt.Sprintf(`{"declaration_id":"%s","trader_id":"%s","timestamp":"%s"}`,
		req.DeclarationId, req.TraderId, now.Format(time.RFC3339))
	s.publishEvent(ctx, "declaration-events", "DECLARATION_SUBMITTED", req.DeclarationId, []byte(payload))

	s.logger.Info().Str("id", req.DeclarationId).Msg("Declaration submitted")

	return s.GetDeclaration(ctx, &declarationv1.GetDeclarationRequest{
		DeclarationId: req.DeclarationId,
		RequesterId:   req.TraderId,
	})
}

func (s *declarationServer) AssessDeclaration(ctx context.Context, req *declarationv1.AssessDeclarationRequest) (*declarationv1.AssessmentResponse, error) {
	start := time.Now()
	defer func() {
		grpcRequestDuration.WithLabelValues("AssessDeclaration", "OK").Observe(time.Since(start).Seconds())
	}()

	var currentStatus string
	err := s.db.QueryRow(ctx,
		`SELECT status FROM declarations WHERE id = $1`,
		req.DeclarationId,
	).Scan(&currentStatus)
	if err != nil {
		return nil, status.Error(codes.NotFound, "declaration not found")
	}

	if !canTransition(DeclarationStatus(currentStatus), StatusAssessed) {
		return nil, status.Errorf(codes.FailedPrecondition,
			"cannot assess declaration in status %s", currentStatus)
	}

	now := time.Now().UTC()
	_, err = s.db.Exec(ctx, `
		UPDATE declarations
		SET status = $1, risk_score = $2, risk_lane = $3,
		    ai_explanation = $4, updated_at = $5
		WHERE id = $6`,
		string(StatusAssessed), req.RiskScore, req.RiskLane,
		req.AiExplanation, now, req.DeclarationId,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to assess declaration")
	}

	workflowTriggered := false

	// Trigger Temporal workflow for YELLOW and RED lanes
	if s.temporal != nil && (req.RiskLane == "YELLOW" || req.RiskLane == "RED") {
		workflowOptions := client.StartWorkflowOptions{
			ID:        fmt.Sprintf("declaration-review-%s", req.DeclarationId),
			TaskQueue: "declaration-review",
		}
		_, err = s.temporal.ExecuteWorkflow(ctx, workflowOptions,
			"DeclarationReviewWorkflow",
			map[string]interface{}{
				"declaration_id": req.DeclarationId,
				"risk_lane":      req.RiskLane,
				"risk_score":     req.RiskScore,
			},
		)
		if err != nil {
			s.logger.Warn().Err(err).Str("id", req.DeclarationId).Msg("Failed to trigger Temporal workflow")
		} else {
			workflowTriggered = true
		}
	}

	// Publish DECLARATION_ASSESSED event
	payload := fmt.Sprintf(`{"declaration_id":"%s","risk_score":%d,"risk_lane":"%s","timestamp":"%s"}`,
		req.DeclarationId, req.RiskScore, req.RiskLane, now.Format(time.RFC3339))
	s.publishEvent(ctx, "declaration-events", "DECLARATION_ASSESSED", req.DeclarationId, []byte(payload))

	s.logger.Info().
		Str("id", req.DeclarationId).
		Int32("risk_score", req.RiskScore).
		Str("risk_lane", req.RiskLane).
		Bool("workflow_triggered", workflowTriggered).
		Msg("Declaration assessed")

	return &declarationv1.AssessmentResponse{
		DeclarationId:    req.DeclarationId,
		RiskScore:        req.RiskScore,
		RiskLane:         req.RiskLane,
		AiExplanation:    req.AiExplanation,
		RiskFactors:      req.RiskFactors,
		WorkflowTriggered: workflowTriggered,
	}, nil
}

func (s *declarationServer) ClearDeclaration(ctx context.Context, req *declarationv1.ClearDeclarationRequest) (*declarationv1.DeclarationResponse, error) {
	start := time.Now()
	defer func() {
		grpcRequestDuration.WithLabelValues("ClearDeclaration", "OK").Observe(time.Since(start).Seconds())
	}()

	var currentStatus string
	err := s.db.QueryRow(ctx,
		`SELECT status FROM declarations WHERE id = $1`,
		req.DeclarationId,
	).Scan(&currentStatus)
	if err != nil {
		return nil, status.Error(codes.NotFound, "declaration not found")
	}

	if !canTransition(DeclarationStatus(currentStatus), StatusCleared) {
		return nil, status.Errorf(codes.FailedPrecondition,
			"cannot clear declaration in status %s", currentStatus)
	}

	now := time.Now().UTC()
	_, err = s.db.Exec(ctx, `
		UPDATE declarations
		SET status = $1, clearance_code = $2, cleared_by = $3,
		    cleared_at = $4, updated_at = $5
		WHERE id = $6`,
		string(StatusCleared), req.ClearanceCode, req.OfficerId, now, now, req.DeclarationId,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to clear declaration")
	}

	declarationsCleared.Inc()

	// Publish DECLARATION_CLEARED event
	payload := fmt.Sprintf(`{"declaration_id":"%s","officer_id":"%s","clearance_code":"%s","timestamp":"%s"}`,
		req.DeclarationId, req.OfficerId, req.ClearanceCode, now.Format(time.RFC3339))
	s.publishEvent(ctx, "declaration-events", "DECLARATION_CLEARED", req.DeclarationId, []byte(payload))

	s.logger.Info().Str("id", req.DeclarationId).Str("officer", req.OfficerId).Msg("Declaration cleared")

	return s.GetDeclaration(ctx, &declarationv1.GetDeclarationRequest{
		DeclarationId: req.DeclarationId,
	})
}

func (s *declarationServer) GetDeclaration(ctx context.Context, req *declarationv1.GetDeclarationRequest) (*declarationv1.DeclarationResponse, error) {
	var d declarationv1.DeclarationResponse
	var createdAt, updatedAt time.Time

	err := s.db.QueryRow(ctx, `
		SELECT id, COALESCE(declaration_number, ''), COALESCE(ucr, ''),
		       trader_id, status, hs_code, goods_description,
		       country_of_origin, port_of_entry, invoice_value, invoice_currency,
		       declaration_type, COALESCE(risk_score, 0), COALESCE(risk_lane, ''),
		       COALESCE(ai_explanation, ''), created_at, updated_at
		FROM declarations WHERE id = $1`,
		req.DeclarationId,
	).Scan(
		&d.Id, &d.DeclarationNumber, &d.Ucr,
		&d.TraderId, &d.Status, &d.HsCode, &d.GoodsDescription,
		&d.CountryOfOrigin, &d.PortOfEntry, &d.InvoiceValue, &d.InvoiceCurrency,
		&d.DeclarationType, &d.RiskScore, &d.RiskLane,
		&d.AiExplanation, &createdAt, &updatedAt,
	)
	if err != nil {
		return nil, status.Error(codes.NotFound, "declaration not found")
	}

	d.CreatedAt = timestamppb.New(createdAt)
	d.UpdatedAt = timestamppb.New(updatedAt)
	return &d, nil
}

func (s *declarationServer) ListDeclarations(ctx context.Context, req *declarationv1.ListDeclarationsRequest) (*declarationv1.ListDeclarationsResponse, error) {
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := int(req.Offset)

	query := `
		SELECT id, COALESCE(declaration_number, ''), COALESCE(ucr, ''),
		       trader_id, status, hs_code, goods_description,
		       country_of_origin, port_of_entry, invoice_value, invoice_currency,
		       declaration_type, COALESCE(risk_score, 0), COALESCE(risk_lane, ''),
		       COALESCE(ai_explanation, ''), created_at, updated_at
		FROM declarations WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if req.TraderId != "" {
		query += fmt.Sprintf(" AND trader_id = $%d", argIdx)
		args = append(args, req.TraderId)
		argIdx++
	}
	if req.StatusFilter != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, req.StatusFilter)
		argIdx++
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to list declarations")
	}
	defer rows.Close()

	var declarations []*declarationv1.DeclarationResponse
	for rows.Next() {
		var d declarationv1.DeclarationResponse
		var createdAt, updatedAt time.Time
		if err := rows.Scan(
			&d.Id, &d.DeclarationNumber, &d.Ucr,
			&d.TraderId, &d.Status, &d.HsCode, &d.GoodsDescription,
			&d.CountryOfOrigin, &d.PortOfEntry, &d.InvoiceValue, &d.InvoiceCurrency,
			&d.DeclarationType, &d.RiskScore, &d.RiskLane,
			&d.AiExplanation, &createdAt, &updatedAt,
		); err != nil {
			continue
		}
		d.CreatedAt = timestamppb.New(createdAt)
		d.UpdatedAt = timestamppb.New(updatedAt)
		declarations = append(declarations, &d)
	}

	return &declarationv1.ListDeclarationsResponse{
		Declarations: declarations,
		Total:        int32(len(declarations)),
	}, nil
}

func (s *declarationServer) UpdateDeclarationStatus(ctx context.Context, req *declarationv1.UpdateStatusRequest) (*declarationv1.DeclarationResponse, error) {
	var currentStatus string
	err := s.db.QueryRow(ctx,
		`SELECT status FROM declarations WHERE id = $1`, req.DeclarationId,
	).Scan(&currentStatus)
	if err != nil {
		return nil, status.Error(codes.NotFound, "declaration not found")
	}

	if !canTransition(DeclarationStatus(currentStatus), DeclarationStatus(req.NewStatus)) {
		return nil, status.Errorf(codes.FailedPrecondition,
			"invalid transition from %s to %s", currentStatus, req.NewStatus)
	}

	now := time.Now().UTC()
	_, err = s.db.Exec(ctx,
		`UPDATE declarations SET status = $1, updated_at = $2 WHERE id = $3`,
		req.NewStatus, now, req.DeclarationId,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to update status")
	}

	if req.NewStatus == string(StatusRejected) {
		declarationsRejected.Inc()
	}

	return s.GetDeclaration(ctx, &declarationv1.GetDeclarationRequest{
		DeclarationId: req.DeclarationId,
	})
}

func (s *declarationServer) GetDeclarationStats(ctx context.Context, req *declarationv1.GetStatsRequest) (*declarationv1.DeclarationStatsResponse, error) {
	query := `
		SELECT
			COUNT(*) as total,
			COUNT(*) FILTER (WHERE risk_lane = 'GREEN') as green,
			COUNT(*) FILTER (WHERE risk_lane = 'YELLOW') as yellow,
			COUNT(*) FILTER (WHERE risk_lane = 'RED') as red,
			COUNT(*) FILTER (WHERE status = 'cleared') as cleared,
			COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
			COUNT(*) FILTER (WHERE status IN ('submitted', 'assessed')) as pending
		FROM declarations`

	args := []interface{}{}
	if req.TraderId != "" {
		query += " WHERE trader_id = $1"
		args = append(args, req.TraderId)
	}

	var stats declarationv1.DeclarationStatsResponse
	err := s.db.QueryRow(ctx, query, args...).Scan(
		&stats.Total, &stats.Green, &stats.Yellow, &stats.Red,
		&stats.Cleared, &stats.Rejected, &stats.Pending,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get stats")
	}

	return &stats, nil
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	// Structured logging
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// PostgreSQL
	dbURL := getEnv("DATABASE_URL", "postgres://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to PostgreSQL")
	}
	defer db.Close()

	if err := db.Ping(ctx); err != nil {
		log.Fatal().Err(err).Msg("PostgreSQL ping failed")
	}
	log.Info().Msg("PostgreSQL connected")

	// Redis
	redisURL := getEnv("REDIS_URL", "redis://localhost:6379")
	redisOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Invalid REDIS_URL")
	}
	rdb := redis.NewClient(redisOpts)
	defer rdb.Close()

	// Kafka writer
	brokers := strings.Split(getEnv("KAFKA_BROKERS", "localhost:9092"), ",")
	kw := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.LeastBytes{},
		RequiredAcks: kafka.RequireOne,
		Async:        false,
	}
	defer kw.Close()

	// Temporal client (optional — gracefully skip if unavailable)
	var temporalClient client.Client
	temporalAddr := getEnv("TEMPORAL_ADDRESS", "localhost:7233")
	temporalNS := getEnv("TEMPORAL_NAMESPACE", "tradegateway")
	temporalClient, err = client.Dial(client.Options{
		HostPort:  temporalAddr,
		Namespace: temporalNS,
	})
	if err != nil {
		log.Warn().Err(err).Msg("Temporal unavailable — workflow triggers disabled")
		temporalClient = nil
	} else {
		defer temporalClient.Close()
		log.Info().Str("namespace", temporalNS).Msg("Temporal connected")
	}

	// gRPC server
	grpcPort := getEnv("GRPC_PORT", "50051")
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatal().Err(err).Str("port", grpcPort).Msg("Failed to listen")
	}

	grpcServer := grpc.NewServer(
		grpc.ChainUnaryInterceptor(
			loggingInterceptor,
			recoveryInterceptor,
		),
	)

	srv := newDeclarationServer(db, rdb, kw, temporalClient)
	declarationv1.RegisterDeclarationServiceServer(grpcServer, srv)
	grpc_health_v1.RegisterHealthServer(grpcServer, health.NewServer())
	reflection.Register(grpcServer)

	// Prometheus metrics server
	go func() {
		http.Handle("/metrics", promhttp.Handler())
		http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok","service":"declaration-engine"}`))
		})
		metricsPort := getEnv("METRICS_PORT", "9090")
		log.Info().Str("port", metricsPort).Msg("Metrics server starting")
		if err := http.ListenAndServe(":"+metricsPort, nil); err != nil {
			log.Error().Err(err).Msg("Metrics server error")
		}
	}()

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		log.Info().Msg("Shutting down declaration-engine...")
		grpcServer.GracefulStop()
		cancel()
	}()

	log.Info().Str("port", grpcPort).Msg("declaration-engine gRPC server starting")
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatal().Err(err).Msg("gRPC server failed")
	}
}

// ─── Interceptors ─────────────────────────────────────────────────────────────

func loggingInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	start := time.Now()
	resp, err := handler(ctx, req)
	log.Info().
		Str("method", info.FullMethod).
		Dur("duration", time.Since(start)).
		Err(err).
		Msg("gRPC request")
	return resp, err
}

func recoveryInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Str("method", info.FullMethod).Msg("Recovered from panic")
			err = status.Errorf(codes.Internal, "internal server error")
		}
	}()
	return handler(ctx, req)
}
