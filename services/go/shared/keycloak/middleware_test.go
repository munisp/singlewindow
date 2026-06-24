package keycloak

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
)

// ─── Test helpers ─────────────────────────────────────────────────────────────

func generateTestKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	return key
}

func makeJWKSServer(t *testing.T, key *rsa.PrivateKey, kid string) *httptest.Server {
	t.Helper()
	nBytes := key.PublicKey.N.Bytes()
	e := key.PublicKey.E
	eBytes := make([]byte, 4)
	eBytes[0] = byte(e >> 24)
	eBytes[1] = byte(e >> 16)
	eBytes[2] = byte(e >> 8)
	eBytes[3] = byte(e)
	// Trim leading zero bytes from e
	i := 0
	for i < len(eBytes)-1 && eBytes[i] == 0 {
		i++
	}
	eBytes = eBytes[i:]

	jwksBody := map[string]interface{}{
		"keys": []map[string]interface{}{
			{
				"kid": kid,
				"kty": "RSA",
				"alg": "RS256",
				"use": "sig",
				"n":   base64.RawURLEncoding.EncodeToString(nBytes),
				"e":   base64.RawURLEncoding.EncodeToString(eBytes),
			},
		},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/certs") {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(jwksBody)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func makeToken(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]interface{}) string {
	t.Helper()
	header := map[string]string{"alg": "RS256", "kid": kid, "typ": "JWT"}
	hBytes, _ := json.Marshal(header)
	cBytes, _ := json.Marshal(claims)
	signingInput := base64.RawURLEncoding.EncodeToString(hBytes) + "." + base64.RawURLEncoding.EncodeToString(cBytes)
	sig, err := signRS256([]byte(signingInput), key)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signingInput + "." + sig
}

func defaultClaims(realmURL, clientID string) map[string]interface{} {
	return map[string]interface{}{
		"sub":                "user-123",
		"iss":                realmURL,
		"aud":                clientID,
		"exp":                time.Now().Add(5 * time.Minute).Unix(),
		"iat":                time.Now().Unix(),
		"email":              "test@tradegateway.gov.gh",
		"preferred_username": "testuser",
		"roles":              []string{"trader"},
		"groups":             []string{"/Traders"},
		"company_name":       "Test Imports Ltd",
		"tin":                "C0099999999",
		"aeo_status":         "certified",
	}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

func TestNewMiddleware_FailsWithEmptyRealmURL(t *testing.T) {
	_, err := NewMiddleware(Config{})
	if err == nil {
		t.Fatal("expected error for empty RealmURL")
	}
}

func TestNewMiddleware_FailsWhenJWKSUnreachable(t *testing.T) {
	_, err := NewMiddleware(Config{
		RealmURL: "http://127.0.0.1:19999/realms/nonexistent",
		ClientID: "test",
		Logger:   zap.NewNop(),
	})
	if err == nil {
		t.Fatal("expected error when JWKS endpoint unreachable")
	}
}

func TestAuthenticate_ValidToken(t *testing.T) {
	key := generateTestKey(t)
	kid := "test-key-1"
	srv := makeJWKSServer(t, key, kid)

	mw, err := NewMiddleware(Config{
		RealmURL: srv.URL,
		ClientID: "tradegateway-api",
		Logger:   zap.NewNop(),
	})
	if err != nil {
		t.Fatalf("NewMiddleware: %v", err)
	}

	claims := defaultClaims(srv.URL, "tradegateway-api")
	token := makeToken(t, key, kid, claims)

	var capturedPrincipal *Principal
	handler := mw.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPrincipal = FromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if capturedPrincipal == nil {
		t.Fatal("principal not injected into context")
	}
	if capturedPrincipal.Subject != "user-123" {
		t.Errorf("expected sub=user-123, got %s", capturedPrincipal.Subject)
	}
	if capturedPrincipal.Email != "test@tradegateway.gov.gh" {
		t.Errorf("expected email, got %s", capturedPrincipal.Email)
	}
	if !capturedPrincipal.HasRole("trader") {
		t.Error("expected trader role")
	}
}

func TestAuthenticate_MissingAuthHeader(t *testing.T) {
	key := generateTestKey(t)
	srv := makeJWKSServer(t, key, "k1")
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "c", Logger: zap.NewNop()})

	handler := mw.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestAuthenticate_ExpiredToken(t *testing.T) {
	key := generateTestKey(t)
	kid := "k1"
	srv := makeJWKSServer(t, key, kid)
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "tradegateway-api", Logger: zap.NewNop()})

	claims := defaultClaims(srv.URL, "tradegateway-api")
	claims["exp"] = time.Now().Add(-1 * time.Hour).Unix() // expired
	token := makeToken(t, key, kid, claims)

	handler := mw.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for expired token, got %d", rr.Code)
	}
}

