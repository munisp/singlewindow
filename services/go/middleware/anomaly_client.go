// TradeGateway NGSWTP — Anomaly Detection HTTP Client
// Language: Go 1.22+
//
// AnomalyClient calls the Python insider-threat-svc POST /detect endpoint.
// It implements:
//   - Configurable timeout (default 500ms) to never block the hot path
//   - Exponential-backoff retry (max 2 attempts) for transient errors
//   - Simple circuit breaker: after 5 consecutive failures the client
//     short-circuits and returns (score=0, err=nil) until a probe succeeds
//   - Graceful degradation: any error returns (score=0, err=nil) so the
//     RBAC middleware can fail open without blocking legitimate traffic
//
// The circuit breaker is intentionally simple (no goroutine, no ticker) to
// keep the hot-path overhead minimal. A half-open probe fires automatically
// on the next request after the cooldown window (30s by default).

package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// AnomalyFeatures are the five behavioural features fed to the IsolationForest model.
type AnomalyFeatures struct {
	HourOfDay              int     `json:"hour_of_day"`
	ActionCountPerHour     int     `json:"action_count_per_hour"`
	UniqueRecordsAccessed  int     `json:"unique_records_accessed"`
	OffHoursFlag           int     `json:"off_hours_flag"` // 0 or 1
	RoleMismatchScore      float64 `json:"role_mismatch_score"` // 0.0–1.0
}

// AnomalyDetectRequest is the payload for POST /detect.
type AnomalyDetectRequest struct {
	UserID    string          `json:"user_id"`
	SessionID string          `json:"session_id"`
	Action    string          `json:"action"`
	Features  AnomalyFeatures `json:"features"`
}

// AnomalyDetectResponse is the response from POST /detect.
type AnomalyDetectResponse struct {
	AnomalyScore float64 `json:"anomaly_score"` // 0.0–1.0; higher = more anomalous
	IsAnomaly    bool    `json:"is_anomaly"`
	RuleID       string  `json:"rule_id,omitempty"`
	Description  string  `json:"description,omitempty"`
}

// AnomalyClientConfig configures the AnomalyClient.
type AnomalyClientConfig struct {
	// BaseURL is the base URL of the Python insider-threat-svc (e.g. http://insider-threat-svc:8080).
	BaseURL string
	// Timeout is the per-request timeout. Default: 500ms.
	Timeout time.Duration
	// MaxRetries is the maximum number of retry attempts. Default: 2.
	MaxRetries int
	// CircuitBreakerThreshold is the number of consecutive failures before
	// the circuit opens. Default: 5.
	CircuitBreakerThreshold int64
	// CircuitBreakerCooldown is how long the circuit stays open before a
	// half-open probe is attempted. Default: 30s.
	CircuitBreakerCooldown time.Duration
	// BlockThreshold is the anomaly score above which the RBAC middleware
	// should block the request. Default: 0.85.
	BlockThreshold float64
	// HTTPClient is the HTTP client (injectable for testing).
	HTTPClient HTTPDoer
	// Logger is the logger for anomaly client events.
	Logger *log.Logger
}

// DefaultAnomalyClientConfig returns a Config populated from environment variables.
func DefaultAnomalyClientConfig() AnomalyClientConfig {
	return AnomalyClientConfig{
		BaseURL:                 getEnv("INSIDER_THREAT_SVC_URL", "http://insider-threat-svc:8080"),
		Timeout:                 500 * time.Millisecond,
		MaxRetries:              2,
		CircuitBreakerThreshold: 5,
		CircuitBreakerCooldown:  30 * time.Second,
		BlockThreshold:          0.85,
		Logger:                  log.New(os.Stdout, "[AnomalyClient] ", log.LstdFlags),
	}
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

type circuitState int32

const (
	circuitClosed   circuitState = 0 // normal operation
	circuitOpen     circuitState = 1 // failing fast
	circuitHalfOpen circuitState = 2 // probe in progress
)

type circuitBreaker struct {
	state            atomic.Int32
	consecutiveFails atomic.Int64
	threshold        int64
	cooldown         time.Duration
	openedAt         time.Time
	mu               sync.Mutex
}

func newCircuitBreaker(threshold int64, cooldown time.Duration) *circuitBreaker {
	return &circuitBreaker{threshold: threshold, cooldown: cooldown}
}

// allow returns true if the request should be sent to the upstream service.
func (cb *circuitBreaker) allow() bool {
	state := circuitState(cb.state.Load())
	switch state {
	case circuitClosed:
		return true
	case circuitOpen:
		cb.mu.Lock()
		defer cb.mu.Unlock()
		if time.Since(cb.openedAt) >= cb.cooldown {
			// Transition to half-open for a probe
			cb.state.Store(int32(circuitHalfOpen))
			return true
		}
		return false
	case circuitHalfOpen:
		return false // Only one probe at a time
	}
	return true
}

// recordSuccess resets the circuit breaker to closed state.
func (cb *circuitBreaker) recordSuccess() {
	cb.consecutiveFails.Store(0)
	cb.state.Store(int32(circuitClosed))
}

// recordFailure increments the failure counter and opens the circuit if threshold is reached.
func (cb *circuitBreaker) recordFailure() {
	fails := cb.consecutiveFails.Add(1)
	if fails >= cb.threshold {
		cb.mu.Lock()
		cb.openedAt = time.Now()
		cb.mu.Unlock()
		cb.state.Store(int32(circuitOpen))
	}
}

// ─── AnomalyClient ────────────────────────────────────────────────────────────

// AnomalyClient calls the Python insider-threat-svc to score user behaviour.
type AnomalyClient struct {
	cfg     AnomalyClientConfig
	cb      *circuitBreaker
	logger  *log.Logger
	httpCli HTTPDoer
}

// NewAnomalyClient creates a new AnomalyClient with the given configuration.
func NewAnomalyClient(cfg AnomalyClientConfig) *AnomalyClient {
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: cfg.Timeout}
	}
	if cfg.Logger == nil {
		cfg.Logger = log.New(os.Stdout, "[AnomalyClient] ", log.LstdFlags)
	}
	return &AnomalyClient{
		cfg:     cfg,
		cb:      newCircuitBreaker(cfg.CircuitBreakerThreshold, cfg.CircuitBreakerCooldown),
		logger:  cfg.Logger,
		httpCli: cfg.HTTPClient,
	}
}

