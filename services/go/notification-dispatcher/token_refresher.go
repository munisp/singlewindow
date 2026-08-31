// token_refresher.go — Periodic FCM/APNs token validation and stale-token purge.
//
// The TokenRefresher runs as a background goroutine.  Every RefreshInterval it:
//  1. Calls the FCM v1 "dry-run" send API to validate each stored token.
//  2. Marks tokens that return UNREGISTERED or INVALID_ARGUMENT as stale.
//  3. Publishes a purge event to the insider.push.purge Kafka topic so every
//     service that caches tokens can evict them.
//  4. Writes a structured log entry with the refresh summary.
//
// The refresher is intentionally lightweight: it does NOT talk to a database
// directly — it relies on the upstream push-tokens service to consume the Kafka
// purge events and delete the rows.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	kafka "github.com/segmentio/kafka-go"
)

const (
	// DefaultRefreshInterval is how often the refresher wakes up.
	DefaultRefreshInterval = 6 * time.Hour

	// DefaultBatchSize is the maximum number of tokens validated per cycle.
	DefaultBatchSize = 500

	// FCMValidateURL is the FCM v1 send endpoint used for dry-run validation.
	// Replace {projectID} before use.
	FCMValidateURLTemplate = "https://fcm.googleapis.com/v1/projects/%s/messages:send"

	// PurgeTopic is the Kafka topic that receives stale-token purge events.
	PurgeTopic = "insider.push.purge"
)

// TokenProvider is the interface the refresher uses to fetch tokens to validate.
// In production this is backed by the push_tokens database table via an HTTP
// call to the push-tokens microservice; in tests it is replaced by a stub.
type TokenProvider interface {
	// ListTokens returns up to limit FCM device tokens.
	ListTokens(ctx context.Context, platform string, limit int) ([]string, error)
}

// PurgePublisher publishes stale-token events to Kafka.
type PurgePublisher interface {
	// PublishPurge sends a purge event for the given tokens.
	PublishPurge(ctx context.Context, tokens []string, reason string) error
}

// PurgeEvent is the Kafka message payload for stale-token purge events.
type PurgeEvent struct {
	Tokens   []string `json:"tokens"`
	Reason   string   `json:"reason"`
	Platform string   `json:"platform"`
	PurgedAt int64    `json:"purged_at"` // Unix milliseconds
	CycleID  string   `json:"cycle_id"`
}

// TokenRefresher validates push tokens and purges stale ones.
type TokenRefresher struct {
	fcm       *FCMClient
	provider  TokenProvider
	publisher PurgePublisher
	interval  time.Duration
	batchSize int
	mu        sync.Mutex
	stats     RefreshStats
}

// RefreshStats accumulates statistics across refresh cycles.
type RefreshStats struct {
	TotalCycles    int64 `json:"total_cycles"`
	TotalValidated int64 `json:"total_validated"`
	TotalStale     int64 `json:"total_stale"`
	TotalPurged    int64 `json:"total_purged"`
	LastCycleAt    int64 `json:"last_cycle_at"` // Unix milliseconds
}

// NewTokenRefresher creates a TokenRefresher with the given dependencies.
func NewTokenRefresher(
	fcm *FCMClient,
	provider TokenProvider,
	publisher PurgePublisher,
	interval time.Duration,
	batchSize int,
) *TokenRefresher {
	if interval <= 0 {
		interval = DefaultRefreshInterval
	}
	if batchSize <= 0 {
		batchSize = DefaultBatchSize
	}
	return &TokenRefresher{
		fcm:       fcm,
		provider:  provider,
		publisher: publisher,
		interval:  interval,
		batchSize: batchSize,
	}
}

// Run starts the refresh loop.  It blocks until ctx is cancelled.
func (r *TokenRefresher) Run(ctx context.Context) {
	slog.Info("TokenRefresher started", "interval", r.interval, "batchSize", r.batchSize)
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	// Run one cycle immediately on startup so we don't wait a full interval.
	r.runCycle(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.Info("TokenRefresher stopped")
			return
		case <-ticker.C:
			r.runCycle(ctx)
		}
	}
}

// runCycle executes a single validation + purge cycle.
func (r *TokenRefresher) runCycle(ctx context.Context) {
	cycleID := fmt.Sprintf("cycle-%d", time.Now().UnixMilli())
	slog.Info("TokenRefresher cycle started", "cycle_id", cycleID)

	// Fail-closed: a refresher without its dependencies cannot validate or
	// purge anything. Log loudly and skip the cycle instead of panicking or
	// fabricating a successful refresh.
	if r.provider == nil || r.publisher == nil {
		slog.Error("TokenRefresher: missing TokenProvider/PurgePublisher — cycle skipped", "cycle_id", cycleID)
		return
	}

	tokens, err := r.provider.ListTokens(ctx, "fcm", r.batchSize)
	if err != nil {
		slog.Error("TokenRefresher: failed to list tokens", "error", err)
		return
	}

	// A completed cycle counts even when there was nothing to validate —
	// otherwise the stats lie about the refresher having run.
	r.mu.Lock()
	r.stats.TotalCycles++
	r.stats.LastCycleAt = time.Now().UnixMilli()
	r.mu.Unlock()

	if len(tokens) == 0 {
		slog.Info("TokenRefresher: no tokens to validate", "cycle_id", cycleID)
		return
	}

	stale := r.validateTokens(ctx, tokens)

	r.mu.Lock()
	r.stats.TotalValidated += int64(len(tokens))
	r.stats.TotalStale += int64(len(stale))
	r.mu.Unlock()

	if len(stale) == 0 {
		slog.Info("TokenRefresher: all tokens valid", "cycle_id", cycleID, "validated", len(tokens))
		return
	}

	slog.Info("TokenRefresher: purging stale tokens",
		"cycle_id", cycleID,
		"stale", len(stale),
		"total", len(tokens),
	)

	if err := r.publisher.PublishPurge(ctx, stale, "fcm_unregistered"); err != nil {
		slog.Error("TokenRefresher: failed to publish purge event", "error", err, "cycle_id", cycleID)
		return
	}

	r.mu.Lock()
	r.stats.TotalPurged += int64(len(stale))
	r.mu.Unlock()

	slog.Info("TokenRefresher: purge published",
		"cycle_id", cycleID,
		"purged", len(stale),
	)
}

