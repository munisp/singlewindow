// Package keycloak provides production-grade OIDC JWT validation middleware
// for all TradeGateway Go microservices. It validates tokens issued by the
// Keycloak realm, extracts roles and claims, and injects a typed Principal
// into the request context.
//
// Usage:
//
//	mw, err := keycloak.NewMiddleware(keycloak.Config{
//	    RealmURL: "https://iam.tradegateway.gov.gh/realms/tradegateway",
//	    ClientID: "tradegateway-api",
//	})
//	r.Use(mw.Authenticate)
//	r.Use(mw.RequireRole("customs_officer"))
package keycloak

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

// ─── Public types ─────────────────────────────────────────────────────────────

// Config holds the Keycloak middleware configuration.
type Config struct {
	// RealmURL is the full Keycloak realm base URL, e.g.
	// "https://iam.tradegateway.gov.gh/realms/tradegateway"
	RealmURL string

	// ClientID is the expected audience claim in the token.
	ClientID string

	// SkipAudienceCheck disables audience validation (useful for service tokens
	// that carry a different audience). Defaults to false.
	SkipAudienceCheck bool

	// Logger is an optional zap logger; a production logger is used if nil.
	Logger *zap.Logger

	// JWKSRefreshInterval controls how often the JWKS cache is refreshed.
	// Defaults to 5 minutes.
	JWKSRefreshInterval time.Duration
}

// Principal represents the authenticated user extracted from the JWT.
type Principal struct {
	Subject     string
	Email       string
	Username    string
	Roles       []string
	Groups      []string
	CompanyName string
	TIN         string
	AEOStatus   string
	RawClaims   map[string]interface{}
}

// HasRole returns true if the principal holds the given realm role.
func (p *Principal) HasRole(role string) bool {
	for _, r := range p.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// HasAnyRole returns true if the principal holds at least one of the given roles.
func (p *Principal) HasAnyRole(roles ...string) bool {
	for _, role := range roles {
		if p.HasRole(role) {
			return true
		}
	}
	return false
}

type contextKey string

const principalKey contextKey = "keycloak_principal"

// FromContext extracts the Principal from a request context.
// Returns nil if no principal is present (unauthenticated request).
func FromContext(ctx context.Context) *Principal {
	p, _ := ctx.Value(principalKey).(*Principal)
	return p
}

// ─── JWKS cache ───────────────────────────────────────────────────────────────

type jwk struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwksResponse struct {
	Keys []jwk `json:"keys"`
}

type jwksCache struct {
	mu          sync.RWMutex
	keys        map[string]*rsa.PublicKey
	lastRefresh time.Time
	realmURL    string
	client      *http.Client
	logger      *zap.Logger
	ttl         time.Duration
}

func newJWKSCache(realmURL string, ttl time.Duration, logger *zap.Logger) *jwksCache {
	return &jwksCache{
		keys:     make(map[string]*rsa.PublicKey),
		realmURL: realmURL,
		client:   &http.Client{Timeout: 10 * time.Second},
		logger:   logger,
		ttl:      ttl,
	}
}

func (c *jwksCache) getKey(kid string) (*rsa.PublicKey, error) {
	c.mu.RLock()
	fresh := time.Since(c.lastRefresh) < c.ttl
	key, ok := c.keys[kid]
	c.mu.RUnlock()

	if fresh && ok {
		return key, nil
	}
	// Cache miss or stale — refresh.
	if err := c.refresh(); err != nil {
		return nil, fmt.Errorf("JWKS refresh failed: %w", err)
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	key, ok = c.keys[kid]
	if !ok {
		return nil, fmt.Errorf("unknown key id: %s", kid)
	}
	return key, nil
}

func (c *jwksCache) refresh() error {
	url := c.realmURL + "/protocol/openid-connect/certs"
	resp, err := c.client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS endpoint returned %d", resp.StatusCode)
	}
	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return err
	}
	keys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, k := range jwks.Keys {
		if k.Kty != "RSA" || k.Use != "sig" {
			continue
		}
		pub, err := rsaPublicKeyFromJWK(k)
		if err != nil {
			c.logger.Warn("failed to parse JWK", zap.String("kid", k.Kid), zap.Error(err))
			continue
		}
		keys[k.Kid] = pub
	}
	c.mu.Lock()
	c.keys = keys
	c.lastRefresh = time.Now()
	c.mu.Unlock()
	c.logger.Info("JWKS cache refreshed", zap.Int("keys", len(keys)))
	return nil
}

func rsaPublicKeyFromJWK(k jwk) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, fmt.Errorf("decode N: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, fmt.Errorf("decode E: %w", err)
	}
	n := new(big.Int).SetBytes(nBytes)
	var eInt int
	for _, b := range eBytes {
		eInt = eInt<<8 | int(b)
	}
	return &rsa.PublicKey{N: n, E: eInt}, nil
}

// ─── JWT parsing ──────────────────────────────────────────────────────────────

type jwtHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
}

type jwtClaims struct {
	Sub               string      `json:"sub"`
	Iss               string      `json:"iss"`
	Aud               interface{} `json:"aud"` // string or []string
	Exp               int64       `json:"exp"`
	Email             string      `json:"email"`
	PreferredUsername string      `json:"preferred_username"`
	Roles             []string    `json:"roles"`
	Groups            []string    `json:"groups"`
	CompanyName       string      `json:"company_name"`
	TIN               string      `json:"tin"`
	AEOStatus         string      `json:"aeo_status"`
}

