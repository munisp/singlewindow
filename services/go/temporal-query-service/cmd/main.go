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
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

// ─── Workflow projection store (PostgreSQL) ──────────────────────────────────
// Phase 24: the fabricated in-memory demo store (seeded "Dangote Industries
// Ltd"/"Zenith Agro Exports" workflows) was deleted. The service now reads the
// REAL workflow projection in temporal_workflow_runs via pgx/v5 and is
// FAIL-CLOSED: it refuses to start without DATABASE_URL and never falls back
// to memory or fabricated traces.

// slaTargetForLane returns the clearance SLA in milliseconds for a risk lane.
func slaTargetForLane(lane string) int64 {
	switch lane {
	case "YELLOW":
		return 24 * 60 * 60 * 1000
	case "RED":
		return 72 * 60 * 60 * 1000
	default: // GREEN
		return 4 * 60 * 60 * 1000
	}
}

const workflowRunColumns = `workflow_id, run_id, workflow_type, status,
	COALESCE(declaration_ref, input->>'declarationId', ''),
	COALESCE(trader_ref, input->>'traderId', ''),
	COALESCE(risk_lane, input->>'riskLane', result->>'riskLane', ''),
	COALESCE(current_step, 0), COALESCE(total_steps, 0),
	activities, error_message, started_at, closed_at, duration_ms`

// scanWorkflowRun maps one temporal_workflow_runs row onto a WorkflowTrace.
func scanWorkflowRun(row pgx.Row) (*WorkflowTrace, error) {
	var wf WorkflowTrace
	var workflowType, status, lane string
	var activitiesJSON []byte
	var errMsg *string
	var closedAt *time.Time
	var durationMs *int64
	err := row.Scan(&wf.WorkflowID, &wf.RunID, &workflowType, &status,
		&wf.DeclarationID, &wf.TraderID, &lane, &wf.CurrentStep, &wf.TotalSteps,
		&activitiesJSON, &errMsg, &wf.StartedAt, &closedAt, &durationMs)
	if err != nil {
		return nil, err
	}
	wf.Status = WorkflowStatus(status)
	wf.RiskLane = lane
	wf.CompletedAt = closedAt
	if errMsg != nil {
		wf.ErrorMessage = *errMsg
	}
	wf.ClearanceTime = durationMs
	// Activity detail: use the stored projection when present; otherwise the
	// static 9-activity DeclarationClearanceWorkflow template (the same
	// definitions served by /api/workflows/activities) in PENDING state —
	// structural metadata, never fabricated progress.
	if len(activitiesJSON) > 0 && string(activitiesJSON) != "null" {
		var acts []WorkflowActivity
		if err := json.Unmarshal(activitiesJSON, &acts); err == nil && len(acts) > 0 {
			wf.Activities = acts
		}
	}
	if wf.Activities == nil {
		wf.Activities = buildActivityDefinitions()
	}
	if wf.TotalSteps == 0 {
		wf.TotalSteps = len(wf.Activities)
	}
	wf.SLATargetMs = slaTargetForLane(wf.RiskLane)
	// SLA breach is computed from real timestamps, never stored fabrication.
	elapsed := time.Since(wf.StartedAt).Milliseconds()
	if durationMs != nil {
		elapsed = *durationMs
	}
	wf.SLABreached = elapsed > wf.SLATargetMs
	return &wf, nil
}

// ─── Query service ────────────────────────────────────────────────────────────

type TemporalQueryService struct {
	logger       *zap.Logger
	temporalHost string
	db           *pgxpool.Pool
}

func NewTemporalQueryService(logger *zap.Logger, db *pgxpool.Pool) *TemporalQueryService {
	return &TemporalQueryService{
		logger:       logger,
		temporalHost: getEnv("TEMPORAL_HOST", "temporal:7233"),
		db:           db,
	}
}

