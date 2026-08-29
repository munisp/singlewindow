// admin_server.go — Lightweight HTTP server for operational endpoints.
//
// Exposes:
//
//	GET  /healthz                  — liveness probe (returns 200 OK)
//	POST /admin/refresh-tokens     — triggers an immediate token-refresh cycle
//	                                 outside the normal 6-hour interval
//	GET  /admin/metrics            — returns TokenRefresher stats as JSON
//
// The admin server is started alongside the main dispatcher goroutine and
// listens on port 8081 (configurable via ADMIN_PORT env var).
// It is intentionally separate from the Kafka consumer loop so that a stuck
// consumer does not block health checks.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"time"
)

// AdminServer wraps an http.Server and holds a reference to the TokenRefresher
// so the /admin/refresh-tokens handler can trigger an immediate cycle.
type AdminServer struct {
	server    *http.Server
	refresher *TokenRefresher
}

// NewAdminServer creates an AdminServer bound to addr (e.g. ":8081").
func NewAdminServer(addr string, refresher *TokenRefresher) *AdminServer {
	mux := http.NewServeMux()
	as := &AdminServer{refresher: refresher}

	// Liveness probe — always returns 200.
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Expose TokenRefresher statistics as JSON.
	mux.HandleFunc("GET /admin/metrics", func(w http.ResponseWriter, r *http.Request) {
		stats := as.refresher.Stats()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"total_cycles":     stats.TotalCycles,
			"total_validated":  stats.TotalValidated,
			"total_stale":      stats.TotalStale,
			"total_purged":     stats.TotalPurged,
			"last_cycle_at_ms": stats.LastCycleAt,
		})
	})

	// Trigger an immediate token-refresh cycle.
	// Called by the nightly CronJob (see infra/k8s/notification-dispatcher-token-refresh-cronjob.yaml).
	mux.HandleFunc("POST /admin/refresh-tokens", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// Run the cycle in a goroutine so the HTTP response returns immediately.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			log.Println("[admin] manual token-refresh cycle triggered")
			as.refresher.runCycle(ctx)
			log.Println("[admin] manual token-refresh cycle complete")
		}()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":  "accepted",
			"message": "Token refresh cycle started in background",
		})
	})

	// POST /admin/force-refresh — synchronous variant of refresh-tokens.
	// Waits for the cycle to complete (up to 30s) and returns the updated stats.
	// Used by the tRPC forceTokenRefresh procedure for operator-triggered refreshes.
	mux.HandleFunc("POST /admin/force-refresh", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		log.Println("[admin] force-refresh requested")
		as.refresher.runCycle(ctx)
		stats := as.refresher.Stats()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"triggered":       true,
			"total_cycles":    stats.TotalCycles,
			"total_validated": stats.TotalValidated,
			"total_stale":     stats.TotalStale,
			"total_purged":    stats.TotalPurged,
			"message":         "Force refresh complete",
		})
	})

	as.server = &http.Server{
		Addr:         addr,
		Handler:      tracedHandler("notification-dispatcher.admin", mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	return as
}

// Start begins listening and serving.  It blocks until the server stops.
// Call Shutdown to stop it gracefully.
func (as *AdminServer) Start() error {
	ln, err := net.Listen("tcp", as.server.Addr)
	if err != nil {
		return fmt.Errorf("admin server listen %s: %w", as.server.Addr, err)
	}
	log.Printf("[admin] listening on %s", as.server.Addr)
	return as.server.Serve(ln)
}

// Shutdown gracefully stops the admin server.
func (as *AdminServer) Shutdown(ctx context.Context) error {
	return as.server.Shutdown(ctx)
}
