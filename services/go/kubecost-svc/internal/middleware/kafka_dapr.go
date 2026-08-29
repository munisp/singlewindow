// Package middleware provides Kafka, Dapr, and OpenTelemetry integration for kubecost-svc.
// Kafka topics published:  finops.cost.alert       (cost threshold exceeded alert)
//
//	finops.budget.breach    (monthly budget breached)
//	finops.report.generated (daily/weekly cost report ready)
//
// Kafka topics consumed:   (none — kubecost-svc is a read/publish-only service)
// Dapr pub/sub:            publishes FinOps alerts to pubsub
// OpenTelemetry:           distributed tracing for all cost query operations
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
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
)

const (
	TopicFinOpsCostAlert       = "finops.cost.alert"
	TopicFinOpsBudgetBreach    = "finops.budget.breach"
	TopicFinOpsReportGenerated = "finops.report.generated"

	DaprPubsubName = "pubsub"
	ServiceName    = "kubecost-svc"
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

type FinOpsCostAlertEvent struct {
	EventType   string    `json:"event_type"`
	Namespace   string    `json:"namespace"`
	Service     string    `json:"service"`
	MonthlyCost float64   `json:"monthly_cost_usd"`
	Threshold   float64   `json:"threshold_usd"`
	Period      string    `json:"period"` // daily | weekly | monthly
	Source      string    `json:"source"`
	Timestamp   time.Time `json:"timestamp"`
	TraceID     string    `json:"trace_id,omitempty"`
}

type FinOpsReportEvent struct {
	EventType    string    `json:"event_type"`
	ReportPeriod string    `json:"report_period"`
	TotalCostUSD float64   `json:"total_cost_usd"`
	TopNamespace string    `json:"top_namespace"`
	ReportURL    string    `json:"report_url,omitempty"`
	Source       string    `json:"source"`
	Timestamp    time.Time `json:"timestamp"`
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

func (k *KafkaPublisher) PublishCostAlert(ctx context.Context, evt FinOpsCostAlertEvent) error {
	evt.Source = ServiceName
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	topic := TopicFinOpsCostAlert
	if evt.EventType == "budget_breach" {
		topic = TopicFinOpsBudgetBreach
	}
	data, _ := json.Marshal(evt)
	msg := &sarama.ProducerMessage{
		Topic: topic,
		Key:   sarama.StringEncoder(evt.Namespace),
		Value: sarama.ByteEncoder(data),
	}
	// Phase-7 OTel: inject W3C traceparent so consumers join this trace.
	InjectTraceContext(ctx, msg)
	_, _, err := k.producer.SendMessage(msg)
	if err != nil {
		k.logger.ErrorContext(ctx, "kafka publish failed", "topic", topic, "error", err)
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	k.logger.InfoContext(ctx, "FinOps alert published", "topic", topic, "namespace", evt.Namespace)
	return nil
}

func (k *KafkaPublisher) PublishReport(ctx context.Context, evt FinOpsReportEvent) error {
	evt.Source = ServiceName
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	data, _ := json.Marshal(evt)
	msg := &sarama.ProducerMessage{
		Topic: TopicFinOpsReportGenerated,
		Key:   sarama.StringEncoder(evt.ReportPeriod),
		Value: sarama.ByteEncoder(data),
	}
	// Phase-7 OTel: inject W3C traceparent so consumers join this trace.
	InjectTraceContext(ctx, msg)
	_, _, err := k.producer.SendMessage(msg)
	if err != nil {
		k.logger.ErrorContext(ctx, "kafka publish failed", "topic", TopicFinOpsReportGenerated, "error", err)
		return fmt.Errorf("publish report: %w", err)
	}
	return nil
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

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

func (d *DaprPublisher) PublishCostAlert(ctx context.Context, evt FinOpsCostAlertEvent) error {
	topic := TopicFinOpsCostAlert
	if evt.EventType == "budget_breach" {
		topic = TopicFinOpsBudgetBreach
	}
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

// Phase-7 contract (OTEL_DESIGN.md §1): OTEL_EXPORTER_OTLP_ENDPOINT unset ⇒
// telemetry DISABLED — returns (nil, nil); a nil provider means "off" and the
// business path never depends on telemetry (the one sanctioned fail-open).
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
		),
	)
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.1))),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	return tp, nil
}

// ─── Combined Middleware Clients ──────────────────────────────────────────────

type MiddlewareClients struct {
	KafkaPublisher *KafkaPublisher
	DaprPublisher  *DaprPublisher
}

func NewMiddlewareClients() (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	return &MiddlewareClients{
		KafkaPublisher: kp,
		DaprPublisher:  NewDaprPublisher(),
	}, nil
}

func (m *MiddlewareClients) Close() {
	if m.KafkaPublisher != nil {
		m.KafkaPublisher.Close()
	}
}

// ─── OTel Tracer Accessor ─────────────────────────────────────────────────────

func Tracer() interface {
	Start(context.Context, string, ...interface{}) (context.Context, interface{})
} {
	return nil // use otel.Tracer(ServiceName) directly in handlers
}

func GetTracer() interface{} {
	return otel.Tracer(ServiceName)
}

// ─── W3C carriers over sarama message headers (Phase-7 OTel) ─────────────────

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
