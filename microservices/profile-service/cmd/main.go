// profile-service — TradeGateway NGSWTP
// Manages trader/importer/exporter profiles, KYC verification, AEO status,
// and compliance scoring. Publishes profile events via Dapr pub/sub.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tradegateway/profile-service/internal/handlers"
	"github.com/tradegateway/profile-service/internal/store"
)

func main() {
	port := getEnv("PORT", "8084")
	daprPort := getEnv("DAPR_HTTP_PORT", "3504")
	dbURL := getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")

	log.Printf("[profile-service] Starting on port %s", port)

	st, err := store.New(dbURL)
	if err != nil {
		log.Fatalf("[profile-service] DB connection failed: %v", err)
	}
	defer st.Close()

	h := handlers.New(st, daprPort)

	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"service": "profile-service",
			"version": "1.0.0",
			"time":    time.Now().UTC(),
		})
	})

	// ── Profile endpoints ─────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/profiles/{id}", h.GetProfile)
	mux.HandleFunc("PUT /api/profiles/{id}", h.UpdateProfile)
	mux.HandleFunc("GET /api/profiles/{id}/compliance", h.GetComplianceScore)
	mux.HandleFunc("POST /api/profiles/{id}/kyc/verify", h.VerifyKYC)
	mux.HandleFunc("GET /api/profiles/{id}/aeo", h.GetAEOStatus)
	mux.HandleFunc("POST /api/profiles/{id}/aeo/apply", h.ApplyForAEO)
	mux.HandleFunc("GET /api/profiles", h.ListProfiles)

	// ── Dapr subscriptions ────────────────────────────────────────────────────
	mux.HandleFunc("GET /dapr/subscribe", func(w http.ResponseWriter, r *http.Request) {
		subs := []map[string]interface{}{
			{"pubsubname": "kafka-pubsub", "topic": "declaration.cleared", "route": "/events/declaration-cleared"},
			{"pubsubname": "kafka-pubsub", "topic": "declaration.rejected", "route": "/events/declaration-rejected"},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(subs)
	})
	mux.HandleFunc("POST /events/declaration-cleared", h.OnDeclarationCleared)
	mux.HandleFunc("POST /events/declaration-rejected", h.OnDeclarationRejected)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("[profile-service] Listening on :%s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[profile-service] Server error: %v", err)
		}
	}()

	<-quit
	log.Println("[profile-service] Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	server.Shutdown(ctx)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
