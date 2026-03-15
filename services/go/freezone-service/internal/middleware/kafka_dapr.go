// Package middleware provides Kafka and Dapr pub/sub integration for freezone-service.
// Kafka topics consumed: declaration.cleared (triggers free zone admission)
// Kafka topics published: cargo.released (goods exiting free zone to domestic/re-export)
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
	TopicDeclarationCleared = "declaration.cleared"
	TopicCargoReleased      = "cargo.released"
	DaprPubsubName          = "dapr-kafka-pubsub"
)

type CargoReleasedEvent struct {
	EventID       string    `json:"event_id"`
	UCR           string    `json:"ucr"`
	DeclarationID string    `json:"declaration_id"`
	TraderID      string    `json:"trader_id"`
	ZoneID        string    `json:"zone_id"`
	ZoneCode      string    `json:"zone_code"`
	ExitType      string    `json:"exit_type"` // DOMESTIC, RE_EXPORT, DESTRUCTION
	GoodsDesc     string    `json:"goods_desc"`
	HSCode        string    `json:"hs_code"`
	Quantity      float64   `json:"quantity"`
	Unit          string    `json:"unit"`
	ReleasedAt    time.Time `json:"released_at"`
	Source        string    `json:"source"`
}

type DeclarationClearedEvent struct {
	DeclarationID string    `json:"declaration_id"`
	UCR           string    `json:"ucr"`
	TraderID      string    `json:"trader_id"`
	HSCode        string    `json:"hs_code"`
	CustomsValue  float64   `json:"customs_value"`
	RiskScore     float64   `json:"risk_score"`
	Lane          string    `json:"lane"`
	ClearedAt     time.Time `json:"cleared_at"`
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
		logger:   slog.Default().With("component", "kafka-publisher", "service", "freezone-service"),
	}, nil
}

func (k *KafkaPublisher) PublishCargoReleased(evt CargoReleasedEvent) error {
	evt.Source = "freezone-service"
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
	k.logger.Info("cargo.released published", "ucr", evt.UCR, "exit_type", evt.ExitType)
	return nil
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

type DeclarationClearedHandler func(evt DeclarationClearedEvent) error

type KafkaConsumer struct {
	consumer sarama.ConsumerGroup
	handler  DeclarationClearedHandler
	logger   *slog.Logger
}

func NewKafkaConsumer(groupID string, handler DeclarationClearedHandler) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), groupID, cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{consumer: cg, handler: handler,
		logger: slog.Default().With("component", "kafka-consumer", "service", "freezone-service")}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	go func() {
		for {
			c.consumer.Consume(ctx, []string{TopicDeclarationCleared}, c)
			if ctx.Err() != nil {
				return
			}
		}
	}()
	c.logger.Info("freezone kafka consumer started")
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }
func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		var evt DeclarationClearedEvent
		if err := json.Unmarshal(msg.Value, &evt); err != nil {
			c.logger.Error("unmarshal declaration.cleared", "error", err)
		} else {
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
	logger     *slog.Logger
}

func NewDaprPublisher() *DaprPublisher {
	return &DaprPublisher{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		baseURL:    fmt.Sprintf("http://localhost:%s/v1.0/publish", daprPort()),
		logger:     slog.Default().With("component", "dapr-publisher", "service", "freezone-service"),
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

func NewMiddlewareClients(handler DeclarationClearedHandler) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer("freezone-service-group", handler)
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
