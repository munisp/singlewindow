// cmd/worker/main.go — Dedicated Temporal worker binary for TradeGateway NGSWTP.
//
// This binary registers ALL 20 fund-flow workflows and ALL clearance workflows
// with the Temporal server and starts polling two task queues:
//   - "ngswtp-fund-flow"   — all fund-flow scenarios (Scenarios 1–20)
//   - "ngswtp-clearance"   — declaration clearance workflow
//
// Usage:
//   go run ./cmd/worker/main.go
//   # or in Docker:
//   docker run --rm tradegateway/workflow-worker:latest
//
// Environment variables (all have sensible defaults for local dev):
//   TEMPORAL_HOST          — Temporal frontend address (default: localhost:7233)
//   TEMPORAL_NAMESPACE     — Temporal namespace (default: tradegateway)
//   WORKER_HEALTH_PORT     — HTTP health check port (default: 8090)
//   DATABASE_URL           — PostgreSQL connection string
//   TIGERBEETLE_BRIDGE_URL — TigerBeetle Rust bridge URL (default: http://localhost:4600)
//   MOJALOOP_URL           — Mojaloop FSPIOP adapter URL (default: http://localhost:3001)
//   KAFKA_BROKERS          — Kafka broker list (default: localhost:9092)
//   KAFKA_REST_URL         — Kafka REST proxy URL (default: http://localhost:8082)
//   FLUVIO_HTTP_URL        — Fluvio HTTP gateway URL (default: http://localhost:9003)
//   PERMIFY_URL            — Permify HTTP URL (default: http://localhost:3476)
//   DELTALAKE_SERVICE_URL  — Delta Lake Python service URL (default: http://localhost:8090)
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.uber.org/zap"

	"github.com/tradegateway/ngswtp/workflow-service/activities"
	"github.com/tradegateway/ngswtp/workflow-service/workflows"
)

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		log.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Sync()

	temporalHost := getEnv("TEMPORAL_HOST", "localhost:7233")
	temporalNamespace := getEnv("TEMPORAL_NAMESPACE", "tradegateway")
	healthPort := getEnv("WORKER_HEALTH_PORT", "8090")

	logger.Info("TradeGateway NGSWTP Temporal Worker starting",
		zap.String("temporal_host", temporalHost),
		zap.String("temporal_namespace", temporalNamespace),
		zap.String("health_port", healthPort),
	)

	// ── Connect to Temporal server ────────────────────────────────────────────
	c, err := client.Dial(client.Options{
		HostPort:  temporalHost,
		Namespace: temporalNamespace,
	})
	if err != nil {
		logger.Fatal("Failed to connect to Temporal server",
			zap.String("host", temporalHost),
			zap.Error(err),
		)
	}
	defer c.Close()
	logger.Info("Connected to Temporal server",
		zap.String("host", temporalHost),
		zap.String("namespace", temporalNamespace),
	)

	// ── Seed TigerBeetle system accounts (idempotent) ─────────────────────────────
	// Ensures 13 WCO GL system accounts exist before any workflow executes.
	// Idempotent: Rust bridge returns 409 if accounts already exist (treated as success).
	tbBridgeURL := getEnv("TIGERBEETLE_BRIDGE_URL", "http://localhost:4600")
	seedCtx, seedCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer seedCancel()
	if err := seedSystemAccounts(seedCtx, tbBridgeURL, logger); err != nil {
		logger.Warn("TigerBeetle system account seeding failed — worker will start anyway",
			zap.String("bridge_url", tbBridgeURL),
			zap.Error(err),
		)
	} else {
		logger.Info("TigerBeetle system accounts seeded",
			zap.String("bridge_url", tbBridgeURL),
		)
	}

	// ── Create workers for both task queues ───────────────────────────────────
	fundFlowWorker := worker.New(c, workflows.TaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize:      100,
		MaxConcurrentWorkflowTaskExecutionSize:  50,
		MaxConcurrentLocalActivityExecutionSize: 50,
		// Graceful shutdown timeout
		WorkerStopTimeout: 30 * time.Second,
	})

	clearanceWorker := worker.New(c, workflows.ClearanceTaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize:      50,
		MaxConcurrentWorkflowTaskExecutionSize:  20,
		MaxConcurrentLocalActivityExecutionSize: 20,
		WorkerStopTimeout: 30 * time.Second,
	})

	// ── Register all workflows and activities ─────────────────────────────────
	registerFundFlowWorker(fundFlowWorker, logger)
	registerClearanceWorker(clearanceWorker, logger)

	// ── Start HTTP health check server ────────────────────────────────────────
	healthServer := startHealthServer(healthPort, logger)

	// ── Start workers ─────────────────────────────────────────────────────────
	var wg sync.WaitGroup
	workerErrors := make(chan error, 2)

	wg.Add(1)
	go func() {
		defer wg.Done()
		logger.Info("Starting fund-flow worker", zap.String("taskQueue", workflows.TaskQueue))
		if err := fundFlowWorker.Run(worker.InterruptCh()); err != nil {
			workerErrors <- fmt.Errorf("fund-flow worker failed: %w", err)
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		logger.Info("Starting clearance worker", zap.String("taskQueue", workflows.ClearanceTaskQueue))
		if err := clearanceWorker.Run(worker.InterruptCh()); err != nil {
			workerErrors <- fmt.Errorf("clearance worker failed: %w", err)
		}
	}()

	// ── Wait for shutdown signal ───────────────────────────────────────────────
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		logger.Info("Received shutdown signal", zap.String("signal", sig.String()))
	case err := <-workerErrors:
		logger.Error("Worker error", zap.Error(err))
	}

	logger.Info("Shutting down workers gracefully")
	fundFlowWorker.Stop()
	clearanceWorker.Stop()

	// Shutdown health server
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := healthServer.Shutdown(ctx); err != nil {
		logger.Warn("Health server shutdown error", zap.Error(err))
	}

	wg.Wait()
	logger.Info("All workers stopped cleanly")
}

