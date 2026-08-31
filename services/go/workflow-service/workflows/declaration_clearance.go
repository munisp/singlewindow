// Package workflows implements Temporal durable workflows for the NGSWTP platform.
// The DeclarationClearanceWorkflow orchestrates the full lifecycle of a customs
// declaration from submission through risk assessment, OGA routing, payment
// confirmation, and final clearance — with automatic retry and compensation.
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/tradegateway/ngswtp/workflow-service/activities"
)

// ─── TYPES ────────────────────────────────────────────────────────────────────

// DeclarationInput is the workflow input passed when starting a clearance workflow.
type DeclarationInput struct {
	DeclarationID    int64   `json:"declaration_id"`
	UCR              string  `json:"ucr"`
	TraderID         string  `json:"trader_id"`
	IsAEO            bool    `json:"is_aeo"`
	HSCode           string  `json:"hs_code"`
	CountryOfOrigin  string  `json:"country_of_origin"`
	InvoiceValue     float64 `json:"invoice_value"`
	GoodsDescription string  `json:"goods_description"`
	DeclarationType  string  `json:"declaration_type"`
}

// ClearanceResult is the final output of the workflow.
type ClearanceResult struct {
	DeclarationID  int64     `json:"declaration_id"`
	UCR            string    `json:"ucr"`
	FinalStatus    string    `json:"final_status"`
	Lane           string    `json:"lane"`
	RiskScore      int       `json:"risk_score"`
	DutyAmount     float64   `json:"duty_amount"`
	PaymentRef     string    `json:"payment_ref"`
	ClearedAt      time.Time `json:"cleared_at"`
	OGAApprovals   []string  `json:"oga_approvals"`
	SanctionsClear bool      `json:"sanctions_clear"`
	PermitNumber   string    `json:"permit_number"`
}

// ─── WORKFLOW TASK QUEUE ──────────────────────────────────────────────────────
// The task queue constant lives in registry.go (ClearanceTaskQueue) — the
// duplicate definition here was removed (PRA-129).

// ─── RETRY POLICIES ───────────────────────────────────────────────────────────

var defaultRetryPolicy = &temporal.RetryPolicy{
	InitialInterval:    time.Second,
	BackoffCoefficient: 2.0,
	MaximumInterval:    30 * time.Second,
	MaximumAttempts:    5,
}

var criticalRetryPolicy = &temporal.RetryPolicy{
	InitialInterval:    2 * time.Second,
	BackoffCoefficient: 2.0,
	MaximumInterval:    60 * time.Second,
	MaximumAttempts:    10,
}

// ─── DECLARATION CLEARANCE WORKFLOW ──────────────────────────────────────────

