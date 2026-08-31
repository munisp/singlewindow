// outbox_test.go — DB-gated and broker-gated tests for the payment-service
// transactional outbox. These run against a REAL local PostgreSQL and a REAL
// local Kafka broker; no mocks at either boundary.
//
// Gates:
//
//	PAYMENT_TEST_PG_DSN  e.g. postgresql://postgres@127.0.0.1:5432/payment_test?sslmode=disable
//	KAFKA_TEST_BROKERS   e.g. 127.0.0.1:9092
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/IBM/sarama"
	_ "github.com/lib/pq"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("PAYMENT_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("PAYMENT_TEST_PG_DSN not set — skipping DB-gated outbox test")
	}
	d, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open test DB: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	if err := d.Ping(); err != nil {
		t.Skipf("test DB unreachable: %v", err)
	}
	// Apply the REAL migration (idempotent), twice — proves idempotency.
	if err := ensureOutboxMigration(context.Background(), d); err != nil {
		t.Fatalf("migration: %v", err)
	}
	if err := ensureOutboxMigration(context.Background(), d); err != nil {
		t.Fatalf("migration not idempotent: %v", err)
	}
	if _, err := d.Exec(`DELETE FROM payment_outbox`); err != nil {
		t.Fatalf("clean outbox: %v", err)
	}
	return d
}

func testBrokers(t *testing.T) []string {
	t.Helper()
	b := os.Getenv("KAFKA_TEST_BROKERS")
	if b == "" {
		t.Skip("KAFKA_TEST_BROKERS not set — skipping broker-gated outbox test")
	}
	return strings.Split(b, ",")
}

func testProducer(t *testing.T, tweak func(*sarama.Config)) sarama.SyncProducer {
	t.Helper()
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V3_5_0_0
	cfg.Producer.RequiredAcks = sarama.WaitForAll
	cfg.Producer.Idempotent = true
	cfg.Net.MaxOpenRequests = 1
	cfg.Producer.Return.Successes = true
	cfg.Producer.Return.Errors = true
	if tweak != nil {
		tweak(cfg)
	}
	p, err := sarama.NewSyncProducer(testBrokers(t), cfg)
	if err != nil {
		t.Fatalf("producer: %v", err)
	}
	t.Cleanup(func() { p.Close() })
	return p
}

func consumeOne(t *testing.T, topic, key string, timeout time.Duration) *sarama.ConsumerMessage {
	t.Helper()
	cfg := sarama.NewConfig()
	consumer, err := sarama.NewConsumer(testBrokers(t), cfg)
	if err != nil {
		t.Fatalf("consumer: %v", err)
	}
	defer consumer.Close()
	// The broker runs with 1 partition per topic by default; enumerate to be safe.
	parts, err := consumer.Partitions(topic)
	if err != nil {
		t.Fatalf("partitions for %s: %v", topic, err)
	}
	type result struct {
		msg *sarama.ConsumerMessage
		err error
	}
	ch := make(chan result, 1)
	for _, part := range parts {
		pc, err := consumer.ConsumePartition(topic, part, sarama.OffsetOldest)
		if err != nil {
			t.Fatalf("consume partition %s/%d: %v", topic, part, err)
		}
		defer pc.Close()
		go func(pc sarama.PartitionConsumer) {
			for msg := range pc.Messages() {
				if string(msg.Key) == key {
					ch <- result{msg: msg}
					return
				}
			}
		}(pc)
	}
	select {
	case r := <-ch:
		return r.msg
	case <-time.After(timeout):
		t.Fatalf("no message with key %q on topic %s within %v", key, topic, timeout)
		return nil
	}
}

// TestOutboxDrainPublishesByteForByte — the event consumed from the REAL
// topic must be byte-for-byte the payload written transactionally, keyed by
// the idempotent event key, and the row must be marked published.
func TestOutboxDrainPublishesByteForByte(t *testing.T) {
	d := testDB(t)
	brokers := testBrokers(t)
	_ = brokers

	topic := fmt.Sprintf("payment.outbox.test.%d", time.Now().UnixNano())
	key := "payment-4242"
	payload := map[string]any{"paymentId": 4242, "transferId": "txf-real", "tbTxId": "tb-1"}
	wantBytes, _ := json.Marshal(payload)

	tx, err := d.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := enqueueOutbox(context.Background(), tx, topic, key, payload); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	pub, err := NewOutboxPublisher(d, testProducer(t, nil), ".dlq")
	if err != nil {
		t.Fatalf("publisher: %v", err)
	}
	defer pub.Close()
	n, err := pub.Drain(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("drain: n=%d err=%v", n, err)
	}

	msg := consumeOne(t, topic, key, 15*time.Second)
	if !json.Valid(msg.Value) || string(msg.Value) != string(wantBytes) {
		t.Fatalf("event bytes mismatch:\n got: %s\nwant: %s", msg.Value, wantBytes)
	}

	var publishedAt sql.NullTime
	if err := d.QueryRow(`SELECT published_at FROM payment_outbox WHERE topic=$1 AND event_key=$2`, topic, key).Scan(&publishedAt); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if !publishedAt.Valid {
		t.Fatal("outbox row must be marked published")
	}
}

