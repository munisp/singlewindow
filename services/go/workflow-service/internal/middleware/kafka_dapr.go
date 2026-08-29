// Package middleware provides Kafka, Dapr, and OpenTelemetry integration for workflow-service.
// Kafka topics published:  workflow.started        (Temporal workflow initiated)
//                          workflow.completed      (workflow reached terminal state)
//                          workflow.failed         (workflow failed after retries)
//                          workflow.oga.dispatched (OGA permit request dispatched)
// Kafka topics consumed:   declarations.submitted  (trigger clearance workflow)
//                          risk.scored             (risk lane determined — route workflow)
//                          payments.confirmed      (payment received — advance workflow)
//                          oga.approved            (OGA permit received — advance workflow)
// Dapr pub/sub:            publishes workflow state changes to pubsub
// NOTE: Fluvio is NOT deployed; Kafka is the real event bus (P0 remediation).
// OpenTelemetry:           distributed tracing for every workflow activity
package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/IBM/sarama"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
)

const (
	TopicWorkflowStarted      = "workflow.started"
	TopicWorkflowCompleted    = "workflow.completed"
	TopicWorkflowFailed       = "workflow.failed"
	TopicWorkflowOGADispatched = "workflow.oga.dispatched"

	TopicDeclarationSubmitted = "declarations.submitted"
	TopicRiskScored           = "risk.scored"
	TopicPaymentsConfirmed    = "payments.confirmed"
	TopicOGAApproved          = "oga.approved"

	DaprPubsubName = "pubsub"
	ServiceName    = "workflow-service"
)

func kafkaBrokers() []string {
	b := os.Getenv("KAFKA_BROKERS")
	if b == "" {
		b = "kafka:9092"
	}
	return strings.Split(b, ",")
}

func daprPort() string {
	if p := os.Getenv("DAPR_HTTP_PORT"); p != "" {
		return p
	}
	return "3500"
}

// ─── Event Schemas ────────────────────────────────────────────────────────────

type WorkflowEvent struct {
	EventType     string    `json:"event_type"`
	WorkflowID    string    `json:"workflow_id"`
	RunID         string    `json:"run_id"`
	DeclarationID int64     `json:"declaration_id"`
	UCR           string    `json:"ucr"`
	TraderID      int64     `json:"trader_id"`
	CurrentStep   string    `json:"current_step"`
	RiskLane      string    `json:"risk_lane,omitempty"`
	Status        string    `json:"status"`
	ErrorMessage  string    `json:"error_message,omitempty"`
	Source        string    `json:"source"`
	Timestamp     time.Time `json:"timestamp"`
	TraceID       string    `json:"trace_id,omitempty"`
}

type DeclarationSubmittedEvent struct {
	DeclarationID   int64   `json:"declaration_id"`
	UCR             string  `json:"ucr"`
	TraderID        int64   `json:"trader_id"`
	HSCode          string  `json:"hs_code"`
	InvoiceValueUSD float64 `json:"invoice_value_usd"`
	PortOfEntry     string  `json:"port_of_entry"`
	Timestamp       time.Time `json:"timestamp"`
}

type RiskScoredEvent struct {
	DeclarationID int64   `json:"declaration_id"`
	RiskScore     float64 `json:"risk_score"`
	RiskLane      string  `json:"risk_lane"`
	Timestamp     time.Time `json:"timestamp"`
}

type PaymentConfirmedEvent struct {
	DeclarationID int64   `json:"declaration_id"`
	PaymentRef    string  `json:"payment_ref"`
	AmountPaid    float64 `json:"amount_paid"`
	Timestamp     time.Time `json:"timestamp"`
}

type OGAApprovedEvent struct {
	DeclarationID int64  `json:"declaration_id"`
	AgencyCode    string `json:"agency_code"`
	PermitNumber  string `json:"permit_number"`
	Timestamp     time.Time `json:"timestamp"`
}

// ─── Kafka Publisher ──────────────────────────────────────────────────────────

type KafkaPublisher struct {
	producer sarama.SyncProducer
	logger   *slog.Logger
}

func NewKafkaPublisher() (*KafkaPublisher, error) {
	cfg := sarama.NewConfig()
	cfg.Producer.Return.Successes = true
	cfg.Producer.RequiredAcks = sarama.WaitForAll
	cfg.Producer.Retry.Max = 5
	cfg.Version = sarama.V2_8_0_0
	producer, err := sarama.NewSyncProducer(kafkaBrokers(), cfg)
	if err != nil {
		return nil, fmt.Errorf("kafka producer: %w", err)
	}
	return &KafkaPublisher{
		producer: producer,
		logger:   slog.Default().With("component", "kafka-publisher", "service", ServiceName),
	}, nil
}

