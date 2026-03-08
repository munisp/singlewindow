package risk_test

import (
	"context"
	"testing"

	"tradegateway/graph-bridge/internal/graph"
	"tradegateway/graph-bridge/internal/risk"
)

// ─── MOCK GRAPH CLIENT FOR TESTS ─────────────────────────────────────────────

type testGraphClient struct {
	trader  graph.TraderNode
	hsCode  graph.HSCodeNode
	port    graph.PortNode
}

func (c *testGraphClient) Ping(ctx context.Context) error { return nil }
func (c *testGraphClient) GetTrader(ctx context.Context, id string) (*graph.TraderNode, error) {
	t := c.trader
	return &t, nil
}
func (c *testGraphClient) GetDeclaration(ctx context.Context, id string) (*graph.DeclarationNode, error) {
	return &graph.DeclarationNode{ID: id}, nil
}
func (c *testGraphClient) GetHSCode(ctx context.Context, code string) (*graph.HSCodeNode, error) {
	h := c.hsCode
	return &h, nil
}
func (c *testGraphClient) GetPort(ctx context.Context, id string) (*graph.PortNode, error) {
	p := c.port
	return &p, nil
}
func (c *testGraphClient) GetTraderRiskProfile(ctx context.Context, id string) (*graph.TraderRiskProfile, error) {
	return &graph.TraderRiskProfile{TraderID: id}, nil
}
func (c *testGraphClient) GetHighRiskCorridors(ctx context.Context, minRisk float64, limit int) ([]graph.CorridorNode, error) {
	return []graph.CorridorNode{}, nil
}
func (c *testGraphClient) GetOGABacklog(ctx context.Context) ([]graph.OGANode, error) {
	return []graph.OGANode{}, nil
}
func (c *testGraphClient) GetSanctionsMatches(ctx context.Context, minSimilarity float64) ([]graph.SanctionsMatch, error) {
	return []graph.SanctionsMatch{}, nil
}
func (c *testGraphClient) ExecuteCypher(ctx context.Context, cypher string, params map[string]interface{}) ([]map[string]interface{}, error) {
	return []map[string]interface{}{}, nil
}
func (c *testGraphClient) UpsertTrader(ctx context.Context, trader graph.TraderNode) error { return nil }
func (c *testGraphClient) UpsertDeclaration(ctx context.Context, decl graph.DeclarationNode) error {
	return nil
}
func (c *testGraphClient) CreateRelationship(ctx context.Context, fromID, toID, relType string, props map[string]interface{}) error {
	return nil
}
func (c *testGraphClient) UpdateRiskScore(ctx context.Context, nodeID, nodeType string, score float64) error {
	return nil
}
func (c *testGraphClient) Close() error { return nil }

// ─── TESTS ────────────────────────────────────────────────────────────────────

func newOrchestrator(gc graph.GraphClient) *risk.Orchestrator {
	// Use empty URLs so Rust engine calls fail → rule-based fallback
	return risk.NewOrchestrator(gc, "http://localhost:19999", "http://localhost:19998")
}

func TestScore_GreenLane_AEOTrader(t *testing.T) {
	gc := &testGraphClient{
		trader: graph.TraderNode{
			ID: "trader-1", RiskScore: 0.1, ViolationCount: 0, AEOStatus: true,
		},
		hsCode: graph.HSCodeNode{
			Code: "6204.62", FraudRate: 0.1, DutyRate: 0.15, Controlled: false,
		},
		port: graph.PortNode{ID: "port-tema", RiskIndex: 0.3},
	}

	orch := newOrchestrator(gc)
	resp, err := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-001",
		TraderID:      "trader-1",
		HSCode:        "6204.62",
		DeclaredValue: 5000,
		PortID:        "port-tema",
		AEOStatus:     true,
	})

	if err != nil {
		t.Fatalf("Score() returned error: %v", err)
	}
	if resp.Lane != "green" {
		t.Errorf("expected green lane for AEO trader with low-risk HS code, got %s (score=%.4f)", resp.Lane, resp.RiskScore)
	}
	if resp.RiskScore > 0.35 {
		t.Errorf("expected risk score < 0.35 for green lane, got %.4f", resp.RiskScore)
	}
}

