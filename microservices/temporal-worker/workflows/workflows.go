// workflows — Temporal workflow definitions for TradeGateway NGSWTP
// Implements 10 critical trade facilitation journeys as durable workflows.
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/tradegateway/temporal-worker/activities"
)

// ── Shared types ──────────────────────────────────────────────────────────────

type DeclarationInput struct {
	DeclarationId int64   `json:"declarationId"`
	TraderId      int64   `json:"traderId"`
	HSCode        string  `json:"hsCode"`
	DeclaredValue float64 `json:"declaredValue"`
	OriginCountry string  `json:"originCountry"`
}

type WorkflowResult struct {
	DeclarationId int64     `json:"declarationId"`
	Status        string    `json:"status"`
	CompletedAt   time.Time `json:"completedAt"`
	Message       string    `json:"message"`
}

// defaultActivityOptions returns standard activity options with retries
func defaultActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
}

// paymentActivityOptions returns extended options for payment operations
func paymentActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 120 * time.Second,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    60 * time.Second,
			MaximumAttempts:    5,
		},
	}
}

// ── Workflow 1: Customs Clearance (master workflow) ───────────────────────────
// Orchestrates the full customs clearance lifecycle:
// Submit → Risk Score → OGA Permits → Payment → Clear
func CustomsClearanceWorkflow(ctx workflow.Context, input DeclarationInput) (*WorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("CustomsClearanceWorkflow started", "declarationId", input.DeclarationId)

	ao := defaultActivityOptions()
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Step 1: Validate declaration
	var validationResult activities.ValidationResult
	if err := workflow.ExecuteActivity(ctx, (*activities.Activities).ValidateDeclaration, input.DeclarationId).Get(ctx, &validationResult); err != nil {
		return nil, fmt.Errorf("declaration validation failed: %w", err)
	}
	if !validationResult.Valid {
		workflow.ExecuteActivity(ctx, (*activities.Activities).UpdateDeclarationStatus, input.DeclarationId, "rejected", validationResult.Reason)
		return &WorkflowResult{
			DeclarationId: input.DeclarationId,
			Status:        "rejected",
			CompletedAt:   workflow.Now(ctx),
			Message:       validationResult.Reason,
		}, nil
	}

	// Step 2: Trigger risk assessment (child workflow)
	var riskResult activities.RiskResult
	riskCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
		WorkflowExecutionTimeout: 5 * time.Minute,
	})
	if err := workflow.ExecuteChildWorkflow(riskCtx, RiskAssessmentWorkflow, input).Get(ctx, &riskResult); err != nil {
		logger.Warn("Risk assessment failed — defaulting to YELLOW lane", "error", err)
		riskResult = activities.RiskResult{Score: 50, Lane: "yellow"}
	}

	// Step 3: Update declaration with risk lane
	workflow.ExecuteActivity(ctx, (*activities.Activities).UpdateRiskScore, input.DeclarationId, riskResult.Score, riskResult.Lane)

	// Step 4: Sanctions screening (parallel with OGA permits)
	sanctionsChan := workflow.ExecuteActivity(ctx, (*activities.Activities).ScreenSanctions, input.DeclarationId, input.TraderId)

	// Step 5: Create OGA permits (child workflow)
	var ogaResult activities.OGAResult
	ogaCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
		WorkflowExecutionTimeout: 72 * time.Hour, // OGA SLA
	})
	ogaFuture := workflow.ExecuteChildWorkflow(ogaCtx, OGAApprovalWorkflow, input)

	// Wait for sanctions screening
	var sanctionsResult activities.SanctionsResult
	if err := sanctionsChan.Get(ctx, &sanctionsResult); err != nil {
		logger.Warn("Sanctions screening error", "error", err)
	}
	if sanctionsResult.Hit {
		workflow.ExecuteActivity(ctx, (*activities.Activities).UpdateDeclarationStatus, input.DeclarationId, "under_review", "Sanctions hit detected")
		return &WorkflowResult{
			DeclarationId: input.DeclarationId,
			Status:        "under_review",
			CompletedAt:   workflow.Now(ctx),
			Message:       fmt.Sprintf("Sanctions match on %s list (score: %.2f)", sanctionsResult.ListName, sanctionsResult.MatchScore),
		}, nil
	}

	// For GREEN lane: skip OGA permits and proceed directly to payment
	if riskResult.Lane == "green" {
		logger.Info("GREEN lane — fast-tracking to payment", "declarationId", input.DeclarationId)
		ogaResult = activities.OGAResult{AllApproved: true, AnyRejected: false}
	} else {
		// Wait for OGA approvals
		if err := ogaFuture.Get(ctx, &ogaResult); err != nil {
			return nil, fmt.Errorf("OGA approval workflow failed: %w", err)
		}
		if ogaResult.AnyRejected {
			workflow.ExecuteActivity(ctx, (*activities.Activities).UpdateDeclarationStatus, input.DeclarationId, "rejected", "OGA permit rejected")
			return &WorkflowResult{
				DeclarationId: input.DeclarationId,
				Status:        "rejected",
				CompletedAt:   workflow.Now(ctx),
				Message:       "Declaration rejected: OGA permit denied",
			}, nil
		}
	}

	// Step 6: Payment processing (child workflow)
	payCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
		WorkflowExecutionTimeout: 72 * time.Hour, // Payment window
	})
	var payResult activities.PaymentResult
	if err := workflow.ExecuteChildWorkflow(payCtx, PaymentProcessingWorkflow, input).Get(ctx, &payResult); err != nil {
		return nil, fmt.Errorf("payment workflow failed: %w", err)
	}
	if !payResult.Confirmed {
		workflow.ExecuteActivity(ctx, (*activities.Activities).UpdateDeclarationStatus, input.DeclarationId, "payment_pending", "Awaiting payment")
		return &WorkflowResult{
			DeclarationId: input.DeclarationId,
			Status:        "payment_pending",
			CompletedAt:   workflow.Now(ctx),
			Message:       "Payment pending",
		}, nil
	}

	// Step 7: Issue clearance
	workflow.ExecuteActivity(ctx, (*activities.Activities).IssueClearance, input.DeclarationId)
	workflow.ExecuteActivity(ctx, (*activities.Activities).NotifyTrader, input.TraderId, input.DeclarationId, "cleared")
	workflow.ExecuteActivity(ctx, (*activities.Activities).UpdateDeclarationStatus, input.DeclarationId, "cleared", "")

	logger.Info("CustomsClearanceWorkflow completed", "declarationId", input.DeclarationId, "lane", riskResult.Lane)
	return &WorkflowResult{
		DeclarationId: input.DeclarationId,
		Status:        "cleared",
		CompletedAt:   workflow.Now(ctx),
		Message:       fmt.Sprintf("Cleared via %s lane", riskResult.Lane),
	}, nil
}

