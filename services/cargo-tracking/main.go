// cargo-tracking — TradeGateway NGSWTP
//
// Go gRPC microservice for UCR lifecycle management and real-time cargo tracking.
// Streams real-time status updates via Fluvio producer.
//
// Middleware integrations:
//   - PostgreSQL (pgx/v5) — cargo records and event log
//   - Kafka (segmentio/kafka-go) — CARGO_ARRIVED, CARGO_RELEASED events
//   - Redis (go-redis/v9) — real-time status cache for low-latency queries
//   - Fluvio HTTP producer — real-time event streaming
//   - Prometheus — metrics on :9093/metrics
//
// Environment variables:
//   GRPC_PORT        (default: 50054)
//   DATABASE_URL
//   KAFKA_BROKERS
//   REDIS_URL
//   FLUVIO_ENDPOINT  (default: http://fluvio-sc:9003)

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
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

	cargov1 "github.com/tradegateway/ngswtp/proto/cargo/v1"
)

// ─── Metrics ─────────────────────────────────────────────────────────────────

var (
	cargoRegistered = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "cargo_registered_total",
		Help: "Total cargo consignments registered",
	})
	cargoReleased = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "cargo_released_total",
		Help: "Total cargo consignments released",
	})
	cargoHeld = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "cargo_held_total",
		Help: "Total cargo consignments held",
	})
	avgDwellTime = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "cargo_avg_dwell_hours",
		Help: "Average cargo dwell time in hours",
	})
)

func init() {
	prometheus.MustRegister(cargoRegistered, cargoReleased, cargoHeld, avgDwellTime)
}

// ─── Fluvio producer ─────────────────────────────────────────────────────────

type fluvioProducer struct {
	endpoint string
	client   *http.Client
}

func newFluvioProducer(endpoint string) *fluvioProducer {
	return &fluvioProducer{
		endpoint: endpoint,
		client:   &http.Client{Timeout: 5 * time.Second},
	}
}

func (f *fluvioProducer) produce(ctx context.Context, topic string, key string, payload interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/produce/%s", f.endpoint, topic),
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Record-Key", key)

	resp, err := f.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("fluvio returned %d", resp.StatusCode)
	}
	return nil
}

// ─── Server ───────────────────────────────────────────────────────────────────

type cargoServer struct {
	cargov1.UnimplementedCargoServiceServer
	db      *pgxpool.Pool
	redis   *redis.Client
	kafka   *kafka.Writer
	fluvio  *fluvioProducer
	logger  zerolog.Logger
	// streaming subscribers
	mu          sync.RWMutex
	subscribers map[string][]chan *cargov1.CargoEvent
}

func newCargoServer(db *pgxpool.Pool, rdb *redis.Client, kw *kafka.Writer, fluvio *fluvioProducer) *cargoServer {
	return &cargoServer{
		db:          db,
		redis:       rdb,
		kafka:       kw,
		fluvio:      fluvio,
		logger:      log.With().Str("service", "cargo-tracking").Logger(),
		subscribers: make(map[string][]chan *cargov1.CargoEvent),
	}
}

