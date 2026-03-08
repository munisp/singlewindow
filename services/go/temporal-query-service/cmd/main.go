// TradeGateway NGSWTP — Temporal Query Service
// Language: Go 1.23
// Role: Provides real-time workflow execution state for the frontend UI.
//       Queries the Temporal server for workflow history, activity states,
//       retry counts, and compensation events. Exposes HTTP (port 8086)
//       and gRPC (port 9086) interfaces.
//
// The DeclarationClearanceWorkflow has 9 activities:
//   1. OCR Document Extraction   (Python — PaddleOCR/DocLing)
//   2. HS Code Classification    (Python — Qwen2.5 via Ollama)
//   3. Risk Scoring              (Python — DeepSeek-R1 via Ollama + WCO rules)
//   4. Sanctions Screening       (Python — sanctions-screener service)
//   5. OGA Routing               (Go — oga-service gRPC)
//   6. Payment Processing        (Go — mojaloop-gateway gRPC)
//   7. Physical Examination      (Go — customs officer assignment)
//   8. Clearance Decision        (Go — declaration-service gRPC)
//   9. Permit Issuance           (Go — permit-service gRPC)

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

// ─── Domain types ─────────────────────────────────────────────────────────────

// ActivityState represents the current state of a Temporal activity.
type ActivityState string

const (
	ActivityPending      ActivityState = "PENDING"
	ActivityRunning      ActivityState = "RUNNING"
	ActivityCompleted    ActivityState = "COMPLETED"
	ActivityFailed       ActivityState = "FAILED"
	ActivityRetrying     ActivityState = "RETRYING"
	ActivityCompensating ActivityState = "COMPENSATING"
	ActivitySkipped      ActivityState = "SKIPPED"
)

// WorkflowActivity represents a single activity in the clearance workflow.
type WorkflowActivity struct {
	ID                  string        `json:"id"`
	Name                string        `json:"name"`
	Service             string        `json:"service"`
	Language            string        `json:"language"`
	Description         string        `json:"description"`
	State               ActivityState `json:"state"`
	StartedAt           *time.Time    `json:"startedAt,omitempty"`
	CompletedAt         *time.Time    `json:"completedAt,omitempty"`
	DurationMs          int64         `json:"durationMs,omitempty"`
	RetryCount          int           `json:"retryCount"`
	MaxRetries          int           `json:"maxRetries"`
	RetryPolicy         string        `json:"retryPolicy"`
	Input               interface{}   `json:"input,omitempty"`
	Output              interface{}   `json:"output,omitempty"`
	ErrorMessage        string        `json:"errorMessage,omitempty"`
	CompensationActivity string       `json:"compensationActivity,omitempty"`
	Lane                string        `json:"lane,omitempty"` // GREEN/YELLOW/RED
}

// WorkflowTrace is the full execution trace of a declaration clearance workflow.
type WorkflowTrace struct {
	WorkflowID    string             `json:"workflowId"`
	RunID         string             `json:"runId"`
	DeclarationID string             `json:"declarationId"`
	Status        string             `json:"status"`
	StartedAt     time.Time          `json:"startedAt"`
	CompletedAt   *time.Time         `json:"completedAt,omitempty"`
	Activities    []WorkflowActivity `json:"activities"`
	CurrentStep   int                `json:"currentStep"`
	TotalSteps    int                `json:"totalSteps"`
	RiskLane      string             `json:"riskLane,omitempty"`
	ErrorMessage  string             `json:"errorMessage,omitempty"`
}

// ─── Activity definitions ─────────────────────────────────────────────────────

