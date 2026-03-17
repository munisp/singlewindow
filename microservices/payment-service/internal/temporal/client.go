// temporal/client.go — Temporal workflow client for payment-service.
//
// Provides a thin wrapper around the Temporal Go SDK client that:
//   - Connects lazily to the Temporal frontend on first use
//   - Exposes StartConfirmPaymentWorkflow to enqueue ConfirmPaymentWorkflow
//   - Degrades gracefully when Temporal is unavailable (returns ErrUnavailable)
//
// Usage in handlers:
//
//	if err := h.temporal.StartConfirmPaymentWorkflow(ctx, invoiceID, mojaloopTxID); err != nil {
//	    // fallback: call ConfirmPayment directly
//	}
package temporal

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

// ErrUnavailable is returned when the Temporal server cannot be reached.
var ErrUnavailable = errors.New("temporal server unavailable")

// ConfirmPaymentInput matches the input type defined in the temporal-worker.
type ConfirmPaymentInput struct {
	InvoiceID    int64  `json:"invoiceId"`
	MojaloopTxID string `json:"mojaloopTxId"`
}

// Client wraps the Temporal SDK client with graceful degradation.
type Client struct {
	c           client.Client
	taskQueue   string
	unavailable bool
}

// New creates a Temporal client connected to the given host:port.
// If the connection fails, the client is marked unavailable and all
// StartWorkflow calls will return ErrUnavailable immediately.
func New(hostPort string) *Client {
	if hostPort == "" {
		hostPort = "localhost:7233"
	}
	c, err := client.Dial(client.Options{
		HostPort:  hostPort,
		Namespace: "default",
	})
	if err != nil {
		log.Printf("[payment-service] Temporal unavailable (%v) — workflow dispatch disabled", err)
		return &Client{unavailable: true, taskQueue: "payment-clearance"}
	}
	log.Printf("[payment-service] Temporal connected at %s", hostPort)
	return &Client{c: c, taskQueue: "payment-clearance"}
}

// Close releases the underlying Temporal connection.
func (tc *Client) Close() {
	if tc.c != nil {
		tc.c.Close()
	}
}

// StartConfirmPaymentWorkflow enqueues a ConfirmPaymentWorkflow on the
// payment-clearance task queue. The workflow ID is deterministic so that
// duplicate Mojaloop callbacks are idempotent (Temporal deduplicates by ID).
//
// Returns ErrUnavailable if the Temporal server is unreachable.
func (tc *Client) StartConfirmPaymentWorkflow(ctx context.Context, invoiceID int64, mojaloopTxID string) error {
	if tc.unavailable || tc.c == nil {
		return ErrUnavailable
	}

	workflowID := fmt.Sprintf("confirm-payment-invoice-%d", invoiceID)

	opts := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: tc.taskQueue,
		// Workflow-level timeout — the retry policy on the activity handles
		// transient failures; this caps the total wall-clock time.
		WorkflowExecutionTimeout: 30 * time.Minute,
		// Deduplication window: if the same workflow ID is submitted again
		// within this period, Temporal returns the existing run.
		WorkflowIDReusePolicy: 2, // WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    5 * time.Minute,
			MaximumAttempts:    5,
		},
	}

	input := ConfirmPaymentInput{
		InvoiceID:    invoiceID,
		MojaloopTxID: mojaloopTxID,
	}

	run, err := tc.c.ExecuteWorkflow(ctx, opts, "ConfirmPaymentWorkflow", input)
	if err != nil {
		return fmt.Errorf("temporal StartWorkflow: %w", err)
	}

	log.Printf("[payment-service] Temporal ConfirmPaymentWorkflow started: workflowID=%s runID=%s invoiceID=%d",
		workflowID, run.GetRunID(), invoiceID)
	return nil
}
