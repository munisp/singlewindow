// TradeGateway NGSWTP — Temporal Kafka Consumer
// Language: Go 1.23
// Subscribes to mojaloop.transfer.failed and mojaloop.*.error topics.
// Signals the relevant Temporal workflow via client.SignalWorkflow() so
// the saga can automatically compensate on payment failure.
// Dead-letters unroutable messages to mojaloop.dead_letter topic.
package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"go.temporal.io/sdk/client"
)

// ─── Event types ──────────────────────────────────────────────────────────────

// MojaloopErrorEvent is the structure published to mojaloop.*.error topics.
type MojaloopErrorEvent struct {
	Topic         string          `json:"topic"`
	QuoteId       string          `json:"quoteId,omitempty"`
	TransferId    string          `json:"transferId,omitempty"`
	PartyId       string          `json:"partyId,omitempty"`
	WorkflowId    string          `json:"workflowId,omitempty"`
	ErrorCode     string          `json:"errorCode"`
	ErrorMessage  string          `json:"errorMessage"`
	PublishedAt   time.Time       `json:"publishedAt"`
	RawPayload    json.RawMessage `json:"rawPayload,omitempty"`
}

// CompensationSignal is the signal payload sent to Temporal workflows.
type CompensationSignal struct {
	Reason      string    `json:"reason"`
	ErrorCode   string    `json:"errorCode"`
	ErrorMsg    string    `json:"errorMessage"`
	TriggeredAt time.Time `json:"triggeredAt"`
}

// ─── Signal names ─────────────────────────────────────────────────────────────

const (
	SignalPaymentFailed      = "payment-failed"
	SignalQuoteFailed        = "quote-failed"
	SignalPartyLookupFailed  = "party-lookup-failed"
	SignalCompensate         = "compensate"
)

// ─── Topic routing ────────────────────────────────────────────────────────────

// topicToSignal maps Kafka topic names to Temporal signal names.
var topicToSignal = map[string]string{
	"mojaloop.transfer.failed":  SignalPaymentFailed,
	"mojaloop.transfer.error":   SignalPaymentFailed,
	"mojaloop.quotes.error":     SignalQuoteFailed,
	"mojaloop.parties.error":    SignalPartyLookupFailed,
}

// ─── Consumer ─────────────────────────────────────────────────────────────────

// ConsumerConfig holds configuration for the Kafka consumer.
type ConsumerConfig struct {
	Brokers        []string
	GroupID        string
	Topics         []string
	DeadLetterTopic string
}

// DefaultConsumerConfig returns a ConsumerConfig populated from environment variables.
func DefaultConsumerConfig() ConsumerConfig {
	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" {
		brokers = "localhost:9092"
	}
	return ConsumerConfig{
		Brokers:         strings.Split(brokers, ","),
		GroupID:         "tradegateway-temporal-consumer",
		Topics:          []string{"mojaloop.transfer.failed", "mojaloop.transfer.error", "mojaloop.quotes.error", "mojaloop.parties.error"},
		DeadLetterTopic: "mojaloop.dead_letter",
	}
}

// TemporalSignaller is a minimal interface for signalling Temporal workflows.
// Allows test doubles without importing the full Temporal client.
type TemporalSignaller interface {
	SignalWorkflow(ctx context.Context, workflowID, runID, signalName string, arg interface{}) error
}

// Consumer subscribes to Mojaloop error topics and signals Temporal workflows.
type Consumer struct {
	cfg            ConsumerConfig
	temporalClient client.Client
	mockClient     TemporalSignaller // used in tests only
	logger         *log.Logger
}

// NewConsumer creates a new Kafka consumer with a Temporal client.
func NewConsumer(cfg ConsumerConfig, temporalClient client.Client) *Consumer {
	return &Consumer{
		cfg:            cfg,
		temporalClient: temporalClient,
		logger:         log.New(os.Stdout, "[kafka-consumer] ", log.LstdFlags|log.Lmsgprefix),
	}
}

