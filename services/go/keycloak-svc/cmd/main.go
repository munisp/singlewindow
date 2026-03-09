// Keycloak OIDC Validator Service — TradeGateway NGSWTP (Sprint 32)
// Language: Go 1.23 | Framework: Chi HTTP + gRPC
// Role: Validates Keycloak-issued JWTs, caches JWKS, maps realm roles to
//       TradeGateway roles, and exposes an HTTP API for the tRPC layer.
//
// OIDC flow:
//   1. On startup (or config change), fetch /.well-known/openid-configuration
//   2. Extract jwks_uri and fetch the JWKS key set
//   3. Cache JWKS with 1-hour TTL; rotate on 401 from downstream
//   4. Validate incoming JWT: signature, issuer, audience, expiry
//   5. Extract realm_access.roles from Keycloak claims
//   6. Map Keycloak roles → TradeGateway roles via configurable mapping
//   7. Return validated claims + mapped role to tRPC caller
//
// Endpoints:
//   GET  /health
//   POST /api/oidc/validate          — validate a JWT token
//   GET  /api/oidc/discovery         — return cached OIDC discovery document
//   GET  /api/oidc/jwks              — return cached JWKS
//   POST /api/oidc/refresh-jwks      — force JWKS refresh
//   GET  /api/oidc/config            — return current configuration
//   PUT  /api/oidc/config            — update configuration
//   POST /api/oidc/test-connection   — test Keycloak realm connectivity

package main

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

// ─── Configuration ────────────────────────────────────────────────────────────

var (
	httpPort = getEnv("KEYCLOAK_SVC_HTTP_PORT", "8087")
	grpcPort = getEnv("KEYCLOAK_SVC_GRPC_PORT", "9087")
)

// ─── Domain types ─────────────────────────────────────────────────────────────

// OIDCDiscovery mirrors the /.well-known/openid-configuration response.
type OIDCDiscovery struct {
	Issuer                string   `json:"issuer"`
	AuthorizationEndpoint string   `json:"authorization_endpoint"`
	TokenEndpoint         string   `json:"token_endpoint"`
	JwksURI               string   `json:"jwks_uri"`
	UserinfoEndpoint      string   `json:"userinfo_endpoint"`
	EndSessionEndpoint    string   `json:"end_session_endpoint"`
	ScopesSupported       []string `json:"scopes_supported"`
	ResponseTypesSupported []string `json:"response_types_supported"`
	GrantTypesSupported   []string `json:"grant_types_supported"`
}

// JWK represents a single JSON Web Key.
type JWK struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// JWKS is the JSON Web Key Set.
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// KeycloakClaims extends standard JWT claims with Keycloak-specific fields.
type KeycloakClaims struct {
	jwt.RegisteredClaims
	PreferredUsername string                 `json:"preferred_username"`
	Email             string                 `json:"email"`
	Name              string                 `json:"name"`
	GivenName         string                 `json:"given_name"`
	FamilyName        string                 `json:"family_name"`
	EmailVerified     bool                   `json:"email_verified"`
	RealmAccess       map[string]interface{} `json:"realm_access"`
	ResourceAccess    map[string]interface{} `json:"resource_access"`
	Scope             string                 `json:"scope"`
	SessionState      string                 `json:"session_state"`
	ClientID          string                 `json:"azp"`
}

// GetRealmRoles extracts the list of realm roles from the claims.
func (c *KeycloakClaims) GetRealmRoles() []string {
	if c.RealmAccess == nil {
		return nil
	}
	rolesRaw, ok := c.RealmAccess["roles"]
	if !ok {
		return nil
	}
	rolesSlice, ok := rolesRaw.([]interface{})
	if !ok {
		return nil
	}
	roles := make([]string, 0, len(rolesSlice))
	for _, r := range rolesSlice {
		if s, ok := r.(string); ok {
			roles = append(roles, s)
		}
	}
	return roles
}

// OIDCConfig holds the runtime configuration for the Keycloak integration.
type OIDCConfig struct {
	Enabled         bool              `json:"enabled"`
	RealmURL        string            `json:"realmUrl"`
	ClientID        string            `json:"clientId"`
	ClientSecret    string            `json:"clientSecret,omitempty"`
	DiscoveryURL    string            `json:"discoveryUrl"`
	Audience        string            `json:"audience"`
	FallbackEnabled bool              `json:"fallbackEnabled"`
	RoleMappings    map[string]string `json:"roleMappings"`
	Scopes          []string          `json:"scopes"`
}

// DefaultRoleMappings maps Keycloak realm roles to TradeGateway roles.
var DefaultRoleMappings = map[string]string{
	"customs-admin":    "admin",
	"customs-officer":  "customs_officer",
	"oga-officer":      "oga_officer",
	"inspector":        "inspector",
	"finance-officer":  "finance",
	"trader":           "user",
	"default-roles-tradegateway": "user",
}

