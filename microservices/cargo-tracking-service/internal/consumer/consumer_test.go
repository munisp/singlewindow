// Broker-gated + DB-gated consumer test: produce REAL signed geo.vessel-position.v1
// envelopes to a REAL local Kafka, consume, verify persistence in REAL
// PostgreSQL; a tampered envelope must be rejected to the REAL DLQ topic and
// never persisted.
//
// Gates:
//
//	KAFKA_TEST_BROKERS  e.g. 127.0.0.1:9092   (topics are pre-created — no auto-create)
//	CARGO_TEST_PG_DSN   e.g. postgresql://postgres@127.0.0.1:5432/cargo_test?sslmode=disable
package consumer

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	jsoncanonicalizer "github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
	_ "github.com/lib/pq"
	"github.com/segmentio/kafka-go"

	"github.com/blueeconomy/cargo-tracking-service/internal/envelope"
	"github.com/blueeconomy/cargo-tracking-service/internal/store"
)

// ─── Real envelope signer (mirrors geo-service internal/sign semantics) ──────

type gatedSigner struct {
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
	kid  string
}

func newGatedSigner(t *testing.T, epoch string) *gatedSigner {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	return &gatedSigner{priv: priv, pub: pub, kid: "blueeconomy-geo-service-" + epoch}
}

func (s *gatedSigner) signEnvelope(t *testing.T, env map[string]any) []byte {
	t.Helper()
	raw, _ := json.Marshal(env)
	var generic map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&generic); err != nil {
		t.Fatalf("decode: %v", err)
	}
	delete(generic["provenance"].(map[string]any), "signature")
	stripped, _ := json.Marshal(generic)
	canonical, err := jsoncanonicalizer.Transform(stripped)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	header, _ := json.Marshal(map[string]string{"alg": "EdDSA", "kid": s.kid})
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(canonical)
	sig := ed25519.Sign(s.priv, []byte(input))
	generic["provenance"].(map[string]any)["signature"] = input + "." + base64.RawURLEncoding.EncodeToString(sig)
	out, _ := json.Marshal(generic)
	return out
}

func gatedEnvelope(mmsi, reportID string) map[string]any {
	resource := map[string]any{
		"@type":                        "type.googleapis.com/blueeconomy.contracts.v1.VesselPositionReported",
		"positionReportId":             reportID,
		"mmsi":                         mmsi,
		"sourceClass":                  "AIS",
		"latitudeMicros":               5603700,
		"longitudeMicros":              -187000,
		"speedOverGroundMilliknots":    12400,
		"courseOverGroundMillidegrees": 180000,
		"positionAccuracy":             "HIGH",
		"observedAt":                   time.Now().UTC().Format(time.RFC3339Nano),
		"receiverId":                   "tema-rx-1",
		"classification":               "INTERNAL",
		"shipName":                     "MV GATED TEST",
	}
	bundle := map[string]any{
		"resourceType": "Bundle", "type": "message", "bundleId": "bdl-gated-1",
		"entry": []any{map[string]any{"fullUrl": "urn:uuid:e-1", "resource": resource}},
	}
	return map[string]any{
		"envelopeVersion": "1.0",
		"eventId":         "evt-" + reportID,
		"eventType":       "geo.vessel-position.v1",
		"occurredAt":      time.Now().UTC().Format(time.RFC3339Nano),
		"producer":        "blueeconomy-geo-service",
		"correlationId":   "corr-gated-1",
		"classification":  "INTERNAL",
		"fhir":            bundle,
		"provenance": map[string]any{
			"principalId": "ais-ingest-1", "principalRole": "SYSTEM",
			"ledgerCommitHash": "abc", "signature": "placeholder",
		},
	}
}

// ─── Gates and helpers ────────────────────────────────────────────────────────

func gatedBrokers(t *testing.T) []string {
	t.Helper()
	b := os.Getenv("KAFKA_TEST_BROKERS")
	if b == "" {
		t.Skip("KAFKA_TEST_BROKERS not set — skipping broker-gated consumer test")
	}
	return strings.Split(b, ",")
}

func gatedStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("CARGO_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("CARGO_TEST_PG_DSN not set — skipping DB-gated consumer test")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	if err := db.Ping(); err != nil {
		t.Skipf("test DB unreachable: %v", err)
	}
	st := store.New(db)
	if err := st.EnsureSchema(context.Background()); err != nil {
		t.Fatalf("schema: %v", err)
	}
	return st
}

func createTopic(t *testing.T, brokers []string, topic string) {
	t.Helper()
	conn, err := kafka.Dial("tcp", brokers[0])
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	if err := conn.CreateTopics(kafka.TopicConfig{Topic: topic, NumPartitions: 1, ReplicationFactor: 1}); err != nil {
		t.Fatalf("create topic %s: %v", topic, err)
	}
}

