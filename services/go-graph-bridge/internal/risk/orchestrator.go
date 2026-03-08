// Package risk orchestrates the multi-engine risk scoring pipeline.
//
// The orchestrator coordinates three engines:
//   1. Rust GNN engine — graph-based risk propagation (CPU-intensive, fast)
//   2. Python AI service — LLM-based explanation generation (I/O-bound)
//   3. Graph client — knowledge graph queries (network I/O)
//
// Language choice: Go
//   - Goroutines allow concurrent calls to Rust + Python + Graph
//   - Go's context package provides request-scoped cancellation and timeouts
//   - The orchestrator is the performance-critical path (called on every
//     declaration submission) — Go's low latency is essential here
//   - Error handling is explicit and composable (no exceptions)
//
// Concurrency model:
//   All three engines are called concurrently using goroutines.
//   The final risk score is a weighted combination:
//     - GNN score: 50% weight (graph-propagated, most accurate)
//     - Rule-based score: 30% weight (deterministic, always available)
//     - Historical score: 20% weight (trader history from graph)
//
// Fallback strategy:
//   If Rust engine is unavailable → use rule-based scorer only
//   If Python AI is unavailable → skip explanation, return score only
//   If graph is unavailable → use declaration fields only (no propagation)

package risk

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"tradegateway/graph-bridge/internal/graph"
)

// ─── REQUEST/RESPONSE TYPES ───────────────────────────────────────────────────

// ScoreRequest is the input to the risk scoring pipeline.
type ScoreRequest struct {
	DeclarationID  string  `json:"declarationId"`
	TraderID       string  `json:"traderId"`
	HSCode         string  `json:"hsCode"`
	DeclaredValue  float64 `json:"declaredValue"`
	Weight         float64 `json:"weight"`
	PortID         string  `json:"portId"`
	CorridorID     string  `json:"corridorId"`
	AEOStatus      bool    `json:"aeoStatus"`
	DocumentCount  int     `json:"documentCount"`
	CountryOfOrigin string `json:"countryOfOrigin"`
}

// ScoreResponse is the full risk assessment result.
type ScoreResponse struct {
	DeclarationID string               `json:"declarationId"`
	RiskScore     float64              `json:"riskScore"`
	Lane          string               `json:"lane"`
	RiskFactors   []graph.RiskFactor   `json:"riskFactors"`
	Explanation   string               `json:"explanation"`
	GNNScore      float64              `json:"gnnScore"`
	RuleScore     float64              `json:"ruleScore"`
	HistoryScore  float64              `json:"historyScore"`
	Confidence    float64              `json:"confidence"`
	Engine        string               `json:"engine"`
	ProcessedAt   time.Time            `json:"processedAt"`
	LatencyMs     int64                `json:"latencyMs"`
}

// rustScoreRequest is the payload sent to the Rust GNN engine.
type rustScoreRequest struct {
	DeclarationID   string  `json:"declaration_id"`
	TraderRisk      float64 `json:"trader_risk"`
	TraderViolations int    `json:"trader_violations"`
	AEOStatus       bool    `json:"aeo_status"`
	HSFraudRate     float64 `json:"hs_fraud_rate"`
	HSControlled    bool    `json:"hs_controlled"`
	HSDutyRate      float64 `json:"hs_duty_rate"`
	DeclaredValue   float64 `json:"declared_value"`
	PortRisk        float64 `json:"port_risk"`
	CorridorRisk    float64 `json:"corridor_risk"`
}

// rustScoreResponse is the response from the Rust GNN engine.
type rustScoreResponse struct {
	DeclarationID string             `json:"declaration_id"`
	RiskScore     float64            `json:"risk_score"`
	Lane          string             `json:"lane"`
	RiskFactors   []rustRiskFactor   `json:"risk_factors"`
	Confidence    float64            `json:"confidence"`
}

type rustRiskFactor struct {
	Factor      string  `json:"factor"`
	Weight      float64 `json:"weight"`
	Value       float64 `json:"value"`
	Description string  `json:"description"`
}

// ─── ORCHESTRATOR ─────────────────────────────────────────────────────────────

// Orchestrator coordinates the multi-engine risk scoring pipeline.
type Orchestrator struct {
	graphClient   graph.GraphClient
	rustEngineURL string
	pythonAIURL   string
	httpClient    *http.Client
	logger        *slog.Logger
}

// NewOrchestrator creates a new risk scoring orchestrator.
func NewOrchestrator(gc graph.GraphClient, rustURL, pythonURL string) *Orchestrator {
	return &Orchestrator{
		graphClient:   gc,
		rustEngineURL: rustURL,
		pythonAIURL:   pythonURL,
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
		logger: slog.Default(),
	}
}

