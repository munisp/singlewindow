// oga-service — TradeGateway NGSWTP
// Manages Other Government Agency (OGA) permit workflows.
// Receives permit requests via Dapr pub/sub, routes to agency endpoints,
// tracks SLA compliance, and publishes approval/rejection events.
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

	"github.com/tradegateway/oga-service/internal/handlers"
	"github.com/tradegateway/oga-service/internal/pubsub"
	"github.com/tradegateway/oga-service/internal/store"
)

func main() {
	port := getEnv("PORT", "8083")
	daprPort := getEnv("DAPR_HTTP_PORT", "3503")
	dbURL := getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")

	log.Printf("[oga-service] Starting on port %s", port)

	st, err := store.New(dbURL)
	if err != nil {
		log.Fatalf("[oga-service] DB connection failed: %v", err)
	}
	defer st.Close()

	ps := pubsub.New(daprPort)
	h := handlers.New(st, ps)

	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"service": "oga-service",
			"version": "1.0.0",
			"time":    time.Now().UTC(),
		})
	})

	// ── OGA permit management ─────────────────────────────────────────────────
	mux.HandleFunc("GET /api/oga/permits", h.ListPermits)
	mux.HandleFunc("GET /api/oga/permits/{id}", h.GetPermit)
	mux.HandleFunc("POST /api/oga/permits/{id}/approve", h.ApprovePermit)
	mux.HandleFunc("POST /api/oga/permits/{id}/reject", h.RejectPermit)
	mux.HandleFunc("GET /api/oga/agencies", h.ListAgencies)
	mux.HandleFunc("GET /api/oga/sla/report", h.SLAReport)

	// ── Webhook endpoint (for external OGA systems) ───────────────────────────
	mux.HandleFunc("POST /api/oga/webhooks/{agencyCode}", h.AgencyWebhook)

	// ── Dapr subscriptions ────────────────────────────────────────────────────
	mux.HandleFunc("GET /dapr/subscribe", func(w http.ResponseWriter, r *http.Request) {
		subs := []map[string]interface{}{
			{"pubsubname": "kafka-pubsub", "topic": "oga.permit.requested", "route": "/events/permit-requested"},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(subs)
	})
	mux.HandleFunc("POST /events/permit-requested", h.OnPermitRequested)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("[oga-service] Listening on :%s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[oga-service] Server error: %v", err)
		}
	}()

	// SLA monitor goroutine — checks for overdue permits every 5 minutes
	go h.RunSLAMonitor(context.Background())

	<-quit
	log.Println("[oga-service] Shutting down...")
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
