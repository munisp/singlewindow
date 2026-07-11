// Package middleware provides Kafka and Dapr pub/sub integration for audit-service.
// Kafka topics consumed: declaration.cleared (triggers post-clearance audit selection)
// Kafka topics published: audit.event (audit case opened/closed/findings)
// Dapr pub/sub: publishes audit.event to pubsub component
package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
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

// ─── Configuration ────────────────────────────────────────────────────────────

func kafkaBrokers() []string {
	b := os.Getenv("KAFKA_BROKERS")
	if b == "" {
		b = "kafka:9092"
	}
	return []string{b}
}

func daprPort() string {
	p := os.Getenv("DAPR_HTTP_PORT")
	if p == "" {
		p = "3500"
	}
	return p
}

const (
	TopicDeclarationCleared = "declaration.cleared"
	TopicAuditEvent         = "audit.event"
	DaprPubsubName = "pubsub"
)

// ─── Event Types ──────────────────────────────────────────────────────────────

type AuditEvent struct {
	EventID       string    `json:"event_id"`
	EventType     string    `json:"event_type"` // CASE_OPENED, FINDING, CASE_CLOSED, DISCREPANCY
	DeclarationID string    `json:"declaration_id"`
	UCR           string    `json:"ucr"`
	TraderID      string    `json:"trader_id"`
	AuditCaseID   string    `json:"audit_case_id"`
	Severity      string    `json:"severity"` // LOW, MEDIUM, HIGH, CRITICAL
	Description   string    `json:"description"`
	OfficerID     string    `json:"officer_id"`
	Timestamp     time.Time `json:"timestamp"`
	Source        string    `json:"source"`
}

type DeclarationClearedEvent struct {
	DeclarationID string    `json:"declaration_id"`
	UCR           string    `json:"ucr"`
	TraderID      string    `json:"trader_id"`
	HSCode        string    `json:"hs_code"`
	CustomsValue  float64   `json:"customs_value"`
	RiskScore     float64   `json:"risk_score"`
	Lane          string    `json:"lane"`
	ClearedAt     time.Time `json:"cleared_at"`
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
		return nil, fmt.Errorf("kafka producer init: %w", err)
	}
	return &KafkaPublisher{
		producer: producer,
		logger:   slog.Default().With("component", "kafka-publisher", "service", "audit-service"),
	}, nil
}

func (k *KafkaPublisher) PublishAuditEvent(evt AuditEvent) error {
	evt.Source = "audit-service"
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	payload, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal audit event: %w", err)
	}
	msg := &sarama.ProducerMessage{
		Topic: TopicAuditEvent,
		Key:   sarama.StringEncoder(evt.DeclarationID),
		Value: sarama.ByteEncoder(payload),
	}
	partition, offset, err := k.producer.SendMessage(msg)
	if err != nil {
		k.logger.Error("failed to publish audit event", "error", err, "topic", TopicAuditEvent)
		return fmt.Errorf("publish audit event: %w", err)
	}
	k.logger.Info("published audit event", "topic", TopicAuditEvent, "partition", partition, "offset", offset, "event_type", evt.EventType)
	return nil
}

func (k *KafkaPublisher) Close() error {
	return k.producer.Close()
}

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

type DeclarationClearedHandler func(evt DeclarationClearedEvent) error

type KafkaConsumer struct {
	consumer sarama.ConsumerGroup
	handler  DeclarationClearedHandler
	logger   *slog.Logger
}