// ── Workflow 2: Risk Assessment ───────────────────────────────────────────────
// Calls the Python ML risk engine and returns a risk score + lane assignment
func RiskAssessmentWorkflow(ctx workflow.Context, input DeclarationInput) (*activities.RiskResult, error) {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var result activities.RiskResult
	err := workflow.ExecuteActivity(ctx, (*activities.Activities).ComputeRiskScore, input).Get(ctx, &result)
	return &result, err
}

// ── Workflow 3: OGA Approval ──────────────────────────────────────────────────
// Creates OGA permits and waits for all agencies to respond (with SLA monitoring)
func OGAApprovalWorkflow(ctx workflow.Context, input DeclarationInput) (*activities.OGAResult, error) {
	logger := workflow.GetLogger(ctx)
	ao := defaultActivityOptions()
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Create permits for required agencies
	var permits []activities.PermitInfo
	if err := workflow.ExecuteActivity(ctx, (*activities.Activities).CreateOGAPermits, input.DeclarationId, input.HSCode).Get(ctx, &permits); err != nil {
		return nil, err
	}

	if len(permits) == 0 {
		return &activities.OGAResult{AllApproved: true, AnyRejected: false}, nil
	}

	logger.Info("OGAApprovalWorkflow: waiting for agency responses", "permits", len(permits))

	// Wait for all permits to be resolved (with 72-hour SLA timeout)
	slaDeadline := workflow.Now(ctx).Add(72 * time.Hour)

	for {
		var status activities.OGAStatus
		if err := workflow.ExecuteActivity(ctx, (*activities.Activities).CheckOGAPermitStatus, input.DeclarationId).Get(ctx, &status); err != nil {
			return nil, err
		}

		if status.AnyRejected {
			return &activities.OGAResult{AllApproved: false, AnyRejected: true}, nil
		}
		if status.AllApproved {
			return &activities.OGAResult{AllApproved: true, AnyRejected: false}, nil
		}

		// Check SLA breach
		if workflow.Now(ctx).After(slaDeadline) {
			workflow.ExecuteActivity(ctx, (*activities.Activities).EscalateSLABreach, input.DeclarationId)
			logger.Warn("OGA SLA breach — escalating", "declarationId", input.DeclarationId)
		}

		// Wait 5 minutes before polling again
		workflow.Sleep(ctx, 5*time.Minute)
	}
}

