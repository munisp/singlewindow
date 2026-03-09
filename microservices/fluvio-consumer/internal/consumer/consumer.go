// Package consumer subscribes to Kafka topics that mirror Fluvio streams and
// forwards decoded events to the broadcast hub.
package consumer

import (
	"context"
	"encoding/json"
	"log"
	"time"

	kafka "github.com/segmentio/kafka-go"
	"github.com/tradegateway/fluvio-consumer/internal/hub"
)

// Topics that the consumer subscribes to.
var Topics = []string{
	"cargo-events",
	"ais-vessel-positions",
	"declaration-events",
	"payment-events",
}

// Consumer reads from Kafka (Fluvio-mirrored) topics and publishes to the hub.
type Consumer struct {
	hub     *hub.Hub
	brokers []string
	groupID string
}

// New creates a Consumer.
func New(h *hub.Hub, brokers []string, groupID string) *Consumer {
	return &Consumer{hub: h, brokers: brokers, groupID: groupID}
}

// Start begins consuming all configured topics in separate goroutines.
func (c *Consumer) Start(ctx context.Context) {
	for _, topic := range Topics {
		go c.consumeTopic(ctx, topic)
	}
}

func (c *Consumer) consumeTopic(ctx context.Context, topic string) {
	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        c.brokers,
		GroupID:        c.groupID,
		Topic:          topic,
		MinBytes:       1,
		MaxBytes:       1 << 20, // 1 MB
		CommitInterval: time.Second,
		StartOffset:    kafka.LastOffset,
	})
	defer r.Close()

	log.Printf("[consumer] subscribed to topic: %s", topic)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[consumer] stopping topic %s", topic)
			return
		default:
		}

		msg, err := r.ReadMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("[consumer] read error on %s: %v — retrying in 2s", topic, err)
			time.Sleep(2 * time.Second)
			continue
		}

		evt := c.decode(topic, msg)
		if evt != nil {
			c.hub.Publish(evt)
		}
	}
}

// decode converts a raw Kafka message into a CargoEvent.
// It handles both fully-formed CargoEvent JSON and lighter-weight
// topic-specific payloads (e.g., AIS position updates).
func (c *Consumer) decode(topic string, msg kafka.Message) *hub.CargoEvent {
	// Try full CargoEvent first
	var evt hub.CargoEvent
	if err := json.Unmarshal(msg.Value, &evt); err == nil && evt.EventType != "" {
		evt.Partition = int(msg.Partition)
		evt.Offset = msg.Offset
		evt.Source = "kafka"
		if evt.Timestamp.IsZero() {
			evt.Timestamp = msg.Time
		}
		return &evt
	}

	// Fallback: wrap raw payload as a generic event
	return &hub.CargoEvent{
		EventID:   generateEventID(topic, msg.Offset),
		EventType: topicToEventType(topic),
		PortCode:  "UNKNOWN",
		Actor:     "SYSTEM",
		Message:   string(msg.Value),
		Severity:  "INFO",
		Timestamp: msg.Time,
		Partition: int(msg.Partition),
		Offset:    msg.Offset,
		Source:    "kafka-raw",
	}
}

func topicToEventType(topic string) string {
	switch topic {
	case "ais-vessel-positions":
		return "AIS_POSITION_UPDATE"
	case "declaration-events":
		return "DECLARATION_EVENT"
	case "payment-events":
		return "PAYMENT_EVENT"
	default:
		return "CARGO_EVENT"
	}
}

func generateEventID(topic string, offset int64) string {
	return topic + "-" + time.Now().Format("20060102150405") + "-" + itoa(offset)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	buf := make([]byte, 0, 20)
	if n < 0 {
		buf = append(buf, '-')
		n = -n
	}
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	return string(buf)
}
