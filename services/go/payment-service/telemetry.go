// telemetry.go — Phase-7 OpenTelemetry bootstrap for payment-service
// (OTEL_DESIGN.md §1 architecture + §2 Go row).
//
// Contract: OTEL_EXPORTER_OTLP_ENDPOINT unset ⇒ telemetry disabled and boot
// MUST NOT break (the one sanctioned fail-open). When set: OTLP/HTTP exporter
// behind a BatchSpanProcessor — async/batched, non-blocking; collector-down =
// drop, never a request failure. W3C tracecontext+baggage propagation
// everywhere (HTTP via otelhttp, Kafka via manual sarama carriers).
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/IBM/sarama"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

const telemetryServiceName = "payment-service"

// InitTelemetry starts the OTel SDK when OTEL_EXPORTER_OTLP_ENDPOINT is set.
// Returns a shutdown func and whether telemetry is enabled. Fail-open by
// design: any setup error logs a warning and returns a disabled no-op.
func InitTelemetry(ctx context.Context) (func(context.Context), bool) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		log.Printf("[otel] OTEL_EXPORTER_OTLP_ENDPOINT unset — telemetry disabled (business path unaffected)")
		return func(context.Context) {}, false
	}
	opts := []otlptracehttp.Option{}
	// In-cluster collectors serve plaintext HTTP; bare host[:port] endpoints
	// and explicit http:// URLs must not attempt TLS.
	if strings.HasPrefix(endpoint, "http://") || !strings.Contains(endpoint, "://") {
		opts = append(opts, otlptracehttp.WithInsecure())
	}
	exporter, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		log.Printf("[otel] exporter init failed — telemetry disabled (fail-open): %v", err)
		return func(context.Context) {}, false
	}
	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(telemetryServiceName),
			semconv.ServiceVersion("1.1.0"),
		),
		resource.WithFromEnv(),
	)
	if err != nil {
		res = resource.Default()
	}
	tp := sdktrace.NewTracerProvider(
		// Batch: async, non-blocking; a down collector drops spans, never requests.
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	log.Printf("[otel] SDK started for %s → %s (OTLP/HTTP, batch)", telemetryServiceName, endpoint)
	return func(ctx context.Context) { _ = tp.Shutdown(ctx) }, true
}

// tracedHandler wraps an HTTP handler with a server span (otelhttp).
func tracedHandler(operation string, h http.Handler) http.Handler {
	return otelhttp.NewHandler(h, operation)
}

// tracedTransport returns an HTTP RoundTripper that creates client spans and
// injects the W3C traceparent/tracestate/baggage headers on outbound calls.
func tracedTransport() http.RoundTripper {
	return otelhttp.NewTransport(http.DefaultTransport)
}

// ─── Sarama Kafka carriers (manual W3C propagation) ──────────────────────────

// saramaProducerCarrier adapts sarama.ProducerMessage.Headers to
// propagation.TextMapCarrier for traceparent injection on produce.
type saramaProducerCarrier struct {
	msg *sarama.ProducerMessage
}

func (c saramaProducerCarrier) Get(key string) string {
	for _, h := range c.msg.Headers {
		if strings.EqualFold(string(h.Key), key) {
			return string(h.Value)
		}
	}
	return ""
}

func (c saramaProducerCarrier) Set(key, value string) {
	// Replace existing header with the same key (case-insensitive).
	for i, h := range c.msg.Headers {
		if strings.EqualFold(string(h.Key), key) {
			c.msg.Headers[i].Value = []byte(value)
			return
		}
	}
	c.msg.Headers = append(c.msg.Headers, sarama.RecordHeader{
		Key:   []byte(key),
		Value: []byte(value),
	})
}

func (c saramaProducerCarrier) Keys() []string {
	keys := make([]string, 0, len(c.msg.Headers))
	for _, h := range c.msg.Headers {
		keys = append(keys, string(h.Key))
	}
	return keys
}

// injectKafkaHeaders injects the active trace context into a producer message.
func injectKafkaHeaders(ctx context.Context, msg *sarama.ProducerMessage) {
	otel.GetTextMapPropagator().Inject(ctx, saramaProducerCarrier{msg: msg})
}

// saramaConsumerCarrier adapts sarama.ConsumerMessage.Headers for extraction.
type saramaConsumerCarrier struct {
	msg *sarama.ConsumerMessage
}

func (c saramaConsumerCarrier) Get(key string) string {
	for _, h := range c.msg.Headers {
		if h != nil && strings.EqualFold(string(h.Key), key) {
			return string(h.Value)
		}
	}
	return ""
}

func (c saramaConsumerCarrier) Set(_ string, _ string) {}

func (c saramaConsumerCarrier) Keys() []string {
	keys := make([]string, 0, len(c.msg.Headers))
	for _, h := range c.msg.Headers {
		if h != nil {
			keys = append(keys, string(h.Key))
		}
	}
	return keys
}

// extractKafkaContext extracts a remote trace context from a consumed message.
func extractKafkaContext(ctx context.Context, msg *sarama.ConsumerMessage) context.Context {
	return otel.GetTextMapPropagator().Extract(ctx, saramaConsumerCarrier{msg: msg})
}
