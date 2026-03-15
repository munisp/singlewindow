// Package middleware provides Kafka and Dapr pub/sub integration for wazuh-svc.
// Kafka topics published: security.alert (SIEM-detected threats)
// Kafka topics consumed: audit.event (correlates audit events with security incidents)
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
	TopicSecurityAlert = "security.alert"
	TopicAuditEvent    = "audit.event"
	DaprPubsubName     = "dapr-kafka-pubsub"
)

type SecurityAlertEvent struct {
	AlertID       string    `json:"alert_id"`
	AlertType     string    `json:"alert_type"` // BRUTE_FORCE, API_ABUSE, ANOMALOUS_LOGIN, PRIVILEGE_ESCALATION, DATA_EXFIL
	Severity      string    `json:"severity"`   // CRITICAL, HIGH, MEDIUM, LOW
	RuleID        string    `json:"rule_id"`
	RuleDesc      string    `json:"rule_desc"`
	AgentID       string    `json:"agent_id"`
	AgentName     string    `json:"agent_name"`
	SourceIP      string    `json:"source_ip,omitempty"`
	UserID        string    `json:"user_id,omitempty"`
	DeclarationID string    `json:"declaration_id,omitempty"`
	Description   string    `json:"description"`
	WazuhAlertID  string    `json:"wazuh_alert_id"`
	Timestamp     time.Time `json:"timestamp"`
	Source        string    `json:"source"`
}

type AuditEventMessage struct {
	EventID       string    `json:"event_id"`
	EventType     string    `json:"event_type"`
	DeclarationID string    `json:"declaration_id"`
	ActorID       string    `json:"actor_id"`
	Action        string    `json:"action"`
	Resource      string    `json:"resource"`
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
		logger:   slog.Default().With("component", "kafka-publisher", "service", "wazuh-svc"),
	}, nil
}

func (k *KafkaPublisher) PublishSecurityAlert(evt SecurityAlertEvent) error {
	evt.Source = "wazuh-svc"
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
	k.logger.Info("wazuh security alert published", "type", evt.AlertType, "severity", evt.Severity, "rule", evt.RuleID)
	return nil
}

func (k *KafkaPublisher) Close() error { return k.producer.Close() }

type AuditEventHandler func(evt AuditEventMessage) error

type KafkaConsumer struct {
	consumer sarama.ConsumerGroup
	handler  AuditEventHandler
	logger   *slog.Logger
}

func NewKafkaConsumer(groupID string, handler AuditEventHandler) (*KafkaConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Consumer.Group.Rebalance.Strategy = sarama.NewBalanceStrategyRoundRobin()
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Version = sarama.V2_8_0_0
	cg, err := sarama.NewConsumerGroup(kafkaBrokers(), groupID, cfg)
	if err != nil {
		return nil, fmt.Errorf("consumer group: %w", err)
	}
	return &KafkaConsumer{consumer: cg, handler: handler,
		logger: slog.Default().With("component", "kafka-consumer", "service", "wazuh-svc")}, nil
}

func (c *KafkaConsumer) Start(ctx context.Context) {
	go func() {
		for {
			c.consumer.Consume(ctx, []string{TopicAuditEvent}, c)
			if ctx.Err() != nil {
				return
			}
		}
	}()
	c.logger.Info("wazuh audit event consumer started")
}

func (c *KafkaConsumer) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (c *KafkaConsumer) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }
func (c *KafkaConsumer) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		var evt AuditEventMessage
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
	logger     *slog.Logger
}

func NewDaprPublisher() *DaprPublisher {
	return &DaprPublisher{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		baseURL:    fmt.Sprintf("http://localhost:%s/v1.0/publish", daprPort()),
		logger:     slog.Default().With("component", "dapr-publisher", "service", "wazuh-svc"),
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

func NewMiddlewareClients(handler AuditEventHandler) (*MiddlewareClients, error) {
	kp, err := NewKafkaPublisher()
	if err != nil {
		return nil, err
	}
	kc, err := NewKafkaConsumer("wazuh-svc-group", handler)
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
