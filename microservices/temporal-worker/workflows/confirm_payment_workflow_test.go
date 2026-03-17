// confirm_payment_workflow_test.go — Integration tests for ConfirmPaymentWorkflow.
//
// Uses Temporal's testsuite.WorkflowTestSuite to run the workflow in-process
// with a mocked ConfirmPayment activity. No live Temporal server required.
//
// Test scenarios:
//   1. Happy path — activity succeeds on first attempt → workflow returns "paid"
//   2. Retry on 5xx — activity fails twice (503) then succeeds → workflow returns "paid"
//   3. Non-retryable 4xx — activity returns NON_RETRYABLE_PAYMENT_ERROR → workflow fails immediately
//   4. All retries exhausted — activity always returns 503 → workflow fails after MaxAttempts
//   5. Already confirmed (409) — activity returns "already_confirmed" → workflow returns success
//   6. Input forwarding — correct invoiceId and mojaloopTxId reach the activity
package workflows_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"

	"github.com/tradegateway/temporal-worker/activities"
	"github.com/tradegateway/temporal-worker/workflows"
)

// ─── Test Suite ──────────────────────────────────────────────────────────────

type ConfirmPaymentWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *ConfirmPaymentWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()
	s.env.RegisterWorkflow(workflows.ConfirmPaymentWorkflow)
	s.env.RegisterActivity(&activities.Activities{})
}

func (s *ConfirmPaymentWorkflowTestSuite) TearDownTest() {
	s.env.AssertExpectations(s.T())
}

func TestConfirmPaymentWorkflowSuite(t *testing.T) {
	suite.Run(t, new(ConfirmPaymentWorkflowTestSuite))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func sampleInput() activities.ConfirmPaymentInput {
	return activities.ConfirmPaymentInput{
		InvoiceID:    42,
		MojaloopTxID: "ml-tx-001",
		TBTxID:       "tb-42-1710000000",
		Method:       "mobile_money",
	}
}

// ─── Test Cases ──────────────────────────────────────────────────────────────

// 1. Happy path — activity succeeds on first attempt.
func (s *ConfirmPaymentWorkflowTestSuite) Test_HappyPath_SucceedsFirstAttempt() {
	input := sampleInput()
	expected := &activities.ConfirmPaymentResult{InvoiceID: 42, Status: "paid"}

	// Temporal test suite calls activity as (ctx, input) — use mock.Anything for ctx.
	s.env.OnActivity("ConfirmPayment", mock.Anything, input).Return(expected, nil).Once()

	s.env.ExecuteWorkflow(workflows.ConfirmPaymentWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result *activities.ConfirmPaymentResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("paid", result.Status)
	s.Equal(int64(42), result.InvoiceID)
}

// 2. Retry on 5xx — fails twice then succeeds.
func (s *ConfirmPaymentWorkflowTestSuite) Test_RetryOn5xx_SucceedsAfterTwoFailures() {
	input := sampleInput()
	expected := &activities.ConfirmPaymentResult{InvoiceID: 42, Status: "paid"}
	retryableErr := errors.New("confirm payment server error: HTTP 503 (retryable)")

	s.env.OnActivity("ConfirmPayment", mock.Anything, input).Return(nil, retryableErr).Once()
	s.env.OnActivity("ConfirmPayment", mock.Anything, input).Return(nil, retryableErr).Once()
	s.env.OnActivity("ConfirmPayment", mock.Anything, input).Return(expected, nil).Once()

	s.env.ExecuteWorkflow(workflows.ConfirmPaymentWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result *activities.ConfirmPaymentResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("paid", result.Status)
}

// 3. Non-retryable 4xx — workflow fails immediately without retrying.
func (s *ConfirmPaymentWorkflowTestSuite) Test_NonRetryable4xx_FailsImmediately() {
	input := sampleInput()
	nonRetryableErr := temporal.NewNonRetryableApplicationError(
		"confirm payment rejected: HTTP 404",
		"NON_RETRYABLE_PAYMENT_ERROR",
		nil,
	)

	// Should be called exactly once — no retries.
	s.env.OnActivity("ConfirmPayment", mock.Anything, input).Return(nil, nonRetryableErr).Once()

	s.env.ExecuteWorkflow(workflows.ConfirmPaymentWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError(), "expected workflow to fail with non-retryable error")
}

// 4. All retries exhausted — activity always returns 503.
func (s *ConfirmPaymentWorkflowTestSuite) Test_AllRetriesExhausted_WorkflowFails() {
	input := sampleInput()
	retryableErr := errors.New("confirm payment server error: HTTP 503 (retryable)")

	// MaximumAttempts = 5 in the workflow definition.
	s.env.OnActivity("ConfirmPayment", mock.Anything, input).Return(nil, retryableErr).Times(5)

	s.env.ExecuteWorkflow(workflows.ConfirmPaymentWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError(), "expected workflow to fail after all retries exhausted")
}

// 5. Already confirmed (409) — activity returns "already_confirmed" → workflow succeeds.
func (s *ConfirmPaymentWorkflowTestSuite) Test_AlreadyConfirmed_WorkflowSucceeds() {
	input := sampleInput()
	expected := &activities.ConfirmPaymentResult{InvoiceID: 42, Status: "already_confirmed"}

	s.env.OnActivity("ConfirmPayment", mock.Anything, input).Return(expected, nil).Once()

	s.env.ExecuteWorkflow(workflows.ConfirmPaymentWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result *activities.ConfirmPaymentResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("already_confirmed", result.Status)
}

// 6. Input forwarding — verify invoiceId and mojaloopTxId are passed to the activity.
func (s *ConfirmPaymentWorkflowTestSuite) Test_InputForwarding_ActivityReceivesCorrectInput() {
	input := activities.ConfirmPaymentInput{
		InvoiceID:    99,
		MojaloopTxID: "ml-tx-special",
		TBTxID:       "tb-99-special",
		Method:       "bank_transfer",
	}
	expected := &activities.ConfirmPaymentResult{InvoiceID: 99, Status: "paid"}

	// The mock will only match if the exact input is passed.
	s.env.OnActivity("ConfirmPayment", mock.Anything, input).Return(expected, nil).Once()

	s.env.ExecuteWorkflow(workflows.ConfirmPaymentWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result *activities.ConfirmPaymentResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal(int64(99), result.InvoiceID)
}
