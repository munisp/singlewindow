// saga_compensation_test.go — PRA-054 (Phase 9): behavioral tests proving the
// duty-drawback / audit-recovery / overpayment-refund sagas actually COMPENSATE
// on failure paths (TigerBeetle reserve voided when the Mojaloop leg fails;
// commit never runs; reconciliation alerts fire on the critical inconsistency).
//
// Uses the canonical Temporal testsuite (go.temporal.io/sdk/testsuite) with
// activities intercepted at the workflow boundary — the standard way to test
// saga orchestration. What is asserted is REAL workflow behavior: which
// compensation activities run, with which arguments, in which order, and
// which never run.
package workflows

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

// activityProbe records exactly which saga steps ran and with what inputs.
type activityProbe struct {
	reserveCalls   []TigerBeetleTransferInput
	commitCalls    []TigerBeetleCommitInput
	voidCalls      []TigerBeetleVoidInput
	mojaloopCalls  []MojaloopTransferInput
	kafkaCalls     []KafkaEventInput
	statusUpdates  []UpdateDrawbackStatusInput
	alertCalls     []ReconciliationAlertInput
	transferCalls  []TigerBeetleTransferInput
	demandCalls    []DemandNoticeInput
	escalateCalls  []EnforcementInput
	permifyCalls   []PermifyAuthInput
}

// registerActivities installs the probe-backed mocks for every activity the
// sagas can invoke. Behavior knobs: mojErr/mojResult steer the Mojaloop leg,
// reserveErr/commitErr/transferErr steer the TigerBeetle legs.
func (p *activityProbe) registerActivities(
	env *testsuite.TestWorkflowEnvironment,
	mojResult MojaloopTransferResult,
	mojErr, reserveErr, commitErr, transferErr error,
	permifyOK ...bool,
) {
	permify := true
	if len(permifyOK) > 0 {
		permify = permifyOK[0]
	}
	env.OnActivity(CheckPermifyAuthorizationActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.permifyCalls = append(p.permifyCalls, args.Get(0).(PermifyAuthInput)) }).
		Return(permify, nil)

	env.OnActivity(TigerBeetleReserveActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.reserveCalls = append(p.reserveCalls, args.Get(0).(TigerBeetleTransferInput)) }).
		Return(TigerBeetleTransferResult{TransferID: "tb-reserve-1", Status: "reserved"}, reserveErr)

	env.OnActivity(MojaloopTransferActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.mojaloopCalls = append(p.mojaloopCalls, args.Get(0).(MojaloopTransferInput)) }).
		Return(mojResult, mojErr)

	env.OnActivity(TigerBeetleCommitActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.commitCalls = append(p.commitCalls, args.Get(0).(TigerBeetleCommitInput)) }).
		Return(commitErr)

	env.OnActivity(TigerBeetleVoidReserveActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.voidCalls = append(p.voidCalls, args.Get(0).(TigerBeetleVoidInput)) }).
		Return(nil)

	env.OnActivity(PublishKafkaEventActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.kafkaCalls = append(p.kafkaCalls, args.Get(0).(KafkaEventInput)) }).
		Return(nil)

	env.OnActivity(UpdateDrawbackStatusActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.statusUpdates = append(p.statusUpdates, args.Get(0).(UpdateDrawbackStatusInput)) }).
		Return(nil)

	env.OnActivity(RaiseReconciliationAlertActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.alertCalls = append(p.alertCalls, args.Get(0).(ReconciliationAlertInput)) }).
		Return(nil)

	env.OnActivity(TigerBeetleTransferActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.transferCalls = append(p.transferCalls, args.Get(0).(TigerBeetleTransferInput)) }).
		Return(TigerBeetleTransferResult{TransferID: "tb-xfer-1", Status: "committed"}, transferErr)

	env.OnActivity(SendDemandNoticeActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.demandCalls = append(p.demandCalls, args.Get(0).(DemandNoticeInput)) }).
		Return(nil)

	env.OnActivity(EscalateToEnforcementActivity, mock.Anything).
		Run(func(args mock.Arguments) { p.escalateCalls = append(p.escalateCalls, args.Get(0).(EnforcementInput)) }).
		Return(nil)
}

