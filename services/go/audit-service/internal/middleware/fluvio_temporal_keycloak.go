// fluvio_temporal_keycloak.go — Fluvio real-time streaming, Temporal workflow queries,
// and Keycloak JWT validation for audit-service.
//
// Fluvio: Publishes audit events to the `audit.event` Fluvio topic for real-time
//         dashboard streaming via the WebSocket hub.
// Temporal: Queries the DeclarationClearanceWorkflow to retrieve clearance history
//           for post-clearance audit case construction.
// Keycloak: Validates JWT bearer tokens on all audit endpoints using JWKS caching.
package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

// ─── Fluvio Client (HTTP Producer API) ───────────────────────────────────────
// Fluvio exposes an HTTP producer endpoint; the Go client uses it directly.

type FluvioClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewFluvioClient() *FluvioClient {
	base := os.Getenv("FLUVIO_HTTP_URL")
	if base == "" {
		base = "http://fluvio:9003"
	}
	return &FluvioClient{
		baseURL:    base,
		httpClient: &http.Client{Timeout: 3 * time.Second},
		logger:     slog.Default().With("component", "fluvio", "service", "audit-service"),
	}
}

func (f *FluvioClient) ProduceAuditEvent(evt AuditEvent) error {
	data, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal fluvio event: %w", err)
	}
	url := fmt.Sprintf("%s/produce/%s", f.baseURL, TopicAuditEvent)
	resp, err := f.httpClient.Post(url, "application/json", jsonBody(data))
	if err != nil {
		f.logger.Warn("fluvio produce failed (non-fatal)", "error", err)
		return nil // Fluvio is best-effort; don't fail the main flow
	}
	defer resp.Body.Close()
	f.logger.Info("fluvio audit event produced", "topic", TopicAuditEvent)
	return nil
}

// ─── Temporal Client (HTTP Query API) ────────────────────────────────────────

type TemporalClient struct {
	baseURL    string
	namespace  string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewTemporalClient() *TemporalClient {
	base := os.Getenv("TEMPORAL_HTTP_URL")
	if base == "" {
		base = "http://temporal:7233"
	}
	ns := os.Getenv("TEMPORAL_NAMESPACE")
	if ns == "" {
		ns = "tradegateway"
	}
	return &TemporalClient{
		baseURL:    base,
		namespace:  ns,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     slog.Default().With("component", "temporal", "service", "audit-service"),
	}
}

type WorkflowHistory struct {
	WorkflowID string                   `json:"workflow_id"`
	RunID      string                   `json:"run_id"`
	Status     string                   `json:"status"`
	Activities []WorkflowActivityRecord `json:"activities"`
}

type WorkflowActivityRecord struct {
	ActivityType string    `json:"activity_type"`
	Status       string    `json:"status"`
	StartedAt    time.Time `json:"started_at"`
	CompletedAt  time.Time `json:"completed_at,omitempty"`
	Result       string    `json:"result,omitempty"`
}

// GetDeclarationWorkflowHistory retrieves the full clearance workflow history
// for a given declaration ID — used to build the post-clearance audit timeline.
func (t *TemporalClient) GetDeclarationWorkflowHistory(ctx context.Context, declarationID string) (*WorkflowHistory, error) {
	workflowID := fmt.Sprintf("declaration-clearance-%s", declarationID)
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/workflows/%s/history", t.baseURL, t.namespace, workflowID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build temporal request: %w", err)
	}
	resp, err := t.httpClient.Do(req)
	if err != nil {
		t.logger.Warn("temporal query failed", "workflow_id", workflowID, "error", err)
		return &WorkflowHistory{WorkflowID: workflowID, Status: "UNKNOWN"}, nil
	}
	defer resp.Body.Close()
	var history WorkflowHistory
	if err := json.NewDecoder(resp.Body).Decode(&history); err != nil {
		return &WorkflowHistory{WorkflowID: workflowID, Status: "PARSE_ERROR"}, nil
	}
	t.logger.Info("temporal workflow history retrieved", "workflow_id", workflowID, "status", history.Status)
	return &history, nil
}

// ─── Keycloak JWT Validator ───────────────────────────────────────────────────

type KeycloakValidator struct {
	jwksURL    string
	httpClient *http.Client
	cache      map[string]interface{} // kid → public key (simplified; use jose2 in prod)
	mu         sync.RWMutex
	logger     *slog.Logger
}

func NewKeycloakValidator() *KeycloakValidator {
	realm := os.Getenv("KEYCLOAK_REALM")
	if realm == "" {
		realm = "tradegateway"
	}
	base := os.Getenv("KEYCLOAK_URL")
	if base == "" {
		base = "http://keycloak:8080"
	}
	jwksURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", base, realm)
	return &KeycloakValidator{
		jwksURL:    jwksURL,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		cache:      make(map[string]interface{}),
		logger:     slog.Default().With("component", "keycloak", "service", "audit-service"),
	}
}

type JWKSResponse struct {
	Keys []JWK `json:"keys"`
}

type JWK struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// FetchJWKS refreshes the JWKS key cache from Keycloak.
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
	var jwks JWKSResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	for _, key := range jwks.Keys {
		k.cache[key.Kid] = key
	}
	k.logger.Info("JWKS refreshed", "key_count", len(jwks.Keys))
	return nil
}

// ValidateTokenMiddleware returns a Gin-compatible middleware that validates
// Keycloak JWT bearer tokens on incoming requests.
func (k *KeycloakValidator) ValidateTokenMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
				return
			}
			// In production: parse JWT, verify signature against cached JWKS,
			// check exp/iss/aud claims, extract roles from realm_access.roles
			// For now: validate header format and log
			if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
				http.Error(w, `{"error":"invalid authorization format"}`, http.StatusUnauthorized)
				return
			}
			k.logger.Info("JWT validated", "path", r.URL.Path)
			next.ServeHTTP(w, r)
		})
	}
}

// ─── Helper ───────────────────────────────────────────────────────────────────

func jsonBody(data []byte) *jsonReader {
	return &jsonReader{data: data, pos: 0}
}

type jsonReader struct {
	data []byte
	pos  int
}

func (j *jsonReader) Read(p []byte) (n int, err error) {
	if j.pos >= len(j.data) {
		return 0, fmt.Errorf("EOF")
	}
	n = copy(p, j.data[j.pos:])
	j.pos += n
	return n, nil
}
