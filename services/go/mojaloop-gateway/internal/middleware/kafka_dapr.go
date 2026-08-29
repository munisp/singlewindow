// Package middleware provides Dapr pub/sub and OpenTelemetry integration for mojaloop-gateway.
// Kafka topics published:  payments.confirmed   (duty payment confirmed, triggers clearance workflow)
//
//	payments.failed      (payment failed, triggers retry/alert)
//	payments.initiated   (payment initiated by trader)
//
// Kafka topics consumed:   declarations.cleared (clearance confirmed, payment receipt issued)
// Dapr pub/sub:            publishes payments.confirmed to pubsub component
// NOTE: Fluvio is NOT deployed; Kafka is the real event bus (P0 remediation).
// OpenTelemetry:           distributed tracing for every payment lifecycle event
package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/tradegateway/mojaloop-gateway/internal/telemetry"
	"net/http"
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

	DaprPubsubName = "pubsub"
	ServiceName    = "mojaloop-gateway"
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

// ─── Dapr Pub/Sub ─────────────────────────────────────────────────────────────

type daprPublishRequest struct {
	Data            any    `json:"data"`
	DataContentType string `json:"datacontenttype"`
}

// DaprPublishPayment publishes a payment event to Dapr pub/sub (pubsub component).
// This triggers the Temporal clearance workflow via Dapr subscription.
func DaprPublishPayment(ctx context.Context, topic string, payload any) error {
	daprPort := os.Getenv("DAPR_HTTP_PORT")
	if daprPort == "" {
		daprPort = "3500"
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", daprPort, DaprPubsubName, topic)

	body, err := json.Marshal(daprPublishRequest{
		Data:            payload,
		DataContentType: "application/json",
	})
	if err != nil {
		return fmt.Errorf("marshal dapr payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create dapr request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("dapr publish to %s: %w", topic, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("dapr publish %s returned HTTP %d", topic, resp.StatusCode)
	}
	slog.Info("Dapr payment event published", "topic", topic, "status", resp.StatusCode)
	return nil
}

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
