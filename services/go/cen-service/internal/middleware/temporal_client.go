// temporal_client.go — Temporal workflow engine client for cen-service.
//
// Temporal is used to orchestrate long-running audit workflows:
//   - AuditWorkflow: Multi-step post-clearance audit (select → assign → investigate → close)
//   - DutyRecoveryWorkflow: Automated duty recovery for confirmed underpayments
//   - EscalationWorkflow: Escalates unresolved audit cases to senior officers
//
// The cen-service acts as both a Temporal client (starts workflows) and
// a Temporal worker (executes activities).
package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
)

// ─── Temporal Client ──────────────────────────────────────────────────────────

const (
	TaskQueueAudit       = "cen-service"
	TaskQueueDeclaration = "declaration-service"
	TaskQueueOGA         = "oga-service"
	TaskQueuePayment     = "payment-service"
)

type TemporalClient struct {
	Client client.Client
	logger *slog.Logger
}

func NewTemporalClient() (*TemporalClient, error) {
	hostPort := os.Getenv("TEMPORAL_HOST_PORT")
	if hostPort == "" {
		hostPort = "temporal:7233"
	}
	namespace := os.Getenv("TEMPORAL_NAMESPACE")
	if namespace == "" {
		namespace = "tradegateway"
	}

	c, err := client.Dial(client.Options{
		HostPort:  hostPort,
		Namespace: namespace,
	})
	if err != nil {
		return nil, fmt.Errorf("connect to temporal: %w", err)
	}
	slog.Default().Info("Temporal client connected",
		"host_port", hostPort,
		"namespace", namespace)
	return &TemporalClient{
		Client: c,
		logger: slog.Default().With("component", "temporal", "service", "cen-service"),
	}, nil
}

// ─── Workflow Input/Output Types ──────────────────────────────────────────────

type AuditWorkflowInput struct {
	AuditCaseID    string  `json:"audit_case_id"`
	DeclarationID  string  `json:"declaration_id"`
	UCR            string  `json:"ucr"`
	TraderID       string  `json:"trader_id"`
	SelectionBasis string  `json:"selection_basis"`
	RiskScore      float64 `json:"risk_score"`
	AssignedTo     string  `json:"assigned_to"`
}

type DutyRecoveryInput struct {
	AuditCaseID   string  `json:"audit_case_id"`
	DeclarationID string  `json:"declaration_id"`
	TraderID      string  `json:"trader_id"`
	AmountDue     float64 `json:"amount_due"`
	Currency      string  `json:"currency"`
	DueDate       string  `json:"due_date"`
}

// ─── Workflow Starters ────────────────────────────────────────────────────────

// StartAuditWorkflow starts a new post-clearance audit workflow.
func (t *TemporalClient) StartAuditWorkflow(ctx context.Context, input AuditWorkflowInput) (string, error) {
	opts := client.StartWorkflowOptions{
		ID:                 fmt.Sprintf("audit-%s", input.AuditCaseID),
		TaskQueue:          TaskQueueAudit,
		WorkflowRunTimeout: 30 * 24 * time.Hour, // 30 days max
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	run, err := t.Client.ExecuteWorkflow(ctx, opts, "AuditWorkflow", input)
	if err != nil {
		return "", fmt.Errorf("start audit workflow: %w", err)
	}
	t.logger.Info("Audit workflow started",
		"workflow_id", opts.ID,
		"run_id", run.GetRunID(),
		"audit_case_id", input.AuditCaseID)
	return run.GetRunID(), nil
}

// StartDutyRecoveryWorkflow starts a duty recovery workflow after audit findings.
func (t *TemporalClient) StartDutyRecoveryWorkflow(ctx context.Context, input DutyRecoveryInput) (string, error) {
	opts := client.StartWorkflowOptions{
		ID:                 fmt.Sprintf("duty-recovery-%s", input.AuditCaseID),
		TaskQueue:          TaskQueueAudit,
		WorkflowRunTimeout: 90 * 24 * time.Hour, // 90 days for recovery
	}
	run, err := t.Client.ExecuteWorkflow(ctx, opts, "DutyRecoveryWorkflow", input)
	if err != nil {
		return "", fmt.Errorf("start duty recovery workflow: %w", err)
	}
	t.logger.Info("Duty recovery workflow started",
		"workflow_id", opts.ID,
		"run_id", run.GetRunID(),
		"amount_due", input.AmountDue)
	return run.GetRunID(), nil
}

// SignalAuditWorkflow sends a signal to an in-progress audit workflow.
// Signals: "officer_assigned", "investigation_complete", "case_closed", "escalated"
func (t *TemporalClient) SignalAuditWorkflow(ctx context.Context, auditCaseID, signal string, payload interface{}) error {
	workflowID := fmt.Sprintf("audit-%s", auditCaseID)
	err := t.Client.SignalWorkflow(ctx, workflowID, "", signal, payload)
	if err != nil {
		return fmt.Errorf("signal audit workflow %s: %w", signal, err)
	}
	t.logger.Info("Audit workflow signaled",
		"workflow_id", workflowID,
		"signal", signal)
	return nil
}

// QueryAuditWorkflowStatus queries the current state of an audit workflow.
func (t *TemporalClient) QueryAuditWorkflowStatus(ctx context.Context, auditCaseID string) (map[string]interface{}, error) {
	workflowID := fmt.Sprintf("audit-%s", auditCaseID)
	resp, err := t.Client.QueryWorkflow(ctx, workflowID, "", "getStatus")
	if err != nil {
		return nil, fmt.Errorf("query audit workflow: %w", err)
	}
	var status map[string]interface{}
	if err := resp.Get(&status); err != nil {
		return nil, fmt.Errorf("decode workflow status: %w", err)
	}
	return status, nil
}

// ─── Worker Registration ──────────────────────────────────────────────────────

// NewAuditWorker creates a Temporal worker for the audit task queue.
// Register activities and workflows on the returned worker before calling Start().
func (t *TemporalClient) NewAuditWorker() worker.Worker {
	return worker.New(t.Client, TaskQueueAudit, worker.Options{
		MaxConcurrentActivityExecutionSize:     10,
		MaxConcurrentWorkflowTaskExecutionSize: 5,
	})
}

// Close gracefully closes the Temporal client.
func (t *TemporalClient) Close() {
	t.Client.Close()
}
