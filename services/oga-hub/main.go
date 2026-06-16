// oga-hub — TradeGateway NGSWTP
//
// Go gRPC microservice for multi-agency workflow orchestration.
// Implements the joint inspection model: no cargo release until ALL
// required OGAs have approved their permits.
//
// Middleware integrations:
//   - PostgreSQL (pgx/v5) — permit and agency storage
//   - Kafka (segmentio/kafka-go) — OGA_PERMIT_APPROVED/REJECTED events
//   - Redis (go-redis/v9) — SLA deadline tracking, agency status cache
//   - Prometheus — metrics on :9092/metrics
//
// Environment variables:
//   GRPC_PORT     (default: 50053)
//   DATABASE_URL
//   KAFKA_BROKERS
//   REDIS_URL

package main

import (
	"context"
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
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	ogav1 "github.com/tradegateway/ngswtp/proto/oga/v1"
)

// ─── Metrics ─────────────────────────────────────────────────────────────────

var (
	permitsSubmitted = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "oga_permits_submitted_total",
		Help: "Total permit requests submitted to OGAs",
	})
	permitsApproved = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "oga_permits_approved_total",
		Help: "Permits approved per agency",
	}, []string{"agency_code"})
	permitsRejected = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "oga_permits_rejected_total",
		Help: "Permits rejected per agency",
	}, []string{"agency_code"})
	slaBreaches = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "oga_sla_breaches_total",
		Help: "SLA breaches per agency",
	}, []string{"agency_code"})
)

func init() {
	prometheus.MustRegister(permitsSubmitted, permitsApproved, permitsRejected, slaBreaches)
}

// ─── Server ───────────────────────────────────────────────────────────────────

type ogaServer struct {
	ogav1.UnimplementedOGAServiceServer
	db     *pgxpool.Pool
	redis  *redis.Client
	kafka  *kafka.Writer
	logger zerolog.Logger
}

func (s *ogaServer) SubmitPermitRequest(ctx context.Context, req *ogav1.PermitRequest) (*ogav1.PermitResponse, error) {
	if req.DeclarationId == "" || req.AgencyCode == "" || req.PermitType == "" {
		return nil, status.Error(codes.InvalidArgument, "declaration_id, agency_code, and permit_type are required")
	}

	// Fetch agency SLA hours
	var slaHours int
	err := s.db.QueryRow(ctx,
		`SELECT sla_hours FROM oga_agencies WHERE code = $1 AND is_active = true`,
		req.AgencyCode,
	).Scan(&slaHours)
	if err != nil {
		slaHours = 48 // default SLA
	}

	id := uuid.New().String()
	now := time.Now().UTC()
	slaDeadline := now.Add(time.Duration(slaHours) * time.Hour)

	_, err = s.db.Exec(ctx, `
		INSERT INTO oga_permits (
			id, declaration_id, trader_id, agency_code, permit_type,
			status, sla_deadline, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8)`,
		id, req.DeclarationId, req.TraderId, req.AgencyCode, req.PermitType,
		slaDeadline, now, now,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to create permit request")
	}

	// Cache SLA deadline in Redis for fast SLA monitoring
	slaKey := fmt.Sprintf("oga_sla:%s:%s", req.DeclarationId, req.AgencyCode)
	s.redis.Set(ctx, slaKey, slaDeadline.Unix(), time.Duration(slaHours+1)*time.Hour)

	permitsSubmitted.Inc()

	// Publish permit request event to Kafka for agency notification
	payload := fmt.Sprintf(`{"permit_id":"%s","declaration_id":"%s","agency_code":"%s","permit_type":"%s","sla_deadline":"%s","timestamp":"%s"}`,
		id, req.DeclarationId, req.AgencyCode, req.PermitType,
		slaDeadline.Format(time.RFC3339), now.Format(time.RFC3339))
	s.kafka.WriteMessages(ctx, kafka.Message{
		Topic: "oga-events",
		Key:   []byte(req.DeclarationId),
		Value: []byte(payload),
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte("OGA_PERMIT_REQUESTED")},
			{Key: "agency_code", Value: []byte(req.AgencyCode)},
		},
	})

	s.logger.Info().Str("permit_id", id).Str("agency", req.AgencyCode).Msg("Permit request submitted")

	return &ogav1.PermitResponse{
		Id:            id,
		DeclarationId: req.DeclarationId,
		AgencyCode:    req.AgencyCode,
		PermitType:    req.PermitType,
		Status:        "PENDING",
		SlaDeadlineMs: slaDeadline.UnixMilli(),
		SlaBreached:   false,
		CreatedAt:     timestamppb.New(now),
		UpdatedAt:     timestamppb.New(now),
	}, nil
}