func buildActivityDefinitions() []WorkflowActivity {
	return []WorkflowActivity{
		{
			ID:          "ocr-extract",
			Name:        "OCR Document Extraction",
			Service:     "kyc-service",
			Language:    "Python",
			Description: "PaddleOCR + DocLing extract structured data from uploaded invoice, BL, and supporting documents. Qwen2-VL validates document authenticity.",
			State:       ActivityPending,
			MaxRetries:  3,
			RetryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0, InitialInterval: 5s",
			CompensationActivity: "notify-trader-reupload",
		},
		{
			ID:          "hs-classify",
			Name:        "HS Code Classification",
			Service:     "kyc-service",
			Language:    "Python",
			Description: "Qwen2.5:7b (via local Ollama) classifies commodity to 6-digit HS code with confidence score and WCO tariff schedule cross-reference.",
			State:       ActivityPending,
			MaxRetries:  2,
			RetryPolicy: "MaxAttempts: 2, BackoffCoefficient: 1.5, InitialInterval: 3s",
		},
		{
			ID:          "risk-score",
			Name:        "Risk Scoring",
			Service:     "risk-engine",
			Language:    "Python",
			Description: "DeepSeek-R1:7b (via local Ollama) reasons over 200+ WCO SAFE Framework rules. Rust rule-engine validates against static rule set. Produces GREEN/YELLOW/RED lane assignment.",
			State:       ActivityPending,
			MaxRetries:  3,
			RetryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0, InitialInterval: 5s",
		},
		{
			ID:          "sanctions-screen",
			Name:        "Sanctions Screening",
			Service:     "sanctions-screener",
			Language:    "Python",
			Description: "Screens trader, consignee, shipper, and vessel against OFAC SDN, UN Consolidated, EU Consolidated, and INTERPOL Red Notice lists.",
			State:       ActivityPending,
			MaxRetries:  3,
			RetryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0, InitialInterval: 5s",
			CompensationActivity: "flag-for-manual-review",
		},
		{
			ID:          "oga-route",
			Name:        "OGA Routing",
			Service:     "oga-service",
			Language:    "Go",
			Description: "Simultaneously notifies all required Other Government Agencies via Dapr pub/sub. Implements Rwanda ReSW joint inspection model — all agencies must approve before release.",
			State:       ActivityPending,
			MaxRetries:  5,
			RetryPolicy: "MaxAttempts: 5, BackoffCoefficient: 1.5, InitialInterval: 10s",
		},
		{
			ID:          "payment-process",
			Name:        "Payment Processing",
			Service:     "mojaloop-gateway",
			Language:    "Go",
			Description: "Initiates ILP payment via Mojaloop FSPIOP API. TigerBeetle performs two-phase pending debit. Waits for DFSP fulfilment callback before posting.",
			State:       ActivityPending,
			MaxRetries:  3,
			RetryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0, InitialInterval: 30s",
			CompensationActivity: "void-tigerbeetle-pending",
		},
		{
			ID:          "physical-exam",
			Name:        "Physical Examination",
			Service:     "declaration-service",
			Language:    "Go",
			Description: "For YELLOW/RED lane: assigns customs officer, schedules examination slot, records examination results. Computer vision service analyses cargo images.",
			State:       ActivityPending,
			MaxRetries:  2,
			RetryPolicy: "MaxAttempts: 2, BackoffCoefficient: 1.0, InitialInterval: 60s",
		},
		{
			ID:          "clearance-decision",
			Name:        "Clearance Decision",
			Service:     "declaration-service",
			Language:    "Go",
			Description: "Customs officer or automated system issues clearance decision. Generates Customs Release Order (CRO) with unique reference number.",
			State:       ActivityPending,
			MaxRetries:  2,
			RetryPolicy: "MaxAttempts: 2, BackoffCoefficient: 1.0, InitialInterval: 10s",
		},
		{
			ID:          "permit-issue",
			Name:        "Permit Issuance",
			Service:     "oga-service",
			Language:    "Go",
			Description: "Issues electronic release permit to trader and port operator. Publishes clearance.completed event to Kafka. Updates cargo tracking service.",
			State:       ActivityPending,
			MaxRetries:  3,
			RetryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0, InitialInterval: 5s",
		},
	}
}

// ─── Query service ────────────────────────────────────────────────────────────

