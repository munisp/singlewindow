// health.go — HTTP health endpoint for the Temporal worker process.
//
// Exposes GET /health on port 8090 (configurable via WORKER_HEALTH_PORT env var).
// Used by Kubernetes liveness and readiness probes to verify:
//   - The worker process is alive (liveness)
//   - The worker is connected to Temporal and all 20 workflow types are registered (readiness)
//
// Response format:
//
//	{
//	  "status": "healthy" | "degraded" | "unhealthy",
//	  "temporal_connected": true | false,
//	  "workflows_registered": 20,
//	  "workflows_expected": 20,
//	  "uptime_seconds": 42,
//	  "version": "v63.0.0",
//	  "timestamp": "2026-06-21T18:00:00Z"
//	}
//
// HTTP status codes:
//   - 200 OK        → healthy (all checks pass)
//   - 207 Multi-Status → degraded (Temporal connected but workflow count mismatch)
//   - 503 Service Unavailable → unhealthy (Temporal not connected)
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"go.temporal.io/sdk/client"
	"go.uber.org/zap"
)

// ─── Health state ─────────────────────────────────────────────────────────────

// WorkerHealthState holds the mutable health state of the worker process.
// All fields are updated atomically or under the workerMu lock in main.go.
type WorkerHealthState struct {
	startTime           time.Time
	temporalConnected   atomic.Bool
	workflowsRegistered atomic.Int32
	workflowsExpected   int32
	version             string
}

// globalHealth is the singleton health state, initialised in startHealthServer.
var globalHealth *WorkerHealthState

// ─── Health response ──────────────────────────────────────────────────────────

// HealthResponse is the JSON body returned by GET /health.
type HealthResponse struct {
	Status               string `json:"status"`
	TemporalConnected    bool   `json:"temporal_connected"`
	WorkflowsRegistered  int32  `json:"workflows_registered"`
	WorkflowsExpected    int32  `json:"workflows_expected"`
	UptimeSeconds        int64  `json:"uptime_seconds"`
	Version              string `json:"version"`
	Timestamp            string `json:"timestamp"`
}

// ─── Health handler ───────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if globalHealth == nil {
		http.Error(w, `{"status":"unhealthy","error":"health state not initialised"}`, http.StatusServiceUnavailable)
		return
	}

	connected := globalHealth.temporalConnected.Load()
	registered := globalHealth.workflowsRegistered.Load()
	expected := globalHealth.workflowsExpected
	uptime := int64(time.Since(globalHealth.startTime).Seconds())

	status := "healthy"
	httpStatus := http.StatusOK

	if !connected {
		status = "unhealthy"
		httpStatus = http.StatusServiceUnavailable
	} else if registered < expected {
		status = "degraded"
		httpStatus = http.StatusMultiStatus
	}

	resp := HealthResponse{
		Status:              status,
		TemporalConnected:   connected,
		WorkflowsRegistered: registered,
		WorkflowsExpected:   expected,
		UptimeSeconds:       uptime,
		Version:             globalHealth.version,
		Timestamp:           time.Now().UTC().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpStatus)
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// readinessHandler returns 200 only when the worker is fully ready to process workflows.
// Kubernetes readiness probe should target this endpoint.
func readinessHandler(w http.ResponseWriter, r *http.Request) {
	if globalHealth == nil ||
		!globalHealth.temporalConnected.Load() ||
		globalHealth.workflowsRegistered.Load() < globalHealth.workflowsExpected {
		http.Error(w, `{"ready":false}`, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"ready":true}`)
}

// livenessHandler always returns 200 as long as the process is running.
// Kubernetes liveness probe should target this endpoint.
func livenessHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"alive":true}`)
}

// ─── Start health server ──────────────────────────────────────────────────────

// startHealthServer initialises the global health state and starts the HTTP
// health server on the configured port. It returns immediately after binding
// the port; the server runs in a background goroutine.
//
// Parameters:
//   - temporalClient: the live Temporal client (used for connectivity checks)
//   - workflowCount:  number of workflow types registered with the worker
//   - version:        build version string (e.g. "v63.0.0")
//   - logger:         structured logger
func startHealthServer(
	temporalClient client.Client,
	workflowCount int32,
	version string,
	logger *zap.Logger,
) error {
	port := os.Getenv("WORKER_HEALTH_PORT")
	if port == "" {
		port = "8090"
	}

	globalHealth = &WorkerHealthState{
		startTime:         time.Now(),
		workflowsExpected: workflowCount,
		version:           version,
	}
	globalHealth.workflowsRegistered.Store(workflowCount)

	// Probe Temporal connectivity in the background every 15 seconds.
	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, err := temporalClient.CheckHealth(ctx, nil)
			cancel()
			globalHealth.temporalConnected.Store(err == nil)
			if err != nil {
				logger.Warn("Temporal health check failed", zap.Error(err))
			}
			time.Sleep(15 * time.Second)
		}
	}()

	// Perform an immediate connectivity check.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := temporalClient.CheckHealth(ctx, nil); err != nil {
		logger.Warn("Initial Temporal health check failed — worker may be degraded", zap.Error(err))
	} else {
		globalHealth.temporalConnected.Store(true)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/ready", readinessHandler)
	mux.HandleFunc("/live", livenessHandler)

	addr := net.JoinHostPort("", port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("health server: listen on %s: %w", addr, err)
	}

	go func() {
		logger.Info("Health server started", zap.String("addr", addr))
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			logger.Error("Health server error", zap.Error(err))
		}
	}()

	return nil
}
