// permify_redis_apisix.go — Permify fine-grained authorization, Redis caching,
// and APISIX admin API integration for audit-service.
//
// Permify: Enforces ReBAC permissions on audit resources.
//          Checks: can user X perform action Y on audit_record Z?
// Redis:   Caches audit case summaries, risk score lookups, and JWKS keys.
//          TTL-based invalidation on case status changes.
// APISIX:  Registers audit-service routes via APISIX Admin API on startup.
//          Route: /api/v1/audit/* → audit-service:8090
package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"
)

// ─── Permify Client ───────────────────────────────────────────────────────────

type PermifyClient struct {
	baseURL    string
	tenantID   string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewPermifyClient() *PermifyClient {
	base := os.Getenv("PERMIFY_URL")
	if base == "" {
		base = "http://permify:3476"
	}
	tenant := os.Getenv("PERMIFY_TENANT_ID")
	if tenant == "" {
		tenant = "t1"
	}
	return &PermifyClient{
		baseURL:    base,
		tenantID:   tenant,
		httpClient: &http.Client{Timeout: 2 * time.Second},
		logger:     slog.Default().With("component", "permify", "service", "audit-service"),
	}
}

type PermifyCheckRequest struct {
	Metadata   PermifyMetadata   `json:"metadata"`
	Entity     PermifyEntity     `json:"entity"`
	Permission string            `json:"permission"`
	Subject    PermifySubject    `json:"subject"`
}

type PermifyMetadata struct {
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

type PermifyCheckResponse struct {
	Can     string `json:"can"` // "RESULT_ALLOWED" or "RESULT_DENIED"
	Metadata struct {
		CheckCount int `json:"check_count"`
	} `json:"metadata"`
}

// CheckAuditPermission checks if a user can perform an action on an audit record.
// Actions: view, create, update, close
func (p *PermifyClient) CheckAuditPermission(ctx context.Context, userID, auditCaseID, action string) (bool, error) {
	req := PermifyCheckRequest{
		Metadata:   PermifyMetadata{Depth: 20},
		Entity:     PermifyEntity{Type: "audit_record", ID: auditCaseID},
		Permission: action,
		Subject:    PermifySubject{Type: "user", ID: userID},
	}
	data, _ := json.Marshal(req)
	url := fmt.Sprintf("%s/v1/tenants/%s/permissions/check", p.baseURL, p.tenantID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return false, fmt.Errorf("build permify request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		p.logger.Warn("permify check failed (fail-open)", "error", err)
		return true, nil // fail-open for availability; adjust to fail-closed for high-security
	}
	defer resp.Body.Close()
	var result PermifyCheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("decode permify response: %w", err)
	}
	allowed := result.Can == "RESULT_ALLOWED"
	p.logger.Info("permify check", "user", userID, "resource", auditCaseID, "action", action, "allowed", allowed)
	return allowed, nil
}

// WriteAuditRelationship writes a relationship tuple to Permify when a new audit case is created.
func (p *PermifyClient) WriteAuditRelationship(ctx context.Context, auditCaseID, officerID string) error {
	payload := map[string]interface{}{
		"metadata": map[string]string{"schema_version": ""},
		"tuples": []map[string]interface{}{
			{
				"entity":   map[string]string{"type": "audit_record", "id": auditCaseID},
				"relation": "customs_officer",
				"subject":  map[string]string{"type": "user", "id": officerID},
			},
		},
	}
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/v1/tenants/%s/relationships/write", p.baseURL, p.tenantID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		p.logger.Warn("permify write relationship failed", "error", err)
		return nil
	}
	defer resp.Body.Close()
	p.logger.Info("permify relationship written", "audit_case", auditCaseID, "officer", officerID)
	return nil
}

// ─── Redis Client ─────────────────────────────────────────────────────────────

type RedisClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewRedisClient() *RedisClient {
	// Use Redis HTTP proxy (Webdis) or direct TCP via go-redis in production.
	// Here we use a thin HTTP wrapper for portability; swap for go-redis in prod.
	base := os.Getenv("REDIS_HTTP_URL")
	if base == "" {
		base = "http://redis:7379" // Webdis default port
	}
	return &RedisClient{
		baseURL:    base,
		httpClient: &http.Client{Timeout: 1 * time.Second},
		logger:     slog.Default().With("component", "redis", "service", "audit-service"),
	}
}

// CacheAuditCase caches an audit case summary with a 5-minute TTL.
func (r *RedisClient) CacheAuditCase(ctx context.Context, caseID string, data interface{}) error {
	serialized, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal cache data: %w", err)
	}
	key := fmt.Sprintf("audit:case:%s", caseID)
	url := fmt.Sprintf("%s/SETEX/%s/300/%s", r.baseURL, key, string(serialized))
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := r.httpClient.Do(req)
	if err != nil {
		r.logger.Warn("redis cache set failed (non-fatal)", "key", key, "error", err)
		return nil
	}
	defer resp.Body.Close()
	return nil
}

