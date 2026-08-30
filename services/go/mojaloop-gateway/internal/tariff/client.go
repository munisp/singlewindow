// Package tariff is the typed HTTP client for the blueeconomy-financial-controls
// tariff engine (Phase-9 WP-B; mirrors the Node server/_core/tariffClient.ts
// semantics).
//
// Contract (fincontrols internal/tariff/http.go @ d69e856):
//
//	POST /v1/tariffs/assess                      — Idempotency-Key header REQUIRED;
//	                                               201 Assessment on success
//	GET  /v1/tariffs/assessments/{id}            — 200 Assessment
//	GET  /healthz                                — liveness (unauthenticated)
//
// Resilience semantics:
//   - explicit per-attempt timeout (never an unbounded request),
//   - bounded retries: 3 attempts total, exponential backoff 200ms → 400ms
//     capped at 2s with equal jitter,
//   - retry ONLY on network errors / timeouts / 5xx; 4xx is returned
//     immediately and never retried,
//   - circuit breaker: CLOSED → OPEN after failureThreshold failures inside
//     the rolling window → HALF_OPEN after cooldown → CLOSED after
//     consecutive probe successes.
//
// Fail-closed guarantees:
//   - TARIFF_SERVICE_URL unset/invalid → ConfigError (never a phantom
//     endpoint, never a silent zero-rated assessment),
//   - unreachable after retries / breaker open → UnavailableError
//     (pipeline code DUTY_ASSESSMENT_UNAVAILABLE; NEVER a fabricated rate),
//   - 4xx from the engine → RejectedError with the upstream message.
//
// Authentication:
//   - When KEYCLOAK_TOKEN_URL / TARIFF_SERVICE_CLIENT_ID /
//     TARIFF_SERVICE_CLIENT_SECRET are ALL set, the client obtains an access
//     token via the OAuth2 client_credentials grant, caches it, refreshes it
//     within a safety margin of expiry, and forces one refresh if the engine
//     answers 401. Token-endpoint calls use the same resilience discipline
//     (per-attempt timeout, bounded retries with jitter, dedicated breaker).
//     A 4xx from the token endpoint is a definitive credential
//     misconfiguration → ConfigError, never retried.
//   - When NONE of them are set, the static TARIFF_SERVICE_TOKEN bearer is
//     the fallback. With no credential at all the client fails closed.
//   - A PARTIAL Keycloak set is a misconfiguration and fails closed with a
//     ConfigError — never a silent fallback.
//   - Tokens and client secrets NEVER appear in logs or error messages
//     (token-endpoint error bodies are reduced to the upstream error code).
package tariff

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/tradegateway/mojaloop-gateway/internal/telemetry"
)

// ─── Contract types (mirror fincontrols internal/tariff/model.go JSON) ────────

// AssessRequest is one voyage declaration for assessment.
type AssessRequest struct {
	VesselGRT            int64    `json:"vesselGrt"`
	VesselClass          string   `json:"vesselClass"`
	EntityRef            string   `json:"entityRef"`
	CargoCategory        string   `json:"cargoCategory"`
	VoyageType           string   `json:"voyageType"` // INTERNATIONAL | CABOTAGE
	RouteKind            string   `json:"routeKind"`  // SEA | INLAND_WATERWAY
	NigeriaPortCall      bool     `json:"nigeriaPortCall"`
	GrossFreightUSDMinor int64    `json:"grossFreightUsdMinor"`
	VoyageFlags          []string `json:"voyageFlags,omitempty"`
	AsOf                 string   `json:"asOf,omitempty"` // YYYY-MM-DD
}

// AssessmentLine is one instrument line of an assessment.
type AssessmentLine struct {
	LineNo             int    `json:"lineNo"`
	Instrument         string `json:"instrument"`
	Agency             string `json:"agency"`
	Applicability      string `json:"applicability"` // CHARGED | EXEMPT | NOT_APPLICABLE | UNRATED
	Basis              string `json:"basis"`
	StatutoryReference string `json:"statutoryReference,omitempty"`
	RateDescription    string `json:"rateDescription,omitempty"`
	AmountMinor        int64  `json:"amountMinor"`
	Currency           string `json:"currency"`
	ExemptionID        string `json:"exemptionId,omitempty"`
	Provisional        bool   `json:"provisional,omitempty"`
}

// Assessment is the immutable engine output.
type Assessment struct {
	AssessmentID  string           `json:"assessmentId"`
	Request       AssessRequest    `json:"request"`
	AsOf          string           `json:"asOf"`
	Lines         []AssessmentLine `json:"lines"`
	TotalUsdMinor int64            `json:"totalUsdMinor"`
	TotalNgnMinor int64            `json:"totalNgnMinor"`
	Requester     string           `json:"requester"`
	CorrelationID string           `json:"correlationId"`
	CreatedAt     string           `json:"createdAt"`
}