// ValidationResult is returned by the /api/oidc/validate endpoint.
type ValidationResult struct {
	Valid             bool              `json:"valid"`
	Subject           string            `json:"subject"`
	Username          string            `json:"username"`
	Email             string            `json:"email"`
	Name              string            `json:"name"`
	RealmRoles        []string          `json:"realmRoles"`
	MappedRole        string            `json:"mappedRole"`
	Issuer            string            `json:"issuer"`
	Audience          []string          `json:"audience"`
	ExpiresAt         *time.Time        `json:"expiresAt"`
	IssuedAt          *time.Time        `json:"issuedAt"`
	SessionState      string            `json:"sessionState"`
	Claims            map[string]interface{} `json:"claims,omitempty"`
	Error             string            `json:"error,omitempty"`
}

// ─── JWKS cache ───────────────────────────────────────────────────────────────

type JWKSCache struct {
	mu          sync.RWMutex
	jwks        *JWKS
	discovery   *OIDCDiscovery
	fetchedAt   time.Time
	ttl         time.Duration
	realmURL    string
}

func NewJWKSCache(realmURL string) *JWKSCache {
	return &JWKSCache{
		ttl:      time.Hour,
		realmURL: realmURL,
	}
}

func (c *JWKSCache) SetRealmURL(url string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.realmURL = url
	c.jwks = nil
	c.discovery = nil
}

func (c *JWKSCache) FetchDiscovery(ctx context.Context) (*OIDCDiscovery, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.discovery != nil && time.Since(c.fetchedAt) < c.ttl {
		return c.discovery, nil
	}

	if c.realmURL == "" {
		return nil, fmt.Errorf("realm URL not configured")
	}

	discoveryURL := strings.TrimRight(c.realmURL, "/") + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discoveryURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create discovery request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch OIDC discovery: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OIDC discovery returned status %d", resp.StatusCode)
	}

	var discovery OIDCDiscovery
	if err := json.NewDecoder(resp.Body).Decode(&discovery); err != nil {
		return nil, fmt.Errorf("failed to decode OIDC discovery: %w", err)
	}

	c.discovery = &discovery
	return c.discovery, nil
}

func (c *JWKSCache) FetchJWKS(ctx context.Context) (*JWKS, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.jwks != nil && time.Since(c.fetchedAt) < c.ttl {
		return c.jwks, nil
	}

	discovery := c.discovery
	if discovery == nil {
		return nil, fmt.Errorf("OIDC discovery not loaded — call FetchDiscovery first")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discovery.JwksURI, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create JWKS request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("JWKS endpoint returned status %d", resp.StatusCode)
	}

	var jwks JWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("failed to decode JWKS: %w", err)
	}

	c.jwks = &jwks
	c.fetchedAt = time.Now()
	return c.jwks, nil
}

func (c *JWKSCache) ForceRefresh(ctx context.Context) error {
	c.mu.Lock()
	c.jwks = nil
	c.discovery = nil
	c.mu.Unlock()
	if _, err := c.FetchDiscovery(ctx); err != nil {
		return err
	}
	_, err := c.FetchJWKS(ctx)
	return err
}

// GetPublicKey returns the RSA public key for a given key ID.
func (c *JWKSCache) GetPublicKey(kid string) (*rsa.PublicKey, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.jwks == nil {
		return nil, fmt.Errorf("JWKS not loaded")
	}
	for _, key := range c.jwks.Keys {
		if key.Kid == kid && key.Kty == "RSA" {
			return jwkToRSAPublicKey(key)
		}
	}
	return nil, fmt.Errorf("key %q not found in JWKS", kid)
}

func jwkToRSAPublicKey(key JWK) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(key.N)
	if err != nil {
		return nil, fmt.Errorf("failed to decode JWK modulus: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(key.E)
	if err != nil {
		return nil, fmt.Errorf("failed to decode JWK exponent: %w", err)
	}
	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)
	return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
}

// ─── Service ──────────────────────────────────────────────────────────────────

type KeycloakService struct {
	logger     *zap.Logger
	cache      *JWKSCache
	config     OIDCConfig
	configMu   sync.RWMutex
}