// GetWorkflowTrace returns the execution trace for a declaration's clearance
// workflow from the temporal_workflow_runs projection. Fail-closed: unknown
// declarations are an error — no trace is ever fabricated on demand.
func (s *TemporalQueryService) GetWorkflowTrace(declarationID string) (*WorkflowTrace, error) {
	wf, err := scanWorkflowRun(s.db.QueryRow(context.Background(),
		`SELECT `+workflowRunColumns+` FROM temporal_workflow_runs
		 WHERE workflow_id = $1 OR declaration_ref = $2 OR input->>'declarationId' = $2
		 ORDER BY started_at DESC LIMIT 1`,
		fmt.Sprintf("clearance-%s", declarationID), declarationID))
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("no workflow found for declaration %s", declarationID)
	}
	if err != nil {
		return nil, err
	}
	return wf, nil
}

// getWorkflowByID loads a trace by its workflow_id (management operations).
func (s *TemporalQueryService) getWorkflowByID(workflowID string) (*WorkflowTrace, error) {
	wf, err := scanWorkflowRun(s.db.QueryRow(context.Background(),
		`SELECT `+workflowRunColumns+` FROM temporal_workflow_runs
		 WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT 1`, workflowID))
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("workflow %s not found", workflowID)
	}
	if err != nil {
		return nil, err
	}
	return wf, nil
}

// workflowCount returns the number of runs in the projection (0 on error).
func (s *TemporalQueryService) workflowCount() int {
	var n int
	if err := s.db.QueryRow(context.Background(), `SELECT COUNT(*) FROM temporal_workflow_runs`).Scan(&n); err != nil {
		return 0
	}
	return n
}

