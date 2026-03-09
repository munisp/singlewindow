// pubsub — Dapr pub/sub client for oga-service
package pubsub

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const PubSubName = "kafka-pubsub"

type Client struct {
	daprPort string
	http     *http.Client
}

func New(daprPort string) *Client {
	return &Client{
		daprPort: daprPort,
		http:     &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *Client) Publish(ctx context.Context, topic string, data interface{}) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", c.daprPort, PubSubName, topic)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("dapr publish (topic=%s): %w", topic, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("dapr publish failed (topic=%s, status=%d)", topic, resp.StatusCode)
	}
	return nil
}

// ── Event payloads ────────────────────────────────────────────────────────────

type PermitApprovedEvent struct {
	PermitId      int64     `json:"permitId"`
	DeclarationId int64     `json:"declarationId"`
	AgencyCode    string    `json:"agencyCode"`
	AgencyName    string    `json:"agencyName"`
	PermitRef     string    `json:"permitRef"`
	ApprovedBy    string    `json:"approvedBy"`
	ApprovedAt    time.Time `json:"approvedAt"`
}

type PermitRejectedEvent struct {
	PermitId      int64     `json:"permitId"`
	DeclarationId int64     `json:"declarationId"`
	AgencyCode    string    `json:"agencyCode"`
	AgencyName    string    `json:"agencyName"`
	Reason        string    `json:"reason"`
	RejectedBy    string    `json:"rejectedBy"`
	RejectedAt    time.Time `json:"rejectedAt"`
}

type SLABreachEvent struct {
	PermitId      int64     `json:"permitId"`
	DeclarationId int64     `json:"declarationId"`
	AgencyCode    string    `json:"agencyCode"`
	SLADeadline   time.Time `json:"slaDeadline"`
	HoursOverdue  float64   `json:"hoursOverdue"`
	DetectedAt    time.Time `json:"detectedAt"`
}
