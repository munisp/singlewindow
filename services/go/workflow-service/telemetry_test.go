// telemetry_test.go — Phase-7 OTel gates for workflow-service:
// disabled-mode boot + W3C propagation round-trip.
package main

import (
	"context"
	"os"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

func TestTelemetryDisabledMode(t *testing.T) {
	os.Unsetenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	shutdown, enabled := InitTelemetry(context.Background())
	if enabled {
		t.Fatal("expected telemetry disabled when OTEL_EXPORTER_OTLP_ENDPOINT is unset")
	}
	if shutdown == nil {
		t.Fatal("shutdown func must never be nil (fail-open contract)")
	}
	shutdown(context.Background())
}

func TestPropagationRoundTrip(t *testing.T) {
	// Register the composite propagator the way InitTelemetry does.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	traceID, _ := trace.TraceIDFromHex("0af7651916cd43dd8448eb211c80319c")
	spanID, _ := trace.SpanIDFromHex("b7ad6b7169203331")
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})
	ctx := trace.ContextWithSpanContext(context.Background(), sc)

	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	want := "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
	if carrier.Get("traceparent") != want {
		t.Fatalf("traceparent = %q, want %q", carrier.Get("traceparent"), want)
	}

	extracted := otel.GetTextMapPropagator().Extract(context.Background(), carrier)
	remote := trace.SpanContextFromContext(extracted)
	if remote.TraceID() != traceID || remote.SpanID() != spanID || !remote.IsRemote() {
		t.Fatalf("extracted span context = %v", remote)
	}
}