// TestOutboxAtomicity — a rolled-back domain transaction leaves no outbox
// row and the drainer publishes nothing (no phantom events).
func TestOutboxAtomicity(t *testing.T) {
	d := testDB(t)
	_ = testBrokers(t)

	tx, _ := d.BeginTx(context.Background(), nil)
	if err := enqueueOutbox(context.Background(), tx, "payment.rollback.test", "k1", map[string]any{"x": 1}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	tx.Rollback()

	pub, err := NewOutboxPublisher(d, testProducer(t, nil), ".dlq")
	if err != nil {
		t.Fatalf("publisher: %v", err)
	}
	defer pub.Close()
	n, err := pub.Drain(context.Background())
	if err != nil {
		t.Fatalf("drain: %v", err)
	}
	if n != 0 {
		t.Fatalf("rolled-back event must never be published: n=%d", n)
	}
	var count int
	if err := d.QueryRow(`SELECT count(*) FROM payment_outbox WHERE topic='payment.rollback.test'`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("rolled-back outbox row must not exist: %d", count)
	}
}

// TestOutboxPoisonRoutesToDLQ — a message the broker rejects (topic with
// max.message.bytes=64, payload ~300B) exhausts the attempt budget and lands
// on the REAL DLQ topic with the full envelope; the row is marked failed.
func TestOutboxPoisonRoutesToDLQ(t *testing.T) {
	d := testDB(t)
	brokers := testBrokers(t)

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	topic := "payment.toolarge." + suffix
	dlqTopic := topic + ".dlq"

	admin, err := sarama.NewClusterAdmin(brokers, sarama.NewConfig())
	if err != nil {
		t.Fatalf("cluster admin: %v", err)
	}
	defer admin.Close()
	if err := admin.CreateTopic(topic, &sarama.TopicDetail{
		NumPartitions:     1,
		ReplicationFactor: 1,
		ConfigEntries:     map[string]*string{"max.message.bytes": strPtr("64")},
	}, false); err != nil {
		t.Fatalf("create poison topic: %v", err)
	}
	if err := admin.CreateTopic(dlqTopic, &sarama.TopicDetail{NumPartitions: 1, ReplicationFactor: 1}, false); err != nil {
		t.Fatalf("create dlq topic: %v", err)
	}

	key := "payment-poison"
	payload := map[string]any{"paymentId": 9999, "blob": strings.Repeat("x", 300)}
	wantBytes, _ := json.Marshal(payload)

	tx, _ := d.BeginTx(context.Background(), nil)
	if err := enqueueOutbox(context.Background(), tx, topic, key, payload); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	pub, err := NewOutboxPublisher(d, testProducer(t, nil), ".dlq")
	if err != nil {
		t.Fatalf("publisher: %v", err)
	}
	defer pub.Close()
	for i := 0; i < maxOutboxAttempts; i++ {
		if _, err := pub.Drain(context.Background()); err != nil {
			t.Fatalf("drain %d: %v", i, err)
		}
	}

	var attempts int
	var failedAt sql.NullTime
	var lastErr sql.NullString
	if err := d.QueryRow(`SELECT attempts, failed_at, last_error FROM payment_outbox WHERE topic=$1 AND event_key=$2`, topic, key).
		Scan(&attempts, &failedAt, &lastErr); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if attempts != maxOutboxAttempts || !failedAt.Valid {
		t.Fatalf("poison row must be failed after %d attempts: attempts=%d failed_at=%v", maxOutboxAttempts, attempts, failedAt)
	}
	if !lastErr.Valid || lastErr.String == "" {
		t.Fatal("last_error must record the broker rejection")
	}

	// Verify the DLQ envelope on the REAL DLQ topic.
	msg := consumeOne(t, dlqTopic, key, 15*time.Second)
	var env outboxDLQEnvelope
	if err := json.Unmarshal(msg.Value, &env); err != nil {
		t.Fatalf("DLQ envelope not parseable: %v", err)
	}
	if env.OriginalTopic != topic || env.OriginalKey != key {
		t.Fatalf("DLQ envelope topic/key wrong: %+v", env)
	}
	if string(env.Payload) != string(wantBytes) {
		t.Fatalf("DLQ payload mismatch:\n got: %s\nwant: %s", env.Payload, wantBytes)
	}
	if env.Attempts != maxOutboxAttempts || env.ServiceName != "payment-service" || env.Error == "" {
		t.Fatalf("DLQ envelope incomplete: %+v", env)
	}
}

// TestEnqueueOutboxValidation — fail-closed argument validation (unit).
func TestEnqueueOutboxValidation(t *testing.T) {
	if err := enqueueOutbox(context.Background(), nil, "", "k", nil); err == nil {
		t.Fatal("empty topic must be rejected")
	}
	if err := enqueueOutbox(context.Background(), nil, "t", "", nil); err == nil {
		t.Fatal("empty key must be rejected")
	}
}

func strPtr(s string) *string { return &s }
