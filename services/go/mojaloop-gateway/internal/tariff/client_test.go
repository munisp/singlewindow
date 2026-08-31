// Tests for the tariff engine client — REAL local httptest servers only;
// no interface mocks at the HTTP boundary.
package tariff

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func validRequest() AssessRequest {
	return AssessRequest{
		VesselGRT:            25000,
		VesselClass:          "CONTAINER",
		EntityRef:            "DECL-001",
		CargoCategory:        "CONTAINERIZED",
		VoyageType:           "INTERNATIONAL",
		RouteKind:            "SEA",
		NigeriaPortCall:      true,
		GrossFreightUSDMinor: 4200000,
	}
}

func newTestClient(t *testing.T, cfg Config) *Client {
	t.Helper()
	c, err := NewClient(cfg)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	// Deterministic, fast backoff in tests (bounded waits are exercised for
	// real in the pipeline tests; here we only need the retry mechanics).
	c.sleep = func(context.Context, time.Duration) error { return nil }
	return c
}

func TestNewClientConfigErrors(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
	}{
		{"empty base URL", Config{}},
		{"invalid base URL", Config{BaseURL: "not-a-url", StaticToken: "x"}},
		{"no credential", Config{BaseURL: "http://localhost:9"}},
		{"partial keycloak: missing secret", Config{BaseURL: "http://localhost:9", KeycloakTokenURL: "http://kc/token", ClientID: "svc"}},
		{"partial keycloak: missing token url", Config{BaseURL: "http://localhost:9", ClientID: "svc", ClientSecret: "s"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewClient(tc.cfg)
			var cfgErr *ConfigError
			if !errors.As(err, &cfgErr) {
				t.Fatalf("expected ConfigError, got %v", err)
			}
		})
	}
}

func TestAssessHappyPathStaticToken(t *testing.T) {
	// Install a real tracer provider + W3C propagator so the traceparent
	// injection on the outbound request is observable (production wires this
	// via telemetry.Init; the no-op default cannot produce a header).
	tp := sdktrace.NewTracerProvider()
	defer tp.Shutdown(context.Background())
	prevTP, prevProp := otel.GetTracerProvider(), otel.GetTextMapPropagator()
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	defer func() { otel.SetTracerProvider(prevTP); otel.SetTextMapPropagator(prevProp) }()

	var gotIdemKey, gotAuth, gotTraceparent string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/tariffs/assess" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		gotIdemKey = r.Header.Get("Idempotency-Key")
		gotAuth = r.Header.Get("Authorization")
		gotTraceparent = r.Header.Get("traceparent")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(Assessment{
			AssessmentID:  "asm-123",
			AsOf:          "2026-08-30",
			Lines:         []AssessmentLine{{LineNo: 1, Instrument: "NPA_SHIP_DUES", Agency: "NPA", Applicability: "CHARGED", AmountMinor: 123456, Currency: "USD"}},
			TotalUsdMinor: 123456,
			Requester:     "test-subject",
		})
	}))
	defer srv.Close()

	c := newTestClient(t, Config{BaseURL: srv.URL, StaticToken: "static-test-token"})
	a, err := c.Assess(context.Background(), "PAY-test-1", validRequest())
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.AssessmentID != "asm-123" || a.TotalUsdMinor != 123456 {
		t.Fatalf("unexpected assessment %+v", a)
	}
	if gotIdemKey != "PAY-test-1" {
		t.Fatalf("Idempotency-Key not propagated: %q", gotIdemKey)
	}
	if gotAuth != "Bearer static-test-token" {
		t.Fatalf("static bearer not sent: %q", gotAuth)
	}
	if gotTraceparent == "" {
		t.Fatal("traceparent header missing — W3C propagation must be injected")
	}
}

func TestAssessRequiresIdempotencyKey(t *testing.T) {
	c := newTestClient(t, Config{BaseURL: "http://127.0.0.1:1", StaticToken: "x"})
	_, err := c.Assess(context.Background(), "", validRequest())
	var cfgErr *ConfigError
	if !errors.As(err, &cfgErr) {
		t.Fatalf("expected ConfigError, got %v", err)
	}
}

