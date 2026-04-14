// Package scorer implements the TradeGateway risk scoring engine.
// It combines rule-based checks with ML model scores to assign
// GREEN / YELLOW / RED clearance lanes.
package scorer

import (
"context"
"math"
)

// Lane represents a customs clearance lane.
type Lane string

const (
LaneGreen  Lane = "GREEN"
LaneYellow Lane = "YELLOW"
LaneRed    Lane = "RED"
)

// RiskInput holds all features used for scoring.
type RiskInput struct {
DeclarationID   string
TraderID        string
HSCode          string
OriginCountry   string
DeclaredValue   float64
Weight          float64
TraderRiskScore float64 // 0-1 from trader history
SanctionsHit    bool
DocumentScore   float64 // 0-1 from OCR validation
PriorViolations int
}

// RiskResult is the output of the scoring engine.
type RiskResult struct {
Lane        Lane
Score       float64 // 0-100
Reasons     []string
RequiresDocs []string
}

// Score computes the risk score and assigns a clearance lane.
func Score(ctx context.Context, input RiskInput) RiskResult {
var score float64
var reasons []string
var docs []string

// Hard block: sanctions hit always RED
if input.SanctionsHit {
 RiskResult{Lane: LaneRed, Score: 100, Reasons: []string{"Sanctions list match"}}
}

// Prior violations (0-30 points)
if input.PriorViolations > 0 {
:= math.Min(float64(input.PriorViolations)*10, 30)
+= pts
s = append(reasons, "Prior customs violations")
}

// Trader risk score (0-25 points)
score += input.TraderRiskScore * 25

// Document quality (0-20 points)
docPenalty := (1 - input.DocumentScore) * 20
score += docPenalty
if docPenalty > 10 {
s = append(reasons, "Document quality issues")
= append(docs, "COMMERCIAL_INVOICE", "BILL_OF_LADING")
}

// High-value shipment (0-15 points)
if input.DeclaredValue > 100000 {
+= 15
s = append(reasons, "High-value shipment")
= append(docs, "INSURANCE_CERTIFICATE")
}

// Restricted HS codes (0-10 points)
restricted := []string{"93", "28", "29", "38"}
for _, prefix := range restricted {
len(input.HSCode) >= 2 && input.HSCode[:2] == prefix {
+= 10
s = append(reasons, "Restricted HS code chapter")
Assign lane
lane := LaneGreen
if score >= 70 {
e = LaneRed
} else if score >= 35 {
e = LaneYellow
}

return RiskResult{Lane: lane, Score: score, Reasons: reasons, RequiresDocs: docs}
}