func TestAuthenticate_WrongIssuer(t *testing.T) {
	key := generateTestKey(t)
	kid := "k1"
	srv := makeJWKSServer(t, key, kid)
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "tradegateway-api", Logger: zap.NewNop()})

	claims := defaultClaims(srv.URL, "tradegateway-api")
	claims["iss"] = "https://evil.example.com/realms/fake"
	token := makeToken(t, key, kid, claims)

	handler := mw.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong issuer, got %d", rr.Code)
	}
}

func TestAuthenticate_WrongAudience(t *testing.T) {
	key := generateTestKey(t)
	kid := "k1"
	srv := makeJWKSServer(t, key, kid)
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "tradegateway-api", Logger: zap.NewNop()})

	claims := defaultClaims(srv.URL, "tradegateway-api")
	claims["aud"] = "wrong-client"
	token := makeToken(t, key, kid, claims)

	handler := mw.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong audience, got %d", rr.Code)
	}
}

func TestRequireRole_AllowsCorrectRole(t *testing.T) {
	key := generateTestKey(t)
	kid := "k1"
	srv := makeJWKSServer(t, key, kid)
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "tradegateway-api", Logger: zap.NewNop()})

	claims := defaultClaims(srv.URL, "tradegateway-api")
	claims["roles"] = []string{"customs_officer"}
	token := makeToken(t, key, kid, claims)

	handler := mw.Authenticate(mw.RequireRole("customs_officer")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestRequireRole_BlocksWrongRole(t *testing.T) {
	key := generateTestKey(t)
	kid := "k1"
	srv := makeJWKSServer(t, key, kid)
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "tradegateway-api", Logger: zap.NewNop()})

	claims := defaultClaims(srv.URL, "tradegateway-api")
	claims["roles"] = []string{"trader"}
	token := makeToken(t, key, kid, claims)

	handler := mw.Authenticate(mw.RequireRole("admin")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
}

func TestRequireAnyRole_AllowsOneOfMultiple(t *testing.T) {
	key := generateTestKey(t)
	kid := "k1"
	srv := makeJWKSServer(t, key, kid)
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "tradegateway-api", Logger: zap.NewNop()})

	claims := defaultClaims(srv.URL, "tradegateway-api")
	claims["roles"] = []string{"oga_officer"}
	token := makeToken(t, key, kid, claims)

	handler := mw.Authenticate(mw.RequireAnyRole("customs_officer", "oga_officer", "admin")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestPrincipal_HasRole(t *testing.T) {
	p := &Principal{Roles: []string{"trader", "aeo_certified"}}
	if !p.HasRole("trader") {
		t.Error("expected HasRole(trader)=true")
	}
	if p.HasRole("admin") {
		t.Error("expected HasRole(admin)=false")
	}
}

func TestJWKSCache_RefreshOnCacheMiss(t *testing.T) {
	key := generateTestKey(t)
	kid := "k-refresh"
	refreshCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/certs") {
			refreshCount++
			nBytes := key.PublicKey.N.Bytes()
			eBytes := big.NewInt(int64(key.PublicKey.E)).Bytes()
			json.NewEncoder(w).Encode(map[string]interface{}{
				"keys": []map[string]interface{}{
					{"kid": kid, "kty": "RSA", "alg": "RS256", "use": "sig",
						"n": base64.RawURLEncoding.EncodeToString(nBytes),
						"e": base64.RawURLEncoding.EncodeToString(eBytes)},
				},
			})
		}
	}))
	defer srv.Close()

	cache := newJWKSCache(srv.URL, 1*time.Millisecond, zap.NewNop())
	_ = cache.refresh()
	time.Sleep(5 * time.Millisecond) // let TTL expire
	_, err := cache.getKey(kid)
	if err != nil {
		t.Fatalf("getKey after TTL expiry: %v", err)
	}
	if refreshCount < 2 {
		t.Errorf("expected at least 2 refreshes, got %d", refreshCount)
	}
}

