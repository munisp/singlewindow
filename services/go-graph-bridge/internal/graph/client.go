// Package graph provides the FalkorDB and Neo4j client for the TradeGateway
// knowledge graph bridge.
//
// Language choice: Go
//   - Go is the primary language for all TradeGateway business microservices
//   - The bridge is a high-throughput HTTP service (1000+ req/s) — Go's goroutine
//     model handles concurrent graph queries efficiently
//   - The Rust engine handles the CPU-intensive GNN computation; Go orchestrates
//     the calls and formats the HTTP responses for the tRPC layer
//   - FalkorDB has a Go Redis client (FalkorDB uses the Redis protocol)
//   - Neo4j has an official Go driver (neo4j-go-driver)
//
// Architecture:
//   tRPC (Node.js) → HTTP → Go bridge → FalkorDB (Cypher/Redis)
//                                      → Neo4j (Bolt/Cypher)
//                                      → Rust engine (HTTP/JSON)
//                                      → Python AI (HTTP/JSON)
//
// The Go bridge is the single integration point for the Node.js tRPC layer,
// so Node.js never needs to know whether the graph is FalkorDB or Neo4j.
// This allows seamless migration between the two without touching the frontend.

package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"
)

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

// Config holds all graph database connection parameters.
type Config struct {
	// FalkorDB (Redis protocol)
	FalkorDBHost  string
	FalkorDBPort  int
	FalkorDBGraph string

	// Neo4j (Bolt protocol)
	Neo4jURI      string
	Neo4jUser     string
	Neo4jPassword string
	Neo4jDatabase string

	// Rust risk engine
	RustEngineURL string

	// Python AI services
	PythonAIURL string
	OllamaURL   string

	// Connection pool
	MaxConnections int
	QueryTimeout   time.Duration
}

// DefaultConfig returns a Config populated from environment variables.
func DefaultConfig() Config {
	return Config{
		FalkorDBHost:   getEnv("FALKORDB_HOST", "localhost"),
		FalkorDBPort:   6379,
		FalkorDBGraph:  getEnv("FALKORDB_GRAPH", "trade_kg"),
		Neo4jURI:       getEnv("NEO4J_URI", "bolt://localhost:7687"),
		Neo4jUser:      getEnv("NEO4J_USER", "neo4j"),
		Neo4jPassword:  mustGetEnv("NEO4J_PASSWORD"), // SW-S2-4: no default secret
		Neo4jDatabase:  getEnv("NEO4J_DATABASE", "neo4j"),
		RustEngineURL:  getEnv("RUST_ENGINE_URL", "http://localhost:8001"),
		PythonAIURL:    getEnv("PYTHON_AI_URL", "http://localhost:8002"),
		OllamaURL:      getEnv("OLLAMA_URL", "http://localhost:8003"),
		MaxConnections: 50,
		QueryTimeout:   10 * time.Second,
	}
}

// mustGetEnv fails closed: a missing secret refuses boot (SW-S2-4).
func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		slog.Error("[graph-bridge] FATAL: required secret env var is not set — no default is provided (fail closed)", "envVar", key)
		os.Exit(1)
	}
	return v
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── GRAPH NODE TYPES ─────────────────────────────────────────────────────────

// TraderNode represents a Trader node in the knowledge graph.
type TraderNode struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	TIN             string    `json:"tin"`
	AEOStatus       bool      `json:"aeoStatus"`
	RiskScore       float64   `json:"riskScore"`
	ViolationCount  int       `json:"violationCount"`
	DeclarationCount int      `json:"declarationCount"`
	CreatedAt       time.Time `json:"createdAt"`
}

// DeclarationNode represents a Declaration node in the knowledge graph.
type DeclarationNode struct {
	ID               string    `json:"id"`
	DeclarationNumber string   `json:"declarationNumber"`
	HSCode           string    `json:"hsCode"`
	DeclaredValue    float64   `json:"declaredValue"`
	RiskScore        float64   `json:"riskScore"`
	Lane             string    `json:"lane"`
	Status           string    `json:"status"`
	PortID           string    `json:"portId"`
	CorridorID       string    `json:"corridorId"`
	CreatedAt        time.Time `json:"createdAt"`
}

// HSCodeNode represents an HS Code node with risk intelligence.
type HSCodeNode struct {
	Code        string  `json:"code"`
	Description string  `json:"description"`
	Chapter     string  `json:"chapter"`
	DutyRate    float64 `json:"dutyRate"`
	FraudRate   float64 `json:"fraudRate"`
	Controlled  bool    `json:"controlled"`
	RiskIndex   float64 `json:"riskIndex"`
}

