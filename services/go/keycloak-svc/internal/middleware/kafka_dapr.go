// Package middleware provides Kafka, Dapr, and OpenTelemetry integration for keycloak-svc.
// Kafka topics published:  auth.login.success      (successful authentication event)
//                          auth.login.failed       (failed authentication — brute-force detection)
//                          auth.token.revoked      (token explicitly revoked)
//                          auth.user.created       (new user provisioned in Keycloak)
//                          auth.user.suspended     (user account suspended)
//                          auth.role.changed       (role assignment changed)
// Kafka topics consumed:   trader.suspended        (sync suspension to Keycloak)
//                          trader.verified         (grant verified-trader role)
// Dapr pub/sub:            publishes auth events to dapr-kafka-pubsub
// OpenTelemetry:           distributed tracing for all auth operations
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
	TopicAuthLoginSuccess  = "auth.login.success"
	TopicAuthLoginFailed   = "auth.login.failed"
	TopicAuthTokenRevoked  = "auth.token.revoked"
	TopicAuthUserCreated   = "auth.user.created"
	TopicAuthUserSuspended = "auth.user.suspended"
	TopicAuthRoleChanged   = "auth.role.changed"
	TopicTraderSuspended   = "trader.suspended"
	TopicTraderVerified    = "trader.verified"

	DaprPubsubName = "dapr-kafka-pubsub"
	ServiceName    = "keycloak-svc"
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

type AuthEvent struct {
	EventType  string    `json:"event_type"`
	UserID     string    `json:"user_id"`
	Username   string    `json:"username"`
	Realm      string    `json:"realm"`
	ClientID   string    `json:"client_id,omitempty"`
	IPAddress  string    `json:"ip_address,omitempty"`
	Role       string    `json:"role,omitempty"`
	Reason     string    `json:"reason,omitempty"`
	Source     string    `json:"source"`
	Timestamp  time.Time `json:"timestamp"`
	TraceID    string    `json:"trace_id,omitempty"`
}

type TraderSuspendedEvent struct {
	TraderID    int64  `json:"trader_id"`
	KeycloakUID string `json:"keycloak_uid"`
	Reason      string `json:"reason"`
	Timestamp   time.Time `json:"timestamp"`
}

type TraderVerifiedEvent struct {
	TraderID    int64  `json:"trader_id"`
	KeycloakUID string `json:"keycloak_uid"`
	KYCStatus   string `json:"kyc_status"`
	Timestamp   time.Time `json:"timestamp"`
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

func (k *KafkaPublisher) PublishAuthEvent(ctx context.Context, evt AuthEvent) error {
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
		Key:   sarama.StringEncoder(evt.UserID),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.ErrorContext(ctx, "kafka publish failed", "topic", topic, "error", err)
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	k.logger.InfoContext(ctx, "auth event published", "topic", topic, "user_id", evt.UserID)
	return nil
}

func topicForEventType(et string) string {
	switch et {
	case "login_success":
		return TopicAuthLoginSuccess
	case "login_failed":
		return TopicAuthLoginFailed
	case "token_revoked":
		return TopicAuthTokenRevoked
	case "user_created":
		return TopicAuthUserCreated
	case "user_suspended":
		return TopicAuthUserSuspended
	case "role_changed":
		return TopicAuthRoleChanged
	default:
		return TopicAuthLoginSuccess
	}
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

type TraderSuspendedHandler func(ctx context.Context, evt TraderSuspendedEvent) error
type TraderVerifiedHandler func(ctx context.Context, evt TraderVerifiedEvent) error

type KafkaConsumer struct {
	consumer         sarama.ConsumerGroup
	suspendedHandler TraderSuspendedHandler
	verifiedHandler  TraderVerifiedHandler
	logger           *slog.Logger
}

func NewKafkaConsumer(
	suspendedHandler TraderSuspendedHandler,
	verifiedHandler TraderVerifiedHandler,
) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), "keycloak-svc-group", cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{
		consumer:         cg,
		suspendedHandler: suspendedHandler,
		verifiedHandler:  verifiedHandler,
		logger:           slog.Default().With("component", "kafka-consumer", "service", ServiceName),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	topics := []string{TopicTraderSuspended, TopicTraderVerified}
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
	c.logger.Info("keycloak-svc consumers started", "topics", topics)
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
		case TopicTraderSuspended:
			var evt TraderSuspendedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.suspendedHandler(ctx, evt)
			}
		case TopicTraderVerified:
			var evt TraderVerifiedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.verifiedHandler(ctx, evt)
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

func (d *DaprPublisher) PublishAuthEvent(ctx context.Context, evt AuthEvent) error {
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
	KafkaPublisher *KafkaPublisher
	KafkaConsumer  *KafkaConsumer
	DaprPublisher  *DaprPublisher
}

func NewMiddlewareClients(
	suspendedHandler TraderSuspendedHandler,
	verifiedHandler TraderVerifiedHandler,
) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer(suspendedHandler, verifiedHandler)
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
	if m.KafkaPublisher != nil {
		m.KafkaPublisher.Close()
	}
	if m.KafkaConsumer != nil {
		m.KafkaConsumer.Close()
	}
}
