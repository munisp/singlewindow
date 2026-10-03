// cmd/worker/trigger.go — HTTP trigger endpoint for Temporal workflows.
//
// The Node gateway (server/routers/fund-flow.ts) POSTs to
// ${WORKFLOW_SERVICE_URL}/workflows/trigger with {workflow_type, input} and
// later polls GET /workflows/{workflowId}/status. The workflow-service is a
// Temporal worker and previously exposed NO such HTTP endpoint — every
// trigger call failed with connection-refused (Phase 26 F2 / G5 wiring
// defect). This file adds that endpoint, following the health.go pattern.
//
// Endpoints (default port 8200, TRIGGER_HTTP_PORT to override — 8200 matches
// the gateway's WORKFLOW_SERVICE_URL default):
//
//	POST /workflows/trigger              {"workflow_type": "...", "input": {...}}
//	                                     → 200 {"workflowId": "...", "runId": "..."}
//	                                     → 400 unknown workflow_type (fail-closed:
//	                                       only workflow types actually registered
//	                                       with the workers are accepted)
//	GET  /workflows/{workflowId}/status  → 200 {"status": "...", ...}
//	                                     → 404 unknown workflowId
//
// Fail-closed: the trigger server is only started when a Temporal address is
// configured (TEMPORAL_ADDRESS, falling back to the worker's TEMPORAL_HOST).
// Without one the port is never bound and callers get connection-refused.
//
// AUTH NOTE (out of Phase 26 F2 scope): authentication/authorization for this
// endpoint is owned by a parallel workstream (JWT middleware on the
// services/go cmd entrypoints). This endpoint MUST be fronted by that JWT
// middleware or the API gateway before it is reachable beyond the
// cluster-internal network.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"go.temporal.io/sdk/client"
	"go.uber.org/zap"

	"github.com/tradegateway/ngswtp/workflow-service/workflows"
)

// workflowTaskQueues maps every workflow type the gateway may trigger to the
// task queue its worker polls. Only workflow types actually registered in
// cmd/worker/main.go appear here — anything else is a 400 (fail-closed), so
// a misconfigured caller gets a loud client error, never a workflow that
// silently never runs.
var workflowTaskQueues = map[string]string{
	// Fund-flow task queue (ngswtp-fund-flow)
	"DutyDrawbackWorkflow":          workflows.TaskQueue,
	"BondLodgementWorkflow":         workflows.TaskQueue,
	"BondForfeitureWorkflow":        workflows.TaskQueue,
	"BondReleaseWorkflow":           workflows.TaskQueue,
	"TransitLodgementWorkflow":      workflows.TaskQueue,
	"TransitReleaseWorkflow":        workflows.TaskQueue,
	"ExBondDutyPaymentWorkflow":     workflows.TaskQueue,
	"AuditRecoveryWorkflow":         workflows.TaskQueue,
	"OverpaymentRefundWorkflow":     workflows.TaskQueue,
	"BatchSettlementWorkflow":       workflows.TaskQueue,
	"RevenueReconciliationWorkflow": workflows.TaskQueue,
	// Clearance task queue (ngswtp-clearance)
	"DeclarationClearanceWorkflow": workflows.ClearanceTaskQueue,
}

// triggerRequest is the POST /workflows/trigger body sent by fund-flow.ts.
type triggerRequest struct {
	WorkflowType string          `json:"workflow_type"`
	Input        json.RawMessage `json:"input"`
}

// triggerResponse mirrors the shape the gateway unmarshals:
// resp.json() as { workflowId: string; runId: string }.
type triggerResponse struct {
	WorkflowID string `json:"workflowId"`
	RunID      string `json:"runId"`
}

