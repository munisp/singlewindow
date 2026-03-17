// temporal/client.go — Temporal workflow client for payment-service.
//
// Provides a thin wrapper around the Temporal Go SDK client that:
//   - Connects lazily to the Temporal frontend on first use
//   - Exposes StartConfirmPaymentWorkflow to enqueue ConfirmPaymentWorkflow
//   - Degrades gracefully when Temporal is unavailable (returns ErrUnavailable)
//   - Increments payment_temporal_fallback_total Prometheus counter on fallback
//
// Metrics exposed:
//   payment_temporal_fallback_total   — incremented whenever the direct-call
//                                       fallback path is taken (Temporal unavailable
//                                       or StartWorkflow error).
//   payment_temporal_dispatch_total   — incremented on each successful workflow dispatch.
//
// Usage in handlers:
//
//	if err := h.temporal.StartConfirmPaymentWorkflow(ctx, invoiceID, mojaloopTxID, tbTxID, method); err != nil {
//	    h.temporal.RecordFallback()
//	    // fallback: call ConfirmPayment directly
//	}
package temporal

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

var (
	// payment_temporal_fallback_total — incremented whenever the Temporal dispatch
	// fails and the direct HTTP call fallback is taken. Operations teams should
	// alert if this counter grows continuously, indicating Temporal connectivity issues.
	fallbackTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "payment_temporal_fallback_total",
			Help: "Total number of times the direct-call fallback was taken because Temporal was unavailable or returned an error.",
		},
		[]string{"reason"}, // "unavailable" | "dispatch_error"
	)

	// payment_temporal_dispatch_total — incremented on each successful workflow dispatch.
	dispatchTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "payment_temporal_dispatch_total",
			Help: "Total number of ConfirmPaymentWorkflow executions successfully dispatched to Temporal.",
		},
	)
)

// ─── Errors ───────────────────────────────────────────────────────────────────

// ErrUnavailable is returned when the Temporal server cannot be reached.
var ErrUnavailable = errors.New("temporal server unavailable")

// ─── Types ────────────────────────────────────────────────────────────────────

// ConfirmPaymentInput matches the input type defined in the temporal-worker.
type ConfirmPaymentInput struct {
	InvoiceID    int64  `json:"invoiceId"`
	MojaloopTxID string `json:"mojaloopTxId"`
	TBTxID       string `json:"tbTxId"`
	Method       string `json:"method"`
}

// Client wraps the Temporal SDK client with graceful degradation.
type Client struct {
	c           client.Client
	taskQueue   string
	unavailable bool
}

// ─── Constructor ──────────────────────────────────────────────────────────────

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
		log.Printf("[payment-service] Temporal unavailable (%v) — workflow dispatch disabled, falling back to direct calls", err)
		fallbackTotal.WithLabelValues("unavailable").Add(0) // initialise label so it appears in /metrics immediately
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

// IsAvailable returns true if the Temporal server was reachable at startup.
func (tc *Client) IsAvailable() bool {
	return !tc.unavailable && tc.c != nil
}

// ─── Metrics Helpers ─────────────────────────────────────────────────────────

// RecordFallback increments the payment_temporal_fallback_total counter with
// the given reason label. Call this from the handler whenever the fallback
// path is taken.
//
//	reason: "unavailable" — Temporal was unreachable at startup
//	reason: "dispatch_error" — StartWorkflow returned an error
func (tc *Client) RecordFallback(reason string) {
	fallbackTotal.WithLabelValues(reason).Inc()
}

// ─── Workflow Dispatch ────────────────────────────────────────────────────────

// StartConfirmPaymentWorkflow enqueues a ConfirmPaymentWorkflow on the
// payment-clearance task queue. The workflow ID is deterministic so that
// duplicate Mojaloop callbacks are idempotent (Temporal deduplicates by ID).
//
// Returns ErrUnavailable if the Temporal server is unreachable.
func (tc *Client) StartConfirmPaymentWorkflow(ctx context.Context, invoiceID int64, mojaloopTxID, tbTxID, method string) error {
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
		TBTxID:       tbTxID,
		Method:       method,
	}

	run, err := tc.c.ExecuteWorkflow(ctx, opts, "ConfirmPaymentWorkflow", input)
	if err != nil {
		return fmt.Errorf("temporal StartWorkflow: %w", err)
	}

	dispatchTotal.Inc()
	log.Printf("[payment-service] Temporal ConfirmPaymentWorkflow started: workflowID=%s runID=%s invoiceID=%d",
		workflowID, run.GetRunID(), invoiceID)
	return nil
}
