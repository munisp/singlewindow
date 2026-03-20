// Package middleware provides Kafka, Dapr, Fluvio, and OpenTelemetry integration for profile-service.
// Kafka topics published:  trader.registered       (new trader account created)
//                          trader.verified         (KYC verification completed)
//                          trader.suspended        (account suspended)
//                          aeo.status.changed      (AEO status granted/revoked)
// Kafka topics consumed:   kyc.completed           (KYC service completed verification)
//                          declarations.cleared    (update trader clearance statistics)
// Dapr pub/sub:            publishes trader events to dapr-kafka-pubsub
// Fluvio:                  streams real-time trader scorecard updates
// OpenTelemetry:           distributed tracing for every profile lifecycle event
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
	TopicTraderRegistered   = "trader.registered"
	TopicTraderVerified     = "trader.verified"
	TopicTraderSuspended    = "trader.suspended"
	TopicAEOStatusChanged   = "aeo.status.changed"
	TopicKYCCompleted       = "kyc.completed"
	TopicDeclarationCleared = "declarations.cleared"

	DaprPubsubName = "dapr-kafka-pubsub"
	ServiceName    = "profile-service"
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

type TraderEvent struct {
	EventType    string    `json:"event_type"`
	TraderID     int64     `json:"trader_id"`
	TIN          string    `json:"tin"`
	CompanyName  string    `json:"company_name"`
	AEOStatus    string    `json:"aeo_status,omitempty"`
	KYCStatus    string    `json:"kyc_status,omitempty"`
	Reason       string    `json:"reason,omitempty"`
	Source       string    `json:"source"`
	Timestamp    time.Time `json:"timestamp"`
	TraceID      string    `json:"trace_id,omitempty"`
}

type KYCCompletedEvent struct {
	TraderID     int64  `json:"trader_id"`
	Status       string `json:"status"` // verified | rejected
	Provider     string `json:"provider"`
	Reference    string `json:"reference"`
	Timestamp    time.Time `json:"timestamp"`
}

type DeclarationClearedEvent struct {
	DeclarationID int64  `json:"declaration_id"`
	TraderID      int64  `json:"trader_id"`
	UCR           string `json:"ucr"`
	RiskLane      string `json:"risk_lane"`
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

func (k *KafkaPublisher) PublishTraderEvent(ctx context.Context, evt TraderEvent) error {
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
		Key:   sarama.StringEncoder(fmt.Sprintf("%d", evt.TraderID)),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.ErrorContext(ctx, "kafka publish failed", "topic", topic, "error", err)
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	k.logger.InfoContext(ctx, "trader event published", "topic", topic, "trader_id", evt.TraderID)
	return nil
}

func topicForEventType(et string) string {
	switch et {
	case "registered":
		return TopicTraderRegistered
	case "verified":
		return TopicTraderVerified
	case "suspended":
		return TopicTraderSuspended
	case "aeo_changed":
		return TopicAEOStatusChanged
	default:
		return TopicTraderRegistered
	}
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

type KYCCompletedHandler func(ctx context.Context, evt KYCCompletedEvent) error
type DeclarationClearedHandler func(ctx context.Context, evt DeclarationClearedEvent) error

type KafkaConsumer struct {
	consumer          sarama.ConsumerGroup
	kycHandler        KYCCompletedHandler
	clearanceHandler  DeclarationClearedHandler
	logger            *slog.Logger
}

func NewKafkaConsumer(
	kycHandler KYCCompletedHandler,
	clearanceHandler DeclarationClearedHandler,
) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), "profile-service-group", cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{
		consumer:         cg,
		kycHandler:       kycHandler,
		clearanceHandler: clearanceHandler,
		logger:           slog.Default().With("component", "kafka-consumer", "service", ServiceName),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	topics := []string{TopicKYCCompleted, TopicDeclarationCleared}
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
	c.logger.Info("profile-service consumers started", "topics", topics)
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
		case TopicKYCCompleted:
			var evt KYCCompletedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.kycHandler(ctx, evt)
			}
		case TopicDeclarationCleared:
			var evt DeclarationClearedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.clearanceHandler(ctx, evt)
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

func (d *DaprPublisher) PublishTraderEvent(ctx context.Context, evt TraderEvent) error {
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

type FluvioTraderScorecardUpdate struct {
	TraderID          int64   `json:"trader_id"`
	ComplianceScore   float64 `json:"compliance_score"`
	TotalDeclarations int     `json:"total_declarations"`
	GreenLaneRate     float64 `json:"green_lane_rate"`
	AEOStatus         string  `json:"aeo_status"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func (f *FluvioPublisher) PublishScorecardUpdate(ctx context.Context, update FluvioTraderScorecardUpdate) error {
	if update.UpdatedAt.IsZero() {
		update.UpdatedAt = time.Now().UTC()
	}
	payload, _ := json.Marshal(update)
	url := fmt.Sprintf("%s/api/v1/produce/trader.scorecard.stream", f.endpoint)
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
	f.logger.InfoContext(ctx, "fluvio scorecard update published", "trader_id", update.TraderID)
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
	kycHandler KYCCompletedHandler,
	clearanceHandler DeclarationClearedHandler,
) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer(kycHandler, clearanceHandler)
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
