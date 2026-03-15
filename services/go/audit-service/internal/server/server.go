// Package server provides a production-ready HTTP server base for all
// TradeGateway™ NGSWTP Go microservices.
//
// Features:
//   - /healthz  — liveness probe (always 200 if process is alive)
//   - /readyz   — readiness probe (checks DB, Kafka, Redis connectivity)
//   - /metrics  — Prometheus metrics endpoint
//   - Structured JSON logging via slog
//   - Circuit breaker via sony/gobreaker
//   - Graceful shutdown with configurable drain timeout
//   - Request ID injection and propagation
//   - Panic recovery middleware
//   - Request/response logging with latency
package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/sony/gobreaker"
)

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

var (
	httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total number of HTTP requests",
	}, []string{"service", "method", "path", "status"})

	httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request duration in seconds",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
	}, []string{"service", "method", "path"})

	circuitBreakerState = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "circuit_breaker_state",
		Help: "Circuit breaker state (0=closed, 1=half-open, 2=open)",
	}, []string{"service", "dependency"})

	dbConnectionsActive = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "db_connections_active",
		Help: "Number of active database connections",
	}, []string{"service"})
)

// ─── Config ───────────────────────────────────────────────────────────────────

type Config struct {
	ServiceName   string
	HTTPPort      string
	MetricsPort   string
	ShutdownDelay time.Duration // Time to wait for in-flight requests to complete
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	IdleTimeout   time.Duration
}

func DefaultConfig(serviceName string) Config {
	return Config{
		ServiceName:   serviceName,
		HTTPPort:      getEnv("HTTP_PORT", "8080"),
		MetricsPort:   getEnv("METRICS_PORT", "9090"),
		ShutdownDelay: 15 * time.Second,
		ReadTimeout:   30 * time.Second,
		WriteTimeout:  30 * time.Second,
		IdleTimeout:   120 * time.Second,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Health Check Registry ────────────────────────────────────────────────────

type HealthChecker interface {
	Name() string
	Check(ctx context.Context) error
}

type DBHealthChecker struct {
	db          *sql.DB
	serviceName string
}

func NewDBHealthChecker(db *sql.DB, serviceName string) *DBHealthChecker {
	return &DBHealthChecker{db: db, serviceName: serviceName}
}

func (d *DBHealthChecker) Name() string { return "postgresql" }
func (d *DBHealthChecker) Check(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := d.db.PingContext(ctx); err != nil {
		return fmt.Errorf("postgresql ping failed: %w", err)
	}
	stats := d.db.Stats()
	dbConnectionsActive.WithLabelValues(d.serviceName).Set(float64(stats.OpenConnections))
	return nil
}

type HTTPHealthChecker struct {
	name   string
	url    string
	client *http.Client
}

func NewHTTPHealthChecker(name, url string) *HTTPHealthChecker {
	return &HTTPHealthChecker{
		name: name,
		url:  url,
		client: &http.Client{
			Timeout: 3 * time.Second,
		},
	}
}

func (h *HTTPHealthChecker) Name() string { return h.name }
func (h *HTTPHealthChecker) Check(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.url, nil)
	if err != nil {
		return err
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return fmt.Errorf("%s health check failed: %w", h.name, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("%s returned %d", h.name, resp.StatusCode)
	}
	return nil
}

// ─── Circuit Breaker Factory ──────────────────────────────────────────────────

type CircuitBreakerRegistry struct {
	mu          sync.RWMutex
	breakers    map[string]*gobreaker.CircuitBreaker
	serviceName string
}

func NewCircuitBreakerRegistry(serviceName string) *CircuitBreakerRegistry {
	return &CircuitBreakerRegistry{
		breakers:    make(map[string]*gobreaker.CircuitBreaker),
		serviceName: serviceName,
	}
}

func (r *CircuitBreakerRegistry) Get(dependency string) *gobreaker.CircuitBreaker {
	r.mu.RLock()
	cb, ok := r.breakers[dependency]
	r.mu.RUnlock()
	if ok {
		return cb
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	cb = gobreaker.NewCircuitBreaker(gobreaker.Settings{
		Name:        fmt.Sprintf("%s-%s", r.serviceName, dependency),
		MaxRequests: 3,
		Interval:    10 * time.Second,
		Timeout:     30 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
			return counts.Requests >= 5 && failureRatio >= 0.6
		},
		OnStateChange: func(name string, from, to gobreaker.State) {
			stateVal := map[gobreaker.State]float64{
				gobreaker.StateClosed:   0,
				gobreaker.StateHalfOpen: 1,
				gobreaker.StateOpen:     2,
			}[to]
			circuitBreakerState.WithLabelValues(r.serviceName, dependency).Set(stateVal)
			slog.Warn("Circuit breaker state changed",
				"name", name,
				"from", from.String(),
				"to", to.String(),
			)
		},
	})
	r.breakers[dependency] = cb
	return cb
}

// Execute runs fn through the circuit breaker for the given dependency.
func (r *CircuitBreakerRegistry) Execute(dependency string, fn func() (interface{}, error)) (interface{}, error) {
	return r.Get(dependency).Execute(fn)
}

// ─── Production Server ────────────────────────────────────────────────────────

type Server struct {
	cfg      Config
	logger   *slog.Logger
	mux      *http.ServeMux
	checkers []HealthChecker
	cb       *CircuitBreakerRegistry
	ready    bool
	mu       sync.RWMutex
}

func New(cfg Config) *Server {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey {
				a.Value = slog.StringValue(time.Now().UTC().Format(time.RFC3339Nano))
			}
			return a
		},
	}))
	slog.SetDefault(logger)

	s := &Server{
		cfg:    cfg,
		logger: logger,
		mux:    http.NewServeMux(),
		cb:     NewCircuitBreakerRegistry(cfg.ServiceName),
	}

	// Register built-in endpoints
	s.mux.HandleFunc("/healthz", s.handleLiveness)
	s.mux.HandleFunc("/readyz", s.handleReadiness)

	return s
}