func (s *cargoServer) RegisterCargo(ctx context.Context, req *cargov1.RegisterCargoRequest) (*cargov1.CargoResponse, error) {
	if req.DeclarationId == "" || req.Ucr == "" {
		return nil, status.Error(codes.InvalidArgument, "declaration_id and ucr are required")
	}

	id := uuid.New().String()
	now := time.Now().UTC()

	_, err := s.db.Exec(ctx, `
		INSERT INTO cargo_tracking (
			id, declaration_id, ucr, vessel_name, voyage_number,
			bill_of_lading, port_of_entry, container_numbers,
			gross_weight, number_of_packages, eta, status, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'REGISTERED', $12, $13)`,
		id, req.DeclarationId, req.Ucr, req.VesselName, req.VoyageNumber,
		req.BillOfLading, req.PortOfEntry, req.ContainerNumbers,
		req.GrossWeight, req.NumberOfPackages, req.Eta.AsTime(), now, now,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to register cargo")
	}

	// Cache in Redis for fast status lookups
	cacheKey := fmt.Sprintf("cargo:%s", req.Ucr)
	s.redis.HSet(ctx, cacheKey, map[string]interface{}{
		"id":     id,
		"status": "REGISTERED",
		"port":   req.PortOfEntry,
	})
	s.redis.Expire(ctx, cacheKey, 30*24*time.Hour)

	cargoRegistered.Inc()

	// Publish CARGO_REGISTERED event to Kafka
	payload := fmt.Sprintf(`{"cargo_id":"%s","ucr":"%s","declaration_id":"%s","vessel":"%s","port":"%s","timestamp":"%s"}`,
		id, req.Ucr, req.DeclarationId, req.VesselName, req.PortOfEntry, now.Format(time.RFC3339))
	s.kafka.WriteMessages(ctx, kafka.Message{
		Topic: "cargo-events",
		Key:   []byte(req.Ucr),
		Value: []byte(payload),
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte("CARGO_REGISTERED")},
		},
	})

	s.logger.Info().Str("cargo_id", id).Str("ucr", req.Ucr).Msg("Cargo registered")

	return &cargov1.CargoResponse{
		Id:               id,
		DeclarationId:    req.DeclarationId,
		Ucr:              req.Ucr,
		Status:           "REGISTERED",
		VesselName:       req.VesselName,
		VoyageNumber:     req.VoyageNumber,
		BillOfLading:     req.BillOfLading,
		PortOfEntry:      req.PortOfEntry,
		ContainerNumbers: req.ContainerNumbers,
		GrossWeight:      req.GrossWeight,
		NumberOfPackages: req.NumberOfPackages,
		Eta:              req.Eta,
		CreatedAt:        timestamppb.New(now),
	}, nil
}