// ── Workflow 4: Payment Processing ───────────────────────────────────────────
// Creates duty invoice, initiates Mojaloop transfer, and waits for confirmation
func PaymentProcessingWorkflow(ctx workflow.Context, input DeclarationInput) (*activities.PaymentResult, error) {
	logger := workflow.GetLogger(ctx)
	ao := paymentActivityOptions()
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Create duty invoice
	var invoice activities.InvoiceInfo
	if err := workflow.ExecuteActivity(ctx, (*activities.Activities).CreateDutyInvoice, input.DeclarationId, input.TraderId, input.DeclaredValue).Get(ctx, &invoice); err != nil {
		return nil, err
	}

	logger.Info("PaymentProcessingWorkflow: invoice created", "invoiceId", invoice.InvoiceId, "amount", invoice.TotalAmount)

	// Wait for payment confirmation (with 72-hour window)
	paymentDeadline := workflow.Now(ctx).Add(72 * time.Hour)
	reminderSent := false

	for {
		var payStatus activities.PaymentStatus
		if err := workflow.ExecuteActivity(ctx, (*activities.Activities).CheckPaymentStatus, invoice.InvoiceId).Get(ctx, &payStatus); err != nil {
			return nil, err
		}

		if payStatus.Confirmed {
			return &activities.PaymentResult{
				Confirmed:    true,
				InvoiceId:    invoice.InvoiceId,
				MojaloopTxID: payStatus.MojaloopTxID,
				PaidAt:       payStatus.PaidAt,
			}, nil
		}
		if payStatus.Failed {
			return &activities.PaymentResult{Confirmed: false, InvoiceId: invoice.InvoiceId}, nil
		}

		// Send reminder at 24 hours
		if !reminderSent && workflow.Now(ctx).After(paymentDeadline.Add(-48*time.Hour)) {
			workflow.ExecuteActivity(ctx, (*activities.Activities).SendPaymentReminder, input.TraderId, invoice.InvoiceId)
			reminderSent = true
		}

		// Payment window expired
		if workflow.Now(ctx).After(paymentDeadline) {
			workflow.ExecuteActivity(ctx, (*activities.Activities).ExpireInvoice, invoice.InvoiceId)
			return &activities.PaymentResult{Confirmed: false, InvoiceId: invoice.InvoiceId}, nil
		}

		workflow.Sleep(ctx, 5*time.Minute)
	}
}

// ── Workflow 5: Cargo Release ─────────────────────────────────────────────────
// Coordinates port operator notification and cargo release after clearance
func CargoReleaseWorkflow(ctx workflow.Context, input DeclarationInput) (*WorkflowResult, error) {
	ao := defaultActivityOptions()
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Notify port operator
	workflow.ExecuteActivity(ctx, (*activities.Activities).NotifyPortOperator, input.DeclarationId)

	// Wait for port release confirmation (with 24-hour SLA)
	releaseDeadline := workflow.Now(ctx).Add(24 * time.Hour)

	for {
		var released bool
		workflow.ExecuteActivity(ctx, (*activities.Activities).CheckCargoReleaseStatus, input.DeclarationId).Get(ctx, &released)

		if released {
			workflow.ExecuteActivity(ctx, (*activities.Activities).NotifyTrader, input.TraderId, input.DeclarationId, "cargo_released")
			return &WorkflowResult{
				DeclarationId: input.DeclarationId,
				Status:        "cargo_released",
				CompletedAt:   workflow.Now(ctx),
			}, nil
		}

		if workflow.Now(ctx).After(releaseDeadline) {
			workflow.ExecuteActivity(ctx, (*activities.Activities).EscalateCargoRelease, input.DeclarationId)
		}

		workflow.Sleep(ctx, 15*time.Minute)
	}
}