// ─── Typed errors ─────────────────────────────────────────────────────────────

// ConfigError reports a client misconfiguration (fail-closed at call time).
type ConfigError struct{ Reason string }

func (e *ConfigError) Error() string { return "tariff client misconfigured: " + e.Reason }

// UnavailableError reports the engine being unreachable after retries or the
// circuit breaker being open. Never carries a fabricated rate.
type UnavailableError struct{ Reason string }

func (e *UnavailableError) Error() string { return "tariff engine unavailable: " + e.Reason }

// RejectedError reports a 4xx from the engine (the request itself is invalid).
type RejectedError struct {
	Status  int
	Message string
}

func (e *RejectedError) Error() string {
	return fmt.Sprintf("tariff engine rejected the assessment (HTTP %d): %s", e.Status, e.Message)
}

// ─── Circuit breaker ──────────────────────────────────────────────────────────

type breakerState int

const (
	breakerClosed breakerState = iota
	breakerOpen
	breakerHalfOpen
)

type circuitBreaker struct {
	mu               sync.Mutex
	state            breakerState
	failureThreshold int
	cooldown         time.Duration
	window           time.Duration
	failures         []time.Time
	openedAt         time.Time
	halfOpenSuccess  int
	now              func() time.Time
}

func newCircuitBreaker() *circuitBreaker {
	return &circuitBreaker{
		failureThreshold: 5,
		cooldown:         30 * time.Second,
		window:           60 * time.Second,
		now:              time.Now,
	}
}

// allow reports whether a call may proceed, transitioning OPEN → HALF_OPEN
// once the cooldown has elapsed.
func (b *circuitBreaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case breakerOpen:
		if b.now().Sub(b.openedAt) >= b.cooldown {
			b.state = breakerHalfOpen
			b.halfOpenSuccess = 0
			return true
		}
		return false
	default:
		return true
	}
}

func (b *circuitBreaker) onSuccess() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.state == breakerHalfOpen {
		b.halfOpenSuccess++
		if b.halfOpenSuccess >= 2 {
			b.state = breakerClosed
			b.failures = nil
		}
		return
	}
	if b.state == breakerClosed {
		b.failures = nil
	}
}

func (b *circuitBreaker) onFailure() {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	if b.state == breakerHalfOpen {
		b.state = breakerOpen
		b.openedAt = now
		return
	}
	cutoff := now.Add(-b.window)
	kept := b.failures[:0]
	for _, f := range b.failures {
		if f.After(cutoff) {
			kept = append(kept, f)
		}
	}
	b.failures = append(kept, now)
	if len(b.failures) >= b.failureThreshold {
		b.state = breakerOpen
		b.openedAt = now
	}
}

// ─── Client ───────────────────────────────────────────────────────────────────

const (
	maxAttempts       = 3
	perAttemptTimeout = 5 * time.Second
	backoffBase       = 200 * time.Millisecond
	backoffCap        = 2 * time.Second
	tokenExpiryMargin = 30 * time.Second
)

// Client is the authenticated, resilient tariff-engine client.
type Client struct {
	baseURL    string
	httpClient *http.Client
	breaker    *circuitBreaker

	// static bearer (fallback when no Keycloak client-credentials configured)
	staticToken string

	// client-credentials configuration (all-or-nothing)
	tokenURL     string
	clientID     string
	clientSecret string
	tokenBreaker *circuitBreaker

	tokenMu  sync.Mutex
	token    string
	tokenExp time.Time

	// sleep is injectable for tests (bounded backoff waits only).
	sleep func(context.Context, time.Duration) error
}

// Config carries the environment-derived client configuration.
type Config struct {
	BaseURL          string // TARIFF_SERVICE_URL
	StaticToken      string // TARIFF_SERVICE_TOKEN
	KeycloakTokenURL string // KEYCLOAK_TOKEN_URL
	ClientID         string // TARIFF_SERVICE_CLIENT_ID
	ClientSecret     string // TARIFF_SERVICE_CLIENT_SECRET
}

