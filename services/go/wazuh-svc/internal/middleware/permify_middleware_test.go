// permify_middleware_test.go — P0 remediation tests: fail-closed Permify.
// Covers: allowed → proceeds, denied → 403, Permify error → 503 (never allow),
// correct CHECK_RESULT_ALLOWED enum handling.
package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func permifyTestServer(t *testing.T, can string, status int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]interface{}{"can": can})
	}))
}

func testExtractor(r *http.Request) (string, string) { return "officer-1", "case-1" }

func TestPermifyCheck_AllowedEnum(t *testing.T) {
	srv := permifyTestServer(t, "CHECK_RESULT_ALLOWED", http.StatusOK)
	defer srv.Close()
	p := NewPermifyClient()
	p.baseURL = srv.URL
	allowed, err := p.CheckAuditPermission(context.Background(), "u", "e", "view")
	if err != nil || !allowed {
		t.Fatalf("CHECK_RESULT_ALLOWED should allow, got allowed=%v err=%v", allowed, err)
	}
}

func TestPermifyCheck_DeniedEnum(t *testing.T) {
	srv := permifyTestServer(t, "CHECK_RESULT_DENIED", http.StatusOK)
	defer srv.Close()
	p := NewPermifyClient()
	p.baseURL = srv.URL
	allowed, err := p.CheckAuditPermission(context.Background(), "u", "e", "view")
	if err != nil || allowed {
		t.Fatalf("CHECK_RESULT_DENIED should deny, got allowed=%v err=%v", allowed, err)
	}
}

func TestPermifyCheck_LegacyEnumNotAccepted(t *testing.T) {
	// The pre-remediation code matched the wrong enum ("RESULT_ALLOWED"),
	// making every check an implicit deny. The correct Permify v1 enum is
	// CHECK_RESULT_ALLOWED; the legacy value must NOT be treated as allowed.
	srv := permifyTestServer(t, "RESULT_ALLOWED", http.StatusOK)
	defer srv.Close()
	p := NewPermifyClient()
	p.baseURL = srv.URL
	allowed, err := p.CheckAuditPermission(context.Background(), "u", "e", "view")
	if err != nil || allowed {
		t.Fatalf("legacy RESULT_ALLOWED must not allow, got allowed=%v err=%v", allowed, err)
	}
}

func TestPermifyCheck_ErrorFailsClosed(t *testing.T) {
	p := NewPermifyClient()
	p.baseURL = "http://127.0.0.1:1" // unreachable
	allowed, err := p.CheckAuditPermission(context.Background(), "u", "e", "view")
	if err == nil || allowed {
		t.Fatalf("unreachable Permify must fail closed, got allowed=%v err=%v", allowed, err)
	}
}

func TestPermifyCheck_Non200FailsClosed(t *testing.T) {
	srv := permifyTestServer(t, "CHECK_RESULT_ALLOWED", http.StatusInternalServerError)
	defer srv.Close()
	p := NewPermifyClient()
	p.baseURL = srv.URL
	allowed, err := p.CheckAuditPermission(context.Background(), "u", "e", "view")
	if err == nil || allowed {
		t.Fatalf("Permify HTTP 500 must fail closed, got allowed=%v err=%v", allowed, err)
	}
}

func TestRequirePermission_AllowedProceeds(t *testing.T) {
	srv := permifyTestServer(t, "CHECK_RESULT_ALLOWED", http.StatusOK)
	defer srv.Close()
	p := NewPermifyClient()
	p.baseURL = srv.URL
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	rec := httptest.NewRecorder()
	p.RequirePermission("audit_record", "view", testExtractor)(ok).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("allowed request: got %d", rec.Code)
	}
}

func TestRequirePermission_Denied403(t *testing.T) {
	srv := permifyTestServer(t, "CHECK_RESULT_DENIED", http.StatusOK)
	defer srv.Close()
	p := NewPermifyClient()
	p.baseURL = srv.URL
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	rec := httptest.NewRecorder()
	p.RequirePermission("audit_record", "view", testExtractor)(ok).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("denied request: got %d, want 403", rec.Code)
	}
}

func TestRequirePermission_Error503(t *testing.T) {
	p := NewPermifyClient()
	p.baseURL = "http://127.0.0.1:1" // unreachable
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	rec := httptest.NewRecorder()
	p.RequirePermission("audit_record", "view", testExtractor)(ok).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("permify error: got %d, want 503 (fail-closed)", rec.Code)
	}
}
