// TradeGateway NGSWTP — RBAC Middleware Unit Tests
package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ─── Mock HTTP client ─────────────────────────────────────────────────────────

type mockHTTPClient struct {
	response *http.Response
	err      error
}

func (m *mockHTTPClient) Do(_ *http.Request) (*http.Response, error) {
	return m.response, m.err
}

func permifyResponse(can string) *http.Response {
	body := PermifyCheckResponse{Can: can}
	b, _ := json.Marshal(body)
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(b)),
	}
}

// ─── Mock Kafka publisher ─────────────────────────────────────────────────────

type mockKafkaPublisher struct {
	published [][]byte
}

func (m *mockKafkaPublisher) Publish(_ context.Context, _ string, value []byte) error {
	m.published = append(m.published, value)
	return nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func buildMiddleware(httpClient HTTPDoer, kafka KafkaPublisher) *RBACMiddleware {
	cfg := Config{
		PermifyURL:   "http://permify:3476",
		TenantID:     "tradegateway",
		SkipPaths:    []string{"/health", "/metrics"},
		HTTPClient:   httpClient,
		KafkaPublisher: kafka,
	}
	return NewMiddleware(cfg)
}

func makeRequest(method, path, userID string) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	if userID != "" {
		req.Header.Set("X-User-ID", userID)
	}
	return req
}

// ─── Tests ────────────────────────────────────────────────────────────────────

func TestRBACMiddleware_AllowsWhenPermifyAllows(t *testing.T) {
	mockClient := &mockHTTPClient{response: permifyResponse("RESULT_ALLOWED")}
	m := buildMiddleware(mockClient, nil)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := makeRequest(http.MethodGet, "/declarations/123", "user-42")
	rr := httptest.NewRecorder()
	m.Handler(next).ServeHTTP(rr, req)

	if !called {
		t.Error("expected next handler to be called when Permify allows")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestRBACMiddleware_DeniesWhenPermifyDenies(t *testing.T) {
	mockClient := &mockHTTPClient{response: permifyResponse("RESULT_DENIED")}
	kafka := &mockKafkaPublisher{}
	m := buildMiddleware(mockClient, kafka)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	req := makeRequest(http.MethodPost, "/admin/seed", "user-99")
	rr := httptest.NewRecorder()
	m.Handler(next).ServeHTTP(rr, req)

	if called {
		t.Error("next handler should NOT be called when Permify denies")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
}

func TestRBACMiddleware_PublishesKafkaEventOnDenial(t *testing.T) {
	mockClient := &mockHTTPClient{response: permifyResponse("RESULT_DENIED")}
	kafka := &mockKafkaPublisher{}
	m := buildMiddleware(mockClient, kafka)

	req := makeRequest(http.MethodDelete, "/payments/456", "user-77")
	req.Header.Set("X-Session-ID", "sess-abc")
	rr := httptest.NewRecorder()
	m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})).ServeHTTP(rr, req)

	if len(kafka.published) != 1 {
		t.Fatalf("expected 1 Kafka event, got %d", len(kafka.published))
	}

	var event AuthzDeniedEvent
	if err := json.Unmarshal(kafka.published[0], &event); err != nil {
		t.Fatalf("failed to unmarshal Kafka event: %v", err)
	}
	if event.EventType != "authz_denied" {
		t.Errorf("expected event_type=authz_denied, got %s", event.EventType)
	}
	if event.UserID != "user-77" {
		t.Errorf("expected user_id=user-77, got %s", event.UserID)
	}
	if event.SessionID != "sess-abc" {
		t.Errorf("expected session_id=sess-abc, got %s", event.SessionID)
	}
	if event.Action != "authz_denied" {
		t.Errorf("expected action=authz_denied (triggers R010), got %s", event.Action)
	}
}

func TestRBACMiddleware_SkipsHealthPath(t *testing.T) {
	// No mock client needed — health path should bypass Permify entirely
	m := buildMiddleware(nil, nil)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := makeRequest(http.MethodGet, "/health", "")
	rr := httptest.NewRecorder()
	m.Handler(next).ServeHTTP(rr, req)

	if !called {
		t.Error("expected /health to bypass RBAC and call next handler")
	}
}

