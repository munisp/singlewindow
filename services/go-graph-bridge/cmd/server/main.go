// Command server is the TradeGateway graph bridge microservice.
//
// This service is the single integration point between the Node.js tRPC layer
// and the polyglot AI/graph backend:
//
//   Node.js tRPC → HTTP → Go bridge → FalkorDB / Neo4j (graph)
//                                   → Rust GNN engine (risk scoring)
//                                   → Python AI (CocoIndex, EPR-KGQA, ART)
//                                   → Ollama (local LLM)
//
// Language choice: Go
//   - Go's net/http standard library is production-ready with no framework needed
//   - Goroutines handle concurrent calls to all downstream services efficiently
//   - Graceful shutdown via os.Signal ensures no in-flight requests are dropped
//   - The service is stateless and horizontally scalable (Kubernetes-ready)
//
// Configuration (environment variables):
//   PORT              — HTTP port (default: 8080)
//   FALKORDB_HOST     — FalkorDB Redis host (default: localhost)
//   NEO4J_URI         — Neo4j Bolt URI (default: bolt://localhost:7687)
//   RUST_ENGINE_URL   — Rust GNN engine URL (default: http://localhost:8001)
//   PYTHON_AI_URL     — Python AI service URL (default: http://localhost:8002)
//   OLLAMA_URL        — Ollama LLM bridge URL (default: http://localhost:8003)
//   GRAPH_BACKEND     — "falkordb" | "neo4j" | "mock" (default: mock)

package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tradegateway/graph-bridge/internal/graph"
	"tradegateway/graph-bridge/internal/handlers"
	"tradegateway/graph-bridge/internal/risk"
)

func main() {
	// ── Structured logging ────────────────────────────────────────────────────
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// ── Configuration ─────────────────────────────────────────────────────────
	cfg := graph.DefaultConfig()
	port := getEnv("PORT", "8080")
	graphBackend := getEnv("GRAPH_BACKEND", "mock")

	slog.Info("TradeGateway Graph Bridge starting",
		"port", port,
		"graphBackend", graphBackend,
		"rustEngine", cfg.RustEngineURL,
		"pythonAI", cfg.PythonAIURL,
		"ollama", cfg.OllamaURL,
	)

	// ── Graph client ──────────────────────────────────────────────────────────
	// In production, replace MockGraphClient with FalkorDBClient or Neo4jClient.
	// The interface is identical — no changes to the handlers or orchestrator.
	var graphClient graph.GraphClient
	switch graphBackend {
	case "mock":
		graphClient = graph.NewMockGraphClient()
		slog.Info("Using mock graph client (development mode)")
	default:
		// Default to mock for safety — production deployments set GRAPH_BACKEND
		graphClient = graph.NewMockGraphClient()
		slog.Warn("Unknown GRAPH_BACKEND, defaulting to mock", "backend", graphBackend)
	}
	defer graphClient.Close()

	// ── Risk orchestrator ─────────────────────────────────────────────────────
	orchestrator := risk.NewOrchestrator(graphClient, cfg.RustEngineURL, cfg.PythonAIURL)

	// ── HTTP handlers ─────────────────────────────────────────────────────────
	h := handlers.NewHandler(graphClient, orchestrator, cfg.PythonAIURL, cfg.OllamaURL)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	// ── CORS middleware (for tRPC Node.js on different port) ──────────────────
	corsMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	// ── Request logging middleware ────────────────────────────────────────────
	loggingMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			next.ServeHTTP(w, r)
			slog.Info("HTTP request",
				"method", r.Method,
				"path", r.URL.Path,
				"latency_ms", time.Since(start).Milliseconds(),
			)
		})
	}

	// ── HTTP server ───────────────────────────────────────────────────────────
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      loggingMiddleware(corsMiddleware(mux)),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// ── Graceful shutdown ─────────────────────────────────────────────────────
	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("Graph bridge listening", "addr", server.Addr)
		serverErrors <- server.ListenAndServe()
	}()

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		slog.Error("Server error", "error", err)
		os.Exit(1)
	case sig := <-shutdown:
		slog.Info("Shutdown signal received", "signal", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			slog.Error("Graceful shutdown failed", "error", err)
			os.Exit(1)
		}
		slog.Info("Graph bridge stopped gracefully")
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
