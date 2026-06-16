// risk-engine — TradeGateway NGSWTP
//
// Go gRPC microservice for AI-assisted risk scoring.
// Proxies ML inference to the Python ai-risk-scorer FastAPI service,
// maintains trader risk profiles in Redis, and validates HS codes.
//
// Middleware integrations:
//   - Python ai-risk-scorer (HTTP) — ML inference
//   - Redis (go-redis/v9) — risk profile cache, rate limiting
//   - Kafka (segmentio/kafka-go) — RISK_SCORED event publishing
//   - PostgreSQL (pgx/v5) — persistent risk profiles
//   - Prometheus — metrics on :9091/metrics
//
// Environment variables:
//   GRPC_PORT            (default: 50052)
//   DATABASE_URL
//   KAFKA_BROKERS
//   REDIS_URL
//   AI_RISK_SCORER_URL   (default: http://ai-risk-scorer:8000)

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

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

	riskv1 "github.com/tradegateway/ngswtp/proto/risk/v1"
)

// ─── Metrics ─────────────────────────────────────────────────────────────────

var (
	declarationsScored = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "risk_declarations_scored_total",
		Help: "Total declarations scored",
	})
	riskLaneDistribution = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "risk_lane_distribution_total",
		Help: "Risk lane distribution",
	}, []string{"lane"})
	aiScorerLatency = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "ai_scorer_request_duration_seconds",
		Help:    "AI risk scorer HTTP request duration",
		Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1, 2, 5},
	})
)

func init() {
	prometheus.MustRegister(declarationsScored, riskLaneDistribution, aiScorerLatency)
}

// ─── AI Risk Scorer client ────────────────────────────────────────────────────

type aiScorerRequest struct {
	DeclarationID   string   `json:"declaration_id"`
	TraderID        string   `json:"trader_id"`
	HsCode          string   `json:"hs_code"`
	CountryOfOrigin string   `json:"country_of_origin"`
	InvoiceValue    float64  `json:"invoice_value"`
	InvoiceCurrency string   `json:"invoice_currency"`
	GrossWeight     float64  `json:"gross_weight"`
	NumPackages     int32    `json:"number_of_packages"`
	GoodsDesc       string   `json:"goods_description"`
	PortOfEntry     string   `json:"port_of_entry"`
	IsAmendment     bool     `json:"is_amendment_rescore"`
	ChangedFields   []string `json:"changed_fields"`
}

type aiScorerResponse struct {
	RiskScore              int32    `json:"risk_score"`
	RiskLane               string   `json:"risk_lane"`
	Explanation            string   `json:"explanation"`
	RiskFactors            []string `json:"risk_factors"`
	Confidence             float64  `json:"confidence"`
	RequiresPhysical       bool     `json:"requires_physical_inspection"`
	RequiresDocReview      bool     `json:"requires_doc_review"`
}

