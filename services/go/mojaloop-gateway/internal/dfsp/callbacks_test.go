// TradeGateway NGSWTP — FSPIOP Callback Handler Tests
// Language: Go 1.23
package dfsp

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// ─── Test helpers ─────────────────────────────────────────────────────────────

// newTestCallbackHandler creates a CallbackHandler with a mock JWKS server.
func newTestCallbackHandler(t *testing.T) (*CallbackHandler, ed25519.PrivateKey, *httptest.Server) {
	t.Helper()

	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate ed25519 key: %v", err)
	}

	kid := "test-hub-key-1"
	xB64 := base64.RawURLEncoding.EncodeToString(pubKey)
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(JWKSResponse{
			Keys: []JWK{
				{Kty: "OKP", Kid: kid, Use: "sig", Alg: "EdDSA", Crv: "Ed25519", X: xB64},
			},
		})
	}))

	logger, _ := zap.NewDevelopment()
	h := &CallbackHandler{
		logger:         logger,
		jwksCache:      newHubJWKSCache(jwksServer.URL, logger),
		tigerbeetleURL: "http://localhost:4600",
		kafkaRestURL:   "http://localhost:8082",
		pendingILP:     make(map[string]string),
	}

	h.jwksCache.mu.Lock()
	h.jwksCache.keys[kid] = pubKey
	h.jwksCache.fetchedAt = time.Now()
	h.jwksCache.mu.Unlock()

	return h, privKey, jwksServer
}

// newChiCtx creates a chi route context with URL params for test requests.
func newChiCtx(params map[string]string) *chi.Context {
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	return rctx
}

// signBody creates a detached JWS compact token for the given body using Ed25519.
func signBody(t *testing.T, privKey ed25519.PrivateKey, body []byte) string {
	t.Helper()
	kid := "test-hub-key-1"
	protected := map[string]string{"alg": "EdDSA", "kid": kid}
	protectedJSON, _ := json.Marshal(protected)
	protectedB64 := base64.RawURLEncoding.EncodeToString(protectedJSON)
	payloadB64 := base64.RawURLEncoding.EncodeToString(body)
	signingInput := protectedB64 + "." + payloadB64
	sig := ed25519.Sign(privKey, []byte(signingInput))
	sigB64 := base64.RawURLEncoding.EncodeToString(sig)
	return protectedB64 + ".." + sigB64
}

// ─── Party callback tests ─────────────────────────────────────────────────────

