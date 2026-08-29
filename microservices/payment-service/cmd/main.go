// payment-service — TradeGateway NGSWTP
// Handles duty payment lifecycle: invoice creation, Mojaloop payment initiation,
// TigerBeetle double-entry ledger recording, and payment confirmation events.
// Communicates via Dapr pub/sub (Kafka) and exposes HTTP endpoints.
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

	"github.com/tradegateway/payment-service/internal/handlers"
	"github.com/tradegateway/payment-service/internal/pubsub"
	"github.com/tradegateway/payment-service/internal/store"
	"github.com/tradegateway/payment-service/internal/temporal"
	"github.com/tradegateway/payment-service/internal/tigerbeetle"
)

func main() {
	port := getEnv("PORT", "8082")
	daprPort := getEnv("DAPR_HTTP_PORT", "3502")
	// SW-M3: no secret defaults. DATABASE_URL is mandatory in production.
	dbURL := getEnv("DATABASE_URL", devOnly("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"))
	tbAddr := getEnv("TIGERBEETLE_ADDRESS", "localhost:3000")
	mojaloopURL := getEnv("MOJALOOP_URL", "http://localhost:3001")
	temporalAddr := getEnv("TEMPORAL_ADDRESS", "localhost:7233")
	if isProduction() && os.Getenv("PAYMENT_SERVICE_TOKEN") == "" {
		log.Fatal("[payment-service] FATAL: PAYMENT_SERVICE_TOKEN must be set in production (service auth). Refusing to boot.")
	}

	log.Printf("[payment-service] Starting on port %s", port)

	// Initialize store (PostgreSQL)
	st, err := store.New(dbURL)
	if err != nil {
		log.Fatalf("[payment-service] DB connection failed: %v", err)
	}
	defer st.Close()

	// Initialize TigerBeetle client.
	// SW-M3: FAIL CLOSED — an unavailable ledger is a boot-fatal error in
	// production. The mock is strictly a development convenience.
	tb, tbErr := tigerbeetle.New(tbAddr)
	if tbErr != nil {
		if isProduction() {
			log.Fatalf("[payment-service] FATAL: TigerBeetle unavailable (%v) — refusing to boot without a ledger", tbErr)
		}
		log.Printf("[payment-service] DEV-ONLY WARNING: TigerBeetle unavailable (%v) — using in-memory mock. This would be fatal in production.", tbErr)
		tb = tigerbeetle.NewMock()
	}
	// Seed the five standard ledger accounts (idempotent — safe to call on every startup).
	// Runs in a goroutine so it does not block the HTTP server from starting.
	go tigerbeetle.SeedAccounts(tb)

	// Initialize Temporal client (graceful degradation if unavailable)
	tc := temporal.New(temporalAddr)
	defer tc.Close()

	// Initialize Dapr pub/sub client
	ps := pubsub.New(daprPort)

	// Initialize handlers
	h := handlers.New(st, ps, tb, tc, mojaloopURL)

	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":              "ok",
			"service":             "payment-service",
			"version":             "1.0.0",
			"tigerbeetleOnline":   tbErr == nil,
			"time":                time.Now().UTC(),
		})
	})

	// ── Payment endpoints ─────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/payments/invoices", h.CreateInvoice)
	mux.HandleFunc("GET /api/payments/invoices/{id}", h.GetInvoice)
	mux.HandleFunc("GET /api/payments/declarations/{declarationId}", h.GetPaymentsByDeclaration)
	mux.HandleFunc("POST /api/payments/invoices/{id}/initiate", h.InitiatePayment)
	mux.HandleFunc("POST /api/payments/invoices/{id}/confirm", h.ConfirmPayment)
	mux.HandleFunc("POST /api/payments/invoices/{id}/refund", h.InitiateRefund)

	// ── Mojaloop webhook ──────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/payments/mojaloop/callback", h.MojaloopCallback)

	// ── TigerBeetle ledger queries ────────────────────────────────────────────
	mux.HandleFunc("GET /api/payments/ledger/accounts/{id}", h.GetLedgerAccount)
	mux.HandleFunc("GET /api/payments/ledger/transfers/{id}", h.GetLedgerTransfer)

	// ── Dapr subscriptions ────────────────────────────────────────────────────
	mux.HandleFunc("GET /dapr/subscribe", func(w http.ResponseWriter, r *http.Request) {
		subs := []map[string]interface{}{
			{"pubsubname": "kafka-pubsub", "topic": "declaration.submitted", "route": "/events/declaration-submitted"},
			{"pubsubname": "kafka-pubsub", "topic": "declaration.cleared", "route": "/events/declaration-cleared"},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(subs)
	})
	mux.HandleFunc("POST /events/declaration-submitted", h.OnDeclarationSubmitted)
	mux.HandleFunc("POST /events/declaration-cleared", h.OnDeclarationCleared)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      authMiddleware(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("[payment-service] Listening on :%s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[payment-service] Server error: %v", err)
		}
	}()

	<-quit
	log.Println("[payment-service] Shutting down...")
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

func isProduction() bool {
	return os.Getenv("APP_ENV") == "production" || os.Getenv("NODE_ENV") == "production"
}

// devOnly returns the fallback outside production and refuses to boot in
// production when the variable is unset (no secret/dev defaults in prod).
func devOnly(key, fallback string) string {
	if isProduction() {
		log.Fatalf("[payment-service] FATAL: %s must be set in production — no default exists. Refusing to boot.", key)
	}
	log.Printf("[payment-service] DEV-ONLY WARNING: %s not set — using development default", key)
	return fallback
}

// authMiddleware enforces the platform service-auth pattern (SW-M3):
// every non-health request must carry either a valid X-Service-Token
// (service-to-service, incl. the Mojaloop switch callback) or verified
// caller identity headers (X-User-Id / X-User-Role) from the gateway.
func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || r.URL.Path == "/dapr/subscribe" {
			next.ServeHTTP(w, r)
			return
		}
		if token := r.Header.Get("X-Service-Token"); token != "" {
			expected := os.Getenv("PAYMENT_SERVICE_TOKEN")
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
			ctx := context.WithValue(r.Context(), "role", "service")
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		uid := r.Header.Get("X-User-Id")
		if uid == "" {
			http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), "userID", uid)
		ctx = context.WithValue(ctx, "role", r.Header.Get("X-User-Role"))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