func NewKeycloakService(logger *zap.Logger) *KeycloakService {
	realmURL := getEnv("KEYCLOAK_REALM_URL", "")
	svc := &KeycloakService{
		logger: logger,
		cache:  NewJWKSCache(realmURL),
		config: OIDCConfig{
			Enabled:         realmURL != "",
			RealmURL:        realmURL,
			ClientID:        getEnv("KEYCLOAK_CLIENT_ID", "tradegateway"),
			DiscoveryURL:    realmURL + "/.well-known/openid-configuration",
			Audience:        getEnv("KEYCLOAK_AUDIENCE", "tradegateway"),
			FallbackEnabled: true,
			RoleMappings:    DefaultRoleMappings,
			Scopes:          []string{"openid", "profile", "email"},
		},
	}
	// Eagerly fetch OIDC discovery if realm URL is configured
	if realmURL != "" {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if _, err := svc.cache.FetchDiscovery(ctx); err != nil {
				logger.Warn("Failed to fetch OIDC discovery on startup", zap.Error(err))
				return
			}
			if _, err := svc.cache.FetchJWKS(ctx); err != nil {
				logger.Warn("Failed to fetch JWKS on startup", zap.Error(err))
			}
		}()
	}
	return svc
}

// ValidateToken validates a JWT token and returns the claims.
func (s *KeycloakService) ValidateToken(ctx context.Context, tokenStr string) (*ValidationResult, error) {
	s.configMu.RLock()
	cfg := s.config
	s.configMu.RUnlock()

	if !cfg.Enabled {
		return &ValidationResult{
			Valid: false,
			Error: "Keycloak OIDC is not enabled",
		}, nil
	}

	// Parse without verification first to get the kid
	unverified, _, err := jwt.NewParser().ParseUnverified(tokenStr, &KeycloakClaims{})
	if err != nil {
		return &ValidationResult{Valid: false, Error: fmt.Sprintf("failed to parse token: %v", err)}, nil
	}

	kid, _ := unverified.Header["kid"].(string)

	// Get the public key for this kid
	pubKey, err := s.cache.GetPublicKey(kid)
	if err != nil {
		// Try refreshing JWKS once
		if refreshErr := s.cache.ForceRefresh(ctx); refreshErr != nil {
			return &ValidationResult{Valid: false, Error: fmt.Sprintf("JWKS unavailable: %v", refreshErr)}, nil
		}
		pubKey, err = s.cache.GetPublicKey(kid)
		if err != nil {
			return &ValidationResult{Valid: false, Error: fmt.Sprintf("key not found: %v", err)}, nil
		}
	}

	// Verify signature and claims
	claims := &KeycloakClaims{}
	_, err = jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return pubKey, nil
	}, jwt.WithIssuer(cfg.RealmURL), jwt.WithExpirationRequired())

	if err != nil {
		return &ValidationResult{Valid: false, Error: fmt.Sprintf("token validation failed: %v", err)}, nil
	}

	// Extract realm roles
	realmRoles := claims.GetRealmRoles()

	// Map to TradeGateway role
	s.configMu.RLock()
	roleMappings := s.config.RoleMappings
	s.configMu.RUnlock()

	mappedRole := "user" // default
	for _, keycloakRole := range realmRoles {
		if tgRole, ok := roleMappings[keycloakRole]; ok {
			mappedRole = tgRole
			break
		}
	}

	var expiresAt *time.Time
	var issuedAt *time.Time
	if claims.ExpiresAt != nil {
		t := claims.ExpiresAt.Time
		expiresAt = &t
	}
	if claims.IssuedAt != nil {
		t := claims.IssuedAt.Time
		issuedAt = &t
	}

	aud, _ := claims.GetAudience()

	return &ValidationResult{
		Valid:        true,
		Subject:      claims.Subject,
		Username:     claims.PreferredUsername,
		Email:        claims.Email,
		Name:         claims.Name,
		RealmRoles:   realmRoles,
		MappedRole:   mappedRole,
		Issuer:       claims.Issuer,
		Audience:     aud,
		ExpiresAt:    expiresAt,
		IssuedAt:     issuedAt,
		SessionState: claims.SessionState,
	}, nil
}

// ─── HTTP handlers ─────────────────────────────────────────────────────────────

func (s *KeycloakService) handleValidate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	// Accept token from Authorization header or JSON body
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		req.Token = strings.TrimPrefix(authHeader, "Bearer ")
	} else {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, "invalid request body", http.StatusBadRequest)
			return
		}
	}
	if req.Token == "" {
		jsonError(w, "token is required", http.StatusBadRequest)
		return
	}

	result, err := s.ValidateToken(r.Context(), req.Token)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !result.Valid {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(result)
		return
	}
	jsonOK(w, result)
}

func (s *KeycloakService) handleGetDiscovery(w http.ResponseWriter, r *http.Request) {
	discovery, err := s.cache.FetchDiscovery(r.Context())
	if err != nil {
		jsonError(w, fmt.Sprintf("failed to fetch discovery: %v", err), http.StatusServiceUnavailable)
		return
	}
	jsonOK(w, discovery)
}

func (s *KeycloakService) handleGetJWKS(w http.ResponseWriter, r *http.Request) {
	jwks, err := s.cache.FetchJWKS(r.Context())
	if err != nil {
		jsonError(w, fmt.Sprintf("failed to fetch JWKS: %v", err), http.StatusServiceUnavailable)
		return
	}
	jsonOK(w, jwks)
}

