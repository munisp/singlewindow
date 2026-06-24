package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// FCMMessage is the FCM v1 HTTP API request body.
type FCMMessage struct {
	Message FCMPayload `json:"message"`
}

type FCMPayload struct {
	Token        string            `json:"token"`
	Notification FCMNotification   `json:"notification"`
	Data         map[string]string `json:"data,omitempty"`
}

type FCMNotification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// FCMClient sends push notifications via FCM v1 HTTP API.
type FCMClient struct {
	ProjectID  string
	HTTPClient HTTPDoer
}

// HTTPDoer is an interface for making HTTP requests (injectable for testing).
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

func NewFCMClient(projectID string) *FCMClient {
	return &FCMClient{
		ProjectID:  projectID,
		HTTPClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// Send dispatches a push notification to a single FCM device token.
func (c *FCMClient) Send(ctx context.Context, token, title, body string, data map[string]string) error {
	msg := FCMMessage{
		Message: FCMPayload{
			Token:        token,
			Notification: FCMNotification{Title: title, Body: body},
			Data:         data,
		},
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("fcm: marshal: %w", err)
	}
	url := fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", c.ProjectID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("fcm: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("fcm: do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("fcm: HTTP %d", resp.StatusCode)
	}
	return nil
}