// GetCachedAuditCase retrieves a cached audit case summary.
func (r *RedisClient) GetCachedAuditCase(ctx context.Context, caseID string) ([]byte, error) {
	key := fmt.Sprintf("audit:case:%s", caseID)
	url := fmt.Sprintf("%s/GET/%s", r.baseURL, key)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return nil, nil // cache miss
	}
	defer resp.Body.Close()
	var result struct {
		GET string `json:"GET"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, nil
	}
	return []byte(result.GET), nil
}

// InvalidateAuditCase removes a cached audit case on status change.
func (r *RedisClient) InvalidateAuditCase(ctx context.Context, caseID string) {
	key := fmt.Sprintf("audit:case:%s", caseID)
	url := fmt.Sprintf("%s/DEL/%s", r.baseURL, key)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := r.httpClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// ─── APISIX Route Registration ────────────────────────────────────────────────

type APISIXClient struct {
	adminURL   string
	adminKey   string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewAPISIXClient() *APISIXClient {
	adminURL := os.Getenv("APISIX_ADMIN_URL")
	if adminURL == "" {
		adminURL = "http://apisix:9180"
	}
	adminKey := os.Getenv("APISIX_ADMIN_KEY")
	if adminKey == "" {
		adminKey = "edd1c9f034335f136f87ad84b625c8f1"
	}
	return &APISIXClient{
		adminURL:   adminURL,
		adminKey:   adminKey,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		logger:     slog.Default().With("component", "apisix", "service", "audit-service"),
	}
}

// RegisterRoutes registers audit-service routes in APISIX on startup.
func (a *APISIXClient) RegisterRoutes(ctx context.Context, serviceHost string, servicePort int) error {
	routes := []map[string]interface{}{
		{
			"id":   "audit-service-api",
			"name": "audit-service",
			"uri":  "/api/v1/audit/*",
			"methods": []string{"GET", "POST", "PUT", "DELETE"},
			"upstream": map[string]interface{}{
				"type": "roundrobin",
				"nodes": map[string]int{
					fmt.Sprintf("%s:%d", serviceHost, servicePort): 1,
				},
			},
			"plugins": map[string]interface{}{
				"openid-connect": map[string]interface{}{
					"client_id":                  "tradegateway-api",
					"client_secret":              os.Getenv("KEYCLOAK_CLIENT_SECRET"),
					"discovery":                  fmt.Sprintf("%s/realms/%s/.well-known/openid-configuration", os.Getenv("KEYCLOAK_URL"), os.Getenv("KEYCLOAK_REALM")),
					"introspection_endpoint_auth_method": "client_secret_post",
					"bearer_only":                true,
					"realm":                      "tradegateway",
				},
				"prometheus": map[string]interface{}{},
				"response-rewrite": map[string]interface{}{
					"headers": map[string]string{
						"X-Service": "audit-service",
					},
				},
			},
		},
	}

	for _, route := range routes {
		data, _ := json.Marshal(route)
		url := fmt.Sprintf("%s/apisix/admin/routes/%s", a.adminURL, route["id"])
		req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(data))
		if err != nil {
			return fmt.Errorf("build apisix request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-API-KEY", a.adminKey)
		resp, err := a.httpClient.Do(req)
		if err != nil {
			a.logger.Warn("apisix route registration failed (non-fatal)", "route", route["id"], "error", err)
			continue
		}
		resp.Body.Close()
		a.logger.Info("apisix route registered", "route", route["id"], "uri", route["uri"])
	}
	return nil
}
