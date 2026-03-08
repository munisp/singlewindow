// Package handlers provides the HTTP handlers for the TradeGateway graph bridge.
//
// Endpoints exposed to the tRPC layer (Node.js):
//   GET  /health                  — health check
//   POST /score                   — score a declaration (Rust GNN + rules)
//   GET  /trader/:id/profile      — trader risk profile from knowledge graph
//   GET  /corridors/high-risk     — high-risk trade corridors
//   GET  /ogas/backlog            — OGA processing backlog
//   POST /cypher                  — raw Cypher query (admin only)
//   POST /kgqa                    — EPR-KGQA question answering (via Python AI)
//   POST /explain                 — ART risk explanation (via Ollama bridge)
//   POST /graph/upsert/trader     — upsert trader node
//   POST /graph/upsert/declaration — upsert declaration node

package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"tradegateway/graph-bridge/internal/graph"
	"tradegateway/graph-bridge/internal/risk"
)

// Handler holds all dependencies for the HTTP handlers.
type Handler struct {
	graphClient   graph.GraphClient
	orchestrator  *risk.Orchestrator
	pythonAIURL   string
	ollamaURL     string
	httpClient    *http.Client
	logger        *slog.Logger
}

// NewHandler creates a new Handler.
func NewHandler(gc graph.GraphClient, orch *risk.Orchestrator, pythonAIURL, ollamaURL string) *Handler {
	return &Handler{
		graphClient:  gc,
		orchestrator: orch,
		pythonAIURL:  pythonAIURL,
		ollamaURL:    ollamaURL,
		httpClient:   &http.Client{Timeout: 15 * time.Second},
		logger:       slog.Default(),
	}
}

// RegisterRoutes registers all HTTP routes on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /health", h.Health)
	mux.HandleFunc("POST /score", h.Score)
	mux.HandleFunc("GET /trader/{id}/profile", h.TraderProfile)
	mux.HandleFunc("GET /corridors/high-risk", h.HighRiskCorridors)
	mux.HandleFunc("GET /ogas/backlog", h.OGABacklog)
	mux.HandleFunc("POST /cypher", h.ExecuteCypher)
	mux.HandleFunc("POST /kgqa", h.KGQA)
	mux.HandleFunc("POST /explain", h.ExplainRisk)
	mux.HandleFunc("POST /graph/upsert/trader", h.UpsertTrader)
	mux.HandleFunc("POST /graph/upsert/declaration", h.UpsertDeclaration)
}

// ─── HEALTH ───────────────────────────────────────────────────────────────────

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	graphOK := h.graphClient.Ping(ctx) == nil

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":    "ok",
		"graph":     graphOK,
		"timestamp": time.Now().UTC(),
		"service":   "go-graph-bridge",
		"version":   "1.0.0",
	})
}

// ─── SCORE ────────────────────────────────────────────────────────────────────

