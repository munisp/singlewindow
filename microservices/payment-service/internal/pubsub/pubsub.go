// pubsub — Dapr pub/sub client for payment-service
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

// Client is a Dapr pub/sub HTTP client
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
		return fmt.Errorf("marshal event: %w", err)
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

type PaymentConfirmedEvent struct {
	InvoiceId     int64     `json:"invoiceId"`
	DeclarationId int64     `json:"declarationId"`
	TraderId      int64     `json:"traderId"`
	Amount        float64   `json:"amount"`
	Currency      string    `json:"currency"`
	MojaloopTxID  string    `json:"mojaloopTxId"`
	TBTransferId  string    `json:"tbTransferId"`
	PaidAt        time.Time `json:"paidAt"`
}

type PaymentFailedEvent struct {
	InvoiceId     int64     `json:"invoiceId"`
	DeclarationId int64     `json:"declarationId"`
	Reason        string    `json:"reason"`
	FailedAt      time.Time `json:"failedAt"`
}

type DutyInvoiceCreatedEvent struct {
	InvoiceId     int64     `json:"invoiceId"`
	DeclarationId int64     `json:"declarationId"`
	TraderId      int64     `json:"traderId"`
	TotalAmount   float64   `json:"totalAmount"`
	Currency      string    `json:"currency"`
	DueDate       time.Time `json:"dueDate"`
	CreatedAt     time.Time `json:"createdAt"`
}
