// TigerBeetle Bridge Service — TradeGateway NGSWTP
// Language: Go 1.23 | Framework: Chi HTTP + gRPC
// Role: Wraps TigerBeetle's binary protocol behind a JSON REST API and gRPC
//       interface. Provides double-entry bookkeeping for all duty payments,
//       penalties, bonds, drawbacks, and refunds.
//
// Account model (WCO financial ledger):
//   Ledger 1 (GHS — Ghana Cedi):
//     Account 1001 — Trader Liability (debit side of duty payments)
//     Account 2001 — Customs Revenue Confirmed (credit side)
//     Account 2002 — Customs Revenue Pending (two-phase reserve)
//     Account 3001 — Bond/Security Deposits
//     Account 4001 — Drawback/Refund Payable
//
// Two-phase payment flow:
//   1. POST /api/ledger/transfers/pending   → reserve funds (debit trader, credit pending)
//   2. POST /api/ledger/transfers/post/{pendingId}  → finalize
//   3. POST /api/ledger/transfers/void/{pendingId}  → cancel reservation
//
// Endpoints:
//   GET  /health
//   POST /api/ledger/accounts
//   GET  /api/ledger/accounts/:id
//   GET  /api/ledger/accounts/:id/balance
//   POST /api/ledger/transfers
//   POST /api/ledger/transfers/pending
//   POST /api/ledger/transfers/post/:pendingId
//   POST /api/ledger/transfers/void/:pendingId
//   GET  /api/ledger/transfers/:id
//   GET  /api/ledger/accounts/:id/transfers
//   GET  /api/ledger/summary
//
// Backends (internal/backend):
//   - LiveBackend (build tag `tigerbeetle`, CGO) — production TigerBeetle cluster.
//   - SimBackend  (default build) — DEV/CI ONLY. Refuses to boot when
//     ENVIRONMENT/APP_ENV/NODE_ENV=production unless TB_ALLOW_SIM_BACKEND=1.
//
// Amounts are integer minor units end-to-end (e.g. pesewas for GHS).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	"github.com/tradegateway/tigerbeetle-bridge/internal/backend"
)

// ─── Configuration ────────────────────────────────────────────────────────────

var (
	httpPort        = getEnv("TB_BRIDGE_HTTP_PORT", "8086")
	grpcPort        = getEnv("TB_BRIDGE_GRPC_PORT", "9086")
	tigerBeetleAddr = getEnv("TIGERBEETLE_ADDR", "tigerbeetle:3000")
)

// ─── Service ──────────────────────────────────────────────────────────────────

type TigerBeetleBridge struct {
	logger *zap.Logger
	be     backend.Backend
	tbAddr string
}

func NewBridge(logger *zap.Logger) (*TigerBeetleBridge, error) {
	be, err := backend.NewBackend(tigerBeetleAddr, 0)
	if err != nil {
		return nil, err
	}
	logger.Info("ledger backend initialised",
		zap.String("mode", be.Mode()),
		zap.String("tbAddr", tigerBeetleAddr),
	)
	return &TigerBeetleBridge{
		logger: logger,
		be:     be,
		tbAddr: tigerBeetleAddr,
	}, nil
}

// ─── HTTP handlers ─────────────────────────────────────────────────────────────

// parseMinorAmount parses an integer minor-units amount from a JSON value that
// may be a number or a string. Fractional values are rejected (fail-closed:
// money is integer minor units end-to-end).
func parseMinorAmount(v interface{}) (int64, error) {
	switch n := v.(type) {
	case float64:
		if n != float64(int64(n)) {
			return 0, fmt.Errorf("amount must be integer minor units, got %v", n)
		}
		return int64(n), nil
	case string:
		v, err := strconv.ParseInt(strings.TrimSpace(n), 10, 64)
		if err != nil {
			return 0, fmt.Errorf("amount must be integer minor units: %v", err)
		}
		return v, nil
	default:
		return 0, fmt.Errorf("amount must be a number or numeric string")
	}
}