func (h *Handler) Score(w http.ResponseWriter, r *http.Request) {
	var req risk.ScoreRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.DeclarationID == "" || req.TraderID == "" {
		writeError(w, http.StatusBadRequest, "declarationId and traderId are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	result, err := h.orchestrator.Score(ctx, req)
	if err != nil {
		h.logger.Error("Risk scoring failed", "error", err, "declarationId", req.DeclarationID)
		writeError(w, http.StatusInternalServerError, "scoring failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ─── TRADER PROFILE ───────────────────────────────────────────────────────────

func (h *Handler) TraderProfile(w http.ResponseWriter, r *http.Request) {
	traderID := r.PathValue("id")
	if traderID == "" {
		writeError(w, http.StatusBadRequest, "trader id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	profile, err := h.graphClient.GetTraderRiskProfile(ctx, traderID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get trader profile: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, profile)
}

// ─── HIGH RISK CORRIDORS ──────────────────────────────────────────────────────

func (h *Handler) HighRiskCorridors(w http.ResponseWriter, r *http.Request) {
	minRisk := 0.5
	limit := 10

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	corridors, err := h.graphClient.GetHighRiskCorridors(ctx, minRisk, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get corridors: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"corridors": corridors,
		"count":     len(corridors),
		"minRisk":   minRisk,
	})
}

// ─── OGA BACKLOG ─────────────────────────────────────────────────────────────

func (h *Handler) OGABacklog(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	ogas, err := h.graphClient.GetOGABacklog(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get OGA backlog: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ogas":  ogas,
		"count": len(ogas),
	})
}

// ─── CYPHER ───────────────────────────────────────────────────────────────────

func (h *Handler) ExecuteCypher(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Cypher string                 `json:"cypher"`
		Params map[string]interface{} `json:"params"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if body.Cypher == "" {
		writeError(w, http.StatusBadRequest, "cypher query is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	results, err := h.graphClient.ExecuteCypher(ctx, body.Cypher, body.Params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cypher execution failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"results": results,
		"count":   len(results),
	})
}

// ─── EPR-KGQA ─────────────────────────────────────────────────────────────────

func (h *Handler) KGQA(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Question string `json:"question"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if body.Question == "" {
		writeError(w, http.StatusBadRequest, "question is required")
		return
	}

	// Forward to Python AI service
	result, err := h.callPythonAI(r.Context(), "/kgqa", map[string]string{
		"question": body.Question,
	})
	if err != nil {
		// Fallback: return a structured error response
		h.logger.Warn("Python AI KGQA unavailable", "error", err)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"question":    body.Question,
			"answer":      "Knowledge graph query service is currently unavailable. Please try again later.",
			"intent":      "unknown",
			"resultCount": 0,
			"results":     []interface{}{},
			"fallback":    true,
		})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ─── ART RISK EXPLANATION ─────────────────────────────────────────────────────

func (h *Handler) ExplainRisk(w http.ResponseWriter, r *http.Request) {
	var declaration map[string]interface{}
	if err := readJSON(r, &declaration); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	// Try Ollama bridge first (privacy-preserving, on-premise)
	result, err := h.callOllama(r.Context(), "/explain-risk", declaration)
	if err != nil {
		// Fallback to Python AI ART service
		h.logger.Warn("Ollama bridge unavailable, trying Python AI", "error", err)
		result, err = h.callPythonAI(r.Context(), "/art/explain", declaration)
		if err != nil {
			h.logger.Warn("Python AI ART unavailable", "error", err)
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"answer":     "Risk explanation service is currently unavailable.",
				"confidence": 0.0,
				"engine":     "unavailable",
				"fallback":   true,
			})
			return
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// ─── GRAPH MUTATIONS ─────────────────────────────────────────────────────────

func (h *Handler) UpsertTrader(w http.ResponseWriter, r *http.Request) {
	var trader graph.TraderNode
	if err := readJSON(r, &trader); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if err := h.graphClient.UpsertTrader(ctx, trader); err != nil {
		writeError(w, http.StatusInternalServerError, "upsert failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "id": trader.ID})
}

func (h *Handler) UpsertDeclaration(w http.ResponseWriter, r *http.Request) {
	var decl graph.DeclarationNode
	if err := readJSON(r, &decl); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if err := h.graphClient.UpsertDeclaration(ctx, decl); err != nil {
		writeError(w, http.StatusInternalServerError, "upsert failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "id": decl.ID})
}

// ─── PYTHON AI PROXY ─────────────────────────────────────────────────────────

func (h *Handler) callPythonAI(ctx context.Context, path string, payload interface{}) (map[string]interface{}, error) {
	return h.callService(ctx, h.pythonAIURL+path, payload)
}

func (h *Handler) callOllama(ctx context.Context, path string, payload interface{}) (map[string]interface{}, error) {
	return h.callService(ctx, h.ollamaURL+path, payload)
}

func (h *Handler) callService(ctx context.Context, url string, payload interface{}) (map[string]interface{}, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http call to %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("service %s returned %d", url, resp.StatusCode)
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	return result, nil
}

// ─── JSON HELPERS ─────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("Failed to encode JSON response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v interface{}) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB limit
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	return json.Unmarshal(body, v)
}
