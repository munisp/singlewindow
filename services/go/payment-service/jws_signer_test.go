// jws_signer_test.go — P0-8 tests: outbound /transfers is always signed
// (fail-closed without a key), and inbound JWS verification accepts only
// correctly signed, request-bound callbacks.
package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestSignRequest_ProducesVerifiableFSPIOPSignature(t *testing.T) {
	pub, pemBytes, err := generateTestKey()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	signer, err := newFSPIOPSignerFromPEM(pemBytes)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	body := []byte(`{"transferId":"tx-1","amount":{"amount":"10.00","currency":"GHS"}}`)
	req := httptest.NewRequest("POST", "http://switch.local/transfers", nil)
	if err := signer.SignRequest(req, "gh-customs-authority", body); err != nil {
		t.Fatalf("sign: %v", err)
	}
	header := req.Header.Get("FSPIOP-Signature")
	if header == "" {
		t.Fatal("FSPIOP-Signature header not set")
	}
	// Protected header must carry kid + body binding fields
	var env fspiopSignature
	if err := json.Unmarshal([]byte(header), &env); err != nil {
		t.Fatalf("envelope: %v", err)
	}
	phJSON, _ := base64.RawURLEncoding.DecodeString(env.ProtectedHeader)
	var ph fspiopProtectedHeader
	if err := json.Unmarshal(phJSON, &ph); err != nil {
		t.Fatalf("protected header: %v", err)
	}
	if ph.Alg != "EdDSA" || ph.Kid == "" || ph.FSPIOPURI != "/transfers" || ph.FSPIOPHTTPMethod != "POST" {
		t.Fatalf("protected header incomplete: %+v", ph)
	}
	// Round-trip verify with the public key
	if err := verifyFSPIOPSignature(pub, "POST", "/transfers", body, header); err != nil {
		t.Fatalf("verify own signature: %v", err)
	}
}

func TestVerifyFSPIOPSignature_Rejects(t *testing.T) {
	pub, pemBytes, _ := generateTestKey()
	signer, _ := newFSPIOPSignerFromPEM(pemBytes)
	body := []byte(`{"transferId":"tx-1"}`)
	req := httptest.NewRequest("POST", "http://switch.local/transfers", nil)
	if err := signer.SignRequest(req, "gh-customs-authority", body); err != nil {
		t.Fatal(err)
	}
	good := req.Header.Get("FSPIOP-Signature")

	cases := map[string]string{
		"unsigned (missing header)": "",
		"garbage":                   "not-json",
		"tampered body":             good, // verified against a DIFFERENT body below
		"wrong method":              good,
		"wrong URI":                 good,
	}
	if err := verifyFSPIOPSignature(pub, "POST", "/transfers", body, cases["unsigned (missing header)"]); err == nil {
		t.Fatal("unsigned callback accepted")
	}
	if err := verifyFSPIOPSignature(pub, "POST", "/transfers", body, cases["garbage"]); err == nil {
		t.Fatal("garbage signature accepted")
	}
	if err := verifyFSPIOPSignature(pub, "POST", "/transfers", []byte(`{"transferId":"tx-2"}`), good); err == nil {
		t.Fatal("tampered body accepted")
	}
	if err := verifyFSPIOPSignature(pub, "PUT", "/transfers", body, good); err == nil {
		t.Fatal("wrong method accepted")
	}
	if err := verifyFSPIOPSignature(pub, "POST", "/quotes", body, good); err == nil {
		t.Fatal("wrong URI accepted")
	}
	// Wrong key
	otherPub, _, _ := generateTestKey()
	if err := verifyFSPIOPSignature(otherPub, "POST", "/transfers", body, good); err == nil {
		t.Fatal("signature from unknown key accepted")
	}
}

func TestFspiopSigner_FailClosedWithoutKey(t *testing.T) {
	// No env key configured => signer error => transfer must NOT be sent.
	t.Setenv("DFSP_JWS_PRIVATE_KEY_PATH", "")
	t.Setenv("DFSP_JWS_PRIVATE_KEY_PEM", "")
	if _, err := newFSPIOPSignerFromEnv(); err == nil {
		t.Fatal("signer initialised without a key — fail-open")
	}
}

func TestVerifyWebhookSignature_FailClosedWithoutSecret(t *testing.T) {
	t.Setenv("MOJALOOP_CALLBACK_SECRET", "")
	if verifyWebhookSignature([]byte("x"), "sha256=deadbeef") {
		t.Fatal("HMAC callback accepted with no secret configured")
	}
}

var _ = ed25519.PublicKey{} // silence unused import if assertions change