// statusResponse mirrors fund-flow.ts getWorkflowStatus:
// { status: string; result?: unknown; error?: string }.
type statusResponse struct {
	Status    string `json:"status"`
	StartTime string `json:"startTime,omitempty"`
	CloseTime string `json:"closeTime,omitempty"`
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failure is not a reason to refuse the trigger; fall back
		// to the nanosecond clock so the ID stays unique per process.
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// makeTriggerHandler starts the named Temporal workflow on the task queue its
// worker polls and returns {workflowId, runId}.
func makeTriggerHandler(c client.Client, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req triggerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
			return
		}
		taskQueue, ok := workflowTaskQueues[req.WorkflowType]
		if !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			known := make([]string, 0, len(workflowTaskQueues))
			for k := range workflowTaskQueues {
				known = append(known, k)
			}
			json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
				"error":           "unknown workflow_type",
				"workflow_type":   req.WorkflowType,
				"known_workflows": known,
			})
			return
		}

		// input is an optional JSON object passed as the workflow's single
		// argument; absent/null → start with no argument payload.
		var input any
		if len(req.Input) > 0 && string(req.Input) != "null" {
			if err := json.Unmarshal(req.Input, &input); err != nil {
				http.Error(w, `{"error":"input must be valid JSON"}`, http.StatusBadRequest)
				return
			}
		}

		workflowID := fmt.Sprintf("%s-%d-%s", req.WorkflowType, time.Now().UnixNano(), randHex(4))
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()

		opts := client.StartWorkflowOptions{
			ID:        workflowID,
			TaskQueue: taskQueue,
		}
		var run client.WorkflowRun
		var err error
		if input != nil {
			run, err = c.ExecuteWorkflow(ctx, opts, req.WorkflowType, input)
		} else {
			run, err = c.ExecuteWorkflow(ctx, opts, req.WorkflowType)
		}
		if err != nil {
			logger.Error("failed to start workflow",
				zap.String("workflow_type", req.WorkflowType),
				zap.String("task_queue", taskQueue),
				zap.Error(err),
			)
			http.Error(w, `{"error":"failed to start workflow"}`, http.StatusInternalServerError)
			return
		}

		logger.Info("workflow triggered",
			zap.String("workflow_type", req.WorkflowType),
			zap.String("workflow_id", run.GetID()),
			zap.String("run_id", run.GetRunID()),
			zap.String("task_queue", taskQueue),
		)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(triggerResponse{ //nolint:errcheck
			WorkflowID: run.GetID(),
			RunID:      run.GetRunID(),
		})
	}
}

// makeStatusHandler reports workflow execution status for
// fund-flow.ts getWorkflowStatus (404 propagates verbatim as NOT_FOUND).
func makeStatusHandler(c client.Client, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workflowID := r.PathValue("workflowId")
		if workflowID == "" {
			http.Error(w, `{"error":"workflowId required"}`, http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		// Empty run ID → describe the latest run of this workflow ID.
		resp, err := c.DescribeWorkflowExecution(ctx, workflowID, "")
		if err != nil {
			logger.Warn("workflow status lookup failed",
				zap.String("workflow_id", workflowID),
				zap.Error(err),
			)
			http.Error(w, `{"error":"workflow not found"}`, http.StatusNotFound)
			return
		}
		info := resp.WorkflowExecutionInfo
		out := statusResponse{Status: info.Status.String()}
		if info.StartTime != nil {
			out.StartTime = info.StartTime.AsTime().UTC().Format(time.RFC3339)
		}
		if info.CloseTime != nil {
			out.CloseTime = info.CloseTime.AsTime().UTC().Format(time.RFC3339)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(out) //nolint:errcheck
	}
}

// startTriggerServer binds the trigger HTTP server on TRIGGER_HTTP_PORT
// (default 8200 — the gateway's WORKFLOW_SERVICE_URL default) and returns.
// Fail-closed: without a configured Temporal address (TEMPORAL_ADDRESS, or
// TEMPORAL_HOST fallback) the port is never bound and the defect surfaces as
// connection-refused rather than silently queued calls.
func startTriggerServer(c client.Client, logger *zap.Logger) {
	if os.Getenv("TEMPORAL_ADDRESS") == "" && os.Getenv("TEMPORAL_HOST") == "" {
		logger.Warn("TEMPORAL_ADDRESS not configured — workflow trigger endpoint disabled (fail-closed)")
		return
	}

	port := os.Getenv("TRIGGER_HTTP_PORT")
	if port == "" {
		port = "8200"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /workflows/trigger", makeTriggerHandler(c, logger))
	mux.HandleFunc("GET /workflows/{workflowId}/status", makeStatusHandler(c, logger))

	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		// Same fail-fast posture as the health server: if the trigger port
		// cannot bind, the worker is not honestly reachable by the gateway.
		logger.Fatal("Failed to bind workflow trigger port", zap.String("port", port), zap.Error(err))
	}

	logger.Info("Workflow trigger endpoint listening",
		zap.String("port", port),
		zap.Int("known_workflows", len(workflowTaskQueues)),
	)

	go func() {
		if err := http.Serve(listener, mux); err != nil {
			logger.Error("Workflow trigger server failed", zap.Error(err))
		}
	}()
}
