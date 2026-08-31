// Package middleware provides Kafka, Dapr, and OpenTelemetry integration for tigerbeetle-bridge.
// Kafka topics published:  ledger.transfer.posted  (double-entry transfer committed to TigerBeetle)
//                          ledger.transfer.voided  (transfer reversed/voided)
//                          ledger.account.created  (new ledger account created)
//                          ledger.reconciliation.done (nightly reconciliation completed)
// Kafka topics consumed:   payments.confirmed      (confirmed payment — post to ledger)
//                          payments.refunded       (refund approved — reverse ledger entry)
//                          declarations.cleared    (clearance — post revenue recognition entry)
// Dapr pub/sub:            publishes ledger events to pubsub
// NOTE: Fluvio is NOT deployed; Kafka is the real event bus (P0 remediation).
// OpenTelemetry:           distributed tracing for every ledger operation
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
	TopicLedgerTransferPosted      = "ledger.transfer.posted"
	TopicLedgerTransferVoided      = "ledger.transfer.voided"
	TopicLedgerAccountCreated      = "ledger.account.created"
	TopicLedgerReconciliationDone  = "ledger.reconciliation.done"

	TopicPaymentsConfirmed  = "payments.confirmed"
	TopicPaymentsRefunded   = "payments.refunded"
	TopicDeclarationCleared = "declarations.cleared"

	DaprPubsubName = "pubsub"
	ServiceName    = "tigerbeetle-bridge"
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

type LedgerTransferEvent struct {
	EventType      string    `json:"event_type"`
	TransferID     uint64    `json:"transfer_id"`
	DebitAccountID uint64    `json:"debit_account_id"`
	CreditAccountID uint64   `json:"credit_account_id"`
	Amount         uint64    `json:"amount"` // in minor currency units (kobo)
	Currency       string    `json:"currency"`
	LedgerCode     uint32    `json:"ledger_code"`
	Code           uint16    `json:"code"` // transfer type code
	DeclarationID  int64     `json:"declaration_id,omitempty"`
	PaymentRef     string    `json:"payment_ref,omitempty"`
	Source         string    `json:"source"`
	Timestamp      time.Time `json:"timestamp"`
	TraceID        string    `json:"trace_id,omitempty"`
}

type RevenueCounterUpdate struct {
	TodayNaira   float64   `json:"today_naira"`
	MonthNaira   float64   `json:"month_naira"`
	YearNaira    float64   `json:"year_naira"`
	AllTimeNaira float64   `json:"all_time_naira"`
	AsOf         time.Time `json:"as_of"`
}

type PaymentConfirmedEvent struct {
	DeclarationID int64   `json:"declaration_id"`
	PaymentRef    string  `json:"payment_ref"`
	AmountPaid    float64 `json:"amount_paid"`
	Currency      string  `json:"currency"`
	Timestamp     time.Time `json:"timestamp"`
}

type PaymentRefundedEvent struct {
	DeclarationID int64   `json:"declaration_id"`
	RefundRef     string  `json:"refund_ref"`
	AmountRefunded float64 `json:"amount_refunded"`
	Currency      string  `json:"currency"`
	Timestamp     time.Time `json:"timestamp"`
}

type DeclarationClearedEvent struct {
	DeclarationID int64   `json:"declaration_id"`
	UCR           string  `json:"ucr"`
	DutyAmount    float64 `json:"duty_amount"`
	VatAmount     float64 `json:"vat_amount"`
	Currency      string  `json:"currency"`
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

func (k *KafkaPublisher) PublishLedgerEvent(ctx context.Context, evt LedgerTransferEvent) error {
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
		Key:   sarama.StringEncoder(fmt.Sprintf("%d", evt.TransferID)),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.ErrorContext(ctx, "kafka publish failed", "topic", topic, "error", err)
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	k.logger.InfoContext(ctx, "ledger event published", "topic", topic, "transfer_id", evt.TransferID)
	return nil
}

func topicForEventType(et string) string {
	switch et {
	case "posted":
		return TopicLedgerTransferPosted
	case "voided":
		return TopicLedgerTransferVoided
	case "account_created":
		return TopicLedgerAccountCreated
	case "reconciliation_done":
		return TopicLedgerReconciliationDone
	default:
		return TopicLedgerTransferPosted
	}
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

type PaymentConfirmedHandler func(ctx context.Context, evt PaymentConfirmedEvent) error
type PaymentRefundedHandler func(ctx context.Context, evt PaymentRefundedEvent) error
type DeclarationClearedHandler func(ctx context.Context, evt DeclarationClearedEvent) error

type KafkaConsumer struct {
	consumer          sarama.ConsumerGroup
	paymentHandler    PaymentConfirmedHandler
	refundHandler     PaymentRefundedHandler
	clearanceHandler  DeclarationClearedHandler
	logger            *slog.Logger
}

func NewKafkaConsumer(
	paymentHandler PaymentConfirmedHandler,
	refundHandler PaymentRefundedHandler,
	clearanceHandler DeclarationClearedHandler,
) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), "tigerbeetle-bridge-group", cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{
		consumer:         cg,
		paymentHandler:   paymentHandler,
		refundHandler:    refundHandler,
		clearanceHandler: clearanceHandler,
		logger:           slog.Default().With("component", "kafka-consumer", "service", ServiceName),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	topics := []string{TopicPaymentsConfirmed, TopicPaymentsRefunded, TopicDeclarationCleared}
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
	c.logger.Info("tigerbeetle-bridge consumers started", "topics", topics)
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
		case TopicPaymentsConfirmed:
			var evt PaymentConfirmedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.paymentHandler(ctx, evt)
			}
		case TopicPaymentsRefunded:
			var evt PaymentRefundedEvent
			if err := json.Unmarshal(msg.Value, &evt); err == nil {
				c.refundHandler(ctx, evt)
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

func (d *DaprPublisher) PublishLedgerEvent(ctx context.Context, evt LedgerTransferEvent) error {
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
	paymentHandler PaymentConfirmedHandler,
	refundHandler PaymentRefundedHandler,
	clearanceHandler DeclarationClearedHandler,
) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer(paymentHandler, refundHandler, clearanceHandler)
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
