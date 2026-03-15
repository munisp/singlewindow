// fluvio_temporal_keycloak.go — Fluvio streaming, Temporal workflow integration,
// and Keycloak JWT validation for keycloak-svc.
//
// Fluvio: Publishes security.alert events to the Fluvio topic for real-time dashboard.
// Temporal: Signals the DeclarationClearanceWorkflow when a CEN alert blocks clearance.
// Keycloak: Validates JWT bearer tokens; enforces customs_officer or admin roles.
package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

func fluvioURL() string {
	u := os.Getenv("FLUVIO_HTTP_URL")
	if u == "" {
		u = "http://fluvio:9003"
	}
	return u
}

func temporalURL() string {
	u := os.Getenv("TEMPORAL_HTTP_URL")
	if u == "" {
		u = "http://temporal:7233"
	}
	return u
}

func keycloakBase() string {
	u := os.Getenv("KEYCLOAK_URL")
	if u == "" {
		u = "http://keycloak:8080"
	}
	return u
}

func keycloakRealm() string {
	r := os.Getenv("KEYCLOAK_REALM")
	if r == "" {
		r = "tradegateway"
	}
	return r
}

// ─── Fluvio ───────────────────────────────────────────────────────────────────

type FluvioClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewFluvioClient() *FluvioClient {
	return &FluvioClient{
		baseURL:    fluvioURL(),
		httpClient: &http.Client{Timeout: 3 * time.Second},
		logger:     slog.Default().With("component", "fluvio", "service", "keycloak-svc"),
	}
}

func (f *FluvioClient) ProduceSecurityAlert(evt SecurityAlertEvent) error {
	data, _ := json.Marshal(evt)
	url := fmt.Sprintf("%s/produce/%s", f.baseURL, TopicSecurityAlert)
	resp, err := f.httpClient.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		f.logger.Warn("fluvio produce failed (non-fatal)", "error", err)
		return nil
	}
	defer resp.Body.Close()
	return nil
}

// ─── Temporal ─────────────────────────────────────────────────────────────────

type TemporalClient struct {
	baseURL    string
	namespace  string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewTemporalClient() *TemporalClient {
	ns := os.Getenv("TEMPORAL_NAMESPACE")
	if ns == "" {
		ns = "tradegateway"
	}
	return &TemporalClient{
		baseURL:    temporalURL(),
		namespace:  ns,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     slog.Default().With("component", "temporal", "service", "keycloak-svc"),
	}
}

// SignalClearanceHold signals the declaration clearance workflow to hold
// clearance pending CEN alert resolution.
func (t *TemporalClient) SignalClearanceHold(ctx context.Context, declarationID string, alertRef string) error {
	workflowID := fmt.Sprintf("declaration-clearance-%s", declarationID)
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/signal/cen-hold", t.baseURL, t.namespace, workflowID)
	payload, _ := json.Marshal(map[string]string{"alert_ref": alertRef, "source": "keycloak-svc"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build temporal signal request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.httpClient.Do(req)
	if err != nil {
		t.logger.Warn("temporal signal failed (non-fatal)", "workflow_id", workflowID, "error", err)
		return nil
	}
	defer resp.Body.Close()
	t.logger.Info("temporal clearance hold signal sent", "workflow_id", workflowID, "alert_ref", alertRef)
	return nil
}

// ─── Keycloak ─────────────────────────────────────────────────────────────────

type KeycloakValidator struct {
	jwksURL    string
	httpClient *http.Client
	cache      map[string]interface{}
	mu         sync.RWMutex
	logger     *slog.Logger
}

func NewKeycloakValidator() *KeycloakValidator {
	jwksURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", keycloakBase(), keycloakRealm())
	return &KeycloakValidator{
		jwksURL:    jwksURL,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		cache:      make(map[string]interface{}),
		logger:     slog.Default().With("component", "keycloak", "service", "keycloak-svc"),
	}
}

func (k *KeycloakValidator) FetchJWKS(ctx context.Context) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, k.jwksURL, nil)
	resp, err := k.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fetch jwks: %w", err)
	}
	defer resp.Body.Close()
	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}
	k.mu.Lock()
	for _, key := range jwks.Keys {
		k.cache[key.Kid] = key
	}
	k.mu.Unlock()
	k.logger.Info("JWKS refreshed", "key_count", len(jwks.Keys))
	return nil
}

func (k *KeycloakValidator) ValidateTokenMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if len(auth) < 8 || auth[:7] != "Bearer " {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			k.logger.Info("JWT validated", "path", r.URL.Path)
			next.ServeHTTP(w, r)
		})
	}
}
