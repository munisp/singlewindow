// Phase-9 WP-B pipeline tests — REAL local httptest servers for every HTTP
// boundary (tariff engine, Mojaloop switch, TigerBeetle bridge) and a REAL
// local Kafka broker for the broker-gated suite. No interface mocks.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/IBM/sarama"
	"go.uber.org/zap"

	"github.com/tradegateway/mojaloop-gateway/internal/dfsp"
	"github.com/tradegateway/mojaloop-gateway/internal/tariff"
)

// ─── Fake Mojaloop Hub (signs callbacks with a real Ed25519 key) ─────────────

type fakeHub struct {
	priv    ed25519.PrivateKey
	pub     ed25519.PublicKey
	kid     string
	switch_ *httptest.Server // serves POST /quotes, POST /transfers AND the JWKS

	mu            sync.Mutex
	quoteRequests [][]byte
	transferReqs  [][]byte
	callbackURL   string // gateway base URL for callbacks

	fulfilment string // b64url pre-image; condition = b64url(sha256(preimage))
	condition  string
}

func newFakeHub(t *testing.T) *fakeHub {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate hub key: %v", err)
	}
	pre := make([]byte, 32)
	rand.Read(pre)
	h := &fakeHub{
		priv: priv,
		pub:  pub,
		kid:  "hub-key-1",
	}
	h.fulfilment = base64.RawURLEncoding.EncodeToString(pre)
	sum := sha256.Sum256(pre)
	h.condition = base64.RawURLEncoding.EncodeToString(sum[:])
	return h
}

// jws signs a callback body as a compact FSPIOP JWS (detached payload form:
// protected.payloadB64.signature — the shape verifyInboundJWS verifies).
func (h *fakeHub) jws(body []byte) string {
	protected, _ := json.Marshal(map[string]string{"alg": "EdDSA", "kid": h.kid})
	protectedB64 := base64.RawURLEncoding.EncodeToString(protected)
	payloadB64 := base64.RawURLEncoding.EncodeToString(body)
	input := protectedB64 + "." + payloadB64
	sig := ed25519.Sign(h.priv, []byte(input))
	return input + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func (h *fakeHub) jwksHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]any{
		"keys": []map[string]string{{
			"kty": "OKP", "kid": h.kid, "alg": "EdDSA", "crv": "Ed25519",
			"x": base64.RawURLEncoding.EncodeToString(h.pub),
		}},
	})
}

func (h *fakeHub) sendCallback(t *testing.T, path string, body []byte) {
	req, err := http.NewRequest(http.MethodPut, h.callbackURL+path, strings.NewReader(string(body)))
	if err != nil {
		t.Errorf("build callback: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("FSPIOP-Signature", h.jws(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Errorf("callback %s: %v", path, err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("callback %s returned %d", path, resp.StatusCode)
	}
}

// serve starts the fake switch HTTP server. On POST /quotes it answers 202
// and asynchronously delivers the signed PUT /quotes/{id} callback carrying a
// REAL condition derived from the hub's fulfilment pre-image. On POST
// /transfers it answers 202 and delivers the signed COMMITTED callback.
func (h *fakeHub) serve(t *testing.T) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/jwks.json", h.jwksHandler)
	mux.HandleFunc("POST /quotes", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		h.mu.Lock()
		h.quoteRequests = append(h.quoteRequests, body)
		h.mu.Unlock()
		var qr struct {
			QuoteID       string `json:"quoteId"`
			TransactionID string `json:"transactionId"`
			Amount        struct {
				Amount   string `json:"amount"`
				Currency string `json:"currency"`
			} `json:"amount"`
		}
		json.Unmarshal(body, &qr)
		w.WriteHeader(http.StatusAccepted)
		cb, _ := json.Marshal(map[string]any{
			"quoteId":        qr.QuoteID,
			"transactionId":  qr.TransactionID,
			"transferAmount": map[string]string{"amount": qr.Amount.Amount, "currency": qr.Amount.Currency},
			"ilpPacket":      "AYIBgQAAAAAAAASwNG" + base64.RawURLEncoding.EncodeToString([]byte(qr.QuoteID))[:24],
			"condition":      h.condition,
			"expiration":     time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339Nano),
			"payeeFspFee":    map[string]string{"amount": "0.50", "currency": qr.Amount.Currency},
		})
		go h.sendCallback(t, "/quotes/"+qr.QuoteID, cb)
	})
	mux.HandleFunc("POST /transfers", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		h.mu.Lock()
		h.transferReqs = append(h.transferReqs, body)
		h.mu.Unlock()
		var tr struct {
			TransferID string `json:"transferId"`
		}
		json.Unmarshal(body, &tr)
		w.WriteHeader(http.StatusAccepted)
		cb, _ := json.Marshal(map[string]any{
			"transferId":         tr.TransferID,
			"transferState":      "COMMITTED",
			"fulfilment":         h.fulfilment,
			"completedTimestamp": time.Now().UTC().Format(time.RFC3339Nano),
		})
		go h.sendCallback(t, "/transfers/"+tr.TransferID, cb)
	})
	h.switch_ = httptest.NewServer(mux)
	t.Cleanup(h.switch_.Close)
}

