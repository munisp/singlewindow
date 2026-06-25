// token_refresher_test.go — Unit tests for TokenRefresher.
package main

import (
	"context"
	"sync"
	"testing"
	"time"
)

// ─── Stubs ────────────────────────────────────────────────────────────────────

type stubTokenProvider struct {
	mu     sync.Mutex
	tokens []string
	calls  int
}

func (s *stubTokenProvider) ListTokens(_ context.Context, _ string, _ int) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	return s.tokens, nil
}

type stubPurgePublisher struct {
	mu      sync.Mutex
	purged  []string
	reasons []string
	calls   int
}

func (s *stubPurgePublisher) PublishPurge(_ context.Context, tokens []string, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purged = append(s.purged, tokens...)
	s.reasons = append(s.reasons, reason)
	s.calls++
	return nil
}

// ─── Tests ────────────────────────────────────────────────────────────────────

func TestNewTokenRefresher_defaults(t *testing.T) {
	r := NewTokenRefresher(nil, &stubTokenProvider{}, &stubPurgePublisher{}, 0, 0)
	if r.interval != DefaultRefreshInterval {
		t.Errorf("expected default interval %v, got %v", DefaultRefreshInterval, r.interval)
	}
	if r.batchSize != DefaultBatchSize {
		t.Errorf("expected default batch size %d, got %d", DefaultBatchSize, r.batchSize)
	}
}

func TestNewTokenRefresher_customValues(t *testing.T) {
	r := NewTokenRefresher(nil, &stubTokenProvider{}, &stubPurgePublisher{}, 30*time.Minute, 100)
	if r.interval != 30*time.Minute {
		t.Errorf("expected 30m interval, got %v", r.interval)
	}
	if r.batchSize != 100 {
		t.Errorf("expected batchSize 100, got %d", r.batchSize)
	}
}

func TestRunCycle_noTokens(t *testing.T) {
	provider := &stubTokenProvider{tokens: []string{}}
	publisher := &stubPurgePublisher{}
	r := NewTokenRefresher(nil, provider, publisher, time.Hour, 100)

	ctx := context.Background()
	r.runCycle(ctx)

	if publisher.calls != 0 {
		t.Errorf("expected 0 purge calls with no tokens, got %d", publisher.calls)
	}

	stats := r.Stats()
	if stats.TotalCycles != 1 {
		t.Errorf("expected 1 cycle, got %d", stats.TotalCycles)
	}
	if stats.TotalValidated != 0 {
		t.Errorf("expected 0 validated, got %d", stats.TotalValidated)
	}
}

func TestRunCycle_allValidTokens(t *testing.T) {
	// With nil FCM client, validateTokens returns empty stale list.
	provider := &stubTokenProvider{tokens: []string{"token-a", "token-b", "token-c"}}
	publisher := &stubPurgePublisher{}
	r := NewTokenRefresher(nil, provider, publisher, time.Hour, 100)

	ctx := context.Background()
	r.runCycle(ctx)

	if publisher.calls != 0 {
		t.Errorf("expected 0 purge calls (nil FCM client), got %d", publisher.calls)
	}

	stats := r.Stats()
	if stats.TotalValidated != 3 {
		t.Errorf("expected 3 validated, got %d", stats.TotalValidated)
	}
	if stats.TotalStale != 0 {
		t.Errorf("expected 0 stale, got %d", stats.TotalStale)
	}
}

func TestStats_accumulate(t *testing.T) {
	provider := &stubTokenProvider{tokens: []string{"t1", "t2"}}
	publisher := &stubPurgePublisher{}
	r := NewTokenRefresher(nil, provider, publisher, time.Hour, 100)

	ctx := context.Background()
	r.runCycle(ctx)
	r.runCycle(ctx)

	stats := r.Stats()
	if stats.TotalCycles != 2 {
		t.Errorf("expected 2 cycles, got %d", stats.TotalCycles)
	}
	if stats.TotalValidated != 4 {
		t.Errorf("expected 4 validated (2 tokens × 2 cycles), got %d", stats.TotalValidated)
	}
}

func TestStats_lastCycleAt(t *testing.T) {
	provider := &stubTokenProvider{tokens: []string{}}
	publisher := &stubPurgePublisher{}
	r := NewTokenRefresher(nil, provider, publisher, time.Hour, 100)

	before := time.Now().UnixMilli()
	ctx := context.Background()
	r.runCycle(ctx)
	after := time.Now().UnixMilli()

	stats := r.Stats()
	if stats.LastCycleAt < before || stats.LastCycleAt > after {
		t.Errorf("LastCycleAt %d not in expected range [%d, %d]", stats.LastCycleAt, before, after)
	}
}

func TestRun_cancelsOnContextDone(t *testing.T) {
	provider := &stubTokenProvider{tokens: []string{}}
	publisher := &stubPurgePublisher{}
	// Very long interval so the ticker never fires in the test.
	r := NewTokenRefresher(nil, provider, publisher, 24*time.Hour, 100)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	go func() {
		r.Run(ctx)
		close(done)
	}()

	// Give the goroutine time to start.
	time.Sleep(20 * time.Millisecond)
	cancel()

	select {
	case <-done:
		// Expected: Run returned after context cancellation.
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop within 2 seconds after context cancellation")
	}
}

func TestHTTPTokenProvider_construction(t *testing.T) {
	p := NewHTTPTokenProvider("http://push-tokens-svc:8080")
	if p.serviceURL != "http://push-tokens-svc:8080" {
		t.Errorf("unexpected serviceURL: %s", p.serviceURL)
	}
	if p.httpClient == nil {
		t.Error("httpClient should not be nil")
	}
}

func TestKafkaPurgePublisher_construction(t *testing.T) {
	p := NewKafkaPurgePublisher("kafka:9092")
	if p.broker != "kafka:9092" {
		t.Errorf("unexpected broker: %s", p.broker)
	}
}

func TestPurgeEvent_fields(t *testing.T) {
	event := PurgeEvent{
		Tokens:   []string{"tok1", "tok2"},
		Reason:   "fcm_unregistered",
		Platform: "fcm",
		PurgedAt: 1700000000000,
		CycleID:  "cycle-123",
	}
	if len(event.Tokens) != 2 {
		t.Errorf("expected 2 tokens, got %d", len(event.Tokens))
	}
	if event.Reason != "fcm_unregistered" {
		t.Errorf("unexpected reason: %s", event.Reason)
	}
	if event.Platform != "fcm" {
		t.Errorf("unexpected platform: %s", event.Platform)
	}
}

func TestRefreshStats_zeroed(t *testing.T) {
	r := NewTokenRefresher(nil, &stubTokenProvider{}, &stubPurgePublisher{}, time.Hour, 100)
	stats := r.Stats()
	if stats.TotalCycles != 0 || stats.TotalValidated != 0 || stats.TotalStale != 0 || stats.TotalPurged != 0 {
		t.Errorf("expected all-zero stats on new refresher, got %+v", stats)
	}
}
