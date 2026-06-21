// jws_test.go — Unit tests for FSPIOP JWS signing and verification.
package dfsp

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ─── Key generation helpers ───────────────────────────────────────────────────

func generateRSAPEM(t *testing.T, bits int) []byte {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})
}

func generateECPEM(t *testing.T) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate EC key: %v", err)
	}
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal EC key: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{
		Type:  "EC PRIVATE KEY",
		Bytes: der,
	})
}

func generateEd25519PEM(t *testing.T) []byte {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate Ed25519 key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal Ed25519 key: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: der,
	})
}

// decodeProtectedHeader decodes a base64url-encoded protected header.
func decodeProtectedHeader(t *testing.T, b64 string) FSPIOPProtectedHeader {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("decode protected header base64: %v", err)
	}
	var h FSPIOPProtectedHeader
	if err := json.Unmarshal(raw, &h); err != nil {
		t.Fatalf("unmarshal protected header: %v", err)
	}
	return h
}

// ─── NewSignerFromPEM ─────────────────────────────────────────────────────────

func TestNewSignerFromPEM_RSA(t *testing.T) {
	s, err := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	if err != nil {
		t.Fatalf("NewSignerFromPEM RSA: %v", err)
	}
	if s.Algorithm() != AlgPS256 {
		t.Errorf("expected PS256, got %s", s.Algorithm())
	}
}

func TestNewSignerFromPEM_EC(t *testing.T) {
	s, err := NewSignerFromPEM("tradegateway", generateECPEM(t))
	if err != nil {
		t.Fatalf("NewSignerFromPEM EC: %v", err)
	}
	if s.Algorithm() != AlgES256 {
		t.Errorf("expected ES256, got %s", s.Algorithm())
	}
}

func TestNewSignerFromPEM_Ed25519(t *testing.T) {
	s, err := NewSignerFromPEM("tradegateway", generateEd25519PEM(t))
	if err != nil {
		t.Fatalf("NewSignerFromPEM Ed25519: %v", err)
	}
	if s.Algorithm() != AlgEdDSA {
		t.Errorf("expected EdDSA, got %s", s.Algorithm())
	}
}

func TestNewSignerFromPEM_InvalidPEM(t *testing.T) {
	_, err := NewSignerFromPEM("tradegateway", []byte("not a pem block"))
	if err == nil {
		t.Error("expected error for invalid PEM")
	}
}

func TestNewSignerFromPEM_UnknownBlockType(t *testing.T) {
	badPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "UNKNOWN KEY TYPE",
		Bytes: []byte("garbage"),
	})
	_, err := NewSignerFromPEM("tradegateway", badPEM)
	if err == nil {
		t.Error("expected error for unknown PEM block type")
	}
}

// ─── Sign produces valid FSPIOP-Signature header ──────────────────────────────

func TestSignRequest_ProducesValidHeader(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	body := []byte(`{"amount":"100.00","currency":"NGN"}`)
	req, _ := http.NewRequest(http.MethodPost, "http://hub/parties/MSISDN/2348012345678", nil)

	if err := s.SignRequest(req, "hub", body); err != nil {
		t.Fatalf("SignRequest: %v", err)
	}

	sigHeader := req.Header.Get("FSPIOP-Signature")
	if sigHeader == "" {
		t.Fatal("FSPIOP-Signature header not set")
	}

	var envelope FSPIOPSignature
	if err := json.Unmarshal([]byte(sigHeader), &envelope); err != nil {
		t.Fatalf("FSPIOP-Signature is not valid JSON: %v", err)
	}
	if envelope.Signature == "" {
		t.Error("signature field is empty")
	}
	if envelope.ProtectedHeader == "" {
		t.Error("protectedHeader field is empty")
	}
}

func TestSignRequest_RSA_PS256(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	req, _ := http.NewRequest(http.MethodPost, "http://hub/quotes", nil)
	if err := s.SignRequest(req, "hub", []byte(`{"amount":"50.00"}`)); err != nil {
		t.Fatalf("SignRequest RSA PS256: %v", err)
	}
}

