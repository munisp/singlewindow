// Package middleware provides shared middleware integrations for all TradeGateway™ Go services.
// Covers: Kafka, Dapr, Fluvio, Temporal, Keycloak, Permify, Redis, APISIX, TigerBeetle, Delta Lake.
package middleware

import (
"context"
"encoding/json"
"fmt"
"net/http"
"os"
"time"
)

// ─── Configuration ────────────────────────────────────────────────────────────

// Config holds all middleware connection parameters resolved from environment variables.
type Config struct {
// Kafka
KafkaBrokers    string
KafkaGroupID    string
KafkaClientID   string
// Dapr
DaprHTTPPort    string
DaprGRPCPort    string
DaprAppID       string
// Fluvio — P0 remediation: Fluvio is NOT deployed on this platform; Kafka is
// the real event bus. No default endpoint: empty means honestly disabled.
FluvioEndpoint  string
// Temporal
TemporalAddress  string
TemporalNamespace string
// Keycloak
KeycloakURL      string
KeycloakRealm    string
KeycloakClientID string
// Permify
PermifyEndpoint  string
// Redis
RedisAddr        string
RedisPassword    string
// APISIX
APISIXAdminURL   string
APISIXAdminKey   string
// TigerBeetle
TigerBeetleAddr  string
// Delta Lake / Lakehouse
LakehouseEndpoint string
LakehouseS3Bucket string
// OpenTelemetry
OTELEndpoint    string
ServiceName     string
ServiceVersion  string
}

// LoadConfig loads middleware configuration from environment variables.
func LoadConfig(serviceName string) *Config {
return &Config{
KafkaBrokers:      getEnv("KAFKA_BROKERS", "kafka:9092"),
KafkaGroupID:      getEnv("KAFKA_GROUP_ID", serviceName+"-group"),
KafkaClientID:     getEnv("KAFKA_CLIENT_ID", serviceName),
DaprHTTPPort:      getEnv("DAPR_HTTP_PORT", "3500"),
DaprGRPCPort:      getEnv("DAPR_GRPC_PORT", "50001"),
DaprAppID:         getEnv("DAPR_APP_ID", serviceName),
FluvioEndpoint:    getEnv("FLUVIO_ENDPOINT", ""),
TemporalAddress:   getEnv("TEMPORAL_ADDRESS", "temporal:7233"),
TemporalNamespace: getEnv("TEMPORAL_NAMESPACE", "tradegateway"),
KeycloakURL:       getEnv("KEYCLOAK_URL", "http://keycloak:8080"),
KeycloakRealm:     getEnv("KEYCLOAK_REALM", "tradegateway"),
KeycloakClientID:  getEnv("KEYCLOAK_CLIENT_ID", serviceName),
PermifyEndpoint:   getEnv("PERMIFY_ENDPOINT", "http://permify:3476"),
RedisAddr:         getEnv("REDIS_ADDR", "redis:6379"),
RedisPassword:     getEnv("REDIS_PASSWORD", ""),
APISIXAdminURL:    getEnv("APISIX_ADMIN_URL", "http://apisix:9180"),
APISIXAdminKey:    getEnv("APISIX_ADMIN_KEY", ""),
TigerBeetleAddr:   getEnv("TIGERBEETLE_ADDR", "tigerbeetle:3000"),
LakehouseEndpoint: getEnv("LAKEHOUSE_ENDPOINT", "http://delta-lake:8080"),
LakehouseS3Bucket: getEnv("LAKEHOUSE_S3_BUCKET", "tradegateway-lakehouse"),
OTELEndpoint:      getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4317"),
ServiceName:       serviceName,
ServiceVersion:    getEnv("SERVICE_VERSION", "1.0.0"),
}
}

// ─── Dapr Client ──────────────────────────────────────────────────────────────

// DaprClient provides a lightweight HTTP client for Dapr sidecar operations.
type DaprClient struct {
httpPort string
appID    string
client   *http.Client
}

// NewDaprClient creates a new Dapr HTTP client.
func NewDaprClient(cfg *Config) *DaprClient {
return &DaprClient{
httpPort: cfg.DaprHTTPPort,
appID:    cfg.DaprAppID,
client:   &http.Client{Timeout: 10 * time.Second},
}
}

// PublishEvent publishes an event to a Dapr pubsub component.
func (d *DaprClient) PublishEvent(ctx context.Context, pubsubName, topic string, data interface{}) error {
payload, err := json.Marshal(data)
if err != nil {
return fmt.Errorf("dapr publish marshal: %w", err)
}
url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", d.httpPort, pubsubName, topic)
req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytesReader(payload))
if err != nil {
return fmt.Errorf("dapr publish request: %w", err)
}
req.Header.Set("Content-Type", "application/json")
resp, err := d.client.Do(req)
if err != nil {
return fmt.Errorf("dapr publish: %w", err)
}
defer resp.Body.Close()
if resp.StatusCode >= 400 {
return fmt.Errorf("dapr publish returned %d", resp.StatusCode)
}
return nil
}