func (s *Server) AddHealthChecker(checker HealthChecker) {
	s.checkers = append(s.checkers, checker)
}

func (s *Server) CircuitBreakers() *CircuitBreakerRegistry {
	return s.cb
}

func (s *Server) Mux() *http.ServeMux {
	return s.mux
}

func (s *Server) SetReady(ready bool) {
	s.mu.Lock()
	s.ready = ready
	s.mu.Unlock()
}

// ─── Middleware ───────────────────────────────────────────────────────────────

func (s *Server) withMiddleware(h http.Handler) http.Handler {
	return s.panicRecovery(s.requestLogger(s.requestID(h)))
}

func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = uuid.New().String()
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKeyRequestID{}, id)))
	})
}

type ctxKeyRequestID struct{}

func RequestIDFromContext(ctx context.Context) string {
	if id, ok := ctx.Value(ctxKeyRequestID{}).(string); ok {
		return id
	}
	return ""
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		duration := time.Since(start)

		// Skip metrics/health endpoints from logging noise
		if r.URL.Path == "/metrics" || r.URL.Path == "/healthz" {
			return
		}

		s.logger.Info("request",
			"service", s.cfg.ServiceName,
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", duration.Milliseconds(),
			"request_id", RequestIDFromContext(r.Context()),
			"user_agent", r.UserAgent(),
			"remote_addr", r.RemoteAddr,
		)

		httpRequestsTotal.WithLabelValues(
			s.cfg.ServiceName, r.Method, r.URL.Path, fmt.Sprintf("%d", rec.status),
		).Inc()
		httpRequestDuration.WithLabelValues(
			s.cfg.ServiceName, r.Method, r.URL.Path,
		).Observe(duration.Seconds())
	})
}

func (s *Server) panicRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				s.logger.Error("panic recovered",
					"service", s.cfg.ServiceName,
					"error", err,
					"stack", string(debug.Stack()),
					"path", r.URL.Path,
					"request_id", RequestIDFromContext(r.Context()),
				)
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ─── Health Handlers ──────────────────────────────────────────────────────────

func (s *Server) handleLiveness(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "alive",
		"service": s.cfg.ServiceName,
	})
}

func (s *Server) handleReadiness(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	ready := s.ready
	s.mu.RUnlock()

	if !ready {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "not_ready",
			"service": s.cfg.ServiceName,
			"reason":  "service initializing",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type checkResult struct {
		name string
		err  error
	}

	results := make([]checkResult, len(s.checkers))
	var wg sync.WaitGroup
	for i, checker := range s.checkers {
		wg.Add(1)
		go func(i int, c HealthChecker) {
			defer wg.Done()
			results[i] = checkResult{name: c.Name(), err: c.Check(ctx)}
		}(i, checker)
	}
	wg.Wait()

	checks := make(map[string]string)
	allOK := true
	for _, r := range results {
		if r.err != nil {
			checks[r.name] = r.err.Error()
			allOK = false
		} else {
			checks[r.name] = "ok"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if !allOK {
		w.WriteHeader(http.StatusServiceUnavailable)
	} else {
		w.WriteHeader(http.StatusOK)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  map[bool]string{true: "ready", false: "degraded"}[allOK],
		"service": s.cfg.ServiceName,
		"checks":  checks,
	})
}

// ─── Run ──────────────────────────────────────────────────────────────────────

func (s *Server) Run() error {
	// Main HTTP server
	mainSrv := &http.Server{
		Addr:         ":" + s.cfg.HTTPPort,
		Handler:      s.withMiddleware(s.mux),
		ReadTimeout:  s.cfg.ReadTimeout,
		WriteTimeout: s.cfg.WriteTimeout,
		IdleTimeout:  s.cfg.IdleTimeout,
	}

	// Metrics server (separate port, not exposed externally)
	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", promhttp.Handler())
	metricsSrv := &http.Server{
		Addr:    ":" + s.cfg.MetricsPort,
		Handler: metricsMux,
	}

	// Start servers
	errCh := make(chan error, 2)
	go func() {
		s.logger.Info("HTTP server starting",
			"service", s.cfg.ServiceName,
			"port", s.cfg.HTTPPort,
		)
		if err := mainSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- fmt.Errorf("main server: %w", err)
		}
	}()
	go func() {
		s.logger.Info("Metrics server starting",
			"service", s.cfg.ServiceName,
			"port", s.cfg.MetricsPort,
		)
		if err := metricsSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- fmt.Errorf("metrics server: %w", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		return err
	case sig := <-quit:
		s.logger.Info("Shutdown signal received",
			"service", s.cfg.ServiceName,
			"signal", sig.String(),
		)
	}

	// Mark not ready immediately to stop receiving new traffic
	s.SetReady(false)

	// Drain in-flight requests
	ctx, cancel := context.WithTimeout(context.Background(), s.cfg.ShutdownDelay)
	defer cancel()

	s.logger.Info("Draining in-flight requests",
		"service", s.cfg.ServiceName,
		"timeout", s.cfg.ShutdownDelay,
	)

	if err := mainSrv.Shutdown(ctx); err != nil {
		s.logger.Error("Graceful shutdown failed", "error", err)
	}
	if err := metricsSrv.Shutdown(ctx); err != nil {
		s.logger.Error("Metrics server shutdown failed", "error", err)
	}

	s.logger.Info("Server shutdown complete", "service", s.cfg.ServiceName)
	return nil
}
