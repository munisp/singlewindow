// TradeGateway NGSWTP — Mojaloop Quote Builder Tests
package dfsp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
)

func newTestQuoteBuilder(t *testing.T, srv *httptest.Server) *QuoteBuilder {
	t.Helper()
	logger, _ := zap.NewDevelopment()
	return NewQuoteBuilder(srv.URL, "tradegateway", nil, logger)
}

func defaultQuoteInput() PostQuoteInput {
	return PostQuoteInput{
		TransactionId:   "txn-" + time.Now().Format("20060102150405"),
		Scenario:        "TRANSFER",
		PayerIdentifier: "TG-CUSTOMS-001",
		PayerName:       "TradeGateway Customs",
		PayeeIdType:     "MSISDN",
		PayeeIdentifier: "256781234567",
		PayeeFspId:      "payee-dfsp",
		PayeeName:       "Alice Trader",
		Amount:          "1500.00",
		Currency:        "NGN",
		Note:            "Import duty payment UCR-2026-001",
	}
}

// TestPostQuoteRequest_Success verifies a 202 Accepted response is handled correctly.
func TestPostQuoteRequest_Success(t *testing.T) {
	var received QuoteRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/quotes" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	qb := newTestQuoteBuilder(t, srv)
	result, err := qb.PostQuoteRequest(context.Background(), defaultQuoteInput())

	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil QuoteRequest result")
	}
	if result.QuoteId == "" {
		t.Error("expected non-empty quoteId")
	}
	if result.TransactionId == "" {
		t.Error("expected non-empty transactionId")
	}
}

// TestPostQuoteRequest_QuoteIdIsUUID verifies the generated quoteId is a valid UUID.
func TestPostQuoteRequest_QuoteIdIsUUID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	qb := newTestQuoteBuilder(t, srv)
	result, err := qb.PostQuoteRequest(context.Background(), defaultQuoteInput())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.QuoteId) != 36 {
		t.Errorf("expected UUID (36 chars), got %q (len=%d)", result.QuoteId, len(result.QuoteId))
	}
}

// TestPostQuoteRequest_PayloadStructure verifies the FSPIOP payload fields.
func TestPostQuoteRequest_PayloadStructure(t *testing.T) {
	var received QuoteRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	input := defaultQuoteInput()
	qb := newTestQuoteBuilder(t, srv)
	_, err := qb.PostQuoteRequest(context.Background(), input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if received.Amount.Amount != "1500.00" {
		t.Errorf("expected amount 1500.00, got %s", received.Amount.Amount)
	}
	if received.Amount.Currency != "NGN" {
		t.Errorf("expected currency NGN, got %s", received.Amount.Currency)
	}
	if received.Payer.PartyIdInfo.FspId != "tradegateway" {
		t.Errorf("expected payer fspId tradegateway, got %s", received.Payer.PartyIdInfo.FspId)
	}
	if received.Payee.PartyIdInfo.FspId != "payee-dfsp" {
		t.Errorf("expected payee fspId payee-dfsp, got %s", received.Payee.PartyIdInfo.FspId)
	}
	if received.AmountType != "SEND" {
		t.Errorf("expected amountType SEND, got %s", received.AmountType)
	}
}

// TestPostQuoteRequest_FSPIOPHeaders verifies required FSPIOP headers are set.
func TestPostQuoteRequest_FSPIOPHeaders(t *testing.T) {
	var capturedHeaders http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	qb := newTestQuoteBuilder(t, srv)
	_, err := qb.PostQuoteRequest(context.Background(), defaultQuoteInput())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedHeaders.Get("FSPIOP-Source") != "tradegateway" {
		t.Errorf("expected FSPIOP-Source: tradegateway, got %q", capturedHeaders.Get("FSPIOP-Source"))
	}
	if capturedHeaders.Get("FSPIOP-Destination") != "payee-dfsp" {
		t.Errorf("expected FSPIOP-Destination: payee-dfsp, got %q", capturedHeaders.Get("FSPIOP-Destination"))
	}
	if capturedHeaders.Get("Content-Type") == "" {
		t.Error("expected Content-Type header to be set")
	}
	if capturedHeaders.Get("Date") == "" {
		t.Error("expected Date header to be set")
	}
}

// TestPostQuoteRequest_CorrelationStored verifies quoteId is stored in pendingQuotes.
func TestPostQuoteRequest_CorrelationStored(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	qb := newTestQuoteBuilder(t, srv)
	result, err := qb.PostQuoteRequest(context.Background(), defaultQuoteInput())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	pending := qb.GetPendingQuote(result.QuoteId)
	if pending == nil {
		t.Fatal("expected pending quote to be stored after request")
	}
	if pending.TransactionId != result.TransactionId {
		t.Errorf("correlation mismatch: expected %s, got %s", result.TransactionId, pending.TransactionId)
	}
}

// TestPostQuoteRequest_ResolveRemovesCorrelation verifies ResolvePendingQuote cleans up.
func TestPostQuoteRequest_ResolveRemovesCorrelation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	qb := newTestQuoteBuilder(t, srv)
	result, _ := qb.PostQuoteRequest(context.Background(), defaultQuoteInput())

	qb.ResolvePendingQuote(result.QuoteId)

	if qb.GetPendingQuote(result.QuoteId) != nil {
		t.Error("expected pending quote to be removed after resolve")
	}
	if qb.PendingCount() != 0 {
		t.Errorf("expected 0 pending quotes, got %d", qb.PendingCount())
	}
}