func drawbackInput() DrawbackInput {
	return DrawbackInput{
		ClaimID:             9001,
		TraderID:            "trader-1",
		TraderAccountID:     "tb-acct-trader-1",
		ImportDeclarationID: 101,
		ExportDeclarationID: 202,
		ApprovedAmountMinor: 150_000,
		Currency:            "NGN",
		DrawbackType:        "manufacturing",
		ApprovedByOfficerID: "officer-9",
		NCSRevenueAccountID: "tb-acct-ncs-revenue",
		Ledger:              700,
	}
}

// ─── DUTY DRAWBACK SAGA ─────────────────────────────────────────────────────

func TestDutyDrawback_HappyPath_CommitsWithoutCompensation(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env,
		MojaloopTransferResult{TransferID: "moja-1", Success: true, Fulfilment: "fulfil-1"},
		nil, nil, nil, nil)

	env.ExecuteWorkflow(DutyDrawbackWorkflow, drawbackInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result *DrawbackResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "paid", result.Status)
	require.Equal(t, "tb-reserve-1", result.TigerBeetleTxID)
	require.Equal(t, "moja-1", result.MojaloopTxID)

	// Saga ran reserve → mojaloop → commit; compensation NEVER ran.
	require.Len(t, probe.reserveCalls, 1)
	require.Equal(t, "tb-acct-ncs-revenue", probe.reserveCalls[0].DebitAccountID)
	require.Equal(t, "tb-acct-trader-1", probe.reserveCalls[0].CreditAccountID)
	require.Equal(t, int64(150_000), probe.reserveCalls[0].AmountMinor)
	require.Len(t, probe.commitCalls, 1)
	require.Equal(t, "tb-reserve-1", probe.commitCalls[0].ReservedTransferID)
	require.Equal(t, "fulfil-1", probe.commitCalls[0].MojaloopFulfilment)
	require.Empty(t, probe.voidCalls, "compensation must not run on the happy path")
	require.Empty(t, probe.alertCalls)
	// Terminal state propagated: claim marked paid + completion event published.
	require.NotEmpty(t, probe.statusUpdates)
	require.Equal(t, "paid", probe.statusUpdates[len(probe.statusUpdates)-1].Status)
	require.NotEmpty(t, probe.kafkaCalls)
	require.Equal(t, "payment.drawback.completed", probe.kafkaCalls[0].Topic)
}

func TestDutyDrawback_MojaloopError_CompensatesReserve(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env,
		MojaloopTransferResult{},
		errors.New("payer FSP rejected: insufficient liquidity"), nil, nil, nil)

	env.ExecuteWorkflow(DutyDrawbackWorkflow, drawbackInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result *DrawbackResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "compensated", result.Status)
	require.Contains(t, result.FailureReason, "Mojaloop transfer failed")

	// THE compensation proof: the reserve was VOIDED with the reserved
	// transfer id and the mojaloop_transfer_failed reason; COMMIT never ran.
	require.Len(t, probe.reserveCalls, 1)
	require.Len(t, probe.voidCalls, 1)
	require.Equal(t, "tb-reserve-1", probe.voidCalls[0].ReservedTransferID)
	require.Equal(t, "mojaloop_transfer_failed", probe.voidCalls[0].Reason)
	require.Empty(t, probe.commitCalls, "commit must never run after a failed Mojaloop leg")
	// Claim closed as failed with the reason persisted.
	require.NotEmpty(t, probe.statusUpdates)
	require.Equal(t, "failed", probe.statusUpdates[len(probe.statusUpdates)-1].Status)
	require.Empty(t, probe.kafkaCalls, "no completion event may be published for a compensated saga")
}

func TestDutyDrawback_MojaloopUnsuccessfulResult_CompensatesReserve(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env,
		MojaloopTransferResult{Success: false, ErrorCode: "3204", ErrorDesc: "payee rejected"},
		nil, nil, nil, nil)

	env.ExecuteWorkflow(DutyDrawbackWorkflow, drawbackInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result *DrawbackResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "compensated", result.Status)
	require.Len(t, probe.voidCalls, 1, "a non-success Mojaloop result (no transport error) must still compensate")
	require.Empty(t, probe.commitCalls)
}

