// Package middleware provides Kafka, Dapr, Fluvio, and OpenTelemetry integration for oga-service.
// Kafka topics published:  oga.permit.requested    (permit request sent to OGA)
//                          oga.approved            (permit approved by OGA)
//                          oga.rejected            (permit rejected by OGA)
//                          oga.sla.breach          (SLA timer exceeded — alert)
// Kafka topics consumed:   declarations.submitted  (new declaration — check OGA requirements)
//                          workflow.oga.dispatched (workflow engine dispatched OGA request)
// Dapr pub/sub:            publishes OGA decisions to dapr-kafka-pubsub
// Fluvio:                  streams real-time OGA queue status to customs officers
// OpenTelemetry:           distributed tracing for every OGA permit lifecycle event
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
	TopicOGAPermitRequested  = "oga.permit.requested"
	TopicOGAApproved         = "oga.approved"
	TopicOGARejected         = "oga.rejected"
	TopicOGASLABreach        = "oga.sla.breach"
	TopicDeclarationSubmitted = "declarations.submitted"
	TopicWorkflowOGADispatched = "workflow.oga.dispatched"

	DaprPubsubName = "dapr-kafka-pubsub"
	ServiceName    = "oga-service"
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

func fluvioEndpoint() string {
	if e := os.Getenv("FLUVIO_ENDPOINT"); e != "" {
		return e
	}
	return "http://fluvio-sc:9003"
}

// ─── Event Schemas ────────────────────────────────────────────────────────────

type OGAPermitEvent struct {
	EventType     string    `json:"event_type"`
	PermitID      int64     `json:"permit_id"`
	DeclarationID int64     `json:"declaration_id"`
	UCR           string    `json:"ucr"`
	AgencyCode    string    `json:"agency_code"`
	AgencyName    string    `json:"agency_name"`
	PermitType    string    `json:"permit_type"`
	PermitNumber  string    `json:"permit_number,omitempty"`
	RejectionReason string  `json:"rejection_reason,omitempty"`
	SLAHours      int       `json:"sla_hours"`
	Source        string    `json:"source"`
	Timestamp     time.Time `json:"timestamp"`
	TraceID       string    `json:"trace_id,omitempty"`
}

type DeclarationSubmittedEvent struct {
	DeclarationID int64  `json:"declaration_id"`
	UCR           string `json:"ucr"`
	HSCode        string `json:"hs_code"`
	PortOfEntry   string `json:"port_of_entry"`
	Timestamp     time.Time `json:"timestamp"`
}

type WorkflowOGADispatchedEvent struct {
	WorkflowID    string `json:"workflow_id"`
	DeclarationID int64  `json:"declaration_id"`
	UCR           string `json:"ucr"`
	AgencyCodes   []string `json:"agency_codes"`
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

func (k *KafkaPublisher) PublishOGAEvent(ctx context.Context, evt OGAPermitEvent) error {
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
		Key:   sarama.StringEncoder(fmt.Sprintf("%d", evt.PermitID)),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.ErrorContext(ctx, "kafka publish failed", "topic", topic, "error", err)
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	k.logger.InfoContext(ctx, "OGA event published", "topic", topic, "permit_id", evt.PermitID, "agency", evt.AgencyCode)
	return nil
}

func topicForEventType(et string) string {
	switch et {
	case "requested":
		return TopicOGAPermitRequested
	case "approved":
		return TopicOGAApproved
	case "rejected":
		return TopicOGARejected
	case "sla_breach":
		return TopicOGASLABreach
	default:
		return TopicOGAPermitRequested
	}
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

type DeclarationSubmittedHandler func(ctx context.Context, evt DeclarationSubmittedEvent) error
type WorkflowOGADispatchedHandler func(ctx context.Context, evt WorkflowOGADispatchedEvent) error

type KafkaConsumer struct {
	consumer           sarama.ConsumerGroup
	declarationHandler DeclarationSubmittedHandler
	workflowHandler    WorkflowOGADispatchedHandler
	logger             *slog.Logger
}

func NewKafkaConsumer(
	declarationHandler DeclarationSubmittedHandler,
	workflowHandler WorkflowOGADispatchedHandler,
) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), "oga-service-group", cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{
		consumer:           cg,
		declarationHandler: declarationHandler,
		workflowHandler:    workflowHandler,
		logger:             slog.Default().With("component", "kafka-consumer", "service", ServiceName),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	topics := []string{TopicDeclarationSubmitted, TopicWorkflowOGADispatched}
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
	c.logger.Info("oga-service consumers started", "topics", topics)
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }

func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	tracer := otel.Tracer(ServiceName)
	for msg := range claim.Messages() {
		ctx, span := tracer.Start(context.Background(), fmt.Sprintf("consume.%s", msg.Topic),
			trace.WithAttributes(attribute.String("messaging.system", "kafka")),
		)
		switch msg.Topic {
		case TopicDeclarationSubmitted:
			var evt DeclarationSubmittedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.declarationHandler(ctx, evt)
			}
		case TopicWorkflowOGADispatched:
			var evt WorkflowOGADispatchedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.workflowHandler(ctx, evt)
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

func (d *DaprPublisher) PublishOGAEvent(ctx context.Context, evt OGAPermitEvent) error {
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

// ─── Fluvio Publisher ─────────────────────────────────────────────────────────

type FluvioPublisher struct {
	endpoint   string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewFluvioPublisher() *FluvioPublisher {
	return &FluvioPublisher{
		endpoint:   fluvioEndpoint(),
		httpClient: &http.Client{Timeout: 3 * time.Second},
		logger:     slog.Default().With("component", "fluvio-publisher", "service", ServiceName),
	}
}

type FluvioOGAQueueUpdate struct {
	AgencyCode    string    `json:"agency_code"`
	AgencyName    string    `json:"agency_name"`
	PendingCount  int       `json:"pending_count"`
	AvgWaitHours  float64   `json:"avg_wait_hours"`
	SLABreachCount int      `json:"sla_breach_count"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (f *FluvioPublisher) PublishOGAQueueUpdate(ctx context.Context, update FluvioOGAQueueUpdate) error {
	if update.UpdatedAt.IsZero() {
		update.UpdatedAt = time.Now().UTC()
	}
	payload, _ := json.Marshal(update)
	url := fmt.Sprintf("%s/api/v1/produce/oga.queue.stream", f.endpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.httpClient.Do(req)
	if err != nil {
		f.logger.WarnContext(ctx, "fluvio publish failed (non-fatal)", "error", err)
		return nil
	}
	defer resp.Body.Close()
	f.logger.InfoContext(ctx, "fluvio OGA queue update published", "agency", update.AgencyCode)
	return nil
}

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
	FluvioPublisher *FluvioPublisher
}

func NewMiddlewareClients(
	declarationHandler DeclarationSubmittedHandler,
	workflowHandler WorkflowOGADispatchedHandler,
) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer(declarationHandler, workflowHandler)
	if err != nil {
		kp.Close()
		return nil, err
	}
	return &MiddlewareClients{
		KafkaPublisher:  kp,
		KafkaConsumer:   kc,
		DaprPublisher:   NewDaprPublisher(),
		FluvioPublisher: NewFluvioPublisher(),
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
