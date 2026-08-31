// Package consumer ingests signed geo.vessel-position.v1 envelopes from the
// geo-service Kafka topic and persists them (Phase-9 WP-B).
//
// Fail-closed semantics:
//   - every message's envelope JWS is verified against GEO_ENVELOPE_TRUST_KEYS
//     before persistence; ANY deviation routes the raw message to the DLQ
//     topic (vessels.events.dlq) and is NEVER persisted;
//   - the Kafka offset is committed only after the row is durably written
//     (at-least-once); replays are absorbed by the idempotent store;
//   - if the DLQ publish itself fails, the offset is not committed and the
//     message is retried — nothing is dropped silently.
package consumer

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/plain"

	"github.com/blueeconomy/cargo-tracking-service/internal/envelope"
	"github.com/blueeconomy/cargo-tracking-service/internal/store"
)

const (
	// DefaultTopic is the contract-governed geo-service vessel events topic.
	DefaultTopic = "vessels.events"
	// DefaultDLQTopic receives messages that fail verification or persist.
	DefaultDLQTopic = "vessels.events.dlq"
)

// Config carries the env-derived consumer configuration.
type Config struct {
	Brokers     []string // KAFKA_BROKERS (required for ingestion)
	Topic       string   // GEO_VESSEL_EVENTS_TOPIC (default vessels.events)
	DLQTopic    string   // GEO_VESSEL_EVENTS_DLQ_TOPIC (default <topic>.dlq)
	GroupID     string   // CARGO_KAFKA_GROUP_ID (default cargo-tracking-service)
	TLSEnabled  bool     // KAFKA_TLS_ENABLED
	SASLEnabled bool     // KAFKA_SASL_ENABLED
	SASLUser    string   // KAFKA_SASL_USER (env-only)
	SASLPass    string   // KAFKA_SASL_PASSWORD (env-only)
	// StartOffset overrides the reader start offset (0 = kafka.LastOffset
	// default; kafka.FirstOffset replays the topic — used by tests with
	// fresh topics).
	StartOffset int64
}

// ConfigFromEnv reads the consumer configuration. Returns nil when ingestion
// is not configured at all (the service then serves honest empty state and
// reports GAP-AIS-FEED on /healthz).
func ConfigFromEnv() *Config {
	brokersRaw := os.Getenv("KAFKA_BROKERS")
	if strings.TrimSpace(brokersRaw) == "" {
		return nil
	}
	var brokers []string
	for _, b := range strings.Split(brokersRaw, ",") {
		if t := strings.TrimSpace(b); t != "" {
			brokers = append(brokers, t)
		}
	}
	if len(brokers) == 0 {
		return nil
	}
	cfg := &Config{
		Brokers:     brokers,
		Topic:       getEnvDefault("GEO_VESSEL_EVENTS_TOPIC", DefaultTopic),
		GroupID:     getEnvDefault("CARGO_KAFKA_GROUP_ID", "cargo-tracking-service"),
		TLSEnabled:  os.Getenv("KAFKA_TLS_ENABLED") == "true",
		SASLEnabled: os.Getenv("KAFKA_SASL_ENABLED") == "true",
		SASLUser:    os.Getenv("KAFKA_SASL_USER"),
		SASLPass:    os.Getenv("KAFKA_SASL_PASSWORD"),
	}
	cfg.DLQTopic = getEnvDefault("GEO_VESSEL_EVENTS_DLQ_TOPIC", cfg.Topic+".dlq")
	return cfg
}

func getEnvDefault(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func (c *Config) dialer() *kafka.Dialer {
	d := &kafka.Dialer{Timeout: 10 * time.Second, DualStack: true}
	if c.TLSEnabled {
		d.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	if c.SASLEnabled {
		d.SASLMechanism = plain.Mechanism{Username: c.SASLUser, Password: c.SASLPass}
	}
	return d
}

// Consumer verifies and persists vessel events.
type Consumer struct {
	cfg    *Config
	keys   envelope.TrustKeys
	store  *store.Store
	reader *kafka.Reader
	writer *kafka.Writer // DLQ

	// Stats for /healthz honesty.
	lastErr     error
	ingested    int64
	rejected    int64
	lastMessage time.Time
}

func New(cfg *Config, keys envelope.TrustKeys, st *store.Store) *Consumer {
	startOffset := cfg.StartOffset
	if startOffset == 0 {
		startOffset = kafka.LastOffset
	}
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        cfg.Brokers,
		Topic:          cfg.Topic,
		GroupID:        cfg.GroupID,
		Dialer:         cfg.dialer(),
		MinBytes:       1,
		MaxBytes:       10 << 20,
		CommitInterval: 0, // explicit commits only — after durable persist
		StartOffset:    startOffset,
	})
	writer := &kafka.Writer{
		Addr:         kafka.TCP(cfg.Brokers...),
		Topic:        cfg.DLQTopic,
		RequiredAcks: kafka.RequireAll,
		Balancer:     &kafka.Hash{},
	}
	return &Consumer{cfg: cfg, keys: keys, store: st, reader: reader, writer: writer}
}