func TestSignRequest_EC_ES256(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateECPEM(t))
	req, _ := http.NewRequest(http.MethodPost, "http://hub/transfers", nil)
	if err := s.SignRequest(req, "hub", []byte(`{"amount":"200.00"}`)); err != nil {
		t.Fatalf("SignRequest EC ES256: %v", err)
	}
}

func TestSignRequest_Ed25519(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateEd25519PEM(t))
	req, _ := http.NewRequest(http.MethodPost, "http://hub/transfers", nil)
	if err := s.SignRequest(req, "hub", []byte(`{"amount":"300.00"}`)); err != nil {
		t.Fatalf("SignRequest Ed25519: %v", err)
	}
}

// ─── Protected header content ─────────────────────────────────────────────────

func TestSignRequest_ProtectedHeaderContainsRequiredFields(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	body := []byte(`{"amount":"50.00"}`)
	req, _ := http.NewRequest(http.MethodPost, "http://hub/quotes", nil)

	if err := s.SignRequest(req, "hub", body); err != nil {
		t.Fatalf("SignRequest: %v", err)
	}

	var envelope FSPIOPSignature
	json.Unmarshal([]byte(req.Header.Get("FSPIOP-Signature")), &envelope) //nolint:errcheck

	protected := decodeProtectedHeader(t, envelope.ProtectedHeader)

	if protected.Alg != AlgPS256 {
		t.Errorf("expected alg PS256, got %s", protected.Alg)
	}
	if protected.FSPIOPSource != "tradegateway" {
		t.Errorf("expected FSPIOP-Source tradegateway, got %s", protected.FSPIOPSource)
	}
	if protected.FSPIOPHTTPMethod != http.MethodPost {
		t.Errorf("expected HTTP method POST, got %s", protected.FSPIOPHTTPMethod)
	}
	if !strings.Contains(protected.FSPIOPURI, "/quotes") {
		t.Errorf("expected FSPIOP-URI to contain /quotes, got %s", protected.FSPIOPURI)
	}
	if protected.Date == "" {
		t.Error("Date field in protected header must not be empty")
	}
	if protected.FSPIOPDest != "hub" {
		t.Errorf("expected FSPIOP-Destination hub, got %s", protected.FSPIOPDest)
	}
}

// ─── Date header auto-set ─────────────────────────────────────────────────────

func TestSignRequest_SetsDateHeaderIfMissing(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	req, _ := http.NewRequest(http.MethodGet, "http://hub/parties/MSISDN/123", nil)

	s.SignRequest(req, "hub", nil) //nolint:errcheck

	if req.Header.Get("Date") == "" {
		t.Error("Date header should be set automatically")
	}
}

func TestSignRequest_PreservesExistingDateHeader(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	req, _ := http.NewRequest(http.MethodGet, "http://hub/parties/MSISDN/123", nil)
	existingDate := "Sat, 01 Jan 2000 00:00:00 GMT"
	req.Header.Set("Date", existingDate)

	s.SignRequest(req, "hub", nil) //nolint:errcheck

	if req.Header.Get("Date") != existingDate {
		t.Errorf("Date header should be preserved, got %s", req.Header.Get("Date"))
	}
}

// ─── Nil body ─────────────────────────────────────────────────────────────────

func TestSignRequest_NilBody(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	req, _ := http.NewRequest(http.MethodGet, "http://hub/parties/MSISDN/123", nil)

	if err := s.SignRequest(req, "hub", nil); err != nil {
		t.Fatalf("SignRequest with nil body: %v", err)
	}
	if req.Header.Get("FSPIOP-Signature") == "" {
		t.Error("FSPIOP-Signature must be set even for nil body")
	}
}

// ─── Key rotation ─────────────────────────────────────────────────────────────