func (s *ogaServer) ApprovePermit(ctx context.Context, req *ogav1.ApprovePermitRequest) (*ogav1.PermitResponse, error) {
	if req.PermitId == "" || req.OfficerId == "" {
		return nil, status.Error(codes.InvalidArgument, "permit_id and officer_id are required")
	}

	now := time.Now().UTC()
	var declarationID, agencyCode, permitType string
	var slaDeadline time.Time

	err := s.db.QueryRow(ctx,
		`SELECT declaration_id, agency_code, permit_type, sla_deadline FROM oga_permits WHERE id = $1`,
		req.PermitId,
	).Scan(&declarationID, &agencyCode, &permitType, &slaDeadline)
	if err != nil {
		return nil, status.Error(codes.NotFound, "permit not found")
	}

	slaBreached := now.After(slaDeadline)
	if slaBreached {
		slaBreaches.WithLabelValues(agencyCode).Inc()
	}

	_, err = s.db.Exec(ctx, `
		UPDATE oga_permits
		SET status = 'APPROVED', permit_number = $1, officer_id = $2,
		    valid_until = $3, notes = $4, sla_breached = $5, updated_at = $6
		WHERE id = $7`,
		req.PermitNumber, req.OfficerId, req.ValidUntil.AsTime(),
		req.Notes, slaBreached, now, req.PermitId,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to approve permit")
	}

	permitsApproved.WithLabelValues(agencyCode).Inc()

	// Publish OGA_PERMIT_APPROVED event
	payload := fmt.Sprintf(`{"permit_id":"%s","declaration_id":"%s","agency_code":"%s","officer_id":"%s","timestamp":"%s"}`,
		req.PermitId, declarationID, agencyCode, req.OfficerId, now.Format(time.RFC3339))
	s.kafka.WriteMessages(ctx, kafka.Message{
		Topic: "oga-events",
		Key:   []byte(declarationID),
		Value: []byte(payload),
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte("OGA_PERMIT_APPROVED")},
			{Key: "agency_code", Value: []byte(agencyCode)},
		},
	})

	// Check if all OGAs have now approved — trigger joint clearance if so
	s.checkJointInspectionComplete(ctx, declarationID)

	s.logger.Info().Str("permit_id", req.PermitId).Str("agency", agencyCode).Msg("Permit approved")

	return &ogav1.PermitResponse{
		Id:            req.PermitId,
		DeclarationId: declarationID,
		AgencyCode:    agencyCode,
		PermitType:    permitType,
		Status:        "APPROVED",
		PermitNumber:  req.PermitNumber,
		SlaBreached:   slaBreached,
		UpdatedAt:     timestamppb.New(now),
	}, nil
}

func (s *ogaServer) RejectPermit(ctx context.Context, req *ogav1.RejectPermitRequest) (*ogav1.PermitResponse, error) {
	if req.PermitId == "" || req.Reason == "" {
		return nil, status.Error(codes.InvalidArgument, "permit_id and reason are required")
	}

	now := time.Now().UTC()
	var declarationID, agencyCode, permitType string

	err := s.db.QueryRow(ctx,
		`SELECT declaration_id, agency_code, permit_type FROM oga_permits WHERE id = $1`,
		req.PermitId,
	).Scan(&declarationID, &agencyCode, &permitType)
	if err != nil {
		return nil, status.Error(codes.NotFound, "permit not found")
	}

	_, err = s.db.Exec(ctx, `
		UPDATE oga_permits
		SET status = 'REJECTED', officer_id = $1, rejection_reason = $2, updated_at = $3
		WHERE id = $4`,
		req.OfficerId, req.Reason, now, req.PermitId,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to reject permit")
	}

	permitsRejected.WithLabelValues(agencyCode).Inc()

	// Publish OGA_PERMIT_REJECTED event
	payload := fmt.Sprintf(`{"permit_id":"%s","declaration_id":"%s","agency_code":"%s","reason":"%s","timestamp":"%s"}`,
		req.PermitId, declarationID, agencyCode, req.Reason, now.Format(time.RFC3339))
	s.kafka.WriteMessages(ctx, kafka.Message{
		Topic: "oga-events",
		Key:   []byte(declarationID),
		Value: []byte(payload),
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte("OGA_PERMIT_REJECTED")},
			{Key: "agency_code", Value: []byte(agencyCode)},
		},
	})

	s.logger.Info().Str("permit_id", req.PermitId).Str("agency", agencyCode).Str("reason", req.Reason).Msg("Permit rejected")

	return &ogav1.PermitResponse{
		Id:            req.PermitId,
		DeclarationId: declarationID,
		AgencyCode:    agencyCode,
		PermitType:    permitType,
		Status:        "REJECTED",
		UpdatedAt:     timestamppb.New(now),
	}, nil
}

