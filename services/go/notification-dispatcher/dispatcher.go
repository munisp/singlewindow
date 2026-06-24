package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	kafka "github.com/segmentio/kafka-go"
)

const (
	TopicPushDispatch = "insider.push.dispatch"
	TopicDLQ          = "insider.push.dlq"
	MaxAttempts       = 3
)

// PushMessage is the Kafka message payload for insider.push.dispatch.
type PushMessage struct {
	Token    string            `json:"token"`
	Platform string            `json:"platform"` // "fcm" | "apns"
	Title    string            `json:"title"`
	Body     string            `json:"body"`
	Data     map[string]string `json:"data,omitempty"`
}

// DLQMessage is written to insider.push.dlq on permanent failure.
type DLQMessage struct {
	OriginalTopic     string `json:"originalTopic"`
	OriginalPartition int    `json:"originalPartition"`
	OriginalOffset    int64  `json:"originalOffset"`
	Payload           string `json:"payload"`
	ErrorMessage      string `json:"errorMessage"`
	ErrorCode         string `json:"errorCode"`
	AttemptCount      int    `json:"attemptCount"`
	FirstAttemptAt    int64  `json:"firstAttemptAt"`
	LastAttemptAt     int64  `json:"lastAttemptAt"`
	Platform          string `json:"platform"`
}

// Dispatcher consumes insider.push.dispatch and fans out to FCM/APNs.
type Dispatcher struct {
	reader     *kafka.Reader
	dlqWriter  *kafka.Writer
	fcm        *FCMClient
	apns       *APNsClient
}

func NewDispatcher(broker string, fcm *FCMClient, apns *APNsClient) *Dispatcher {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  []string{broker},
		Topic:    TopicPushDispatch,
		GroupID:  "notification-dispatcher",
		MinBytes: 1,
		MaxBytes: 1 << 20,
	})
	dlqWriter := &kafka.Writer{
		Addr:  kafka.TCP(broker),
		Topic: TopicDLQ,
	}
	return &Dispatcher{reader: reader, dlqWriter: dlqWriter, fcm: fcm, apns: apns}
}

// Run starts the consume loop. Blocks until ctx is cancelled.
func (d *Dispatcher) Run(ctx context.Context) error {
	defer d.reader.Close()
	defer d.dlqWriter.Close()
	for {
		msg, err := d.reader.FetchMessage(ctx)
		if err != nil {
			return err
		}
		d.processWithRetry(ctx, msg)
		if err := d.reader.CommitMessages(ctx, msg); err != nil {
			log.Printf("[dispatcher] commit error: %v", err)
		}
	}
}

func (d *Dispatcher) processWithRetry(ctx context.Context, msg kafka.Message) {
	var push PushMessage
	if err := json.Unmarshal(msg.Value, &push); err != nil {
		log.Printf("[dispatcher] invalid payload: %v", err)
		return
	}
	backoff := []time.Duration{time.Second, 5 * time.Second, 30 * time.Second}
	firstAt := time.Now().UnixMilli()
	var lastErr error
	for attempt := 0; attempt < MaxAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(backoff[attempt-1])
		}
		switch push.Platform {
		case "fcm":
			lastErr = d.fcm.Send(ctx, push.Token, push.Title, push.Body, push.Data)
		case "apns":
			lastErr = d.apns.Send(ctx, push.Token, push.Title, push.Body)
		default:
			lastErr = fmt.Errorf("unknown platform: %s", push.Platform)
		}
		if lastErr == nil {
			return
		}
		log.Printf("[dispatcher] attempt %d/%d failed: %v", attempt+1, MaxAttempts, lastErr)
	}
	// All attempts exhausted — write to DLQ
	d.writeDLQ(ctx, msg, push.Platform, lastErr, MaxAttempts, firstAt)
}

func (d *Dispatcher) writeDLQ(ctx context.Context, orig kafka.Message, platform string, lastErr error, attempts int, firstAt int64) {
	dlq := DLQMessage{
		OriginalTopic:     orig.Topic,
		OriginalPartition: orig.Partition,
		OriginalOffset:    orig.Offset,
		Payload:           string(orig.Value),
		ErrorMessage:      lastErr.Error(),
		ErrorCode:         "DISPATCH_FAILED",
		AttemptCount:      attempts,
		FirstAttemptAt:    firstAt,
		LastAttemptAt:     time.Now().UnixMilli(),
		Platform:          platform,
	}
	data, _ := json.Marshal(dlq)
	if err := d.dlqWriter.WriteMessages(ctx, kafka.Message{Value: data}); err != nil {
		log.Printf("[dispatcher] DLQ write error: %v", err)
	}
}

// Sender is an interface for platform-agnostic notification dispatch (used in tests).
type Sender interface {
	SendNotification(ctx context.Context, token, title, body string, data map[string]string) error
}

// FCMSender wraps FCMClient to implement Sender.
type FCMSender struct{ client *FCMClient }

func (s *FCMSender) SendNotification(ctx context.Context, token, title, body string, data map[string]string) error {
	return s.client.Send(ctx, token, title, body, data)
}

// APNsSender wraps APNsClient to implement Sender.
type APNsSender struct{ client *APNsClient }

func (s *APNsSender) SendNotification(ctx context.Context, token, title, body string, data map[string]string) error {
	return s.client.Send(ctx, token, title, body)
}

// DispatcherWithSender is a testable variant that accepts a Sender interface.
type DispatcherWithSender struct {
	sender     Sender
	HTTPClient HTTPDoer
}

func NewDispatcherWithSender(sender Sender) *DispatcherWithSender {
	return &DispatcherWithSender{
		sender:     sender,
		HTTPClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (d *DispatcherWithSender) Dispatch(ctx context.Context, token, title, body string, data map[string]string) error {
	return d.sender.SendNotification(ctx, token, title, body, data)
}
