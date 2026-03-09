// temporal-worker — TradeGateway NGSWTP
// Registers and runs all Temporal workflow and activity workers.
// Workflows: CustomsClearance, PaymentProcessing, OGAApproval, RiskAssessment,
//            CargoRelease, AEOApplication, DutyDrawback, PostClearanceAudit,
//            ASEANSingleWindow, SanctionsScreening
package main

import (
	"log"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/tradegateway/temporal-worker/activities"
	"github.com/tradegateway/temporal-worker/workflows"
)

const (
	TaskQueue = "tradegateway-main"
)

func main() {
	temporalHost := getEnv("TEMPORAL_HOST", "localhost:7233")
	namespace := getEnv("TEMPORAL_NAMESPACE", "tradegateway")

	log.Printf("[temporal-worker] Connecting to Temporal at %s (namespace: %s)", temporalHost, namespace)

	c, err := client.Dial(client.Options{
		HostPort:  temporalHost,
		Namespace: namespace,
	})
	if err != nil {
		log.Fatalf("[temporal-worker] Failed to connect to Temporal: %v", err)
	}
	defer c.Close()

	// Create worker
	w := worker.New(c, TaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize:      100,
		MaxConcurrentWorkflowTaskExecutionSize:  50,
		MaxConcurrentLocalActivityExecutionSize: 200,
	})

	// ── Register workflows ────────────────────────────────────────────────────
	w.RegisterWorkflow(workflows.CustomsClearanceWorkflow)
	w.RegisterWorkflow(workflows.PaymentProcessingWorkflow)
	w.RegisterWorkflow(workflows.OGAApprovalWorkflow)
	w.RegisterWorkflow(workflows.RiskAssessmentWorkflow)
	w.RegisterWorkflow(workflows.CargoReleaseWorkflow)
	w.RegisterWorkflow(workflows.AEOApplicationWorkflow)
	w.RegisterWorkflow(workflows.DutyDrawbackWorkflow)
	w.RegisterWorkflow(workflows.PostClearanceAuditWorkflow)
	w.RegisterWorkflow(workflows.ASEANSingleWindowWorkflow)
	w.RegisterWorkflow(workflows.SanctionsScreeningWorkflow)

	// ── Register activities ───────────────────────────────────────────────────
	acts := activities.New(getEnv("DATABASE_URL",
		"postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"))
	w.RegisterActivity(acts) // registers all exported methods as activities

	log.Printf("[temporal-worker] Starting worker on task queue: %s", TaskQueue)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("[temporal-worker] Worker error: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
