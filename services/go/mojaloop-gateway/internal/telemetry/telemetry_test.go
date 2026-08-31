// telemetry_test.go — Phase-7 OTel gates for mojaloop-gateway:
// disabled-mode boot + Kafka/HTTP propagation round-trip.
package telemetry

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

func TestDisabledMode(t *testing.T) {
	os.Unsetenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	shutdown, enabled := Init(context.Background(), "mojaloop-gateway")
	if enabled {
		t.Fatal("expected telemetry disabled when OTEL_EXPORTER_OTLP_ENDPOINT is unset")
	}
	if shutdown == nil {
		t.Fatal("shutdown func must never be nil (fail-open contract)")
	}
	shutdown(context.Background())
}

func TestKafkaCarrierRoundTrip(t *testing.T) {
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

	out := &sarama.ProducerMessage{Topic: "mojaloop.transfers"}
	InjectKafka(ctx, out)
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

	in := &sarama.ConsumerMessage{Topic: "mojaloop.transfers"}
	for _, h := range out.Headers {
		h := h
		in.Headers = append(in.Headers, &h)
	}
	remote := trace.SpanContextFromContext(ExtractKafka(context.Background(), in))
	if remote.TraceID() != traceID || remote.SpanID() != spanID || !remote.IsRemote() {
		t.Fatalf("extracted span context = %v", remote)
	}
}

func TestTransportInjectsTraceparentAndHandlerServesWhenDisabled(t *testing.T) {
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

	client := &http.Client{Transport: Transport(nil)}
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(gotTraceparent) < 55 || gotTraceparent[3:35] != traceID.String() {
		t.Fatalf("traceparent %q does not carry trace id %s", gotTraceparent, traceID)
	}

	os.Unsetenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	h := Handler("test.op", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/x", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}
