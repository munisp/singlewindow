// telemetry_test.go — Phase-7 OTel gates for payment-service:
// disabled-mode boot + Kafka/HTTP propagation round-trip.
package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/IBM/sarama"
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
	// Shutdown must be safe to call.
	shutdown(context.Background())
}

func TestKafkaCarrierRoundTrip(t *testing.T) {
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
	out := &sarama.ProducerMessage{Topic: "payments.initiated"}
	injectKafkaHeaders(ctx, out)
	var tpHeader string
	for _, h := range out.Headers {
		if string(h.Key) == "traceparent" {
			tpHeader = string(h.Value)
		}
	}
	want := "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
	if tpHeader != want {
		t.Fatalf("traceparent header = %q, want %q", tpHeader, want)
	}

	// Consume: extract.
	in := &sarama.ConsumerMessage{Topic: "payments.initiated", Headers: []*sarama.RecordHeader{}}
	for _, h := range out.Headers {
		h := h
		in.Headers = append(in.Headers, &h)
	}
	extracted := extractKafkaContext(context.Background(), in)
	remote := trace.SpanContextFromContext(extracted)
	if remote.TraceID() != traceID || remote.SpanID() != spanID {
		t.Fatalf("extracted span context = %v, want trace %v span %v", remote, traceID, spanID)
	}
	if !remote.IsRemote() {
		t.Fatal("extracted span context must be marked remote")
	}
}

func TestTracedTransportInjectsTraceparent(t *testing.T) {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	traceID, _ := trace.TraceIDFromHex("4bf92f3577b34da6a3ce929d0e0e4736")
	spanID, _ := trace.SpanIDFromHex("00f067aa0ba902b7")
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})
	ctx := trace.ContextWithSpanContext(context.Background(), sc)

	var gotTraceparent string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTraceparent = r.Header.Get("traceparent")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := &http.Client{Transport: tracedTransport()}
	req, err := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if gotTraceparent == "" {
		t.Fatal("tracedTransport must inject a traceparent header")
	}
	// otelhttp creates a child client span; trace id must be preserved.
	if len(gotTraceparent) < 55 || gotTraceparent[3:35] != string(traceID.String()) {
		t.Fatalf("traceparent %q does not carry trace id %s", gotTraceparent, traceID)
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
