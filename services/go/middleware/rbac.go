// TradeGateway NGSWTP — Go RBAC Enforcement Middleware
// Language: Go 1.22+
// Role: HTTP middleware that calls Permify's check API before forwarding requests.
//       Returns 403 on denial and publishes authz_denied events to Kafka,
//       which triggers Rule R010 in the anomaly detection service.
//
// Integration:
//   - Permify gRPC/HTTP API: https://permify.co/docs/api/check
//   - Kafka topic: insider-threat.alerts (via authz_denied events)
//   - Wired into APISIX as a plugin or used directly in Go services
//
// Usage:
//   mux.Use(rbac.NewMiddleware(rbac.Config{
//       PermifyURL:   "http://permify:3476",
//       TenantID:     "tradegateway",
//       KafkaBrokers: []string{"kafka:9092"},
//   }))

package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Configuration ────────────────────────────────────────────────────────────

// Config holds the RBAC middleware configuration.
type Config struct {
	// PermifyURL is the base URL of the Permify HTTP API (e.g. http://permify:3476).
	PermifyURL string
	// TenantID is the Permify tenant identifier.
	TenantID string
	// KafkaBrokers is the list of Kafka broker addresses for authz_denied events.
	KafkaBrokers []string
	// SkipPaths is a list of path prefixes that bypass RBAC (e.g. /health, /metrics).
	SkipPaths []string
	// HTTPClient is the HTTP client used for Permify calls (injectable for testing).
	HTTPClient HTTPDoer
	// KafkaPublisher is the Kafka publisher for authz_denied events (injectable for testing).
	KafkaPublisher KafkaPublisher
	// Logger is the logger for RBAC events.
	Logger *log.Logger
}

// DefaultConfig returns a Config populated from environment variables.
func DefaultConfig() Config {
	return Config{
		PermifyURL:   getEnv("PERMIFY_URL", "http://permify:3476"),
		TenantID:     getEnv("PERMIFY_TENANT_ID", "tradegateway"),
		KafkaBrokers: strings.Split(getEnv("KAFKA_BROKERS", "kafka:9092"), ","),
		SkipPaths:    []string{"/health", "/live", "/ready", "/metrics"},
		Logger:       log.New(os.Stdout, "[RBAC] ", log.LstdFlags),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Interfaces (injectable for testing) ─────────────────────────────────────

// HTTPDoer is a minimal interface for making HTTP requests.
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// KafkaPublisher publishes messages to a Kafka topic.
type KafkaPublisher interface {
	Publish(ctx context.Context, topic string, value []byte) error
}

// ─── Permify API types ────────────────────────────────────────────────────────

// PermifyCheckRequest is the payload for POST /v1/tenants/{tenant}/permissions/check.
type PermifyCheckRequest struct {
	Metadata   PermifyCheckMetadata `json:"metadata"`
	Entity     PermifyEntity        `json:"entity"`
	Permission string               `json:"permission"`
	Subject    PermifySubject       `json:"subject"`
}

type PermifyCheckMetadata struct {
	SchemaVersion string `json:"schema_version,omitempty"`
	SnapToken     string `json:"snap_token,omitempty"`
	Depth         int    `json:"depth"`
}

type PermifyEntity struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type PermifySubject struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	Relation string `json:"relation,omitempty"`
}

// PermifyCheckResponse is the response from the Permify check API.
type PermifyCheckResponse struct {
	Can      string `json:"can"` // "RESULT_ALLOWED" | "RESULT_DENIED"
	Metadata struct {
		CheckCount int `json:"check_count"`
	} `json:"metadata"`
}

// ─── Kafka authz_denied event ─────────────────────────────────────────────────

// AuthzDeniedEvent is published to Kafka when a permission check is denied.
type AuthzDeniedEvent struct {
	EventType  string `json:"event_type"`  // "authz_denied"
	UserID     string `json:"user_id"`
	SessionID  string `json:"session_id"`
	Action     string `json:"action"`      // "authz_denied" (triggers Rule R010)
	Endpoint   string `json:"endpoint"`
	IPAddress  string `json:"ip_address"`
	Permission string `json:"permission"`
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id"`
	Timestamp  int64  `json:"timestamp"`
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// RBACMiddleware enforces Permify RBAC on every incoming HTTP request.
type RBACMiddleware struct {
	cfg    Config
	client HTTPDoer
	kafka  KafkaPublisher
	logger *log.Logger
}

// NewMiddleware creates a new RBACMiddleware with the given configuration.
func NewMiddleware(cfg Config) *RBACMiddleware {
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 5 * time.Second}
	}
	if cfg.Logger == nil {
		cfg.Logger = log.New(os.Stdout, "[RBAC] ", log.LstdFlags)
	}
	return &RBACMiddleware{
		cfg:    cfg,
		client: cfg.HTTPClient,
		kafka:  cfg.KafkaPublisher,
		logger: cfg.Logger,
	}
}

