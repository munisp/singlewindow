// Package opensearch provides an OpenSearch index provisioner and query helper
// shared across all TradeGateway Go microservices.
//
// Features:
//   - Idempotent index template provisioning on service startup
//   - ILM policy creation
//   - Ingest pipeline registration
//   - Typed document indexing with retry
//   - Search helper with pagination
//   - Health check
package opensearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Configuration ────────────────────────────────────────────────────────────

// Config holds OpenSearch connection parameters.
type Config struct {
	Addresses []string // OPENSEARCH_ADDRS (comma-separated, default: http://localhost:9200)
	Username  string   // OPENSEARCH_USER (default: admin)
	Password  string   // OPENSEARCH_PASSWORD
	TLSEnabled bool    // OPENSEARCH_TLS_ENABLED
}

// ConfigFromEnv loads OpenSearch config from environment variables.
func ConfigFromEnv() Config {
	addrs := os.Getenv("OPENSEARCH_ADDRS")
	if addrs == "" {
		addrs = "http://localhost:9200"
	}
	user := os.Getenv("OPENSEARCH_USER")
	if user == "" {
		user = "admin"
	}
	return Config{
		Addresses:  strings.Split(addrs, ","),
		Username:   user,
		Password:   os.Getenv("OPENSEARCH_PASSWORD"),
		TLSEnabled: os.Getenv("OPENSEARCH_TLS_ENABLED") == "true",
	}
}

// ─── Client ───────────────────────────────────────────────────────────────────

// Client wraps an HTTP client for OpenSearch REST API calls.
type Client struct {
	cfg    Config
	http   *http.Client
	logger *slog.Logger
}

// NewClient creates a new OpenSearch client.
func NewClient(cfg Config) *Client {
	return &Client{
		cfg:    cfg,
		http:   &http.Client{Timeout: 30 * time.Second},
		logger: slog.Default().With("component", "opensearch"),
	}
}

// HealthCheck returns nil if OpenSearch is reachable.
func (c *Client) HealthCheck(ctx context.Context) error {
	resp, err := c.do(ctx, "GET", "/_cluster/health", nil)
	if err != nil {
		return fmt.Errorf("opensearch: health check: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("opensearch: health check: status %d", resp.StatusCode)
	}
	return nil
}

// ─── Index Template Provisioner ───────────────────────────────────────────────

// IndexTemplate defines an OpenSearch index template.
type IndexTemplate struct {
	Name string
	Body map[string]any
}

// ILMPolicy defines an ILM lifecycle policy.
type ILMPolicy struct {
	Name string
	Body map[string]any
}

// IngestPipeline defines an ingest pipeline.
type IngestPipeline struct {
	Name string
	Body map[string]any
}

// ProvisionAll creates all index templates, ILM policies, and ingest pipelines.
// Idempotent — safe to call on every service startup.
func (c *Client) ProvisionAll(ctx context.Context) error {
	if err := c.provisionILMPolicies(ctx); err != nil {
		c.logger.WarnContext(ctx, "ILM policy provisioning failed (non-fatal)", "error", err)
	}
	if err := c.provisionIndexTemplates(ctx); err != nil {
		return fmt.Errorf("opensearch: ProvisionAll: templates: %w", err)
	}
	if err := c.provisionIngestPipelines(ctx); err != nil {
		c.logger.WarnContext(ctx, "ingest pipeline provisioning failed (non-fatal)", "error", err)
	}
	c.logger.InfoContext(ctx, "OpenSearch provisioning complete")
	return nil
}

func (c *Client) provisionILMPolicies(ctx context.Context) error {
	policies := defaultILMPolicies()
	for _, p := range policies {
		body, _ := json.Marshal(p.Body)
		resp, err := c.do(ctx, "PUT", "/_plugins/_ism/policies/"+p.Name, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("ILM policy %s: %w", p.Name, err)
		}
		resp.Body.Close()
		c.logger.DebugContext(ctx, "ILM policy provisioned", "name", p.Name, "status", resp.StatusCode)
	}
	return nil
}

func (c *Client) provisionIndexTemplates(ctx context.Context) error {
	templates := defaultIndexTemplates()
	for _, t := range templates {
		body, _ := json.Marshal(t.Body)
		resp, err := c.do(ctx, "PUT", "/_index_template/"+t.Name, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("index template %s: %w", t.Name, err)
		}
		resp.Body.Close()
		c.logger.InfoContext(ctx, "index template provisioned", "name", t.Name, "status", resp.StatusCode)
	}
	return nil
}

func (c *Client) provisionIngestPipelines(ctx context.Context) error {
	pipelines := defaultIngestPipelines()
	for _, p := range pipelines {
		body, _ := json.Marshal(p.Body)
		resp, err := c.do(ctx, "PUT", "/_ingest/pipeline/"+p.Name, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("ingest pipeline %s: %w", p.Name, err)
		}
		resp.Body.Close()
		c.logger.DebugContext(ctx, "ingest pipeline provisioned", "name", p.Name, "status", resp.StatusCode)
	}
	return nil
}

// ─── Document Operations ──────────────────────────────────────────────────────

// IndexDocument indexes a document into the given index with retry.
func (c *Client) IndexDocument(ctx context.Context, index, docID string, doc any) error {
	body, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("opensearch: IndexDocument: marshal: %w", err)
	}

	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		resp, err := c.do(ctx, "PUT", fmt.Sprintf("/%s/_doc/%s", index, docID), bytes.NewReader(body))
		if err != nil {
			lastErr = err
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			respBody, _ := io.ReadAll(resp.Body)
			lastErr = fmt.Errorf("opensearch: IndexDocument: status %d: %s", resp.StatusCode, string(respBody))
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}
		return nil
	}
	return lastErr
}