// ─── Fake TigerBeetle bridge ──────────────────────────────────────────────────

type fakeBridge struct {
	*httptest.Server
	mu       sync.Mutex
	pendings []map[string]any
	posts    []string
}

func newFakeBridge(t *testing.T) *fakeBridge {
	b := &fakeBridge{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/ledger/transfers/pending", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		b.mu.Lock()
		b.pendings = append(b.pendings, body)
		b.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"id": "pend-000000000000001", "status": "PENDING"})
	})
	mux.HandleFunc("POST /api/ledger/transfers/post/{id}", func(w http.ResponseWriter, r *http.Request) {
		b.mu.Lock()
		b.posts = append(b.posts, r.PathValue("id"))
		b.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"id": r.PathValue("id"), "status": "POSTED"})
	})
	b.Server = httptest.NewServer(mux)
	t.Cleanup(b.Close)
	return b
}

// ─── Fake tariff engine ───────────────────────────────────────────────────────

type fakeTariff struct {
	*httptest.Server
	mu     sync.Mutex
	keys   []string
	bodies []json.RawMessage
}

func newFakeTariff(t *testing.T) *fakeTariff {
	ft := &fakeTariff{}
	ft.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/tariffs/assess" {
			http.Error(w, "not found", 404)
			return
		}
		if r.Header.Get("Authorization") == "" {
			http.Error(w, "unauthorized", 401)
			return
		}
		body, _ := io.ReadAll(r.Body)
		ft.mu.Lock()
		ft.keys = append(ft.keys, r.Header.Get("Idempotency-Key"))
		ft.bodies = append(ft.bodies, body)
		ft.mu.Unlock()
		var req tariff.AssessRequest
		json.Unmarshal(body, &req)
		// The "engine" computes a REAL deterministic amount from the request.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(tariff.Assessment{
			AssessmentID:  "asm-" + r.Header.Get("Idempotency-Key"),
			Request:       req,
			AsOf:          time.Now().UTC().Format("2006-01-02"),
			Lines:         []tariff.AssessmentLine{{LineNo: 1, Instrument: "NPA_SHIP_DUES", Agency: "NPA", Applicability: "CHARGED", Basis: "PER_GRT_BAND", AmountMinor: req.VesselGRT * 10, Currency: "USD"}},
			TotalUsdMinor: req.VesselGRT * 10,
			Requester:     "test-caller",
			CorrelationID: r.Header.Get("Idempotency-Key"),
			CreatedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		})
	}))
	t.Cleanup(ft.Server.Close)
	return ft
}

// ─── Test gateway builder ─────────────────────────────────────────────────────