func (b *TigerBeetleBridge) handleCreateAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID          string              `json:"id"`
		Ledger      uint32              `json:"ledger"`
		Code        uint16              `json:"code"`
		AccountType backend.AccountType `json:"accountType"`
		Description string              `json:"description"`
		Currency    string              `json:"currency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.ID == "" {
		req.ID = uuid.New().String()
	}
	if req.Currency == "" {
		req.Currency = "GHS"
	}
	if req.Ledger == 0 {
		req.Ledger = 1
	}
	acct := &backend.Account{
		ID:          req.ID,
		Ledger:      req.Ledger,
		Code:        req.Code,
		AccountType: req.AccountType,
		Description: req.Description,
		Currency:    req.Currency,
	}
	if err := b.be.CreateAccount(acct); err != nil {
		jsonError(w, err.Error(), http.StatusConflict)
		return
	}
	b.logger.Info("account created", zap.String("id", acct.ID), zap.String("type", string(acct.AccountType)))
	jsonOK(w, acct)
}

func (b *TigerBeetleBridge) handleGetAccount(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	acct, ok := b.be.GetAccount(id)
	if !ok {
		jsonError(w, "account not found", http.StatusNotFound)
		return
	}
	jsonOK(w, acct)
}

func (b *TigerBeetleBridge) handleGetBalance(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	acct, ok := b.be.GetAccount(id)
	if !ok {
		jsonError(w, "account not found", http.StatusNotFound)
		return
	}
	jsonOK(w, map[string]interface{}{
		"accountId":      acct.ID,
		"currency":       acct.Currency,
		"balance":        acct.BalanceMinor(),
		"debitsPosted":   acct.DebitsPosted,
		"creditsPosted":  acct.CreditsPosted,
		"debitsPending":  acct.DebitsPending,
		"creditsPending": acct.CreditsPending,
		"timestamp":      time.Now().UTC(),
	})
}

func (b *TigerBeetleBridge) handlePostTransfer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DebitAccountID  string      `json:"debitAccountId"`
		CreditAccountID string      `json:"creditAccountId"`
		Amount          interface{} `json:"amount"`
		Currency        string      `json:"currency"`
		Ledger          uint32      `json:"ledger"`
		Code            uint16      `json:"code"`
		Flag            string      `json:"flag"`
		PendingID       string      `json:"pendingId,omitempty"`
		Reference       string      `json:"reference,omitempty"`
		Description     string      `json:"description,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.DebitAccountID == "" || req.CreditAccountID == "" || req.Amount == nil {
		jsonError(w, "debitAccountId, creditAccountId, and amount are required", http.StatusBadRequest)
		return
	}
	amount, err := parseMinorAmount(req.Amount)
	if err != nil || amount <= 0 {
		jsonError(w, "amount must be a positive integer in minor units", http.StatusBadRequest)
		return
	}
	if req.Currency == "" {
		req.Currency = "GHS"
	}
	if req.Ledger == 0 {
		req.Ledger = 1
	}
	flag := backend.TransferFlag(req.Flag)
	if flag == "" {
		flag = backend.FlagNone
	}
	t := &backend.Transfer{
		ID:              uuid.New().String(),
		DebitAccountID:  req.DebitAccountID,
		CreditAccountID: req.CreditAccountID,
		Amount:          amount,
		Currency:        req.Currency,
		Ledger:          req.Ledger,
		Code:            req.Code,
		Flag:            flag,
		PendingID:       req.PendingID,
		Reference:       req.Reference,
		Description:     req.Description,
	}
	if err := b.be.PostTransfer(t); err != nil {
		jsonError(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	b.logger.Info("transfer posted",
		zap.String("id", t.ID),
		zap.String("flag", string(t.Flag)),
		zap.Int64("amountMinor", t.Amount),
		zap.String("status", t.Status),
	)
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handlePendingTransfer(w http.ResponseWriter, r *http.Request) {
	// Convenience endpoint: always sets flag=pending
	var req struct {
		DebitAccountID  string      `json:"debitAccountId"`
		CreditAccountID string      `json:"creditAccountId"`
		Amount          interface{} `json:"amount"`
		Currency        string      `json:"currency"`
		Reference       string      `json:"reference,omitempty"`
		Description     string      `json:"description,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	amount, err := parseMinorAmount(req.Amount)
	if err != nil || amount <= 0 {
		jsonError(w, "amount must be a positive integer in minor units", http.StatusBadRequest)
		return
	}
	if req.Currency == "" {
		req.Currency = "GHS"
	}
	t := &backend.Transfer{
		ID:              uuid.New().String(),
		DebitAccountID:  req.DebitAccountID,
		CreditAccountID: req.CreditAccountID,
		Amount:          amount,
		Currency:        req.Currency,
		Ledger:          1,
		Flag:            backend.FlagPending,
		Reference:       req.Reference,
		Description:     req.Description,
	}
	if err := b.be.PostTransfer(t); err != nil {
		jsonError(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	b.logger.Info("pending transfer created", zap.String("id", t.ID), zap.Int64("amountMinor", t.Amount))
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handlePostPending(w http.ResponseWriter, r *http.Request) {
	pendingID := chi.URLParam(r, "pendingId")
	pending, ok := b.be.GetTransfer(pendingID)
	if !ok {
		jsonError(w, "pending transfer not found", http.StatusNotFound)
		return
	}
	// Post: debit customs_revenue_pending, credit customs_revenue_confirmed
	t := &backend.Transfer{
		ID:              uuid.New().String(),
		DebitAccountID:  pending.CreditAccountID, // reverse: pending credit becomes debit
		CreditAccountID: "0000000000000003",       // customs_revenue_confirmed
		Amount:          pending.Amount,
		Currency:        pending.Currency,
		Ledger:          1,
		Flag:            backend.FlagPostPendingTransfer,
		PendingID:       pendingID,
		Reference:       pending.Reference,
		Description:     fmt.Sprintf("Post of pending transfer %s", pendingID),
	}
	if err := b.be.PostTransfer(t); err != nil {
		jsonError(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	b.logger.Info("pending transfer posted", zap.String("pendingId", pendingID), zap.String("postId", t.ID))
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handleVoidPending(w http.ResponseWriter, r *http.Request) {
	pendingID := chi.URLParam(r, "pendingId")
	pending, ok := b.be.GetTransfer(pendingID)
	if !ok {
		jsonError(w, "pending transfer not found", http.StatusNotFound)
		return
	}
	t := &backend.Transfer{
		ID:              uuid.New().String(),
		DebitAccountID:  pending.DebitAccountID,
		CreditAccountID: pending.CreditAccountID,
		Amount:          pending.Amount,
		Currency:        pending.Currency,
		Ledger:          1,
		Flag:            backend.FlagVoidPendingTransfer,
		PendingID:       pendingID,
		Description:     fmt.Sprintf("Void of pending transfer %s", pendingID),
	}
	if err := b.be.PostTransfer(t); err != nil {
		jsonError(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	b.logger.Info("pending transfer voided", zap.String("pendingId", pendingID))
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handleGetTransfer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	t, ok := b.be.GetTransfer(id)
	if !ok {
		jsonError(w, "transfer not found", http.StatusNotFound)
		return
	}
	jsonOK(w, t)
}

func (b *TigerBeetleBridge) handleGetAccountTransfers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	transfers := b.be.GetTransfersByAccount(id, limit)
	jsonOK(w, map[string]interface{}{
		"accountId": id,
		"transfers": transfers,
		"count":     len(transfers),
	})
}

func (b *TigerBeetleBridge) handleSummary(w http.ResponseWriter, r *http.Request) {
	accounts := b.be.GetAllAccounts()
	recentTransfers := b.be.GetRecentTransfers(20)

	var totalRevenue int64
	var pendingRevenue int64
	for _, a := range accounts {
		if a.AccountType == backend.AccountCustomsRevenueConf {
			totalRevenue += a.CreditsPosted
		}
		if a.AccountType == backend.AccountCustomsRevenuePend {
			pendingRevenue += a.CreditsPending
		}
	}

	jsonOK(w, map[string]interface{}{
		"accounts":        accounts,
		"recentTransfers": recentTransfers,
		"summary": map[string]interface{}{
			"totalRevenueConfirmed": totalRevenue,
			"totalRevenuePending":   pendingRevenue,
			"currency":              "GHS",
			"timestamp":             time.Now().UTC(),
			"tigerBeetleAddr":       b.tbAddr,
			"mode":                  b.be.Mode(),
		},
	})
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	// Distroless-safe container healthcheck: the runtime image has no shell,
	// wget, or curl, so compose/k8s exec probes invoke the binary itself.
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get("http://127.0.0.1:" + httpPort + "/health")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	logger, _ := zap.NewProduction()
	defer logger.Sync()

	bridge, err := NewBridge(logger)
	if err != nil {
		logger.Fatal("failed to initialise ledger backend", zap.Error(err))
	}
	defer bridge.be.Close()

	// HTTP router
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Service", "tigerbeetle-bridge")
			next.ServeHTTP(w, r)
		})
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, map[string]interface{}{
			"status":  "ok",
			"service": "tigerbeetle-bridge",
			"tbAddr":  tigerBeetleAddr,
			"mode":    bridge.be.Mode(),
		})
	})

	r.Route("/api/ledger", func(r chi.Router) {
		r.Post("/accounts", bridge.handleCreateAccount)
		r.Get("/accounts/{id}", bridge.handleGetAccount)
		r.Get("/accounts/{id}/balance", bridge.handleGetBalance)
		r.Get("/accounts/{id}/transfers", bridge.handleGetAccountTransfers)

		r.Post("/transfers", bridge.handlePostTransfer)
		r.Post("/transfers/pending", bridge.handlePendingTransfer)
		r.Post("/transfers/post/{pendingId}", bridge.handlePostPending)
		r.Post("/transfers/void/{pendingId}", bridge.handleVoidPending)
		r.Get("/transfers/{id}", bridge.handleGetTransfer)

		r.Get("/summary", bridge.handleSummary)
	})

	// gRPC server (health check + reflection for service mesh)
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		logger.Fatal("failed to listen for gRPC", zap.Error(err))
	}
	grpcServer := grpc.NewServer()
	healthSvc := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthSvc)
	healthSvc.SetServingStatus("tigerbeetle-bridge", grpc_health_v1.HealthCheckResponse_SERVING)
	reflection.Register(grpcServer)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	httpServer := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		logger.Info("TigerBeetle Bridge HTTP server starting", zap.String("port", httpPort))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("HTTP server error", zap.Error(err))
		}
	}()

	go func() {
		logger.Info("TigerBeetle Bridge gRPC server starting", zap.String("port", grpcPort))
		if err := grpcServer.Serve(lis); err != nil {
			logger.Fatal("gRPC server error", zap.Error(err))
		}
	}()

	<-quit
	logger.Info("Shutting down TigerBeetle Bridge...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	httpServer.Shutdown(ctx)
	grpcServer.GracefulStop()
}