func TestTokenWithArrayAudience(t *testing.T) {
	key := generateTestKey(t)
	kid := "k1"
	srv := makeJWKSServer(t, key, kid)
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "tradegateway-api", Logger: zap.NewNop()})

	claims := defaultClaims(srv.URL, "tradegateway-api")
	claims["aud"] = []string{"account", "tradegateway-api"} // array audience
	token := makeToken(t, key, kid, claims)

	handler := mw.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for array audience, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestFromContext_ReturnsNilWhenAbsent(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	p := FromContext(req.Context())
	if p != nil {
		t.Error("expected nil principal for unauthenticated context")
	}
}

func TestRSAPublicKeyFromJWK_InvalidN(t *testing.T) {
	k := jwk{Kid: "k", Kty: "RSA", Use: "sig", N: "!!!invalid!!!", E: "AQAB"}
	_, err := rsaPublicKeyFromJWK(k)
	if err == nil {
		t.Error("expected error for invalid N")
	}
}

func TestMalformedJWT(t *testing.T) {
	key := generateTestKey(t)
	srv := makeJWKSServer(t, key, "k1")
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "c", Logger: zap.NewNop()})

	handler := mw.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for _, bad := range []string{"notajwt", "a.b", "a.b.c.d"} {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer "+bad)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 for %q, got %d", bad, rr.Code)
		}
	}
}

func TestSkipAudienceCheck(t *testing.T) {
	key := generateTestKey(t)
	kid := "k1"
	srv := makeJWKSServer(t, key, kid)
	mw, _ := NewMiddleware(Config{
		RealmURL:          srv.URL,
		ClientID:          "tradegateway-api",
		SkipAudienceCheck: true,
		Logger:            zap.NewNop(),
	})

	claims := defaultClaims(srv.URL, "tradegateway-api")
	claims["aud"] = "some-other-client" // would normally fail
	token := makeToken(t, key, kid, claims)

	handler := mw.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 with SkipAudienceCheck, got %d", rr.Code)
	}
}

func TestCustomClaims_ExtractedCorrectly(t *testing.T) {
	key := generateTestKey(t)
	kid := "k1"
	srv := makeJWKSServer(t, key, kid)
	mw, _ := NewMiddleware(Config{RealmURL: srv.URL, ClientID: "tradegateway-api", Logger: zap.NewNop()})

	claims := defaultClaims(srv.URL, "tradegateway-api")
	claims["company_name"] = "Apex Imports Ltd"
	claims["tin"] = "C0012345678"
	claims["aeo_status"] = "certified"
	token := makeToken(t, key, kid, claims)

	var p *Principal
	handler := mw.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p = FromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	httptest.NewRecorder()
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if p == nil {
		t.Fatal("principal is nil")
	}
	if p.CompanyName != "Apex Imports Ltd" {
		t.Errorf("expected CompanyName=Apex Imports Ltd, got %s", p.CompanyName)
	}
	if p.TIN != "C0012345678" {
		t.Errorf("expected TIN=C0012345678, got %s", p.TIN)
	}
	if p.AEOStatus != "certified" {
		t.Errorf("expected AEOStatus=certified, got %s", p.AEOStatus)
	}
}

// Ensure fmt is used (for test helper output).
var _ = fmt.Sprintf