// InvokeService invokes a method on another Dapr-enabled service.
func (d *DaprClient) InvokeService(ctx context.Context, appID, method string, data interface{}) ([]byte, error) {
payload, _ := json.Marshal(data)
url := fmt.Sprintf("http://localhost:%s/v1.0/invoke/%s/method/%s", d.httpPort, appID, method)
req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytesReader(payload))
if err != nil {
return nil, err
}
req.Header.Set("Content-Type", "application/json")
resp, err := d.client.Do(req)
if err != nil {
return nil, err
}
defer resp.Body.Close()
buf := make([]byte, 0, 4096)
tmp := make([]byte, 512)
for {
n, readErr := resp.Body.Read(tmp)
buf = append(buf, tmp[:n]...)
if readErr != nil {
break
}
}
return buf, nil
}

// GetSecret retrieves a secret from the Dapr secret store.
func (d *DaprClient) GetSecret(ctx context.Context, storeName, key string) (string, error) {
url := fmt.Sprintf("http://localhost:%s/v1.0/secrets/%s/%s", d.httpPort, storeName, key)
req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
if err != nil {
return "", err
}
resp, err := d.client.Do(req)
if err != nil {
return "", err
}
defer resp.Body.Close()
var result map[string]string
if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
return "", err
}
return result[key], nil
}

// ─── Keycloak Auth ────────────────────────────────────────────────────────────

// KeycloakClient validates JWT tokens against Keycloak.
type KeycloakClient struct {
baseURL  string
realm    string
clientID string
client   *http.Client
}

// NewKeycloakClient creates a new Keycloak client.
func NewKeycloakClient(cfg *Config) *KeycloakClient {
return &KeycloakClient{
baseURL:  cfg.KeycloakURL,
realm:    cfg.KeycloakRealm,
clientID: cfg.KeycloakClientID,
client:   &http.Client{Timeout: 5 * time.Second},
}
}

// ValidateToken introspects a bearer token with Keycloak.
func (k *KeycloakClient) ValidateToken(ctx context.Context, token string) (bool, map[string]interface{}, error) {
url := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token/introspect", k.baseURL, k.realm)
req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
if err != nil {
return false, nil, err
}
req.Header.Set("Authorization", "Bearer "+token)
req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
resp, err := k.client.Do(req)
if err != nil {
return false, nil, err
}
defer resp.Body.Close()
var claims map[string]interface{}
if err := json.NewDecoder(resp.Body).Decode(&claims); err != nil {
return false, nil, err
}
active, _ := claims["active"].(bool)
return active, claims, nil
}

// GetJWKS retrieves the Keycloak JSON Web Key Set for offline token validation.
func (k *KeycloakClient) GetJWKS(ctx context.Context) (map[string]interface{}, error) {
url := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", k.baseURL, k.realm)
req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
if err != nil {
return nil, err
}
resp, err := k.client.Do(req)
if err != nil {
return nil, err
}
defer resp.Body.Close()
var jwks map[string]interface{}
json.NewDecoder(resp.Body).Decode(&jwks)
return jwks, nil
}

// ─── Permify Authorization ────────────────────────────────────────────────────

// PermifyClient checks fine-grained permissions via Permify.
type PermifyClient struct {
endpoint string
client   *http.Client
}

// NewPermifyClient creates a new Permify client.
func NewPermifyClient(cfg *Config) *PermifyClient {
return &PermifyClient{
endpoint: cfg.PermifyEndpoint,
client:   &http.Client{Timeout: 3 * time.Second},
}
}

// Check verifies whether a subject has a permission on an entity.
func (p *PermifyClient) Check(ctx context.Context, tenantID, entity, entityID, permission, subjectType, subjectID string) (bool, error) {
payload := map[string]interface{}{
"metadata": map[string]interface{}{"tenant_id": tenantID, "schema_version": "", "snap_token": "", "depth": 20},
"entity":   map[string]string{"type": entity, "id": entityID},
"permission": permission,
"subject":  map[string]string{"type": subjectType, "id": subjectID},
}
body, _ := json.Marshal(payload)
req, err := http.NewRequestWithContext(ctx, http.MethodPost,
p.endpoint+"/v1/tenants/"+tenantID+"/permissions/check", bytesReader(body))
if err != nil {
return false, err
}
req.Header.Set("Content-Type", "application/json")
resp, err := p.client.Do(req)
if err != nil {
return false, err
}
defer resp.Body.Close()
var result map[string]interface{}
json.NewDecoder(resp.Body).Decode(&result)
can, _ := result["can"].(string)
return can == "CHECK_RESULT_ALLOWED", nil
}

// ─── APISIX Route Management ──────────────────────────────────────────────────

// APISIXClient manages routes and plugins via the APISIX Admin API.
type APISIXClient struct {
adminURL string
adminKey string
client   *http.Client
}

// NewAPISIXClient creates a new APISIX admin client.
func NewAPISIXClient(cfg *Config) *APISIXClient {
return &APISIXClient{
adminURL: cfg.APISIXAdminURL,
adminKey: cfg.APISIXAdminKey,
client:   &http.Client{Timeout: 10 * time.Second},
}
}

