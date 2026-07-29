// tigerbeetle-bridge — TradeGateway NGSWTP
//
// Go gRPC service wrapping TigerBeetle for double-entry financial ledger.
// Uses the official tigerbeetle-go client for durable, ACID-compliant
// double-entry bookkeeping. Every transfer is two-phase (pending → post/void)
// to guarantee atomicity across Mojaloop settlement and duty collection.
//
// Middleware integrations:
//   - TigerBeetle — double-entry ledger (uint128 account IDs)
//   - PostgreSQL   — audit trail and account metadata
//   - Prometheus   — metrics on :9094/metrics
//   - Redis        — idempotency key cache (TTL 24h)
//
// Environment variables:
//   GRPC_PORT              (default: 50055)
//   TIGERBEETLE_ADDRESSES  comma-separated TB cluster addresses (default: 3000)
//   TIGERBEETLE_CLUSTER_ID (default: 0)
//   DATABASE_URL           PostgreSQL connection string
//   REDIS_URL              Redis connection string
//   METRICS_PORT           (default: 9094)
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-redis/redis/v8"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	tb "github.com/tigerbeetle/tigerbeetle-go"
	tbtypes "github.com/tigerbeetle/tigerbeetle-go/pkg/types"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "github.com/tradegateway/tigerbeetle-bridge/proto"
)

// ─── Constants ────────────────────────────────────────────────────────────────

const (
	// Ledger IDs
	LedgerPrimary  uint32 = 1 // Main duty/revenue ledger (NGN/GHS)
	LedgerBond     uint32 = 2 // Customs bond ledger
	LedgerDrawback uint32 = 3 // Duty drawback ledger

	// Account codes
	AccountCodeTrader   uint16 = 1 // Trader debit account
	AccountCodeRevenue  uint16 = 2 // Customs revenue credit account
	AccountCodeBond     uint16 = 3 // Bond account
	AccountCodeDrawback uint16 = 4 // Drawback holding account

	// Transfer codes
	TransferCodeDutyPayment  uint16 = 1
	TransferCodeBondRelease  uint16 = 2
	TransferCodeDrawback     uint16 = 3
	TransferCodeRefund       uint16 = 4

	// Idempotency TTL
	IdempotencyTTL = 24 * time.Hour
)

// ─── Metrics ──────────────────────────────────────────────────────────────────

var (
	transfersTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "ledger_transfers_total", Help: "Total transfers processed"},
		[]string{"type", "status"},
	)
	transferDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "ledger_transfer_duration_seconds",
		Help:    "Transfer processing duration",
		Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0},
	})
	accountsCreated = prometheus.NewCounter(
		prometheus.CounterOpts{Name: "ledger_accounts_created_total", Help: "Accounts created"},
	)
)

func init() {
	prometheus.MustRegister(transfersTotal, transferDuration, accountsCreated)
}

// ─── Account ID encoding ──────────────────────────────────────────────────────

// encodeID deterministically encodes a string to a uint128 for TigerBeetle.
// Uses SHA-256 of the string, taking the first 16 bytes.
func encodeID(s string) tbtypes.Uint128 {
	h := sha256.Sum256([]byte(s))
	var id tbtypes.Uint128
	copy(id[:], h[:16])
	return id
}

// encodeInt64ID encodes an int64 to a uint128.
func encodeInt64ID(n int64) tbtypes.Uint128 {
	var id tbtypes.Uint128
	binary.LittleEndian.PutUint64(id[:8], uint64(n))
	return id
}

// ─── Service ──────────────────────────────────────────────────────────────────

type LedgerService struct {
	pb.UnimplementedLedgerServiceServer
	tb    tb.Client
	db    *sql.DB
	redis *redis.Client
}

func NewLedgerService(tbClient tb.Client, db *sql.DB, rdb *redis.Client) *LedgerService {
	return &LedgerService{tb: tbClient, db: db, redis: rdb}
}

// ─── Account Management ───────────────────────────────────────────────────────

