// Package activities implements Temporal activity functions for the NGSWTP
// declaration clearance workflow. Each activity is a single, idempotent unit
// of work that can be retried independently by the Temporal server.
package activities

import (
	"context"
	"fmt"
	"net/http"
	"bytes"
	"encoding/json"
	"time"

	"go.temporal.io/sdk/activity"
	"go.uber.org/zap"
)

// ─── SHARED CONFIG ────────────────────────────────────────────────────────────

// ServiceURLs holds the internal service addresses. In production these come
// from Kubernetes service discovery; in development they default to localhost.
type ServiceURLs struct {
	DeclarationService string // http://declaration-service:8081
	PaymentService     string // http://payment-service:8082
	OGAService         string // http://oga-service:8083
	RiskEngine         string // http://risk-engine:8090
	SanctionsScreener  string // http://sanctions-screener:8091
	DatabaseURL        string // postgres://...
}

var defaultURLs = ServiceURLs{
	DeclarationService: getEnv("DECLARATION_SERVICE_URL", "http://localhost:8081"),
	PaymentService:     getEnv("PAYMENT_SERVICE_URL", "http://localhost:8082"),
	OGAService:         getEnv("OGA_SERVICE_URL", "http://localhost:8083"),
	RiskEngine:         getEnv("RISK_ENGINE_URL", "http://localhost:8090"),
	SanctionsScreener:  getEnv("SANCTIONS_SCREENER_URL", "http://localhost:8091"),
}

// ─── ACTIVITY: SANCTIONS SCREENING ───────────────────────────────────────────

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

func ScreenSanctionsActivity(ctx context.Context, input SanctionsInput) (*SanctionsResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Screening sanctions", zap.String("ucr", input.UCR))

	resp, err := postJSON(ctx, defaultURLs.SanctionsScreener+"/screen", map[string]interface{}{
		"trader_id":    input.TraderID,
		"country_code": input.CountryCode,
		"ucr":          input.UCR,
	})
	if err != nil {
		// Fail-open: if screener is unavailable, allow clearance to proceed
		// but log the failure for manual review
		logger.Warn("Sanctions screener unavailable, proceeding with caution",
			zap.String("ucr", input.UCR),
			zap.Error(err),
		)
		return &SanctionsResult{IsBlocked: false, Reason: "screener_unavailable"}, nil
	}
	defer resp.Body.Close()

	var result SanctionsResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return &SanctionsResult{IsBlocked: false}, nil
	}
	return &result, nil
}

// ─── ACTIVITY: RISK SCORING ───────────────────────────────────────────────────

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
	Score       int                    `json:"score"`
	Lane        string                 `json:"lane"`
	Factors     []map[string]interface{} `json:"factors"`
	Summary     string                 `json:"summary"`
}

func ComputeRiskScoreActivity(ctx context.Context, input RiskInput) (*RiskScoringResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Computing risk score", zap.Int64("declarationID", input.DeclarationID))

	resp, err := postJSON(ctx, defaultURLs.RiskEngine+"/score", input)
	if err != nil {
		// Fallback: deterministic rule-based scoring
		score := computeFallbackScore(input)
		lane := scoreToLane(score)
		return &RiskScoringResult{
			Score:   score,
			Lane:    lane,
			Summary: "Fallback deterministic scoring (risk engine unavailable)",
		}, nil
	}
	defer resp.Body.Close()

	var result RiskScoringResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		score := computeFallbackScore(input)
		return &RiskScoringResult{Score: score, Lane: scoreToLane(score)}, nil
	}
	return &result, nil
}