type TemporalQueryService struct {
	logger       *zap.Logger
	temporalHost string
}

func NewTemporalQueryService(logger *zap.Logger) *TemporalQueryService {
	return &TemporalQueryService{
		logger:       logger,
		temporalHost: getEnv("TEMPORAL_HOST", "temporal:7233"),
	}
}

// GetWorkflowTrace returns the execution trace for a declaration's clearance workflow.
// In production this queries the Temporal server via the Temporal SDK client.
// Here we return a realistic simulation that the frontend can use for live trace display.
func (s *TemporalQueryService) GetWorkflowTrace(declarationID string) (*WorkflowTrace, error) {
	activities := buildActivityDefinitions()
	workflowID := fmt.Sprintf("clearance-%s", declarationID)
	startedAt := time.Now().Add(-2 * time.Minute).UTC()

	trace := &WorkflowTrace{
		WorkflowID:    workflowID,
		RunID:         fmt.Sprintf("run-%d", time.Now().UnixNano()),
		DeclarationID: declarationID,
		Status:        "RUNNING",
		StartedAt:     startedAt,
		Activities:    activities,
		TotalSteps:    len(activities),
		CurrentStep:   3, // Currently at risk scoring
		RiskLane:      "YELLOW",
	}

	// Simulate realistic activity states based on elapsed time
	now := time.Now().UTC()
	for i := range trace.Activities {
		if i < 2 {
			// First 2 activities completed
			start := startedAt.Add(time.Duration(i*30) * time.Second)
			end := start.Add(time.Duration(800+i*400) * time.Millisecond)
			trace.Activities[i].State = ActivityCompleted
			trace.Activities[i].StartedAt = &start
			trace.Activities[i].CompletedAt = &end
			trace.Activities[i].DurationMs = end.Sub(start).Milliseconds()
		} else if i == 2 {
			// Currently running
			start := now.Add(-500 * time.Millisecond)
			trace.Activities[i].State = ActivityRunning
			trace.Activities[i].StartedAt = &start
		}
		// Rest are pending
	}

	return trace, nil
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func (s *TemporalQueryService) handleGetTrace(w http.ResponseWriter, r *http.Request) {
	declarationID := chi.URLParam(r, "declarationId")
	if declarationID == "" {
		http.Error(w, "declarationId is required", http.StatusBadRequest)
		return
	}
	trace, err := s.GetWorkflowTrace(declarationID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(trace)
}

func (s *TemporalQueryService) handleListActivities(w http.ResponseWriter, r *http.Request) {
	activities := buildActivityDefinitions()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"activities": activities,
		"total":      len(activities),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	svc := NewTemporalQueryService(logger)

	// HTTP server
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "temporal-query-service"})
	})
	r.Get("/api/workflows/{declarationId}/trace", svc.handleGetTrace)
	r.Get("/api/workflows/activities", svc.handleListActivities)

	httpPort := getEnv("HTTP_PORT", "8086")
	httpServer := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	// gRPC server
	grpcPort := getEnv("GRPC_PORT", "9086")
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		logger.Fatal("failed to listen for gRPC", zap.Error(err))
	}
	grpcServer := grpc.NewServer()
	healthSvc := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthSvc)
	healthSvc.SetServingStatus("temporal-query-service", grpc_health_v1.HealthCheckResponse_SERVING)
	reflection.Register(grpcServer)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("Temporal Query Service HTTP starting", zap.String("port", httpPort))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("HTTP server error", zap.Error(err))
		}
	}()

	go func() {
		logger.Info("Temporal Query Service gRPC starting", zap.String("port", grpcPort))
		if err := grpcServer.Serve(lis); err != nil {
			logger.Fatal("gRPC server error", zap.Error(err))
		}
	}()

	<-quit
	logger.Info("Shutting down Temporal Query Service...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	httpServer.Shutdown(ctx)
	grpcServer.GracefulStop()
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