func (k *KafkaPublisher) PublishWorkflowEvent(ctx context.Context, evt WorkflowEvent) error {
	span := trace.SpanFromContext(ctx)
	evt.TraceID = span.SpanContext().TraceID().String()
	evt.Source = ServiceName
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	topic := topicForEventType(evt.EventType)
	data, _ := json.Marshal(evt)
	_, _, err := k.producer.SendMessage(&sarama.ProducerMessage{
		Topic: topic,
		Key:   sarama.StringEncoder(evt.WorkflowID),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.ErrorContext(ctx, "kafka publish failed", "topic", topic, "error", err)
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	k.logger.InfoContext(ctx, "workflow event published", "topic", topic, "workflow_id", evt.WorkflowID)
	return nil
}

func topicForEventType(et string) string {
	switch et {
	case "started":
		return TopicWorkflowStarted
	case "completed":
		return TopicWorkflowCompleted
	case "failed":
		return TopicWorkflowFailed
	case "oga_dispatched":
		return TopicWorkflowOGADispatched
	default:
		return TopicWorkflowStarted
	}
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

type DeclarationSubmittedHandler func(ctx context.Context, evt DeclarationSubmittedEvent) error
type RiskScoredHandler func(ctx context.Context, evt RiskScoredEvent) error
type PaymentConfirmedHandler func(ctx context.Context, evt PaymentConfirmedEvent) error
type OGAApprovedHandler func(ctx context.Context, evt OGAApprovedEvent) error

type KafkaConsumer struct {
	consumer           sarama.ConsumerGroup
	declarationHandler DeclarationSubmittedHandler
	riskHandler        RiskScoredHandler
	paymentHandler     PaymentConfirmedHandler
	ogaHandler         OGAApprovedHandler
	logger             *slog.Logger
}

func NewKafkaConsumer(
	declarationHandler DeclarationSubmittedHandler,
	riskHandler RiskScoredHandler,
	paymentHandler PaymentConfirmedHandler,
	ogaHandler OGAApprovedHandler,
) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), "workflow-service-group", cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{
		consumer:           cg,
		declarationHandler: declarationHandler,
		riskHandler:        riskHandler,
		paymentHandler:     paymentHandler,
		ogaHandler:         ogaHandler,
		logger:             slog.Default().With("component", "kafka-consumer", "service", ServiceName),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	topics := []string{TopicDeclarationSubmitted, TopicRiskScored, TopicPaymentsConfirmed, TopicOGAApproved}
	go func() {
		for {
			if err := c.consumer.Consume(ctx, topics, c); err != nil {
				c.logger.Error("consumer error", "error", err)
			}
			if ctx.Err() != nil {
				return
			}
		}
	}()
	c.logger.Info("workflow-service consumers started", "topics", topics)
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }

func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	tracer := otel.Tracer(ServiceName)
	for msg := range claim.Messages() {
		ctx, span := tracer.Start(context.Background(), fmt.Sprintf("consume.%s", msg.Topic),
			trace.WithAttributes(
				attribute.String("messaging.system", "kafka"),
				attribute.String("messaging.destination", msg.Topic),
			),
		)
		switch msg.Topic {
		case TopicDeclarationSubmitted:
			var evt DeclarationSubmittedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.declarationHandler(ctx, evt)
			}
		case TopicRiskScored:
			var evt RiskScoredEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.riskHandler(ctx, evt)
			}
		case TopicPaymentsConfirmed:
			var evt PaymentConfirmedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.paymentHandler(ctx, evt)
			}
		case TopicOGAApproved:
			var evt OGAApprovedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.ogaHandler(ctx, evt)
			}
		}
		span.End()
		sess.MarkMessage(msg, "")
	}
	return nil
}

func (c *KafkaConsumer) Close() error { return c.consumer.Close() }

// ─── Dapr Publisher ───────────────────────────────────────────────────────────

type DaprPublisher struct {
	httpClient *http.Client
	baseURL    string
	logger     *slog.Logger
}

func NewDaprPublisher() *DaprPublisher {
	return &DaprPublisher{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		baseURL:    fmt.Sprintf("http://localhost:%s/v1.0/publish", daprPort()),
		logger:     slog.Default().With("component", "dapr-publisher", "service", ServiceName),
	}
}

func (d *DaprPublisher) PublishWorkflowEvent(ctx context.Context, evt WorkflowEvent) error {
	topic := topicForEventType(evt.EventType)
	payload, _ := json.Marshal(evt)
	url := fmt.Sprintf("%s/%s/%s", d.baseURL, DaprPubsubName, topic)
	resp, err := d.httpClient.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		d.logger.WarnContext(ctx, "dapr publish failed (non-fatal)", "error", err)
		return nil
	}
	defer resp.Body.Close()
	return nil
}

// ─── Fluvio Publisher — REMOVED (P0 remediation) ────────────────────────────
// The Fluvio HTTP producer posted to a non-existent endpoint
// (http://fluvio-sc:9003/...) and swallowed the errors. Fluvio is NOT deployed
// on this platform; Kafka (above) is the real event bus. Real-time status
// updates must flow through the Kafka publisher in this file.

// ─── OpenTelemetry Setup ──────────────────────────────────────────────────────

func InitTracer(ctx context.Context) (*sdktrace.TracerProvider, error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://otel-collector:4318"
	}
	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpoint(endpoint),
		otlptracehttp.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("OTLP exporter: %w", err)
	}
	res, _ := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(ServiceName),
			semconv.ServiceVersion("1.0.0"),
			attribute.String("deployment.environment", os.Getenv("ENVIRONMENT")),
		),
	)
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.1))),
	)
	otel.SetTracerProvider(tp)
	return tp, nil
}

// ─── Combined Middleware Clients ──────────────────────────────────────────────

type MiddlewareClients struct {
	KafkaPublisher  *KafkaPublisher
	KafkaConsumer   *KafkaConsumer
	DaprPublisher   *DaprPublisher
}

func NewMiddlewareClients(
	declarationHandler DeclarationSubmittedHandler,
	riskHandler RiskScoredHandler,
	paymentHandler PaymentConfirmedHandler,
	ogaHandler OGAApprovedHandler,
) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer(declarationHandler, riskHandler, paymentHandler, ogaHandler)
	if err != nil {
		kp.Close()
		return nil, err
	}
	return &MiddlewareClients{
		KafkaPublisher:  kp,
		KafkaConsumer:   kc,
		DaprPublisher:   NewDaprPublisher(),
	}, nil
}

func (m *MiddlewareClients) Close() {
	if m.KafkaPublisher != nil {
		m.KafkaPublisher.Close()
	}
	if m.KafkaConsumer != nil {
		m.KafkaConsumer.Close()
	}
}
