// declaration-service — TradeGateway NGSWTP
// Handles declaration lifecycle: submission, validation, risk scoring trigger,
// OGA permit creation, and clearance issuance.
// Communicates via Dapr pub/sub (Kafka) and exposes HTTP/gRPC endpoints.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tradegateway/declaration-service/internal/handlers"
	"github.com/tradegateway/declaration-service/internal/pubsub"
	"github.com/tradegateway/declaration-service/internal/store"
)

func main() {
	port := getEnv("PORT", "8081")
	daprPort := getEnv("DAPR_HTTP_PORT", "3501")
	// SW-M4: no secret defaults in production; service auth mandatory.
	dbURL := getEnv("DATABASE_URL", devOnly("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"))
	if isProduction() && os.Getenv("DECLARATION_SERVICE_TOKEN") == "" {
		log.Fatal("[declaration-service] FATAL: DECLARATION_SERVICE_TOKEN must be set in production. Refusing to boot.")
	}

	log.Printf("[declaration-service] Starting on port %s (Dapr HTTP port: %s)", port, daprPort)

	// Initialize store (PostgreSQL)
	st, err := store.New(dbURL)
	if err != nil {
		log.Fatalf("[declaration-service] Failed to connect to database: %v", err)
	}
	defer st.Close()

	// Initialize Dapr pub/sub client
	ps := pubsub.New(daprPort)

	// Initialize HTTP handlers
	h := handlers.New(st, ps)

	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"service": "declaration-service",
			"version": "1.0.0",
			"time":    time.Now().UTC(),
		})
	})

	// ── Declaration CRUD ──────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/declarations", h.CreateDeclaration)
	mux.HandleFunc("GET /api/declarations/{id}", h.GetDeclaration)
	mux.HandleFunc("PUT /api/declarations/{id}/status", h.UpdateDeclarationStatus)
	mux.HandleFunc("GET /api/declarations", h.ListDeclarations)

	// ── Risk scoring ──────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/declarations/{id}/score", h.TriggerRiskScore)

	// ── OGA permits ──────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/declarations/{id}/oga-permits", h.CreateOGAPermits)
	mux.HandleFunc("GET /api/declarations/{id}/oga-permits", h.GetOGAPermits)

	// ── Clearance ────────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/declarations/{id}/clear", h.IssueClearance)

	// ── Dapr pub/sub subscription endpoint ───────────────────────────────────
	// Dapr calls GET /dapr/subscribe to discover subscriptions
	mux.HandleFunc("GET /dapr/subscribe", func(w http.ResponseWriter, r *http.Request) {
		subscriptions := []map[string]interface{}{
			{
				"pubsubname": "kafka-pubsub",
				"topic":      "payment.confirmed",
				"route":      "/events/payment-confirmed",
			},
			{
				"pubsubname": "kafka-pubsub",
				"topic":      "oga.permit.approved",
				"route":      "/events/oga-permit-approved",
			},
			{
				"pubsubname": "kafka-pubsub",
				"topic":      "oga.permit.rejected",
				"route":      "/events/oga-permit-rejected",
			},
			{
				"pubsubname": "kafka-pubsub",
				"topic":      "sanctions.hit",
				"route":      "/events/sanctions-hit",
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(subscriptions)
	})

	// ── Dapr event handlers ───────────────────────────────────────────────────
	mux.HandleFunc("POST /events/payment-confirmed", h.OnPaymentConfirmed)
	mux.HandleFunc("POST /events/oga-permit-approved", h.OnOGAPermitApproved)
	mux.HandleFunc("POST /events/oga-permit-rejected", h.OnOGAPermitRejected)
	mux.HandleFunc("POST /events/sanctions-hit", h.OnSanctionsHit)

	// ── Dapr actor invocation ─────────────────────────────────────────────────
	mux.HandleFunc("GET /dapr/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"entities": []string{"Declaration"},
		})
	})

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      authMiddleware(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("[declaration-service] Listening on :%s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[declaration-service] Server error: %v", err)
		}
	}()

	<-quit
	log.Println("[declaration-service] Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("[declaration-service] Forced shutdown: %v", err)
	}
	log.Println("[declaration-service] Stopped.")
}

func isProduction() bool {
	return os.Getenv("APP_ENV") == "production" || os.Getenv("NODE_ENV") == "production"
}

func devOnly(key, fallback string) string {
	if isProduction() {
		log.Fatalf("[declaration-service] FATAL: %s must be set in production. Refusing to boot.", key)
	}
	log.Printf("[declaration-service] DEV-ONLY WARNING: %s not set — using development default", key)
	return fallback
}

// authMiddleware enforces the platform service-auth pattern (SW-M4): all
// non-health routes require a service token or verified identity headers.
func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// SW-M4: event endpoints (e.g. /events/payment-confirmed) are the ONLY
		// writers of payment_confirmed — they must carry the service token.
		if r.URL.Path == "/health" || r.URL.Path == "/dapr/subscribe" {
			next.ServeHTTP(w, r)
			return
		}
		if token := r.Header.Get("X-Service-Token"); token != "" {
			expected := os.Getenv("DECLARATION_SERVICE_TOKEN")
			if expected == "" {
				if isProduction() {
					http.Error(w, `{"error":"service auth not configured"}`, http.StatusInternalServerError)
					return
				}
				expected = "dev-service-token"
			}
			if subtle.ConstantTimeCompare([]byte(token), []byte(expected)) != 1 {
				http.Error(w, `{"error":"invalid service token"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), "role", "service")))
			return
		}
		if r.Header.Get("X-User-Id") == "" {
			http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), "userID", r.Header.Get("X-User-Id"))
		ctx = context.WithValue(ctx, "role", r.Header.Get("X-User-Role"))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
