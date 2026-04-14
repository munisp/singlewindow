// main_test.go — Smoke tests for the Fluvio consumer HTTP API
// These tests exercise the in-process HTTP handlers without requiring
// a live Fluvio cluster.
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

func buildTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	logger := zap.NewNop()
	ring := newRingBuffer(50)
	hub := newHub(logger)
	r := gin.New()
	r.GET("/health", healthHandler)
	r.GET("/api/stream/events", recentEventsHandler(ring))
	r.POST("/api/stream/publish", publishHandler(ring, hub))
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
	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", body["status"])
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
	var events []interface{}
	if err := json.NewDecoder(w.Body).Decode(&events); err != nil {
		t.Fatalf("failed to decode events response: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("expected empty events, got %d", len(events))
	}
}

func TestPublishAndRetrieveEvent(t *testing.T) {
	r := buildTestRouter()

	// Publish a synthetic event
	payload := `{"declarationId":1,"eventType":"CARGO_ARRIVED","port":"APAPA","timestamp":"` +
		time.Now().UTC().Format(time.RFC3339) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/stream/publish", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("publish failed with %d: %s", w.Code, w.Body.String())
	}

	// Retrieve events
	req2 := httptest.NewRequest(http.MethodGet, "/api/stream/events?limit=10", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("get events failed with %d", w2.Code)
	}
	var events []map[string]interface{}
	if err := json.NewDecoder(w2.Body).Decode(&events); err != nil {
		t.Fatalf("failed to decode events: %v", err)
	}
	if len(events) == 0 {
		t.Error("expected at least 1 event after publish")
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