func callAIScorer(ctx context.Context, aiURL string, req *aiScorerRequest) (*aiScorerResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, aiURL+"/score", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := http.DefaultClient.Do(httpReq)
	aiScorerLatency.Observe(time.Since(start).Seconds())

	if err != nil {
		return nil, fmt.Errorf("ai scorer request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ai scorer returned %d: %s", resp.StatusCode, string(body))
	}

	var result aiScorerResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

// ─── Risk lane assignment ─────────────────────────────────────────────────────

// fallbackScore provides a deterministic rule-based score when AI scorer is unavailable.
func fallbackScore(req *riskv1.ScoreRequest) (int32, string) {
	score := int32(20) // baseline

	// High-risk countries of origin
	highRiskCountries := map[string]bool{
		"KP": true, "IR": true, "SY": true, "CU": true, "VE": true,
	}
	if highRiskCountries[req.CountryOfOrigin] {
		score += 40
	}

	// High-value shipments
	if req.InvoiceValue > 100000 {
		score += 15
	} else if req.InvoiceValue > 50000 {
		score += 8
	}

	// Suspicious weight/value ratio
	if req.GrossWeight > 0 && req.InvoiceValue > 0 {
		ratio := req.InvoiceValue / float64(req.GrossWeight)
		if ratio > 10000 { // very high value per kg
			score += 20
		}
	}

	// Amendment rescore gets elevated baseline
	if req.IsAmendmentRescore {
		score += 10
	}

	if score >= 70 {
		return score, "RED"
	} else if score >= 40 {
		return score, "YELLOW"
	}
	return score, "GREEN"
}

// ─── Server ───────────────────────────────────────────────────────────────────

type riskServer struct {
	riskv1.UnimplementedRiskServiceServer
	db     *pgxpool.Pool
	redis  *redis.Client
	kafka  *kafka.Writer
	aiURL  string
	logger zerolog.Logger
}

func (s *riskServer) ScoreDeclaration(ctx context.Context, req *riskv1.ScoreRequest) (*riskv1.ScoreResponse, error) {
	if req.DeclarationId == "" || req.TraderId == "" {
		return nil, status.Error(codes.InvalidArgument, "declaration_id and trader_id are required")
	}

	// Try AI scorer first, fall back to rule-based scoring
	aiReq := &aiScorerRequest{
		DeclarationID:   req.DeclarationId,
		TraderID:        req.TraderId,
		HsCode:          req.HsCode,
		CountryOfOrigin: req.CountryOfOrigin,
		InvoiceValue:    req.InvoiceValue,
		InvoiceCurrency: req.InvoiceCurrency,
		GrossWeight:     req.GrossWeight,
		NumPackages:     req.NumberOfPackages,
		GoodsDesc:       req.GoodsDescription,
		PortOfEntry:     req.PortOfEntry,
		IsAmendment:     req.IsAmendmentRescore,
		ChangedFields:   req.ChangedFields,
	}

	var riskScore int32
	var riskLane, explanation string
	var riskFactors []string
	var confidence float64
	var requiresPhysical, requiresDocReview bool

	aiResp, err := callAIScorer(ctx, s.aiURL, aiReq)
	if err != nil {
		s.logger.Warn().Err(err).Str("declaration_id", req.DeclarationId).Msg("AI scorer unavailable, using fallback")
		riskScore, riskLane = fallbackScore(req)
		explanation = "Rule-based scoring (AI scorer unavailable)"
		riskFactors = []string{"fallback_scoring"}
		confidence = 0.6
	} else {
		riskScore = aiResp.RiskScore
		riskLane = aiResp.RiskLane
		explanation = aiResp.Explanation
		riskFactors = aiResp.RiskFactors
		confidence = aiResp.Confidence
		requiresPhysical = aiResp.RequiresPhysical
		requiresDocReview = aiResp.RequiresDocReview
	}

	// Persist risk score to DB
	_, dbErr := s.db.Exec(ctx, `
		UPDATE declarations
		SET risk_score = $1, risk_lane = $2, ai_explanation = $3, updated_at = NOW()
		WHERE id = $4`,
		riskScore, riskLane, explanation, req.DeclarationId,
	)
	if dbErr != nil {
		s.logger.Warn().Err(dbErr).Msg("Failed to persist risk score")
	}

	// Cache trader risk profile update in Redis
	profileKey := fmt.Sprintf("risk_profile:%s", req.TraderId)
	s.redis.HIncrBy(ctx, profileKey, "total_scored", 1)
	s.redis.HIncrByFloat(ctx, profileKey, "score_sum", float64(riskScore))
	s.redis.Expire(ctx, profileKey, 24*time.Hour)

	// Publish RISK_SCORED event to Kafka
	payload := fmt.Sprintf(`{"declaration_id":"%s","trader_id":"%s","risk_score":%d,"risk_lane":"%s","timestamp":"%s"}`,
		req.DeclarationId, req.TraderId, riskScore, riskLane, time.Now().UTC().Format(time.RFC3339))
	msg := kafka.Message{
		Topic: "risk-events",
		Key:   []byte(req.DeclarationId),
		Value: []byte(payload),
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte("RISK_SCORED")},
		},
	}
	if err := s.kafka.WriteMessages(ctx, msg); err != nil {
		s.logger.Warn().Err(err).Msg("Failed to publish RISK_SCORED event")
	}

	declarationsScored.Inc()
	riskLaneDistribution.WithLabelValues(riskLane).Inc()

	s.logger.Info().
		Str("declaration_id", req.DeclarationId).
		Int32("risk_score", riskScore).
		Str("risk_lane", riskLane).
		Float64("confidence", confidence).
		Msg("Declaration scored")

	return &riskv1.ScoreResponse{
		DeclarationId:              req.DeclarationId,
		RiskScore:                  riskScore,
		RiskLane:                   riskLane,
		AiExplanation:              explanation,
		RiskFactors:                riskFactors,
		Confidence:                 confidence,
		RequiresPhysicalInspection: requiresPhysical,
		RequiresDocReview:          requiresDocReview,
		ScoredAtMs:                 time.Now().UnixMilli(),
	}, nil
}

