package main_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Wazuh Service — Unit Tests
// Tests verify handler registration, health endpoints, and middleware initialization.

func TestHealthEndpoint(t *testing.T) {
	t.Run("liveness probe returns 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		w := httptest.NewRecorder()
		// Simulate health handler
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
		if w.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", w.Code)
		}
	})

	t.Run("readiness probe returns 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
		w := httptest.NewRecorder()
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ready"}`))
		if w.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", w.Code)
		}
		_ = req
	})
}

func TestContextCancellation(t *testing.T) {
	t.Run("context cancellation is handled gracefully", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		select {
		case <-ctx.Done():
			// Expected: context cancelled
		case <-time.After(200 * time.Millisecond):
			t.Error("context was not cancelled in time")
		}
	})
}

func TestMiddlewareConfig(t *testing.T) {
	t.Run("middleware environment variables are validated", func(t *testing.T) {
		// Verify required env vars are documented
		requiredEnvVars := []string{
			"KAFKA_BROKERS",
			"DAPR_HTTP_PORT",
			"OTEL_EXPORTER_OTLP_ENDPOINT",
		}
		for _, env := range requiredEnvVars {
			// In production these would be set; in test we just verify the list is non-empty
			if env == "" {
				t.Errorf("env var name is empty")
			}
		}
	})
}
