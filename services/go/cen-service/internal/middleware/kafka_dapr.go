// Package middleware provides Kafka and Dapr pub/sub integration for cen-service.
// Kafka topics published: security.alert (CEN threat alerts), cen.alert.outbound
// Kafka topics consumed: sanctions.hit (triggers CEN alert dispatch)
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
	TopicSecurityAlert    = "security.alert"
	TopicCENAlertOutbound = "cen.alert.outbound"
	TopicSanctionsHit     = "sanctions.hit"
	DaprPubsubName        = "dapr-kafka-pubsub"
)

type SecurityAlertEvent struct {
	AlertID       string    `json:"alert_id"`
	AlertType     string    `json:"alert_type"` // CEN_ALERT, SANCTIONS_HIT, THREAT_INDICATOR
	Severity      string    `json:"severity"`   // CRITICAL, HIGH, MEDIUM, LOW
	DeclarationID string    `json:"declaration_id,omitempty"`
	UCR           string    `json:"ucr,omitempty"`
	TraderID      string    `json:"trader_id,omitempty"`
	HSCode        string    `json:"hs_code,omitempty"`
	Description   string    `json:"description"`
	CENAlertRef   string    `json:"cen_alert_ref,omitempty"`
	SendingCountry string   `json:"sending_country,omitempty"`
	Timestamp     time.Time `json:"timestamp"`
	Source        string    `json:"source"`
}

type CENAlertOutboundEvent struct {
	AlertRef      string    `json:"alert_ref"`
	AlertType     string    `json:"alert_type"`
	Commodity     string    `json:"commodity"`
	HSCode        string    `json:"hs_code"`
	Route         string    `json:"route"`
	OriginCountry string    `json:"origin_country"`
	DestCountry   string    `json:"dest_country"`
	Description   string    `json:"description"`
	Timestamp     time.Time `json:"timestamp"`
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
		logger:   slog.Default().With("component", "kafka-publisher", "service", "cen-service"),
	}, nil
}

func (k *KafkaPublisher) publish(topic, key string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	_, _, err = k.producer.SendMessage(&sarama.ProducerMessage{
		Topic: topic,
		Key:   sarama.StringEncoder(key),
		Value: sarama.ByteEncoder(data),
	})
	if err != nil {
		k.logger.Error("kafka publish failed", "topic", topic, "error", err)
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	k.logger.Info("kafka event published", "topic", topic)
	return nil
}

func (k *KafkaPublisher) PublishSecurityAlert(evt SecurityAlertEvent) error {
	evt.Source = "cen-service"
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	return k.publish(TopicSecurityAlert, evt.AlertID, evt)
}

func (k *KafkaPublisher) PublishCENAlertOutbound(evt CENAlertOutboundEvent) error {
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	return k.publish(TopicCENAlertOutbound, evt.AlertRef, evt)
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

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
	return &KafkaConsumer{
		consumer: cg,
		handler:  handler,
		logger:   slog.Default().With("component", "kafka-consumer", "service", "cen-service"),
	}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	go func() {
		for {
			if err := c.consumer.Consume(ctx, []string{TopicSanctionsHit}, c); err != nil {
				c.logger.Error("consumer error", "error", err)
			}
			if ctx.Err() != nil {
				return
			}
		}
	}()
	c.logger.Info("kafka consumer started", "topics", []string{TopicSanctionsHit})
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }
func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		var evt SanctionsHitEvent
		if err := json.Unmarshal(msg.Value, &evt); err != nil {
			c.logger.Error("unmarshal sanctions.hit", "error", err)
			sess.MarkMessage(msg, "")
			continue
		}
		if err := c.handler(evt); err != nil {
			c.logger.Error("handle sanctions.hit", "error", err)
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
		logger:     slog.Default().With("component", "dapr-publisher", "service", "cen-service"),
	}
}

func (d *DaprPublisher) PublishSecurityAlert(evt SecurityAlertEvent) error {
	return d.publish(DaprPubsubName, TopicSecurityAlert, evt)
}

func (d *DaprPublisher) publish(pubsubName, topic string, data interface{}) error {
	payload, _ := json.Marshal(data)
	url := fmt.Sprintf("%s/%s/%s", d.baseURL, pubsubName, topic)
	resp, err := d.httpClient.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("dapr publish %s: %w", topic, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("dapr publish %s: status %d", topic, resp.StatusCode)
	}
	d.logger.Info("dapr event published", "topic", topic)
	return nil
}

// ─── Combined Middleware Clients ──────────────────────────────────────────────

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
	kc, err := NewKafkaConsumer("cen-service-group", handler)
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