func (s *riskServer) ValidateHsCode(ctx context.Context, req *riskv1.ValidateHsCodeRequest) (*riskv1.ValidateHsCodeResponse, error) {
	// Call Python ai-risk-scorer for BERT-based HS code validation
	type hsValidateReq struct {
		HsCode          string `json:"hs_code"`
		GoodsDesc       string `json:"goods_description"`
		CountryOfOrigin string `json:"country_of_origin"`
	}
	body, _ := json.Marshal(hsValidateReq{
		HsCode:          req.HsCode,
		GoodsDesc:       req.GoodsDescription,
		CountryOfOrigin: req.CountryOfOrigin,
	})

	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, s.aiURL+"/validate-hs", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		// Fallback: basic format validation
		hsCode := strings.ReplaceAll(req.HsCode, ".", "")
		isValid := len(hsCode) >= 6 && len(hsCode) <= 10
		return &riskv1.ValidateHsCodeResponse{
			IsValid:          isValid,
			CanonicalHsCode:  req.HsCode,
			Description:      "Validation service unavailable",
			Confidence:       0.5,
		}, nil
	}
	defer resp.Body.Close()

	type hsValidateResp struct {
		IsValid         bool     `json:"is_valid"`
		CanonicalCode   string   `json:"canonical_hs_code"`
		Description     string   `json:"description"`
		Confidence      float64  `json:"confidence"`
		SuggestedCodes  []string `json:"suggested_codes"`
		IsProhibited    bool     `json:"is_prohibited"`
		IsRestricted    bool     `json:"is_restricted"`
		RequiredPermits []string `json:"required_permits"`
	}
	var result hsValidateResp
	json.NewDecoder(resp.Body).Decode(&result)

	return &riskv1.ValidateHsCodeResponse{
		IsValid:         result.IsValid,
		CanonicalHsCode: result.CanonicalCode,
		Description:     result.Description,
		Confidence:      result.Confidence,
		SuggestedCodes:  result.SuggestedCodes,
		IsProhibited:    result.IsProhibited,
		IsRestricted:    result.IsRestricted,
		RequiredPermits: result.RequiredPermits,
	}, nil
}

func (s *riskServer) GetRiskProfile(ctx context.Context, req *riskv1.GetRiskProfileRequest) (*riskv1.RiskProfileResponse, error) {
	var profile riskv1.RiskProfileResponse
	profile.TraderId = req.TraderId

	err := s.db.QueryRow(ctx, `
		SELECT
			COALESCE(compliance_score, 0.0),
			COALESCE(total_declarations, 0),
			COALESCE(violations, 0),
			COALESCE(compliant, 0),
			COALESCE(avg_risk_score, 0.0),
			COALESCE(risk_tier, 'LOW'),
			COALESCE(is_aeo, false)
		FROM trader_risk_profiles WHERE trader_id = $1`,
		req.TraderId,
	).Scan(
		&profile.ComplianceScore, &profile.TotalDeclarations,
		&profile.Violations, &profile.Compliant, &profile.AvgRiskScore,
		&profile.RiskTier, &profile.IsAeo,
	)
	if err != nil {
		// Return empty profile if not found
		profile.RiskTier = "LOW"
		profile.ComplianceScore = 100.0
	}

	return &profile, nil
}

