// keycloak_validator.go — REAL Keycloak RS256 JWT validation for cen-service.
//
// P0 remediation (independent audit): the previous middleware only checked the
// "Bearer " prefix and logged "JWT validated" — ANY token string was accepted,
// and FetchJWKS was dead code. This implementation performs full RS256
// verification against the realm JWKS:
//   - signature verified with the JWKS RSA key matching the token `kid`
//     (only RSA signing keys >= 2048 bits are trusted; JWKS is cached with a
//     5-minute TTL and refreshed on unknown kid);
//   - `exp` / `nbf` enforced (60s clock-skew leeway on nbf only);
//   - `iss` must equal the configured issuer;
//   - `aud` must contain KEYCLOAK_EXPECTED_AUDIENCE when that env var is set.
// Anything failing verification is rejected with 401. No token is ever
// accepted on format alone.
//
// Configuration (environment):
//   KEYCLOAK_JWKS_URL           full JWKS URL (preferred). If unset, derived
//                               from KEYCLOAK_URL + KEYCLOAK_REALM.
//   KEYCLOAK_ISSUER             expected `iss`. If unset, derived as
//                               "<KEYCLOAK_URL>/realms/<KEYCLOAK_REALM>".
//   KEYCLOAK_EXPECTED_AUDIENCE  expected `aud`. If unset, audience is not
//                               enforced and a loud startup warning is logged
//                               (set it in production).
package middleware

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type KeycloakValidator struct {
	jwksURL    string
	issuer     string
	audience   string
	httpClient *http.Client

	mu       sync.RWMutex
	keys     map[string]*rsa.PublicKey
	loadedAt time.Time

	logger *slog.Logger
}

func NewKeycloakValidator() *KeycloakValidator {
	base := os.Getenv("KEYCLOAK_URL")
	if base == "" {
		base = "http://keycloak:8080"
	}
	realm := os.Getenv("KEYCLOAK_REALM")
	if realm == "" {
		realm = "tradegateway"
	}
	jwksURL := os.Getenv("KEYCLOAK_JWKS_URL")
	if jwksURL == "" {
		jwksURL = fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", strings.TrimRight(base, "/"), realm)
	}
	issuer := os.Getenv("KEYCLOAK_ISSUER")
	if issuer == "" {
		issuer = fmt.Sprintf("%s/realms/%s", strings.TrimRight(base, "/"), realm)
	}
	audience := os.Getenv("KEYCLOAK_EXPECTED_AUDIENCE")
	logger := slog.Default().With("component", "keycloak", "service", "cen-service")
	if audience == "" {
		logger.Warn("KEYCLOAK_EXPECTED_AUDIENCE is not set — JWT audience claim will NOT be enforced; set it in production")
	}
	return &KeycloakValidator{
		jwksURL:  jwksURL,
		issuer:   issuer,
		audience: audience,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return errors.New("JWKS redirects are not permitted")
			},
		},
		keys:   make(map[string]*rsa.PublicKey),
		logger: logger,
	}
}

