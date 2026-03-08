// Package workflows — shared type definitions used by both the workflow
// orchestration layer and the activity implementations.
package workflows

import "time"

// ─── SANCTIONS TYPES ─────────────────────────────────────────────────────────

type SanctionsInput struct {
	TraderID    string `json:"trader_id"`
	CountryCode string `json:"country_code"`
	UCR         string `json:"ucr"`
}

type SanctionsResult struct {
	IsBlocked bool   `json:"is_blocked"`
	Reason    string `json:"reason"`
	MatchedOn string `json:"matched_on"`
}

// ─── RISK SCORING TYPES ───────────────────────────────────────────────────────

type RiskInput struct {
	DeclarationID    int64   `json:"declaration_id"`
	HSCode           string  `json:"hs_code"`
	CountryOfOrigin  string  `json:"country_of_origin"`
	InvoiceValue     float64 `json:"invoice_value"`
	GoodsDescription string  `json:"goods_description"`
	DeclarationType  string  `json:"declaration_type"`
	IsAEO            bool    `json:"is_aeo"`
}

type RiskScoringResult struct {
	Score   int                      `json:"score"`
	Lane    string                   `json:"lane"`
	Factors []map[string]interface{} `json:"factors"`
	Summary string                   `json:"summary"`
}

// ─── OGA ROUTING TYPES ────────────────────────────────────────────────────────

type OGARoutingInput struct {
	DeclarationID    int64  `json:"declaration_id"`
	HSCode           string `json:"hs_code"`
	GoodsDescription string `json:"goods_description"`
	CountryOfOrigin  string `json:"country_of_origin"`
}

type OGARoutingResult struct {
	RequiredOGAs []string `json:"required_ogas"`
}

type OGAApprovalInput struct {
	DeclarationID int64  `json:"declaration_id"`
	OGACode       string `json:"oga_code"`
	Lane          string `json:"lane"`
}

type OGAApprovalResult struct {
	OGACode  string `json:"oga_code"`
	Approved bool   `json:"approved"`
	Rejected bool   `json:"rejected"`
	Reason   string `json:"reason"`
}

// ─── INSPECTION TYPES ─────────────────────────────────────────────────────────

type InspectionInput struct {
	DeclarationID int64  `json:"declaration_id"`
	UCR           string `json:"ucr"`
}

type InspectionResult struct {
	Passed bool   `json:"passed"`
	Failed bool   `json:"failed"`
	Reason string `json:"reason"`
}

// ─── DUTY TYPES ───────────────────────────────────────────────────────────────

type DutyInput struct {
	DeclarationID   int64   `json:"declaration_id"`
	HSCode          string  `json:"hs_code"`
	InvoiceValue    float64 `json:"invoice_value"`
	CountryOfOrigin string  `json:"country_of_origin"`
}

type DutyCalculationResult struct {
	ImportDuty float64 `json:"import_duty"`
	VAT        float64 `json:"vat"`
	Levy       float64 `json:"levy"`
	TotalDuty  float64 `json:"total_duty"`
	Currency   string  `json:"currency"`
}

// ─── STATUS UPDATE TYPES ──────────────────────────────────────────────────────

type StatusUpdateInput struct {
	DeclarationID int64  `json:"declaration_id"`
	Status        string `json:"status"`
	Message       string `json:"message"`
}

// ─── PERMIT TYPES ─────────────────────────────────────────────────────────────

type PermitInput struct {
	DeclarationID int64  `json:"declaration_id"`
	UCR           string `json:"ucr"`
	TraderID      string `json:"trader_id"`
	PaymentRef    string `json:"payment_ref"`
	Lane          string `json:"lane"`
}

type PermitResult struct {
	PermitNumber string    `json:"permit_number"`
	IssuedAt     time.Time `json:"issued_at"`
}
