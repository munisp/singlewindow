// Package producer publishes CargoEvents to Kafka topics from Go microservices.
// Declaration-service, payment-service, and oga-service import this package to
// emit real-time events that the fluvio-consumer broadcasts to WebSocket clients.
package producer

import (
	"context"
	"encoding/json"
	"log"
	"time"

	kafka "github.com/segmentio/kafka-go"
	"github.com/tradegateway/fluvio-consumer/internal/hub"
)

// Producer wraps a Kafka writer for publishing CargoEvents.
type Producer struct {
	writer *kafka.Writer
}

// New creates a Producer targeting the given Kafka brokers and topic.
func New(brokers []string, topic string) *Producer {
	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        topic,
		Balancer:     &kafka.LeastBytes{},
		WriteTimeout: 5 * time.Second,
		ReadTimeout:  5 * time.Second,
	}
	return &Producer{writer: w}
}

// Publish serialises a CargoEvent and writes it to Kafka.
func (p *Producer) Publish(ctx context.Context, evt *hub.CargoEvent) error {
	if evt.Timestamp.IsZero() {
		evt.Timestamp = time.Now().UTC()
	}
	if evt.Source == "" {
		evt.Source = "microservice"
	}

	payload, err := json.Marshal(evt)
	if err != nil {
		return err
	}

	key := []byte(evt.EventType)
	if evt.UCR != "" {
		key = []byte(evt.UCR)
	}

	err = p.writer.WriteMessages(ctx, kafka.Message{
		Key:   key,
		Value: payload,
		Time:  evt.Timestamp,
	})
	if err != nil {
		log.Printf("[producer] write error on topic %s: %v", p.writer.Topic, err)
		return err
	}
	return nil
}

// Close flushes and closes the underlying Kafka writer.
func (p *Producer) Close() error {
	return p.writer.Close()
}

// ── Convenience constructors for each topic ───────────────────────────────────

// NewCargoEventsProducer creates a producer for the cargo-events topic.
func NewCargoEventsProducer(brokers []string) *Producer {
	return New(brokers, "cargo-events")
}

// NewDeclarationEventsProducer creates a producer for the declaration-events topic.
func NewDeclarationEventsProducer(brokers []string) *Producer {
	return New(brokers, "declaration-events")
}

// NewPaymentEventsProducer creates a producer for the payment-events topic.
func NewPaymentEventsProducer(brokers []string) *Producer {
	return New(brokers, "payment-events")
}

// NewAISProducer creates a producer for the ais-vessel-positions topic.
func NewAISProducer(brokers []string) *Producer {
	return New(brokers, "ais-vessel-positions")
}

// ── Synthetic AIS position generator (for testing and demo mode) ──────────────

// GhanaPort defines a port location for synthetic AIS generation.
type GhanaPort struct {
	Code string
	Name string
	Lat  float64
	Lon  float64
}

var GhanaPorts = []GhanaPort{
	{Code: "GHTEM", Name: "Tema Container Terminal", Lat: 5.6037, Lon: -0.0167},
	{Code: "GHKSI", Name: "Takoradi Port", Lat: 4.8845, Lon: -1.7554},
	{Code: "GHKDI", Name: "Keta Lagoon Terminal", Lat: 5.9167, Lon: 0.9833},
}

// PublishSyntheticAIS publishes a synthetic AIS position update for a vessel.
func (p *Producer) PublishSyntheticAIS(ctx context.Context, vesselIMO string, port GhanaPort, speed float64) error {
	lat := port.Lat + (float64(time.Now().UnixNano()%100)-50)/10000.0
	lon := port.Lon + (float64(time.Now().UnixNano()%100)-50)/10000.0

	evt := &hub.CargoEvent{
		EventID:   "AIS-" + vesselIMO + "-" + time.Now().Format("20060102150405"),
		EventType: "AIS_POSITION_UPDATE",
		PortCode:  port.Code,
		Location:  port.Name,
		Actor:     "AIS_TRANSPONDER",
		Message:   vesselIMO + " position update near " + port.Name,
		Severity:  "INFO",
		Latitude:  &lat,
		Longitude: &lon,
		Timestamp: time.Now().UTC(),
		Source:    "ais-synthetic",
	}
	return p.Publish(ctx, evt)
}
