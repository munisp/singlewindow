// Package middleware provides Kafka, Dapr, Fluvio, and OpenTelemetry integration for declaration-service.
// Kafka topics published:  declarations.submitted  (new declaration submitted for risk scoring)
//                          declarations.cleared    (declaration cleared by customs)
//                          declarations.rejected   (declaration rejected)
//                          declarations.amended    (amendment submitted)
// Kafka topics consumed:   risk.scored             (risk engine result: score + lane)
//                          payments.confirmed      (duty payment confirmed by payment-service)
//                          oga.approved            (OGA permit approved)
// Dapr pub/sub:            publishes to dapr-kafka-pubsub component
// Fluvio:                  streams real-time declaration status updates to port operators
// OpenTelemetry:           distributed tracing for every declaration lifecycle event
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

// ─── Topic & Component Constants ─────────────────────────────────────────────

const (
	TopicDeclarationSubmitted = "declarations.submitted"
	TopicDeclarationCleared   = "declarations.cleared"
	TopicDeclarationRejected  = "declarations.rejected"
	TopicDeclarationAmended   = "declarations.amended"
	TopicRiskScored           = "risk.scored"
	TopicPaymentsConfirmed    = "payments.confirmed"
	TopicOGAApproved          = "oga.approved"

	DaprPubsubName = "dapr-kafka-pubsub"
	ServiceName    = "declaration-service"
)

func kafkaBrokers() []string {
	b := os.Getenv("KAFKA_BROKERS")
	if b == "" {
		b = "kafka:9092"
	}
	brokers := []string{}
	for _, br := range splitCSV(b) {
		brokers = append(brokers, br)
	}
	return brokers
}

func daprPort() string {
	p := os.Getenv("DAPR_HTTP_PORT")
	if p == "" {
		p = "3500"
	}
	return p
}

func fluvioEndpoint() string {
	e := os.Getenv("FLUVIO_ENDPOINT")
	if e == "" {
		e = "http://fluvio-sc:9003"
	}
	return e
}

func splitCSV(s string) []string {
	out := []string{}
	cur := ""
	for _, c := range s {
		if c == ',' {
			if cur != "" {
				out = append(out, cur)
				cur = ""
			}
		} else {
			cur += string(c)
		}
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}

// ─── Event Schemas ────────────────────────────────────────────────────────────

type DeclarationEvent struct {
	EventType         string    `json:"event_type"`
	DeclarationID     int64     `json:"declaration_id"`
	DeclarationNumber string    `json:"declaration_number"`
	UCR               string    `json:"ucr"`
	TraderID          int64     `json:"trader_id"`
	HSCode            string    `json:"hs_code"`
	InvoiceValueUSD   float64   `json:"invoice_value_usd"`
	PortOfEntry       string    `json:"port_of_entry"`
	Status            string    `json:"status"`
	Source            string    `json:"source"`
	Timestamp         time.Time `json:"timestamp"`
	TraceID           string    `json:"trace_id,omitempty"`
}

type RiskScoredEvent struct {
	DeclarationID int64   `json:"declaration_id"`
	RiskScore     float64 `json:"risk_score"`
	RiskLane      string  `json:"risk_lane"` // GREEN | YELLOW | RED
	DutyAmount    float64 `json:"duty_amount"`
	VatAmount     float64 `json:"vat_amount"`
	TotalDue      float64 `json:"total_due"`
	Timestamp     time.Time `json:"timestamp"`
}

type PaymentConfirmedEvent struct {
	DeclarationID  int64   `json:"declaration_id"`
	PaymentRef     string  `json:"payment_ref"`
	AmountPaid     float64 `json:"amount_paid"`
	Currency       string  `json:"currency"`
	PaymentMethod  string  `json:"payment_method"`
	Timestamp      time.Time `json:"timestamp"`
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
		return nil, fmt.Errorf("kafka producer init: %w", err)
	}
	return &KafkaPublisher{
		producer: producer,
		logger:   slog.Default().With("component", "kafka-publisher", "service", ServiceName),
	}, nil
}

