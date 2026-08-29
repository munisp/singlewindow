// Package main is the entry point for the NGSWTP Temporal workflow worker.
// It registers the DeclarationClearanceWorkflow and all its activities, then
// starts the worker polling the "ngswtp-clearance" task queue.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"go.temporal.io/sdk/client"
	temporalotel "go.temporal.io/sdk/contrib/opentelemetry"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/worker"
	"go.uber.org/zap"

	"github.com/tradegateway/ngswtp/workflow-service/activities"
	"github.com/tradegateway/ngswtp/workflow-service/workflows"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// Phase-7 OTel: guarded by OTEL_EXPORTER_OTLP_ENDPOINT — unset = telemetry
	// disabled, boot unaffected (sanctioned fail-open, OTEL_DESIGN.md §1).
	otelShutdown, otelEnabled := InitTelemetry(context.Background())
	if otelEnabled {
		defer otelShutdown(context.Background())
	}

	// ── Temporal OTel interceptors (official contrib) ─────────────────────────
	// Workflow/activity spans join the calling service's trace via payload
	// context propagation. Only wired when telemetry is enabled.
	var clientInterceptors []interceptor.ClientInterceptor
	var workerInterceptors []interceptor.WorkerInterceptor
	if otelEnabled {
		tracingInterceptor, err := temporalotel.NewTracingInterceptor(temporalotel.TracerOptions{})
		if err != nil {
			// Telemetry must never break the worker (fail-open).
			logger.Warn("[otel] failed to build Temporal tracing interceptor — continuing without it", zap.Error(err))
		} else {
			clientInterceptors = append(clientInterceptors, tracingInterceptor)
			workerInterceptors = append(workerInterceptors, tracingInterceptor)
		}
	}

	// ── Connect to Temporal server ────────────────────────────────────────────
	temporalHost := getEnv("TEMPORAL_HOST", "localhost:7233")
	c, err := client.Dial(client.Options{
		HostPort:     temporalHost,
		Interceptors: clientInterceptors,
	})
	if err != nil {
		log.Fatalf("[Temporal] Failed to connect to server at %s: %v", temporalHost, err)
	}
	defer c.Close()

	logger.Info("Connected to Temporal server", zap.String("host", temporalHost))

	// ── Create worker ─────────────────────────────────────────────────────────
	w := worker.New(c, workflows.TaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize:      50,
		MaxConcurrentWorkflowTaskExecutionSize:  20,
		MaxConcurrentLocalActivityExecutionSize: 20,
		Interceptors:                            workerInterceptors,
	})

	// ── Register workflows ────────────────────────────────────────────────────
	// Declaration clearance (core)
	w.RegisterWorkflow(workflows.DeclarationClearanceWorkflow)
	// Financial workflows
	w.RegisterWorkflow(workflows.BatchSettlementWorkflow)
	w.RegisterWorkflow(workflows.RevenueReconciliationWorkflow)
	w.RegisterWorkflow(workflows.DutyDrawbackWorkflow)
	w.RegisterWorkflow(workflows.AuditRecoveryWorkflow)
	w.RegisterWorkflow(workflows.OverpaymentRefundWorkflow)
	// Bond and transit workflows
	w.RegisterWorkflow(workflows.BondLodgementWorkflow)
	w.RegisterWorkflow(workflows.BondForfeitureWorkflow)
	w.RegisterWorkflow(workflows.TransitLodgementWorkflow)
	w.RegisterWorkflow(workflows.TransitReleaseWorkflow)

	// ── Register clearance activities ─────────────────────────────────────────
	w.RegisterActivity(activities.ScreenSanctionsActivity)
	w.RegisterActivity(activities.ComputeRiskScoreActivity)
	w.RegisterActivity(activities.RouteToOGAsActivity)
	w.RegisterActivity(activities.WaitForOGAApprovalActivity)
	w.RegisterActivity(activities.WaitForPhysicalInspectionActivity)
	w.RegisterActivity(activities.CalculateDutiesActivity)
	w.RegisterActivity(activities.UpdateDeclarationStatusActivity)
	w.RegisterActivity(activities.IssueClearancePermitActivity)

	// ── Register fund-flow activities (TigerBeetle, Mojaloop, Kafka, Fluvio, Permify, DeltaLake, Postgres) ──
	w.RegisterActivity(activities.TigerBeetleCreateAccountActivityImpl)
	w.RegisterActivity(activities.TigerBeetleTransferActivityImpl)
	w.RegisterActivity(activities.TigerBeetleReserveActivityImpl)
	w.RegisterActivity(activities.TigerBeetleCommitActivityImpl)
	w.RegisterActivity(activities.TigerBeetleVoidReserveActivityImpl)
	w.RegisterActivity(activities.TigerBeetleBatchTransferActivityImpl)
	w.RegisterActivity(activities.QueryTigerBeetleBalanceActivityImpl)
	w.RegisterActivity(activities.QueryPostgresBalanceMirrorActivityImpl)
	w.RegisterActivity(activities.MojaloopTransferActivityImpl)
	w.RegisterActivity(activities.PublishKafkaEventActivityImpl)
	w.RegisterActivity(activities.PublishFluvioStreamEventActivityImpl)
	w.RegisterActivity(activities.CheckPermifyAuthorizationActivityImpl)
	w.RegisterActivity(activities.WriteToDeltaLakeActivityImpl)
	w.RegisterActivity(activities.UpdateBondStatusActivityImpl)
	// Extra batch/drawback/settlement activities
	w.RegisterActivity(activities.PublishKafkaBatchEventActivityImpl)
	w.RegisterActivity(activities.UpdateDrawbackStatusActivityImpl)
	w.RegisterActivity(activities.FetchBatchPaymentItemsActivityImpl)
	w.RegisterActivity(activities.ClaimBatchPaymentItemsActivityImpl)
	w.RegisterActivity(activities.ReleaseBatchPaymentItemsActivityImpl)
	w.RegisterActivity(activities.MarkBatchPaymentItemsCommittedActivityImpl)

	// ── Start worker ──────────────────────────────────────────────────────────
	logger.Info("Starting NGSWTP Temporal worker",
		zap.String("taskQueue", workflows.TaskQueue),
	)

	// Run in background and wait for shutdown signal
	go func() {
		if err := w.Run(worker.InterruptCh()); err != nil {
			logger.Fatal("Worker failed", zap.Error(err))
		}
	}()

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	logger.Info("Shutting down NGSWTP Temporal worker")
	w.Stop()
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