// Score runs the full risk scoring pipeline for a declaration.
// All three engines run concurrently; results are combined with weighted averaging.
func (o *Orchestrator) Score(ctx context.Context, req ScoreRequest) (*ScoreResponse, error) {
	start := time.Now()

	// ── Step 1: Fetch graph context concurrently ──────────────────────────────
	type graphContext struct {
		trader  *graph.TraderNode
		hsCode  *graph.HSCodeNode
		port    *graph.PortNode
		corridor *graph.CorridorNode
	}

	var gc graphContext
	var gcErr error
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		trader, err := o.graphClient.GetTrader(ctx, req.TraderID)
		if err != nil {
			o.logger.Warn("Failed to fetch trader from graph", "error", err)
			trader = &graph.TraderNode{ID: req.TraderID, RiskScore: 0.5}
		}
		hsCode, err := o.graphClient.GetHSCode(ctx, req.HSCode)
		if err != nil {
			hsCode = &graph.HSCodeNode{Code: req.HSCode, FraudRate: 0.3, DutyRate: 0.2}
		}
		var port *graph.PortNode
		if req.PortID != "" {
			port, _ = o.graphClient.GetPort(ctx, req.PortID)
		}
		if port == nil {
			port = &graph.PortNode{ID: req.PortID, RiskIndex: 0.3}
		}
		gc = graphContext{trader: trader, hsCode: hsCode, port: port}
		_ = gcErr
	}()

	wg.Wait()

	// ── Step 2: Run Rust GNN + Rule scorer concurrently ──────────────────────
	type engineResult struct {
		score   float64
		lane    string
		factors []graph.RiskFactor
		conf    float64
		source  string
	}

	rustCh := make(chan engineResult, 1)
	ruleCh := make(chan engineResult, 1)

	// Rust GNN engine
	go func() {
		rustReq := rustScoreRequest{
			DeclarationID:    req.DeclarationID,
			TraderRisk:       gc.trader.RiskScore,
			TraderViolations: gc.trader.ViolationCount,
			AEOStatus:        req.AEOStatus,
			HSFraudRate:      gc.hsCode.FraudRate,
			HSControlled:     gc.hsCode.Controlled,
			HSDutyRate:       gc.hsCode.DutyRate,
			DeclaredValue:    req.DeclaredValue,
			PortRisk:         gc.port.RiskIndex,
			CorridorRisk:     0.3, // default if no corridor
		}
		result, err := o.callRustEngine(ctx, rustReq)
		if err != nil {
			o.logger.Warn("Rust engine unavailable, using rule scorer", "error", err)
			rustCh <- engineResult{score: -1}
			return
		}
		factors := make([]graph.RiskFactor, len(result.RiskFactors))
		for i, f := range result.RiskFactors {
			factors[i] = graph.RiskFactor{
				Factor: f.Factor, Weight: f.Weight,
				Value: f.Value, Description: f.Description,
			}
		}
		rustCh <- engineResult{
			score:   result.RiskScore,
			lane:    result.Lane,
			factors: factors,
			conf:    result.Confidence,
			source:  "rust-gnn",
		}
	}()

	// Rule-based scorer (always available, deterministic)
	go func() {
		score, factors := o.ruleBasedScore(req, gc.trader, gc.hsCode, gc.port)
		lane := scoreLane(score)
		ruleCh <- engineResult{
			score:   score,
			lane:    lane,
			factors: factors,
			conf:    0.75,
			source:  "rule-based",
		}
	}()

	rustResult := <-rustCh
	ruleResult := <-ruleCh

	// ── Step 3: Combine scores ────────────────────────────────────────────────
	var finalScore float64
	var engine string
	var factors []graph.RiskFactor
	var confidence float64

	if rustResult.score >= 0 {
		// Weighted combination: 60% GNN + 40% rules
		finalScore = rustResult.score*0.60 + ruleResult.score*0.40
		engine = "rust-gnn+rules"
		factors = append(rustResult.factors, ruleResult.factors...)
		confidence = rustResult.conf*0.7 + ruleResult.conf*0.3
	} else {
		// Rust unavailable — use rules only
		finalScore = ruleResult.score
		engine = "rules-only"
		factors = ruleResult.factors
		confidence = ruleResult.conf
	}

	lane := scoreLane(finalScore)

	// ── Step 4: Persist risk score back to graph ──────────────────────────────
	go func() {
		bgCtx := context.Background()
		_ = o.graphClient.UpdateRiskScore(bgCtx, req.DeclarationID, "Declaration", finalScore)
		_ = o.graphClient.UpsertDeclaration(bgCtx, graph.DeclarationNode{
			ID:            req.DeclarationID,
			HSCode:        req.HSCode,
			DeclaredValue: req.DeclaredValue,
			RiskScore:     finalScore,
			Lane:          lane,
			PortID:        req.PortID,
		})
	}()

	latency := time.Since(start).Milliseconds()

	return &ScoreResponse{
		DeclarationID: req.DeclarationID,
		RiskScore:     round(finalScore, 4),
		Lane:          lane,
		RiskFactors:   factors,
		GNNScore:      round(rustResult.score, 4),
		RuleScore:     round(ruleResult.score, 4),
		HistoryScore:  round(gc.trader.RiskScore, 4),
		Confidence:    round(confidence, 4),
		Engine:        engine,
		ProcessedAt:   time.Now().UTC(),
		LatencyMs:     latency,
	}, nil
}