func (k *KafkaPublisher) PublishDeclarationEvent(ctx context.Context, evt DeclarationEvent) error {
	span := trace.SpanFromContext(ctx)
	evt.TraceID = span.SpanContext().TraceID().String()
	evt.Source = ServiceName
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	data, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	topic := topicForEventType(evt.EventType)
	_, _, err = k.producer.SendMessage(&sarama.ProducerMessage{
		Topic: topic,
		Key:   sarama.StringEncoder(fmt.Sprintf("%d", evt.DeclarationID)),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.ErrorContext(ctx, "kafka publish failed", "topic", topic, "error", err)
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	k.logger.InfoContext(ctx, "declaration event published", "topic", topic, "declaration_id", evt.DeclarationID)
	return nil
}

func topicForEventType(et string) string {
	switch et {
	case "submitted":
		return TopicDeclarationSubmitted
	case "cleared":
		return TopicDeclarationCleared
	case "rejected":
		return TopicDeclarationRejected
	case "amended":
		return TopicDeclarationAmended
	default:
		return TopicDeclarationSubmitted
	}
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

type RiskScoredHandler func(ctx context.Context, evt RiskScoredEvent) error
type PaymentConfirmedHandler func(ctx context.Context, evt PaymentConfirmedEvent) error
type OGAApprovedHandler func(ctx context.Context, evt OGAApprovedEvent) error

type KafkaConsumer struct {
	consumer              sarama.ConsumerGroup
	riskHandler           RiskScoredHandler
	paymentHandler        PaymentConfirmedHandler
	ogaHandler            OGAApprovedHandler
	logger                *slog.Logger
}

func NewKafkaConsumer(
	riskHandler RiskScoredHandler,
	paymentHandler PaymentConfirmedHandler,
	ogaHandler OGAApprovedHandler,
) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), "declaration-service-group", cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{
		consumer:       cg,
		riskHandler:    riskHandler,
		paymentHandler: paymentHandler,
		ogaHandler:     ogaHandler,
		logger:         slog.Default().With("component", "kafka-consumer", "service", ServiceName),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	topics := []string{TopicRiskScored, TopicPaymentsConfirmed, TopicOGAApproved}
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
	c.logger.Info("declaration-service consumers started", "topics", topics)
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
				attribute.Int64("messaging.kafka.message_key", int64(msg.Offset)),
			),
		)
		switch msg.Topic {
		case TopicRiskScored:
			var evt RiskScoredEvent
			if err := json.Unmarshal(msg.Value, &evt); err != nil {
				c.logger.ErrorContext(ctx, "unmarshal risk.scored", "error", err)
			} else if err := c.riskHandler(ctx, evt); err != nil {
				c.logger.ErrorContext(ctx, "handle risk.scored", "error", err)
			}
		case TopicPaymentsConfirmed:
			var evt PaymentConfirmedEvent
			if err := json.Unmarshal(msg.Value, &evt); err != nil {
				c.logger.ErrorContext(ctx, "unmarshal payments.confirmed", "error", err)
			} else if err := c.paymentHandler(ctx, evt); err != nil {
				c.logger.ErrorContext(ctx, "handle payments.confirmed", "error", err)
			}
		case TopicOGAApproved:
			var evt OGAApprovedEvent
			if err := json.Unmarshal(msg.Value, &evt); err != nil {
				c.logger.ErrorContext(ctx, "unmarshal oga.approved", "error", err)
			} else if err := c.ogaHandler(ctx, evt); err != nil {
				c.logger.ErrorContext(ctx, "handle oga.approved", "error", err)
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

func (d *DaprPublisher) PublishDeclarationEvent(ctx context.Context, evt DeclarationEvent) error {
	topic := topicForEventType(evt.EventType)
	payload, _ := json.Marshal(evt)
	url := fmt.Sprintf("%s/%s/%s", d.baseURL, DaprPubsubName, topic)
	resp, err := d.httpClient.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		d.logger.WarnContext(ctx, "dapr publish failed (non-fatal)", "error", err)
		return nil // Dapr is optional; Kafka is primary
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		d.logger.WarnContext(ctx, "dapr publish non-2xx", "status", resp.StatusCode)
	}
	return nil
}

// ─── Fluvio Publisher (real-time status stream for port operators) ────────────

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

type FluvioDeclarationStatusUpdate struct {
	DeclarationID     int64     `json:"declaration_id"`
	DeclarationNumber string    `json:"declaration_number"`
	UCR               string    `json:"ucr"`
	Status            string    `json:"status"`
	RiskLane          string    `json:"risk_lane,omitempty"`
	PortOfEntry       string    `json:"port_of_entry"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func (f *FluvioPublisher) PublishStatusUpdate(ctx context.Context, update FluvioDeclarationStatusUpdate) error {
	if update.UpdatedAt.IsZero() {
		update.UpdatedAt = time.Now().UTC()
	}
	payload, _ := json.Marshal(update)
	url := fmt.Sprintf("%s/api/v1/produce/declarations.status.stream", f.endpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("fluvio request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.httpClient.Do(req)
	if err != nil {
		f.logger.WarnContext(ctx, "fluvio publish failed (non-fatal)", "error", err)
		return nil // Fluvio is optional; Kafka is primary
	}
	defer resp.Body.Close()
	f.logger.InfoContext(ctx, "fluvio status update published", "declaration_id", update.DeclarationID, "status", update.Status)
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
	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(ServiceName),
			semconv.ServiceVersion("1.0.0"),
			attribute.String("deployment.environment", os.Getenv("ENVIRONMENT")),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("otel resource: %w", err)
	}
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
	riskHandler RiskScoredHandler,
	paymentHandler PaymentConfirmedHandler,
	ogaHandler OGAApprovedHandler,
) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, fmt.Errorf("kafka publisher: %w", err)
	}
	kc, err := NewKafkaConsumer(riskHandler, paymentHandler, ogaHandler)
	if err != nil {
		kp.Close()
		return nil, fmt.Errorf("kafka consumer: %w", err)
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