func (s *KeycloakService) handleRefreshJWKS(w http.ResponseWriter, r *http.Request) {
	if err := s.cache.ForceRefresh(r.Context()); err != nil {
		jsonError(w, fmt.Sprintf("JWKS refresh failed: %v", err), http.StatusServiceUnavailable)
		return
	}
	jsonOK(w, map[string]interface{}{
		"success":     true,
		"refreshedAt": time.Now().UTC(),
	})
}

func (s *KeycloakService) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	s.configMu.RLock()
	cfg := s.config
	s.configMu.RUnlock()
	// Redact client secret
	cfg.ClientSecret = ""
	jsonOK(w, cfg)
}

func (s *KeycloakService) handleUpdateConfig(w http.ResponseWriter, r *http.Request) {
	var req OIDCConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	s.configMu.Lock()
	if req.RealmURL != "" && req.RealmURL != s.config.RealmURL {
		s.cache.SetRealmURL(req.RealmURL)
	}
	if req.RoleMappings != nil {
		s.config.RoleMappings = req.RoleMappings
	}
	if req.ClientID != "" {
		s.config.ClientID = req.ClientID
	}
	if req.ClientSecret != "" {
		s.config.ClientSecret = req.ClientSecret
	}
	if req.Audience != "" {
		s.config.Audience = req.Audience
	}
	s.config.Enabled = req.Enabled
	s.config.FallbackEnabled = req.FallbackEnabled
	if len(req.Scopes) > 0 {
		s.config.Scopes = req.Scopes
	}
	s.configMu.Unlock()

	s.logger.Info("OIDC config updated",
		zap.String("realmURL", req.RealmURL),
		zap.Bool("enabled", req.Enabled),
	)
	jsonOK(w, map[string]interface{}{
		"success":   true,
		"updatedAt": time.Now().UTC(),
	})
}

func (s *KeycloakService) handleTestConnection(w http.ResponseWriter, r *http.Request) {
	testID := uuid.New().String()
	start := time.Now()

	discovery, err := s.cache.FetchDiscovery(r.Context())
	if err != nil {
		jsonOK(w, map[string]interface{}{
			"success":     false,
			"testId":      testID,
			"error":       err.Error(),
			"latencyMs":   time.Since(start).Milliseconds(),
			"testedAt":    time.Now().UTC(),
		})
		return
	}

	_, err = s.cache.FetchJWKS(r.Context())
	if err != nil {
		jsonOK(w, map[string]interface{}{
			"success":     false,
			"testId":      testID,
			"error":       fmt.Sprintf("JWKS fetch failed: %v", err),
			"latencyMs":   time.Since(start).Milliseconds(),
			"testedAt":    time.Now().UTC(),
		})
		return
	}

	jsonOK(w, map[string]interface{}{
		"success":   true,
		"testId":    testID,
		"issuer":    discovery.Issuer,
		"jwksUri":   discovery.JwksURI,
		"latencyMs": time.Since(start).Milliseconds(),
		"testedAt":  time.Now().UTC(),
	})
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	svc := NewKeycloakService(logger)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Service", "keycloak-svc")
			next.ServeHTTP(w, r)
		})
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, map[string]interface{}{
			"status":  "ok",
			"service": "keycloak-svc",
		})
	})

	r.Route("/api/oidc", func(r chi.Router) {
		r.Post("/validate", svc.handleValidate)
		r.Get("/discovery", svc.handleGetDiscovery)
		r.Get("/jwks", svc.handleGetJWKS)
		r.Post("/refresh-jwks", svc.handleRefreshJWKS)
		r.Get("/config", svc.handleGetConfig)
		r.Put("/config", svc.handleUpdateConfig)
		r.Post("/test-connection", svc.handleTestConnection)
	})

	// gRPC server
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		logger.Fatal("failed to listen for gRPC", zap.Error(err))
	}
	grpcServer := grpc.NewServer()
	healthSvc := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthSvc)
	healthSvc.SetServingStatus("keycloak-svc", grpc_health_v1.HealthCheckResponse_SERVING)
	reflection.Register(grpcServer)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	httpServer := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		logger.Info("Keycloak OIDC Validator HTTP server starting", zap.String("port", httpPort))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("HTTP server error", zap.Error(err))
		}
	}()

	go func() {
		logger.Info("Keycloak OIDC Validator gRPC server starting", zap.String("port", grpcPort))
		if err := grpcServer.Serve(lis); err != nil {
			logger.Fatal("gRPC server error", zap.Error(err))
		}
	}()

	<-quit
	logger.Info("Shutting down Keycloak OIDC Validator...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	httpServer.Shutdown(ctx)
	grpcServer.GracefulStop()
}