func TestScore_RedLane_HighRiskTrader(t *testing.T) {
	gc := &testGraphClient{
		trader: graph.TraderNode{
			ID: "trader-2", RiskScore: 0.9, ViolationCount: 15, AEOStatus: false,
		},
		hsCode: graph.HSCodeNode{
			Code: "7108.12", FraudRate: 0.82, DutyRate: 0.0, Controlled: true,
		},
		port: graph.PortNode{ID: "port-apapa", RiskIndex: 0.75},
	}

	orch := newOrchestrator(gc)
	resp, err := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-002",
		TraderID:      "trader-2",
		HSCode:        "7108.12",
		DeclaredValue: 50, // suspiciously low
		PortID:        "port-apapa",
		AEOStatus:     false,
	})

	if err != nil {
		t.Fatalf("Score() returned error: %v", err)
	}
	if resp.Lane != "red" {
		t.Errorf("expected red lane for high-risk trader + gold HS code, got %s (score=%.4f)", resp.Lane, resp.RiskScore)
	}
	if resp.RiskScore < 0.65 {
		t.Errorf("expected risk score >= 0.65 for red lane, got %.4f", resp.RiskScore)
	}
}

func TestScore_YellowLane_MediumRisk(t *testing.T) {
	// Yellow lane: score in [0.35, 0.65)
	// Rule weights: hs_fraud(0.25) + trader_history(0.20) + value(0.20) + port(0.15) + violations(0.10)
	// With FraudRate=0.75, TraderRisk=0.6, ViolationCount=5, PortRisk=0.5, DeclaredValue=12000
	// Score ≈ 0.75*0.25 + 0.6*0.20 + 0.2*0.20 + 0.5*0.15 + 0.25*0.10 = 0.1875+0.12+0.04+0.075+0.025 = 0.4475
	gc := &testGraphClient{
		trader: graph.TraderNode{
			ID: "trader-3", RiskScore: 0.6, ViolationCount: 5, AEOStatus: false,
		},
		hsCode: graph.HSCodeNode{
			Code: "8517.12", FraudRate: 0.75, DutyRate: 0.15, Controlled: false,
		},
		port: graph.PortNode{ID: "port-tema", RiskIndex: 0.5},
	}

	orch := newOrchestrator(gc)
	resp, err := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-003",
		TraderID:      "trader-3",
		HSCode:        "8517.12",
		DeclaredValue: 12000,
		PortID:        "port-tema",
		AEOStatus:     false,
	})

	if err != nil {
		t.Fatalf("Score() returned error: %v", err)
	}
	if resp.Lane != "yellow" {
		t.Errorf("expected yellow lane for medium-risk declaration, got %s (score=%.4f)", resp.Lane, resp.RiskScore)
	}
	if resp.RiskScore < 0.35 || resp.RiskScore >= 0.65 {
		t.Errorf("expected score in [0.35, 0.65) for yellow lane, got %.4f", resp.RiskScore)
	}
}

func TestScore_ReturnsRequiredFields(t *testing.T) {
	gc := &testGraphClient{
		trader: graph.TraderNode{ID: "trader-4", RiskScore: 0.3},
		hsCode: graph.HSCodeNode{Code: "6204.62", FraudRate: 0.2},
		port:   graph.PortNode{ID: "port-tema", RiskIndex: 0.3},
	}

	orch := newOrchestrator(gc)
	resp, err := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-004",
		TraderID:      "trader-4",
		HSCode:        "6204.62",
		DeclaredValue: 8000,
	})

	if err != nil {
		t.Fatalf("Score() returned error: %v", err)
	}
	if resp.DeclarationID != "decl-004" {
		t.Errorf("expected declarationId 'decl-004', got %s", resp.DeclarationID)
	}
	if resp.Lane == "" {
		t.Error("expected non-empty lane")
	}
	if len(resp.RiskFactors) == 0 {
		t.Error("expected at least one risk factor")
	}
	if resp.Engine == "" {
		t.Error("expected non-empty engine field")
	}
	if resp.LatencyMs < 0 {
		t.Error("expected non-negative latency")
	}
}

