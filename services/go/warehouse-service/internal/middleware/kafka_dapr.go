// Package middleware provides Kafka and Dapr pub/sub integration for warehouse-service.
// Kafka topics consumed: cargo.arrived (triggers bonded warehouse deposit), declaration.cleared
// Kafka topics published: cargo.released (goods released from bonded warehouse after duty payment)
// Dapr pub/sub: publishes cargo.released to dapr-kafka-pubsub component
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
	TopicCargoArrived       = "cargo.arrived"
	TopicDeclarationCleared = "declaration.cleared"
	TopicCargoReleased      = "cargo.released"
	DaprPubsubName          = "dapr-kafka-pubsub"
)

type CargoArrivedEvent struct {
	EventID    string    `json:"event_id"`
	UCR        string    `json:"ucr"`
	VesselIMO  string    `json:"vessel_imo"`
	PortCode   string    `json:"port_code"`
	ContainerNo string   `json:"container_no"`
	HSCode     string    `json:"hs_code"`
	GrossWeight float64  `json:"gross_weight_kg"`
	ArrivedAt  time.Time `json:"arrived_at"`
}

type DeclarationClearedEvent struct {
	DeclarationID string    `json:"declaration_id"`
	UCR           string    `json:"ucr"`
	TraderID      string    `json:"trader_id"`
	HSCode        string    `json:"hs_code"`
	CustomsValue  float64   `json:"customs_value"`
	DutyPaid      float64   `json:"duty_paid"`
	ClearedAt     time.Time `json:"cleared_at"`
}

type CargoReleasedEvent struct {
	EventID       string    `json:"event_id"`
	UCR           string    `json:"ucr"`
	DeclarationID string    `json:"declaration_id"`
	WarehouseID   string    `json:"warehouse_id"`
	BondRef       string    `json:"bond_ref"`
	ReleaseType   string    `json:"release_type"` // DUTY_PAID, DRAWBACK, DESTRUCTION
	ReleasedAt    time.Time `json:"released_at"`
	Source        string    `json:"source"`
}

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
		logger:   slog.Default().With("component", "kafka-publisher", "service", "warehouse-service"),
	}, nil
}

func (k *KafkaPublisher) PublishCargoReleased(evt CargoReleasedEvent) error {
	evt.Source = "warehouse-service"
	if evt.ReleasedAt.IsZero() {
		evt.ReleasedAt = time.Now().UTC()
	}
	data, _ := json.Marshal(evt)
	_, _, err := k.producer.SendMessage(&sarama.ProducerMessage{
		Topic: TopicCargoReleased,
		Key:   sarama.StringEncoder(evt.UCR),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.Error("publish cargo.released failed", "error", err)
		return fmt.Errorf("publish cargo.released: %w", err)
	}
	k.logger.Info("cargo.released published", "ucr", evt.UCR, "bond_ref", evt.BondRef)
	return nil
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

type MultiTopicHandler struct {
	OnCargoArrived       func(evt CargoArrivedEvent) error
	OnDeclarationCleared func(evt DeclarationClearedEvent) error
}

type KafkaConsumer struct {
	consumer sarama.ConsumerGroup
	handler  MultiTopicHandler
	logger   *slog.Logger
}

func NewKafkaConsumer(groupID string, handler MultiTopicHandler) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), groupID, cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{consumer: cg, handler: handler,
		logger: slog.Default().With("component", "kafka-consumer", "service", "warehouse-service")}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	topics := []string{TopicCargoArrived, TopicDeclarationCleared}
	go func() {
		for {
			c.consumer.Consume(ctx, topics, c)
			if ctx.Err() != nil {
				return
			}
		}
	}()
	c.logger.Info("warehouse kafka consumer started", "topics", topics)
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }
func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		switch msg.Topic {
		case TopicCargoArrived:
			var evt CargoArrivedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil && c.handler.OnCargoArrived != nil {
				c.handler.OnCargoArrived(evt)
			}
		case TopicDeclarationCleared:
			var evt DeclarationClearedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil && c.handler.OnDeclarationCleared != nil {
				c.handler.OnDeclarationCleared(evt)
			}
		}
		sess.MarkMessage(msg, "")
	}
	return nil
}

func (c *KafkaConsumer) Close() error { return c.consumer.Close() }

type DaprPublisher struct {
	httpClient *http.Client
	baseURL    string
	logger     *slog.Logger
}

func NewDaprPublisher() *DaprPublisher {
	return &DaprPublisher{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		baseURL:    fmt.Sprintf("http://localhost:%s/v1.0/publish", daprPort()),
		logger:     slog.Default().With("component", "dapr-publisher", "service", "warehouse-service"),
	}
}

func (d *DaprPublisher) PublishCargoReleased(evt CargoReleasedEvent) error {
	payload, _ := json.Marshal(evt)
	url := fmt.Sprintf("%s/%s/%s", d.baseURL, DaprPubsubName, TopicCargoReleased)
	resp, err := d.httpClient.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("dapr publish: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

type MiddlewareClients struct {
	KafkaPublisher *KafkaPublisher
	KafkaConsumer  *KafkaConsumer
	DaprPublisher  *DaprPublisher
}

func NewMiddlewareClients(handler MultiTopicHandler) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer("warehouse-service-group", handler)
	if err != nil {
		kp.Close()
		return nil, err
	}
	return &MiddlewareClients{KafkaPublisher: kp, KafkaConsumer: kc, DaprPublisher: NewDaprPublisher()}, nil
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
