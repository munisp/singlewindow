// Package pubsub handles Dapr pub/sub event subscriptions for profile-service.
package pubsub

import (
"context"
"encoding/json"
"log"
)

// TraderRegisteredEvent is published when a new trader registers.
type TraderRegisteredEvent struct {
TraderID  string `json:"traderId"`
CompanyName string `json:"companyName"`
Email     string `json:"email"`
Timestamp int64  `json:"timestamp"`
}

// HandleTraderRegistered processes the trader.registered event.
func HandleTraderRegistered(ctx context.Context, data []byte) error {
var event TraderRegisteredEvent
if err := json.Unmarshal(data, &event); err != nil {
 err
}
log.Printf("[profile-service] New trader registered: %s (%s)", event.CompanyName, event.TraderID)
// In production: create default profile, send welcome email, trigger KYC workflow
return nil
}

// KYCCompletedEvent is published when KYC verification completes.
type KYCCompletedEvent struct {
TraderID string `json:"traderId"`
Status   string `json:"status"` // APPROVED | REJECTED | PENDING_REVIEW
Score    int    `json:"score"`
}

// HandleKYCCompleted processes the kyc.completed event.
func HandleKYCCompleted(ctx context.Context, data []byte) error {
var event KYCCompletedEvent
if err := json.Unmarshal(data, &event); err != nil {
 err
}
log.Printf("[profile-service] KYC completed for trader %s: %s (score: %d)", event.TraderID, event.Status, event.Score)
// In production: update trader profile status, trigger AEO eligibility check
return nil
}
