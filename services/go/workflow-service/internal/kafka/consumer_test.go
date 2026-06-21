// TradeGateway NGSWTP — Temporal Kafka Consumer Tests
package kafka

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// mockTemporalClient is a test double for client.Client that records signals.
type mockTemporalClient struct {
	signals []signalRecord
	failOn  string // if set, return error when workflowID matches
}

type signalRecord struct {
	WorkflowID string
	SignalName string
	Payload    CompensationSignal
}

func (m *mockTemporalClient) SignalWorkflow(ctx context.Context, workflowID, runID, signalName string, arg interface{}) error {
	if m.failOn != "" && workflowID == m.failOn {
		return fmt.Errorf("workflow not found: %s", workflowID)
	}
	sig, _ := arg.(CompensationSignal)
	m.signals = append(m.signals, signalRecord{
		WorkflowID: workflowID,
		SignalName: signalName,
		Payload:    sig,
	})
	return nil
}

// Implement remaining client.Client methods as no-ops for the test double.
func (m *mockTemporalClient) ExecuteWorkflow(ctx context.Context, options interface{}, workflow interface{}, args ...interface{}) (interface{}, error) {
	return nil, nil
}
func (m *mockTemporalClient) GetWorkflow(ctx context.Context, workflowID, runID string) interface{} {
	return nil
}
func (m *mockTemporalClient) CancelWorkflow(ctx context.Context, workflowID, runID string) error {
	return nil
}
func (m *mockTemporalClient) TerminateWorkflow(ctx context.Context, workflowID, runID, reason string, details ...interface{}) error {
	return nil
}
func (m *mockTemporalClient) Close() {}

// newTestConsumer creates a Consumer with a mock Temporal client.
func newTestConsumer(mock *mockTemporalClient) *Consumer {
	cfg := DefaultConsumerConfig()
	// We pass nil for the Temporal client and use a thin wrapper approach
	c := &Consumer{
		cfg:    cfg,
		logger: newTestLogger(),
	}
	c.mockClient = mock
	return c
}

import (
	"fmt"
	"log"
	"os"
)

func newTestLogger() *log.Logger {
	return log.New(os.Stdout, "[test] ", 0)
}

func makeEvent(topic, transferId, quoteId, workflowId, errCode, errMsg string) []byte {
	e := MojaloopErrorEvent{
		Topic:        topic,
		TransferId:   transferId,
		QuoteId:      quoteId,
		WorkflowId:   workflowId,
		ErrorCode:    errCode,
		ErrorMessage: errMsg,
		PublishedAt:  time.Now().UTC(),
	}
	b, _ := json.Marshal(e)
	return b
}

// TestProcessMessage_TransferFailed routes to payment-failed signal.
func TestProcessMessage_TransferFailed(t *testing.T) {
	mock := &mockTemporalClient{}
	c := &Consumer{cfg: DefaultConsumerConfig(), logger: newTestLogger()}

	msg := makeEvent("mojaloop.transfer.failed", "xfer-001", "", "", "3100", "Payer FSP rejected")
	err := c.processMessageWithClient(context.Background(), "mojaloop.transfer.failed", msg, mock)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(mock.signals) != 1 {
		t.Fatalf("expected 1 signal, got %d", len(mock.signals))
	}
	if mock.signals[0].SignalName != SignalPaymentFailed {
		t.Errorf("expected signal %s, got %s", SignalPaymentFailed, mock.signals[0].SignalName)
	}
	if mock.signals[0].WorkflowID != "transfer-xfer-001" {
		t.Errorf("expected workflowID transfer-xfer-001, got %s", mock.signals[0].WorkflowID)
	}
}

// TestProcessMessage_QuoteError routes to quote-failed signal.
func TestProcessMessage_QuoteError(t *testing.T) {
	mock := &mockTemporalClient{}
	c := &Consumer{cfg: DefaultConsumerConfig(), logger: newTestLogger()}

	msg := makeEvent("mojaloop.quotes.error", "", "quote-abc", "", "3200", "Quote expired")
	err := c.processMessageWithClient(context.Background(), "mojaloop.quotes.error", msg, mock)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(mock.signals) != 1 {
		t.Fatalf("expected 1 signal, got %d", len(mock.signals))
	}
	if mock.signals[0].SignalName != SignalQuoteFailed {
		t.Errorf("expected signal %s, got %s", SignalQuoteFailed, mock.signals[0].SignalName)
	}
}