func parseJWTParts(parts []string) (*jwtHeader, *jwtClaims, map[string]interface{}, error) {
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode header: %w", err)
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, nil, nil, fmt.Errorf("parse header: %w", err)
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode payload: %w", err)
	}
	var claims jwtClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, nil, nil, fmt.Errorf("parse claims: %w", err)
	}
	var rawMap map[string]interface{}
	_ = json.Unmarshal(payloadBytes, &rawMap)
	return &header, &claims, rawMap, nil
}

// ─── Middleware ────────────────────────────────────────────────────────────────

// Middleware validates Keycloak-issued JWTs on incoming HTTP requests.
type Middleware struct {
	cfg  Config
	jwks *jwksCache
	log  *zap.Logger
}

// NewMiddleware creates a new Keycloak JWT validation middleware.
// It eagerly fetches the JWKS on construction to fail fast on misconfiguration.
func NewMiddleware(cfg Config) (*Middleware, error) {
	if cfg.RealmURL == "" {
		return nil, errors.New("keycloak: RealmURL is required")
	}
	if cfg.Logger == nil {
		cfg.Logger, _ = zap.NewProduction()
	}
	if cfg.JWKSRefreshInterval == 0 {
		cfg.JWKSRefreshInterval = 5 * time.Minute
	}
	cache := newJWKSCache(cfg.RealmURL, cfg.JWKSRefreshInterval, cfg.Logger)
	if err := cache.refresh(); err != nil {
		return nil, fmt.Errorf("keycloak: initial JWKS fetch failed: %w", err)
	}
	return &Middleware{cfg: cfg, jwks: cache, log: cfg.Logger}, nil
}

// Authenticate is an http.Handler middleware that validates the Bearer token
// and injects the Principal into the request context.
// Requests without a valid token receive 401 Unauthorized.
func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, err := extractBearerToken(r)
		if err != nil {
			http.Error(w, `{"error":"missing_token","message":"Authorization header required"}`, http.StatusUnauthorized)
			return
		}
		principal, err := m.validate(token)
		if err != nil {
			m.log.Warn("token validation failed",
				zap.String("path", r.URL.Path),
				zap.Error(err),
			)
			http.Error(w, `{"error":"invalid_token","message":"Token validation failed"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), principalKey, principal)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireRole returns a middleware that enforces the given realm role.
// Must be chained after Authenticate.
func (m *Middleware) RequireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := FromContext(r.Context())
			if p == nil || !p.HasRole(role) {
				http.Error(w, `{"error":"forbidden","message":"Insufficient role"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAnyRole returns a middleware that enforces at least one of the given roles.
func (m *Middleware) RequireAnyRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := FromContext(r.Context())
			if p == nil || !p.HasAnyRole(roles...) {
				http.Error(w, `{"error":"forbidden","message":"Insufficient role"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ─── Validation ───────────────────────────────────────────────────────────────

func (m *Middleware) validate(tokenStr string) (*Principal, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed JWT: expected 3 parts")
	}
	header, claims, rawMap, err := parseJWTParts(parts)
	if err != nil {
		return nil, err
	}
	if header.Alg != "RS256" {
		return nil, fmt.Errorf("unsupported algorithm: %s", header.Alg)
	}
	pub, err := m.jwks.getKey(header.Kid)
	if err != nil {
		return nil, err
	}
	signingInput := []byte(parts[0] + "." + parts[1])
	if err := verifySignature(signingInput, parts[2], pub); err != nil {
		return nil, fmt.Errorf("signature verification failed: %w", err)
	}
	if time.Now().Unix() > claims.Exp {
		return nil, errors.New("token expired")
	}
	if claims.Iss != m.cfg.RealmURL {
		return nil, fmt.Errorf("unexpected issuer: %s", claims.Iss)
	}
	if !m.cfg.SkipAudienceCheck {
		if err := validateAudience(claims.Aud, m.cfg.ClientID); err != nil {
			return nil, err
		}
	}
	return &Principal{
		Subject:     claims.Sub,
		Email:       claims.Email,
		Username:    claims.PreferredUsername,
		Roles:       claims.Roles,
		Groups:      claims.Groups,
		CompanyName: claims.CompanyName,
		TIN:         claims.TIN,
		AEOStatus:   claims.AEOStatus,
		RawClaims:   rawMap,
	}, nil
}

func validateAudience(aud interface{}, expected string) error {
	switch v := aud.(type) {
	case string:
		if v == expected {
			return nil
		}
	case []interface{}:
		for _, a := range v {
			if s, ok := a.(string); ok && s == expected {
				return nil
			}
		}
	}
	return fmt.Errorf("audience mismatch: expected %s", expected)
}

func extractBearerToken(r *http.Request) (string, error) {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return "", errors.New("missing Authorization header")
	}
	if !strings.HasPrefix(auth, "Bearer ") {
		return "", errors.New("Authorization header must use Bearer scheme")
	}
	return strings.TrimPrefix(auth, "Bearer "), nil
}