// NewClient builds a client from explicit configuration. BaseURL is required;
// everything else follows the all-or-nothing auth rules documented above.
func NewClient(cfg Config) (*Client, error) {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		return nil, &ConfigError{Reason: "TARIFF_SERVICE_URL is not configured"}
	}
	parsed, err := url.Parse(base)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, &ConfigError{Reason: fmt.Sprintf("TARIFF_SERVICE_URL %q is not a valid http(s) URL", cfg.BaseURL)}
	}
	keycloakSet := cfg.KeycloakTokenURL != "" || cfg.ClientID != "" || cfg.ClientSecret != ""
	if keycloakSet && (cfg.KeycloakTokenURL == "" || cfg.ClientID == "" || cfg.ClientSecret == "") {
		return nil, &ConfigError{Reason: "partial Keycloak client-credentials configuration: KEYCLOAK_TOKEN_URL, TARIFF_SERVICE_CLIENT_ID and TARIFF_SERVICE_CLIENT_SECRET must ALL be set"}
	}
	if !keycloakSet && cfg.StaticToken == "" {
		return nil, &ConfigError{Reason: "no tariff engine credential configured (set TARIFF_SERVICE_TOKEN or the Keycloak client-credentials triple)"}
	}
	return &Client{
		baseURL: base,
		// No client-level timeout: the per-attempt context deadline governs.
		httpClient:   &http.Client{Transport: telemetry.Transport(nil)},
		breaker:      newCircuitBreaker(),
		staticToken:  cfg.StaticToken,
		tokenURL:     cfg.KeycloakTokenURL,
		clientID:     cfg.ClientID,
		clientSecret: cfg.ClientSecret,
		tokenBreaker: newCircuitBreaker(),
		sleep: func(ctx context.Context, d time.Duration) error {
			t := time.NewTimer(d)
			defer t.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-t.C:
				return nil
			}
		},
	}, nil
}

// jitteredBackoff returns base*2^(attempt-1) capped at backoffCap, then
// applies equal jitter: uniform in [d/2, d].
func jitteredBackoff(attempt int) time.Duration {
	d := backoffBase << (attempt - 1)
	if d > backoffCap {
		d = backoffCap
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(d/2)+1))
	if err != nil {
		return d / 2
	}
	return d/2 + time.Duration(n.Int64())
}

// Assess calls POST /v1/tariffs/assess. idempotencyKey is REQUIRED — the
// engine is replay-safe by idempotency key.
func (c *Client) Assess(ctx context.Context, idempotencyKey string, req AssessRequest) (*Assessment, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, &ConfigError{Reason: "an Idempotency-Key is required for /v1/tariffs/assess"}
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode assess request: %w", err)
	}

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if !c.breaker.allow() {
			return nil, &UnavailableError{Reason: "circuit breaker open — tariff engine calls suspended after repeated failures"}
		}
		assessment, retryable, err := c.assessOnce(ctx, idempotencyKey, body)
		if err == nil {
			c.breaker.onSuccess()
			return assessment, nil
		}
		var cfgErr *ConfigError
		var rejErr *RejectedError
		if errors.As(err, &cfgErr) || errors.As(err, &rejErr) {
			// Misconfiguration and 4xx rejections are definitive — no retry.
			return nil, err
		}
		c.breaker.onFailure()
		lastErr = err
		if !retryable {
			return nil, &UnavailableError{Reason: err.Error()}
		}
		if attempt < maxAttempts {
			if serr := c.sleep(ctx, jitteredBackoff(attempt)); serr != nil {
				return nil, &UnavailableError{Reason: "interrupted while retrying: " + serr.Error()}
			}
		}
	}
	return nil, &UnavailableError{Reason: fmt.Sprintf("exhausted %d attempts: %v", maxAttempts, lastErr)}
}