func (s *LedgerService) CreateAccount(ctx context.Context, req *pb.CreateAccountRequest) (*pb.AccountResponse, error) {
	accountID := encodeID(req.AccountId)

	// Check idempotency via Redis
	cacheKey := fmt.Sprintf("tb:account:%s", req.AccountId)
	if cached, err := s.redis.Get(ctx, cacheKey).Result(); err == nil {
		return &pb.AccountResponse{AccountId: req.AccountId, Status: cached}, nil
	}

	var code uint16
	switch req.AccountType {
	case "trader":
		code = AccountCodeTrader
	case "revenue":
		code = AccountCodeRevenue
	case "bond":
		code = AccountCodeBond
	case "drawback":
		code = AccountCodeDrawback
	default:
		return nil, status.Errorf(codes.InvalidArgument, "unknown account type: %s", req.AccountType)
	}

	ledger := LedgerPrimary
	if req.Ledger != "" {
		switch req.Ledger {
		case "bond":
			ledger = LedgerBond
		case "drawback":
			ledger = LedgerDrawback
		}
	}

	accounts := []tbtypes.Account{
		{
			ID:     accountID,
			Ledger: ledger,
			Code:   code,
			Flags:  tbtypes.AccountFlags{}.ToUint16(),
		},
	}

	results, err := s.tb.CreateAccounts(accounts)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "TigerBeetle CreateAccounts: %v", err)
	}

	for _, r := range results {
		if r.Result != tbtypes.AccountOK && r.Result != tbtypes.AccountExistsWithSameFlags {
			return nil, status.Errorf(codes.AlreadyExists, "account creation failed: %v", r.Result)
		}
	}

	// Persist account metadata to PostgreSQL for audit
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO tb_accounts (account_id, account_type, ledger, created_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (account_id) DO NOTHING`,
		req.AccountId, req.AccountType, ledger)

	// Cache in Redis
	s.redis.Set(ctx, cacheKey, "created", IdempotencyTTL)

	accountsCreated.Inc()
	return &pb.AccountResponse{AccountId: req.AccountId, Status: "created"}, nil
}

func (s *LedgerService) GetBalance(ctx context.Context, req *pb.GetBalanceRequest) (*pb.BalanceResponse, error) {
	accountID := encodeID(req.AccountId)

	accounts, err := s.tb.LookupAccounts([]tbtypes.Uint128{accountID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "TigerBeetle LookupAccounts: %v", err)
	}
	if len(accounts) == 0 {
		return nil, status.Errorf(codes.NotFound, "account not found: %s", req.AccountId)
	}

	acc := accounts[0]
	// TigerBeetle balances are uint64; convert to int64 for gRPC
	creditsPending := int64(acc.CreditsPending.BigInt().Int64())
	creditsPosted := int64(acc.CreditsPosted.BigInt().Int64())
	debitsPending := int64(acc.DebitsPending.BigInt().Int64())
	debitsPosted := int64(acc.DebitsPosted.BigInt().Int64())

	return &pb.BalanceResponse{
		AccountId:      req.AccountId,
		CreditsPending: creditsPending,
		CreditsPosted:  creditsPosted,
		DebitsPending:  debitsPending,
		DebitsPosted:   debitsPosted,
		NetBalance:     creditsPosted - debitsPosted,
	}, nil
}

// ─── Two-Phase Transfer ───────────────────────────────────────────────────────

func (s *LedgerService) CreateTransfer(ctx context.Context, req *pb.CreateTransferRequest) (*pb.TransferResponse, error) {
	start := time.Now()

	// Idempotency check
	idempotencyKey := fmt.Sprintf("tb:transfer:%s", req.IdempotencyKey)
	if cached, err := s.redis.Get(ctx, idempotencyKey).Result(); err == nil {
		return &pb.TransferResponse{TransferId: cached, Status: "already_posted"}, nil
	}

	transferID := encodeID(req.IdempotencyKey)
	debitAccountID := encodeID(req.DebitAccountId)
	creditAccountID := encodeID(req.CreditAccountId)

	// Validate amount
	if req.Amount <= 0 {
		return nil, status.Errorf(codes.InvalidArgument, "transfer amount must be positive")
	}

	var transferCode uint16
	switch req.TransferType {
	case "duty_payment":
		transferCode = TransferCodeDutyPayment
	case "bond_release":
		transferCode = TransferCodeBondRelease
	case "drawback":
		transferCode = TransferCodeDrawback
	case "refund":
		transferCode = TransferCodeRefund
	default:
		transferCode = TransferCodeDutyPayment
	}

	// Build two-phase pending transfer
	amount := tbtypes.ToUint128(uint64(req.Amount))
	transfers := []tbtypes.Transfer{
		{
			ID:              transferID,
			DebitAccountID:  debitAccountID,
			CreditAccountID: creditAccountID,
			Amount:          amount,
			Ledger:          LedgerPrimary,
			Code:            transferCode,
			Flags:           tbtypes.TransferFlags{Pending: true}.ToUint16(),
			Timeout:         uint32((72 * time.Hour).Seconds()), // 72-hour pending window
		},
	}

	results, err := s.tb.CreateTransfers(transfers)
	if err != nil {
		transfersTotal.WithLabelValues(req.TransferType, "error").Inc()
		return nil, status.Errorf(codes.Internal, "TigerBeetle CreateTransfers: %v", err)
	}

	for _, r := range results {
		if r.Result != tbtypes.TransferOK {
			transfersTotal.WithLabelValues(req.TransferType, "failed").Inc()
			return nil, status.Errorf(codes.FailedPrecondition, "transfer failed: %v", r.Result)
		}
	}

	// Persist to PostgreSQL for audit trail
	transferIDHex := hex.EncodeToString(transferID[:])
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO tb_transfers (transfer_id, idempotency_key, debit_account_id, credit_account_id,
		                          amount, transfer_type, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
		ON CONFLICT (idempotency_key) DO NOTHING`,
		transferIDHex, req.IdempotencyKey, req.DebitAccountId, req.CreditAccountId,
		req.Amount, req.TransferType)

	// Cache idempotency key
	s.redis.Set(ctx, idempotencyKey, transferIDHex, IdempotencyTTL)

	transfersTotal.WithLabelValues(req.TransferType, "pending").Inc()
	transferDuration.Observe(time.Since(start).Seconds())

	return &pb.TransferResponse{
		TransferId: transferIDHex,
		Status:     "pending",
	}, nil
}