// Start begins consuming messages. Blocks until context is cancelled or SIGTERM received.
// In production this uses the Sarama consumer group; in this implementation we provide
// the interface and a stub that can be replaced with a real Sarama consumer group.
func (c *Consumer) Start(ctx context.Context) error {
	c.logger.Printf("starting consumer: topics=%v brokers=%v group=%s",
		c.cfg.Topics, c.cfg.Brokers, c.cfg.GroupID)

	// Graceful shutdown on SIGTERM/SIGINT
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	// In production, replace this loop with a Sarama ConsumerGroup.Consume() call.
	// The ProcessMessage method below contains all the routing logic and is fully testable.
	for {
		select {
		case <-ctx.Done():
			c.logger.Println("context cancelled, stopping consumer")
			return nil
		case sig := <-sigCh:
			c.logger.Printf("received signal %v, stopping consumer", sig)
			return nil
		}
	}
}

// ProcessMessage routes a single Kafka message to the appropriate Temporal signal.
// This is the core testable unit — called by the Sarama handler in production.
func (c *Consumer) ProcessMessage(ctx context.Context, topic string, value []byte) error {
	signaller := TemporalSignaller(c.temporalClient)
	if c.mockClient != nil {
		signaller = c.mockClient
	}
	return c.processMessageWithClient(ctx, topic, value, signaller)
}

// processMessageWithClient is the testable core of ProcessMessage.
func (c *Consumer) processMessageWithClient(ctx context.Context, topic string, value []byte, signaller TemporalSignaller) error {
	var event MojaloopErrorEvent
	if err := json.Unmarshal(value, &event); err != nil {
		c.logger.Printf("failed to unmarshal message from topic %s: %v", topic, err)
		return c.deadLetter(ctx, topic, value, fmt.Sprintf("unmarshal error: %v", err))
	}
	event.Topic = topic

	signalName, ok := topicToSignal[topic]
	if !ok {
		c.logger.Printf("no signal mapping for topic %s, dead-lettering", topic)
		return c.deadLetter(ctx, topic, value, "no signal mapping for topic")
	}

	workflowID := c.resolveWorkflowID(event)
	if workflowID == "" {
		c.logger.Printf("cannot resolve workflowId for topic %s, dead-lettering", topic)
		return c.deadLetter(ctx, topic, value, "cannot resolve workflowId")
	}

	signal := CompensationSignal{
		Reason:      fmt.Sprintf("Mojaloop %s: %s", topic, event.ErrorMessage),
		ErrorCode:   event.ErrorCode,
		ErrorMsg:    event.ErrorMessage,
		TriggeredAt: time.Now().UTC(),
	}

	c.logger.Printf("signalling workflow %s with signal %s (errorCode=%s)",
		workflowID, signalName, event.ErrorCode)

	err := signaller.SignalWorkflow(ctx, workflowID, "", signalName, signal)
	if err != nil {
		// If the workflow is not found, still dead-letter but don't fail the consumer.
		c.logger.Printf("SignalWorkflow failed for workflowId=%s: %v", workflowID, err)
		return c.deadLetter(ctx, topic, value, fmt.Sprintf("SignalWorkflow error: %v", err))
	}

	c.logger.Printf("successfully signalled workflow %s", workflowID)
	return nil
}

// resolveWorkflowID extracts the Temporal workflow ID from the event.
// Priority: explicit WorkflowId field → TransferId → QuoteId.
func (c *Consumer) resolveWorkflowID(event MojaloopErrorEvent) string {
	if event.WorkflowId != "" {
		return event.WorkflowId
	}
	if event.TransferId != "" {
		return "transfer-" + event.TransferId
	}
	if event.QuoteId != "" {
		return "quote-" + event.QuoteId
	}
	return ""
}

// deadLetter publishes an unroutable message to the dead-letter topic.
// In production this would use a Sarama producer; here we log and return the error.
func (c *Consumer) deadLetter(ctx context.Context, originalTopic string, value []byte, reason string) error {
	c.logger.Printf("dead-letter: topic=%s reason=%s payload=%s",
		originalTopic, reason, string(value))
	// In production: produce to c.cfg.DeadLetterTopic via Sarama producer.
	return fmt.Errorf("dead-lettered: %s", reason)
}