// Run consumes until ctx is cancelled.
func (c *Consumer) Run(ctx context.Context) {
	for {
		msg, err := c.reader.FetchMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			c.setErr(err)
			log.Printf("[cargo-tracking] fetch error: %v", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
				continue
			}
		}
		if err := c.handle(ctx, msg); err != nil {
			c.setErr(err)
			// handle() already routed to DLQ when appropriate; a DLQ failure
			// is fatal to THIS iteration only — the offset is not committed,
			// so the message is retried (never silently dropped).
			continue
		}
		if err := c.reader.CommitMessages(ctx, msg); err != nil {
			c.setErr(err)
			log.Printf("[cargo-tracking] offset commit failed (message will be replayed; store is idempotent): %v", err)
		}
	}
}

// dlqEnvelope is the DLQ message shape for rejected vessel events.
type dlqEnvelope struct {
	OriginalTopic string    `json:"original_topic"`
	OriginalKey   string    `json:"original_key"`
	Partition     int       `json:"partition"`
	Offset        int64     `json:"offset"`
	Payload       string    `json:"payload"` // raw message value, base not required — JSON-escaped
	Error         string    `json:"error"`
	FailedAt      time.Time `json:"failed_at"`
	ServiceName   string    `json:"service_name"`
}

// handle verifies one message and persists it. Verification failures are
// routed to the DLQ and return nil (safe to commit); persistence failures
// return an error WITHOUT committing (at-least-once).
func (c *Consumer) handle(ctx context.Context, msg kafka.Message) error {
	env, err := envelope.Verify(msg.Value, c.keys)
	if err != nil {
		c.rejected++
		return c.toDLQ(ctx, msg, err)
	}
	kid := kidFromSignature(env.Provenance.Signature)
	if env.EventType != envelope.EventVesselPosition {
		// Contract-verified but not a position event: acknowledge without
		// persisting (this consumer owns position tracking only). Committed.
		return nil
	}
	payload, err := envelope.ExtractVesselPosition(env)
	if err != nil {
		c.rejected++
		return c.toDLQ(ctx, msg, err)
	}
	if err := c.store.InsertPosition(ctx, env, kid, payload); err != nil {
		// Durable write failed: do NOT commit — the message is replayed.
		return fmt.Errorf("persist vessel position (offset not committed): %w", err)
	}
	c.ingested++
	c.lastMessage = time.Now().UTC()
	return nil
}

func (c *Consumer) toDLQ(ctx context.Context, msg kafka.Message, cause error) error {
	env := dlqEnvelope{
		OriginalTopic: msg.Topic,
		OriginalKey:   string(msg.Key),
		Partition:     msg.Partition,
		Offset:        msg.Offset,
		Payload:       string(msg.Value),
		Error:         cause.Error(),
		FailedAt:      time.Now().UTC(),
		ServiceName:   "cargo-tracking-service",
	}
	body, merr := json.Marshal(env)
	if merr != nil {
		return fmt.Errorf("marshal DLQ envelope: %w", merr)
	}
	if err := c.writer.WriteMessages(ctx, kafka.Message{Key: msg.Key, Value: body}); err != nil {
		return fmt.Errorf("DLQ publish failed (offset not committed): %w", err)
	}
	log.Printf("[cargo-tracking] rejected message %s@%d routed to %s: %v", msg.Topic, msg.Offset, c.cfg.DLQTopic, cause)
	return nil
}

func kidFromSignature(sig string) string {
	parts := strings.Split(sig, ".")
	if len(parts) != 3 {
		return ""
	}
	header, err := base64RawURLDecode(parts[0])
	if err != nil {
		return ""
	}
	var h struct {
		KeyID string `json:"kid"`
	}
	if err := json.Unmarshal(header, &h); err != nil {
		return ""
	}
	return h.KeyID
}

func base64RawURLDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// Stats returns ingestion counters for /healthz.
func (c *Consumer) Stats() (ingested, rejected int64, lastMessage time.Time, lastErr error) {
	return c.ingested, c.rejected, c.lastMessage, c.lastErr
}

func (c *Consumer) setErr(err error) { c.lastErr = err }

// Close releases reader and writer.
func (c *Consumer) Close() {
	_ = c.reader.Close()
	_ = c.writer.Close()
}