func TestRotateKey_ChangesAlgorithm(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	if s.Algorithm() != AlgPS256 {
		t.Fatalf("initial algorithm should be PS256")
	}

	newPEM := generateECPEM(t)
	if err := s.RotateKey(newPEM); err != nil {
		t.Fatalf("RotateKey: %v", err)
	}
	if s.Algorithm() != AlgES256 {
		t.Errorf("after rotation, expected ES256, got %s", s.Algorithm())
	}
}

func TestRotateKey_InvalidPEM(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	err := s.RotateKey([]byte("invalid pem"))
	if err == nil {
		t.Error("expected error rotating to invalid PEM")
	}
	// Original key should be unchanged
	if s.Algorithm() != AlgPS256 {
		t.Error("algorithm should not change on failed rotation")
	}
}

func TestRotateKey_CanSignAfterRotation(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	s.RotateKey(generateEd25519PEM(t)) //nolint:errcheck

	req, _ := http.NewRequest(http.MethodPost, "http://hub/transfers", nil)
	if err := s.SignRequest(req, "hub", []byte(`{}`)); err != nil {
		t.Fatalf("SignRequest after key rotation: %v", err)
	}
}

// ─── JWKS endpoint ────────────────────────────────────────────────────────────

func TestJWKSHandler_RSA(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	handler := s.JWKSHandler()

	req := httptest.NewRequest(http.MethodGet, "/dfsp/jwks.json", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	var jwkSet JWKSet
	if err := json.NewDecoder(rec.Body).Decode(&jwkSet); err != nil {
		t.Fatalf("decode JWKS response: %v", err)
	}
	if len(jwkSet.Keys) != 1 {
		t.Errorf("expected 1 key, got %d", len(jwkSet.Keys))
	}
	if jwkSet.Keys[0].Kty != "RSA" {
		t.Errorf("expected kty RSA, got %s", jwkSet.Keys[0].Kty)
	}
	if jwkSet.Keys[0].N == "" {
		t.Error("RSA JWK must have n field")
	}
	if jwkSet.Keys[0].E == "" {
		t.Error("RSA JWK must have e field")
	}
	if jwkSet.Keys[0].Use != "sig" {
		t.Errorf("expected use sig, got %s", jwkSet.Keys[0].Use)
	}
}

func TestJWKSHandler_Ed25519(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateEd25519PEM(t))
	handler := s.JWKSHandler()

	req := httptest.NewRequest(http.MethodGet, "/dfsp/jwks.json", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	var jwkSet JWKSet
	json.NewDecoder(rec.Body).Decode(&jwkSet) //nolint:errcheck
	if len(jwkSet.Keys) != 1 {
		t.Fatalf("expected 1 key, got %d", len(jwkSet.Keys))
	}
	if jwkSet.Keys[0].Kty != "OKP" {
		t.Errorf("expected kty OKP for Ed25519, got %s", jwkSet.Keys[0].Kty)
	}
	if jwkSet.Keys[0].Crv != "Ed25519" {
		t.Errorf("expected crv Ed25519, got %s", jwkSet.Keys[0].Crv)
	}
}

func TestPublicJWK_KeyID(t *testing.T) {
	s, _ := NewSignerFromPEM("tradegateway", generateRSAPEM(t, 2048))
	jwk, err := s.PublicJWK()
	if err != nil {
		t.Fatalf("PublicJWK: %v", err)
	}
	if !strings.HasPrefix(jwk.Kid, "tradegateway") {
		t.Errorf("kid should start with dfspID, got %s", jwk.Kid)
	}
}

// ─── Verify missing/malformed header ─────────────────────────────────────────

func TestVerifyRequest_MissingHeader(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "http://hub/quotes", nil)
	_, pub, _ := ed25519.GenerateKey(rand.Reader)
	err := VerifyRequest(req, nil, pub)
	if err == nil {
		t.Error("expected error when FSPIOP-Signature header is missing")
	}
}