// validateTokens sends dry-run FCM messages and returns the list of stale tokens.
// A token is considered stale when the FCM API returns:
//   - UNREGISTERED — the app was uninstalled or the token expired.
//   - INVALID_ARGUMENT — the token is malformed.
func (r *TokenRefresher) validateTokens(ctx context.Context, tokens []string) []string {
	if r.fcm == nil {
		return nil
	}

	stale := make([]string, 0, len(tokens)/10)

	for _, token := range tokens {
		if isStaleToken(ctx, r.fcm.ProjectID, r.fcm.BearerToken, token) {
			stale = append(stale, token)
		}
	}

	return stale
}

// isStaleToken performs a single dry-run FCM send and returns true if the token
// is unregistered or invalid.
func isStaleToken(ctx context.Context, projectID, bearerToken, token string) bool {
	url := fmt.Sprintf(FCMValidateURLTemplate, projectID)

	payload := map[string]interface{}{
		"validate_only": true,
		"message": map[string]interface{}{
			"token": token,
			"notification": map[string]string{
				"title": "ping",
				"body":  "ping",
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return false
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(body)))
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+bearerToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	// 200 → token is valid (dry-run succeeded)
	if resp.StatusCode == http.StatusOK {
		return false
	}

	// 400 with UNREGISTERED or INVALID_ARGUMENT → stale
	if resp.StatusCode == http.StatusBadRequest {
		var fcmErr struct {
			Error struct {
				Details []struct {
					ErrorCode string `json:"errorCode"`
				} `json:"details"`
			} `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&fcmErr); err == nil {
			for _, d := range fcmErr.Error.Details {
				if d.ErrorCode == "UNREGISTERED" || d.ErrorCode == "INVALID_ARGUMENT" {
					return true
				}
			}
		}
	}

	return false
}

// Stats returns a snapshot of the current refresh statistics.
func (r *TokenRefresher) Stats() RefreshStats {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stats
}

// ─── HTTP token provider ──────────────────────────────────────────────────────

// HTTPTokenProvider fetches tokens from the push-tokens microservice REST API.
type HTTPTokenProvider struct {
	serviceURL string
	httpClient *http.Client
}

// NewHTTPTokenProvider creates a provider that calls the push-tokens service.
func NewHTTPTokenProvider(serviceURL string) *HTTPTokenProvider {
	return &HTTPTokenProvider{
		serviceURL: serviceURL,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// ListTokens fetches up to limit FCM tokens from the push-tokens service.
func (p *HTTPTokenProvider) ListTokens(ctx context.Context, platform string, limit int) ([]string, error) {
	url := fmt.Sprintf("%s/tokens?platform=%s&limit=%d", p.serviceURL, platform, limit)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("push-tokens service returned %d", resp.StatusCode)
	}

	var result struct {
		Tokens []string `json:"tokens"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.Tokens, nil
}

// ─── Kafka purge publisher ────────────────────────────────────────────────────

// KafkaPurgePublisher publishes purge events to Kafka.
type KafkaPurgePublisher struct {
	broker string
}

// NewKafkaPurgePublisher creates a publisher that writes to the given Kafka broker.
func NewKafkaPurgePublisher(broker string) *KafkaPurgePublisher {
	return &KafkaPurgePublisher{broker: broker}
}

// PublishPurge sends a purge event to the insider.push.purge topic.
func (p *KafkaPurgePublisher) PublishPurge(ctx context.Context, tokens []string, reason string) error {
	event := PurgeEvent{
		Tokens:   tokens,
		Reason:   reason,
		Platform: "fcm",
		PurgedAt: time.Now().UnixMilli(),
		CycleID:  fmt.Sprintf("purge-%d", time.Now().UnixMilli()),
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal purge event: %w", err)
	}

	return writeKafkaMessage(ctx, p.broker, PurgeTopic, payload)
}

// writeKafkaMessage writes a single message to the given Kafka topic using kafka-go.
func writeKafkaMessage(ctx context.Context, broker, topic string, value []byte) error {
	w := &kafka.Writer{
		Addr:     kafka.TCP(broker),
		Topic:    topic,
		Balancer: &kafka.LeastBytes{},
	}
	defer w.Close()
	msg := kafka.Message{Value: value}
	// Phase-7 OTel: propagate the trace context into the purge event.
	injectKafkaHeaders(ctx, &msg)
	return w.WriteMessages(ctx, msg)
}
