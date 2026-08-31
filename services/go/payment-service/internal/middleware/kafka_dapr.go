// Package middleware provides Kafka, Dapr, and OpenTelemetry integration for payment-service.
// Kafka topics published:  payments.initiated      (payment session created)
//
//	payments.confirmed      (payment successfully settled via Mojaloop)
//	payments.failed         (payment failed or timed out)
//	payments.refunded       (duty refund processed)
//
// Kafka topics consumed:   declarations.submitted  (new declaration — create duty bill)
//
//	declarations.cleared    (clearance — trigger receipt generation)
//	drawback.approved       (drawback approved — trigger refund)
//
// Dapr pub/sub:            publishes to pubsub component
// NOTE: Fluvio is NOT deployed; Kafka is the real event bus (P0 remediation).
// OpenTelemetry:           distributed tracing for every payment lifecycle event
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
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
)

const (
	TopicPaymentsInitiated    = "payments.initiated"
	TopicPaymentsConfirmed    = "payments.confirmed"
	TopicPaymentsFailed       = "payments.failed"
	TopicPaymentsRefunded     = "payments.refunded"
	TopicDeclarationSubmitted = "declarations.submitted"
	TopicDeclarationCleared   = "declarations.cleared"
	TopicDrawbackApproved     = "drawback.approved"

	DaprPubsubName = "pubsub"
	ServiceName    = "payment-service"
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

type PaymentEvent struct {
	EventType     string    `json:"event_type"`
	PaymentID     int64     `json:"payment_id"`
	DeclarationID int64     `json:"declaration_id"`
	UCR           string    `json:"ucr"`
	TraderID      int64     `json:"trader_id"`
	AmountNaira   float64   `json:"amount_naira"`
	AmountUSD     float64   `json:"amount_usd"`
	Currency      string    `json:"currency"`
	PaymentMethod string    `json:"payment_method"` // mojaloop | bank_transfer | mobile_money
	MojaloopRef   string    `json:"mojaloop_ref,omitempty"`
	Status        string    `json:"status"`
	Source        string    `json:"source"`
	Timestamp     time.Time `json:"timestamp"`
	TraceID       string    `json:"trace_id,omitempty"`
}

type DeclarationSubmittedEvent struct {
	DeclarationID int64     `json:"declaration_id"`
	UCR           string    `json:"ucr"`
	TraderID      int64     `json:"trader_id"`
	DutyAmount    float64   `json:"duty_amount"`
	VatAmount     float64   `json:"vat_amount"`
	TotalDue      float64   `json:"total_due"`
	Currency      string    `json:"currency"`
	Timestamp     time.Time `json:"timestamp"`
}

type DrawbackApprovedEvent struct {
	DrawbackID    int64     `json:"drawback_id"`
	DeclarationID int64     `json:"declaration_id"`
	TraderID      int64     `json:"trader_id"`
	RefundAmount  float64   `json:"refund_amount"`
	Currency      string    `json:"currency"`
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

func (k *KafkaPublisher) PublishPaymentEvent(ctx context.Context, evt PaymentEvent) error {
	span := trace.SpanFromContext(ctx)
	evt.TraceID = span.SpanContext().TraceID().String()
	evt.Source = ServiceName
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	topic := topicForEventType(evt.EventType)
	data, _ := json.Marshal(evt)
	msg := &sarama.ProducerMessage{
		Topic: topic,
		Key:   sarama.StringEncoder(fmt.Sprintf("%d", evt.PaymentID)),
		Value: sarama.ByteEncoder(data),
	}
	// Phase-7 OTel: inject W3C traceparent so consumers join this trace.
	InjectTraceContext(ctx, msg)
	_, _, err := k.producer.SendMessage(msg)
	if err != nil {
		k.logger.ErrorContext(ctx, "kafka publish failed", "topic", topic, "error", err)
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	k.logger.InfoContext(ctx, "payment event published", "topic", topic, "payment_id", evt.PaymentID)
	return nil
}

func topicForEventType(et string) string {
	switch et {
	case "initiated":
		return TopicPaymentsInitiated
	case "confirmed":
		return TopicPaymentsConfirmed
	case "failed":
		return TopicPaymentsFailed
	case "refunded":
		return TopicPaymentsRefunded
	default:
		return TopicPaymentsInitiated
	}
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

type DeclarationSubmittedHandler func(ctx context.Context, evt DeclarationSubmittedEvent) error
type DrawbackApprovedHandler func(ctx context.Context, evt DrawbackApprovedEvent) error

type KafkaConsumer struct {
	consumer           sarama.ConsumerGroup
	declarationHandler DeclarationSubmittedHandler
	drawbackHandler    DrawbackApprovedHandler
	logger             *slog.Logger
}

func NewKafkaConsumer(
	declarationHandler DeclarationSubmittedHandler,
	drawbackHandler DrawbackApprovedHandler,
) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), "payment-service-group", cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{
		consumer:           cg,
		declarationHandler: declarationHandler,
		drawbackHandler:    drawbackHandler,
		logger:             slog.Default().With("component", "kafka-consumer", "service", ServiceName),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	topics := []string{TopicDeclarationSubmitted, TopicDeclarationCleared, TopicDrawbackApproved}
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
	c.logger.Info("payment-service consumers started", "topics", topics)
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }

func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	tracer := otel.Tracer(ServiceName)
	for msg := range claim.Messages() {
		// Phase-7 OTel: continue the producer's trace via the header carrier.
		parentCtx := ExtractTraceContext(context.Background(), msg)
		ctx, span := tracer.Start(parentCtx, fmt.Sprintf("consume.%s", msg.Topic),
			trace.WithSpanKind(trace.SpanKindConsumer),
			trace.WithAttributes(
				attribute.String("messaging.system", "kafka"),
				attribute.String("messaging.destination", msg.Topic),
			),
		)
		switch msg.Topic {
		case TopicDeclarationSubmitted:
			var evt DeclarationSubmittedEvent
			if err := json.Unmarshal(msg.Value, &evt); err != nil {
				c.logger.ErrorContext(ctx, "unmarshal declarations.submitted", "error", err)
			} else if err := c.declarationHandler(ctx, evt); err != nil {
				c.logger.ErrorContext(ctx, "handle declarations.submitted", "error", err)
			}
		case TopicDrawbackApproved:
			var evt DrawbackApprovedEvent
			if err := json.Unmarshal(msg.Value, &evt); err != nil {
				c.logger.ErrorContext(ctx, "unmarshal drawback.approved", "error", err)
			} else if err := c.drawbackHandler(ctx, evt); err != nil {
				c.logger.ErrorContext(ctx, "handle drawback.approved", "error", err)
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

func (d *DaprPublisher) PublishPaymentEvent(ctx context.Context, evt PaymentEvent) error {
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

// InitTracer initialises the OTel tracer provider. Phase-7 contract
// (OTEL_DESIGN.md §1): OTEL_EXPORTER_OTLP_ENDPOINT unset ⇒ telemetry DISABLED
// — returns (nil, nil) and the caller must treat a nil provider as "off"
// (fail-open; telemetry never breaks the business path). When set, spans are
// exported asynchronously via a BatchSpanProcessor; a down collector drops
// spans, never requests.
func InitTracer(ctx context.Context) (*sdktrace.TracerProvider, error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		return nil, nil
	}
	opts := []otlptracehttp.Option{}
	if strings.HasPrefix(endpoint, "http://") || !strings.Contains(endpoint, "://") {
		opts = append(opts, otlptracehttp.WithInsecure())
	}
	exporter, err := otlptracehttp.New(ctx, opts...)
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
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	return tp, nil
}

// ─── W3C carriers over sarama message headers ────────────────────────────────

type producerCarrier struct{ msg *sarama.ProducerMessage }

func (c producerCarrier) Get(key string) string {
	for _, h := range c.msg.Headers {
		if strings.EqualFold(string(h.Key), key) {
			return string(h.Value)
		}
	}
	return ""
}
func (c producerCarrier) Set(key, value string) {
	for i, h := range c.msg.Headers {
		if strings.EqualFold(string(h.Key), key) {
			c.msg.Headers[i].Value = []byte(value)
			return
		}
	}
	c.msg.Headers = append(c.msg.Headers, sarama.RecordHeader{Key: []byte(key), Value: []byte(value)})
}
func (c producerCarrier) Keys() []string {
	keys := make([]string, 0, len(c.msg.Headers))
	for _, h := range c.msg.Headers {
		keys = append(keys, string(h.Key))
	}
	return keys
}

type consumerCarrier struct{ msg *sarama.ConsumerMessage }

func (c consumerCarrier) Get(key string) string {
	for _, h := range c.msg.Headers {
		if h != nil && strings.EqualFold(string(h.Key), key) {
			return string(h.Value)
		}
	}
	return ""
}
func (c consumerCarrier) Set(_, _ string) {}
func (c consumerCarrier) Keys() []string {
	keys := make([]string, 0, len(c.msg.Headers))
	for _, h := range c.msg.Headers {
		if h != nil {
			keys = append(keys, string(h.Key))
		}
	}
	return keys
}

// InjectTraceContext injects traceparent/tracestate/baggage into a producer message.
func InjectTraceContext(ctx context.Context, msg *sarama.ProducerMessage) {
	otel.GetTextMapPropagator().Inject(ctx, producerCarrier{msg: msg})
}

// ExtractTraceContext extracts a remote trace context from a consumed message.
func ExtractTraceContext(ctx context.Context, msg *sarama.ConsumerMessage) context.Context {
	return otel.GetTextMapPropagator().Extract(ctx, consumerCarrier{msg: msg})
}

// ─── Combined Middleware Clients ──────────────────────────────────────────────

type MiddlewareClients struct {
	KafkaPublisher *KafkaPublisher
	KafkaConsumer  *KafkaConsumer
	DaprPublisher  *DaprPublisher
}

func NewMiddlewareClients(
	declarationHandler DeclarationSubmittedHandler,
	drawbackHandler DrawbackApprovedHandler,
) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer(declarationHandler, drawbackHandler)
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