func TestVerifyRequest_MalformedHeader(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "http://hub/quotes", nil)
	req.Header.Set("FSPIOP-Signature", "not-valid-json")
	_, pub, _ := ed25519.GenerateKey(rand.Reader)
	err := VerifyRequest(req, nil, pub)
	if err == nil {
		t.Error("expected error for malformed FSPIOP-Signature header")
	}
}

// ─── Ephemeral signer ─────────────────────────────────────────────────────────

func TestNewEphemeralSigner(t *testing.T) {
	s, err := newEphemeralSigner("tradegateway")
	if err != nil {
		t.Fatalf("newEphemeralSigner: %v", err)
	}
	if s.Algorithm() != AlgPS256 {
		t.Errorf("ephemeral signer should use PS256, got %s", s.Algorithm())
	}
	req, _ := http.NewRequest(http.MethodGet, "http://hub/health", nil)
	if err := s.SignRequest(req, "hub", nil); err != nil {
		t.Fatalf("SignRequest with ephemeral key: %v", err)
	}
}

// ─── Sign/Verify round-trip (Ed25519 — deterministic) ────────────────────────

func TestSignVerify_RoundTrip_Ed25519(t *testing.T) {
	pemBytes := generateEd25519PEM(t)
	s, err := NewSignerFromPEM("tradegateway", pemBytes)
	if err != nil {
		t.Fatalf("NewSignerFromPEM: %v", err)
	}

	body := []byte(`{"amount":"100.00","currency":"NGN"}`)
	req, _ := http.NewRequest(http.MethodPost, "http://hub/transfers", nil)

	if err := s.SignRequest(req, "hub", body); err != nil {
		t.Fatalf("SignRequest: %v", err)
	}

	// Extract public key
	priv := s.privateKey.(ed25519.PrivateKey)
	pub := priv.Public().(ed25519.PublicKey)

	// Verify
	if err := VerifyRequest(req, body, pub); err != nil {
		t.Fatalf("VerifyRequest: %v", err)
	}
}

func TestSignVerify_RoundTrip_RSA(t *testing.T) {
	pemBytes := generateRSAPEM(t, 2048)
	s, _ := NewSignerFromPEM("tradegateway", pemBytes)

	body := []byte(`{"amount":"500.00"}`)
	req, _ := http.NewRequest(http.MethodPost, "http://hub/quotes", nil)
	s.SignRequest(req, "hub", body) //nolint:errcheck

	priv := s.privateKey.(*rsa.PrivateKey)
	if err := VerifyRequest(req, body, &priv.PublicKey); err != nil {
		t.Fatalf("VerifyRequest RSA: %v", err)
	}
}

func TestSignVerify_RoundTrip_EC(t *testing.T) {
	pemBytes := generateECPEM(t)
	s, _ := NewSignerFromPEM("tradegateway", pemBytes)

	body := []byte(`{"amount":"750.00"}`)
	req, _ := http.NewRequest(http.MethodPost, "http://hub/transfers", nil)
	s.SignRequest(req, "hub", body) //nolint:errcheck

	priv := s.privateKey.(*ecdsa.PrivateKey)
	if err := VerifyRequest(req, body, &priv.PublicKey); err != nil {
		t.Fatalf("VerifyRequest EC: %v", err)
	}
}

// ─── Tampered body must fail verification ────────────────────────────────────

func TestVerifyRequest_TamperedBody_Fails(t *testing.T) {
	pemBytes := generateEd25519PEM(t)
	s, _ := NewSignerFromPEM("tradegateway", pemBytes)

	originalBody := []byte(`{"amount":"100.00"}`)
	req, _ := http.NewRequest(http.MethodPost, "http://hub/transfers", nil)
	s.SignRequest(req, "hub", originalBody) //nolint:errcheck

	priv := s.privateKey.(ed25519.PrivateKey)
	pub := priv.Public().(ed25519.PublicKey)

	tamperedBody := []byte(`{"amount":"999999.00"}`)
	err := VerifyRequest(req, tamperedBody, pub)
	if err == nil {
		t.Error("tampered body should fail signature verification")
	}
}
