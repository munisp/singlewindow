// pubsub — Dapr pub/sub client for declaration-service
// Uses Dapr HTTP API to publish events to Kafka topics.
package pubsub

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const (
	PubSubName = "kafka-pubsub"
)

// Client is a Dapr pub/sub HTTP client
type Client struct {
	daprPort string
	http     *http.Client
}

// New creates a new Dapr pub/sub client
func New(daprPort string) *Client {
	return &Client{
		daprPort: daprPort,
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Publish publishes an event to a Kafka topic via Dapr
func (c *Client) Publish(ctx context.Context, topic string, data interface{}) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", c.daprPort, PubSubName, topic)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// Dapr sidecar not available — log and continue (graceful degradation)
		return fmt.Errorf("dapr publish (topic=%s): %w", topic, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("dapr publish failed (topic=%s, status=%d)", topic, resp.StatusCode)
	}
	return nil
}

// ── Event payloads ────────────────────────────────────────────────────────────

type DeclarationSubmittedEvent struct {
	DeclarationId     int64     `json:"declarationId"`
	DeclarationNumber string    `json:"declarationNumber"`
	TraderId          int64     `json:"traderId"`
	HSCode            string    `json:"hsCode"`
	DeclaredValue     float64   `json:"declaredValue"`
	OriginCountry     string    `json:"originCountry"`
	SubmittedAt       time.Time `json:"submittedAt"`
}

type DeclarationClearedEvent struct {
	DeclarationId     int64     `json:"declarationId"`
	DeclarationNumber string    `json:"declarationNumber"`
	TraderId          int64     `json:"traderId"`
	ClearanceTime     float64   `json:"clearanceTimeHours"`
	DutyAmount        float64   `json:"dutyAmount"`
	ClearedAt         time.Time `json:"clearedAt"`
}

type DeclarationRejectedEvent struct {
	DeclarationId     int64     `json:"declarationId"`
	DeclarationNumber string    `json:"declarationNumber"`
	TraderId          int64     `json:"traderId"`
	Reason            string    `json:"reason"`
	AgencyCode        string    `json:"agencyCode,omitempty"`
	RejectedAt        time.Time `json:"rejectedAt"`
}

type OGAPermitRequestedEvent struct {
	PermitId      int64     `json:"permitId"`
	DeclarationId int64     `json:"declarationId"`
	AgencyCode    string    `json:"agencyCode"`
	AgencyName    string    `json:"agencyName"`
	PermitType    string    `json:"permitType,omitempty"`
	RequestedAt   time.Time `json:"requestedAt"`
}
