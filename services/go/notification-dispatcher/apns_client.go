package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// APNsPayload is the APNs HTTP/2 request body.
type APNsPayload struct {
	Aps APNsAps `json:"aps"`
}

type APNsAps struct {
	Alert APNsAlert `json:"alert"`
	Sound string    `json:"sound,omitempty"`
	Badge *int      `json:"badge,omitempty"`
}

type APNsAlert struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// APNsClient sends push notifications via APNs HTTP/2 API.
type APNsClient struct {
	BundleID   string
	HTTPClient HTTPDoer
}

func NewAPNsClient(bundleID string) *APNsClient {
	return &APNsClient{
		BundleID:   bundleID,
		HTTPClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// Send dispatches a push notification to a single APNs device token.
func (c *APNsClient) Send(ctx context.Context, token, title, body string) error {
	payload := APNsPayload{
		Aps: APNsAps{
			Alert: APNsAlert{Title: title, Body: body},
			Sound: "default",
		},
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("apns: marshal: %w", err)
	}
	url := fmt.Sprintf("https://api.push.apple.com/3/device/%s", token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("apns: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apns-topic", c.BundleID)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("apns: do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("apns: HTTP %d", resp.StatusCode)
	}
	return nil
}