func TestAssessRejected4xxNeverRetried(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"vesselGrt must be positive"}`))
	}))
	defer srv.Close()

	c := newTestClient(t, Config{BaseURL: srv.URL, StaticToken: "x"})
	_, err := c.Assess(context.Background(), "PAY-4xx", validRequest())
	var rejErr *RejectedError
	if !errors.As(err, &rejErr) {
		t.Fatalf("expected RejectedError, got %v", err)
	}
	if rejErr.Status != http.StatusBadRequest {
		t.Fatalf("unexpected status %d", rejErr.Status)
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("4xx must never be retried: got %d requests", got)
	}
}

func TestAssessRetries5xxThenUnavailable(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	c := newTestClient(t, Config{BaseURL: srv.URL, StaticToken: "x"})
	_, err := c.Assess(context.Background(), "PAY-5xx", validRequest())
	var unavErr *UnavailableError
	if !errors.As(err, &unavErr) {
		t.Fatalf("expected UnavailableError, got %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != maxAttempts {
		t.Fatalf("expected %d attempts, got %d", maxAttempts, got)
	}
}

func TestAssessNetworkErrorRetries(t *testing.T) {
	// Port 1 is not listening — every attempt is a network error.
	c := newTestClient(t, Config{BaseURL: "http://127.0.0.1:1", StaticToken: "x"})
	start := time.Now()
	_, err := c.Assess(context.Background(), "PAY-net", validRequest())
	var unavErr *UnavailableError
	if !errors.As(err, &unavErr) {
		t.Fatalf("expected UnavailableError, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > 10*time.Second {
		t.Fatalf("bounded retries took too long: %v", elapsed)
	}
}

func TestCircuitBreakerOpensAndStaysOpen(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := newTestClient(t, Config{BaseURL: srv.URL, StaticToken: "x"})
	// Two Assess calls = 6 breaker failures (3 attempts each) >= threshold 5.
	for i := 0; i < 2; i++ {
		_, _ = c.Assess(context.Background(), "PAY-cb", validRequest())
	}
	before := atomic.LoadInt32(&hits)
	_, err := c.Assess(context.Background(), "PAY-cb", validRequest())
	var unavErr *UnavailableError
	if !errors.As(err, &unavErr) {
		t.Fatalf("expected UnavailableError, got %v", err)
	}
	if after := atomic.LoadInt32(&hits); after != before {
		t.Fatalf("breaker open must not hit the engine: before=%d after=%d", before, after)
	}
}

func TestClientCredentialsFlow(t *testing.T) {
	const tokenValue = "kc-issued-token-1"
	var tokenCalls int32
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&tokenCalls, 1)
		if err := r.ParseForm(); err != nil {
			t.Errorf("token form parse: %v", err)
		}
		if r.Form.Get("grant_type") != "client_credentials" {
			t.Errorf("unexpected grant_type %q", r.Form.Get("grant_type"))
		}
		user, pass, ok := r.BasicAuth()
		if !ok || user != "svc-tariff" || pass != "s3cret" {
			t.Errorf("basic auth credentials missing/wrong")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"access_token": tokenValue, "expires_in": 300, "token_type": "Bearer"})
	}))
	defer tokenSrv.Close()

	var engineAuth string
	engineSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		engineAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(Assessment{AssessmentID: "asm-kc", TotalUsdMinor: 7})
	}))
	defer engineSrv.Close()

	c := newTestClient(t, Config{
		BaseURL:          engineSrv.URL,
		KeycloakTokenURL: tokenSrv.URL,
		ClientID:         "svc-tariff",
		ClientSecret:     "s3cret",
	})
	a, err := c.Assess(context.Background(), "PAY-kc", validRequest())
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.AssessmentID != "asm-kc" {
		t.Fatalf("unexpected assessment %+v", a)
	}
	if engineAuth != "Bearer "+tokenValue {
		t.Fatalf("engine did not receive the Keycloak token: %q", engineAuth)
	}
	if got := atomic.LoadInt32(&tokenCalls); got != 1 {
		t.Fatalf("token should be cached across the call: tokenCalls=%d", got)
	}

	// Second call reuses the cached token — no new token request.
	if _, err := c.Assess(context.Background(), "PAY-kc-2", validRequest()); err != nil {
		t.Fatalf("Assess 2: %v", err)
	}
	if got := atomic.LoadInt32(&tokenCalls); got != 1 {
		t.Fatalf("cached token not reused: tokenCalls=%d", got)
	}
}

func TestClientCredentialsForcedRefreshOn401(t *testing.T) {
	var tokenCalls int32
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&tokenCalls, 1)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": fmt.Sprintf("token-v%d", n),
			"expires_in":   300,
		})
	}))
	defer tokenSrv.Close()

	var engineHits int32
	engineSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&engineHits, 1)
		if n == 1 {
			// First (cached) token is rejected once.
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Authorization") != "Bearer token-v2" {
			t.Errorf("expected refreshed token-v2, got %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(Assessment{AssessmentID: "asm-refresh"})
	}))
	defer engineSrv.Close()

	c := newTestClient(t, Config{
		BaseURL:          engineSrv.URL,
		KeycloakTokenURL: tokenSrv.URL,
		ClientID:         "svc-tariff",
		ClientSecret:     "s3cret",
	})
	a, err := c.Assess(context.Background(), "PAY-refresh", validRequest())
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.AssessmentID != "asm-refresh" {
		t.Fatalf("unexpected assessment %+v", a)
	}
	if got := atomic.LoadInt32(&tokenCalls); got != 2 {
		t.Fatalf("expected one forced refresh (2 token calls), got %d", got)
	}
}

func TestTokenEndpoint4xxIsConfigError(t *testing.T) {
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"invalid_client","error_description":"client secret wrong: s3cret must not leak"}`))
	}))
	defer tokenSrv.Close()

	c := newTestClient(t, Config{
		BaseURL:          "http://127.0.0.1:1",
		KeycloakTokenURL: tokenSrv.URL,
		ClientID:         "svc-tariff",
		ClientSecret:     "s3cret",
	})
	_, err := c.Assess(context.Background(), "PAY-tok4xx", validRequest())
	var cfgErr *ConfigError
	if !errors.As(err, &cfgErr) {
		t.Fatalf("expected ConfigError, got %v", err)
	}
	// The upstream body contained the secret — the error must reduce to the code.
	if got := cfgErr.Error(); !strings.Contains(got, "invalid_client") || strings.Contains(got, "s3cret") {
		t.Fatalf("token error must carry the code but never the secret: %q", got)
	}
}
