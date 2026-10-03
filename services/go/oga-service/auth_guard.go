// auth_guard.go — Phase 26 F1: mount fail-closed Keycloak JWT authentication.
//
// The Keycloak RS256/JWKS validator (internal/middleware/keycloak_validator.go)
// previously existed in this service but was NEVER mounted — dead code: every
// route accepted unauthenticated requests. This guard mounts it on ALL routes
// except the probe/metrics endpoints, which must stay open for kubelet and
// Prometheus:
//
//	exempt: /health /healthz /ready /readyz /livez /metrics /admin/metrics

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

	svcauth "tradegateway/oga-service/internal/middleware"
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

// wrapWithAuth mounts fail-closed authentication around the service handler.
func wrapWithAuth(next http.Handler) http.Handler {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_MODE"))) {
	case "edge":
		log.Printf("[auth] AUTH_MODE=edge — trusting APISIX edge-injected identity headers (X-User); requests without one are rejected")
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if authPathExempt(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			if strings.TrimSpace(r.Header.Get("X-User")) == "" &&
				strings.TrimSpace(r.Header.Get("X-User-ID")) == "" &&
				strings.TrimSpace(r.Header.Get("X-Consumer-Username")) == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	default:
		if !keycloakConfigured() {
			log.Printf("[auth] FAIL-CLOSED: no Keycloak configuration (KEYCLOAK_JWKS_URL/KEYCLOAK_URL/KEYCLOAK_ISSUER) — protected routes return 503 auth not configured")
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if authPathExempt(r.URL.Path) {
					next.ServeHTTP(w, r)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"error":"auth not configured"}`))
			})
		}
		validator := svcauth.NewKeycloakValidator()
		protected := validator.ValidateTokenMiddleware()(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if authPathExempt(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			protected.ServeHTTP(w, r)
		})
	}
}