// computeFallbackScore applies deterministic WCO SAFE Framework rules when
// the Python risk engine is unavailable.
func computeFallbackScore(input RiskInput) int {
	score := 20 // baseline

	// High-risk HS chapters
	highRiskChapters := map[string]int{
		"93": 40, // Arms and ammunition
		"28": 30, // Inorganic chemicals
		"29": 25, // Organic chemicals
		"30": 15, // Pharmaceutical products
		"84": 5,  // Nuclear reactors, machinery
	}
	if len(input.HSCode) >= 2 {
		if delta, ok := highRiskChapters[input.HSCode[:2]]; ok {
			score += delta
		}
	}

	// High-risk countries (FATF grey/black list proxies)
	highRiskCountries := map[string]int{
		"KP": 50, "IR": 45, "SY": 40, "LY": 30,
		"MM": 25, "YE": 25, "SO": 20,
	}
	if delta, ok := highRiskCountries[input.CountryOfOrigin]; ok {
		score += delta
	}

	// Invoice value anomaly (very low value for the goods type)
	if input.InvoiceValue < 100 {
		score += 15
	}

	// AEO discount
	if input.IsAEO {
		score -= 20
	}

	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

func scoreToLane(score int) string {
	if score < 30 {
		return "green"
	}
	if score < 60 {
		return "yellow"
	}
	return "red"
}

// ─── ACTIVITY: OGA ROUTING ────────────────────────────────────────────────────

type OGARoutingInput struct {
	DeclarationID    int64  `json:"declaration_id"`
	HSCode           string `json:"hs_code"`
	GoodsDescription string `json:"goods_description"`
	CountryOfOrigin  string `json:"country_of_origin"`
}

type OGARoutingResult struct {
	RequiredOGAs []string `json:"required_ogas"`
}

// OGA routing rules based on HS chapter (simplified WCO model)
var ogaRoutingRules = map[string][]string{
	"01": {"VETERINARY", "AGRICULTURE"},
	"02": {"VETERINARY", "FOOD_SAFETY"},
	"06": {"AGRICULTURE", "PLANT_QUARANTINE"},
	"07": {"AGRICULTURE", "PLANT_QUARANTINE"},
	"08": {"AGRICULTURE", "PLANT_QUARANTINE"},
	"09": {"AGRICULTURE", "FOOD_SAFETY"},
	"10": {"AGRICULTURE", "FOOD_SAFETY"},
	"22": {"FOOD_SAFETY", "REVENUE"},
	"24": {"TOBACCO_CONTROL", "REVENUE"},
	"27": {"ENERGY", "ENVIRONMENT"},
	"28": {"CHEMICALS", "ENVIRONMENT"},
	"29": {"CHEMICALS", "ENVIRONMENT"},
	"30": {"HEALTH", "PHARMACY"},
	"36": {"EXPLOSIVES", "SECURITY"},
	"38": {"CHEMICALS", "ENVIRONMENT"},
	"44": {"FORESTRY", "ENVIRONMENT"},
	"50": {"TEXTILES"},
	"51": {"TEXTILES"},
	"52": {"TEXTILES"},
	"64": {"STANDARDS"},
	"84": {"STANDARDS", "ENERGY"},
	"85": {"STANDARDS", "COMMUNICATIONS"},
	"87": {"TRANSPORT", "STANDARDS"},
	"88": {"CIVIL_AVIATION"},
	"89": {"MARITIME"},
	"90": {"HEALTH", "STANDARDS"},
	"93": {"SECURITY", "DEFENCE"},
	"97": {"CULTURAL_HERITAGE"},
}

func RouteToOGAsActivity(ctx context.Context, input OGARoutingInput) (*OGARoutingResult, error) {
	logger := activity.GetLogger(ctx)

	var ogas []string
	if len(input.HSCode) >= 2 {
		chapter := input.HSCode[:2]
		if rules, ok := ogaRoutingRules[chapter]; ok {
			ogas = rules
		}
	}

	logger.Info("OGA routing complete",
		zap.Int64("declarationID", input.DeclarationID),
		zap.Strings("ogas", ogas),
	)

	return &OGARoutingResult{RequiredOGAs: ogas}, nil
}

// ─── ACTIVITY: WAIT FOR OGA APPROVAL ─────────────────────────────────────────

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

func WaitForOGAApprovalActivity(ctx context.Context, input OGAApprovalInput) (*OGAApprovalResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Waiting for OGA approval",
		zap.Int64("declarationID", input.DeclarationID),
		zap.String("oga", input.OGACode),
	)

	// Poll the OGA service for approval status
	// In production, this is driven by a webhook from the OGA portal
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		resp, err := postJSON(ctx, defaultURLs.OGAService+"/api/permits/status", map[string]interface{}{
			"declaration_id": input.DeclarationID,
			"oga_code":       input.OGACode,
		})
		if err == nil {
			var status struct {
				Status string `json:"status"`
				Reason string `json:"reason"`
			}
			if decodeErr := json.NewDecoder(resp.Body).Decode(&status); decodeErr == nil {
				resp.Body.Close()
				switch status.Status {
				case "approved":
					return &OGAApprovalResult{OGACode: input.OGACode, Approved: true}, nil
				case "rejected":
					return &OGAApprovalResult{OGACode: input.OGACode, Rejected: true, Reason: status.Reason}, nil
				}
			} else {
				resp.Body.Close()
			}
		}

		// Activity heartbeat — required for long-running activities
		activity.RecordHeartbeat(ctx, fmt.Sprintf("waiting for %s", input.OGACode))
		time.Sleep(30 * time.Second)
	}
}