// FetchJWKS loads (or refreshes) the trusted RSA signing keys from the realm
// JWKS endpoint. Only kty=RSA, use=sig keys of at least 2048 bits are trusted.
func (k *KeycloakValidator) FetchJWKS(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, k.jwksURL, nil)
	if err != nil {
		return fmt.Errorf("build jwks request: %w", err)
	}
	resp, err := k.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fetch jwks: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks endpoint returned HTTP %d", resp.StatusCode)
	}
	var doc struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Use string `json:"use"`
			Alg string `json:"alg"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}
	loaded := make(map[string]*rsa.PublicKey)
	for _, item := range doc.Keys {
		if item.Kty != "RSA" || item.Kid == "" || item.N == "" || item.E == "" {
			continue
		}
		if item.Use != "" && item.Use != "sig" {
			continue
		}
		if item.Alg != "" && item.Alg != "RS256" {
			continue
		}
		modulus, err := decodeBase64URL(item.N)
		if err != nil {
			continue
		}
		exponentBytes, err := decodeBase64URL(item.E)
		if err != nil || len(exponentBytes) == 0 || len(exponentBytes) > 4 {
			continue
		}
		exponent := 0
		for _, b := range exponentBytes {
			exponent = exponent<<8 | int(b)
		}
		if exponent < 3 || exponent%2 == 0 {
			continue
		}
		key := &rsa.PublicKey{N: new(big.Int).SetBytes(modulus), E: exponent}
		if key.N.BitLen() < 2048 {
			continue
		}
		loaded[item.Kid] = key
	}
	if len(loaded) == 0 {
		return errors.New("jwks contains no approved RSA signing keys")
	}
	k.mu.Lock()
	k.keys = loaded
	k.loadedAt = time.Now()
	k.mu.Unlock()
	k.logger.Info("JWKS refreshed", "key_count", len(loaded))
	return nil
}

func (k *KeycloakValidator) key(ctx context.Context, kid string, refresh bool) (*rsa.PublicKey, error) {
	k.mu.RLock()
	key := k.keys[kid]
	fresh := time.Since(k.loadedAt) < 5*time.Minute
	k.mu.RUnlock()
	if key != nil && fresh {
		return key, nil
	}
	if !refresh {
		return nil, errors.New("jwt key is not trusted")
	}
	if err := k.FetchJWKS(ctx); err != nil {
		return nil, fmt.Errorf("load jwks: %w", err)
	}
	k.mu.RLock()
	defer k.mu.RUnlock()
	if key := k.keys[kid]; key != nil {
		return key, nil
	}
	return nil, errors.New("jwt key id is not trusted")
}

// ValidateToken verifies an RS256 JWT: signature, exp/nbf, iss and (when
// configured) aud. Returns an error describing the failure; never nil for an
// unverifiable token.
func (k *KeycloakValidator) ValidateToken(ctx context.Context, token string) error {
	segments := strings.Split(token, ".")
	if len(segments) != 3 || segments[0] == "" || segments[1] == "" || segments[2] == "" {
		return errors.New("jwt compact serialization is invalid")
	}
	headerBytes, err := decodeBase64URL(segments[0])
	if err != nil {
		return errors.New("jwt header is invalid")
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Alg != "RS256" || strings.TrimSpace(header.Kid) == "" {
		return errors.New("jwt algorithm or key id is invalid")
	}
	key, err := k.key(ctx, header.Kid, true)
	if err != nil {
		return err
	}
	signature, err := decodeBase64URL(segments[2])
	if err != nil {
		return errors.New("jwt signature is invalid")
	}
	digest := sha256.Sum256([]byte(segments[0] + "." + segments[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		return errors.New("jwt signature verification failed")
	}
	payloadBytes, err := decodeBase64URL(segments[1])
	if err != nil {
		return errors.New("jwt claims are invalid")
	}
	var claims struct {
		Issuer    string          `json:"iss"`
		Audience  json.RawMessage `json:"aud"`
		Expires   json.Number     `json:"exp"`
		NotBefore json.Number     `json:"nbf"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(payloadBytes)))
	decoder.UseNumber()
	if err := decoder.Decode(&claims); err != nil {
		return errors.New("jwt claims are invalid")
	}
	if claims.Issuer != k.issuer {
		return errors.New("jwt issuer is invalid")
	}
	if k.audience != "" && !audienceContains(claims.Audience, k.audience) {
		return errors.New("jwt audience is invalid")
	}
	now := time.Now().Unix()
	expires, err := claims.Expires.Int64()
	if err != nil || now >= expires {
		return errors.New("jwt is expired or has no valid expiry")
	}
	if claims.NotBefore != "" {
		notBefore, parseErr := claims.NotBefore.Int64()
		// 60s leeway for clock skew on nbf only; exp stays strict.
		if parseErr != nil || now+60 < notBefore {
			return errors.New("jwt is not yet valid")
		}
	}
	return nil
}

// ValidateTokenMiddleware rejects any request whose bearer token fails real
// RS256/JWKS validation with 401. JWKS load failures also produce 401
// (fail-closed: an unverifiable token is never accepted).
func (k *KeycloakValidator) ValidateTokenMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := strings.TrimSpace(r.Header.Get("Authorization"))
			parts := strings.SplitN(auth, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			if err := k.ValidateToken(r.Context(), strings.TrimSpace(parts[1])); err != nil {
				k.logger.Warn("JWT rejected", "path", r.URL.Path, "reason", err.Error())
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func decodeBase64URL(value string) ([]byte, error) {
	if decoded, err := base64.RawURLEncoding.DecodeString(value); err == nil {
		return decoded, nil
	}
	return base64.URLEncoding.DecodeString(value)
}

func audienceContains(raw json.RawMessage, expected string) bool {
	if len(raw) == 0 {
		return false
	}
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		return single == expected
	}
	var multiple []string
	if err := json.Unmarshal(raw, &multiple); err == nil {
		for _, candidate := range multiple {
			if candidate == expected {
				return true
			}
		}
	}
	return false
}