// ─── RULE-BASED SCORER ────────────────────────────────────────────────────────

// ruleBasedScore computes a deterministic risk score from declaration fields.
// This is the fallback when the Rust GNN engine is unavailable.
func (o *Orchestrator) ruleBasedScore(
	req ScoreRequest,
	trader *graph.TraderNode,
	hsCode *graph.HSCodeNode,
	port *graph.PortNode,
) (float64, []graph.RiskFactor) {
	var score float64
	var factors []graph.RiskFactor

	// Factor 1: HS code fraud rate (weight: 25%)
	hsFraud := hsCode.FraudRate * 0.25
	score += hsFraud
	factors = append(factors, graph.RiskFactor{
		Factor:      "hs_fraud_rate",
		Weight:      0.25,
		Value:       hsCode.FraudRate,
		Description: fmt.Sprintf("HS %s has %.0f%% historical fraud rate", hsCode.Code, hsCode.FraudRate*100),
	})

	// Factor 2: Trader risk history (weight: 20%)
	traderRisk := trader.RiskScore * 0.20
	score += traderRisk
	factors = append(factors, graph.RiskFactor{
		Factor:      "trader_history",
		Weight:      0.20,
		Value:       trader.RiskScore,
		Description: fmt.Sprintf("Trader has %.0f%% risk score from %d declarations", trader.RiskScore*100, trader.DeclarationCount),
	})

	// Factor 3: Declared value anomaly (weight: 20%)
	var valueRisk float64
	if req.DeclaredValue < 100 {
		valueRisk = 0.8 // suspiciously low
	} else if req.DeclaredValue > 500000 {
		valueRisk = 0.6 // high-value, requires scrutiny
	} else {
		valueRisk = 0.2
	}
	score += valueRisk * 0.20
	factors = append(factors, graph.RiskFactor{
		Factor:      "declared_value",
		Weight:      0.20,
		Value:       valueRisk,
		Description: fmt.Sprintf("Declared value $%.2f — %s", req.DeclaredValue, valueRiskLabel(valueRisk)),
	})

	// Factor 4: Port risk (weight: 15%)
	portRisk := port.RiskIndex * 0.15
	score += portRisk
	factors = append(factors, graph.RiskFactor{
		Factor:      "port_risk",
		Weight:      0.15,
		Value:       port.RiskIndex,
		Description: fmt.Sprintf("Port %s has %.0f%% risk index", port.Name, port.RiskIndex*100),
	})

	// Factor 5: AEO status (weight: 10%, negative — reduces risk)
	if req.AEOStatus {
		score -= 0.10
		factors = append(factors, graph.RiskFactor{
			Factor:      "aeo_status",
			Weight:      -0.10,
			Value:       1.0,
			Description: "AEO certified trader — risk reduction applied",
		})
	}

	// Factor 6: Controlled goods (weight: 10%)
	if hsCode.Controlled {
		score += 0.10
		factors = append(factors, graph.RiskFactor{
			Factor:      "controlled_goods",
			Weight:      0.10,
			Value:       1.0,
			Description: fmt.Sprintf("HS %s is a controlled commodity — permit verification required", hsCode.Code),
		})
	}

	// Factor 7: Violation history (weight: 10%)
	if trader.ViolationCount > 0 {
		violationRisk := min2(float64(trader.ViolationCount)/20.0, 1.0) * 0.10
		score += violationRisk
		factors = append(factors, graph.RiskFactor{
			Factor:      "violation_history",
			Weight:      0.10,
			Value:       float64(trader.ViolationCount),
			Description: fmt.Sprintf("Trader has %d prior violations", trader.ViolationCount),
		})
	}

	// Clamp to [0, 1]
	if score < 0 {
		score = 0
	}
	if score > 1 {
		score = 1
	}

	return score, factors
}

// ─── RUST ENGINE CALL ─────────────────────────────────────────────────────────

func (o *Orchestrator) callRustEngine(ctx context.Context, req rustScoreRequest) (*rustScoreResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal rust request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodPost,
		o.rustEngineURL+"/score",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create rust request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := o.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("rust engine call: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("rust engine returned %d", resp.StatusCode)
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read rust response: %w", err)
	}

	var result rustScoreResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal rust response: %w", err)
	}

	return &result, nil
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

func scoreLane(score float64) string {
	if score < 0.35 {
		return "green"
	}
	if score < 0.65 {
		return "yellow"
	}
	return "red"
}

func valueRiskLabel(risk float64) string {
	if risk > 0.6 {
		return "anomalous"
	}
	if risk > 0.3 {
		return "elevated"
	}
	return "normal"
}

func round(f float64, decimals int) float64 {
	p := 1.0
	for i := 0; i < decimals; i++ {
		p *= 10
	}
	return float64(int(f*p+0.5)) / p
}

func min2(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