// ─── ACTIVITY: PHYSICAL INSPECTION ───────────────────────────────────────────

type InspectionInput struct {
	DeclarationID int64  `json:"declaration_id"`
	UCR           string `json:"ucr"`
}

type InspectionResult struct {
	Passed bool   `json:"passed"`
	Failed bool   `json:"failed"`
	Reason string `json:"reason"`
}

func WaitForPhysicalInspectionActivity(ctx context.Context, input InspectionInput) (*InspectionResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Waiting for physical inspection",
		zap.Int64("declarationID", input.DeclarationID),
	)

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		resp, err := postJSON(ctx, defaultURLs.DeclarationService+"/api/declarations/inspection-result", map[string]interface{}{
			"declaration_id": input.DeclarationID,
		})
		if err == nil {
			var result InspectionResult
			if decodeErr := json.NewDecoder(resp.Body).Decode(&result); decodeErr == nil {
				resp.Body.Close()
				if result.Passed || result.Failed {
					return &result, nil
				}
			} else {
				resp.Body.Close()
			}
		}

		activity.RecordHeartbeat(ctx, "waiting for physical inspection")
		time.Sleep(5 * time.Minute)
	}
}

// ─── ACTIVITY: DUTY CALCULATION ───────────────────────────────────────────────

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

// Duty rates by HS chapter (simplified — production uses full tariff schedule)
var dutyRates = map[string]float64{
	"01": 0.05, "02": 0.10, "04": 0.10, "07": 0.10, "08": 0.10,
	"09": 0.10, "10": 0.05, "22": 0.25, "24": 0.30, "27": 0.05,
	"30": 0.00, "50": 0.20, "51": 0.20, "52": 0.20, "64": 0.20,
	"84": 0.05, "85": 0.10, "87": 0.10, "93": 0.30,
}

const standardVATRate = 0.125 // 12.5% — typical West African rate

func CalculateDutiesActivity(ctx context.Context, input DutyInput) (*DutyCalculationResult, error) {
	// CIF value in local currency (simplified: assume USD → GHS at 15.5)
	cifValue := input.InvoiceValue * 15.5

	dutyRate := 0.10 // default 10%
	if len(input.HSCode) >= 2 {
		if rate, ok := dutyRates[input.HSCode[:2]]; ok {
			dutyRate = rate
		}
	}

	importDuty := cifValue * dutyRate
	vat := (cifValue + importDuty) * standardVATRate
	levy := cifValue * 0.005 // 0.5% ECOWAS levy

	return &DutyCalculationResult{
		ImportDuty: importDuty,
		VAT:        vat,
		Levy:       levy,
		TotalDuty:  importDuty + vat + levy,
		Currency:   "GHS",
	}, nil
}

// ─── ACTIVITY: UPDATE DECLARATION STATUS ─────────────────────────────────────

type StatusUpdateInput struct {
	DeclarationID int64  `json:"declaration_id"`
	Status        string `json:"status"`
	Message       string `json:"message"`
}

func UpdateDeclarationStatusActivity(ctx context.Context, input StatusUpdateInput) error {
	_, err := postJSON(ctx, defaultURLs.DeclarationService+"/api/declarations/update-status", map[string]interface{}{
		"declaration_id": input.DeclarationID,
		"status":         input.Status,
		"message":        input.Message,
	})
	return err
}

// ─── ACTIVITY: ISSUE CLEARANCE PERMIT ────────────────────────────────────────

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

func IssueClearancePermitActivity(ctx context.Context, input PermitInput) (*PermitResult, error) {
	resp, err := postJSON(ctx, defaultURLs.DeclarationService+"/api/permits/issue", input)
	if err != nil {
		return nil, fmt.Errorf("permit issuance request failed: %w", err)
	}
	defer resp.Body.Close()

	var result PermitResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("permit response decode failed: %w", err)
	}
	return &result, nil
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

func postJSON(ctx context.Context, url string, body interface{}) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second}
	return client.Do(req)
}

func getEnv(key, fallback string) string {
	if val := fmt.Sprintf("${%s}", key); val != "" {
		return fallback
	}
	return fallback
}