func (s *LedgerService) PostTransfer(ctx context.Context, req *pb.PostTransferRequest) (*pb.TransferResponse, error) {
	start := time.Now()

	pendingID := encodeID(req.PendingTransferId)
	postID := encodeID(req.PendingTransferId + ":post")

	// Post the pending transfer (two-phase commit)
	transfers := []tbtypes.Transfer{
		{
			ID:            postID,
			PendingID:     pendingID,
			Flags:         tbtypes.TransferFlags{PostPendingTransfer: true}.ToUint16(),
			Amount:        tbtypes.ToUint128(uint64(req.Amount)),
			Ledger:        LedgerPrimary,
			Code:          TransferCodeDutyPayment,
		},
	}

	results, err := s.tb.CreateTransfers(transfers)
	if err != nil {
		transfersTotal.WithLabelValues("post", "error").Inc()
		return nil, status.Errorf(codes.Internal, "TigerBeetle PostTransfer: %v", err)
	}

	for _, r := range results {
		if r.Result != tbtypes.TransferOK {
			transfersTotal.WithLabelValues("post", "failed").Inc()
			return nil, status.Errorf(codes.FailedPrecondition, "post transfer failed: %v", r.Result)
		}
	}

	// Update PostgreSQL audit trail
	_, _ = s.db.ExecContext(ctx, `
		UPDATE tb_transfers SET status = 'posted', posted_at = NOW()
		WHERE idempotency_key = $1`, req.PendingTransferId)

	transfersTotal.WithLabelValues("post", "success").Inc()
	transferDuration.Observe(time.Since(start).Seconds())

	return &pb.TransferResponse{
		TransferId: req.PendingTransferId,
		Status:     "posted",
	}, nil
}

