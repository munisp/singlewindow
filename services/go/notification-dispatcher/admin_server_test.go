package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

// freePort returns an available TCP port on localhost.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("freePort: %v", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// newTestAdminServer creates an AdminServer with a no-op TokenRefresher for testing.
func newTestAdminServer(t *testing.T) *AdminServer {
	t.Helper()
	// Build a minimal TokenRefresher using the constructor (nil deps are safe for unit tests).
	refresher := NewTokenRefresher(
		nil, // FCMClient — not called during HTTP handler tests
		nil, // TokenProvider
		nil, // PurgePublisher
		6*time.Hour,
		100,
	)
	addr := fmt.Sprintf("127.0.0.1:%d", freePort(t))
	return NewAdminServer(addr, refresher)
}

// ─── GET /healthz ─────────────────────────────────────────────────────────────

func TestAdminServer_Healthz_Returns200(t *testing.T) {
	as := newTestAdminServer(t)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	as.server.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestAdminServer_Healthz_ReturnsJSON(t *testing.T) {
	as := newTestAdminServer(t)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	as.server.Handler.ServeHTTP(rr, req)
	ct := rr.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("expected application/json content-type, got %q", ct)
	}
}

func TestAdminServer_Healthz_StatusOK(t *testing.T) {
	as := newTestAdminServer(t)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	as.server.Handler.ServeHTTP(rr, req)
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %q", body["status"])
	}
}

// ─── POST /admin/refresh-tokens ──────────────────────────────────────────────

func TestAdminServer_RefreshTokens_Returns202(t *testing.T) {
	as := newTestAdminServer(t)
	req := httptest.NewRequest(http.MethodPost, "/admin/refresh-tokens", nil)
	rr := httptest.NewRecorder()
	as.server.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d", rr.Code)
	}
}

func TestAdminServer_RefreshTokens_ReturnsAcceptedStatus(t *testing.T) {
	as := newTestAdminServer(t)
	req := httptest.NewRequest(http.MethodPost, "/admin/refresh-tokens", nil)
	rr := httptest.NewRecorder()
	as.server.Handler.ServeHTTP(rr, req)
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["status"] != "accepted" {
		t.Errorf("expected status=accepted, got %q", body["status"])
	}
}

func TestAdminServer_RefreshTokens_ReturnsMessage(t *testing.T) {
	as := newTestAdminServer(t)
	req := httptest.NewRequest(http.MethodPost, "/admin/refresh-tokens", nil)
	rr := httptest.NewRecorder()
	as.server.Handler.ServeHTTP(rr, req)
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["message"] == "" {
		t.Error("expected non-empty message field")
	}
}

func TestAdminServer_RefreshTokens_ReturnsJSON(t *testing.T) {
	as := newTestAdminServer(t)
	req := httptest.NewRequest(http.MethodPost, "/admin/refresh-tokens", nil)
	rr := httptest.NewRecorder()
	as.server.Handler.ServeHTTP(rr, req)
	ct := rr.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("expected application/json, got %q", ct)
	}
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

func TestAdminServer_Shutdown_Graceful(t *testing.T) {
	as := newTestAdminServer(t)
	// Start in background
	go func() { _ = as.Start() }()
	time.Sleep(50 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := as.Shutdown(ctx); err != nil {
		t.Errorf("Shutdown returned error: %v", err)
	}
}

// ─── NewAdminServer ───────────────────────────────────────────────────────────

func TestNewAdminServer_NotNil(t *testing.T) {
	as := newTestAdminServer(t)
	if as == nil {
		t.Fatal("NewAdminServer returned nil")
	}
}

func TestNewAdminServer_HasServer(t *testing.T) {
	as := newTestAdminServer(t)
	if as.server == nil {
		t.Fatal("AdminServer.server is nil")
	}
}

func TestNewAdminServer_HasRefresher(t *testing.T) {
	as := newTestAdminServer(t)
	if as.refresher == nil {
		t.Fatal("AdminServer.refresher is nil")
	}
}
