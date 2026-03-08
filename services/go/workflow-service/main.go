// Package main is the entry point for the NGSWTP Temporal workflow worker.
// It registers the DeclarationClearanceWorkflow and all its activities, then
// starts the worker polling the "ngswtp-clearance" task queue.
package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.uber.org/zap"

	"github.com/tradegateway/ngswtp/workflow-service/activities"
	"github.com/tradegateway/ngswtp/workflow-service/workflows"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// ── Connect to Temporal server ────────────────────────────────────────────
	temporalHost := getEnv("TEMPORAL_HOST", "localhost:7233")
	c, err := client.Dial(client.Options{
		HostPort: temporalHost,
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
	})

	// ── Register workflow ─────────────────────────────────────────────────────
	w.RegisterWorkflow(workflows.DeclarationClearanceWorkflow)

	// ── Register activities ───────────────────────────────────────────────────
	w.RegisterActivity(activities.ScreenSanctionsActivity)
	w.RegisterActivity(activities.ComputeRiskScoreActivity)
	w.RegisterActivity(activities.RouteToOGAsActivity)
	w.RegisterActivity(activities.WaitForOGAApprovalActivity)
	w.RegisterActivity(activities.WaitForPhysicalInspectionActivity)
	w.RegisterActivity(activities.CalculateDutiesActivity)
	w.RegisterActivity(activities.UpdateDeclarationStatusActivity)
	w.RegisterActivity(activities.IssueClearancePermitActivity)

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