func (s *LedgerService) VoidTransfer(ctx context.Context, req *pb.VoidTransferRequest) (*pb.TransferResponse, error) {
	pendingID := encodeID(req.PendingTransferId)
	voidID := encodeID(req.PendingTransferId + ":void")

	transfers := []tbtypes.Transfer{
		{
			ID:        voidID,
			PendingID: pendingID,
			Flags:     tbtypes.TransferFlags{VoidPendingTransfer: true}.ToUint16(),
			Ledger:    LedgerPrimary,
			Code:      TransferCodeDutyPayment,
		},
	}

	results, err := s.tb.CreateTransfers(transfers)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "TigerBeetle VoidTransfer: %v", err)
	}

	for _, r := range results {
		if r.Result != tbtypes.TransferOK {
			return nil, status.Errorf(codes.FailedPrecondition, "void transfer failed: %v", r.Result)
		}
	}

	_, _ = s.db.ExecContext(ctx, `
		UPDATE tb_transfers SET status = 'voided', voided_at = NOW()
		WHERE idempotency_key = $1`, req.PendingTransferId)

	transfersTotal.WithLabelValues("void", "success").Inc()

	return &pb.TransferResponse{
		TransferId: req.PendingTransferId,
		Status:     "voided",
	}, nil
}

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

func ensureSchema(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS tb_accounts (
			account_id   VARCHAR(128) PRIMARY KEY,
			account_type VARCHAR(32) NOT NULL,
			ledger       INT NOT NULL DEFAULT 1,
			created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS tb_transfers (
			id               BIGSERIAL PRIMARY KEY,
			transfer_id      VARCHAR(64) NOT NULL,
			idempotency_key  VARCHAR(256) NOT NULL UNIQUE,
			debit_account_id  VARCHAR(128) NOT NULL,
			credit_account_id VARCHAR(128) NOT NULL,
			amount           BIGINT NOT NULL,
			transfer_type    VARCHAR(32) NOT NULL,
			status           VARCHAR(16) NOT NULL DEFAULT 'pending',
			created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			posted_at        TIMESTAMPTZ,
			voided_at        TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_tb_transfers_debit  ON tb_transfers(debit_account_id);
		CREATE INDEX IF NOT EXISTS idx_tb_transfers_credit ON tb_transfers(credit_account_id);
		CREATE INDEX IF NOT EXISTS idx_tb_transfers_status ON tb_transfers(status);
	`)
	return err
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	grpcPort := getEnv("GRPC_PORT", "50055")
	metricsPort := getEnv("METRICS_PORT", "9094")
	tbAddresses := getEnv("TIGERBEETLE_ADDRESSES", "3000")
	clusterIDStr := getEnv("TIGERBEETLE_CLUSTER_ID", "0")
	dbURL := getEnv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
	redisURL := getEnv("REDIS_URL", "redis://localhost:6379")

	clusterID, err := strconv.ParseUint(clusterIDStr, 10, 32)
	if err != nil {
		log.Fatalf("Invalid TIGERBEETLE_CLUSTER_ID: %v", err)
	}

	// Parse TB addresses
	addresses := strings.Split(tbAddresses, ",")

	// Connect to TigerBeetle
	log.Printf("[tb-bridge] Connecting to TigerBeetle cluster %d at %v", clusterID, addresses)
	tbClient, err := tb.NewClient(tbtypes.ToUint128(clusterID), addresses)
	if err != nil {
		log.Fatalf("Failed to connect to TigerBeetle: %v", err)
	}
	defer tbClient.Close()
	log.Printf("[tb-bridge] TigerBeetle connected")

	// Connect to PostgreSQL
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to open PostgreSQL: %v", err)
	}
	defer db.Close()
	if err := ensureSchema(db); err != nil {
		log.Fatalf("Schema setup failed: %v", err)
	}

	// Connect to Redis
	rdb := redis.NewClient(&redis.Options{Addr: strings.TrimPrefix(redisURL, "redis://")})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("[tb-bridge] Redis unavailable (%v) — idempotency cache disabled", err)
	}

	// Start Prometheus metrics server
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"healthy","service":"tigerbeetle-bridge"}`))
		})
		log.Printf("[tb-bridge] Metrics on :%s", metricsPort)
		if err := http.ListenAndServe(":"+metricsPort, mux); err != nil {
			log.Printf("[tb-bridge] Metrics server error: %v", err)
		}
	}()

	// Start gRPC server
	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatalf("Failed to listen on :%s: %v", grpcPort, err)
	}

	grpcServer := grpc.NewServer()
	pb.RegisterLedgerServiceServer(grpcServer, NewLedgerService(tbClient, db, rdb))

	log.Printf("[tb-bridge] gRPC server starting on :%s", grpcPort)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("gRPC server failed: %v", err)
	}
}