// ── Workflow 6: AEO Application ───────────────────────────────────────────────
// Manages the AEO certification application process
func AEOApplicationWorkflow(ctx workflow.Context, input struct {
	ProfileId int64  `json:"profileId"`
	TraderId  int64  `json:"traderId"`
	Tier      string `json:"tier"`
}) (*WorkflowResult, error) {
	ao := defaultActivityOptions()
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Step 1: Validate eligibility
	var eligible bool
	workflow.ExecuteActivity(ctx, (*activities.Activities).ValidateAEOEligibility, input.ProfileId).Get(ctx, &eligible)
	if !eligible {
		return &WorkflowResult{Status: "rejected", Message: "Eligibility criteria not met"}, nil
	}

	// Step 2: Assign auditor and schedule site visit
	workflow.ExecuteActivity(ctx, (*activities.Activities).AssignAEOAuditor, input.ProfileId)

	// Step 3: Wait for audit completion (30-day window)
	workflow.Sleep(ctx, 30*24*time.Hour)

	// Step 4: Review audit results
	var auditPassed bool
	workflow.ExecuteActivity(ctx, (*activities.Activities).ReviewAEOAudit, input.ProfileId).Get(ctx, &auditPassed)

	if auditPassed {
		workflow.ExecuteActivity(ctx, (*activities.Activities).GrantAEOCertificate, input.ProfileId, input.Tier)
		return &WorkflowResult{Status: "aeo_granted", Message: fmt.Sprintf("AEO %s certificate granted", input.Tier)}, nil
	}

	workflow.ExecuteActivity(ctx, (*activities.Activities).RejectAEOApplication, input.ProfileId, "Audit failed")
	return &WorkflowResult{Status: "rejected", Message: "AEO audit failed"}, nil
}

// ── Workflow 7: Duty Drawback ─────────────────────────────────────────────────
// Processes duty drawback claims for re-exported goods
func DutyDrawbackWorkflow(ctx workflow.Context, input struct {
	ClaimId       int64   `json:"claimId"`
	TraderId      int64   `json:"traderId"`
	DeclarationId int64   `json:"declarationId"`
	ClaimAmount   float64 `json:"claimAmount"`
}) (*WorkflowResult, error) {
	ao := defaultActivityOptions()
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Verify original import declaration
	var verified bool
	workflow.ExecuteActivity(ctx, (*activities.Activities).VerifyImportDeclaration, input.DeclarationId).Get(ctx, &verified)
	if !verified {
		return &WorkflowResult{Status: "rejected", Message: "Original import declaration not found"}, nil
	}

	// Verify export declaration
	workflow.ExecuteActivity(ctx, (*activities.Activities).VerifyExportDeclaration, input.DeclarationId)

	// Calculate eligible refund amount
	var refundAmount float64
	workflow.ExecuteActivity(ctx, (*activities.Activities).CalculateDutyDrawback, input.DeclarationId, input.ClaimAmount).Get(ctx, &refundAmount)

	// Approve and process refund via TigerBeetle + Mojaloop
	workflow.ExecuteActivity(ctx, (*activities.Activities).ProcessDutyRefund, input.ClaimId, input.TraderId, refundAmount)

	return &WorkflowResult{
		Status:  "refund_processed",
		Message: fmt.Sprintf("Duty drawback of %.2f processed", refundAmount),
	}, nil
}

// ── Workflow 8: Post-Clearance Audit ─────────────────────────────────────────
// Schedules and executes post-clearance audit for selected declarations
func PostClearanceAuditWorkflow(ctx workflow.Context, input struct {
	AuditId       int64 `json:"auditId"`
	DeclarationId int64 `json:"declarationId"`
	TraderId      int64 `json:"traderId"`
}) (*WorkflowResult, error) {
	ao := defaultActivityOptions()
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Notify trader of audit
	workflow.ExecuteActivity(ctx, (*activities.Activities).NotifyTrader, input.TraderId, input.DeclarationId, "audit_scheduled")

	// Wait for document submission (14-day window)
	workflow.Sleep(ctx, 14*24*time.Hour)

	// Review submitted documents
	var findings []string
	workflow.ExecuteActivity(ctx, (*activities.Activities).ReviewAuditDocuments, input.AuditId).Get(ctx, &findings)

	if len(findings) == 0 {
		workflow.ExecuteActivity(ctx, (*activities.Activities).CloseAudit, input.AuditId, "no_findings")
		return &WorkflowResult{Status: "audit_closed", Message: "No findings — audit closed"}, nil
	}

	// Issue penalty notice
	workflow.ExecuteActivity(ctx, (*activities.Activities).IssuePenaltyNotice, input.AuditId, findings)
	return &WorkflowResult{Status: "penalty_issued", Message: fmt.Sprintf("%d findings — penalty notice issued", len(findings))}, nil
}

