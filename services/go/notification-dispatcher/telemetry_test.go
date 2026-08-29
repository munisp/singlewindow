// telemetry_test.go — Phase-7 OTel gates for notification-dispatcher:
// disabled-mode boot + kafka-go carrier propagation round-trip.
package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	kafka "github.com/segmentio/kafka-go"
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

func TestKafkaGoCarrierRoundTrip(t *testing.T) {
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

	// Produce: inject.
	out := kafka.Message{Topic: TopicPushDispatch, Value: []byte(`{"token":"t"}`)}
	injectKafkaHeaders(ctx, &out)
	var tpHeader string
	for _, h := range out.Headers {
		if h.Key == "traceparent" {
			tpHeader = string(h.Value)
		}
	}
	want := "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
	if tpHeader != want {
		t.Fatalf("traceparent header = %q, want %q", tpHeader, want)
	}

	// Consume: extract.
	in := kafka.Message{Topic: TopicPushDispatch, Headers: out.Headers}
	remote := trace.SpanContextFromContext(extractKafkaContext(context.Background(), &in))
	if remote.TraceID() != traceID || remote.SpanID() != spanID {
		t.Fatalf("extracted span context = %v, want trace %v span %v", remote, traceID, spanID)
	}
	if !remote.IsRemote() {
		t.Fatal("extracted span context must be marked remote")
	}
}

func TestTracedHandlerServesNormallyWhenDisabled(t *testing.T) {
	os.Unsetenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	h := tracedHandler("test.op", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/x", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}