// checkJointInspectionComplete checks if all required OGAs have approved.
// If so, it publishes ALL_OGAS_CLEARED event to trigger cargo release.
func (s *ogaServer) checkJointInspectionComplete(ctx context.Context, declarationID string) {
	var total, approved int
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'APPROVED')
		FROM oga_permits WHERE declaration_id = $1`,
		declarationID,
	).Scan(&total, &approved)
	if err != nil || total == 0 {
		return
	}

	if total == approved {
		payload := fmt.Sprintf(`{"declaration_id":"%s","agencies_cleared":%d,"timestamp":"%s"}`,
			declarationID, approved, time.Now().UTC().Format(time.RFC3339))
		s.kafka.WriteMessages(ctx, kafka.Message{
			Topic: "oga-events",
			Key:   []byte(declarationID),
			Value: []byte(payload),
			Headers: []kafka.Header{
				{Key: "event_type", Value: []byte("ALL_OGAS_CLEARED")},
			},
		})
		s.logger.Info().Str("declaration_id", declarationID).Int("agencies", approved).Msg("All OGAs cleared — cargo release triggered")
	}
}

func (s *ogaServer) GetJointInspectionStatus(ctx context.Context, req *ogav1.JointInspectionRequest) (*ogav1.JointInspectionResponse, error) {
	rows, err := s.db.Query(ctx, `
		SELECT agency_code, status, COALESCE(officer_id, ''), updated_at
		FROM oga_permits WHERE declaration_id = $1`,
		req.DeclarationId,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get joint inspection status")
	}
	defer rows.Close()

	var statuses []*ogav1.JointInspectionStatus
	var pending, approved, rejected int32
	for rows.Next() {
		var js ogav1.JointInspectionStatus
		var updatedAt time.Time
		if err := rows.Scan(&js.AgencyCode, &js.Status, &js.OfficerId, &updatedAt); err != nil {
			continue
		}
		js.CompletedAt = timestamppb.New(updatedAt)
		statuses = append(statuses, &js)
		switch js.Status {
		case "APPROVED":
			approved++
		case "REJECTED":
			rejected++
		default:
			pending++
		}
	}

	return &ogav1.JointInspectionResponse{
		DeclarationId:     req.DeclarationId,
		AllAgenciesCleared: pending == 0 && rejected == 0 && approved > 0,
		AgencyStatuses:    statuses,
		PendingCount:      pending,
		ApprovedCount:     approved,
		RejectedCount:     rejected,
	}, nil
}

func (s *ogaServer) ListAgencies(ctx context.Context, req *ogav1.ListAgenciesRequest) (*ogav1.ListAgenciesResponse, error) {
	query := `SELECT code, name, category, is_active, sla_hours, COALESCE(contact_email, ''), COALESCE(api_endpoint, '') FROM oga_agencies`
	if req.ActiveOnly {
		query += " WHERE is_active = true"
	}
	query += " ORDER BY name"

	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to list agencies")
	}
	defer rows.Close()

	var agencies []*ogav1.Agency
	for rows.Next() {
		var a ogav1.Agency
		if err := rows.Scan(&a.Code, &a.Name, &a.Category, &a.IsActive, &a.SlaHours, &a.ContactEmail, &a.ApiEndpoint); err != nil {
			continue
		}
		agencies = append(agencies, &a)
	}

	return &ogav1.ListAgenciesResponse{Agencies: agencies}, nil
}

func (s *ogaServer) GetPermitStatus(ctx context.Context, req *ogav1.GetPermitStatusRequest) (*ogav1.PermitResponse, error) {
	var p ogav1.PermitResponse
	var createdAt, updatedAt time.Time
	var slaDeadline time.Time

	err := s.db.QueryRow(ctx, `
		SELECT id, declaration_id, agency_code, permit_type, status,
		       COALESCE(permit_number, ''), sla_deadline, COALESCE(sla_breached, false), created_at, updated_at
		FROM oga_permits WHERE id = $1`,
		req.PermitId,
	).Scan(&p.Id, &p.DeclarationId, &p.AgencyCode, &p.PermitType, &p.Status,
		&p.PermitNumber, &slaDeadline, &p.SlaBreached, &createdAt, &updatedAt)
	if err != nil {
		return nil, status.Error(codes.NotFound, "permit not found")
	}

	p.SlaDeadlineMs = slaDeadline.UnixMilli()
	p.CreatedAt = timestamppb.New(createdAt)
	p.UpdatedAt = timestamppb.New(updatedAt)
	return &p, nil
}

func (s *ogaServer) TriggerJointInspection(ctx context.Context, req *ogav1.TriggerJointInspectionRequest) (*ogav1.JointInspectionResponse, error) {
	// Create permit requests for all specified agencies
	for _, agencyCode := range req.AgencyCodes {
		_, err := s.SubmitPermitRequest(ctx, &ogav1.PermitRequest{
			DeclarationId: req.DeclarationId,
			TraderId:      req.TriggeredBy,
			AgencyCode:    agencyCode,
			PermitType:    "JOINT_INSPECTION",
		})
		if err != nil {
			s.logger.Warn().Err(err).Str("agency", agencyCode).Msg("Failed to create joint inspection permit")
		}
	}
	return s.GetJointInspectionStatus(ctx, &ogav1.JointInspectionRequest{DeclarationId: req.DeclarationId})
}

func (s *ogaServer) GetSLAReport(ctx context.Context, req *ogav1.SLAReportRequest) (*ogav1.SLAReportResponse, error) {
	query := `
		SELECT
			agency_code,
			COUNT(*) as total,
			COUNT(*) FILTER (WHERE sla_breached = false AND status = 'APPROVED') as within_sla,
			COUNT(*) FILTER (WHERE sla_breached = true) as breached,
			COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600), 0) as avg_hours
		FROM oga_permits WHERE 1=1`
	args := []interface{}{}
	if req.AgencyCode != "" {
		query += " AND agency_code = $1"
		args = append(args, req.AgencyCode)
	}
	query += " GROUP BY agency_code LIMIT 1"

	var report ogav1.SLAReportResponse
	var withinSLA, breached int32
	err := s.db.QueryRow(ctx, query, args...).Scan(
		&report.AgencyCode, &report.TotalPermits, &withinSLA, &breached, &report.AvgProcessingHours,
	)
	if err != nil {
		return &ogav1.SLAReportResponse{AgencyCode: req.AgencyCode}, nil
	}

	report.WithinSla = withinSLA
	report.BreachedSla = breached
	if report.TotalPermits > 0 {
		report.ComplianceRate = float64(withinSLA) / float64(report.TotalPermits) * 100
	}
	return &report, nil
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	db, err := pgxpool.New(ctx, getEnv("DATABASE_URL", "postgres://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"))
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to PostgreSQL")
	}
	defer db.Close()

	redisOpts, _ := redis.ParseURL(getEnv("REDIS_URL", "redis://localhost:6379"))
	rdb := redis.NewClient(redisOpts)
	defer rdb.Close()

	brokers := strings.Split(getEnv("KAFKA_BROKERS", "localhost:9092"), ",")
	kw := &kafka.Writer{
		Addr:     kafka.TCP(brokers...),
		Balancer: &kafka.LeastBytes{},
	}
	defer kw.Close()

	grpcPort := getEnv("GRPC_PORT", "50053")
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to listen")
	}

	grpcServer := grpc.NewServer()
	srv := &ogaServer{db: db, redis: rdb, kafka: kw, logger: log.With().Str("service", "oga-hub").Logger()}
	ogav1.RegisterOGAServiceServer(grpcServer, srv)
	grpc_health_v1.RegisterHealthServer(grpcServer, health.NewServer())
	reflection.Register(grpcServer)

	go func() {
		http.Handle("/metrics", promhttp.Handler())
		http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok","service":"oga-hub"}`))
		})
		http.ListenAndServe(":"+getEnv("METRICS_PORT", "9092"), nil)
	}()

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		grpcServer.GracefulStop()
		cancel()
	}()

	log.Info().Str("port", grpcPort).Msg("oga-hub gRPC server starting")
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatal().Err(err).Msg("gRPC server failed")
	}
}