func NewKafkaConsumer(groupID string, handler DeclarationClearedHandler) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0

	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), groupID, cfg)
	if err != nil {
		return nil, fmt.Errorf("kafka consumer group init: %w", err)
	}
	return &KafkaConsumer{
		consumer: cg,
		handler:  handler,
		logger:   slog.Default().With("component", "kafka-consumer", "service", "audit-service"),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	topics := []string{TopicDeclarationCleared}
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
	c.logger.Info("kafka consumer started", "topics", topics)
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }
func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		var evt DeclarationClearedEvent
		if err := json.Unmarshal(msg.Value, &evt); err != nil {
			c.logger.Error("unmarshal declaration.cleared", "error", err)
			sess.MarkMessage(msg, "")
			continue
		}
		if err := c.handler(evt); err != nil {
			c.logger.Error("handle declaration.cleared", "error", err, "declaration_id", evt.DeclarationID)
		}
		sess.MarkMessage(msg, "")
	}
	return nil
}

func (c *KafkaConsumer) Close() error {
	return c.consumer.Close()
}

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
		logger:     slog.Default().With("component", "dapr-publisher", "service", "audit-service"),
	}
}

func (d *DaprPublisher) PublishAuditEvent(evt AuditEvent) error {
	return d.publish(DaprPubsubName, TopicAuditEvent, evt)
}

func (d *DaprPublisher) publish(pubsubName, topic string, data interface{}) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal dapr payload: %w", err)
	}
	url := fmt.Sprintf("%s/%s/%s", d.baseURL, pubsubName, topic)
	resp, err := d.httpClient.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		d.logger.Error("dapr publish failed", "error", err, "topic", topic)
		return fmt.Errorf("dapr publish %s: %w", topic, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("dapr publish %s: status %d", topic, resp.StatusCode)
	}
	d.logger.Info("dapr event published", "topic", topic, "pubsub", pubsubName)
	return nil
}

// ─── Combined Middleware Clients ──────────────────────────────────────────────

type MiddlewareClients struct {
	KafkaPublisher  *KafkaPublisher
	KafkaConsumer   *KafkaConsumer
	DaprPublisher   *DaprPublisher
}

func NewMiddlewareClients(handler DeclarationClearedHandler) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, fmt.Errorf("kafka publisher: %w", err)
	}
	kc, err := NewKafkaConsumer("audit-service-group", handler)
	if err != nil {
		kp.Close()
		return nil, fmt.Errorf("kafka consumer: %w", err)
	}
	return &MiddlewareClients{
		KafkaPublisher: kp,
		KafkaConsumer:  kc,
		DaprPublisher:  NewDaprPublisher(),
	}, nil
}

func (m *MiddlewareClients) Close() {
	m.KafkaPublisher.Close()
	m.KafkaConsumer.Close()
}

// ─── OpenTelemetry Tracing ────────────────────────────────────────────────────

// InitTracer initialises the OTLP trace exporter and sets the global TracerProvider.
// Call this once at service startup; the returned shutdown function must be deferred.
func InitTracer(serviceName string) (func(context.Context) error, error) {
endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
if endpoint == "" {
endpoint = "otel-collector.monitoring.svc.cluster.local:4317"
}
ctx := context.Background()
exp, err := otlptracehttp.New(ctx,
otlptracehttp.WithEndpoint(endpoint),
otlptracehttp.WithInsecure(),
)
if err != nil {
return nil, fmt.Errorf("failed to create OTLP exporter: %w", err)
}
res, err := resource.New(ctx,
resource.WithAttributes(
semconv.ServiceName(serviceName),
semconv.ServiceVersion("1.0.0"),
attribute.String("platform", "tradegateway-ngswtp"),
),
)
if err != nil {
return nil, fmt.Errorf("failed to create OTel resource: %w", err)
}
tp := sdktrace.NewTracerProvider(
sdktrace.WithBatcher(exp),
sdktrace.WithResource(res),
sdktrace.WithSampler(sdktrace.AlwaysSample()),
)
otel.SetTracerProvider(tp)
slog.Info("OpenTelemetry tracer initialised", "service", serviceName, "endpoint", endpoint)
return tp.Shutdown, nil
}

// Tracer returns a named tracer for the given service.
func Tracer(serviceName string) trace.Tracer {
return otel.Tracer(serviceName)
}