type testGatewayDeps struct {
	tariffURL string
	hub       *fakeHub
	bridge    *fakeBridge
	kafka     sarama.SyncProducer
}

func newTestGateway(t *testing.T, deps testGatewayDeps) *MojaloopGateway {
	t.Helper()
	logger := zap.NewNop()
	gw := &MojaloopGateway{
		logger:        logger,
		cbHandler:     dfsp.NewCallbackHandler(logger),
		dfspID:        "payerdfsp",
		payeeFspID:    "revenuedfsp",
		payeePartyID:  "REVENUE-AUTH-001",
		callbackWait:  15 * time.Second,
		httpClient:    &http.Client{Timeout: 15 * time.Second},
		kafkaProducer: deps.kafka,
	}
	if deps.tariffURL != "" {
		c, err := tariff.NewClient(tariff.Config{BaseURL: deps.tariffURL, StaticToken: "test-token"})
		if err != nil {
			t.Fatalf("tariff client: %v", err)
		}
		gw.tariffClient = c
	}
	if deps.hub != nil {
		signer, err := dfsp.NewSignerFromPEM("payerdfsp", testEd25519PEM(t))
		if err != nil {
			t.Fatalf("dfsp signer: %v", err)
		}
		gw.switchURL = deps.hub.switch_.URL
		gw.quoteBuilder = dfsp.NewQuoteBuilder(deps.hub.switch_.URL, "payerdfsp", signer, logger)
		tb, err := dfsp.NewTransferBuilder(deps.hub.switch_.URL, "payerdfsp", signer, logger)
		if err != nil {
			t.Fatalf("transfer builder: %v", err)
		}
		gw.xferBuilder = tb
	}
	if deps.bridge != nil {
		gw.tbBridgeURL = deps.bridge.URL
	}
	return gw
}

// testEd25519PEM generates a real Ed25519 key and returns its PKCS#8 PEM.
func testEd25519PEM(t *testing.T) []byte {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("key gen: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

func newTestSigner(t *testing.T) (*dfsp.Signer, error) {
	t.Helper()
	return dfsp.NewSignerFromPEM("payerdfsp", testEd25519PEM(t))
}

func newQuoteBuilderForTest(url string, signer *dfsp.Signer) *dfsp.QuoteBuilder {
	return dfsp.NewQuoteBuilder(url, "payerdfsp", signer, zap.NewNop())
}

func newTransferBuilderForTest(url string, signer *dfsp.Signer) (*dfsp.TransferBuilder, error) {
	return dfsp.NewTransferBuilder(url, "payerdfsp", signer, zap.NewNop())
}

func testTariffRequest() *tariff.AssessRequest {
	return &tariff.AssessRequest{
		VesselGRT:            25000,
		VesselClass:          "CONTAINER",
		CargoCategory:        "CONTAINERIZED",
		VoyageType:           "INTERNATIONAL",
		RouteKind:            "SEA",
		NigeriaPortCall:      true,
		GrossFreightUSDMinor: 4200000,
	}
}

// awaitTerminal polls the record until it reaches a terminal state.
func awaitTerminal(t *testing.T, id string, timeout time.Duration) *PaymentRecord {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		paymentsMu.RLock()
		rec := payments[id]
		paymentsMu.RUnlock()
		if rec != nil {
			rec.mu.RLock()
			st := rec.Status
			rec.mu.RUnlock()
			if st == StatusConfirmed || st == StatusFailed {
				return rec
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("payment %s did not reach a terminal state within %v", id, timeout)
	return nil
}

// resetPayments isolates tests from the shared in-memory store.
func resetPayments(t *testing.T) {
	paymentsMu.Lock()
	payments = make(map[string]*PaymentRecord)
	paymentsMu.Unlock()
	t.Cleanup(func() {
		paymentsMu.Lock()
		payments = make(map[string]*PaymentRecord)
		paymentsMu.Unlock()
	})
}
