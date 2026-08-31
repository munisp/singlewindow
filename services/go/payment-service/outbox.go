// outbox.go — Phase-9 WP-B: real Kafka publication for payment-service via
// the platform transactional outbox pattern (replaces the log-only stub).
//
// Guarantees:
//   - Durable: the outbox row is written in the SAME database transaction as
//     the domain state change, so a confirmed payment can never lose its
//     payment.confirmed event.
//   - At-least-once with idempotent keys: the drainer publishes with an
//     idempotent sarama producer (enable.idempotence=true, acks=all,
//     max.in.flight=1); the message key is the stable outbox event key, so
//     broker-side idempotence plus consumer-side key dedup absorb retries.
//   - DLQ: after maxOutboxAttempts publish failures the record is marked
//     failed and a DLQ envelope is published to <topic>.dlq.
//   - Fail-closed configuration: in production the service refuses to boot
//     without KAFKA_BROKERS; outside production a missing broker config
//     leaves the outbox durably queued, surfaces a kafkaOutbox gap on
//     /health, and never degrades to a silent log line.
//
// TLS/SASL wiring (PRA-118): KAFKA_TLS_ENABLED, KAFKA_SASL_ENABLED,
// KAFKA_SASL_USER, KAFKA_SASL_PASSWORD — credentials are env-only; tests use
// a plaintext local broker.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/IBM/sarama"
)

const (
	// maxOutboxAttempts is the per-record publish attempt budget before the
	// record is marked failed and routed to the DLQ.
	maxOutboxAttempts = 5
	// outboxDrainInterval is the poll interval between drains.
	outboxDrainInterval = 500 * time.Millisecond
	// outboxBatchSize bounds one drain transaction.
	outboxBatchSize = 100
)

// OutboxPublisher is the durable outbox drainer.
type OutboxPublisher struct {
	db       *sql.DB
	producer sarama.SyncProducer
	dlq      string // DLQ topic suffix
	done     chan struct{}
	wg       sync.WaitGroup
	// lastDrainErr is exposed on /health for honest gap reporting.
	mu           sync.Mutex
	lastDrainErr error
	drainedCount int64
}

// newKafkaProducer builds an idempotent sarama SyncProducer from env config.
func newKafkaProducer(brokers []string) (sarama.SyncProducer, error) {
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V3_5_0_0
	cfg.Producer.RequiredAcks = sarama.WaitForAll
	cfg.Producer.Idempotent = true
	cfg.Net.MaxOpenRequests = 1
	cfg.Producer.Retry.Max = 10
	cfg.Producer.Retry.Backoff = 500 * time.Millisecond
	cfg.Producer.Return.Successes = true
	cfg.Producer.Return.Errors = true
	if os.Getenv("KAFKA_TLS_ENABLED") == "true" {
		cfg.Net.TLS.Enable = true
	}
	if os.Getenv("KAFKA_SASL_ENABLED") == "true" {
		cfg.Net.SASL.Enable = true
		cfg.Net.SASL.Mechanism = sarama.SASLTypePlaintext
		cfg.Net.SASL.User = os.Getenv("KAFKA_SASL_USER")
		cfg.Net.SASL.Password = os.Getenv("KAFKA_SASL_PASSWORD")
	}
	return sarama.NewSyncProducer(brokers, cfg)
}

// ensureOutboxMigration applies the outbox DDL idempotently at boot.
func ensureOutboxMigration(ctx context.Context, db *sql.DB) error {
	ddl, err := os.ReadFile("migrations/0001_payment_outbox.sql")
	if err != nil {
		// Fall back to the embedded copy so container layouts that do not
		// ship the migrations directory still fail loudly here if the DDL
		// cannot be applied.
		ddl = []byte(outboxDDL)
	}
	if _, err := db.ExecContext(ctx, string(ddl)); err != nil {
		return fmt.Errorf("apply payment_outbox migration: %w", err)
	}
	return nil
}

// outboxDDL is the embedded copy of migrations/0001_payment_outbox.sql.
const outboxDDL = `
CREATE TABLE IF NOT EXISTS payment_outbox (
    id              BIGSERIAL PRIMARY KEY,
    topic           TEXT        NOT NULL,
    event_key       TEXT        NOT NULL,
    payload         JSON       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ,
    attempts        INT         NOT NULL DEFAULT 0,
    last_error      TEXT,
    failed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payment_outbox_pending_idx
    ON payment_outbox (id)
    WHERE published_at IS NULL AND failed_at IS NULL;
`

