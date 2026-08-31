// Phase-9 WP-B pipeline tests — test cases (helpers in pipeline_test.go).
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/IBM/sarama"
	"github.com/tradegateway/mojaloop-gateway/internal/tariff"
)

// TestNoSimulatedPipelineGate — grep gate: the pipeline source must contain
// no latency-simulation sleeps and none of the deleted hardcoded duty numbers.
func TestNoSimulatedPipelineGate(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	for _, banned := range []string{"time.Sleep", "9040", "6780", "1130", "GhanaRevenue", "233501234567"} {
		if strings.Contains(string(src), banned) {
			t.Fatalf("main.go still contains banned fabricated content %q", banned)
		}
	}
}

func TestParseDecimalMinor(t *testing.T) {
	cases := []struct {
		in      string
		want    int64
		wantErr bool
	}{
		{"1500.00", 150000, false},
		{"45200.00", 4520000, false},
		{"0.01", 1, false},
		{"42", 4200, false},
		{"1.5", 150, false},
		{"1.005", 0, true}, // >2dp rejected
		{"abc", 0, true},   // non-numeric
		{"-5.00", 0, true}, // negative rejected (must be positive)
		{"0", 0, true},     // zero rejected
		{"", 0, true},
	}
	for _, tc := range cases {
		got, err := parseDecimalMinor(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("parseDecimalMinor(%q): expected error, got %d", tc.in, got)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Errorf("parseDecimalMinor(%q) = %d, %v; want %d", tc.in, got, err, tc.want)
		}
	}
}

// TestPipelineFailClosedNoTariffEngine — with NO tariff engine configured the
// pipeline must fail at step 1 with the typed DUTY_ASSESSMENT_UNAVAILABLE.
func TestPipelineFailClosedNoTariffEngine(t *testing.T) {
	resetPayments(t)
	gw := newTestGateway(t, testGatewayDeps{})
	rec, err := gw.InitiatePayment(context.Background(), "DECL-1", "trader-1", "1500.00", "GHS", "bank_transfer", testTariffRequest())
	if err != nil {
		t.Fatalf("InitiatePayment: %v", err)
	}
	final := awaitTerminal(t, rec.ID, 5*time.Second)
	final.mu.RLock()
	defer final.mu.RUnlock()
	if final.Status != StatusFailed {
		t.Fatalf("expected FAILED, got %s", final.Status)
	}
	if final.ErrorCode != string(ErrCodeDutyUnavailable) {
		t.Fatalf("expected %s, got %q (%s)", ErrCodeDutyUnavailable, final.ErrorCode, final.ErrorMessage)
	}
	if len(final.Steps) != 1 || final.Steps[0].Status != StatusFailed {
		t.Fatalf("step 1 must be the failure point: %+v", final.Steps)
	}
}

// TestPipelineDutyAssessmentReal — with a real (httptest) tariff engine the
// step records the engine's response; without a switch the next step fails
// closed NOT_IMPLEMENTED.
func TestPipelineDutyAssessmentReal(t *testing.T) {
	resetPayments(t)
	engine := newFakeTariff(t)
	gw := newTestGateway(t, testGatewayDeps{tariffURL: engine.URL})

	rec, err := gw.InitiatePayment(context.Background(), "DECL-2", "trader-1", "1500.00", "GHS", "bank_transfer", testTariffRequest())
	if err != nil {
		t.Fatalf("InitiatePayment: %v", err)
	}
	final := awaitTerminal(t, rec.ID, 10*time.Second)
	final.mu.RLock()
	defer final.mu.RUnlock()

	// Step 1 succeeded with the engine's REAL response.
	if len(final.Steps) < 2 {
		t.Fatalf("expected at least 2 steps, got %+v", final.Steps)
	}
	if final.Steps[0].Status != StatusConfirmed {
		t.Fatalf("duty step must be CONFIRMED: %+v", final.Steps[0])
	}
	if final.AssessmentID != "asm-"+rec.ID {
		t.Fatalf("assessment id must come from the engine: %q", final.AssessmentID)
	}
	respJSON, _ := json.Marshal(final.Steps[0].Response)
	var asm tariff.Assessment
	if err := json.Unmarshal(respJSON, &asm); err != nil || asm.TotalUsdMinor != 25000*10 {
		t.Fatalf("step response must be the engine assessment: %s", respJSON)
	}

	// Step 2 (quote) failed closed — no switch configured.
	if final.Status != StatusFailed || final.ErrorCode != string(ErrCodeQuoteNotConfigured) {
		t.Fatalf("expected %s, got status=%s code=%s", ErrCodeQuoteNotConfigured, final.Status, final.ErrorCode)
	}

	// The engine saw the Idempotency-Key.
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if len(engine.keys) != 1 || engine.keys[0] != rec.ID {
		t.Fatalf("Idempotency-Key must be the payment id: %v", engine.keys)
	}
}