// TestPostQuoteRequest_HubRejection verifies non-2xx responses return an error.
func TestPostQuoteRequest_HubRejection(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	qb := newTestQuoteBuilder(t, srv)
	_, err := qb.PostQuoteRequest(context.Background(), defaultQuoteInput())
	if err == nil {
		t.Error("expected error for 400 response, got nil")
	}
}

// TestPostQuoteRequest_ExpirationSet verifies expiration is set ~30 minutes in future.
func TestPostQuoteRequest_ExpirationSet(t *testing.T) {
	var received QuoteRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	before := time.Now().UTC()
	qb := newTestQuoteBuilder(t, srv)
	_, err := qb.PostQuoteRequest(context.Background(), defaultQuoteInput())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expiry, err := time.Parse(time.RFC3339Nano, received.Expiration)
	if err != nil {
		t.Fatalf("invalid expiration format: %v", err)
	}
	if expiry.Before(before.Add(25 * time.Minute)) {
		t.Errorf("expiration too soon: %v", expiry)
	}
	if expiry.After(before.Add(35 * time.Minute)) {
		t.Errorf("expiration too far: %v", expiry)
	}
}

// TestPostQuoteRequest_ConcurrentSafe verifies thread safety under concurrent requests.
func TestPostQuoteRequest_ConcurrentSafe(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	qb := newTestQuoteBuilder(t, srv)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			input := defaultQuoteInput()
			qb.PostQuoteRequest(context.Background(), input) //nolint:errcheck
		}()
	}
	wg.Wait()

	if qb.PendingCount() > 20 {
		t.Errorf("unexpected pending count: %d", qb.PendingCount())
	}
}

// TestPostQuoteRequest_NilSigner_NoSignatureHeader verifies nil signer skips JWS.
func TestPostQuoteRequest_NilSigner_NoSignatureHeader(t *testing.T) {
	var capturedHeaders http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	qb := newTestQuoteBuilder(t, srv) // nil signer
	_, err := qb.PostQuoteRequest(context.Background(), defaultQuoteInput())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if capturedHeaders.Get("FSPIOP-Signature") != "" {
		t.Error("expected no FSPIOP-Signature header when signer is nil")
	}
}

// TestPostQuoteRequest_TransactionTypeScenario verifies scenario is set correctly.
func TestPostQuoteRequest_TransactionTypeScenario(t *testing.T) {
	var received QuoteRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	input := defaultQuoteInput()
	input.Scenario = "PAYMENT"
	input.SubScenario = "DUTY_PAYMENT"

	qb := newTestQuoteBuilder(t, srv)
	_, err := qb.PostQuoteRequest(context.Background(), input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received.TransactionType.Scenario != "PAYMENT" {
		t.Errorf("expected scenario PAYMENT, got %s", received.TransactionType.Scenario)
	}
	if received.TransactionType.SubScenario != "DUTY_PAYMENT" {
		t.Errorf("expected subScenario DUTY_PAYMENT, got %s", received.TransactionType.SubScenario)
	}
}

// TestPostQuoteRequest_NoteIncluded verifies the note field is included in payload.
func TestPostQuoteRequest_NoteIncluded(t *testing.T) {
	var received QuoteRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	input := defaultQuoteInput()
	input.Note = "Duty payment for UCR-2026-XYZ"

	qb := newTestQuoteBuilder(t, srv)
	_, err := qb.PostQuoteRequest(context.Background(), input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received.Note != "Duty payment for UCR-2026-XYZ" {
		t.Errorf("expected note %q, got %q", "Duty payment for UCR-2026-XYZ", received.Note)
	}
}

// TestPostQuoteRequest_MultiplePendingQuotes verifies multiple correlations are tracked.
func TestPostQuoteRequest_MultiplePendingQuotes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	qb := newTestQuoteBuilder(t, srv)
	for i := 0; i < 5; i++ {
		input := defaultQuoteInput()
		input.TransactionId = "txn-multi-" + string(rune('A'+i))
		_, err := qb.PostQuoteRequest(context.Background(), input)
		if err != nil {
			t.Fatalf("request %d failed: %v", i, err)
		}
	}
	if qb.PendingCount() != 5 {
		t.Errorf("expected 5 pending quotes, got %d", qb.PendingCount())
	}
}