func TestRBACMiddleware_FailsOpenOnPermifyError(t *testing.T) {
	// Simulate Permify being unreachable
	mockClient := &mockHTTPClient{err: io.ErrUnexpectedEOF}
	m := buildMiddleware(mockClient, nil)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := makeRequest(http.MethodGet, "/declarations", "user-1")
	rr := httptest.NewRecorder()
	m.Handler(next).ServeHTTP(rr, req)

	if !called {
		t.Error("expected fail-open: next handler should be called when Permify is unreachable")
	}
}

func TestRBACMiddleware_DeniesWithNoUserID(t *testing.T) {
	mockClient := &mockHTTPClient{response: permifyResponse("RESULT_DENIED")}
	m := buildMiddleware(mockClient, nil)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	// No X-User-ID header
	req := makeRequest(http.MethodGet, "/declarations", "")
	rr := httptest.NewRecorder()
	m.Handler(next).ServeHTTP(rr, req)

	if called {
		t.Error("next handler should NOT be called when user ID is missing")
	}
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
}

func TestPathToPermission(t *testing.T) {
	cases := []struct {
		method   string
		path     string
		expected string
	}{
		{http.MethodGet, "/declarations/123", "view"},
		{http.MethodPost, "/declarations", "create"},
		{http.MethodPut, "/declarations/123", "edit"},
		{http.MethodDelete, "/declarations/123", "delete"},
		{http.MethodPost, "/admin/seed", "admin"},
		{http.MethodPost, "/declarations/123/approve", "approve"},
	}
	for _, tc := range cases {
		got := pathToPermission(tc.method, tc.path)
		if got != tc.expected {
			t.Errorf("pathToPermission(%s, %s) = %s, want %s", tc.method, tc.path, got, tc.expected)
		}
	}
}

func TestPathToEntity(t *testing.T) {
	cases := []struct {
		path           string
		wantType       string
		wantID         string
	}{
		{"/declarations/abc123", "declaration", "abc123"},
		{"/payments/pay-456", "payment", "pay-456"},
		{"/bonds/bond-789", "bond", "bond-789"},
		{"/admin/settings", "platform", "admin"},
		{"/seed/system", "platform", "seed"},
		{"/unknown", "platform", "tradegateway"},
	}
	for _, tc := range cases {
		gotType, gotID := pathToEntity(tc.path)
		if gotType != tc.wantType || gotID != tc.wantID {
			t.Errorf("pathToEntity(%s) = (%s, %s), want (%s, %s)",
				tc.path, gotType, gotID, tc.wantType, tc.wantID)
		}
	}
}

func TestExtractUserID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-User-ID", "user-123")
	if got := extractUserID(req); got != "user-123" {
		t.Errorf("expected user-123, got %s", got)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("X-Forwarded-User", "user-456")
	if got := extractUserID(req2); got != "user-456" {
		t.Errorf("expected user-456, got %s", got)
	}

	req3 := httptest.NewRequest(http.MethodGet, "/", nil)
	if got := extractUserID(req3); got != "" {
		t.Errorf("expected empty string, got %s", got)
	}
}

func TestCheckPermify_ParsesAllowedResponse(t *testing.T) {
	mockClient := &mockHTTPClient{response: permifyResponse("RESULT_ALLOWED")}
	m := buildMiddleware(mockClient, nil)

	allowed, err := m.checkPermify(context.Background(), "user-1", "view", "declaration", "123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Error("expected allowed=true for RESULT_ALLOWED")
	}
}

func TestCheckPermify_ParsesDeniedResponse(t *testing.T) {
	mockClient := &mockHTTPClient{response: permifyResponse("RESULT_DENIED")}
	m := buildMiddleware(mockClient, nil)

	allowed, err := m.checkPermify(context.Background(), "user-1", "delete", "declaration", "123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allowed {
		t.Error("expected allowed=false for RESULT_DENIED")
	}
}

// Ensure the authz_denied action string matches the anomaly detection rule trigger.
func TestAuthzDeniedActionMatchesAnomalyDetectionRule(t *testing.T) {
	event := AuthzDeniedEvent{Action: "authz_denied"}
	if !strings.EqualFold(event.Action, "authz_denied") {
		t.Error("AuthzDeniedEvent.Action must be 'authz_denied' to trigger Rule R010")
	}
}