// Detect calls POST /detect on the Python insider-threat-svc.
// On any error (network, timeout, circuit open), it returns (score=0, nil)
// so the caller can fail open gracefully.
func (c *AnomalyClient) Detect(ctx context.Context, req AnomalyDetectRequest) (AnomalyDetectResponse, error) {
	if !c.cb.allow() {
		c.logger.Printf("WARN: circuit open — skipping anomaly check for user=%s", req.UserID)
		return AnomalyDetectResponse{AnomalyScore: 0}, nil
	}

	var resp AnomalyDetectResponse
	var lastErr error

	for attempt := 0; attempt <= c.cfg.MaxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff: 50ms, 100ms
			backoff := time.Duration(50*(1<<(attempt-1))) * time.Millisecond
			select {
			case <-ctx.Done():
				return AnomalyDetectResponse{AnomalyScore: 0}, nil
			case <-time.After(backoff):
			}
		}

		resp, lastErr = c.doDetect(ctx, req)
		if lastErr == nil {
			c.cb.recordSuccess()
			return resp, nil
		}
		c.logger.Printf("WARN: anomaly detect attempt %d failed for user=%s: %v", attempt+1, req.UserID, lastErr)
	}

	c.cb.recordFailure()
	c.logger.Printf("WARN: all anomaly detect attempts failed for user=%s — failing open", req.UserID)
	return AnomalyDetectResponse{AnomalyScore: 0}, nil
}

// ShouldBlock returns true if the anomaly score exceeds the configured threshold.
func (c *AnomalyClient) ShouldBlock(score float64) bool {
	return score >= c.cfg.BlockThreshold
}

// doDetect performs a single HTTP call to POST /detect.
func (c *AnomalyClient) doDetect(ctx context.Context, req AnomalyDetectRequest) (AnomalyDetectResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return AnomalyDetectResponse{}, fmt.Errorf("marshal detect request: %w", err)
	}

	url := c.cfg.BaseURL + "/detect"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return AnomalyDetectResponse{}, fmt.Errorf("build http request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	httpResp, err := c.httpCli.Do(httpReq)
	if err != nil {
		return AnomalyDetectResponse{}, fmt.Errorf("http post /detect: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		return AnomalyDetectResponse{}, fmt.Errorf("detect returned HTTP %d", httpResp.StatusCode)
	}

	respBytes, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return AnomalyDetectResponse{}, fmt.Errorf("read detect response: %w", err)
	}

	var result AnomalyDetectResponse
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return AnomalyDetectResponse{}, fmt.Errorf("unmarshal detect response: %w", err)
	}

	return result, nil
}

// BuildFeaturesFromRequest builds AnomalyFeatures from the current request context.
// In production, action_count_per_hour and unique_records_accessed would be
// fetched from Redis counters maintained per user session.
func BuildFeaturesFromRequest(r *http.Request, role string) AnomalyFeatures {
	now := time.Now()
	hour := now.Hour()
	offHours := 0
	if hour < 6 || hour > 22 {
		offHours = 1
	}
	// Role mismatch: non-zero if a trader is accessing admin endpoints
	roleMismatch := 0.0
	if role == "trader" && (strings.HasPrefix(r.URL.Path, "/admin") || strings.HasPrefix(r.URL.Path, "/seed")) {
		roleMismatch = 1.0
	}
	return AnomalyFeatures{
		HourOfDay:             hour,
		ActionCountPerHour:    1, // Caller should inject real counter from Redis
		UniqueRecordsAccessed: 1, // Caller should inject real counter from Redis
		OffHoursFlag:          offHours,
		RoleMismatchScore:     roleMismatch,
	}
}