func TestDutyDrawback_ReserveFailure_NoDownstreamSteps(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env,
		MojaloopTransferResult{},
		nil, errors.New("tigerbeetle unavailable"), nil, nil)

	env.ExecuteWorkflow(DutyDrawbackWorkflow, drawbackInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result *DrawbackResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "failed", result.Status)
	require.Contains(t, result.FailureReason, "TigerBeetle reserve failed")

	// Nothing downstream of the failed reserve may run.
	require.Empty(t, probe.mojaloopCalls)
	require.Empty(t, probe.voidCalls, "no compensation needed — the reserve never happened")
	require.Empty(t, probe.commitCalls)
	require.Equal(t, "failed", probe.statusUpdates[len(probe.statusUpdates)-1].Status)
}

func TestDutyDrawback_CommitFailureAfterMojaloopSuccess_RaisesReconciliation(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env,
		MojaloopTransferResult{TransferID: "moja-9", Success: true, Fulfilment: "fulfil-9"},
		nil, nil, errors.New("tigerbeetle commit rejected"), nil)

	env.ExecuteWorkflow(DutyDrawbackWorkflow, drawbackInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result *DrawbackResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "reconciliation_required", result.Status)

	// The money MOVED (Mojaloop succeeded) — voiding would be wrong; the saga
	// must raise the reconciliation alert with both transaction ids instead.
	require.Empty(t, probe.voidCalls, "voiding after a successful payout would double-refund")
	require.NotEmpty(t, probe.alertCalls)
	require.Equal(t, "tb-reserve-1", probe.alertCalls[0].TBTxID)
	require.Equal(t, "moja-9", probe.alertCalls[0].MojaloopTxID)
	require.Equal(t, "drawback", probe.alertCalls[0].FlowType)
}

func TestDutyDrawback_AuthorizationDenied_StopsBeforeReserve(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	// Permify denies the officer (testify matches the first expectation, so
	// the denial must be the registered behavior, not an override).
	probe.registerActivities(env, MojaloopTransferResult{}, nil, nil, nil, nil, false)

	env.ExecuteWorkflow(DutyDrawbackWorkflow, drawbackInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result *DrawbackResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "failed", result.Status)
	require.Equal(t, "authorization denied", result.FailureReason)
	require.Empty(t, probe.reserveCalls, "no money movement may happen before authorization")
	require.Empty(t, probe.mojaloopCalls)
}

// ─── OVERPAYMENT REFUND SAGA ────────────────────────────────────────────────

func overpaymentInput() OverpaymentRefundInput {
	return OverpaymentRefundInput{
		AuditID:             7001,
		DeclarationID:       303,
		TraderID:            "trader-2",
		TraderAccountID:     "tb-acct-trader-2",
		NCSRevenueAccountID: "tb-acct-ncs-revenue",
		OverpaidMinor:       88_000,
		Currency:            "NGN",
		Ledger:              700,
		ApprovedByOfficerID: "officer-4",
	}
}

func TestOverpaymentRefund_HappyPath_Refunds(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env,
		MojaloopTransferResult{TransferID: "moja-r1", Success: true, Fulfilment: "ful-r1"},
		nil, nil, nil, nil)

	env.ExecuteWorkflow(OverpaymentRefundWorkflow, overpaymentInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result *OverpaymentRefundResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "refunded", result.Status)
	require.Len(t, probe.commitCalls, 1)
	require.Empty(t, probe.voidCalls)
	require.NotEmpty(t, probe.kafkaCalls)
	require.Equal(t, "audit.overpayment.refunded", probe.kafkaCalls[0].Topic)
}

func TestOverpaymentRefund_MojaloopFailure_CompensatesReserve(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env,
		MojaloopTransferResult{},
		errors.New("switch timeout"), nil, nil, nil)

	env.ExecuteWorkflow(OverpaymentRefundWorkflow, overpaymentInput())
	require.True(t, env.IsWorkflowCompleted())
	// This workflow surfaces the Mojaloop error alongside the compensated state.
	require.Error(t, env.GetWorkflowError())
	require.Contains(t, env.GetWorkflowError().Error(), "Mojaloop refund failed")

	require.Len(t, probe.voidCalls, 1, "failed refund leg must void the TigerBeetle reserve")
	require.Equal(t, "mojaloop_refund_failed", probe.voidCalls[0].Reason)
	require.Equal(t, "tb-reserve-1", probe.voidCalls[0].ReservedTransferID)
	require.Empty(t, probe.commitCalls)
	require.Empty(t, probe.kafkaCalls)
}