// PortNode represents a port of entry/exit.
type PortNode struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Country     string  `json:"country"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	RiskIndex   float64 `json:"riskIndex"`
	Throughput  int     `json:"throughput"`
	Congestion  float64 `json:"congestion"`
}

// CorridorNode represents a trade corridor (origin → destination).
type CorridorNode struct {
	ID          string  `json:"id"`
	Origin      string  `json:"origin"`
	Destination string  `json:"destination"`
	RiskIndex   float64 `json:"riskIndex"`
	AvgDays     float64 `json:"avgDays"`
	Volume      int     `json:"volume"`
}

// OGANode represents an Other Government Agency.
type OGANode struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	Code                string  `json:"code"`
	AvgProcessingHours  float64 `json:"avgProcessingHours"`
	SLAHours            float64 `json:"slaHours"`
	BacklogCount        int     `json:"backlogCount"`
}

// SanctionedEntityNode represents a sanctioned entity.
type SanctionedEntityNode struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	ListSource string  `json:"listSource"` // OFAC | UN | EU | INTERPOL
	EntityType string  `json:"entityType"` // individual | company | vessel
	Country    string  `json:"country"`
}

// ─── GRAPH QUERY RESULTS ─────────────────────────────────────────────────────

// RiskPropagationResult is returned by the Rust GNN engine after graph traversal.
type RiskPropagationResult struct {
	DeclarationID  string             `json:"declarationId"`
	RiskScore      float64            `json:"riskScore"`
	Lane           string             `json:"lane"`
	RiskFactors    []RiskFactor       `json:"riskFactors"`
	GNNConfidence  float64            `json:"gnnConfidence"`
	PropagatedFrom []string           `json:"propagatedFrom"`
	Explanation    string             `json:"explanation"`
	ProcessedAt    time.Time          `json:"processedAt"`
}

// RiskFactor is a single contributing factor to the risk score.
type RiskFactor struct {
	Factor      string  `json:"factor"`
	Weight      float64 `json:"weight"`
	Value       float64 `json:"value"`
	Description string  `json:"description"`
}

// TraderRiskProfile is the aggregated risk profile for a trader.
type TraderRiskProfile struct {
	TraderID          string        `json:"traderId"`
	TraderName        string        `json:"traderName"`
	AEOStatus         bool          `json:"aeoStatus"`
	OverallRisk       float64       `json:"overallRisk"`
	TotalDeclarations int           `json:"totalDeclarations"`
	RedLaneCount      int           `json:"redLaneCount"`
	YellowLaneCount   int           `json:"yellowLaneCount"`
	GreenLaneCount    int           `json:"greenLaneCount"`
	TopHSCodes        []HSCodeNode  `json:"topHsCodes"`
	TopPorts          []PortNode    `json:"topPorts"`
	SanctionsMatches  []SanctionsMatch `json:"sanctionsMatches"`
	NetworkRisk       float64       `json:"networkRisk"` // GNN-propagated risk from connected traders
}

// SanctionsMatch is a potential match between a trader and a sanctioned entity.
type SanctionsMatch struct {
	SanctionedEntity SanctionedEntityNode `json:"sanctionedEntity"`
	Similarity       float64              `json:"similarity"`
	MatchType        string               `json:"matchType"` // exact | fuzzy | phonetic
}

// KGQAResponse is the response from the EPR-KGQA question answering service.
type KGQAResponse struct {
	Question    string                   `json:"question"`
	Answer      string                   `json:"answer"`
	Intent      string                   `json:"intent"`
	Entities    map[string][]string      `json:"entities"`
	Predicates  []string                 `json:"predicates"`
	Cypher      string                   `json:"cypher"`
	ResultCount int                      `json:"resultCount"`
	Results     []map[string]interface{} `json:"results"`
}

// ─── GRAPH CLIENT INTERFACE ───────────────────────────────────────────────────

// GraphClient defines the interface for graph database operations.
// Both FalkorDB and Neo4j implement this interface, allowing runtime switching.
type GraphClient interface {
	// Health check
	Ping(ctx context.Context) error

	// Node operations
	GetTrader(ctx context.Context, traderID string) (*TraderNode, error)
	GetDeclaration(ctx context.Context, declarationID string) (*DeclarationNode, error)
	GetHSCode(ctx context.Context, code string) (*HSCodeNode, error)
	GetPort(ctx context.Context, portID string) (*PortNode, error)

	// Graph queries
	GetTraderRiskProfile(ctx context.Context, traderID string) (*TraderRiskProfile, error)
	GetHighRiskCorridors(ctx context.Context, minRisk float64, limit int) ([]CorridorNode, error)
	GetOGABacklog(ctx context.Context) ([]OGANode, error)
	GetSanctionsMatches(ctx context.Context, minSimilarity float64) ([]SanctionsMatch, error)

	// Cypher execution (raw)
	ExecuteCypher(ctx context.Context, cypher string, params map[string]interface{}) ([]map[string]interface{}, error)

	// Graph mutations
	UpsertTrader(ctx context.Context, trader TraderNode) error
	UpsertDeclaration(ctx context.Context, decl DeclarationNode) error
	CreateRelationship(ctx context.Context, fromID, toID, relType string, props map[string]interface{}) error
	UpdateRiskScore(ctx context.Context, nodeID string, nodeType string, riskScore float64) error

	// Close connection
	Close() error
}

// ─── MOCK GRAPH CLIENT (for development without FalkorDB/Neo4j) ──────────────

// MockGraphClient implements GraphClient with in-memory data for development.
// Replace with FalkorDBClient or Neo4jClient in production.
type MockGraphClient struct {
	traders      map[string]TraderNode
	declarations map[string]DeclarationNode
	hsCodes      map[string]HSCodeNode
	ports        map[string]PortNode
	corridors    []CorridorNode
	ogas         []OGANode
	logger       *slog.Logger
}

// NewMockGraphClient creates a MockGraphClient pre-populated with seed data.
func NewMockGraphClient() *MockGraphClient {
	c := &MockGraphClient{
		traders:      make(map[string]TraderNode),
		declarations: make(map[string]DeclarationNode),
		hsCodes:      make(map[string]HSCodeNode),
		ports:        make(map[string]PortNode),
		logger:       slog.Default(),
	}
	c.seed()
	return c
}

func (c *MockGraphClient) seed() {
	// Seed HS codes with risk intelligence
	c.hsCodes["8517.12"] = HSCodeNode{
		Code: "8517.12", Description: "Mobile telephones",
		Chapter: "85", DutyRate: 0.15, FraudRate: 0.72,
		Controlled: false, RiskIndex: 0.72,
	}
	c.hsCodes["7108.12"] = HSCodeNode{
		Code: "7108.12", Description: "Gold (non-monetary)",
		Chapter: "71", DutyRate: 0.0, FraudRate: 0.82,
		Controlled: true, RiskIndex: 0.88,
	}
	c.hsCodes["2710.12"] = HSCodeNode{
		Code: "2710.12", Description: "Motor spirit (petrol)",
		Chapter: "27", DutyRate: 0.05, FraudRate: 0.48,
		Controlled: true, RiskIndex: 0.65,
	}

	// Seed ports
	c.ports["port-tema"] = PortNode{
		ID: "port-tema", Name: "Tema Port", Country: "GH",
		Latitude: 5.6698, Longitude: -0.0166,
		RiskIndex: 0.45, Throughput: 850000, Congestion: 0.62,
	}
	c.ports["port-apapa"] = PortNode{
		ID: "port-apapa", Name: "Apapa Port", Country: "NG",
		Latitude: 6.4474, Longitude: 3.3903,
		RiskIndex: 0.68, Throughput: 1200000, Congestion: 0.78,
	}
	c.ports["port-mombasa"] = PortNode{
		ID: "port-mombasa", Name: "Mombasa Port", Country: "KE",
		Latitude: -4.0435, Longitude: 39.6682,
		RiskIndex: 0.41, Throughput: 1100000, Congestion: 0.55,
	}

	// Seed corridors
	c.corridors = []CorridorNode{
		{ID: "corr-cn-gh", Origin: "CN", Destination: "GH", RiskIndex: 0.72, AvgDays: 28, Volume: 15000},
		{ID: "corr-ae-ng", Origin: "AE", Destination: "NG", RiskIndex: 0.68, AvgDays: 14, Volume: 8500},
		{ID: "corr-cn-ke", Origin: "CN", Destination: "KE", RiskIndex: 0.65, AvgDays: 30, Volume: 12000},
		{ID: "corr-gh-ng", Origin: "GH", Destination: "NG", RiskIndex: 0.55, AvgDays: 3, Volume: 22000},
		{ID: "corr-de-gh", Origin: "DE", Destination: "GH", RiskIndex: 0.28, AvgDays: 21, Volume: 5000},
	}

	// Seed OGAs
	c.ogas = []OGANode{
		{ID: "oga-fda", Name: "Food and Drugs Authority", Code: "FDA", AvgProcessingHours: 18.5, SLAHours: 24, BacklogCount: 142},
		{ID: "oga-epa", Name: "Environmental Protection Agency", Code: "EPA", AvgProcessingHours: 36.2, SLAHours: 48, BacklogCount: 87},
		{ID: "oga-cocobod", Name: "Ghana Cocoa Board", Code: "COCOBOD", AvgProcessingHours: 8.1, SLAHours: 12, BacklogCount: 23},
		{ID: "oga-gfza", Name: "Ghana Free Zones Authority", Code: "GFZA", AvgProcessingHours: 72.0, SLAHours: 48, BacklogCount: 31},
	}
}

func (c *MockGraphClient) Ping(ctx context.Context) error { return nil }

func (c *MockGraphClient) GetTrader(ctx context.Context, traderID string) (*TraderNode, error) {
	if t, ok := c.traders[traderID]; ok {
		return &t, nil
	}
	// Return a synthetic trader for unknown IDs
	t := TraderNode{
		ID: traderID, Name: "Unknown Trader", TIN: "GH-TIN-UNKNOWN",
		AEOStatus: false, RiskScore: 0.5, ViolationCount: 0,
	}
	return &t, nil
}

func (c *MockGraphClient) GetDeclaration(ctx context.Context, declarationID string) (*DeclarationNode, error) {
	if d, ok := c.declarations[declarationID]; ok {
		return &d, nil
	}
	return nil, fmt.Errorf("declaration %s not found", declarationID)
}

func (c *MockGraphClient) GetHSCode(ctx context.Context, code string) (*HSCodeNode, error) {
	if h, ok := c.hsCodes[code]; ok {
		return &h, nil
	}
	// Return a default HS code for unknown codes
	h := HSCodeNode{
		Code: code, Description: "Unknown commodity",
		DutyRate: 0.20, FraudRate: 0.30, Controlled: false, RiskIndex: 0.30,
	}
	return &h, nil
}

func (c *MockGraphClient) GetPort(ctx context.Context, portID string) (*PortNode, error) {
	if p, ok := c.ports[portID]; ok {
		return &p, nil
	}
	return nil, fmt.Errorf("port %s not found", portID)
}

func (c *MockGraphClient) GetTraderRiskProfile(ctx context.Context, traderID string) (*TraderRiskProfile, error) {
	trader, _ := c.GetTrader(ctx, traderID)
	profile := &TraderRiskProfile{
		TraderID:          traderID,
		TraderName:        trader.Name,
		AEOStatus:         trader.AEOStatus,
		OverallRisk:       trader.RiskScore,
		TotalDeclarations: trader.DeclarationCount,
		RedLaneCount:      int(float64(trader.DeclarationCount) * 0.15),
		YellowLaneCount:   int(float64(trader.DeclarationCount) * 0.35),
		GreenLaneCount:    int(float64(trader.DeclarationCount) * 0.50),
		NetworkRisk:       trader.RiskScore * 1.1,
	}
	return profile, nil
}

func (c *MockGraphClient) GetHighRiskCorridors(ctx context.Context, minRisk float64, limit int) ([]CorridorNode, error) {
	var result []CorridorNode
	for _, corr := range c.corridors {
		if corr.RiskIndex >= minRisk {
			result = append(result, corr)
			if len(result) >= limit {
				break
			}
		}
	}
	return result, nil
}

func (c *MockGraphClient) GetOGABacklog(ctx context.Context) ([]OGANode, error) {
	return c.ogas, nil
}

func (c *MockGraphClient) GetSanctionsMatches(ctx context.Context, minSimilarity float64) ([]SanctionsMatch, error) {
	return []SanctionsMatch{}, nil
}

func (c *MockGraphClient) ExecuteCypher(ctx context.Context, cypher string, params map[string]interface{}) ([]map[string]interface{}, error) {
	c.logger.Info("Mock Cypher execution", "cypher", cypher[:min(len(cypher), 80)])
	return []map[string]interface{}{}, nil
}

func (c *MockGraphClient) UpsertTrader(ctx context.Context, trader TraderNode) error {
	c.traders[trader.ID] = trader
	return nil
}

func (c *MockGraphClient) UpsertDeclaration(ctx context.Context, decl DeclarationNode) error {
	c.declarations[decl.ID] = decl
	return nil
}

func (c *MockGraphClient) CreateRelationship(ctx context.Context, fromID, toID, relType string, props map[string]interface{}) error {
	c.logger.Info("Mock relationship created", "from", fromID, "to", toID, "type", relType)
	return nil
}

func (c *MockGraphClient) UpdateRiskScore(ctx context.Context, nodeID string, nodeType string, riskScore float64) error {
	if nodeType == "Trader" {
		if t, ok := c.traders[nodeID]; ok {
			t.RiskScore = riskScore
			c.traders[nodeID] = t
		}
	}
	return nil
}

func (c *MockGraphClient) Close() error { return nil }

// ─── JSON HELPERS ─────────────────────────────────────────────────────────────

// MarshalJSON marshals any value to JSON bytes.
func MarshalJSON(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
