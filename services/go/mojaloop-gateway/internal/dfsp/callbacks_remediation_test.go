package dfsp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"go.uber.org/zap"
)

// SW-MP2: settlement posts must use the canonical Go-bridge dialect
// /api/ledger/transfers/post|void/{pendingId} — never the phantom
// /transfers/post|void routes.
func TestTigerbeetlePostVoidUseCanonicalDialect(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"tb-1","status":"posted"}`))
	}))
	defer srv.Close()

	h := NewCallbackHandler(zap.NewNop())
	h.tigerbeetleURL = srv.URL

	if err := h.tigerbeetlePost(context.Background(), "pend-123"); err != nil {
		t.Fatalf("post failed: %v", err)
	}
	if err := h.tigerbeetleVoid(context.Background(), "pend-123"); err != nil {
		t.Fatalf("void failed: %v", err)
	}

	want := []string{
		"POST /api/ledger/transfers/post/pend-123",
		"POST /api/ledger/transfers/void/pend-123",
	}
	if len(paths) != 2 || paths[0] != want[0] || paths[1] != want[1] {
		t.Fatalf("non-canonical paths: %v", paths)
	}
}

// SW-MP2: default bridge URL is the canonical Service name and port.
func TestDefaultBridgeURLIsCanonical(t *testing.T) {
	t.Setenv("TIGERBEETLE_BRIDGE_URL", "")
	h := NewCallbackHandler(zap.NewNop())
	if h.tigerbeetleURL != "http://tigerbeetle-bridge:8086" {
		t.Fatalf("default bridge URL = %q, want http://tigerbeetle-bridge:8086", h.tigerbeetleURL)
	}
}

// SW-MP2: bridge errors propagate (no silent success).
func TestTigerbeetlePostPropagatesBridgeError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	h := NewCallbackHandler(zap.NewNop())
	h.tigerbeetleURL = srv.URL
	if err := h.tigerbeetlePost(context.Background(), "p"); err == nil {
		t.Fatal("bridge 500 must propagate as an error")
	}
}
