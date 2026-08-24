// main_test.go — Smoke tests for the Fluvio consumer HTTP API
// These tests exercise the in-process HTTP handlers without requiring
// a live Fluvio cluster.
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

func buildTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	ring := newRingBuffer(50)
	r := gin.New()
	r.GET("/health", healthHandler)
	r.GET("/api/stream/events", recentEventsHandler(ring))
	return r
}

// ─── Tests ────────────────────────────────────────────────────────────────────

func TestHealthEndpoint(t *testing.T) {
	r := buildTestRouter()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode health response: %v", err)
	}
	if body["status"] != "unconfigured" {
		t.Errorf("expected status=unconfigured, got %v", body["status"])
	}
}

func TestGetEventsEmpty(t *testing.T) {
	r := buildTestRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/stream/events", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var response struct {
		Events []interface{} `json:"events"`
	}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode events response: %v", err)
	}
	if len(response.Events) != 0 {
		t.Errorf("expected empty events, got %d", len(response.Events))
	}
}

func TestSyntheticPublishEndpointRemoved(t *testing.T) {
	r := buildTestRouter()

	req := httptest.NewRequest(http.MethodPost, "/api/stream/publish", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected publish endpoint to be removed, got %d", w.Code)
	}
}

func TestRingBufferCapacity(t *testing.T) {
	rb := newRingBuffer(5)
	for i := 0; i < 10; i++ {
		rb.Push(CargoEvent{
			EventType: "TEST",
			PortCode:  "APAPA",
			Timestamp: time.Now(),
		})
	}
	events := rb.Recent(100, nil)
	if len(events) > 5 {
		t.Errorf("ring buffer exceeded capacity: got %d events, expected max 5", len(events))
	}
}
