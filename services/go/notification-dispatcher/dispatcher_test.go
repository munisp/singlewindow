package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

// multiMockHTTPClient returns responses from a queue.
type multiMockHTTPClient struct {
	responses []*http.Response
	errors    []error
	callCount int
}

func (m *multiMockHTTPClient) Do(req *http.Request) (*http.Response, error) {
	idx := m.callCount
	m.callCount++
	if idx < len(m.errors) && m.errors[idx] != nil {
		return nil, m.errors[idx]
	}
	if idx < len(m.responses) {
		return m.responses[idx], nil
	}
	return &http.Response{StatusCode: 200, Body: http.NoBody}, nil
}

func ok200() *http.Response  { return &http.Response{StatusCode: 200, Body: http.NoBody} }
func err400() *http.Response { return &http.Response{StatusCode: 400, Body: http.NoBody} }

// ── FCM client tests ──────────────────────────────────────────────────────────

func TestFCMClientSend_Success(t *testing.T) {
	client := &FCMClient{ProjectID: "test-proj", HTTPClient: &multiMockHTTPClient{responses: []*http.Response{ok200()}}}
	if err := client.Send(context.Background(), "tok", "Title", "Body", nil); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestFCMClientSend_HTTP400(t *testing.T) {
	client := &FCMClient{ProjectID: "test-proj", HTTPClient: &multiMockHTTPClient{responses: []*http.Response{err400()}}}
	if err := client.Send(context.Background(), "tok", "Title", "Body", nil); err == nil {
		t.Fatal("expected error for HTTP 400")
	}
}

func TestFCMClientSend_NetworkError(t *testing.T) {
	client := &FCMClient{ProjectID: "test-proj", HTTPClient: &multiMockHTTPClient{errors: []error{errors.New("ECONNREFUSED")}}}
	if err := client.Send(context.Background(), "tok", "Title", "Body", nil); err == nil {
		t.Fatal("expected error for network failure")
	}
}

// ── APNs client tests ─────────────────────────────────────────────────────────

func TestAPNsClientSend_Success(t *testing.T) {
	client := &APNsClient{BundleID: "ng.gov.tradegateway", HTTPClient: &multiMockHTTPClient{responses: []*http.Response{ok200()}}}
	if err := client.Send(context.Background(), "tok", "Title", "Body"); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestAPNsClientSend_HTTP400(t *testing.T) {
	client := &APNsClient{BundleID: "ng.gov.tradegateway", HTTPClient: &multiMockHTTPClient{responses: []*http.Response{err400()}}}
	if err := client.Send(context.Background(), "tok", "Title", "Body"); err == nil {
		t.Fatal("expected error for HTTP 400")
	}
}

// ── DLQ schema tests ──────────────────────────────────────────────────────────

func TestDLQMessageSchema(t *testing.T) {
	dlq := DLQMessage{
		OriginalTopic:     TopicPushDispatch,
		OriginalPartition: 0,
		OriginalOffset:    42,
		Payload:           `{"token":"abc"}`,
		ErrorMessage:      "FCM 400",
		ErrorCode:         "DISPATCH_FAILED",
		AttemptCount:      MaxAttempts,
		FirstAttemptAt:    1000,
		LastAttemptAt:     2000,
		Platform:          "fcm",
	}
	data, err := json.Marshal(dlq)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, field := range []string{"originalTopic", "originalPartition", "originalOffset",
		"payload", "errorMessage", "errorCode", "attemptCount", "firstAttemptAt", "lastAttemptAt", "platform"} {
		if _, ok := out[field]; !ok {
			t.Errorf("missing field: %s", field)
		}
	}
}

func TestMaxAttempts(t *testing.T) {
	if MaxAttempts != 3 {
		t.Errorf("expected MaxAttempts=3, got %d", MaxAttempts)
	}
}

func TestTopicConstants(t *testing.T) {
	if TopicPushDispatch != "insider.push.dispatch" {
		t.Errorf("wrong dispatch topic: %s", TopicPushDispatch)
	}
	if TopicDLQ != "insider.push.dlq" {
		t.Errorf("wrong DLQ topic: %s", TopicDLQ)
	}
}

// ── DispatcherWithSender tests ────────────────────────────────────────────────

type mockSender struct {
	called bool
	err    error
}

func (m *mockSender) SendNotification(_ context.Context, _, _, _ string, _ map[string]string) error {
	m.called = true
	return m.err
}

func TestDispatcherWithSender_Success(t *testing.T) {
	s := &mockSender{}
	d := NewDispatcherWithSender(s)
	if err := d.Dispatch(context.Background(), "tok", "Title", "Body", nil); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
	if !s.called {
		t.Error("sender was not called")
	}
}

func TestDispatcherWithSender_Error(t *testing.T) {
	s := &mockSender{err: errors.New("send failed")}
	d := NewDispatcherWithSender(s)
	if err := d.Dispatch(context.Background(), "tok", "Title", "Body", nil); err == nil {
		t.Fatal("expected error")
	}
}
