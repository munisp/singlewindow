// Package middleware — service-to-service authentication for the TigerBeetle
// bridge (PRA-012, Phase 9).
//
// The bridge fronts the financial ledger; previously /api/ledger/* accepted
// UNAUTHENTICATED calls. Two verification modes:
//
//	keycloak  (REQUIRED in production): RS256 Bearer tokens issued by Keycloak,
//	          verified against the realm JWKS (KEYCLOAK_URL + KEYCLOAK_REALM),
//	          with issuer + expiry enforcement and JWKS caching.
//	static    (non-production ONLY):   a shared secret compared in constant
//	          time (TB_BRIDGE_SHARED_SECRET). Documented dev fallback.
//
// Fail-closed: production (APP_ENV=production or NODE_ENV=production) refuses
// to boot without a working keycloak configuration, and rejects static mode.
package middleware

import (
	"context"
	"crypto/rsa"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// AuthConfig holds the verifier configuration.
type AuthConfig struct {
	Mode         string // "keycloak" | "static"
	KeycloakURL  string
	Realm        string
	SharedSecret string
	Audience     string // optional expected aud
	Production   bool
}

// AuthVerifier validates Bearer tokens for money-rail endpoints.
type AuthVerifier struct {
	cfg    AuthConfig
	logger *zap.Logger

	mu     sync.RWMutex
	jwks   map[string]*rsa.PublicKey
	jwksAt time.Time
}

const jwksCacheTTL = 5 * time.Minute

func isProductionEnv() bool {
	return os.Getenv("APP_ENV") == "production" || os.Getenv("NODE_ENV") == "production"
}

// NewAuthVerifier builds the verifier from the environment and enforces the
// fail-closed boot policy. Returns an error when production is misconfigured.
func NewAuthVerifier(logger *zap.Logger) (*AuthVerifier, error) {
	cfg := AuthConfig{
		Mode:         strings.ToLower(strings.TrimSpace(os.Getenv("TB_BRIDGE_AUTH_MODE"))),
		KeycloakURL:  strings.TrimRight(os.Getenv("KEYCLOAK_URL"), "/"),
		Realm:        os.Getenv("KEYCLOAK_REALM"),
		SharedSecret: os.Getenv("TB_BRIDGE_SHARED_SECRET"),
		Audience:     os.Getenv("TB_BRIDGE_TOKEN_AUDIENCE"),
		Production:   isProductionEnv(),
	}
	if cfg.Realm == "" {
		cfg.Realm = "tradegateway"
	}
	if cfg.Mode == "" {
		// Default: keycloak when a Keycloak URL is present, else static
		// (which production below rejects).
		if cfg.KeycloakURL != "" {
			cfg.Mode = "keycloak"
		} else {
			cfg.Mode = "static"
		}
	}

	switch cfg.Mode {
	case "keycloak":
		if cfg.KeycloakURL == "" {
			return nil, fmt.Errorf("TB_BRIDGE_AUTH_MODE=keycloak requires KEYCLOAK_URL (failing closed)")
		}
	case "static":
		if cfg.Production {
			return nil, fmt.Errorf("TB_BRIDGE_AUTH_MODE=static is forbidden in production (shared-secret fallback is non-production only); configure keycloak mode — failing closed")
		}
		if cfg.SharedSecret == "" {
			return nil, fmt.Errorf("TB_BRIDGE_AUTH_MODE=static requires TB_BRIDGE_SHARED_SECRET")
		}
		logger.Warn("TigerBeetle bridge using STATIC shared-secret service auth (non-production only)")
	default:
		return nil, fmt.Errorf("unknown TB_BRIDGE_AUTH_MODE %q (want keycloak|static)", cfg.Mode)
	}
	return &AuthVerifier{cfg: cfg, logger: logger}, nil
}

type jwksDocument struct {
	Keys []struct {
		Kid string `json:"kid"`
		Kty string `json:"kty"`
		Alg string `json:"alg"`
		Use string `json:"use"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

func (v *AuthVerifier) fetchJWKS(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	v.mu.RLock()
	if v.jwks != nil && time.Since(v.jwksAt) < jwksCacheTTL {
		defer v.mu.RUnlock()
		return v.jwks, nil
	}
	v.mu.RUnlock()

	url := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", v.cfg.KeycloakURL, v.cfg.Realm)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("JWKS fetch failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("JWKS endpoint answered HTTP %d", resp.StatusCode)
	}
	var doc jwksDocument
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, fmt.Errorf("JWKS decode failed: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" || k.N == "" || k.E == "" {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			continue
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			continue
		}
		e := 0
		for _, b := range eBytes {
			e = e<<8 | int(b)
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: e}
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("JWKS document contained no usable RSA keys")
	}
	v.mu.Lock()
	v.jwks = keys
	v.jwksAt = time.Now()
	v.mu.Unlock()
	return keys, nil
}

// VerifyToken validates a Bearer token. Returns nil error iff the token is
// acceptable for money-rail endpoints.
func (v *AuthVerifier) VerifyToken(ctx context.Context, authHeader string) error {
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return fmt.Errorf("missing Bearer token")
	}
	token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	if token == "" {
		return fmt.Errorf("empty Bearer token")
	}

	if v.cfg.Mode == "static" {
		if subtle.ConstantTimeCompare([]byte(token), []byte(v.cfg.SharedSecret)) != 1 {
			return fmt.Errorf("invalid shared secret")
		}
		return nil
	}

	// keycloak mode
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithIssuer(fmt.Sprintf("%s/realms/%s", v.cfg.KeycloakURL, v.cfg.Realm)),
		jwt.WithExpirationRequired(),
	)
	if v.cfg.Audience != "" {
		parser = jwt.NewParser(
			jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
			jwt.WithIssuer(fmt.Sprintf("%s/realms/%s", v.cfg.KeycloakURL, v.cfg.Realm)),
			jwt.WithExpirationRequired(),
			jwt.WithAudience(v.cfg.Audience),
		)
	}
	_, err := parser.Parse(token, func(t *jwt.Token) (interface{}, error) {
		kid, _ := t.Header["kid"].(string)
		keys, err := v.fetchJWKS(ctx)
		if err != nil {
			return nil, err
		}
		pub, ok := keys[kid]
		if !ok {
			return nil, fmt.Errorf("unknown signing key kid=%q", kid)
		}
		return pub, nil
	})
	if err != nil {
		return fmt.Errorf("token verification failed: %w", err)
	}
	return nil
}

// RequireServiceAuth is HTTP middleware enforcing the verifier on a route
// group (mount on /api/ledger/*). Unauthenticated => 401, verifier error =>
// 503 (fail closed — a broken JWKS must not silently allow).
func (v *AuthVerifier) RequireServiceAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := v.VerifyToken(r.Context(), r.Header.Get("Authorization"))
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			// Distinguish "no/invalid credentials" (401) from "cannot verify"
			// (503) so operators see JWKS outages as incidents.
			if strings.HasPrefix(err.Error(), "token verification failed: JWKS") ||
				strings.Contains(err.Error(), "JWKS") {
				w.WriteHeader(http.StatusServiceUnavailable)
				fmt.Fprintf(w, `{"error":"AUTH_VERIFIER_UNAVAILABLE","message":%q}`, err.Error())
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprintf(w, `{"error":"SERVICE_AUTH_REQUIRED","message":%q}`, err.Error())
			return
		}
		next.ServeHTTP(w, r)
	})
}

// GRPCUnaryAuthInterceptor requires a valid token on every gRPC method EXCEPT
// the standard health service (grpc.health.v1 — probes must stay open).
// The bridge currently exposes only the health service; this interceptor is
// defence in depth so any future money-rail gRPC method is authenticated by
// default (PRA-012).
func (v *AuthVerifier) GRPCUnaryAuthInterceptor(
	ctx context.Context,
	req interface{},
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (interface{}, error) {
	if strings.HasPrefix(info.FullMethod, "/grpc.health.v1/") {
		return handler(ctx, req)
	}
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "SERVICE_AUTH_REQUIRED: missing metadata")
	}
	auth := strings.Join(md.Get("authorization"), " ")
	if err := v.VerifyToken(ctx, auth); err != nil {
		return nil, status.Errorf(codes.Unauthenticated, "SERVICE_AUTH_REQUIRED: %v", err)
	}
	return handler(ctx, req)
}