func (s *riskServer) UpdateRiskProfile(ctx context.Context, req *riskv1.UpdateRiskProfileRequest) (*riskv1.RiskProfileResponse, error) {
	riskTier := "LOW"
	if req.AvgRiskScore >= 70 {
		riskTier = "CRITICAL"
	} else if req.AvgRiskScore >= 50 {
		riskTier = "HIGH"
	} else if req.AvgRiskScore >= 30 {
		riskTier = "MEDIUM"
	}

	complianceScore := 100.0
	if req.TotalDeclarations > 0 {
		complianceScore = float64(req.Compliant) / float64(req.TotalDeclarations) * 100
	}

	_, err := s.db.Exec(ctx, `
		INSERT INTO trader_risk_profiles (
			trader_id, compliance_score, total_declarations, violations,
			compliant, avg_risk_score, risk_tier, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (trader_id) DO UPDATE SET
			compliance_score = EXCLUDED.compliance_score,
			total_declarations = EXCLUDED.total_declarations,
			violations = EXCLUDED.violations,
			compliant = EXCLUDED.compliant,
			avg_risk_score = EXCLUDED.avg_risk_score,
			risk_tier = EXCLUDED.risk_tier,
			updated_at = NOW()`,
		req.TraderId, complianceScore, req.TotalDeclarations, req.Violations,
		req.Compliant, req.AvgRiskScore, riskTier,
	)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to update risk profile")
	}

	return s.GetRiskProfile(ctx, &riskv1.GetRiskProfileRequest{TraderId: req.TraderId})
}

func (s *riskServer) GetRiskStats(ctx context.Context, req *riskv1.RiskStatsRequest) (*riskv1.RiskStatsResponse, error) {
	var stats riskv1.RiskStatsResponse
	err := s.db.QueryRow(ctx, `
		SELECT
			COUNT(*) as total,
			COUNT(*) FILTER (WHERE risk_lane = 'GREEN') as green,
			COUNT(*) FILTER (WHERE risk_lane = 'YELLOW') as yellow,
			COUNT(*) FILTER (WHERE risk_lane = 'RED') as red,
			COALESCE(AVG(risk_score), 0) as avg_score
		FROM declarations
		WHERE risk_score IS NOT NULL`,
	).Scan(&stats.TotalScored, &stats.GreenCount, &stats.YellowCount, &stats.RedCount, &stats.AvgScore)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get risk stats")
	}
	return &stats, nil
}

func (s *riskServer) BatchScore(ctx context.Context, req *riskv1.BatchScoreRequest) (*riskv1.BatchScoreResponse, error) {
	responses := make([]*riskv1.ScoreResponse, 0, len(req.Requests))
	for _, r := range req.Requests {
		resp, err := s.ScoreDeclaration(ctx, r)
		if err != nil {
			s.logger.Warn().Err(err).Str("declaration_id", r.DeclarationId).Msg("Batch score failed for item")
			continue
		}
		responses = append(responses, resp)
	}
	return &riskv1.BatchScoreResponse{Responses: responses}, nil
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

	grpcPort := getEnv("GRPC_PORT", "50052")
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to listen")
	}

	grpcServer := grpc.NewServer()
	srv := &riskServer{
		db:     db,
		redis:  rdb,
		kafka:  kw,
		aiURL:  getEnv("AI_RISK_SCORER_URL", "http://ai-risk-scorer:8000"),
		logger: log.With().Str("service", "risk-engine").Logger(),
	}
	riskv1.RegisterRiskServiceServer(grpcServer, srv)
	grpc_health_v1.RegisterHealthServer(grpcServer, health.NewServer())
	reflection.Register(grpcServer)

	go func() {
		http.Handle("/metrics", promhttp.Handler())
		http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok","service":"risk-engine"}`))
		})
		http.ListenAndServe(":"+getEnv("METRICS_PORT", "9091"), nil)
	}()

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		grpcServer.GracefulStop()
		cancel()
	}()

	log.Info().Str("port", grpcPort).Msg("risk-engine gRPC server starting")
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatal().Err(err).Msg("gRPC server failed")
	}
}
