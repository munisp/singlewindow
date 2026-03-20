// Package middleware provides Kafka and Dapr pub/sub integration for opencti-svc.
// Kafka topics published: security.alert (when STIX indicators match declarations)
// Kafka topics consumed: sanctions.hit (enriches hits with OpenCTI threat graph data)
// Dapr pub/sub: publishes security.alert to dapr-kafka-pubsub component
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
	TopicSecurityAlert = "security.alert"
	TopicSanctionsHit  = "sanctions.hit"
	DaprPubsubName     = "dapr-kafka-pubsub"
)

type SecurityAlertEvent struct {
	AlertID        string    `json:"alert_id"`
	AlertType      string    `json:"alert_type"` // THREAT_INDICATOR, THREAT_ACTOR, MALICIOUS_ROUTE
	Severity       string    `json:"severity"`
	DeclarationID  string    `json:"declaration_id,omitempty"`
	UCR            string    `json:"ucr,omitempty"`
	TraderID       string    `json:"trader_id,omitempty"`
	HSCode         string    `json:"hs_code,omitempty"`
	IndicatorID    string    `json:"indicator_id,omitempty"`
	ThreatActorID  string    `json:"threat_actor_id,omitempty"`
	TLPMarking     string    `json:"tlp_marking"` // WHITE, GREEN, AMBER, RED
	Description    string    `json:"description"`
	MITREAttackTTP string    `json:"mitre_attack_ttp,omitempty"`
	Timestamp      time.Time `json:"timestamp"`
	Source         string    `json:"source"`
}

type SanctionsHitEvent struct {
	HitID         string    `json:"hit_id"`
	EntityName    string    `json:"entity_name"`
	SanctionsList string    `json:"sanctions_list"`
	DeclarationID string    `json:"declaration_id"`
	TraderID      string    `json:"trader_id"`
	Confidence    float64   `json:"confidence"`
	Timestamp     time.Time `json:"timestamp"`
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
		logger:   slog.Default().With("component", "kafka-publisher", "service", "opencti-svc"),
	}, nil
}

func (k *KafkaPublisher) PublishSecurityAlert(evt SecurityAlertEvent) error {
	evt.Source = "opencti-svc"
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	data, _ := json.Marshal(evt)
	_, _, err := k.producer.SendMessage(&sarama.ProducerMessage{
		Topic: TopicSecurityAlert,
		Key:   sarama.StringEncoder(evt.AlertID),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.Error("publish security.alert failed", "error", err)
		return fmt.Errorf("publish security.alert: %w", err)
	}
	k.logger.Info("security alert published", "type", evt.AlertType, "severity", evt.Severity)
	return nil
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

type SanctionsHitHandler func(evt SanctionsHitEvent) error

type KafkaConsumer struct {
	consumer sarama.ConsumerGroup
	handler  SanctionsHitHandler
	logger   *slog.Logger
}

func NewKafkaConsumer(groupID string, handler SanctionsHitHandler) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), groupID, cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{consumer: cg, handler: handler,
		logger: slog.Default().With("component", "kafka-consumer", "service", "opencti-svc")}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	go func() {
		for {
			c.consumer.Consume(ctx, []string{TopicSanctionsHit}, c)
			if ctx.Err() != nil {
				return
			}
		}
	}()
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }
func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		var evt SanctionsHitEvent
		if err := json.Unmarshal(msg.Value, &evt); err == nil {
			c.handler(evt)
		}
		sess.MarkMessage(msg, "")
	}
	return nil
}

func (c *KafkaConsumer) Close() error { return c.consumer.Close() }

type DaprPublisher struct {
	httpClient *http.Client
	baseURL    string
}

func NewDaprPublisher() *DaprPublisher {
	return &DaprPublisher{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		baseURL:    fmt.Sprintf("http://localhost:%s/v1.0/publish", daprPort()),
	}
}

func (d *DaprPublisher) PublishSecurityAlert(evt SecurityAlertEvent) error {
	payload, _ := json.Marshal(evt)
	url := fmt.Sprintf("%s/%s/%s", d.baseURL, DaprPubsubName, TopicSecurityAlert)
	resp, err := d.httpClient.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

type MiddlewareClients struct {
	KafkaPublisher *KafkaPublisher
	KafkaConsumer  *KafkaConsumer
	DaprPublisher  *DaprPublisher
}

func NewMiddlewareClients(handler SanctionsHitHandler) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer("opencti-svc-group", handler)
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