// assessOnce performs one HTTP attempt with a per-attempt deadline.
// retryable is true for network errors, timeouts and 5xx responses only.
// With client-credentials auth, a single forced token refresh is performed
// if the engine answers 401 (the refreshed request is the same attempt).
func (c *Client) assessOnce(ctx context.Context, idempotencyKey string, body []byte) (*Assessment, bool, error) {
	tracer := otel.Tracer("mojaloop-gateway")
	ctx, span := tracer.Start(ctx, "tariff.assess", trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()

	doRequest := func() (*http.Response, error) {
		attemptCtx, cancel := context.WithTimeout(ctx, perAttemptTimeout)
		defer cancel()
		httpReq, err := http.NewRequestWithContext(attemptCtx, http.MethodPost, c.baseURL+"/v1/tariffs/assess", bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("build assess request: %w", err)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Idempotency-Key", idempotencyKey)
		token, err := c.bearerToken(ctx)
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Authorization", "Bearer "+token)
		return c.httpClient.Do(httpReq)
	}

	resp, err := doRequest()
	if err != nil {
		var cfgErr *ConfigError
		var unavErr *UnavailableError
		if errors.As(err, &cfgErr) || errors.As(err, &unavErr) {
			span.RecordError(err)
			return nil, false, err
		}
		span.RecordError(err)
		return nil, true, fmt.Errorf("tariff engine call failed: %w", err)
	}

	// One forced token refresh on 401 when client-credentials auth is active.
	if resp.StatusCode == http.StatusUnauthorized && c.tokenURL != "" {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		c.invalidateToken()
		if resp, err = doRequest(); err != nil {
			span.RecordError(err)
			return nil, true, fmt.Errorf("tariff engine call failed after token refresh: %w", err)
		}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch {
	case resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusOK:
		var assessment Assessment
		if err := json.Unmarshal(respBody, &assessment); err != nil {
			return nil, false, fmt.Errorf("invalid assessment response: %w", err)
		}
		if assessment.AssessmentID == "" {
			return nil, false, errors.New("assessment response missing assessmentId")
		}
		span.SetAttributes(attribute.String("tariff.assessment_id", assessment.AssessmentID))
		return &assessment, false, nil
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		return nil, false, &RejectedError{Status: resp.StatusCode, Message: truncate(string(respBody), 256)}
	default:
		return nil, true, fmt.Errorf("tariff engine returned HTTP %d", resp.StatusCode)
	}
}

// bearerToken returns a valid bearer token, fetching one via client
// credentials when configured.
func (c *Client) bearerToken(ctx context.Context) (string, error) {
	if c.tokenURL == "" {
		return c.staticToken, nil
	}
	c.tokenMu.Lock()
	defer c.tokenMu.Unlock()
	if c.token != "" && time.Now().Add(tokenExpiryMargin).Before(c.tokenExp) {
		return c.token, nil
	}
	return c.fetchToken(ctx)
}

func (c *Client) invalidateToken() {
	c.tokenMu.Lock()
	defer c.tokenMu.Unlock()
	c.token = ""
	c.tokenExp = time.Time{}
}

// fetchToken performs the OAuth2 client_credentials grant with the same
// resilience discipline as engine calls. Caller holds tokenMu.
func (c *Client) fetchToken(ctx context.Context) (string, error) {
	tracer := otel.Tracer("mojaloop-gateway")
	ctx, span := tracer.Start(ctx, "tariff.token", trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()

	form := url.Values{"grant_type": {"client_credentials"}}
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if !c.tokenBreaker.allow() {
			return "", &ConfigError{Reason: "token endpoint circuit breaker open after repeated failures"}
		}
		attemptCtx, cancel := context.WithTimeout(ctx, perAttemptTimeout)
		req, err := http.NewRequestWithContext(attemptCtx, http.MethodPost, c.tokenURL, strings.NewReader(form.Encode()))
		if err != nil {
			cancel()
			return "", err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.SetBasicAuth(c.clientID, c.clientSecret)
		resp, err := c.httpClient.Do(req)
		if err != nil {
			cancel()
			c.tokenBreaker.onFailure()
			lastErr = err
			if attempt < maxAttempts {
				if serr := c.sleep(ctx, jitteredBackoff(attempt)); serr != nil {
					return "", &ConfigError{Reason: "interrupted while retrying token endpoint"}
				}
			}
			continue
		}
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		cancel()
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			// Definitive credential misconfiguration — never retried, and the
			// upstream body is reduced to the error code (no secret leakage).
			code := upstreamErrorCode(respBody)
			span.RecordError(errors.New("token endpoint 4xx"))
			return "", &ConfigError{Reason: fmt.Sprintf("token endpoint rejected credentials (HTTP %d, error=%s)", resp.StatusCode, code)}
		}
		if resp.StatusCode != http.StatusOK {
			c.tokenBreaker.onFailure()
			lastErr = fmt.Errorf("token endpoint returned HTTP %d", resp.StatusCode)
			if attempt < maxAttempts {
				if serr := c.sleep(ctx, jitteredBackoff(attempt)); serr != nil {
					return "", &ConfigError{Reason: "interrupted while retrying token endpoint"}
				}
			}
			continue
		}
		var tok struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int64  `json:"expires_in"`
		}
		if err := json.Unmarshal(respBody, &tok); err != nil || tok.AccessToken == "" {
			c.tokenBreaker.onFailure()
			lastErr = errors.New("token endpoint returned an invalid token response")
			continue
		}
		c.tokenBreaker.onSuccess()
		c.token = tok.AccessToken
		expiresIn := tok.ExpiresIn
		if expiresIn <= 0 {
			expiresIn = 300
		}
		c.tokenExp = time.Now().Add(time.Duration(expiresIn) * time.Second)
		return c.token, nil
	}
	return "", &UnavailableError{Reason: fmt.Sprintf("token endpoint unreachable after %d attempts: %v", maxAttempts, lastErr)}
}

// upstreamErrorCode extracts only the `error` field from an OAuth2 error
// body, truncated — token endpoint bodies can echo request details and must
// never leak into logs or errors.
func upstreamErrorCode(body []byte) string {
	var e struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &e); err != nil || e.Error == "" {
		return "unknown"
	}
	return truncate(e.Error, 64)
}

func truncate(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