// ── Workflow 9: ASEAN Single Window G2G ──────────────────────────────────────
// Exchanges trade documents with ASEAN Single Window partner countries
func ASEANSingleWindowWorkflow(ctx workflow.Context, input struct {
	DeclarationId   int64  `json:"declarationId"`
	PartnerCountry  string `json:"partnerCountry"`
	MessageType     string `json:"messageType"` // "ACDD", "ACOD", "ACCO"
	DocumentPayload string `json:"documentPayload"`
}) (*WorkflowResult, error) {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    5,
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    5 * time.Minute,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Send G2G message
	var messageId string
	if err := workflow.ExecuteActivity(ctx, (*activities.Activities).SendASEANMessage, input.DeclarationId, input.PartnerCountry, input.MessageType, input.DocumentPayload).Get(ctx, &messageId); err != nil {
		return nil, err
	}

	// Wait for acknowledgment (24-hour window)
	ackDeadline := workflow.Now(ctx).Add(24 * time.Hour)
	for {
		var acked bool
		workflow.ExecuteActivity(ctx, (*activities.Activities).CheckASEANAck, messageId).Get(ctx, &acked)
		if acked {
			return &WorkflowResult{Status: "g2g_acknowledged", Message: fmt.Sprintf("G2G message %s acknowledged by %s", messageId, input.PartnerCountry)}, nil
		}
		if workflow.Now(ctx).After(ackDeadline) {
			workflow.ExecuteActivity(ctx, (*activities.Activities).RetryASEANMessage, messageId)
		}
		workflow.Sleep(ctx, 30*time.Minute)
	}
}

// ── Workflow 10: Sanctions Screening ─────────────────────────────────────────
// Screens trader, consignee, and goods against sanctions lists
func SanctionsScreeningWorkflow(ctx workflow.Context, input DeclarationInput) (*activities.SanctionsResult, error) {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var result activities.SanctionsResult
	err := workflow.ExecuteActivity(ctx, (*activities.Activities).ScreenSanctions, input.DeclarationId, input.TraderId).Get(ctx, &result)
	return &result, err
}

// ── Workflow 11: Confirm Payment (Mojaloop fulfilment → TigerBeetle post) ─────
// Called by the Mojaloop gateway after transfer fulfilment.
// Retries the ConfirmPayment activity with exponential backoff so that
// transient TigerBeetle / Postgres failures do not lose the payment event.
func ConfirmPaymentWorkflow(ctx workflow.Context, input activities.ConfirmPaymentInput) (*activities.ConfirmPaymentResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("ConfirmPaymentWorkflow started",
		"invoiceId", input.InvoiceID,
		"mojaloopTxId", input.MojaloopTxID,
	)

	// Dedicated activity options: 5 attempts, 2s initial, 2× backoff, 5 min max.
	// Non-retryable errors (4xx) are propagated immediately without further retries.
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		HeartbeatTimeout:    10 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:        2 * time.Second,
			BackoffCoefficient:     2.0,
			MaximumInterval:        5 * time.Minute,
			MaximumAttempts:        5,
			NonRetryableErrorTypes: []string{"NON_RETRYABLE_PAYMENT_ERROR"},
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var result *activities.ConfirmPaymentResult
	if err := workflow.ExecuteActivity(ctx, (*activities.Activities).ConfirmPayment, input).Get(ctx, &result); err != nil {
		logger.Error("ConfirmPaymentWorkflow: all retries exhausted",
			"invoiceId", input.InvoiceID,
			"error", err,
		)
		return nil, err
	}

	logger.Info("ConfirmPaymentWorkflow completed",
		"invoiceId", result.InvoiceID,
		"status", result.Status,
	)
	return result, nil
}