// SearchResult holds the raw OpenSearch search response.
type SearchResult struct {
	Total   int64            `json:"total"`
	Hits    []json.RawMessage `json:"hits"`
	ScrollID string          `json:"scroll_id,omitempty"`
}

// Search executes a search query and returns hits.
func (c *Client) Search(ctx context.Context, index string, query map[string]any, from, size int) (*SearchResult, error) {
	query["from"] = from
	query["size"] = size
	body, _ := json.Marshal(query)

	resp, err := c.do(ctx, "POST", fmt.Sprintf("/%s/_search", index), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("opensearch: Search: %w", err)
	}
	defer resp.Body.Close()

	var raw struct {
		Hits struct {
			Total struct {
				Value int64 `json:"value"`
			} `json:"total"`
			Hits []struct {
				Source json.RawMessage `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("opensearch: Search: decode: %w", err)
	}

	result := &SearchResult{Total: raw.Hits.Total.Value}
	for _, h := range raw.Hits.Hits {
		result.Hits = append(result.Hits, h.Source)
	}
	return result, nil
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

func (c *Client) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	url := c.cfg.Addresses[0] + path
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.Username != "" {
		req.SetBasicAuth(c.cfg.Username, c.cfg.Password)
	}
	return c.http.Do(req)
}

// ─── Default Templates ────────────────────────────────────────────────────────

func defaultILMPolicies() []ILMPolicy {
	return []ILMPolicy{
		{
			Name: "tradegateway-hot-warm",
			Body: map[string]any{
				"policy": map[string]any{
					"description": "Hot-warm-cold-delete for TradeGateway operational indices",
					"default_state": "hot",
					"states": []map[string]any{
						{
							"name": "hot",
							"actions": []map[string]any{
								{"rollover": map[string]any{"min_index_age": "7d", "min_size": "50gb"}},
							},
							"transitions": []map[string]any{
								{"state_name": "warm", "conditions": map[string]any{"min_index_age": "30d"}},
							},
						},
						{
							"name": "warm",
							"actions": []map[string]any{
								{"force_merge": map[string]any{"max_num_segments": 1}},
								{"shrink": map[string]any{"num_shards": 1}},
							},
							"transitions": []map[string]any{
								{"state_name": "cold", "conditions": map[string]any{"min_index_age": "90d"}},
							},
						},
						{
							"name": "cold",
							"actions": []map[string]any{},
							"transitions": []map[string]any{
								{"state_name": "delete", "conditions": map[string]any{"min_index_age": "365d"}},
							},
						},
						{
							"name":    "delete",
							"actions": []map[string]any{{"delete": map[string]any{}}},
						},
					},
				},
			},
		},
		{
			Name: "tradegateway-audit-retention",
			Body: map[string]any{
				"policy": map[string]any{
					"description": "7-year audit retention for regulatory compliance",
					"default_state": "hot",
					"states": []map[string]any{
						{
							"name": "hot",
							"actions": []map[string]any{
								{"rollover": map[string]any{"min_index_age": "30d", "min_size": "20gb"}},
							},
							"transitions": []map[string]any{
								{"state_name": "warm", "conditions": map[string]any{"min_index_age": "90d"}},
							},
						},
						{
							"name": "warm",
							"actions": []map[string]any{
								{"force_merge": map[string]any{"max_num_segments": 1}},
							},
							"transitions": []map[string]any{
								{"state_name": "delete", "conditions": map[string]any{"min_index_age": "2555d"}},
							},
						},
						{
							"name":    "delete",
							"actions": []map[string]any{{"delete": map[string]any{}}},
						},
					},
				},
			},
		},
	}
}

func defaultIndexTemplates() []IndexTemplate {
	return []IndexTemplate{
		{
			Name: "tradegateway-declarations",
			Body: map[string]any{
				"index_patterns": []string{"declarations-*"},
				"priority":       100,
				"template": map[string]any{
					"settings": map[string]any{
						"number_of_shards":   3,
						"number_of_replicas": 1,
						"refresh_interval":   "5s",
					},
					"mappings": map[string]any{
						"dynamic": "strict",
						"properties": map[string]any{
							"declaration_id":  map[string]any{"type": "keyword"},
							"ucr":             map[string]any{"type": "keyword"},
							"trader_id":       map[string]any{"type": "keyword"},
							"trader_name":     map[string]any{"type": "text", "fields": map[string]any{"keyword": map[string]any{"type": "keyword"}}},
							"hs_code":         map[string]any{"type": "keyword"},
							"description":     map[string]any{"type": "text", "analyzer": "english"},
							"origin_country":  map[string]any{"type": "keyword"},
							"declared_value":  map[string]any{"type": "double"},
							"currency":        map[string]any{"type": "keyword"},
							"status":          map[string]any{"type": "keyword"},
							"risk_lane":       map[string]any{"type": "keyword"},
							"risk_score":      map[string]any{"type": "float"},
							"submitted_at":    map[string]any{"type": "date", "format": "epoch_millis||strict_date_optional_time"},
							"cleared_at":      map[string]any{"type": "date", "format": "epoch_millis||strict_date_optional_time"},
							"duties_amount":   map[string]any{"type": "double"},
							"payment_status":  map[string]any{"type": "keyword"},
							"geo_location":    map[string]any{"type": "geo_point"},
						},
					},
				},
			},
		},
		{
			Name: "tradegateway-audit-events",
			Body: map[string]any{
				"index_patterns": []string{"tradegateway-audit-events*"},
				"priority":       100,
				"template": map[string]any{
					"settings": map[string]any{
						"number_of_shards":   3,
						"number_of_replicas": 1,
						"refresh_interval":   "1s",
					},
					"mappings": map[string]any{
						"dynamic": "strict",
						"properties": map[string]any{
							"event_id":      map[string]any{"type": "keyword"},
							"event_type":    map[string]any{"type": "keyword"},
							"actor_id":      map[string]any{"type": "keyword"},
							"actor_role":    map[string]any{"type": "keyword"},
							"resource_type": map[string]any{"type": "keyword"},
							"resource_id":   map[string]any{"type": "keyword"},
							"action":        map[string]any{"type": "keyword"},
							"outcome":       map[string]any{"type": "keyword"},
							"ip_address":    map[string]any{"type": "ip"},
							"session_id":    map[string]any{"type": "keyword"},
							"timestamp":     map[string]any{"type": "date", "format": "epoch_millis||strict_date_optional_time"},
							"chain_hash":    map[string]any{"type": "keyword"},
							"anomaly_score": map[string]any{"type": "float"},
							"service_name":  map[string]any{"type": "keyword"},
							"trace_id":      map[string]any{"type": "keyword"},
						},
					},
				},
			},
		},
		{
			Name: "tradegateway-cargo-tracking",
			Body: map[string]any{
				"index_patterns": []string{"cargo-tracking-*"},
				"priority":       100,
				"template": map[string]any{
					"settings": map[string]any{
						"number_of_shards":   2,
						"number_of_replicas": 1,
						"refresh_interval":   "10s",
					},
					"mappings": map[string]any{
						"dynamic": "strict",
						"properties": map[string]any{
							"tracking_id":  map[string]any{"type": "keyword"},
							"ucr":          map[string]any{"type": "keyword"},
							"container_id": map[string]any{"type": "keyword"},
							"vessel_name":  map[string]any{"type": "keyword"},
							"status":       map[string]any{"type": "keyword"},
							"location":     map[string]any{"type": "geo_point"},
							"port_code":    map[string]any{"type": "keyword"},
							"eta":          map[string]any{"type": "date", "format": "epoch_millis||strict_date_optional_time"},
							"updated_at":   map[string]any{"type": "date", "format": "epoch_millis||strict_date_optional_time"},
						},
					},
				},
			},
		},
	}
}

func defaultIngestPipelines() []IngestPipeline {
	return []IngestPipeline{
		{
			Name: "tradegateway-declaration-enrich",
			Body: map[string]any{
				"description": "Enrich declaration documents with risk lane classification",
				"processors": []map[string]any{
					{
						"script": map[string]any{
							"lang":   "painless",
							"source": "if (ctx.risk_score == null) { ctx.risk_score = 0.0; } if (ctx.risk_score > 0.7) { ctx.risk_lane = 'RED'; } else if (ctx.risk_score > 0.4) { ctx.risk_lane = 'YELLOW'; } else { ctx.risk_lane = 'GREEN'; }",
						},
					},
				},
			},
		},
	}
}