// TestPipelineKafkaFailClosed — full external path succeeds (real tariff
// engine, real signed FSPIOP quote+transfer callbacks, real bridge calls) and
// the final step fails closed with KAFKA_NOT_CONFIGURED when no broker is set.
func TestPipelineKafkaFailClosed(t *testing.T) {
	resetPayments(t)
	engine := newFakeTariff(t)
	hub := newFakeHub(t)
	hub.serve(t)
	t.Setenv("MOJALOOP_HUB_JWKS_URL", hub.switch_.URL+"/.well-known/jwks.json")
	bridge := newFakeBridge(t)

	gw := newTestGateway(t, testGatewayDeps{tariffURL: engine.URL, hub: hub, bridge: bridge})
	// Gateway serves its own callback endpoints on a real HTTP server.
	gwSrv := httptest.NewServer(gw.routes())
	defer gwSrv.Close()
	hub.callbackURL = gwSrv.URL

	rec, err := gw.InitiatePayment(context.Background(), "DECL-3", "trader-1", "1500.00", "GHS", "bank_transfer", testTariffRequest())
	if err != nil {
		t.Fatalf("InitiatePayment: %v", err)
	}
	final := awaitTerminal(t, rec.ID, 20*time.Second)
	final.mu.RLock()
	defer final.mu.RUnlock()

	if final.Status != StatusFailed || final.ErrorCode != string(ErrCodeKafkaNotConfigured) {
		t.Fatalf("expected %s failure, got status=%s code=%q msg=%s",
			ErrCodeKafkaNotConfigured, final.Status, final.ErrorCode, final.ErrorMessage)
	}
	// Steps 1..7 all REAL and confirmed.
	if len(final.Steps) != 8 {
		t.Fatalf("expected 8 steps, got %d", len(final.Steps))
	}
	for i := 0; i < 7; i++ {
		if final.Steps[i].Status != StatusConfirmed {
			t.Fatalf("step %d (%s) must be CONFIRMED: %+v", i+1, final.Steps[i].Name, final.Steps[i])
		}
	}
	// The fulfilment came from the hub's REAL pre-image.
	if final.Fulfilment != hub.fulfilment {
		t.Fatalf("fulfilment must be the hub's real pre-image")
	}
	// The bridge saw the reserve and the post.
	bridge.mu.Lock()
	defer bridge.mu.Unlock()
	if len(bridge.pendings) != 1 || len(bridge.posts) != 1 || bridge.posts[0] != "pend-000000000000001" {
		t.Fatalf("bridge calls wrong: pendings=%v posts=%v", bridge.pendings, bridge.posts)
	}
	if bridge.pendings[0]["amount"].(float64) != 150000 {
		t.Fatalf("reserve amount must be 150000 minor units: %v", bridge.pendings[0]["amount"])
	}
	// The switch saw exactly one quote and one transfer, both JWS-signed.
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if len(hub.quoteRequests) != 1 || len(hub.transferReqs) != 1 {
		t.Fatalf("switch traffic wrong: quotes=%d transfers=%d", len(hub.quoteRequests), len(hub.transferReqs))
	}
}