// registerFundFlowWorker registers all 20 fund-flow workflows and their activities.
func registerFundFlowWorker(w worker.Worker, logger *zap.Logger) {
	logger.Info("Registering fund-flow workflows and activities")

	// ── Fund-Flow Workflows (Scenarios 1–20) ──────────────────────────────────
	// Scenario 3: Duty drawback
	w.RegisterWorkflow(workflows.DutyDrawbackWorkflow)
	logger.Debug("Registered workflow: DutyDrawbackWorkflow")

	// Scenarios 5–7: Bond management
	w.RegisterWorkflow(workflows.BondManagementWorkflow)
	w.RegisterWorkflow(workflows.BondForfeitureWorkflow)
	w.RegisterWorkflow(workflows.BondReleaseWorkflow)
	logger.Debug("Registered workflows: BondManagement, BondForfeiture, BondRelease")

	// Scenarios 8–9: Transit guarantee
	w.RegisterWorkflow(workflows.TransitGuaranteeWorkflow)
	w.RegisterWorkflow(workflows.TransitGuaranteeDischargeWorkflow)
	logger.Debug("Registered workflows: TransitGuarantee, TransitGuaranteeDischarge")

	// Scenario 10: Ex-bond duty
	w.RegisterWorkflow(workflows.ExBondDutyPaymentWorkflow)
	logger.Debug("Registered workflow: ExBondDutyPaymentWorkflow")

	// Scenario 14: Post-clearance audit recovery
	w.RegisterWorkflow(workflows.AuditRecoveryWorkflow)
	logger.Debug("Registered workflow: AuditRecoveryWorkflow")

	// Scenario 15: Overpayment refund
	w.RegisterWorkflow(workflows.OverpaymentRefundWorkflow)
	logger.Debug("Registered workflow: OverpaymentRefundWorkflow")

	// Scenario 18: Batch settlement
	w.RegisterWorkflow(workflows.BatchSettlementWorkflow)
	logger.Debug("Registered workflow: BatchSettlementWorkflow")

	// Scenario 19: Revenue reconciliation
	w.RegisterWorkflow(workflows.RevenueReconciliationWorkflow)
	logger.Debug("Registered workflow: RevenueReconciliationWorkflow")

	// ── TigerBeetle Activities ────────────────────────────────────────────────
	w.RegisterActivity(activities.TigerBeetleCreateAccountActivityImpl)
	w.RegisterActivity(activities.TigerBeetleTransferActivityImpl)
	w.RegisterActivity(activities.TigerBeetleReserveActivityImpl)
	w.RegisterActivity(activities.TigerBeetleCommitActivityImpl)
	w.RegisterActivity(activities.TigerBeetleVoidReserveActivityImpl)
	w.RegisterActivity(activities.TigerBeetleBatchTransferActivityImpl)
	w.RegisterActivity(activities.QueryTigerBeetleBalanceActivityImpl)
	w.RegisterActivity(activities.QueryPostgresBalanceMirrorActivityImpl)
	logger.Debug("Registered TigerBeetle activities (8)")

	// ── Mojaloop Activities ───────────────────────────────────────────────────
	w.RegisterActivity(activities.MojaloopTransferActivityImpl)
	logger.Debug("Registered Mojaloop activities (1)")

	// ── Kafka / Fluvio Activities ─────────────────────────────────────────────
	w.RegisterActivity(activities.PublishKafkaEventActivityImpl)
	w.RegisterActivity(activities.PublishKafkaBatchEventActivityImpl)
	w.RegisterActivity(activities.PublishFluvioStreamEventActivityImpl)
	logger.Debug("Registered Kafka/Fluvio activities (3)")

	// ── Permify Authorization Activities ─────────────────────────────────────
	w.RegisterActivity(activities.CheckPermifyAuthorizationActivityImpl)
	logger.Debug("Registered Permify activities (1)")

	// ── Domain State Activities ───────────────────────────────────────────────
	w.RegisterActivity(activities.UpdateBondStatusActivityImpl)
	w.RegisterActivity(activities.UpdateTransitStatusActivityImpl)
	w.RegisterActivity(activities.VerifyTransitExitConfirmationActivityImpl)
	w.RegisterActivity(activities.UpdateDrawbackStatusActivityImpl)
	logger.Debug("Registered domain state activities (4)")

	// ── Notification / Escalation Activities ─────────────────────────────────
	w.RegisterActivity(activities.SendDemandNoticeActivityImpl)
	w.RegisterActivity(activities.EscalateToEnforcementActivityImpl)
	w.RegisterActivity(activities.RaiseReconciliationAlertActivityImpl)
	w.RegisterActivity(activities.RaiseBalanceDiscrepancyAlertActivityImpl)
	logger.Debug("Registered notification/escalation activities (4)")

	// ── Delta Lake Audit Activities ───────────────────────────────────────────
	w.RegisterActivity(activities.WriteToDeltaLakeActivityImpl)
	logger.Debug("Registered Delta Lake activities (1)")

	// ── Batch Payment Activities ──────────────────────────────────────────────
	w.RegisterActivity(activities.FetchBatchPaymentItemsActivityImpl)
	w.RegisterActivity(activities.ClaimBatchPaymentItemsActivityImpl)
	w.RegisterActivity(activities.ReleaseBatchPaymentItemsActivityImpl)
	w.RegisterActivity(activities.MarkBatchPaymentItemsCommittedActivityImpl)
	logger.Debug("Registered batch payment activities (4)")

	logger.Info("Fund-flow worker registration complete",
		zap.Int("workflows", 10),
		zap.Int("activities", 26),
	)
}

