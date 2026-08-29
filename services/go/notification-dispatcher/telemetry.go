// telemetry.go — Phase-7 OpenTelemetry bootstrap for notification-dispatcher
// (OTEL_DESIGN.md §1 architecture + §2 Go row).
//
// Contract: OTEL_EXPORTER_OTLP_ENDPOINT unset ⇒ telemetry disabled and boot
// MUST NOT break (the one sanctioned fail-open). When set: OTLP/HTTP exporter
// behind a BatchSpanProcessor — async/batched, non-blocking; collector-down =
// drop, never a notification failure. W3C tracecontext+baggage propagation
// everywhere (HTTP via otelhttp, Kafka via manual kafka-go carriers).
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"

	kafka "github.com/segmentio/kafka-go"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

const telemetryServiceName = "notification-dispatcher"

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
		resource.WithAttributes(semconv.ServiceName(telemetryServiceName)),
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
// injects W3C headers on outbound calls.
func tracedTransport() http.RoundTripper {
	return otelhttp.NewTransport(http.DefaultTransport)
}

// ─── kafka-go carriers (manual W3C propagation) ──────────────────────────────

// kafkaWriteCarrier adapts an outgoing kafka.Message's headers for injection.
type kafkaWriteCarrier struct {
	msg *kafka.Message
}

func (c kafkaWriteCarrier) Get(key string) string {
	for _, h := range c.msg.Headers {
		if strings.EqualFold(h.Key, key) {
			return string(h.Value)
		}
	}
	return ""
}

func (c kafkaWriteCarrier) Set(key, value string) {
	for i, h := range c.msg.Headers {
		if strings.EqualFold(h.Key, key) {
			c.msg.Headers[i].Value = []byte(value)
			return
		}
	}
	c.msg.Headers = append(c.msg.Headers, kafka.Header{Key: key, Value: []byte(value)})
}

func (c kafkaWriteCarrier) Keys() []string {
	keys := make([]string, 0, len(c.msg.Headers))
	for _, h := range c.msg.Headers {
		keys = append(keys, h.Key)
	}
	return keys
}

// kafkaReadCarrier adapts an incoming kafka.Message's headers for extraction.
type kafkaReadCarrier struct {
	msg *kafka.Message
}

func (c kafkaReadCarrier) Get(key string) string {
	return kafkaWriteCarrier(c).Get(key)
}

func (c kafkaReadCarrier) Set(_, _ string) {}

func (c kafkaReadCarrier) Keys() []string {
	return kafkaWriteCarrier(c).Keys()
}

// injectKafkaHeaders injects the active trace context into an outgoing message.
func injectKafkaHeaders(ctx context.Context, msg *kafka.Message) {
	otel.GetTextMapPropagator().Inject(ctx, kafkaWriteCarrier{msg: msg})
}

// extractKafkaContext extracts a remote trace context from a consumed message.
func extractKafkaContext(ctx context.Context, msg *kafka.Message) context.Context {
	return otel.GetTextMapPropagator().Extract(ctx, kafkaReadCarrier{msg: msg})
}
