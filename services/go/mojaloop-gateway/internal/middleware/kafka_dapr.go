// Package middleware provides Kafka and OpenTelemetry integration for mojaloop-gateway.
// Kafka topics published:  payments.confirmed   (duty payment confirmed, triggers clearance workflow)
//
//	payments.failed      (payment failed, triggers retry/alert)
//	payments.initiated   (payment initiated by trader)
//
// Kafka topics consumed:   declarations.cleared (clearance confirmed, payment receipt issued)
// NOTE: Fluvio is NOT deployed; Kafka is the real event bus (P0 remediation).
// NOTE (PRA-123, Phase 9): the Dapr pub/sub publish path was REMOVED. It was an
// unreferenced lossy duplicate of the Kafka publish path (Kafka is the
// authoritative bus; Dapr was never deployed with a pubsub component), and a
// Dapr failure was non-fatal — a payment event could be durably committed to
// Kafka while the Dapr copy silently vanished, or vice versa. One bus, one
// failure posture: PublishPaymentEvent returns the broker error to the caller.
// OpenTelemetry:           distributed tracing for every payment lifecycle event
package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/tradegateway/mojaloop-gateway/internal/telemetry"
	"os"
	"time"

	"github.com/IBM/sarama"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
)

// ─── Topic & Component Constants ─────────────────────────────────────────────

const (
	TopicPaymentsConfirmed   = "payments.confirmed"
	TopicPaymentsFailed      = "payments.failed"
	TopicPaymentsInitiated   = "payments.initiated"
	TopicDeclarationsCleared = "declarations.cleared"

	ServiceName = "mojaloop-gateway"
)

// ─── Kafka Producer ───────────────────────────────────────────────────────────

func kafkaBrokers() []string {
	b := os.Getenv("KAFKA_BROKERS")
	if b == "" {
		b = "kafka:9092"
	}
	result := []string{}
	for _, br := range splitCSV(b) {
		if br != "" {
			result = append(result, br)
		}
	}
	return result
}

func splitCSV(s string) []string {
	var result []string
	for _, part := range splitString(s, ",") {
		result = append(result, trimSpace(part))
	}
	return result
}

func splitString(s, sep string) []string {
	var result []string
	start := 0
	for i := 0; i < len(s); i++ {
		if string(s[i]) == sep {
			result = append(result, s[start:i])
			start = i + 1
		}
	}
	result = append(result, s[start:])
	return result
}

func trimSpace(s string) string {
	start := 0
	end := len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

// NewKafkaProducer creates a new synchronous Kafka producer for mojaloop-gateway.
func NewKafkaProducer() (sarama.SyncProducer, error) {
	cfg := sarama.NewConfig()
	cfg.Producer.Return.Successes = true
	cfg.Producer.Return.Errors = true
	cfg.Producer.RequiredAcks = sarama.WaitForAll
	cfg.Producer.Retry.Max = 5
	cfg.Producer.Retry.Backoff = 200 * time.Millisecond
	cfg.Net.DialTimeout = 10 * time.Second
	cfg.Net.ReadTimeout = 30 * time.Second
	cfg.Net.WriteTimeout = 30 * time.Second
	cfg.Version = sarama.V3_3_0_0

	producer, err := sarama.NewSyncProducer(kafkaBrokers(), cfg)
	if err != nil {
		return nil, fmt.Errorf("mojaloop-gateway: failed to create Kafka producer: %w", err)
	}
	slog.Info("Kafka producer connected", "brokers", kafkaBrokers())
	return producer, nil
}

// PublishPaymentEvent publishes a payment event to the specified Kafka topic.
// Phase-7 OTel: the active trace context is injected as a W3C traceparent
// header carrier so downstream consumers join the same trace.
func PublishPaymentEvent(producer sarama.SyncProducer, topic string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payment event: %w", err)
	}
	msg := &sarama.ProducerMessage{
		Topic:     topic,
		Value:     sarama.ByteEncoder(data),
		Timestamp: time.Now().UTC(),
	}
	telemetry.InjectKafka(context.Background(), msg)
	partition, offset, err := producer.SendMessage(msg)
	if err != nil {
		return fmt.Errorf("send to %s: %w", topic, err)
	}
	slog.Info("Payment event published", "topic", topic, "partition", partition, "offset", offset)
	return nil
}

// ─── Dapr Pub/Sub — REMOVED (PRA-123, Phase 9) ──────────────────────────────
// DaprPublishPayment was an unreferenced lossy duplicate of the Kafka publish
// path whose failures were non-fatal to the caller. Removed: Kafka
// (PublishPaymentEvent) is the single authoritative publish path and broker
// errors are fatal to the publish path.

// ─── Fluvio Real-time Streaming — REMOVED (P0 remediation) ──────────────────
// The Fluvio HTTP producer posted to a non-existent endpoint
// (http://fluvio:9003/produce/...) and swallowed the resulting errors — Fluvio
// is NOT deployed on this platform. Kafka is the real event bus; real-time
// payment status updates flow through PublishPaymentEvent (Kafka topics) and
// the Dapr pub/sub wrapper above.

// ─── OpenTelemetry Tracing ────────────────────────────────────────────────────

// InitTracer initialises the OTLP trace exporter and sets the global TracerProvider.
// Call this once at service startup; the returned shutdown function must be deferred.
// Phase-7 contract (OTEL_DESIGN.md §1): OTEL_EXPORTER_OTLP_ENDPOINT unset ⇒
// telemetry DISABLED — returns (no-op, nil); the business path never depends on
// telemetry (the one sanctioned fail-open).
func InitTracer(serviceName string) (func(context.Context) error, error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		slog.Info("OTEL_EXPORTER_OTLP_ENDPOINT unset — telemetry disabled (business path unaffected)")
		return func(context.Context) error { return nil }, nil
	}
	ctx := context.Background()
	opts := []otlptracehttp.Option{}
	if strings.HasPrefix(endpoint, "http://") || !strings.Contains(endpoint, "://") {
		opts = append(opts, otlptracehttp.WithInsecure())
	}
	exp, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create OTLP exporter: %w", err)
	}
	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion("1.0.0"),
			attribute.String("platform", "tradegateway-ngswtp"),
			attribute.String("component", "payment-gateway"),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create OTel resource: %w", err)
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	otel.SetTracerProvider(tp)
	slog.Info("OpenTelemetry tracer initialised", "service", serviceName, "endpoint", endpoint)
	return tp.Shutdown, nil
}

// Tracer returns a named tracer for the given service.
func Tracer(serviceName string) trace.Tracer {
	return otel.Tracer(serviceName)
}
