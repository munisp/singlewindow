// TradeGateway NGSWTP — Temporal Query Service
// Language: Go 1.23
// Role: Provides real-time workflow execution state for the frontend UI.
//       Queries the Temporal server for workflow history, activity states,
//       retry counts, and compensation events. Exposes HTTP (port 8086)
//       and gRPC (port 9086) interfaces.
//       Also provides workflow management: signal, cancel, retry, search.
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
//   9. Permit Issuance           (Go — oga-service gRPC)

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
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

// WorkflowStatus represents the lifecycle state of a clearance workflow.
type WorkflowStatus string

const (
	WorkflowRunning    WorkflowStatus = "RUNNING"
	WorkflowCompleted  WorkflowStatus = "COMPLETED"
	WorkflowFailed     WorkflowStatus = "FAILED"
	WorkflowCancelled  WorkflowStatus = "CANCELLED"
	WorkflowTerminated WorkflowStatus = "TERMINATED"
)

// WorkflowActivity represents a single activity in the clearance workflow.
type WorkflowActivity struct {
	ID                   string        `json:"id"`
	Name                 string        `json:"name"`
	Service              string        `json:"service"`
	Language             string        `json:"language"`
	Description          string        `json:"description"`
	State                ActivityState `json:"state"`
	StartedAt            *time.Time    `json:"startedAt,omitempty"`
	CompletedAt          *time.Time    `json:"completedAt,omitempty"`
	DurationMs           int64         `json:"durationMs,omitempty"`
	RetryCount           int           `json:"retryCount"`
	MaxRetries           int           `json:"maxRetries"`
	RetryPolicy          string        `json:"retryPolicy"`
	Input                interface{}   `json:"input,omitempty"`
	Output               interface{}   `json:"output,omitempty"`
	ErrorMessage         string        `json:"errorMessage,omitempty"`
	CompensationActivity string        `json:"compensationActivity,omitempty"`
	Lane                 string        `json:"lane,omitempty"` // GREEN/YELLOW/RED
}

// WorkflowTrace is the full execution trace of a declaration clearance workflow.
type WorkflowTrace struct {
	WorkflowID    string             `json:"workflowId"`
	RunID         string             `json:"runId"`
	DeclarationID string             `json:"declarationId"`
	TraderID      string             `json:"traderId,omitempty"`
	Status        WorkflowStatus     `json:"status"`
	StartedAt     time.Time          `json:"startedAt"`
	CompletedAt   *time.Time         `json:"completedAt,omitempty"`
	Activities    []WorkflowActivity `json:"activities"`
	CurrentStep   int                `json:"currentStep"`
	TotalSteps    int                `json:"totalSteps"`
	RiskLane      string             `json:"riskLane,omitempty"`
	ErrorMessage  string             `json:"errorMessage,omitempty"`
	ClearanceTime *int64             `json:"clearanceTimeMs,omitempty"` // ms from start to clearance
	SLABreached   bool               `json:"slaBreached"`
	SLATargetMs   int64              `json:"slaTargetMs"` // 4h green, 24h yellow, 72h red
}

// WorkflowSummary is a lightweight summary for list views.
type WorkflowSummary struct {
	WorkflowID        string         `json:"workflowId"`
	DeclarationNumber string         `json:"declarationNumber"`
	TraderName        string         `json:"traderName,omitempty"`
	Status            WorkflowStatus `json:"status"`
	CurrentStep       string         `json:"currentStep"`
	RiskLane          string         `json:"riskLane"`
	StartedAt         time.Time      `json:"startedAt"`
	SLABreached       bool           `json:"slaBreached"`
	ProgressPct       int            `json:"progressPct"`
}

// WorkflowSignal represents a signal sent to a running workflow.
type WorkflowSignal struct {
	SignalName string      `json:"signalName"`
	Payload    interface{} `json:"payload,omitempty"`
}

// WorkflowStats provides aggregate statistics.
type WorkflowStats struct {
	ActiveWorkflows    int     `json:"activeWorkflows"`
	CompletedToday     int     `json:"completedToday"`
	FailedToday        int     `json:"failedToday"`
	SLABreachedToday   int     `json:"slaBreachedToday"`
	AvgClearanceTimeMs int64   `json:"avgClearanceTimeMs"`
	GreenLanePct       float64 `json:"greenLanePct"`
	YellowLanePct      float64 `json:"yellowLanePct"`
	RedLanePct         float64 `json:"redLanePct"`
}