// UpsertRoute creates or updates a route in APISIX.
func (a *APISIXClient) UpsertRoute(ctx context.Context, routeID string, route map[string]interface{}) error {
body, _ := json.Marshal(route)
req, err := http.NewRequestWithContext(ctx, http.MethodPut,
fmt.Sprintf("%s/apisix/admin/routes/%s", a.adminURL, routeID), bytesReader(body))
if err != nil {
return err
}
req.Header.Set("X-API-KEY", a.adminKey)
req.Header.Set("Content-Type", "application/json")
resp, err := a.client.Do(req)
if err != nil {
return err
}
defer resp.Body.Close()
if resp.StatusCode >= 400 {
return fmt.Errorf("apisix upsert route returned %d", resp.StatusCode)
}
return nil
}

// GetRoute retrieves a route configuration from APISIX.
func (a *APISIXClient) GetRoute(ctx context.Context, routeID string) (map[string]interface{}, error) {
req, err := http.NewRequestWithContext(ctx, http.MethodGet,
fmt.Sprintf("%s/apisix/admin/routes/%s", a.adminURL, routeID), nil)
if err != nil {
return nil, err
}
req.Header.Set("X-API-KEY", a.adminKey)
resp, err := a.client.Do(req)
if err != nil {
return nil, err
}
defer resp.Body.Close()
var result map[string]interface{}
json.NewDecoder(resp.Body).Decode(&result)
return result, nil
}

// ─── Lakehouse / Delta Lake ───────────────────────────────────────────────────

// LakehouseClient writes events to the Delta Lake via the lakehouse REST API.
type LakehouseClient struct {
endpoint string
s3Bucket string
client   *http.Client
}

// NewLakehouseClient creates a new lakehouse client.
func NewLakehouseClient(cfg *Config) *LakehouseClient {
return &LakehouseClient{
endpoint: cfg.LakehouseEndpoint,
s3Bucket: cfg.LakehouseS3Bucket,
client:   &http.Client{Timeout: 30 * time.Second},
}
}

// WriteEvent writes a structured event to a Delta Lake table.
func (l *LakehouseClient) WriteEvent(ctx context.Context, tableName string, event interface{}) error {
payload := map[string]interface{}{
"table":  tableName,
"bucket": l.s3Bucket,
"data":   event,
"ts":     time.Now().UTC().UnixMilli(),
}
body, _ := json.Marshal(payload)
req, err := http.NewRequestWithContext(ctx, http.MethodPost,
l.endpoint+"/api/v1/write", bytesReader(body))
if err != nil {
return err
}
req.Header.Set("Content-Type", "application/json")
resp, err := l.client.Do(req)
if err != nil {
return err
}
defer resp.Body.Close()
if resp.StatusCode >= 400 {
return fmt.Errorf("lakehouse write returned %d", resp.StatusCode)
}
return nil
}

// QueryTable executes a SQL query against a Delta Lake table.
func (l *LakehouseClient) QueryTable(ctx context.Context, sql string) ([]map[string]interface{}, error) {
payload := map[string]string{"sql": sql, "bucket": l.s3Bucket}
body, _ := json.Marshal(payload)
req, err := http.NewRequestWithContext(ctx, http.MethodPost,
l.endpoint+"/api/v1/query", bytesReader(body))
if err != nil {
return nil, err
}
req.Header.Set("Content-Type", "application/json")
resp, err := l.client.Do(req)
if err != nil {
return nil, err
}
defer resp.Body.Close()
var result []map[string]interface{}
json.NewDecoder(resp.Body).Decode(&result)
return result, nil
}

// ─── Middleware Bundle ────────────────────────────────────────────────────────

// Bundle aggregates all middleware clients for a service.
type Bundle struct {
Config    *Config
Dapr      *DaprClient
Keycloak  *KeycloakClient
Permify   *PermifyClient
APISIX    *APISIXClient
Lakehouse *LakehouseClient
}

// NewBundle creates a fully initialized middleware bundle for a service.
func NewBundle(serviceName string) *Bundle {
cfg := LoadConfig(serviceName)
return &Bundle{
Config:    cfg,
Dapr:      NewDaprClient(cfg),
Keycloak:  NewKeycloakClient(cfg),
Permify:   NewPermifyClient(cfg),
APISIX:    NewAPISIXClient(cfg),
Lakehouse: NewLakehouseClient(cfg),
}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
if v := os.Getenv(key); v != "" {
return v
}
return fallback
}

// bytesReader creates an io.Reader from a byte slice without importing bytes package.
func bytesReader(b []byte) *bytesReaderImpl {
return &bytesReaderImpl{data: b, pos: 0}
}

type bytesReaderImpl struct {
data []byte
pos  int
}

func (r *bytesReaderImpl) Read(p []byte) (int, error) {
if r.pos >= len(r.data) {
return 0, fmt.Errorf("EOF")
}
n := copy(p, r.data[r.pos:])
r.pos += n
return n, nil
}