// TestPipelineRealEndToEndKafka — broker-gated: runs the full pipeline
// against a REAL local Kafka broker and consumes payment.confirmed from the
// real topic, verifying the event fields exactly.
func TestPipelineRealEndToEndKafka(t *testing.T) {
	brokers := os.Getenv("KAFKA_TEST_BROKERS")
	if brokers == "" {
		t.Skip("KAFKA_TEST_BROKERS not set — skipping broker-gated end-to-end test")
	}
	resetPayments(t)
	engine := newFakeTariff(t)
	hub := newFakeHub(t)
	hub.serve(t)
	t.Setenv("MOJALOOP_HUB_JWKS_URL", hub.switch_.URL+"/.well-known/jwks.json")
	bridge := newFakeBridge(t)

	producer, err := newIdempotentProducer(strings.Split(brokers, ","))
	if err != nil {
		t.Fatalf("kafka producer: %v", err)
	}
	defer producer.Close()

	gw := newTestGateway(t, testGatewayDeps{tariffURL: engine.URL, hub: hub, bridge: bridge, kafka: producer})
	gwSrv := httptest.NewServer(gw.routes())
	defer gwSrv.Close()
	hub.callbackURL = gwSrv.URL

	rec, err := gw.InitiatePayment(context.Background(), "DECL-KAFKA", "trader-1", "1500.00", "GHS", "bank_transfer", testTariffRequest())
	if err != nil {
		t.Fatalf("InitiatePayment: %v", err)
	}
	final := awaitTerminal(t, rec.ID, 30*time.Second)
	final.mu.RLock()
	if final.Status != StatusConfirmed {
		final.mu.RUnlock()
		t.Fatalf("pipeline must CONFIRM against real infra: status=%s code=%s msg=%s", final.Status, final.ErrorCode, final.ErrorMessage)
	}
	if len(final.Steps) != 8 {
		t.Fatalf("expected 8 steps, got %d", len(final.Steps))
	}
	transferID := final.TransferID
	paymentID := final.ID
	final.mu.RUnlock()

	// Consume the real topic and verify the event field-for-field.
	cfg := sarama.NewConfig()
	cfg.Consumer.Return.Errors = true
	consumer, err := sarama.NewConsumer(strings.Split(brokers, ","), cfg)
	if err != nil {
		t.Fatalf("kafka consumer: %v", err)
	}
	defer consumer.Close()
	pc, err := consumer.ConsumePartition("payment.confirmed", 0, sarama.OffsetOldest)
	if err != nil {
		t.Fatalf("consume partition: %v", err)
	}
	defer pc.Close()

	deadline := time.After(15 * time.Second)
	for {
		select {
		case msg := <-pc.Messages():
			if string(msg.Key) != "DECL-KAFKA" {
				continue // another test's event
			}
			var got map[string]any
			if err := json.Unmarshal(msg.Value, &got); err != nil {
				t.Fatalf("event is not JSON: %v", err)
			}
			// The topic is shared across runs: skip events from earlier runs
			// (same declaration key, different payment id).
			if got["paymentId"] != paymentID {
				continue
			}
			want := map[string]string{
				"eventType":     "payment.confirmed",
				"paymentId":     paymentID,
				"declarationId": "DECL-KAFKA",
				"amount":        "1500.00",
				"currency":      "GHS",
				"transferId":    transferID,
				"tbPendingId":   "pend-000000000000001",
			}
			for k, v := range want {
				if got[k] != v {
					t.Fatalf("event field %q = %v, want %q (raw: %s)", k, got[k], v, msg.Value)
				}
			}
			if _, ok := got["confirmedAt"]; !ok {
				t.Fatalf("event missing confirmedAt: %s", msg.Value)
			}
			return
		case <-deadline:
			t.Fatal("payment.confirmed event not found on the real topic within 15s")
		}
	}
}

// TestHandleInitiateRequiresTariffRequest — edge fail-closed: with an engine
// configured, a request without tariffRequest is a 400, never an invention.
func TestHandleInitiateRequiresTariffRequest(t *testing.T) {
	resetPayments(t)
	engine := newFakeTariff(t)
	gw := newTestGateway(t, testGatewayDeps{tariffURL: engine.URL})
	srv := httptest.NewServer(gw.routes())
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/payments/initiate", "application/json",
		bytes.NewReader([]byte(`{"declarationId":"D-1","amount":"10.00"}`)))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if len(engine.keys) != 0 {
		t.Fatal("engine must not be called when the request lacks tariffRequest")
	}
}

// TestHandleInitiateRejectsBadAmount — money input validation at the edge.
func TestHandleInitiateRejectsBadAmount(t *testing.T) {
	resetPayments(t)
	gw := newTestGateway(t, testGatewayDeps{})
	srv := httptest.NewServer(gw.routes())
	defer srv.Close()
	resp, err := http.Post(srv.URL+"/api/payments/initiate", "application/json",
		bytes.NewReader([]byte(`{"declarationId":"D-1","amount":"not-money"}`)))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

// TestAwaitQuoteTimeout — no callback arrives: the quote step must fail with
// a typed timeout error (fail-closed), never hang or fabricate.
func TestAwaitQuoteTimeout(t *testing.T) {
	resetPayments(t)
	engine := newFakeTariff(t)
	// Switch accepts the quote but NEVER calls back.
	silentSwitch := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/.well-known") {
			fmt.Fprint(w, `{"keys":[]}`)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer silentSwitch.Close()
	t.Setenv("MOJALOOP_HUB_JWKS_URL", silentSwitch.URL+"/.well-known/jwks.json")

	gw := newTestGateway(t, testGatewayDeps{tariffURL: engine.URL})
	gw.callbackWait = 300 * time.Millisecond
	signer, err := newTestSigner(t)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	gw.switchURL = silentSwitch.URL
	gw.quoteBuilder = newQuoteBuilderForTest(silentSwitch.URL, signer)
	tb, _ := newTransferBuilderForTest(silentSwitch.URL, signer)
	gw.xferBuilder = tb

	rec, err := gw.InitiatePayment(context.Background(), "DECL-T", "trader-1", "10.00", "GHS", "card", testTariffRequest())
	if err != nil {
		t.Fatalf("InitiatePayment: %v", err)
	}
	final := awaitTerminal(t, rec.ID, 5*time.Second)
	final.mu.RLock()
	defer final.mu.RUnlock()
	if final.Status != StatusFailed || final.ErrorCode != string(ErrCodeQuoteFailed) {
		t.Fatalf("expected %s, got status=%s code=%q msg=%s", ErrCodeQuoteFailed, final.Status, final.ErrorCode, final.ErrorMessage)
	}
}
