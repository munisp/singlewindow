// Package workflows — Central registry of all Temporal workflow and activity types
// for the TradeGateway NGSWTP platform.
//
// This file is the single source of truth for worker registration.
// When adding a new workflow or activity, add it here first, then implement it.
package workflows

import (
	"go.temporal.io/sdk/worker"

	"github.com/tradegateway/ngswtp/workflow-service/activities"
)

// TaskQueue is the Temporal task queue name for all NGSWTP workflows.
// All workers and clients must use this constant.
const TaskQueue = "ngswtp-fund-flow"

// ClearanceTaskQueue is the task queue for declaration clearance workflows.
const ClearanceTaskQueue = "ngswtp-clearance"

// RegisterAll registers every workflow and activity type with the given worker.
// Call this once from the worker main() after connecting to Temporal.
func RegisterAll(w worker.Worker) {
	registerClearanceWorkflows(w)
	registerFundFlowWorkflows(w)
	registerFundFlowActivities(w)
	registerClearanceActivities(w)
}

// ─── Declaration Clearance Workflows ─────────────────────────────────────────

func registerClearanceWorkflows(w worker.Worker) {
	w.RegisterWorkflow(DeclarationClearanceWorkflow)
}

func registerClearanceActivities(w worker.Worker) {
	w.RegisterActivity(activities.ScreenSanctionsActivity)
	w.RegisterActivity(activities.ComputeRiskScoreActivity)
	w.RegisterActivity(activities.RouteToOGAsActivity)
	w.RegisterActivity(activities.WaitForOGAApprovalActivity)
	w.RegisterActivity(activities.WaitForPhysicalInspectionActivity)
	w.RegisterActivity(activities.CalculateDutiesActivity)
	w.RegisterActivity(activities.UpdateDeclarationStatusActivity)
	w.RegisterActivity(activities.IssueClearancePermitActivity)
}

// ─── Fund-Flow Workflows (Scenarios 1–20) ────────────────────────────────────

func registerFundFlowWorkflows(w worker.Worker) {
	// Scenario 1–2: Import duty payment (green / red lane)
	// Handled by DeclarationClearanceWorkflow + DutyPaymentWorkflow below.

	// Scenario 3: Duty drawback
	w.RegisterWorkflow(DutyDrawbackWorkflow)

	// Scenarios 5–7: Bond management (lodge, forfeit, release)
	w.RegisterWorkflow(BondManagementWorkflow)
	w.RegisterWorkflow(BondForfeitureWorkflow)
	w.RegisterWorkflow(BondReleaseWorkflow)

	// Scenarios 8–9: Transit guarantee (lodge, discharge)
	w.RegisterWorkflow(TransitGuaranteeWorkflow)
	w.RegisterWorkflow(TransitGuaranteeDischargeWorkflow)

	// Scenario 10: Ex-bond duty payment
	w.RegisterWorkflow(ExBondDutyPaymentWorkflow)

	// Scenario 14: Post-clearance audit recovery
	w.RegisterWorkflow(AuditRecoveryWorkflow)

	// Scenario 15: Overpayment refund
	w.RegisterWorkflow(OverpaymentRefundWorkflow)

	// Scenario 18: Batch settlement (end-of-day)
	w.RegisterWorkflow(BatchSettlementWorkflow)

	// Scenario 19: Revenue reconciliation (daily)
	w.RegisterWorkflow(RevenueReconciliationWorkflow)
}

// ─── Fund-Flow Activities ─────────────────────────────────────────────────────

func registerFundFlowActivities(w worker.Worker) {
	// TigerBeetle ledger activities
	w.RegisterActivity(activities.TigerBeetleCreateAccountActivityImpl)
	w.RegisterActivity(activities.TigerBeetleTransferActivityImpl)
	w.RegisterActivity(activities.TigerBeetleReserveActivityImpl)
	w.RegisterActivity(activities.TigerBeetleCommitActivityImpl)
	w.RegisterActivity(activities.TigerBeetleVoidReserveActivityImpl)
	w.RegisterActivity(activities.TigerBeetleBatchTransferActivityImpl)
	w.RegisterActivity(activities.QueryTigerBeetleBalanceActivityImpl)
	w.RegisterActivity(activities.QueryPostgresBalanceMirrorActivityImpl)

	// Mojaloop ILP payment activities
	w.RegisterActivity(activities.MojaloopTransferActivityImpl)

	// Kafka / Fluvio event activities
	w.RegisterActivity(activities.PublishKafkaEventActivityImpl)
	w.RegisterActivity(activities.PublishKafkaBatchEventActivityImpl)
	w.RegisterActivity(activities.PublishFluvioStreamEventActivityImpl)

	// Permify authorization activities
	w.RegisterActivity(activities.CheckPermifyAuthorizationActivityImpl)

	// Domain state update activities
	w.RegisterActivity(activities.UpdateBondStatusActivityImpl)
	w.RegisterActivity(activities.UpdateTransitStatusActivityImpl)
	w.RegisterActivity(activities.VerifyTransitExitConfirmationActivityImpl)
	w.RegisterActivity(activities.UpdateDrawbackStatusActivityImpl)

	// Notification / escalation activities
	w.RegisterActivity(activities.SendDemandNoticeActivityImpl)
	w.RegisterActivity(activities.EscalateToEnforcementActivityImpl)
	w.RegisterActivity(activities.RaiseReconciliationAlertActivityImpl)
	w.RegisterActivity(activities.RaiseBalanceDiscrepancyAlertActivityImpl)

	// Delta Lake audit activities
	w.RegisterActivity(activities.WriteToDeltaLakeActivityImpl)

	// Batch payment activities
	w.RegisterActivity(activities.FetchBatchPaymentItemsActivityImpl)
	w.RegisterActivity(activities.ClaimBatchPaymentItemsActivityImpl)
	w.RegisterActivity(activities.ReleaseBatchPaymentItemsActivityImpl)
	w.RegisterActivity(activities.MarkBatchPaymentItemsCommittedActivityImpl)
}