// Handler returns an http.Handler that wraps the next handler with RBAC enforcement.
func (m *RBACMiddleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip RBAC for configured paths
		for _, skip := range m.cfg.SkipPaths {
			if strings.HasPrefix(r.URL.Path, skip) {
				next.ServeHTTP(w, r)
				return
			}
		}

		userID := extractUserID(r)
		sessionID := extractSessionID(r)
		permission := pathToPermission(r.Method, r.URL.Path)
		entityType, entityID := pathToEntity(r.URL.Path)

		allowed, err := m.checkPermify(r.Context(), userID, permission, entityType, entityID)
		if err != nil {
			// On Permify error, fail open (log and allow) to avoid blocking legitimate traffic.
			// In high-security mode, change to fail closed (403).
			m.logger.Printf("WARN: Permify check error for user=%s permission=%s: %v — failing open", userID, permission, err)
			next.ServeHTTP(w, r)
			return
		}

		if !allowed {
			m.logger.Printf("DENIED: user=%s permission=%s entity=%s/%s ip=%s",
				userID, permission, entityType, entityID, r.RemoteAddr)

			// Publish authz_denied event to Kafka (triggers Rule R010 in anomaly detection)
			m.publishDenied(r.Context(), userID, sessionID, permission, entityType, entityID, r)

			http.Error(w, `{"error":"forbidden","code":"RBAC_DENIED"}`, http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// checkPermify calls the Permify check API and returns true if the user is allowed.
func (m *RBACMiddleware) checkPermify(
	ctx context.Context,
	userID, permission, entityType, entityID string,
) (bool, error) {
	if userID == "" {
		return false, nil // No user ID — deny
	}

	reqBody := PermifyCheckRequest{
		Metadata: PermifyCheckMetadata{Depth: 20},
		Entity:   PermifyEntity{Type: entityType, ID: entityID},
		Permission: permission,
		Subject:  PermifySubject{Type: "user", ID: userID},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return false, fmt.Errorf("marshal permify request: %w", err)
	}

	url := fmt.Sprintf("%s/v1/tenants/%s/permissions/check", m.cfg.PermifyURL, m.cfg.TenantID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return false, fmt.Errorf("create permify request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := m.client.Do(httpReq)
	if err != nil {
		return false, fmt.Errorf("permify HTTP call: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("permify returned status %d", resp.StatusCode)
	}

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("read permify response: %w", err)
	}

	var checkResp PermifyCheckResponse
	if err := json.Unmarshal(respBytes, &checkResp); err != nil {
		return false, fmt.Errorf("unmarshal permify response: %w", err)
	}

	return checkResp.Can == "RESULT_ALLOWED", nil
}

// publishDenied publishes an authz_denied event to Kafka.
func (m *RBACMiddleware) publishDenied(
	ctx context.Context,
	userID, sessionID, permission, entityType, entityID string,
	r *http.Request,
) {
	if m.kafka == nil {
		return
	}

	event := AuthzDeniedEvent{
		EventType:  "authz_denied",
		UserID:     userID,
		SessionID:  sessionID,
		Action:     "authz_denied", // matches anomaly detection Rule R010
		Endpoint:   r.URL.Path,
		IPAddress:  r.RemoteAddr,
		Permission: permission,
		EntityType: entityType,
		EntityID:   entityID,
		Timestamp:  time.Now().UnixMilli(),
	}

	payload, err := json.Marshal(event)
	if err != nil {
		m.logger.Printf("ERROR: failed to marshal authz_denied event: %v", err)
		return
	}

	if err := m.kafka.Publish(ctx, "insider-threat.alerts", payload); err != nil {
		m.logger.Printf("ERROR: failed to publish authz_denied to Kafka: %v", err)
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// extractUserID extracts the user ID from the request context or headers.
// In production, this is set by the Keycloak JWT verification middleware upstream.
func extractUserID(r *http.Request) string {
	// Check X-User-ID header (set by APISIX after JWT verification)
	if uid := r.Header.Get("X-User-ID"); uid != "" {
		return uid
	}
	// Check X-Forwarded-User header (set by some OAuth proxies)
	if uid := r.Header.Get("X-Forwarded-User"); uid != "" {
		return uid
	}
	return ""
}

// extractSessionID extracts the session ID from the request headers.
func extractSessionID(r *http.Request) string {
	if sid := r.Header.Get("X-Session-ID"); sid != "" {
		return sid
	}
	return ""
}

// pathToPermission maps HTTP method + path to a Permify permission name.
// This follows the TradeGateway Permify schema conventions.
func pathToPermission(method, path string) string {
	switch method {
	case http.MethodGet:
		return "view"
	case http.MethodPost:
		return "create"
	case http.MethodPut, http.MethodPatch:
		return "edit"
	case http.MethodDelete:
		return "delete"
	}
	// For special paths, map to specific permissions
	if strings.Contains(path, "/admin/") {
		return "admin"
	}
	if strings.Contains(path, "/approve") {
		return "approve"
	}
	if strings.Contains(path, "/seed") {
		return "admin"
	}
	return "view"
}

// pathToEntity maps a URL path to a Permify entity type and ID.
func pathToEntity(path string) (entityType, entityID string) {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) == 0 {
		return "platform", "tradegateway"
	}
	switch parts[0] {
	case "declarations":
		if len(parts) > 1 {
			return "declaration", parts[1]
		}
		return "declaration", "*"
	case "payments":
		if len(parts) > 1 {
			return "payment", parts[1]
		}
		return "payment", "*"
	case "bonds":
		if len(parts) > 1 {
			return "bond", parts[1]
		}
		return "bond", "*"
	case "admin":
		return "platform", "admin"
	case "seed":
		return "platform", "seed"
	default:
		return "platform", "tradegateway"
	}
}