// TestProcessMessage_PartyError routes to party-lookup-failed signal.
func TestProcessMessage_PartyError(t *testing.T) {
	mock := &mockTemporalClient{}
	c := &Consumer{cfg: DefaultConsumerConfig(), logger: newTestLogger()}

	msg := makeEvent("mojaloop.parties.error", "", "", "party-wf-001", "3204", "Party not found")
	err := c.processMessageWithClient(context.Background(), "mojaloop.parties.error", msg, mock)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mock.signals[0].WorkflowID != "party-wf-001" {
		t.Errorf("expected explicit workflowId party-wf-001, got %s", mock.signals[0].WorkflowID)
	}
}

// TestProcessMessage_UnknownTopic dead-letters unknown topics.
func TestProcessMessage_UnknownTopic(t *testing.T) {
	mock := &mockTemporalClient{}
	c := &Consumer{cfg: DefaultConsumerConfig(), logger: newTestLogger()}

	msg := makeEvent("unknown.topic", "xfer-002", "", "", "9999", "Unknown")
	err := c.processMessageWithClient(context.Background(), "unknown.topic", msg, mock)
	if err == nil {
		t.Error("expected dead-letter error for unknown topic")
	}
	if len(mock.signals) != 0 {
		t.Errorf("expected no signals for unknown topic, got %d", len(mock.signals))
	}
}

// TestProcessMessage_MalformedJSON dead-letters malformed messages.
func TestProcessMessage_MalformedJSON(t *testing.T) {
	mock := &mockTemporalClient{}
	c := &Consumer{cfg: DefaultConsumerConfig(), logger: newTestLogger()}

	err := c.processMessageWithClient(context.Background(), "mojaloop.transfer.failed", []byte("not-json"), mock)
	if err == nil {
		t.Error("expected error for malformed JSON")
	}
	if len(mock.signals) != 0 {
		t.Errorf("expected no signals for malformed JSON, got %d", len(mock.signals))
	}
}

// TestProcessMessage_NoWorkflowId dead-letters when workflowId cannot be resolved.
func TestProcessMessage_NoWorkflowId(t *testing.T) {
	mock := &mockTemporalClient{}
	c := &Consumer{cfg: DefaultConsumerConfig(), logger: newTestLogger()}

	// No transferId, quoteId, or workflowId
	msg := makeEvent("mojaloop.transfer.failed", "", "", "", "3100", "No IDs")
	err := c.processMessageWithClient(context.Background(), "mojaloop.transfer.failed", msg, mock)
	if err == nil {
		t.Error("expected dead-letter error when no workflowId can be resolved")
	}
}

// TestProcessMessage_CompensationPayload verifies signal payload fields.
func TestProcessMessage_CompensationPayload(t *testing.T) {
	mock := &mockTemporalClient{}
	c := &Consumer{cfg: DefaultConsumerConfig(), logger: newTestLogger()}

	msg := makeEvent("mojaloop.transfer.failed", "xfer-999", "", "", "3100", "Payer limit exceeded")
	c.processMessageWithClient(context.Background(), "mojaloop.transfer.failed", msg, mock) //nolint:errcheck

	if len(mock.signals) == 0 {
		t.Fatal("expected signal to be sent")
	}
	payload := mock.signals[0].Payload
	if payload.ErrorCode != "3100" {
		t.Errorf("expected errorCode 3100, got %s", payload.ErrorCode)
	}
	if payload.ErrorMsg != "Payer limit exceeded" {
		t.Errorf("expected errorMsg 'Payer limit exceeded', got %s", payload.ErrorMsg)
	}
	if payload.TriggeredAt.IsZero() {
		t.Error("expected non-zero TriggeredAt")
	}
}

// TestProcessMessage_SignalWorkflowError dead-letters when Temporal signal fails.
func TestProcessMessage_SignalWorkflowError(t *testing.T) {
	mock := &mockTemporalClient{failOn: "transfer-xfer-fail"}
	c := &Consumer{cfg: DefaultConsumerConfig(), logger: newTestLogger()}

	msg := makeEvent("mojaloop.transfer.failed", "xfer-fail", "", "", "3100", "Payer rejected")
	err := c.processMessageWithClient(context.Background(), "mojaloop.transfer.failed", msg, mock)
	if err == nil {
		t.Error("expected dead-letter error when SignalWorkflow fails")
	}
}