// enqueueOutbox writes the event row inside the caller's transaction. The
// event key MUST be a stable idempotent key for the domain event.
func enqueueOutbox(ctx context.Context, tx *sql.Tx, topic, key string, payload any) error {
	if strings.TrimSpace(topic) == "" || strings.TrimSpace(key) == "" {
		return errors.New("outbox topic and idempotent event key are required")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal outbox payload: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO payment_outbox (topic, event_key, payload) VALUES ($1, $2, $3)
	`, topic, key, body)
	if err != nil {
		return fmt.Errorf("insert outbox row: %w", err)
	}
	return nil
}

// NewOutboxPublisher starts the drainer. producer must be a real idempotent
// producer — NewOutboxPublisher fails closed on nil.
func NewOutboxPublisher(db *sql.DB, producer sarama.SyncProducer, dlqSuffix string) (*OutboxPublisher, error) {
	if db == nil || producer == nil {
		return nil, errors.New("outbox publisher requires a DB handle and a real Kafka producer")
	}
	if dlqSuffix == "" {
		dlqSuffix = ".dlq"
	}
	p := &OutboxPublisher{db: db, producer: producer, dlq: dlqSuffix, done: make(chan struct{})}
	p.wg.Add(1)
	go p.loop()
	return p, nil
}

func (p *OutboxPublisher) loop() {
	defer p.wg.Done()
	ticker := time.NewTicker(outboxDrainInterval)
	defer ticker.Stop()
	for {
		select {
		case <-p.done:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			n, err := p.Drain(ctx)
			cancel()
			p.mu.Lock()
			p.lastDrainErr = err
			p.drainedCount += int64(n)
			p.mu.Unlock()
			if err != nil {
				log.Printf("[payment-service] outbox drain error: %v", err)
			}
		}
	}
}

// Drain publishes up to outboxBatchSize pending rows. Exported for tests.
func (p *OutboxPublisher) Drain(ctx context.Context) (int, error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin drain tx: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT id, topic, event_key, payload, attempts
		FROM payment_outbox
		WHERE published_at IS NULL AND failed_at IS NULL
		ORDER BY id
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, outboxBatchSize)
	if err != nil {
		return 0, fmt.Errorf("select pending outbox rows: %w", err)
	}
	type pendingRow struct {
		id       int64
		topic    string
		key      string
		payload  []byte
		attempts int
	}
	var batch []pendingRow
	for rows.Next() {
		var r pendingRow
		if err := rows.Scan(&r.id, &r.topic, &r.key, &r.payload, &r.attempts); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan outbox row: %w", err)
		}
		batch = append(batch, r)
	}
	rows.Close()
	if len(batch) == 0 {
		return 0, tx.Commit()
	}

	published := 0
	for _, r := range batch {
		msg := &sarama.ProducerMessage{
			Topic: r.topic,
			Key:   sarama.StringEncoder(r.key),
			Value: sarama.ByteEncoder(r.payload),
			Headers: []sarama.RecordHeader{
				{Key: []byte("content-type"), Value: []byte("application/json")},
				{Key: []byte("service"), Value: []byte("payment-service")},
				{Key: []byte("outbox-id"), Value: []byte(fmt.Sprintf("%d", r.id))},
			},
		}
		injectKafkaHeaders(ctx, msg)
		_, _, pubErr := p.producer.SendMessage(msg)
		if pubErr == nil {
			if _, err := tx.ExecContext(ctx, `
				UPDATE payment_outbox SET published_at = NOW(), attempts = attempts + 1, last_error = NULL WHERE id = $1
			`, r.id); err != nil {
				return published, fmt.Errorf("mark outbox row %d published: %w", r.id, err)
			}
			published++
			continue
		}
		// Publish failed: count the attempt; route to DLQ when the budget is
		// exhausted. Never drop the record silently.
		attempts := r.attempts + 1
		if attempts >= maxOutboxAttempts {
			if dlqErr := p.publishDLQ(ctx, r.topic, r.key, r.payload, pubErr.Error(), attempts); dlqErr != nil {
				log.Printf("[payment-service] DLQ publish failed for outbox row %d: %v", r.id, dlqErr)
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE payment_outbox SET attempts = $2, last_error = $3, failed_at = NOW() WHERE id = $1
			`, r.id, attempts, pubErr.Error()); err != nil {
				return published, fmt.Errorf("mark outbox row %d failed: %w", r.id, err)
			}
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE payment_outbox SET attempts = $2, last_error = $3 WHERE id = $1
		`, r.id, attempts, pubErr.Error()); err != nil {
			return published, fmt.Errorf("bump outbox row %d attempts: %w", r.id, err)
		}
	}
	return published, tx.Commit()
}

// outboxDLQEnvelope is the DLQ message shape (mirrors the platform
// shared/kafka DLQMessage convention).
type outboxDLQEnvelope struct {
	OriginalTopic string          `json:"original_topic"`
	OriginalKey   string          `json:"original_key"`
	Payload       json.RawMessage `json:"payload"`
	Error         string          `json:"error"`
	Attempts      int             `json:"attempts"`
	FailedAt      time.Time       `json:"failed_at"`
	ServiceName   string          `json:"service_name"`
}

func (p *OutboxPublisher) publishDLQ(ctx context.Context, topic, key string, payload []byte, errMsg string, attempts int) error {
	env := outboxDLQEnvelope{
		OriginalTopic: topic,
		OriginalKey:   key,
		Payload:       json.RawMessage(payload),
		Error:         errMsg,
		Attempts:      attempts,
		FailedAt:      time.Now().UTC(),
		ServiceName:   "payment-service",
	}
	body, err := json.Marshal(env)
	if err != nil {
		return err
	}
	msg := &sarama.ProducerMessage{
		Topic: topic + p.dlq,
		Key:   sarama.StringEncoder(key),
		Value: sarama.ByteEncoder(body),
	}
	injectKafkaHeaders(ctx, msg)
	_, _, err = p.producer.SendMessage(msg)
	return err
}

// Status reports the drainer health for /health.
func (p *OutboxPublisher) Status() (drained int64, lastErr string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.lastDrainErr != nil {
		lastErr = p.lastDrainErr.Error()
	}
	return p.drainedCount, lastErr
}

// Close stops the drainer.
func (p *OutboxPublisher) Close() {
	close(p.done)
	p.wg.Wait()
}
