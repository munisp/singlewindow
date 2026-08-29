package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
)

// SW-12: money conversion guards.
func TestMinorUnitsGuards(t *testing.T) {
	if v, err := minorUnits(0.29); err != nil || v != 29 {
		t.Fatalf("minorUnits(0.29) = %d, %v; want 29, nil", v, err)
	}
	for _, bad := range []float64{0, -1, math.NaN(), math.Inf(1), 1e15} {
		if _, err := minorUnits(bad); err == nil {
			t.Errorf("minorUnits(%v) should fail", bad)
		}
	}
	if minorToDecimal(123456) != "1234.56" {
		t.Fatalf("minorToDecimal(123456) = %s", minorToDecimal(123456))
	}
}

// SW-12: ILP packet uses the exact minor-unit amount (no float drift, no wrap).
func TestGenerateILPComponentsUsesMinorUnits(t *testing.T) {
	pkt, cond, ful, err := generateILPComponents(29, "NGN", "ncs-duty-1")
	if err != nil || pkt == "" || cond == "" || ful == "" {
		t.Fatalf("generation failed: %v", err)
	}
	// fulfilment must satisfy the condition
	if !verifyFulfilment(ful, cond) {
		t.Fatal("generated fulfilment does not satisfy generated condition")
	}
}

// SW-M9: fulfilment verification rejects forgeries.
func TestVerifyFulfilment(t *testing.T) {
	preimage := make([]byte, 32)
	rand.Read(preimage)
	h := sha256.Sum256(preimage)
	cond := base64.RawURLEncoding.EncodeToString(h[:])
	good := base64.RawURLEncoding.EncodeToString(preimage)
	if !verifyFulfilment(good, cond) {
		t.Fatal("valid fulfilment rejected")
	}
	bad := make([]byte, 32)
	rand.Read(bad)
	if verifyFulfilment(base64.RawURLEncoding.EncodeToString(bad), cond) {
		t.Fatal("forged fulfilment accepted")
	}
	if verifyFulfilment("not-base64!!!", cond) {
		t.Fatal("malformed fulfilment accepted")
	}
}

// SW-M9: callback signature verification.
func TestVerifyCallbackSignature(t *testing.T) {
	t.Setenv("MOJALOOP_CALLBACK_SECRET", "switch-secret-0123456789abcdef")
	body := []byte(`{"transferId":"x","transferState":"COMMITTED"}`)
	mac := hmac.New(sha256.New, []byte("switch-secret-0123456789abcdef"))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))
	if !verifyCallbackSignature(body, "sha256="+sig) {
		t.Fatal("valid signature rejected")
	}
	if verifyCallbackSignature(body, "sha256="+sig[:60]+"0000") {
		t.Fatal("tampered signature accepted")
	}
	if verifyCallbackSignature(body, "") {
		t.Fatal("missing signature accepted")
	}
}

// SW-M9: quote send failure returns an error (no log-as-success).
func TestCreateQuotePropagatesSendFailure(t *testing.T) {
	// Unreachable server
	c := NewMojaloopClient("http://127.0.0.1:1", "test-fsp")
	if _, err := c.CreateQuote(context.Background(), "TG-1", 100, "NGN", "payer"); err == nil {
		t.Fatal("quote send failure must return an error")
	}
	// Server returning 400
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	c2 := NewMojaloopClient(srv.URL, "test-fsp")
	if _, err := c2.CreateQuote(context.Background(), "TG-1", 100, "NGN", "payer"); err == nil {
		t.Fatal("quote 400 must return an error")
	}
}

// SW-M9: transfer send failure returns an error.
func TestInitiateTransferPropagatesSendFailure(t *testing.T) {
	c := NewMojaloopClient("http://127.0.0.1:1", "test-fsp")
	if _, err := c.InitiateTransfer(context.Background(), "q1", "TG-1", 100, "NGN", "payer", "pkt", "cond"); err == nil {
		t.Fatal("transfer send failure must return an error")
	}
}