func (s *cargoServer) UpdateCargoStatus(ctx context.Context, req *cargov1.UpdateCargoStatusRequest) (*cargov1.CargoResponse, error) {
	if req.NewStatus == "" {
		return nil, status.Error(codes.InvalidArgument, "new_status is required")
	}

	now := time.Now().UTC()
	var declarationID, ucr string

	// Determine identifier
	var queryID string
	if req.CargoId != "" {
		queryID = req.CargoId
		err := s.db.QueryRow(ctx,
			`SELECT declaration_id, ucr FROM cargo_tracking WHERE id = $1`, queryID,
		).Scan(&declarationID, &ucr)
		if err != nil {
			return nil, status.Error(codes.NotFound, "cargo not found")
		}
	} else if req.Ucr != "" {
		err := s.db.QueryRow(ctx,
			`SELECT id, declaration_id, ucr FROM cargo_tracking WHERE ucr = $1`, req.Ucr,
		).Scan(&queryID, &declarationID, &ucr)
		if err != nil {
			return nil, status.Error(codes.NotFound, "cargo not found by UCR")
		}
	} else {
		return nil, status.Error(codes.InvalidArgument, "cargo_id or ucr required")
	}

	updateQuery := `UPDATE cargo_tracking SET status = $1, updated_at = $2`
	args := []interface{}{req.NewStatus, now}
	argIdx := 3

	if req.NewStatus == "ARRIVED" {
		updateQuery += fmt.Sprintf(", actual_arrival = $%d", argIdx)
		args = append(args, now)
		argIdx++
	}
	if req.NewStatus == "RELEASED" {
		updateQuery += fmt.Sprintf(", released_at = $%d", argIdx)
		args = append(args, now)
		argIdx++
		cargoReleased.Inc()
	}
	if req.NewStatus == "HELD" {
		cargoHeld.Inc()
	}

	updateQuery += fmt.Sprintf(" WHERE id = $%d", argIdx)
	args = append(args, queryID)

	if _, err := s.db.Exec(ctx, updateQuery, args...); err != nil {
		return nil, status.Error(codes.Internal, "failed to update cargo status")
	}

	// Log event
	eventID := uuid.New().String()
	s.db.Exec(ctx, `
		INSERT INTO cargo_events (id, cargo_id, ucr, event_type, status, location, officer_id, notes, latitude, longitude, occurred_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		eventID, queryID, ucr, "STATUS_UPDATE", req.NewStatus,
		req.Location, req.OfficerId, req.Notes, req.Latitude, req.Longitude, now,
	)

	// Update Redis cache
	cacheKey := fmt.Sprintf("cargo:%s", ucr)
	s.redis.HSet(ctx, cacheKey, "status", req.NewStatus)

	// Publish to Kafka
	eventType := fmt.Sprintf("CARGO_%s", req.NewStatus)
	payload := fmt.Sprintf(`{"cargo_id":"%s","ucr":"%s","declaration_id":"%s","status":"%s","location":"%s","timestamp":"%s"}`,
		queryID, ucr, declarationID, req.NewStatus, req.Location, now.Format(time.RFC3339))
	s.kafka.WriteMessages(ctx, kafka.Message{
		Topic: "cargo-events",
		Key:   []byte(ucr),
		Value: []byte(payload),
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte(eventType)},
		},
	})

	// Stream to Fluvio for real-time subscribers
	event := &cargov1.CargoEvent{
		CargoId:    queryID,
		Ucr:        ucr,
		EventType:  "STATUS_UPDATE",
		Status:     req.NewStatus,
		Location:   req.Location,
		OfficerId:  req.OfficerId,
		Notes:      req.Notes,
		Latitude:   req.Latitude,
		Longitude:  req.Longitude,
		OccurredAt: timestamppb.New(now),
	}
	if err := s.fluvio.produce(ctx, "cargo-stream", ucr, event); err != nil {
		s.logger.Warn().Err(err).Str("ucr", ucr).Msg("Fluvio produce failed")
	}

	// Notify streaming subscribers
	s.notifySubscribers(ucr, event)

	s.logger.Info().Str("ucr", ucr).Str("status", req.NewStatus).Msg("Cargo status updated")

	return s.GetCargoByUCR(ctx, &cargov1.GetCargoByUCRRequest{Ucr: ucr})
}

func (s *cargoServer) notifySubscribers(ucr string, event *cargov1.CargoEvent) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, ch := range s.subscribers[ucr] {
		select {
		case ch <- event:
		default:
		}
	}
}

func (s *cargoServer) GetCargo(ctx context.Context, req *cargov1.GetCargoRequest) (*cargov1.CargoResponse, error) {
	return s.queryCargo(ctx, "id", req.CargoId)
}

func (s *cargoServer) GetCargoByUCR(ctx context.Context, req *cargov1.GetCargoByUCRRequest) (*cargov1.CargoResponse, error) {
	return s.queryCargo(ctx, "ucr", req.Ucr)
}

func (s *cargoServer) queryCargo(ctx context.Context, field, value string) (*cargov1.CargoResponse, error) {
	var c cargov1.CargoResponse
	var createdAt, updatedAt time.Time
	var eta, actualArrival, releasedAt *time.Time

	err := s.db.QueryRow(ctx, fmt.Sprintf(`
		SELECT id, declaration_id, ucr, status, vessel_name, voyage_number,
		       bill_of_lading, port_of_entry, container_numbers, gross_weight,
		       number_of_packages, eta, actual_arrival, released_at, created_at, updated_at
		FROM cargo_tracking WHERE %s = $1`, field), value,
	).Scan(
		&c.Id, &c.DeclarationId, &c.Ucr, &c.Status, &c.VesselName, &c.VoyageNumber,
		&c.BillOfLading, &c.PortOfEntry, &c.ContainerNumbers, &c.GrossWeight,
		&c.NumberOfPackages, &eta, &actualArrival, &releasedAt, &createdAt, &updatedAt,
	)
	if err != nil {
		return nil, status.Error(codes.NotFound, "cargo not found")
	}

	if eta != nil {
		c.Eta = timestamppb.New(*eta)
	}
	if actualArrival != nil {
		c.ActualArrival = timestamppb.New(*actualArrival)
	}
	if releasedAt != nil {
		c.ReleasedAt = timestamppb.New(*releasedAt)
	}
	c.CreatedAt = timestamppb.New(createdAt)
	return &c, nil
}

func (s *cargoServer) ListCargoEvents(ctx context.Context, req *cargov1.ListCargoEventsRequest) (*cargov1.ListCargoEventsResponse, error) {
	limit := int(req.Limit)
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	rows, err := s.db.Query(ctx, `
		SELECT cargo_id, ucr, event_type, status, COALESCE(location, ''),
		       COALESCE(officer_id, ''), COALESCE(notes, ''),
		       COALESCE(latitude, 0), COALESCE(longitude, 0), occurred_at
		FROM cargo_events WHERE cargo_id = $1
		ORDER BY occurred_at DESC LIMIT $2`,
		req.CargoId, limit,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to list events")
	}
	defer rows.Close()

	var events []*cargov1.CargoEvent
	for rows.Next() {
		var e cargov1.CargoEvent
		var occurredAt time.Time
		if err := rows.Scan(&e.CargoId, &e.Ucr, &e.EventType, &e.Status, &e.Location,
			&e.OfficerId, &e.Notes, &e.Latitude, &e.Longitude, &occurredAt); err != nil {
			continue
		}
		e.OccurredAt = timestamppb.New(occurredAt)
		events = append(events, &e)
	}

	return &cargov1.ListCargoEventsResponse{Events: events}, nil
}

func (s *cargoServer) TrackShipment(req *cargov1.TrackShipmentRequest, stream cargov1.CargoService_TrackShipmentServer) error {
	ch := make(chan *cargov1.CargoEvent, 10)

	s.mu.Lock()
	s.subscribers[req.Ucr] = append(s.subscribers[req.Ucr], ch)
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		subs := s.subscribers[req.Ucr]
		for i, c := range subs {
			if c == ch {
				s.subscribers[req.Ucr] = append(subs[:i], subs[i+1:]...)
				break
			}
		}
		s.mu.Unlock()
		close(ch)
	}()

	for {
		select {
		case event, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(event); err != nil {
				return err
			}
		case <-stream.Context().Done():
			return nil
		}
	}
}

func (s *cargoServer) GetPortCongestion(ctx context.Context, req *cargov1.PortCongestionRequest) (*cargov1.PortCongestionResponse, error) {
	var response cargov1.PortCongestionResponse
	response.PortCode = req.PortCode

	err := s.db.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status = 'ARRIVED') as at_berth,
			COUNT(*) FILTER (WHERE status = 'REGISTERED') as at_anchor,
			COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(released_at, NOW()) - actual_arrival)) / 3600)
				FILTER (WHERE actual_arrival IS NOT NULL), 0) as avg_dwell,
			COUNT(*) FILTER (WHERE status NOT IN ('RELEASED', 'SEIZED')) as awaiting
		FROM cargo_tracking WHERE port_of_entry = $1`,
		req.PortCode,
	).Scan(&response.VesselsAtBerth, &response.VesselsAtAnchor, &response.AvgDwellHours, &response.ContainersAwaitingClearance)
	if err != nil {
		return &response, nil
	}

	avgDwellTime.Set(float64(response.AvgDwellHours))

	switch {
	case response.ContainersAwaitingClearance > 500:
		response.CongestionLevel = "CRITICAL"
	case response.ContainersAwaitingClearance > 200:
		response.CongestionLevel = "HIGH"
	case response.ContainersAwaitingClearance > 50:
		response.CongestionLevel = "MEDIUM"
	default:
		response.CongestionLevel = "LOW"
	}

	return &response, nil
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

	fluvio := newFluvioProducer(getEnv("FLUVIO_ENDPOINT", "http://fluvio-sc:9003"))

	grpcPort := getEnv("GRPC_PORT", "50054")
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to listen")
	}

	grpcServer := grpc.NewServer()
	srv := newCargoServer(db, rdb, kw, fluvio)
	cargov1.RegisterCargoServiceServer(grpcServer, srv)
	grpc_health_v1.RegisterHealthServer(grpcServer, health.NewServer())
	reflection.Register(grpcServer)

	go func() {
		http.Handle("/metrics", promhttp.Handler())
		http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok","service":"cargo-tracking"}`))
		})
		http.ListenAndServe(":"+getEnv("METRICS_PORT", "9093"), nil)
	}()

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		grpcServer.GracefulStop()
		cancel()
	}()

	log.Info().Str("port", grpcPort).Msg("cargo-tracking gRPC server starting")
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatal().Err(err).Msg("gRPC server failed")
	}
}
