// telemetry.go — Phase-7 OpenTelemetry bootstrap for workflow-service
// (OTEL_DESIGN.md §1 architecture + §2 Go row + §3 Temporal row).
//
// Contract: OTEL_EXPORTER_OTLP_ENDPOINT unset ⇒ telemetry disabled and boot
// MUST NOT break (the one sanctioned fail-open). When set: OTLP/HTTP exporter
// behind a BatchSpanProcessor — async/batched, non-blocking; collector-down =
// drop, never a workflow/activity failure. Temporal workflow/activity spans
// join service traces via the official SDK interceptor (wired in main.go).
package main

import (
	"context"
	"log"
	"os"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

const telemetryServiceName = "workflow-service"

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
