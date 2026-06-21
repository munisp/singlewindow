// health_test.go — Unit tests for the Temporal worker health endpoint.
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ─── Test helpers ─────────────────────────────────────────────────────────────

// setupHealth initialises globalHealth with the given state for testing.
func setupHealth(connected bool, registered, expected int32) {
	globalHealth = &WorkerHealthState{
		startTime:         time.Now().Add(-10 * time.Second),
		workflowsExpected: expected,
		version:           "v63.0.0-test",
	}
	globalHealth.temporalConnected.Store(connected)
	globalHealth.workflowsRegistered.Store(registered)
}

// ─── /health endpoint ─────────────────────────────────────────────────────────

func TestHealthHandler_Healthy(t *testing.T) {
	setupHealth(true, 20, 20)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	healthHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	var resp HealthResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Status != "healthy" {
		t.Errorf("expected status healthy, got %s", resp.Status)
	}
	if !resp.TemporalConnected {
		t.Error("expected temporal_connected true")
	}
	if resp.WorkflowsRegistered != 20 {
		t.Errorf("expected 20 workflows registered, got %d", resp.WorkflowsRegistered)
	}
	if resp.WorkflowsExpected != 20 {
		t.Errorf("expected 20 workflows expected, got %d", resp.WorkflowsExpected)
	}
	if resp.UptimeSeconds < 1 {
		t.Errorf("expected uptime >= 1s, got %d", resp.UptimeSeconds)
	}
	if resp.Version != "v63.0.0-test" {
		t.Errorf("expected version v63.0.0-test, got %s", resp.Version)
	}
	if resp.Timestamp == "" {
		t.Error("timestamp must not be empty")
	}
}

func TestHealthHandler_Unhealthy_TemporalDisconnected(t *testing.T) {
	setupHealth(false, 20, 20)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	healthHandler(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rec.Code)
	}

	var resp HealthResponse
	json.NewDecoder(rec.Body).Decode(&resp) //nolint:errcheck
	if resp.Status != "unhealthy" {
		t.Errorf("expected status unhealthy, got %s", resp.Status)
	}
	if resp.TemporalConnected {
		t.Error("expected temporal_connected false")
	}
}

func TestHealthHandler_Degraded_WorkflowCountMismatch(t *testing.T) {
	setupHealth(true, 15, 20) // connected but only 15/20 workflows registered

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	healthHandler(rec, req)

	if rec.Code != http.StatusMultiStatus {
		t.Errorf("expected 207, got %d", rec.Code)
	}

	var resp HealthResponse
	json.NewDecoder(rec.Body).Decode(&resp) //nolint:errcheck
	if resp.Status != "degraded" {
		t.Errorf("expected status degraded, got %s", resp.Status)
	}
	if resp.WorkflowsRegistered != 15 {
		t.Errorf("expected 15 registered, got %d", resp.WorkflowsRegistered)
	}
}

func TestHealthHandler_NilGlobalHealth(t *testing.T) {
	globalHealth = nil

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	healthHandler(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when globalHealth is nil, got %d", rec.Code)
	}
}

// ─── /ready endpoint ──────────────────────────────────────────────────────────

func TestReadinessHandler_Ready(t *testing.T) {
	setupHealth(true, 20, 20)

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	rec := httptest.NewRecorder()
	readinessHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestReadinessHandler_NotReady_TemporalDisconnected(t *testing.T) {
	setupHealth(false, 20, 20)

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	rec := httptest.NewRecorder()
	readinessHandler(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rec.Code)
	}
}

func TestReadinessHandler_NotReady_WorkflowCountMismatch(t *testing.T) {
	setupHealth(true, 18, 20)

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	rec := httptest.NewRecorder()
	readinessHandler(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when workflows < expected, got %d", rec.Code)
	}
}

func TestReadinessHandler_NilGlobalHealth(t *testing.T) {
	globalHealth = nil

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	rec := httptest.NewRecorder()
	readinessHandler(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when globalHealth is nil, got %d", rec.Code)
	}
}

// ─── /live endpoint ───────────────────────────────────────────────────────────

func TestLivenessHandler_AlwaysAlive(t *testing.T) {
	// Liveness should return 200 regardless of health state
	globalHealth = nil

	req := httptest.NewRequest(http.MethodGet, "/live", nil)
	rec := httptest.NewRecorder()
	livenessHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for liveness, got %d", rec.Code)
	}
}

// ─── Response content-type ────────────────────────────────────────────────────

func TestHealthHandler_ContentType(t *testing.T) {
	setupHealth(true, 20, 20)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	healthHandler(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %s", ct)
	}
}

// ─── Uptime calculation ───────────────────────────────────────────────────────

func TestHealthHandler_UptimeIncreases(t *testing.T) {
	globalHealth = &WorkerHealthState{
		startTime:         time.Now().Add(-30 * time.Second),
		workflowsExpected: 20,
		version:           "v63.0.0-test",
	}
	globalHealth.temporalConnected.Store(true)
	globalHealth.workflowsRegistered.Store(20)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	healthHandler(rec, req)

	var resp HealthResponse
	json.NewDecoder(rec.Body).Decode(&resp) //nolint:errcheck

	if resp.UptimeSeconds < 29 {
		t.Errorf("expected uptime >= 29s for 30s old process, got %d", resp.UptimeSeconds)
	}
}

// ─── Concurrent access ────────────────────────────────────────────────────────

func TestHealthHandler_ConcurrentAccess(t *testing.T) {
	setupHealth(true, 20, 20)

	done := make(chan struct{})
	for i := 0; i < 50; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/health", nil)
			rec := httptest.NewRecorder()
			healthHandler(rec, req)
			done <- struct{}{}
		}()
	}
	for i := 0; i < 50; i++ {
		<-done
	}
}