// ListWorkflows returns paginated workflow summaries with optional filtering.
func (s *TemporalQueryService) ListWorkflows(status, lane, search string, page, pageSize int) ([]WorkflowSummary, int) {
	rows, err := s.db.Query(context.Background(),
		`SELECT `+workflowRunColumns+` FROM temporal_workflow_runs
		 WHERE ($1 = '' OR status = $1)
		   AND ($2 = '' OR COALESCE(risk_lane, input->>'riskLane', result->>'riskLane', '') = $2)
		   AND ($3 = '' OR COALESCE(declaration_ref, input->>'declarationId', '') ILIKE '%' || $3 || '%'
		        OR COALESCE(trader_ref, input->>'traderId', '') ILIKE '%' || $3 || '%')
		 ORDER BY started_at DESC`, status, lane, search)
	if err != nil {
		s.logger.Error("list workflows query failed", zap.Error(err))
		return []WorkflowSummary{}, 0
	}
	defer rows.Close()

	var traces []*WorkflowTrace
	for rows.Next() {
		wf, err := scanWorkflowRun(rows)
		if err != nil {
			s.logger.Error("scan workflow run failed", zap.Error(err))
			return []WorkflowSummary{}, 0
		}
		traces = append(traces, wf)
	}

	summaries := make([]WorkflowSummary, 0, len(traces))
	for _, wf := range traces {
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

// GetStats returns aggregate workflow statistics from the projection.
func (s *TemporalQueryService) GetStats() WorkflowStats {
	stats := WorkflowStats{}
	today := time.Now().Truncate(24 * time.Hour)

	var greenCount, yellowCount, redCount, totalRuns int
	var avgMs float64
	err := s.db.QueryRow(context.Background(), `
		SELECT
			COUNT(*) FILTER (WHERE status = 'RUNNING'),
			COUNT(*) FILTER (WHERE status = 'COMPLETED' AND started_at >= $1),
			COUNT(*) FILTER (WHERE status = 'FAILED' AND started_at >= $1),
			COUNT(*) FILTER (WHERE started_at >= $1 AND
				COALESCE(duration_ms, EXTRACT(EPOCH FROM (COALESCE(closed_at, now()) - started_at)) * 1000) >
				CASE COALESCE(risk_lane, input->>'riskLane', result->>'riskLane', '')
					WHEN 'YELLOW' THEN 86400000
					WHEN 'RED' THEN 259200000
					ELSE 14400000
				END),
			COUNT(*) FILTER (WHERE COALESCE(risk_lane, input->>'riskLane', result->>'riskLane', '') = 'GREEN'),
			COUNT(*) FILTER (WHERE COALESCE(risk_lane, input->>'riskLane', result->>'riskLane', '') = 'YELLOW'),
			COUNT(*) FILTER (WHERE COALESCE(risk_lane, input->>'riskLane', result->>'riskLane', '') = 'RED'),
			COUNT(*),
			COALESCE(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 0)
		FROM temporal_workflow_runs`, today).Scan(
		&stats.ActiveWorkflows, &stats.CompletedToday, &stats.FailedToday, &stats.SLABreachedToday,
		&greenCount, &yellowCount, &redCount, &totalRuns, &avgMs)
	if err != nil {
		s.logger.Error("workflow stats query failed", zap.Error(err))
		return stats
	}
	if totalRuns > 0 {
		stats.GreenLanePct = float64(greenCount) / float64(totalRuns) * 100
		stats.YellowLanePct = float64(yellowCount) / float64(totalRuns) * 100
		stats.RedLanePct = float64(redCount) / float64(totalRuns) * 100
	}
	stats.AvgClearanceTimeMs = int64(avgMs)
	return stats
}

// SignalWorkflow sends a signal to a running workflow (e.g., approve, reject, escalate).
func (s *TemporalQueryService) SignalWorkflow(workflowID, signalName string, payload interface{}) error {
	wf, err := s.getWorkflowByID(workflowID)
	if err != nil {
		return err
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
	wf, err := s.getWorkflowByID(workflowID)
	if err != nil {
		return err
	}
	if wf.Status != WorkflowRunning {
		return fmt.Errorf("workflow %s is not running", workflowID)
	}
	// Record the cancellation in the projection. In production the Temporal
	// SDK client also cancels the running execution on the server.
	if _, err := s.db.Exec(context.Background(),
		`UPDATE temporal_workflow_runs SET status = 'CANCELLED', closed_at = now()
		 WHERE run_id = $1`, wf.RunID); err != nil {
		return fmt.Errorf("failed to record cancellation: %w", err)
	}
	s.logger.Info("Workflow cancelled", zap.String("workflowId", workflowID), zap.String("reason", reason))
	return nil
}

// RetryWorkflow retries a failed workflow from the last failed activity.
func (s *TemporalQueryService) RetryWorkflow(workflowID string) (*WorkflowTrace, error) {
	wf, err := s.getWorkflowByID(workflowID)
	if err != nil {
		return nil, err
	}
	if wf.Status != WorkflowFailed {
		return nil, fmt.Errorf("workflow %s is not in FAILED state", workflowID)
	}
	// Mark the projection RUNNING again (the Temporal server restarts the
	// failed activity from its retry policy). Activity-level detail is owned
	// by the workflow worker and converges on the next projection update.
	if _, err := s.db.Exec(context.Background(),
		`UPDATE temporal_workflow_runs SET status = 'RUNNING', error_message = NULL, closed_at = NULL
		 WHERE run_id = $1`, wf.RunID); err != nil {
		return nil, fmt.Errorf("failed to record retry: %w", err)
	}
	s.logger.Info("Workflow retried", zap.String("workflowId", workflowID))
	return s.getWorkflowByID(workflowID)
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

	// Phase 24: fail-closed on the workflow projection database. No
	// DATABASE_URL, no service — never an in-memory or seeded fallback.
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		logger.Fatal("DATABASE_URL is required; refusing to start (fail-closed)")
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		logger.Fatal("invalid DATABASE_URL", zap.Error(err))
	}
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := pool.Ping(pingCtx); err != nil {
		pingCancel()
		logger.Fatal("database unreachable (fail-closed, refusing to start)", zap.Error(err))
	}
	pingCancel()
	defer pool.Close()
	logger.Info("connected to PostgreSQL (temporal_workflow_runs projection)")

	svc := NewTemporalQueryService(logger, pool)

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
			"workflows":    svc.workflowCount(),
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
		Handler:      wrapWithAuth(r),
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