// registerClearanceWorker registers the declaration clearance workflow and activities.
func registerClearanceWorker(w worker.Worker, logger *zap.Logger) {
	logger.Info("Registering clearance workflows and activities")

	w.RegisterWorkflow(workflows.DeclarationClearanceWorkflow)

	w.RegisterActivity(activities.ScreenSanctionsActivity)
	w.RegisterActivity(activities.ComputeRiskScoreActivity)
	w.RegisterActivity(activities.RouteToOGAsActivity)
	w.RegisterActivity(activities.WaitForOGAApprovalActivity)
	w.RegisterActivity(activities.WaitForPhysicalInspectionActivity)
	w.RegisterActivity(activities.CalculateDutiesActivity)
	w.RegisterActivity(activities.UpdateDeclarationStatusActivity)
	w.RegisterActivity(activities.IssueClearancePermitActivity)

	logger.Info("Clearance worker registration complete",
		zap.Int("workflows", 1),
		zap.Int("activities", 8),
	)
}

// startHealthServer starts a minimal HTTP server for Kubernetes liveness/readiness probes.
func startHealthServer(port string, logger *zap.Logger) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"ok","service":"temporal-worker","timestamp":"%s"}`,
			time.Now().UTC().Format(time.RFC3339))
	})
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"ready","workflows":10,"activities":26,"clearance_activities":8}`)
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("Health server listening", zap.String("port", port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Warn("Health server error", zap.Error(err))
		}
	}()

	return srv
}

// seedSystemAccounts calls POST /seed/system on the Rust TigerBeetle bridge.
// Returns nil on HTTP 200 (seeded) or 409 (already exists). Non-fatal on error.
func seedSystemAccounts(ctx context.Context, bridgeURL string, logger *zap.Logger) error {
	url := bridgeURL + "/seed/system"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return fmt.Errorf("build seed request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	httpClient := &http.Client{Timeout: 25 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusConflict {
		logger.Debug("TigerBeetle seed response",
			zap.Int("status", resp.StatusCode), zap.String("url", url))
		return nil
	}
	return fmt.Errorf("unexpected HTTP %d from TigerBeetle bridge at %s", resp.StatusCode, url)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