func TestHandlePartyCallback_ValidJWS(t *testing.T) {
	h, privKey, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body := []byte(`{"party":{"partyIdInfo":{"partyIdType":"MSISDN","partyIdentifier":"256781234567","fspId":"payee-dfsp"},"name":"Alice Trader"}}`)
	jws := signBody(t, privKey, body)

	req := httptest.NewRequest(http.MethodPut, "/parties/MSISDN/256781234567", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Signature", jws)
	req.Header.Set("FSPIOP-Source", "mojaloop-hub")
	req.Header.Set("FSPIOP-Destination", "tradegateway")

	rr := httptest.NewRecorder()
	h.HandlePartyCallback(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandlePartyCallback_MissingJWS(t *testing.T) {
	h, _, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body := []byte(`{"party":{"partyIdInfo":{"partyIdType":"MSISDN","partyIdentifier":"256781234567","fspId":"payee-dfsp"},"name":"Alice"}}`)
	req := httptest.NewRequest(http.MethodPut, "/parties/MSISDN/256781234567", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	rr := httptest.NewRecorder()
	h.HandlePartyCallback(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestHandlePartyCallback_TamperedBody(t *testing.T) {
	h, privKey, srv := newTestCallbackHandler(t)
	defer srv.Close()

	originalBody := []byte(`{"party":{"partyIdInfo":{"partyIdType":"MSISDN","partyIdentifier":"256781234567","fspId":"payee-dfsp"},"name":"Alice"}}`)
	jws := signBody(t, privKey, originalBody)

	tamperedBody := []byte(`{"party":{"partyIdInfo":{"partyIdType":"MSISDN","partyIdentifier":"256781234567","fspId":"evil-dfsp"},"name":"Alice"}}`)
	req := httptest.NewRequest(http.MethodPut, "/parties/MSISDN/256781234567", bytes.NewReader(tamperedBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Signature", jws)

	rr := httptest.NewRecorder()
	h.HandlePartyCallback(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for tampered body, got %d", rr.Code)
	}
}

// ─── Quote callback tests ─────────────────────────────────────────────────────

func TestHandleQuoteCallback_ValidJWS_StoresILPCondition(t *testing.T) {
	h, privKey, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body := []byte(`{
		"quoteId": "quote-001",
		"transactionId": "txn-001",
		"transferAmount": {"amount": "1500.00", "currency": "NGN"},
		"ilpPacket": "AQAAAAAAAADIEHByaXZhdGUucGF5ZWVmc3A",
		"condition": "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
		"expiration": "2026-12-31T23:59:59.999Z"
	}`)
	jws := signBody(t, privKey, body)

	req := httptest.NewRequest(http.MethodPut, "/quotes/quote-001", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Signature", jws)

	rr := httptest.NewRecorder()
	h.HandleQuoteCallback(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	h.pendingMu.RLock()
	condition, ok := h.pendingILP["txn-001"]
	h.pendingMu.RUnlock()
	if !ok {
		t.Error("ILP condition was not stored after quote callback")
	}
	if condition != "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU" {
		t.Errorf("unexpected ILP condition: %s", condition)
	}
}

func TestHandleQuoteCallback_MissingJWS(t *testing.T) {
	h, _, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body := []byte(`{"quoteId":"q1","transactionId":"t1","transferAmount":{"amount":"100","currency":"NGN"},"condition":"abc","expiration":"2026-12-31T23:59:59Z"}`)
	req := httptest.NewRequest(http.MethodPut, "/quotes/q1", bytes.NewReader(body))

	rr := httptest.NewRecorder()
	h.HandleQuoteCallback(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

// ─── Transfer callback tests ──────────────────────────────────────────────────

func TestHandleTransferCallback_Committed_ValidILP(t *testing.T) {
	h, privKey, srv := newTestCallbackHandler(t)
	defer srv.Close()

	preImage := make([]byte, 32)
	rand.Read(preImage)
	fulfilment := base64.RawURLEncoding.EncodeToString(preImage)
	hashBytes := sha256.Sum256(preImage)
	condition := base64.RawURLEncoding.EncodeToString(hashBytes[:])

	// Pre-store the ILP condition
	h.pendingMu.Lock()
	h.pendingILP["transfer-001"] = condition
	h.pendingMu.Unlock()

	body, _ := json.Marshal(TransferCallbackBody{
		TransferID:    "transfer-001",
		TransferState: "COMMITTED",
		Fulfilment:    fulfilment,
		CompletedAt:   time.Now().UTC().Format(time.RFC3339),
	})
	jws := signBody(t, privKey, body)

	req := httptest.NewRequest(http.MethodPut, "/transfers/transfer-001", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Signature", jws)

	rr := httptest.NewRecorder()
	h.HandleTransferCallback(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandleTransferCallback_Aborted(t *testing.T) {
	h, privKey, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body, _ := json.Marshal(TransferCallbackBody{
		TransferID:    "transfer-002",
		TransferState: "ABORTED",
		ErrorInfo: &struct {
			ErrorCode        string `json:"errorCode"`
			ErrorDescription string `json:"errorDescription"`
		}{
			ErrorCode:        "5001",
			ErrorDescription: "Payee FSP rejected the transfer",
		},
	})
	jws := signBody(t, privKey, body)

	req := httptest.NewRequest(http.MethodPut, "/transfers/transfer-002", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Signature", jws)

	rr := httptest.NewRecorder()
	h.HandleTransferCallback(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for aborted transfer, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandleTransferCallback_MissingJWS(t *testing.T) {
	h, _, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body := []byte(`{"transferId":"t1","transferState":"COMMITTED","fulfilment":"abc"}`)
	req := httptest.NewRequest(http.MethodPut, "/transfers/t1", bytes.NewReader(body))

	rr := httptest.NewRecorder()
	h.HandleTransferCallback(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

// ─── ILP fulfilment verification tests ───────────────────────────────────────

func TestVerifyILPFulfilment_ValidPair(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	h := &CallbackHandler{
		logger:     logger,
		pendingILP: make(map[string]string),
	}

	preImage := make([]byte, 32)
	rand.Read(preImage)
	fulfilment := base64.RawURLEncoding.EncodeToString(preImage)
	hashBytes := sha256.Sum256(preImage)
	condition := base64.RawURLEncoding.EncodeToString(hashBytes[:])

	h.pendingILP["transfer-ilp-test"] = condition

	if err := h.verifyILPFulfilment("transfer-ilp-test", fulfilment); err != nil {
		t.Errorf("expected valid ILP pair to pass: %v", err)
	}
}

func TestVerifyILPFulfilment_InvalidPair(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	h := &CallbackHandler{
		logger:     logger,
		pendingILP: make(map[string]string),
	}

	h.pendingILP["transfer-bad"] = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	wrongFulfilment := base64.RawURLEncoding.EncodeToString([]byte("wrong-preimage"))

	if err := h.verifyILPFulfilment("transfer-bad", wrongFulfilment); err == nil {
		t.Error("expected ILP mismatch to return error")
	}
}

func TestVerifyILPFulfilment_UnknownTransfer_AcceptsGracefully(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	h := &CallbackHandler{
		logger:     logger,
		pendingILP: make(map[string]string),
	}

	if err := h.verifyILPFulfilment("unknown-transfer", "some-fulfilment"); err != nil {
		t.Errorf("expected unknown transfer to be accepted gracefully: %v", err)
	}
}

// ─── JWKS cache tests ─────────────────────────────────────────────────────────

func TestHubJWKSCache_RefreshesOnStale(t *testing.T) {
	pubKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	kid := "stale-key"
	xB64 := base64.RawURLEncoding.EncodeToString(pubKey)

	refreshCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		refreshCount++
		json.NewEncoder(w).Encode(JWKSResponse{
			Keys: []JWK{{Kty: "OKP", Kid: kid, Alg: "EdDSA", X: xB64}},
		})
	}))
	defer srv.Close()

	logger, _ := zap.NewDevelopment()
	cache := newHubJWKSCache(srv.URL, logger)
	cache.ttl = 10 * time.Millisecond

	_, err = cache.GetKey(context.Background(), kid)
	if err != nil {
		t.Fatalf("first GetKey: %v", err)
	}
	if refreshCount != 1 {
		t.Errorf("expected 1 refresh, got %d", refreshCount)
	}

	_, err = cache.GetKey(context.Background(), kid)
	if err != nil {
		t.Fatalf("second GetKey: %v", err)
	}

	time.Sleep(20 * time.Millisecond)

	_, err = cache.GetKey(context.Background(), kid)
	if err != nil {
		t.Fatalf("third GetKey: %v", err)
	}
	if refreshCount < 2 {
		t.Errorf("expected at least 2 refreshes after TTL expiry, got %d", refreshCount)
	}
}

// ─── Error Callback Tests ─────────────────────────────────────────────────────

func TestHandlePartyErrorCallback_ValidRequest(t *testing.T) {
	h, privKey, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body := `{"errorInformation":{"errorCode":"3201","errorDescription":"Destination FSP Error"}}`
	req := httptest.NewRequest(http.MethodPut, "/parties/MSISDN/256123456789/error", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Source", "hub")
	req.Header.Set("FSPIOP-Destination", "tradegateway")
	req.Header.Set("FSPIOP-Signature", signBody(t, privKey, []byte(body)))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("partyIdType", "MSISDN")
	rctx.URLParams.Add("partyIdentifier", "256123456789")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	h.HandlePartyErrorCallback(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandleQuoteErrorCallback_ValidRequest(t *testing.T) {
	h, privKey, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body := `{"errorInformation":{"errorCode":"3301","errorDescription":"Quote not found"}}`
	req := httptest.NewRequest(http.MethodPut, "/quotes/quote-abc-123/error", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Source", "hub")
	req.Header.Set("FSPIOP-Signature", signBody(t, privKey, []byte(body)))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "quote-abc-123")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	h.HandleQuoteErrorCallback(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandleTransferErrorCallback_ValidRequest(t *testing.T) {
	h, privKey, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body := `{"errorInformation":{"errorCode":"5001","errorDescription":"Payee FSP insufficient liquidity"}}`
	req := httptest.NewRequest(http.MethodPut, "/transfers/transfer-xyz-789/error", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Source", "hub")
	req.Header.Set("FSPIOP-Signature", signBody(t, privKey, []byte(body)))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "transfer-xyz-789")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	h.HandleTransferErrorCallback(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandleTransferErrorCallback_MalformedBody_StillACKs(t *testing.T) {
	h, privKey, srv := newTestCallbackHandler(t)
	defer srv.Close()

	body := "not-json"
	req := httptest.NewRequest(http.MethodPut, "/transfers/bad-id/error", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Signature", signBody(t, privKey, []byte(body)))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "bad-id")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	h.HandleTransferErrorCallback(rr, req)

	// Signed-but-malformed must not 401 (signature IS valid); handler rejects
	// the body with 400 (or ACKs 200) to prevent Hub retry storm.
	if rr.Code != http.StatusOK && rr.Code != http.StatusBadRequest {
		t.Errorf("expected 200 or 400, got %d", rr.Code)
	}
}

// SW-MP2 follow-up: unsigned error callbacks must be rejected 401
// (fail-closed Hub-signature verification).
func TestHandleErrorCallbacks_RejectUnsigned(t *testing.T) {
	h, _, srv := newTestCallbackHandler(t)
	defer srv.Close()

	cases := []struct {
		name    string
		handler http.HandlerFunc
		url     string
	}{
		{"party", h.HandlePartyErrorCallback, "/parties/MSISDN/256123456789/error"},
		{"quote", h.HandleQuoteErrorCallback, "/quotes/q/error"},
		{"transfer", h.HandleTransferErrorCallback, "/transfers/t/error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPut, tc.url, strings.NewReader(`{"errorInformation":{"errorCode":"3201","errorDescription":"x"}}`))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			tc.handler(rr, req)
			if rr.Code != http.StatusUnauthorized {
				t.Errorf("unsigned error callback: expected 401, got %d", rr.Code)
			}
		})
	}
}