func TestScore_AEOReducesRisk(t *testing.T) {
	gc := &testGraphClient{
		trader: graph.TraderNode{ID: "trader-5", RiskScore: 0.5, ViolationCount: 0},
		hsCode: graph.HSCodeNode{Code: "8517.12", FraudRate: 0.5, DutyRate: 0.15},
		port:   graph.PortNode{ID: "port-tema", RiskIndex: 0.4},
	}

	orch := newOrchestrator(gc)

	// Score without AEO
	respNoAEO, _ := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-005a",
		TraderID:      "trader-5",
		HSCode:        "8517.12",
		DeclaredValue: 10000,
		AEOStatus:     false,
	})

	// Score with AEO
	respWithAEO, _ := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-005b",
		TraderID:      "trader-5",
		HSCode:        "8517.12",
		DeclaredValue: 10000,
		AEOStatus:     true,
	})

	if respWithAEO.RuleScore >= respNoAEO.RuleScore {
		t.Errorf("AEO status should reduce risk score: with=%.4f, without=%.4f",
			respWithAEO.RuleScore, respNoAEO.RuleScore)
	}
}

func TestScore_ControlledGoodsIncreasesRisk(t *testing.T) {
	gc := &testGraphClient{
		trader: graph.TraderNode{ID: "trader-6", RiskScore: 0.3},
		port:   graph.PortNode{ID: "port-tema", RiskIndex: 0.3},
	}

	orch := newOrchestrator(gc)

	// Score with non-controlled HS code
	gc.hsCode = graph.HSCodeNode{Code: "6204.62", FraudRate: 0.2, Controlled: false}
	respNormal, _ := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-006a", TraderID: "trader-6",
		HSCode: "6204.62", DeclaredValue: 5000,
	})

	// Score with controlled HS code (gold)
	gc.hsCode = graph.HSCodeNode{Code: "7108.12", FraudRate: 0.2, Controlled: true}
	respControlled, _ := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-006b", TraderID: "trader-6",
		HSCode: "7108.12", DeclaredValue: 5000,
	})

	if respControlled.RuleScore <= respNormal.RuleScore {
		t.Errorf("controlled goods should increase risk: controlled=%.4f, normal=%.4f",
			respControlled.RuleScore, respNormal.RuleScore)
	}
}

func TestScore_SuspiciouslyLowValue(t *testing.T) {
	gc := &testGraphClient{
		trader: graph.TraderNode{ID: "trader-7", RiskScore: 0.3},
		hsCode: graph.HSCodeNode{Code: "8517.12", FraudRate: 0.3},
		port:   graph.PortNode{ID: "port-tema", RiskIndex: 0.3},
	}

	orch := newOrchestrator(gc)

	// Normal value
	respNormal, _ := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-007a", TraderID: "trader-7",
		HSCode: "8517.12", DeclaredValue: 10000,
	})

	// Suspiciously low value (under-invoicing indicator)
	respLow, _ := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-007b", TraderID: "trader-7",
		HSCode: "8517.12", DeclaredValue: 50,
	})

	if respLow.RuleScore <= respNormal.RuleScore {
		t.Errorf("suspiciously low value should increase risk: low=%.4f, normal=%.4f",
			respLow.RuleScore, respNormal.RuleScore)
	}
}

func TestScore_FallbackToRulesWhenRustUnavailable(t *testing.T) {
	gc := &testGraphClient{
		trader: graph.TraderNode{ID: "trader-8", RiskScore: 0.4},
		hsCode: graph.HSCodeNode{Code: "8517.12", FraudRate: 0.4},
		port:   graph.PortNode{ID: "port-tema", RiskIndex: 0.3},
	}

	// Rust engine URL points to a non-existent server
	orch := risk.NewOrchestrator(gc, "http://localhost:19999", "http://localhost:19998")

	resp, err := orch.Score(context.Background(), risk.ScoreRequest{
		DeclarationID: "decl-008",
		TraderID:      "trader-8",
		HSCode:        "8517.12",
		DeclaredValue: 8000,
	})

	if err != nil {
		t.Fatalf("Score() should not return error when Rust engine is unavailable: %v", err)
	}
	if resp.Engine != "rules-only" {
		t.Errorf("expected engine 'rules-only' when Rust unavailable, got %s", resp.Engine)
	}
	if resp.RiskScore <= 0 {
		t.Error("expected non-zero risk score from rule-based fallback")
	}
}