// DeclarationClearanceWorkflow is the primary Temporal workflow that orchestrates
// the full customs clearance lifecycle. It implements the Rwanda ReSW joint
// inspection model: all OGAs are notified simultaneously and must all approve
// before clearance is issued.
//
// Clearance lanes:
//   - GREEN  (risk 0-30):  Auto-approve, payment, permit in < 4 hours
//   - YELLOW (risk 31-60): Document review required, 1-3 business days
//   - RED    (risk 61-100): Physical inspection required, 3-7 business days
//   - BLUE   (AEO):        Fast-track, < 1 hour regardless of risk score
func DeclarationClearanceWorkflow(ctx workflow.Context, input DeclarationInput) (*ClearanceResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("DeclarationClearanceWorkflow started",
		"declarationID", input.DeclarationID,
		"ucr", input.UCR,
		"isAEO", input.IsAEO,
	)

	result := &ClearanceResult{
		DeclarationID: input.DeclarationID,
		UCR:           input.UCR,
	}

	// ── STEP 1: Sanctions Screening ──────────────────────────────────────────
	// Always run first — a sanctions hit immediately blocks clearance.
	var sanctionsResult SanctionsResult
	sanctionsCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	if err := workflow.ExecuteActivity(sanctionsCtx, activities.ScreenSanctionsActivity, SanctionsInput{
		TraderID:    input.TraderID,
		CountryCode: input.CountryOfOrigin,
		UCR:         input.UCR,
	}).Get(ctx, &sanctionsResult); err != nil {
		return nil, fmt.Errorf("sanctions screening failed: %w", err)
	}

	if sanctionsResult.IsBlocked {
		logger.Warn("Declaration blocked by sanctions screening",
			"declarationID", input.DeclarationID,
			"reason", sanctionsResult.Reason,
		)
		if err := updateDeclarationStatus(ctx, input.DeclarationID, "blocked", "Sanctions screening: "+sanctionsResult.Reason); err != nil {
			return nil, err
		}
		result.FinalStatus = "blocked"
		result.SanctionsClear = false
		return result, nil
	}
	result.SanctionsClear = true

	// ── STEP 2: AI Risk Scoring ───────────────────────────────────────────────
	var riskResult RiskScoringResult
	riskCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	if err := workflow.ExecuteActivity(riskCtx, activities.ComputeRiskScoreActivity, RiskInput{
		DeclarationID:    input.DeclarationID,
		HSCode:           input.HSCode,
		CountryOfOrigin:  input.CountryOfOrigin,
		InvoiceValue:     input.InvoiceValue,
		GoodsDescription: input.GoodsDescription,
		DeclarationType:  input.DeclarationType,
		IsAEO:            input.IsAEO,
	}).Get(ctx, &riskResult); err != nil {
		return nil, fmt.Errorf("risk scoring failed: %w", err)
	}

	result.RiskScore = riskResult.Score
	result.Lane = riskResult.Lane

	// AEO traders always get blue lane fast-track
	if input.IsAEO {
		result.Lane = "blue"
	}

	logger.Info("Risk assessment complete",
		"score", riskResult.Score,
		"lane", result.Lane,
	)

	// ── STEP 3: Update Declaration Status ────────────────────────────────────
	statusMsg := fmt.Sprintf("Risk score: %d, Lane: %s", riskResult.Score, result.Lane)
	if err := updateDeclarationStatus(ctx, input.DeclarationID, "under_review", statusMsg); err != nil {
		return nil, err
	}

	// ── STEP 4: OGA Routing (Simultaneous — Rwanda Joint Inspection Model) ───
	// Determine which OGAs need to be notified based on HS code and goods type.
	var ogaRoutingResult OGARoutingResult
	ogaCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	if err := workflow.ExecuteActivity(ogaCtx, activities.RouteToOGAsActivity, OGARoutingInput{
		DeclarationID:    input.DeclarationID,
		HSCode:           input.HSCode,
		GoodsDescription: input.GoodsDescription,
		CountryOfOrigin:  input.CountryOfOrigin,
	}).Get(ctx, &ogaRoutingResult); err != nil {
		return nil, fmt.Errorf("OGA routing failed: %w", err)
	}

	// ── STEP 5: Wait for OGA Approvals (with lane-appropriate timeout) ────────
	var ogaTimeout time.Duration
	switch result.Lane {
	case "blue":
		ogaTimeout = 1 * time.Hour
	case "green":
		ogaTimeout = 4 * time.Hour
	case "yellow":
		ogaTimeout = 72 * time.Hour
	case "red":
		ogaTimeout = 168 * time.Hour // 7 days
	default:
		ogaTimeout = 72 * time.Hour
	}

	if len(ogaRoutingResult.RequiredOGAs) > 0 {
		// Launch parallel OGA approval workflows (fan-out)
		ogaApprovals := make([]workflow.Future, len(ogaRoutingResult.RequiredOGAs))
		for i, oga := range ogaRoutingResult.RequiredOGAs {
			ogaApprovalCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
				StartToCloseTimeout: ogaTimeout,
				RetryPolicy:         defaultRetryPolicy,
			})
			ogaApprovals[i] = workflow.ExecuteActivity(ogaApprovalCtx, activities.WaitForOGAApprovalActivity, OGAApprovalInput{
				DeclarationID: input.DeclarationID,
				OGACode:       oga,
				Lane:          result.Lane,
			})
		}

		// Wait for all OGA approvals (joint inspection model)
		result.OGAApprovals = make([]string, 0, len(ogaRoutingResult.RequiredOGAs))
		for i, future := range ogaApprovals {
			var approval OGAApprovalResult
			if err := future.Get(ctx, &approval); err != nil {
				return nil, fmt.Errorf("OGA %s approval failed: %w", ogaRoutingResult.RequiredOGAs[i], err)
			}
			if approval.Rejected {
				if err := updateDeclarationStatus(ctx, input.DeclarationID, "rejected",
					fmt.Sprintf("Rejected by %s: %s", approval.OGACode, approval.Reason)); err != nil {
					return nil, err
				}
				result.FinalStatus = "rejected"
				return result, nil
			}
			result.OGAApprovals = append(result.OGAApprovals, approval.OGACode)
		}
	}

	// ── STEP 6: Physical Inspection (RED lane only) ───────────────────────────
	if result.Lane == "red" {
		var inspectionResult InspectionResult
		inspCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 7 * 24 * time.Hour,
			RetryPolicy:         nil, // No retry for human-in-the-loop
		})
		if err := workflow.ExecuteActivity(inspCtx, activities.WaitForPhysicalInspectionActivity, InspectionInput{
			DeclarationID: input.DeclarationID,
			UCR:           input.UCR,
		}).Get(ctx, &inspectionResult); err != nil {
			return nil, fmt.Errorf("physical inspection failed: %w", err)
		}
		if inspectionResult.Failed {
			if err := updateDeclarationStatus(ctx, input.DeclarationID, "rejected",
				"Physical inspection failed: "+inspectionResult.Reason); err != nil {
				return nil, err
			}
			result.FinalStatus = "rejected"
			return result, nil
		}
	}

	// ── STEP 7: Duty Calculation ──────────────────────────────────────────────
	var dutyResult DutyCalculationResult
	dutyCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         defaultRetryPolicy,
	})
	if err := workflow.ExecuteActivity(dutyCtx, activities.CalculateDutiesActivity, DutyInput{
		DeclarationID:   input.DeclarationID,
		HSCode:          input.HSCode,
		InvoiceValue:    input.InvoiceValue,
		CountryOfOrigin: input.CountryOfOrigin,
	}).Get(ctx, &dutyResult); err != nil {
		return nil, fmt.Errorf("duty calculation failed: %w", err)
	}
	result.DutyAmount = dutyResult.TotalDuty

	// ── STEP 8: Payment Confirmation ─────────────────────────────────────────
	// Wait for trader to pay via Mojaloop. Uses a signal to receive payment confirmation.
	paymentSignalCh := workflow.GetSignalChannel(ctx, "payment-confirmed")
	paymentTimeoutCtx, cancelPayment := workflow.WithCancel(ctx)
	defer cancelPayment()

	var paymentRef string
	paymentSelector := workflow.NewSelector(ctx)

	paymentSelector.AddReceive(paymentSignalCh, func(ch workflow.ReceiveChannel, more bool) {
		ch.Receive(paymentTimeoutCtx, &paymentRef)
	})

	paymentDeadline := workflow.NewTimer(paymentTimeoutCtx, 72*time.Hour)
	paymentSelector.AddFuture(paymentDeadline, func(f workflow.Future) {
		paymentRef = "" // timeout
	})

	paymentSelector.Select(ctx)

	if paymentRef == "" {
		// Payment timeout — mark as expired
		if err := updateDeclarationStatus(ctx, input.DeclarationID, "expired", "Payment not received within 72 hours"); err != nil {
			return nil, err
		}
		result.FinalStatus = "expired"
		return result, nil
	}
	result.PaymentRef = paymentRef

	// ── STEP 9: Issue Clearance Permit ───────────────────────────────────────
	var permitResult PermitResult
	permitCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	if err := workflow.ExecuteActivity(permitCtx, activities.IssueClearancePermitActivity, PermitInput{
		DeclarationID: input.DeclarationID,
		UCR:           input.UCR,
		TraderID:      input.TraderID,
		PaymentRef:    paymentRef,
		Lane:          result.Lane,
	}).Get(ctx, &permitResult); err != nil {
		return nil, fmt.Errorf("permit issuance failed: %w", err)
	}

	result.PermitNumber = permitResult.PermitNumber
	result.ClearedAt = permitResult.IssuedAt
	result.FinalStatus = "cleared"

	logger.Info("DeclarationClearanceWorkflow completed",
		"declarationID", input.DeclarationID,
		"permit", result.PermitNumber,
		"lane", result.Lane,
		"duration", time.Since(permitResult.IssuedAt).String(),
	)

	return result, nil
}

// ─── HELPER: Update Declaration Status ───────────────────────────────────────

func updateDeclarationStatus(ctx workflow.Context, declarationID int64, status, message string) error {
	updateCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 15 * time.Second,
		RetryPolicy:         criticalRetryPolicy,
	})
	return workflow.ExecuteActivity(updateCtx, activities.UpdateDeclarationStatusActivity, StatusUpdateInput{
		DeclarationID: declarationID,
		Status:        status,
		Message:       message,
	}).Get(ctx, nil)
}