// ─── AUDIT RECOVERY SAGA ────────────────────────────────────────────────────

func auditRecoveryInput(deadline time.Time) AuditRecoveryInput {
	return AuditRecoveryInput{
		AuditID:             6001,
		DeclarationID:       404,
		TraderID:            "trader-3",
		TraderAccountID:     "tb-acct-trader-3",
		NCSRevenueAccountID: "tb-acct-ncs-revenue",
		UnderpaidMinor:      250_000,
		Currency:            "NGN",
		Ledger:              700,
		DemandNoticeRef:     "DN-6001",
		OfficerID:           "officer-2",
		PaymentDeadline:     deadline.UTC().Format(time.RFC3339),
	}
}

func TestAuditRecovery_PaymentSignalReceived_RecordsRecovery(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env, MojaloopTransferResult{}, nil, nil, nil, nil)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow("audit_recovery_payment_received", "pay-ref-77")
	}, time.Second)

	env.ExecuteWorkflow(AuditRecoveryWorkflow, auditRecoveryInput(time.Now().Add(time.Hour)))
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result *AuditRecoveryResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "recovered", result.Status)
	require.Equal(t, "tb-xfer-1", result.TigerBeetleTxID)

	// Demand notice went out, then the recovery transfer debited the trader
	// and credited NCS Revenue with the signal-bound idempotency key.
	require.NotEmpty(t, probe.demandCalls)
	require.Equal(t, int64(250_000), probe.demandCalls[0].AmountMinor)
	require.Len(t, probe.transferCalls, 1)
	require.Equal(t, "tb-acct-trader-3", probe.transferCalls[0].DebitAccountID)
	require.Equal(t, "tb-acct-ncs-revenue", probe.transferCalls[0].CreditAccountID)
	require.Equal(t, "audit:recovery:6001:pay-ref-77", probe.transferCalls[0].IdempotencyKey)
	require.Empty(t, probe.escalateCalls, "paid recoveries must not escalate")
	require.NotEmpty(t, probe.kafkaCalls)
	require.Equal(t, "audit.recovery.completed", probe.kafkaCalls[0].Topic)
}

func TestAuditRecovery_DeadlineExceeded_EscalatesWithoutTransfer(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env, MojaloopTransferResult{}, nil, nil, nil, nil)

	// Deadline already in the past → the timer fires immediately, no signal.
	env.ExecuteWorkflow(AuditRecoveryWorkflow, auditRecoveryInput(time.Now().Add(-time.Minute)))
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result *AuditRecoveryResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "escalated", result.Status)

	require.NotEmpty(t, probe.escalateCalls)
	require.Equal(t, "payment_deadline_exceeded", probe.escalateCalls[0].Reason)
	require.Equal(t, int64(250_000), probe.escalateCalls[0].AmountMinor)
	require.Empty(t, probe.transferCalls, "no recovery transfer may be recorded without a payment signal")
	require.Empty(t, probe.kafkaCalls)
}

func TestAuditRecovery_TransferFailure_FailsLoudly(t *testing.T) {
	suite := testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	probe := &activityProbe{}
	probe.registerActivities(env, MojaloopTransferResult{}, nil, nil, nil,
		errors.New("tigerbeetle write rejected"))

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow("audit_recovery_payment_received", "pay-ref-88")
	}, time.Second)

	env.ExecuteWorkflow(AuditRecoveryWorkflow, auditRecoveryInput(time.Now().Add(time.Hour)))
	require.True(t, env.IsWorkflowCompleted())
	// The workflow surfaces the failed ledger write as an error (fail-closed —
	// a payment signal without a ledger record must never report "recovered").
	require.Error(t, env.GetWorkflowError())
	require.Contains(t, env.GetWorkflowError().Error(), "TigerBeetle audit recovery transfer failed")
	require.Empty(t, probe.kafkaCalls, "no completion event without a durable ledger record")
}
