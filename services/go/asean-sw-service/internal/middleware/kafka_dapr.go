// Package middleware provides Kafka and Dapr pub/sub integration for asean-sw-service.
// Kafka topics published: asean.sw.outbound (G2G messages sent to partner countries)
// Kafka topics consumed: asean.sw.inbound (G2G messages received from partner countries)
// Dapr pub/sub: publishes asean.sw.outbound to pubsub component
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
	TopicASEANOutbound = "asean.sw.outbound"
	TopicASEANInbound  = "asean.sw.inbound"
	DaprPubsubName = "pubsub"
)

type ASEANMessageEvent struct {
	MessageID      string    `json:"message_id"`
	MessageType    string    `json:"message_type"` // DECLARATION, PERMIT, CERTIFICATE, QUERY, RESPONSE
	PartnerCountry string    `json:"partner_country"` // SG, MY, TH, PH, ID, VN, MM, KH, LA, BN
	Direction      string    `json:"direction"` // OUTBOUND, INBOUND
	DeclarationID  string    `json:"declaration_id,omitempty"`
	UCR            string    `json:"ucr,omitempty"`
	XMLPayload     string    `json:"xml_payload"` // WCO XML v3.10
	Status         string    `json:"status"` // SENT, ACKNOWLEDGED, REJECTED
	Timestamp      time.Time `json:"timestamp"`
	Source         string    `json:"source"`
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
		logger:   slog.Default().With("component", "kafka-publisher", "service", "asean-sw-service"),
	}, nil
}

func (k *KafkaPublisher) PublishOutbound(evt ASEANMessageEvent) error {
	evt.Direction = "OUTBOUND"
	evt.Source = "asean-sw-service"
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	data, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	_, _, err = k.producer.SendMessage(&sarama.ProducerMessage{
		Topic: TopicASEANOutbound,
		Key:   sarama.StringEncoder(evt.MessageID),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.Error("publish outbound failed", "error", err)
		return fmt.Errorf("publish asean.sw.outbound: %w", err)
	}
	k.logger.Info("ASEAN outbound message published", "partner", evt.PartnerCountry, "type", evt.MessageType)
	return nil
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

type InboundMessageHandler func(evt ASEANMessageEvent) error

type KafkaConsumer struct {
	consumer sarama.ConsumerGroup
	handler  InboundMessageHandler
	logger   *slog.Logger
}

func NewKafkaConsumer(groupID string, handler InboundMessageHandler) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), groupID, cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{
		consumer: cg,
		handler:  handler,
		logger:   slog.Default().With("component", "kafka-consumer", "service", "asean-sw-service"),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	go func() {
		for {
			if err := c.consumer.Consume(ctx, []string{TopicASEANInbound}, c); err != nil {
				c.logger.Error("consumer error", "error", err)
			}
			if ctx.Err() != nil {
				return
			}
		}
	}()
	c.logger.Info("ASEAN inbound consumer started")
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }
func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		var evt ASEANMessageEvent
		if err := json.Unmarshal(msg.Value, &evt); err != nil {
			c.logger.Error("unmarshal asean.sw.inbound", "error", err)
			sess.MarkMessage(msg, "")
			continue
		}
		evt.Direction = "INBOUND"
		if err := c.handler(evt); err != nil {
			c.logger.Error("handle asean.sw.inbound", "error", err)
		}
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
		logger:     slog.Default().With("component", "dapr-publisher", "service", "asean-sw-service"),
	}
}

func (d *DaprPublisher) PublishOutbound(evt ASEANMessageEvent) error {
	payload, _ := json.Marshal(evt)
	url := fmt.Sprintf("%s/%s/%s", d.baseURL, DaprPubsubName, TopicASEANOutbound)
	resp, err := d.httpClient.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("dapr publish: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("dapr publish status %d", resp.StatusCode)
	}
	d.logger.Info("dapr asean outbound published")
	return nil
}

// ─── Combined Middleware Clients ──────────────────────────────────────────────

type MiddlewareClients struct {
	KafkaPublisher *KafkaPublisher
	KafkaConsumer  *KafkaConsumer
	DaprPublisher  *DaprPublisher
}

func NewMiddlewareClients(handler InboundMessageHandler) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer("asean-sw-service-group", handler)
	if err != nil {
		kp.Close()
		return nil, err
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