// TestConsumerEndToEndRealBroker — full ingestion path against real infra.
func TestConsumerEndToEndRealBroker(t *testing.T) {
	brokers := gatedBrokers(t)
	st := gatedStore(t)

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	topic := "vessels.events.gated." + suffix
	dlqTopic := topic + ".dlq"
	createTopic(t, brokers, topic)
	createTopic(t, brokers, dlqTopic)

	signer := newGatedSigner(t, "42")
	keys := envelope.TrustKeys{signer.kid: signer.pub}

	cfg := &Config{
		Brokers:     brokers,
		Topic:       topic,
		DLQTopic:    dlqTopic,
		GroupID:     "cargo-gated-" + suffix,
		StartOffset: kafka.FirstOffset, // fresh topic: deterministic, no produce/join race
	}
	cons := New(cfg, keys, st)
	t.Cleanup(cons.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go cons.Run(ctx)

	writer := &kafka.Writer{Addr: kafka.TCP(brokers...), Topic: topic, RequiredAcks: kafka.RequireAll}
	defer writer.Close()

	// 1. Valid signed envelope → must be persisted.
	good := signer.signEnvelope(t, gatedEnvelope("636019825", "pr-gated-1"))
	if err := writer.WriteMessages(context.Background(), kafka.Message{Key: []byte("636019825"), Value: good}); err != nil {
		t.Fatalf("produce valid: %v", err)
	}

	// 2. Tampered envelope (payload mutated post-signing) → DLQ, never persisted.
	var tampered map[string]any
	dec := json.NewDecoder(bytes.NewReader(good))
	dec.UseNumber()
	if err := dec.Decode(&tampered); err != nil {
		t.Fatalf("decode: %v", err)
	}
	bundle := tampered["fhir"].(map[string]any)
	bundle["entry"].([]any)[0].(map[string]any)["resource"].(map[string]any)["mmsi"] = "999999999"
	tamperedRaw, _ := json.Marshal(tampered)
	if err := writer.WriteMessages(context.Background(), kafka.Message{Key: []byte("999999999"), Value: tamperedRaw}); err != nil {
		t.Fatalf("produce tampered: %v", err)
	}

	// Assert persistence of the valid position.
	deadline := time.Now().Add(45 * time.Second)
	var vessel *store.Vessel
	for time.Now().Before(deadline) {
		v, err := st.LatestByMMSI(context.Background(), "636019825")
		if err == nil {
			vessel = v
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if vessel == nil {
		t.Fatal("valid signed envelope was not persisted within 45s")
	}
	if vessel.Name != "MV GATED TEST" || vessel.Source != "AIS" || vessel.SignerKID != signer.kid {
		t.Fatalf("persisted vessel mismatch: %+v", vessel)
	}
	if vessel.Latitude != 5.6037 || vessel.SpeedKnots != 12.4 {
		t.Fatalf("persisted position fields mismatch: %+v", vessel)
	}

	// Assert the tampered message reached the DLQ with the rejection reason.
	dlqReader := kafka.NewReader(kafka.ReaderConfig{
		Brokers: brokers, Topic: dlqTopic, GroupID: "cargo-gated-dlq-" + suffix,
		StartOffset: kafka.FirstOffset, MinBytes: 1, MaxBytes: 1 << 20,
	})
	defer dlqReader.Close()
	readCtx, readCancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer readCancel()
	msg, err := dlqReader.ReadMessage(readCtx)
	if err != nil {
		t.Fatalf("tampered message not found on DLQ topic: %v", err)
	}
	var dlqEnv dlqEnvelope
	if err := json.Unmarshal(msg.Value, &dlqEnv); err != nil {
		t.Fatalf("DLQ envelope not parseable: %v", err)
	}
	if dlqEnv.OriginalTopic != topic || !strings.Contains(dlqEnv.Error, "verification failed") {
		t.Fatalf("DLQ envelope wrong: %+v", dlqEnv)
	}

	// Assert the tampered MMSI was never persisted.
	if _, err := st.LatestByMMSI(context.Background(), "999999999"); err != store.ErrNotFound {
		t.Fatalf("tampered position must never be persisted (err=%v)", err)
	}

	// Consumer stats must reflect 1 ingested, 1 rejected.
	ingested, rejected, _, _ := cons.Stats()
	if ingested != 1 || rejected != 1 {
		t.Fatalf("consumer stats: ingested=%d rejected=%d, want 1/1", ingested, rejected)
	}
}