// ─── Activity definitions ─────────────────────────────────────────────────────

func buildActivityDefinitions() []WorkflowActivity {
	return []WorkflowActivity{
		{
			ID:                   "ocr-extract",
			Name:                 "OCR Document Extraction",
			Service:              "kyc-service",
			Language:             "Python",
			Description:          "PaddleOCR + DocLing extract structured data from uploaded invoice, BL, and supporting documents. Qwen2-VL validates document authenticity.",
			State:                ActivityPending,
			MaxRetries:           3,
			RetryPolicy:          "MaxAttempts: 3, BackoffCoefficient: 2.0, InitialInterval: 5s",
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
			ID:                   "sanctions-screen",
			Name:                 "Sanctions Screening",
			Service:              "sanctions-screener",
			Language:             "Python",
			Description:          "Screens trader, consignee, shipper, and vessel against OFAC SDN, UN Consolidated, EU Consolidated, and INTERPOL Red Notice lists.",
			State:                ActivityPending,
			MaxRetries:           3,
			RetryPolicy:          "MaxAttempts: 3, BackoffCoefficient: 2.0, InitialInterval: 5s",
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
			ID:                   "payment-process",
			Name:                 "Payment Processing",
			Service:              "mojaloop-gateway",
			Language:             "Go",
			Description:          "Initiates ILP payment via Mojaloop FSPIOP API. TigerBeetle performs two-phase pending debit. Waits for DFSP fulfilment callback before posting.",
			State:                ActivityPending,
			MaxRetries:           3,
			RetryPolicy:          "MaxAttempts: 3, BackoffCoefficient: 2.0, InitialInterval: 30s",
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

// ─── In-memory workflow store (replace with Temporal SDK client in production) ──

var workflowStore = map[string]*WorkflowTrace{}

func init() {
	// Seed with realistic demo workflows
	lanes := []string{"GREEN", "YELLOW", "RED"}
	statuses := []WorkflowStatus{WorkflowRunning, WorkflowCompleted, WorkflowCompleted, WorkflowRunning}
	decls := []string{"NG-2026-001234", "NG-2026-001235", "NG-2026-001236", "NG-2026-001237", "NG-2026-001238"}
	traders := []string{"Dangote Industries Ltd", "Zenith Agro Exports", "Lagos Port Logistics", "Kano Textile Mills", "Abuja Tech Imports"}

	for i, decl := range decls {
		lane := lanes[i%3]
		status := statuses[i%4]
		startedAt := time.Now().Add(-time.Duration(i*45+10) * time.Minute).UTC()
		activities := buildActivityDefinitions()

		// Simulate progress
		completedSteps := (i * 2) % len(activities)
		for j := range activities {
			if j < completedSteps {
				start := startedAt.Add(time.Duration(j*30) * time.Second)
				end := start.Add(time.Duration(800+rand.Intn(2000)) * time.Millisecond)
				activities[j].State = ActivityCompleted
				activities[j].StartedAt = &start
				activities[j].CompletedAt = &end
				activities[j].DurationMs = end.Sub(start).Milliseconds()
				activities[j].Lane = lane
			} else if j == completedSteps && status == WorkflowRunning {
				start := time.Now().Add(-500 * time.Millisecond).UTC()
				activities[j].State = ActivityRunning
				activities[j].StartedAt = &start
			}
		}

		slaMs := int64(4 * 60 * 60 * 1000) // 4h default
		if lane == "YELLOW" {
			slaMs = 24 * 60 * 60 * 1000
		} else if lane == "RED" {
			slaMs = 72 * 60 * 60 * 1000
		}

		wf := &WorkflowTrace{
			WorkflowID:    fmt.Sprintf("clearance-%s", decl),
			RunID:         fmt.Sprintf("run-%d", time.Now().UnixNano()+int64(i)),
			DeclarationID: decl,
			TraderID:      traders[i%len(traders)],
			Status:        status,
			StartedAt:     startedAt,
			Activities:    activities,
			CurrentStep:   completedSteps,
			TotalSteps:    len(activities),
			RiskLane:      lane,
			SLABreached:   time.Since(startedAt).Milliseconds() > slaMs,
			SLATargetMs:   slaMs,
		}
		if status == WorkflowCompleted {
			t := startedAt.Add(time.Duration(completedSteps*30+120) * time.Second)
			wf.CompletedAt = &t
			ms := t.Sub(startedAt).Milliseconds()
			wf.ClearanceTime = &ms
		}
		workflowStore[wf.WorkflowID] = wf
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
func (s *TemporalQueryService) GetWorkflowTrace(declarationID string) (*WorkflowTrace, error) {
	key := fmt.Sprintf("clearance-%s", declarationID)
	if wf, ok := workflowStore[key]; ok {
		return wf, nil
	}
	// Generate on-demand for unknown declarations
	activities := buildActivityDefinitions()
	startedAt := time.Now().Add(-2 * time.Minute).UTC()
	for i := range activities {
		if i < 2 {
			start := startedAt.Add(time.Duration(i*30) * time.Second)
			end := start.Add(time.Duration(800+i*400) * time.Millisecond)
			activities[i].State = ActivityCompleted
			activities[i].StartedAt = &start
			activities[i].CompletedAt = &end
			activities[i].DurationMs = end.Sub(start).Milliseconds()
		} else if i == 2 {
			start := time.Now().Add(-500 * time.Millisecond).UTC()
			activities[i].State = ActivityRunning
			activities[i].StartedAt = &start
		}
	}
	wf := &WorkflowTrace{
		WorkflowID:    key,
		RunID:         fmt.Sprintf("run-%d", time.Now().UnixNano()),
		DeclarationID: declarationID,
		Status:        WorkflowRunning,
		StartedAt:     startedAt,
		Activities:    activities,
		CurrentStep:   2,
		TotalSteps:    len(activities),
		RiskLane:      "YELLOW",
		SLATargetMs:   24 * 60 * 60 * 1000,
	}
	workflowStore[key] = wf
	return wf, nil
}

// ListWorkflows returns paginated workflow summaries with optional filtering.
func (s *TemporalQueryService) ListWorkflows(status, lane, search string, page, pageSize int) ([]WorkflowSummary, int) {
	var summaries []WorkflowSummary
	for _, wf := range workflowStore {
		if status != "" && string(wf.Status) != status {
			continue
		}
		if lane != "" && wf.RiskLane != lane {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(wf.DeclarationID), strings.ToLower(search)) &&
			!strings.Contains(strings.ToLower(wf.TraderID), strings.ToLower(search)) {
			continue
		}
		currentStepName := ""
		if wf.CurrentStep < len(wf.Activities) {
			currentStepName = wf.Activities[wf.CurrentStep].Name
		}
		pct := 0
		if wf.TotalSteps > 0 {
			pct = (wf.CurrentStep * 100) / wf.TotalSteps
		}
		summaries = append(summaries, WorkflowSummary{
			WorkflowID:        wf.WorkflowID,
			DeclarationNumber: wf.DeclarationID,
			TraderName:        wf.TraderID,
			Status:            wf.Status,
			CurrentStep:       currentStepName,
			RiskLane:          wf.RiskLane,
			StartedAt:         wf.StartedAt,
			SLABreached:       wf.SLABreached,
			ProgressPct:       pct,
		})
	}
	total := len(summaries)
	start := (page - 1) * pageSize
	if start >= total {
		return []WorkflowSummary{}, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return summaries[start:end], total
}

// GetStats returns aggregate workflow statistics.
func (s *TemporalQueryService) GetStats() WorkflowStats {
	stats := WorkflowStats{}
	today := time.Now().Truncate(24 * time.Hour)
	var greenCount, yellowCount, redCount int
	for _, wf := range workflowStore {
		if wf.Status == WorkflowRunning {
			stats.ActiveWorkflows++
		}
		if wf.StartedAt.After(today) {
			if wf.Status == WorkflowCompleted {
				stats.CompletedToday++
			}
			if wf.Status == WorkflowFailed {
				stats.FailedToday++
			}
			if wf.SLABreached {
				stats.SLABreachedToday++
			}
		}
		switch wf.RiskLane {
		case "GREEN":
			greenCount++
		case "YELLOW":
			yellowCount++
		case "RED":
			redCount++
		}
	}
	total := len(workflowStore)
	if total > 0 {
		stats.GreenLanePct = float64(greenCount) / float64(total) * 100
		stats.YellowLanePct = float64(yellowCount) / float64(total) * 100
		stats.RedLanePct = float64(redCount) / float64(total) * 100
	}
	stats.AvgClearanceTimeMs = 4 * 60 * 60 * 1000 // 4h average
	return stats
}

// SignalWorkflow sends a signal to a running workflow (e.g., approve, reject, escalate).
func (s *TemporalQueryService) SignalWorkflow(workflowID, signalName string, payload interface{}) error {
	wf, ok := workflowStore[workflowID]
	if !ok {
		return fmt.Errorf("workflow %s not found", workflowID)
	}
	if wf.Status != WorkflowRunning {
		return fmt.Errorf("workflow %s is not running (status: %s)", workflowID, wf.Status)
	}
	s.logger.Info("Workflow signal sent",
		zap.String("workflowId", workflowID),
		zap.String("signal", signalName),
	)
	// In production: use Temporal SDK client.SignalWorkflow()
	return nil
}

// CancelWorkflow cancels a running workflow.
func (s *TemporalQueryService) CancelWorkflow(workflowID, reason string) error {
	wf, ok := workflowStore[workflowID]
	if !ok {
		return fmt.Errorf("workflow %s not found", workflowID)
	}
	if wf.Status != WorkflowRunning {
		return fmt.Errorf("workflow %s is not running", workflowID)
	}
	wf.Status = WorkflowCancelled
	s.logger.Info("Workflow cancelled", zap.String("workflowId", workflowID), zap.String("reason", reason))
	return nil
}

// RetryWorkflow retries a failed workflow from the last failed activity.
func (s *TemporalQueryService) RetryWorkflow(workflowID string) (*WorkflowTrace, error) {
	wf, ok := workflowStore[workflowID]
	if !ok {
		return nil, fmt.Errorf("workflow %s not found", workflowID)
	}
	if wf.Status != WorkflowFailed {
		return nil, fmt.Errorf("workflow %s is not in FAILED state", workflowID)
	}
	// Reset failed activities and restart
	for i := range wf.Activities {
		if wf.Activities[i].State == ActivityFailed {
			wf.Activities[i].State = ActivityRetrying
			wf.Activities[i].RetryCount++
		}
	}
	wf.Status = WorkflowRunning
	wf.ErrorMessage = ""
	s.logger.Info("Workflow retried", zap.String("workflowId", workflowID))
	return wf, nil
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

func (s *TemporalQueryService) handleListWorkflows(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	status := q.Get("status")
	lane := q.Get("lane")
	search := q.Get("search")
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	workflows, total := s.ListWorkflows(status, lane, search, page, pageSize)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"workflows": workflows,
		"total":     total,
		"page":      page,
		"pageSize":  pageSize,
		"pages":     (total + pageSize - 1) / pageSize,
	})
}

func (s *TemporalQueryService) handleListActivities(w http.ResponseWriter, r *http.Request) {
	activities := buildActivityDefinitions()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"activities": activities,
		"total":      len(activities),
	})
}

func (s *TemporalQueryService) handleGetStats(w http.ResponseWriter, r *http.Request) {
	stats := s.GetStats()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (s *TemporalQueryService) handleSignalWorkflow(w http.ResponseWriter, r *http.Request) {
	workflowID := chi.URLParam(r, "workflowId")
	var req WorkflowSignal
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := s.SignalWorkflow(workflowID, req.SignalName, req.Payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "signal_sent", "workflowId": workflowID})
}

func (s *TemporalQueryService) handleCancelWorkflow(w http.ResponseWriter, r *http.Request) {
	workflowID := chi.URLParam(r, "workflowId")
	var req struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if err := s.CancelWorkflow(workflowID, req.Reason); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "cancelled", "workflowId": workflowID})
}

func (s *TemporalQueryService) handleRetryWorkflow(w http.ResponseWriter, r *http.Request) {
	workflowID := chi.URLParam(r, "workflowId")
	trace, err := s.RetryWorkflow(workflowID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(trace)
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
	r.Use(middleware.RequestID)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "ok",
			"service":      "temporal-query-service",
			"temporalHost": svc.temporalHost,
			"workflows":    len(workflowStore),
		})
	})

	// Workflow query endpoints
	r.Get("/api/workflows", svc.handleListWorkflows)
	r.Get("/api/workflows/stats", svc.handleGetStats)
	r.Get("/api/workflows/activities", svc.handleListActivities)
	r.Get("/api/workflows/{declarationId}/trace", svc.handleGetTrace)

	// Workflow management endpoints
	r.Post("/api/workflows/{workflowId}/signal", svc.handleSignalWorkflow)
	r.Post("/api/workflows/{workflowId}/cancel", svc.handleCancelWorkflow)
	r.Post("/api/workflows/{workflowId}/retry", svc.handleRetryWorkflow)

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
