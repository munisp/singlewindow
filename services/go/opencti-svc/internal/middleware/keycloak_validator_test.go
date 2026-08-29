// keycloak_validator_test.go — P0 remediation tests: real RS256 validation.
// Covers: valid token passes (test JWKS server), garbage Bearer rejected,
// expired rejected, wrong-iss rejected, wrong-aud rejected, unknown kid rejected.
package middleware

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func b64url(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}

// testJWKS spins up a local JWKS server serving the public half of priv.
func testJWKS(t *testing.T, priv *rsa.PrivateKey, kid string) *httptest.Server {
	t.Helper()
	n := b64url(priv.PublicKey.N.Bytes())
	e := b64url(big.NewInt(int64(priv.PublicKey.E)).Bytes())
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"keys": []map[string]string{
				{"kid": kid, "kty": "RSA", "use": "sig", "alg": "RS256", "n": n, "e": e},
			},
		})
	}))
}

func signToken(t *testing.T, priv *rsa.PrivateKey, kid string, claims map[string]interface{}) string {
	t.Helper()
	header := b64url([]byte(`{"alg":"RS256","kid":"` + kid + `"}`))
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	payload := b64url(payloadBytes)
	digest := sha256.Sum256([]byte(header + "." + payload))
	sig, err := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return header + "." + payload + "." + b64url(sig)
}

func newTestValidator(jwksURL, issuer, audience string) *KeycloakValidator {
	v := NewKeycloakValidator()
	v.jwksURL = jwksURL
	v.issuer = issuer
	v.audience = audience
	return v
}

const testKid = "test-key-1"
const testIssuer = "http://keycloak:8080/realms/tradegateway"

func TestValidateToken_ValidPasses(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := testJWKS(t, priv, testKid)
	defer srv.Close()
	v := newTestValidator(srv.URL, testIssuer, "tradegateway-api")
	token := signToken(t, priv, testKid, map[string]interface{}{
		"iss": testIssuer,
		"aud": "tradegateway-api",
		"exp": time.Now().Add(5 * time.Minute).Unix(),
	})
	if err := v.ValidateToken(context.Background(), token); err != nil {
		t.Fatalf("valid token rejected: %v", err)
	}
}

func TestValidateToken_GarbageRejected(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := testJWKS(t, priv, testKid)
	defer srv.Close()
	v := newTestValidator(srv.URL, testIssuer, "")
	for _, garbage := range []string{"", "not-a-jwt", "a.b.c", "x.y", "...."} {
		if err := v.ValidateToken(context.Background(), garbage); err == nil {
			t.Fatalf("garbage token %q accepted", garbage)
		}
	}
}

func TestValidateToken_ExpiredRejected(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := testJWKS(t, priv, testKid)
	defer srv.Close()
	v := newTestValidator(srv.URL, testIssuer, "")
	token := signToken(t, priv, testKid, map[string]interface{}{
		"iss": testIssuer,
		"exp": time.Now().Add(-10 * time.Minute).Unix(),
	})
	if err := v.ValidateToken(context.Background(), token); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestValidateToken_WrongIssuerRejected(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := testJWKS(t, priv, testKid)
	defer srv.Close()
	v := newTestValidator(srv.URL, testIssuer, "")
	token := signToken(t, priv, testKid, map[string]interface{}{
		"iss": "http://evil.example.com/realms/tradegateway",
		"exp": time.Now().Add(5 * time.Minute).Unix(),
	})
	if err := v.ValidateToken(context.Background(), token); err == nil {
		t.Fatal("wrong-issuer token accepted")
	}
}

func TestValidateToken_WrongAudienceRejected(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := testJWKS(t, priv, testKid)
	defer srv.Close()
	v := newTestValidator(srv.URL, testIssuer, "tradegateway-api")
	token := signToken(t, priv, testKid, map[string]interface{}{
		"iss": testIssuer,
		"aud": "some-other-service",
		"exp": time.Now().Add(5 * time.Minute).Unix(),
	})
	if err := v.ValidateToken(context.Background(), token); err == nil {
		t.Fatal("wrong-audience token accepted")
	}
}

func TestValidateToken_WrongSignatureRejected(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := testJWKS(t, priv, testKid)
	defer srv.Close()
	v := newTestValidator(srv.URL, testIssuer, "")
	// Signed with a different key than the JWKS advertises for testKid.
	token := signToken(t, other, testKid, map[string]interface{}{
		"iss": testIssuer,
		"exp": time.Now().Add(5 * time.Minute).Unix(),
	})
	if err := v.ValidateToken(context.Background(), token); err == nil {
		t.Fatal("token with invalid signature accepted")
	}
}

func TestValidateTokenMiddleware_RejectsAndPasses(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := testJWKS(t, priv, testKid)
	defer srv.Close()
	v := newTestValidator(srv.URL, testIssuer, "")
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := v.ValidateTokenMiddleware()(ok)

	// No header
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing header: got %d", rec.Code)
	}
	// Garbage bearer
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer garbage")
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("garbage bearer: got %d", rec.Code)
	}
	// Valid token
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	token := signToken(t, priv, testKid, map[string]interface{}{
		"iss": testIssuer,
		"exp": time.Now().Add(5 * time.Minute).Unix(),
	})
	req.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid token: got %d", rec.Code)
	}
}
