// auth_guard.go — Phase 26 F1: mount fail-closed Keycloak JWT authentication.
//
// The Keycloak RS256/JWKS validator (internal/middleware/keycloak_validator.go)
// previously existed in this service but was NEVER mounted — dead code: every
// route accepted unauthenticated requests. This guard mounts it on ALL routes
// except the probe/metrics endpoints, which must stay open for kubelet and
// Prometheus:
//
//	exempt: /health /healthz /ready /readyz /livez /metrics /admin/metrics
//
// Modes (AUTH_MODE env):
//
//	jwt (default): validate Keycloak realm RS256 bearer tokens against the
//	               realm JWKS (KEYCLOAK_JWKS_URL / KEYCLOAK_URL+KEYCLOAK_REALM /
//	               KEYCLOAK_ISSUER). FAIL-CLOSED: when no Keycloak configuration
//	               is present, protected routes return 503
//	               {"error":"auth not configured"} — never silently allow.
//	edge:          the service sits behind APISIX edge authentication; trust
//	               edge-injected identity headers (X-User / X-User-ID /
//	               X-Consumer-Username). Requests without an edge identity are
//	               rejected 401. This mode is honoured ONLY when explicitly set;
//	               the default always validates the JWT.
//
// No route paths or response shapes are changed; authenticated requests flow
// through untouched.
package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"

	svcauth "github.com/tradegateway/asean-sw-service/internal/middleware"
)

// authPathExempt reports whether path is an intentionally public probe/metrics
// endpoint.
func authPathExempt(path string) bool {
	switch path {
	case "/health", "/healthz", "/ready", "/readyz", "/livez", "/metrics", "/admin/metrics":
		return true
	}
	return false
}

func keycloakConfigured() bool {
	return os.Getenv("KEYCLOAK_JWKS_URL") != "" ||
		os.Getenv("KEYCLOAK_URL") != "" ||
		os.Getenv("KEYCLOAK_ISSUER") != ""
}

// authGuard mounts fail-closed authentication on the gin engine.
func authGuard() gin.HandlerFunc {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_MODE"))) {
	case "edge":
		log.Printf("[auth] AUTH_MODE=edge — trusting APISIX edge-injected identity headers (X-User); requests without one are rejected")
		return func(c *gin.Context) {
			if authPathExempt(c.Request.URL.Path) {
				c.Next()
				return
			}
			if strings.TrimSpace(c.GetHeader("X-User")) == "" &&
				strings.TrimSpace(c.GetHeader("X-User-ID")) == "" &&
				strings.TrimSpace(c.GetHeader("X-Consumer-Username")) == "" {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
				return
			}
			c.Next()
		}
	default:
		if !keycloakConfigured() {
			log.Printf("[auth] FAIL-CLOSED: no Keycloak configuration (KEYCLOAK_JWKS_URL/KEYCLOAK_URL/KEYCLOAK_ISSUER) — protected routes return 503 auth not configured")
			return func(c *gin.Context) {
				if authPathExempt(c.Request.URL.Path) {
					c.Next()
					return
				}
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "auth not configured"})
			}
		}
		validator := svcauth.NewKeycloakValidator()
		return func(c *gin.Context) {
			if authPathExempt(c.Request.URL.Path) {
				c.Next()
				return
			}
			auth := strings.TrimSpace(c.GetHeader("Authorization"))
			parts := strings.SplitN(auth, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
				return
			}
			if err := validator.ValidateToken(c.Request.Context(), strings.TrimSpace(parts[1])); err != nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
				return
			}
			c.Next()
		}
	}
}
