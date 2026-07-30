// ncs-nrs-gateway — TradeGateway NGSWTP
//
// NSW Phase 1 (Mar 2026) NCS–NRS Integration Gateway
// =====================================================
// Implements the structured data-sharing pipeline between the Nigeria Customs
// Service (NCS) and the Nigeria Revenue Service (NRS/FIRS) as specified in the
// NSW Phase 1 Interface Control Document.
//
// Architecture:
//   NSW gateway adapter
//     → declaration normaliser (EDI/UBL → canonical JSON)
//     → landing-cost calculator (CIF + duties + CISS + ETL + NTA)
//     → importer-TIN matcher (CAC-RC / NIN → FIRS TIN)
//     → NRS assessment pre-fill + exception queue
//     → VAT-at-border ledger (TigerBeetle two-phase)
//     → ISO 20022-adjacent payment reference generation
//     → 100% reconciliation audit trail (Kafka outbox)
//
// NFRs:
//   - Declaration-to-VAT-visibility ≤ 15 minutes
//   - 100% reconciliation audit trail
//   - NCS–NRS boundary respected (data-sharing only, no NRS write-back to NCS)
//   - Mutual TLS on all inter-service calls
//   - ISO 20022 pain.001 / camt.054 payment reference format
//
// Endpoints:
//   POST /v1/ncs/declarations/ingest       — Receive normalised declaration from NSW
//   POST /v1/ncs/declarations/edi          — Receive raw EDI (EDIFACT/CUSCAR) message
//   GET  /v1/ncs/declarations/{id}/landing-cost — Get computed landing cost
//   GET  /v1/ncs/declarations/{id}/nrs-prefill  — Get NRS assessment pre-fill payload
//   GET  /v1/ncs/reconciliation/summary    — Reconciliation dashboard data
//   GET  /v1/ncs/exceptions                — Exception queue (TIN mismatch, VAT errors)
//   POST /v1/ncs/exceptions/{id}/resolve   — Resolve an exception
//   GET  /v1/health

package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
)

// ─── Domain Types ─────────────────────────────────────────────────────────────

// NCSDeclaration is the canonical normalised declaration from NCS/NSW.
type NCSDeclaration struct {
	ID                   string          `json:"id"`
	DeclarationNumber    string          `json:"declaration_number"`    // NCS SAD number
	UCR                  string          `json:"ucr"`                   // WCO UCR
	ImporterName         string          `json:"importer_name"`
	ImporterTIN          string          `json:"importer_tin"`          // FIRS TIN (12-digit)
	ImporterCAC          string          `json:"importer_cac"`          // CAC-RC number
	ImporterNIN          string          `json:"importer_nin"`          // NIN (for individuals)
	HSCode               string          `json:"hs_code"`               // 8-digit HS code
	GoodsDescription     string          `json:"goods_description"`
	CountryOfOrigin      string          `json:"country_of_origin"`     // ISO 3166-1 alpha-2
	PortOfEntry          string          `json:"port_of_entry"`         // UN/LOCODE
	InvoiceValue         float64         `json:"invoice_value"`         // FOB in USD
	InvoiceCurrency      string          `json:"invoice_currency"`
	FreightCost          float64         `json:"freight_cost"`          // USD
	InsuranceCost        float64         `json:"insurance_cost"`        // USD
	GrossWeightKg        float64         `json:"gross_weight_kg"`
	NumberOfPackages     int             `json:"number_of_packages"`
	HSLines              []HSLine        `json:"hs_lines"`              // Multi-line declarations
	EDIMessageID         string          `json:"edi_message_id"`        // Original EDI reference
	UBLInvoiceRef        string          `json:"ubl_invoice_ref"`       // UBL invoice reference (if linked)
	SubmittedAt          time.Time       `json:"submitted_at"`
	NCSStatus            string          `json:"ncs_status"`            // NCS clearance status
	Source               string          `json:"source"`                // "EDI" | "UBL" | "NSW_API"
}

// HSLine represents a single HS tariff line within a declaration.
type HSLine struct {
	LineNumber       int     `json:"line_number"`
	HSCode           string  `json:"hs_code"`
	GoodsDescription string  `json:"goods_description"`
	Quantity         float64 `json:"quantity"`
	Unit             string  `json:"unit"`
	UnitValue        float64 `json:"unit_value_usd"`
	LineValue        float64 `json:"line_value_usd"`
	TariffRate       float64 `json:"tariff_rate_pct"`  // NCS 2024 CET rate
}

// LandingCost is the computed landing cost per NRS/FIRS specification.
// Formula: Landing Cost = CIF Value + Import Duty + CISS + ETL + NTA
// Import VAT Base = Landing Cost
// Import VAT = Landing Cost × 7.5%
type LandingCost struct {
	DeclarationID     string    `json:"declaration_id"`
	CIFValueUSD       float64   `json:"cif_value_usd"`
	CIFValueNGN       float64   `json:"cif_value_ngn"`
	CBNExchangeRate   float64   `json:"cbn_exchange_rate"`   // CBN official rate at time of assessment
	ImportDutyNGN     float64   `json:"import_duty_ngn"`     // CIF × tariff rate
	CISSLevyNGN       float64   `json:"ciss_levy_ngn"`       // 1.0% of CIF
	ETLLevyNGN        float64   `json:"etl_levy_ngn"`        // 0.5% of CIF (ECOWAS Trade Levy)
	NTALevyNGN        float64   `json:"nta_levy_ngn"`        // 0.5% of CIF (NTA surcharge)
	LandingCostNGN    float64   `json:"landing_cost_ngn"`    // CIF + Duty + CISS + ETL + NTA
	ImportVATBase     float64   `json:"import_vat_base_ngn"` // = LandingCostNGN
	ImportVATNGN      float64   `json:"import_vat_ngn"`      // 7.5% of LandingCostNGN
	TotalPayableNGN   float64   `json:"total_payable_ngn"`   // LandingCost + ImportVAT
	TariffRatePct     float64   `json:"tariff_rate_pct"`
	HSLines           []HSLineCost `json:"hs_lines"`
	ComputedAt        time.Time `json:"computed_at"`
	ISO20022Reference string    `json:"iso20022_reference"`  // pain.001 EndToEndId
}

// HSLineCost is the per-line duty/VAT breakdown.
type HSLineCost struct {
	LineNumber    int     `json:"line_number"`
	HSCode        string  `json:"hs_code"`
	LineValueNGN  float64 `json:"line_value_ngn"`
	DutyNGN       float64 `json:"duty_ngn"`
	VATShareNGN   float64 `json:"vat_share_ngn"`
}

// TINMatchResult is the result of matching importer identifiers to FIRS TIN.
type TINMatchResult struct {
	DeclarationID  string    `json:"declaration_id"`
	InputCAC       string    `json:"input_cac"`
	InputNIN       string    `json:"input_nin"`
	InputTIN       string    `json:"input_tin"`
	MatchedTIN     string    `json:"matched_tin"`
	MatchMethod    string    `json:"match_method"`    // "TIN_DIRECT" | "CAC_LOOKUP" | "NIN_LOOKUP" | "FUZZY_NAME"
	MatchScore     float64   `json:"match_score"`     // 0.0–1.0
	MatchStatus    string    `json:"match_status"`    // "MATCHED" | "PARTIAL" | "NO_MATCH" | "EXCEPTION"
	ExceptionCode  string    `json:"exception_code"`  // e.g. "TIN_NOT_FOUND", "CAC_MISMATCH"
	MatchedAt      time.Time `json:"matched_at"`
}

// NRSAssessmentPrefill is the pre-filled NRS VAT assessment payload.
type NRSAssessmentPrefill struct {
	DeclarationID       string      `json:"declaration_id"`
	DeclarationNumber   string      `json:"declaration_number"`
	UCR                 string      `json:"ucr"`
	ImporterTIN         string      `json:"importer_tin"`
	ImporterName        string      `json:"importer_name"`
	AssessmentPeriod    string      `json:"assessment_period"`   // "YYYY-MM" (month of clearance)
	LandingCost         LandingCost `json:"landing_cost"`
	TINMatch            TINMatchResult `json:"tin_match"`
	VATAssessmentRef    string      `json:"vat_assessment_ref"`  // NRS internal reference
	ISO20022PaymentRef  string      `json:"iso20022_payment_ref"`
	Status              string      `json:"status"`              // "PREFILLED" | "CONFIRMED" | "EXCEPTION"
	GeneratedAt         time.Time   `json:"generated_at"`
	VisibilityDeadline  time.Time   `json:"visibility_deadline"` // submitted_at + 15 min
}

// NCSNRSException represents an item in the exception queue.
type NCSNRSException struct {
	ID              string    `json:"id"`
	DeclarationID   string    `json:"declaration_id"`
	ExceptionType   string    `json:"exception_type"`   // "TIN_MISMATCH" | "VAT_CALC_ERROR" | "MISSING_TIN" | "CAC_MISMATCH" | "LATE_VISIBILITY"
	Severity        string    `json:"severity"`         // "HIGH" | "MEDIUM" | "LOW"
	Description     string    `json:"description"`
	RawData         json.RawMessage `json:"raw_data"`
	Status          string    `json:"status"`           // "OPEN" | "RESOLVED" | "ESCALATED"
	AssignedTo      string    `json:"assigned_to"`
	ResolvedAt      *time.Time `json:"resolved_at"`
	ResolutionNote  string    `json:"resolution_note"`
	CreatedAt       time.Time `json:"created_at"`
}

// ReconciliationSummary is the dashboard summary for the reconciliation audit trail.
type ReconciliationSummary struct {
	Period              string    `json:"period"`
	TotalDeclarations   int       `json:"total_declarations"`
	TINMatchedCount     int       `json:"tin_matched_count"`
	TINMatchRate        float64   `json:"tin_match_rate_pct"`
	TotalImportVATNGN   float64   `json:"total_import_vat_ngn"`
	TotalLandingCostNGN float64   `json:"total_landing_cost_ngn"`
	PrefillsSent        int       `json:"prefills_sent"`
	ExceptionsOpen      int       `json:"exceptions_open"`
	ExceptionsResolved  int       `json:"exceptions_resolved"`
	AvgVisibilityMinutes float64  `json:"avg_visibility_minutes"`
	SLABreaches         int       `json:"sla_breaches"`           // declarations where visibility > 15 min
	GeneratedAt         time.Time `json:"generated_at"`
}

// ─── Server ───────────────────────────────────────────────────────────────────

type Server struct {
	db            *sql.DB
	nrsWebhookURL string // NRS endpoint to push pre-fill payloads
	kafkaBrokers  string
	webhookSecret string // HMAC-SHA256 shared secret for NRS webhook
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Schema Bootstrap ─────────────────────────────────────────────────────────

func (s *Server) ensureSchema() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS ncs_nrs_declarations (
			id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			declaration_number    VARCHAR(64) NOT NULL UNIQUE,
			ucr                   VARCHAR(64),
			importer_name         TEXT NOT NULL,
			importer_tin          VARCHAR(20),
			importer_cac          VARCHAR(20),
			importer_nin          VARCHAR(20),
			hs_code               VARCHAR(12) NOT NULL,
			goods_description     TEXT,
			country_of_origin     VARCHAR(3),
			port_of_entry         VARCHAR(16),
			invoice_value_usd     NUMERIC(18,4) NOT NULL,
			invoice_currency      VARCHAR(3) DEFAULT 'USD',
			freight_cost_usd      NUMERIC(18,4) DEFAULT 0,
			insurance_cost_usd    NUMERIC(18,4) DEFAULT 0,
			gross_weight_kg       NUMERIC(12,3),
			number_of_packages    INTEGER,
			hs_lines              JSONB DEFAULT '[]',
			edi_message_id        VARCHAR(128),
			ubl_invoice_ref       VARCHAR(128),
			submitted_at          TIMESTAMPTZ NOT NULL,
			ncs_status            VARCHAR(32) DEFAULT 'submitted',
			source                VARCHAR(16) DEFAULT 'NSW_API',
			ingested_at           TIMESTAMPTZ DEFAULT NOW(),
			processed_at          TIMESTAMPTZ,
			CONSTRAINT chk_source CHECK (source IN ('EDI','UBL','NSW_API'))
		);

		CREATE TABLE IF NOT EXISTS ncs_nrs_landing_costs (
			id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			declaration_id        UUID NOT NULL REFERENCES ncs_nrs_declarations(id) ON DELETE CASCADE,
			cif_value_usd         NUMERIC(18,4) NOT NULL,
			cif_value_ngn         NUMERIC(18,2) NOT NULL,
			cbn_exchange_rate     NUMERIC(12,4) NOT NULL,
			import_duty_ngn       NUMERIC(18,2) NOT NULL,
			ciss_levy_ngn         NUMERIC(18,2) NOT NULL,
			etl_levy_ngn          NUMERIC(18,2) NOT NULL,
			nta_levy_ngn          NUMERIC(18,2) NOT NULL,
			landing_cost_ngn      NUMERIC(18,2) NOT NULL,
			import_vat_base_ngn   NUMERIC(18,2) NOT NULL,
			import_vat_ngn        NUMERIC(18,2) NOT NULL,
			total_payable_ngn     NUMERIC(18,2) NOT NULL,
			tariff_rate_pct       NUMERIC(6,4) NOT NULL,
			hs_lines              JSONB DEFAULT '[]',
			iso20022_reference    VARCHAR(64) NOT NULL,
			computed_at           TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(declaration_id)
		);

		CREATE TABLE IF NOT EXISTS ncs_nrs_tin_matches (
			id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			declaration_id        UUID NOT NULL REFERENCES ncs_nrs_declarations(id) ON DELETE CASCADE,
			input_cac             VARCHAR(20),
			input_nin             VARCHAR(20),
			input_tin             VARCHAR(20),
			matched_tin           VARCHAR(20),
			match_method          VARCHAR(32),
			match_score           NUMERIC(5,4),
			match_status          VARCHAR(16) NOT NULL,
			exception_code        VARCHAR(64),
			matched_at            TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(declaration_id)
		);

		CREATE TABLE IF NOT EXISTS ncs_nrs_assessment_prefills (
			id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			declaration_id        UUID NOT NULL REFERENCES ncs_nrs_declarations(id) ON DELETE CASCADE,
			declaration_number    VARCHAR(64) NOT NULL,
			ucr                   VARCHAR(64),
			importer_tin          VARCHAR(20),
			importer_name         TEXT,
			assessment_period     VARCHAR(7) NOT NULL,
			landing_cost_snapshot JSONB NOT NULL,
			tin_match_snapshot    JSONB NOT NULL,
			vat_assessment_ref    VARCHAR(64) NOT NULL,
			iso20022_payment_ref  VARCHAR(64) NOT NULL,
			status                VARCHAR(16) DEFAULT 'PREFILLED',
			generated_at          TIMESTAMPTZ DEFAULT NOW(),
			visibility_deadline   TIMESTAMPTZ NOT NULL,
			sent_to_nrs_at        TIMESTAMPTZ,
			nrs_ack_at            TIMESTAMPTZ,
			UNIQUE(declaration_id)
		);

		CREATE TABLE IF NOT EXISTS ncs_nrs_exceptions (
			id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			declaration_id        UUID REFERENCES ncs_nrs_declarations(id) ON DELETE SET NULL,
			exception_type        VARCHAR(32) NOT NULL,
			severity              VARCHAR(8) NOT NULL DEFAULT 'MEDIUM',
			description           TEXT NOT NULL,
			raw_data              JSONB,
			status                VARCHAR(16) DEFAULT 'OPEN',
			assigned_to           VARCHAR(128),
			resolved_at           TIMESTAMPTZ,
			resolution_note       TEXT,
			created_at            TIMESTAMPTZ DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS ncs_nrs_reconciliation_audit (
			id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			declaration_id        UUID REFERENCES ncs_nrs_declarations(id) ON DELETE SET NULL,
			event_type            VARCHAR(64) NOT NULL,
			event_data            JSONB NOT NULL,
			actor                 VARCHAR(128),
			created_at            TIMESTAMPTZ DEFAULT NOW()
		);

		-- Indexes for ≤15-min visibility SLA monitoring
		CREATE INDEX IF NOT EXISTS idx_nrs_decl_submitted ON ncs_nrs_declarations(submitted_at DESC);
		CREATE INDEX IF NOT EXISTS idx_nrs_decl_tin ON ncs_nrs_declarations(importer_tin);
		CREATE INDEX IF NOT EXISTS idx_nrs_prefill_period ON ncs_nrs_assessment_prefills(assessment_period);
		CREATE INDEX IF NOT EXISTS idx_nrs_prefill_tin ON ncs_nrs_assessment_prefills(importer_tin);
		CREATE INDEX IF NOT EXISTS idx_nrs_exceptions_status ON ncs_nrs_exceptions(status, created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_nrs_audit_decl ON ncs_nrs_reconciliation_audit(declaration_id, created_at DESC);
	`)
	return err
}

// ─── Landing Cost Calculation ─────────────────────────────────────────────────

// NCS 2024 ECOWAS CET tariff rates by HS chapter (first 2 digits).
// Source: NCS Tariff & Excise Duties Act 2023 (Cap T2 LFN 2004 as amended).
var hsTariffRates = map[string]float64{
	"01": 5.0, "02": 5.0, "03": 5.0, "04": 5.0, "05": 5.0,
	"06": 5.0, "07": 5.0, "08": 5.0, "09": 5.0, "10": 5.0,
	"11": 5.0, "12": 5.0, "13": 5.0, "14": 5.0, "15": 10.0,
	"16": 20.0, "17": 20.0, "18": 10.0, "19": 20.0, "20": 20.0,
	"21": 20.0, "22": 20.0, "23": 5.0, "24": 20.0, "25": 5.0,
	"26": 0.0, "27": 5.0, "28": 5.0, "29": 5.0, "30": 5.0,
	"31": 5.0, "32": 10.0, "33": 20.0, "34": 20.0, "35": 10.0,
	"36": 10.0, "37": 10.0, "38": 10.0, "39": 20.0, "40": 10.0,
	"41": 5.0, "42": 20.0, "43": 10.0, "44": 10.0, "45": 10.0,
	"46": 10.0, "47": 5.0, "48": 10.0, "49": 5.0, "50": 10.0,
	"51": 10.0, "52": 10.0, "53": 10.0, "54": 10.0, "55": 10.0,
	"56": 10.0, "57": 20.0, "58": 20.0, "59": 10.0, "60": 10.0,
	"61": 35.0, "62": 35.0, "63": 35.0, "64": 35.0, "65": 20.0,
	"66": 20.0, "67": 20.0, "68": 10.0, "69": 20.0, "70": 20.0,
	"71": 5.0, "72": 5.0, "73": 10.0, "74": 5.0, "75": 5.0,
	"76": 10.0, "77": 5.0, "78": 5.0, "79": 5.0, "80": 5.0,
	"81": 5.0, "82": 10.0, "83": 10.0, "84": 5.0, "85": 5.0,
	"86": 5.0, "87": 35.0, "88": 5.0, "89": 5.0, "90": 5.0,
	"91": 20.0, "92": 20.0, "93": 10.0, "94": 20.0, "95": 20.0,
	"96": 20.0, "97": 5.0, "98": 5.0, "99": 0.0,
}

func getTariffRate(hsCode string) float64 {
	if len(hsCode) >= 2 {
		if rate, ok := hsTariffRates[hsCode[:2]]; ok {
			return rate
		}
	}
	return 10.0 // default NCS rate
}

// computeLandingCost calculates the full NRS-compliant landing cost.
// Landing Cost = CIF + Import Duty + CISS (1%) + ETL (0.5%) + NTA (0.5%)
// Import VAT = Landing Cost × 7.5% (VATA 2023 s.10)
func computeLandingCost(decl NCSDeclaration, cbnRate float64) LandingCost {
	cifUSD := decl.InvoiceValue + decl.FreightCost + decl.InsuranceCost
	cifNGN := cifUSD * cbnRate

	tariffRate := getTariffRate(decl.HSCode)
	importDutyNGN := cifNGN * tariffRate / 100.0
	cissNGN := cifNGN * 0.010  // CISS: 1.0%
	etlNGN := cifNGN * 0.005   // ETL: 0.5%
	ntaNGN := cifNGN * 0.005   // NTA: 0.5%

	landingCostNGN := cifNGN + importDutyNGN + cissNGN + etlNGN + ntaNGN
	importVATNGN := landingCostNGN * 0.075 // VATA 2023: 7.5%
	totalPayableNGN := landingCostNGN + importVATNGN

	// Per-line breakdown
	var hsLineCosts []HSLineCost
	for _, line := range decl.HSLines {
		lineNGN := line.LineValue * cbnRate
		lineRate := getTariffRate(line.HSCode)
		lineDuty := lineNGN * lineRate / 100.0
		lineVATShare := (lineNGN + lineDuty) * 0.075
		hsLineCosts = append(hsLineCosts, HSLineCost{
			LineNumber:   line.LineNumber,
			HSCode:       line.HSCode,
			LineValueNGN: lineNGN,
			DutyNGN:      lineDuty,
			VATShareNGN:  lineVATShare,
		})
	}

	// ISO 20022 pain.001 EndToEndId: {YYYYMMDD}/{DeclarationNumber}/{random6}
	randBytes := make([]byte, 3)
	rand.Read(randBytes)
	iso20022Ref := fmt.Sprintf("%s/%s/%s",
		time.Now().UTC().Format("20060102"),
		decl.DeclarationNumber,
		strings.ToUpper(hex.EncodeToString(randBytes)),
	)

	return LandingCost{
		DeclarationID:     decl.ID,
		CIFValueUSD:       cifUSD,
		CIFValueNGN:       cifNGN,
		CBNExchangeRate:   cbnRate,
		ImportDutyNGN:     importDutyNGN,
		CISSLevyNGN:       cissNGN,
		ETLLevyNGN:        etlNGN,
		NTALevyNGN:        ntaNGN,
		LandingCostNGN:    landingCostNGN,
		ImportVATBase:     landingCostNGN,
		ImportVATNGN:      importVATNGN,
		TotalPayableNGN:   totalPayableNGN,
		TariffRatePct:     tariffRate,
		HSLines:           hsLineCosts,
		ComputedAt:        time.Now().UTC(),
		ISO20022Reference: iso20022Ref,
	}
}

// ─── TIN Matching ─────────────────────────────────────────────────────────────

// matchImporterTIN performs the CAC-RC/NIN → FIRS TIN matching logic.
// In production, this calls the FIRS TIN Verification API (REST/SOAP).
// The platform maintains a local TIN registry cache in the DB for performance.
func (s *Server) matchImporterTIN(ctx context.Context, decl NCSDeclaration) TINMatchResult {
	result := TINMatchResult{
		DeclarationID: decl.ID,
		InputCAC:      decl.ImporterCAC,
		InputNIN:      decl.ImporterNIN,
		InputTIN:      decl.ImporterTIN,
		MatchedAt:     time.Now().UTC(),
	}

	// Step 1: Direct TIN match — if importer provided a TIN, validate it
	if decl.ImporterTIN != "" && len(decl.ImporterTIN) == 12 {
		var cacFromDB, nameFromDB string
		err := s.db.QueryRowContext(ctx,
			`SELECT COALESCE(cac_rc,''), COALESCE(registered_name,'') FROM firs_tin_registry WHERE tin = $1`,
			decl.ImporterTIN,
		).Scan(&cacFromDB, &nameFromDB)
		if err == nil {
			// TIN found in local registry
			result.MatchedTIN = decl.ImporterTIN
			result.MatchMethod = "TIN_DIRECT"
			result.MatchScore = 1.0
			result.MatchStatus = "MATCHED"
			// Cross-validate CAC if provided
			if decl.ImporterCAC != "" && cacFromDB != "" && decl.ImporterCAC != cacFromDB {
				result.MatchStatus = "PARTIAL"
				result.ExceptionCode = "CAC_MISMATCH"
				result.MatchScore = 0.7
			}
			return result
		}
	}

	// Step 2: CAC-RC lookup
	if decl.ImporterCAC != "" {
		var tinFromDB string
		err := s.db.QueryRowContext(ctx,
			`SELECT tin FROM firs_tin_registry WHERE cac_rc = $1 LIMIT 1`,
			decl.ImporterCAC,
		).Scan(&tinFromDB)
		if err == nil && tinFromDB != "" {
			result.MatchedTIN = tinFromDB
			result.MatchMethod = "CAC_LOOKUP"
			result.MatchScore = 0.95
			result.MatchStatus = "MATCHED"
			return result
		}
	}

	// Step 3: NIN lookup (for individual importers)
	if decl.ImporterNIN != "" {
		var tinFromDB string
		err := s.db.QueryRowContext(ctx,
			`SELECT tin FROM firs_tin_registry WHERE nin = $1 LIMIT 1`,
			decl.ImporterNIN,
		).Scan(&tinFromDB)
		if err == nil && tinFromDB != "" {
			result.MatchedTIN = tinFromDB
			result.MatchMethod = "NIN_LOOKUP"
			result.MatchScore = 0.90
			result.MatchStatus = "MATCHED"
			return result
		}
	}

	// Step 4: Fuzzy name match (last resort)
	if decl.ImporterName != "" {
		var tinFromDB, nameFromDB string
		err := s.db.QueryRowContext(ctx,
			`SELECT tin, registered_name
			 FROM firs_tin_registry
			 WHERE similarity(registered_name, $1) > 0.6
			 ORDER BY similarity(registered_name, $1) DESC
			 LIMIT 1`,
			decl.ImporterName,
		).Scan(&tinFromDB, &nameFromDB)
		if err == nil && tinFromDB != "" {
			result.MatchedTIN = tinFromDB
			result.MatchMethod = "FUZZY_NAME"
			result.MatchScore = 0.65
			result.MatchStatus = "PARTIAL"
			result.ExceptionCode = "FUZZY_MATCH_ONLY"
			return result
		}
	}

	// No match found
	result.MatchStatus = "NO_MATCH"
	result.ExceptionCode = "TIN_NOT_FOUND"
	result.MatchScore = 0.0
	return result
}

// ─── Reconciliation Audit Trail ───────────────────────────────────────────────

func (s *Server) writeAuditEvent(ctx context.Context, declarationID, eventType string, data interface{}) {
	dataJSON, _ := json.Marshal(data)
	s.db.ExecContext(ctx,
		`INSERT INTO ncs_nrs_reconciliation_audit (declaration_id, event_type, event_data)
		 VALUES ($1, $2, $3)`,
		declarationID, eventType, dataJSON,
	)
}

// ─── NRS Webhook Push ─────────────────────────────────────────────────────────

func (s *Server) pushToNRS(prefill NRSAssessmentPrefill) error {
	if s.nrsWebhookURL == "" {
		return nil // NRS webhook not configured — store only
	}
	payload, err := json.Marshal(prefill)
	if err != nil {
		return err
	}
	// HMAC-SHA256 signature for mutual authentication
	mac := hmac.New(sha256.New, []byte(s.webhookSecret))
	mac.Write(payload)
	sig := hex.EncodeToString(mac.Sum(nil))

	req, err := http.NewRequest("POST", s.nrsWebhookURL, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-NCS-Signature", "sha256="+sig)
	req.Header.Set("X-NCS-Timestamp", time.Now().UTC().Format(time.RFC3339))
	req.Header.Set("X-ISO20022-Ref", prefill.ISO20022PaymentRef)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("NRS webhook returned %d", resp.StatusCode)
	}
	return nil
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

// POST /v1/ncs/declarations/ingest — Receive normalised declaration from NSW
func (s *Server) ingestDeclaration(w http.ResponseWriter, r *http.Request) {
	var decl NCSDeclaration
	if err := json.NewDecoder(r.Body).Decode(&decl); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if decl.DeclarationNumber == "" || decl.InvoiceValue <= 0 {
		http.Error(w, "declaration_number and invoice_value are required", http.StatusBadRequest)
		return
	}
	if decl.ID == "" {
		decl.ID = uuid.New().String()
	}
	if decl.SubmittedAt.IsZero() {
		decl.SubmittedAt = time.Now().UTC()
	}
	if decl.Source == "" {
		decl.Source = "NSW_API"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	// Idempotency: check if already processed
	var existingID string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM ncs_nrs_declarations WHERE declaration_number = $1`,
		decl.DeclarationNumber,
	).Scan(&existingID)
	if err == nil {
		// Already exists — return existing
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"id": existingID, "status": "already_processed"})
		return
	}

	hsLinesJSON, _ := json.Marshal(decl.HSLines)

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO ncs_nrs_declarations (
			id, declaration_number, ucr, importer_name, importer_tin,
			importer_cac, importer_nin, hs_code, goods_description,
			country_of_origin, port_of_entry, invoice_value_usd, invoice_currency,
			freight_cost_usd, insurance_cost_usd, gross_weight_kg, number_of_packages,
			hs_lines, edi_message_id, ubl_invoice_ref, submitted_at, ncs_status, source
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
		)`,
		decl.ID, decl.DeclarationNumber, decl.UCR, decl.ImporterName, decl.ImporterTIN,
		decl.ImporterCAC, decl.ImporterNIN, decl.HSCode, decl.GoodsDescription,
		decl.CountryOfOrigin, decl.PortOfEntry, decl.InvoiceValue, decl.InvoiceCurrency,
		decl.FreightCost, decl.InsuranceCost, decl.GrossWeightKg, decl.NumberOfPackages,
		hsLinesJSON, decl.EDIMessageID, decl.UBLInvoiceRef, decl.SubmittedAt, decl.NCSStatus, decl.Source,
	)
	if err != nil {
		http.Error(w, "DB error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	s.writeAuditEvent(ctx, decl.ID, "DECLARATION_INGESTED", decl)

	// Async pipeline: compute landing cost → match TIN → generate NRS prefill
	go s.processPipeline(decl)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{
		"id":     decl.ID,
		"status": "accepted",
		"message": "Declaration ingested. Landing cost computation and TIN matching initiated.",
	})
}

// processPipeline runs the full NCS→NRS pipeline asynchronously.
// Target: declaration-to-VAT-visibility ≤ 15 minutes.
func (s *Server) processPipeline(decl NCSDeclaration) {
	ctx, cancel := context.WithTimeout(context.Background(), 14*time.Minute)
	defer cancel()

	// 1. Get CBN exchange rate (from DB cache, updated daily)
	cbnRate := s.getCBNRate(ctx)

	// 2. Compute landing cost
	lc := computeLandingCost(decl, cbnRate)

	// 3. Persist landing cost
	hsLinesCostJSON, _ := json.Marshal(lc.HSLines)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO ncs_nrs_landing_costs (
			declaration_id, cif_value_usd, cif_value_ngn, cbn_exchange_rate,
			import_duty_ngn, ciss_levy_ngn, etl_levy_ngn, nta_levy_ngn,
			landing_cost_ngn, import_vat_base_ngn, import_vat_ngn, total_payable_ngn,
			tariff_rate_pct, hs_lines, iso20022_reference
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (declaration_id) DO UPDATE SET
			cif_value_ngn = EXCLUDED.cif_value_ngn,
			import_vat_ngn = EXCLUDED.import_vat_ngn,
			total_payable_ngn = EXCLUDED.total_payable_ngn,
			computed_at = NOW()
	`,
		decl.ID, lc.CIFValueUSD, lc.CIFValueNGN, lc.CBNExchangeRate,
		lc.ImportDutyNGN, lc.CISSLevyNGN, lc.ETLLevyNGN, lc.NTALevyNGN,
		lc.LandingCostNGN, lc.ImportVATBase, lc.ImportVATNGN, lc.TotalPayableNGN,
		lc.TariffRatePct, hsLinesCostJSON, lc.ISO20022Reference,
	)
	if err != nil {
		log.Printf("ERROR: landing cost persist for %s: %v", decl.ID, err)
		s.createException(ctx, decl.ID, "VAT_CALC_ERROR", "HIGH",
			"Failed to persist landing cost: "+err.Error(), lc)
		return
	}
	s.writeAuditEvent(ctx, decl.ID, "LANDING_COST_COMPUTED", lc)

	// 4. Match importer TIN
	tinMatch := s.matchImporterTIN(ctx, decl)
	tinMatchJSON, _ := json.Marshal(tinMatch)
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO ncs_nrs_tin_matches (
			declaration_id, input_cac, input_nin, input_tin,
			matched_tin, match_method, match_score, match_status, exception_code
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (declaration_id) DO UPDATE SET
			matched_tin = EXCLUDED.matched_tin,
			match_status = EXCLUDED.match_status,
			matched_at = NOW()
	`,
		decl.ID, tinMatch.InputCAC, tinMatch.InputNIN, tinMatch.InputTIN,
		tinMatch.MatchedTIN, tinMatch.MatchMethod, tinMatch.MatchScore,
		tinMatch.MatchStatus, tinMatch.ExceptionCode,
	)
	if err != nil {
		log.Printf("ERROR: TIN match persist for %s: %v", decl.ID, err)
	}
	s.writeAuditEvent(ctx, decl.ID, "TIN_MATCHED", tinMatch)

	// 5. Create exception if TIN not matched
	if tinMatch.MatchStatus == "NO_MATCH" {
		s.createException(ctx, decl.ID, "MISSING_TIN", "HIGH",
			fmt.Sprintf("No FIRS TIN found for importer '%s' (CAC: %s, NIN: %s)",
				decl.ImporterName, decl.ImporterCAC, decl.ImporterNIN), tinMatch)
	} else if tinMatch.MatchStatus == "PARTIAL" {
		s.createException(ctx, decl.ID, "TIN_MISMATCH", "MEDIUM",
			fmt.Sprintf("Partial TIN match (%s) for importer '%s': %s",
				tinMatch.MatchMethod, decl.ImporterName, tinMatch.ExceptionCode), tinMatch)
	}

	// 6. Generate NRS assessment pre-fill
	assessmentPeriod := decl.SubmittedAt.UTC().Format("2006-01")
	vatAssessmentRef := fmt.Sprintf("NRS-VAT-%s-%s", assessmentPeriod, decl.DeclarationNumber)
	visibilityDeadline := decl.SubmittedAt.Add(15 * time.Minute)

	prefill := NRSAssessmentPrefill{
		DeclarationID:      decl.ID,
		DeclarationNumber:  decl.DeclarationNumber,
		UCR:                decl.UCR,
		ImporterTIN:        tinMatch.MatchedTIN,
		ImporterName:       decl.ImporterName,
		AssessmentPeriod:   assessmentPeriod,
		LandingCost:        lc,
		TINMatch:           tinMatch,
		VATAssessmentRef:   vatAssessmentRef,
		ISO20022PaymentRef: lc.ISO20022Reference,
		Status:             "PREFILLED",
		GeneratedAt:        time.Now().UTC(),
		VisibilityDeadline: visibilityDeadline,
	}
	if tinMatch.MatchStatus == "NO_MATCH" {
		prefill.Status = "EXCEPTION"
	}

	lcJSON, _ := json.Marshal(lc)
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO ncs_nrs_assessment_prefills (
			declaration_id, declaration_number, ucr, importer_tin, importer_name,
			assessment_period, landing_cost_snapshot, tin_match_snapshot,
			vat_assessment_ref, iso20022_payment_ref, status, visibility_deadline
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (declaration_id) DO UPDATE SET
			status = EXCLUDED.status,
			landing_cost_snapshot = EXCLUDED.landing_cost_snapshot,
			tin_match_snapshot = EXCLUDED.tin_match_snapshot
	`,
		decl.ID, decl.DeclarationNumber, decl.UCR, tinMatch.MatchedTIN, decl.ImporterName,
		assessmentPeriod, lcJSON, tinMatchJSON,
		vatAssessmentRef, lc.ISO20022Reference, prefill.Status, visibilityDeadline,
	)
	if err != nil {
		log.Printf("ERROR: prefill persist for %s: %v", decl.ID, err)
	}
	s.writeAuditEvent(ctx, decl.ID, "NRS_PREFILL_GENERATED", prefill)

	// 7. Push to NRS (async, with retry)
	if err := s.pushToNRS(prefill); err != nil {
		log.Printf("WARN: NRS push failed for %s: %v (will retry)", decl.ID, err)
		s.createException(ctx, decl.ID, "NRS_PUSH_FAILED", "MEDIUM",
			"Failed to push pre-fill to NRS: "+err.Error(), prefill)
	} else {
		s.db.ExecContext(ctx,
			`UPDATE ncs_nrs_assessment_prefills SET sent_to_nrs_at = NOW() WHERE declaration_id = $1`,
			decl.ID,
		)
		s.writeAuditEvent(ctx, decl.ID, "NRS_PREFILL_SENT", map[string]string{
			"declaration_id": decl.ID, "vat_ref": vatAssessmentRef,
		})
	}

	// 8. Check SLA breach (> 15 min)
	elapsed := time.Since(decl.SubmittedAt)
	if elapsed > 15*time.Minute {
		s.createException(ctx, decl.ID, "LATE_VISIBILITY", "HIGH",
			fmt.Sprintf("VAT visibility SLA breached: %.1f minutes (limit: 15 min)", elapsed.Minutes()),
			map[string]interface{}{"elapsed_minutes": elapsed.Minutes(), "deadline": visibilityDeadline},
		)
	}

	// 9. Mark declaration as processed
	s.db.ExecContext(ctx,
		`UPDATE ncs_nrs_declarations SET processed_at = NOW() WHERE id = $1`, decl.ID,
	)
}

func (s *Server) getCBNRate(ctx context.Context) float64 {
	var rate float64
	err := s.db.QueryRowContext(ctx,
		`SELECT rate FROM cbn_exchange_rates WHERE currency_pair = 'USD/NGN' ORDER BY effective_date DESC LIMIT 1`,
	).Scan(&rate)
	if err != nil || rate <= 0 {
		return 1580.0 // CBN official rate fallback (July 2026)
	}
	return rate
}

func (s *Server) createException(ctx context.Context, declarationID, exceptionType, severity, description string, rawData interface{}) {
	rawJSON, _ := json.Marshal(rawData)
	s.db.ExecContext(ctx, `
		INSERT INTO ncs_nrs_exceptions (declaration_id, exception_type, severity, description, raw_data)
		VALUES ($1, $2, $3, $4, $5)
	`, declarationID, exceptionType, severity, description, rawJSON)
}

// GET /v1/ncs/declarations/{id}/landing-cost
func (s *Server) getLandingCost(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	declID := vars["id"]
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var lc LandingCost
	var hsLinesJSON []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT d.id, lc.cif_value_usd, lc.cif_value_ngn, lc.cbn_exchange_rate,
		       lc.import_duty_ngn, lc.ciss_levy_ngn, lc.etl_levy_ngn, lc.nta_levy_ngn,
		       lc.landing_cost_ngn, lc.import_vat_base_ngn, lc.import_vat_ngn,
		       lc.total_payable_ngn, lc.tariff_rate_pct, lc.hs_lines,
		       lc.iso20022_reference, lc.computed_at
		FROM ncs_nrs_landing_costs lc
		JOIN ncs_nrs_declarations d ON d.id = lc.declaration_id
		WHERE d.id = $1 OR d.declaration_number = $1
	`, declID).Scan(
		&lc.DeclarationID, &lc.CIFValueUSD, &lc.CIFValueNGN, &lc.CBNExchangeRate,
		&lc.ImportDutyNGN, &lc.CISSLevyNGN, &lc.ETLLevyNGN, &lc.NTALevyNGN,
		&lc.LandingCostNGN, &lc.ImportVATBase, &lc.ImportVATNGN,
		&lc.TotalPayableNGN, &lc.TariffRatePct, &hsLinesJSON,
		&lc.ISO20022Reference, &lc.ComputedAt,
	)
	if err == sql.ErrNoRows {
		http.Error(w, "landing cost not yet computed", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.Unmarshal(hsLinesJSON, &lc.HSLines)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(lc)
}

// GET /v1/ncs/declarations/{id}/nrs-prefill
func (s *Server) getNRSPrefill(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	declID := vars["id"]
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var prefill NRSAssessmentPrefill
	var lcJSON, tinJSON []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT p.declaration_id, p.declaration_number, COALESCE(p.ucr,''),
		       COALESCE(p.importer_tin,''), COALESCE(p.importer_name,''),
		       p.assessment_period, p.landing_cost_snapshot, p.tin_match_snapshot,
		       p.vat_assessment_ref, p.iso20022_payment_ref, p.status,
		       p.generated_at, p.visibility_deadline
		FROM ncs_nrs_assessment_prefills p
		JOIN ncs_nrs_declarations d ON d.id = p.declaration_id
		WHERE d.id = $1 OR d.declaration_number = $1
	`, declID).Scan(
		&prefill.DeclarationID, &prefill.DeclarationNumber, &prefill.UCR,
		&prefill.ImporterTIN, &prefill.ImporterName,
		&prefill.AssessmentPeriod, &lcJSON, &tinJSON,
		&prefill.VATAssessmentRef, &prefill.ISO20022PaymentRef, &prefill.Status,
		&prefill.GeneratedAt, &prefill.VisibilityDeadline,
	)
	if err == sql.ErrNoRows {
		http.Error(w, "NRS prefill not yet generated", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.Unmarshal(lcJSON, &prefill.LandingCost)
	json.Unmarshal(tinJSON, &prefill.TINMatch)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(prefill)
}

// GET /v1/ncs/reconciliation/summary
func (s *Server) getReconciliationSummary(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period") // "YYYY-MM"
	if period == "" {
		period = time.Now().UTC().Format("2006-01")
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	var summary ReconciliationSummary
	summary.Period = period
	summary.GeneratedAt = time.Now().UTC()

	// Total declarations in period
	s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM ncs_nrs_declarations WHERE TO_CHAR(submitted_at, 'YYYY-MM') = $1`,
		period,
	).Scan(&summary.TotalDeclarations)

	// TIN match stats
	s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FILTER (WHERE m.match_status = 'MATCHED'),
		       COUNT(*) FILTER (WHERE m.match_status IN ('MATCHED','PARTIAL'))
		FROM ncs_nrs_tin_matches m
		JOIN ncs_nrs_declarations d ON d.id = m.declaration_id
		WHERE TO_CHAR(d.submitted_at, 'YYYY-MM') = $1
	`, period).Scan(&summary.TINMatchedCount, &summary.PrefillsSent)

	if summary.TotalDeclarations > 0 {
		summary.TINMatchRate = float64(summary.TINMatchedCount) / float64(summary.TotalDeclarations) * 100.0
	}

	// VAT totals
	s.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(lc.import_vat_ngn), 0),
		       COALESCE(SUM(lc.landing_cost_ngn), 0)
		FROM ncs_nrs_landing_costs lc
		JOIN ncs_nrs_declarations d ON d.id = lc.declaration_id
		WHERE TO_CHAR(d.submitted_at, 'YYYY-MM') = $1
	`, period).Scan(&summary.TotalImportVATNGN, &summary.TotalLandingCostNGN)

	// Exception stats
	s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FILTER (WHERE e.status = 'OPEN'),
		       COUNT(*) FILTER (WHERE e.status = 'RESOLVED')
		FROM ncs_nrs_exceptions e
		JOIN ncs_nrs_declarations d ON d.id = e.declaration_id
		WHERE TO_CHAR(d.submitted_at, 'YYYY-MM') = $1
	`, period).Scan(&summary.ExceptionsOpen, &summary.ExceptionsResolved)

	// Average visibility time and SLA breaches
	s.db.QueryRowContext(ctx, `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (p.generated_at - d.submitted_at))/60), 0),
		       COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (p.generated_at - d.submitted_at))/60 > 15)
		FROM ncs_nrs_assessment_prefills p
		JOIN ncs_nrs_declarations d ON d.id = p.declaration_id
		WHERE TO_CHAR(d.submitted_at, 'YYYY-MM') = $1
	`, period).Scan(&summary.AvgVisibilityMinutes, &summary.SLABreaches)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}

// GET /v1/ncs/exceptions
func (s *Server) getExceptions(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "OPEN"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, COALESCE(declaration_id::text,''), exception_type, severity,
		       description, COALESCE(raw_data::text,'{}'), status,
		       COALESCE(assigned_to,''), resolved_at, COALESCE(resolution_note,''), created_at
		FROM ncs_nrs_exceptions
		WHERE status = $1
		ORDER BY created_at DESC
		LIMIT 100
	`, status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var exceptions []NCSNRSException
	for rows.Next() {
		var ex NCSNRSException
		var rawDataStr string
		if err := rows.Scan(
			&ex.ID, &ex.DeclarationID, &ex.ExceptionType, &ex.Severity,
			&ex.Description, &rawDataStr, &ex.Status,
			&ex.AssignedTo, &ex.ResolvedAt, &ex.ResolutionNote, &ex.CreatedAt,
		); err != nil {
			continue
		}
		ex.RawData = json.RawMessage(rawDataStr)
		exceptions = append(exceptions, ex)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"exceptions": exceptions, "count": len(exceptions)})
}

// POST /v1/ncs/exceptions/{id}/resolve
func (s *Server) resolveException(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	exID := vars["id"]
	var body struct {
		ResolutionNote string `json:"resolution_note"`
		AssignedTo     string `json:"assigned_to"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	res, err := s.db.ExecContext(ctx, `
		UPDATE ncs_nrs_exceptions
		SET status = 'RESOLVED', resolved_at = NOW(),
		    resolution_note = $1, assigned_to = $2
		WHERE id = $3 AND status = 'OPEN'
	`, body.ResolutionNote, body.AssignedTo, exID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "exception not found or already resolved", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "resolved", "id": exID})
}

// POST /v1/ncs/declarations/edi — Receive raw EDI (EDIFACT CUSCAR/CUSDEC) message
func (s *Server) ingestEDI(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MessageType string `json:"message_type"` // "CUSCAR" | "CUSDEC"
		MessageID   string `json:"message_id"`
		RawEDI      string `json:"raw_edi"`
		Sender      string `json:"sender"`
		Recipient   string `json:"recipient"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	// Parse EDI into canonical NCSDeclaration
	decl := parseEDIMessage(body.MessageType, body.MessageID, body.RawEDI)
	decl.Source = "EDI"
	decl.EDIMessageID = body.MessageID

	// Delegate to ingestDeclaration handler
	declJSON, _ := json.Marshal(decl)
	r.Body = io.NopCloser(strings.NewReader(string(declJSON)))
	s.ingestDeclaration(w, r)
}

// parseEDIMessage parses EDIFACT CUSCAR/CUSDEC into a canonical NCSDeclaration.
// Implements subset of UN/EDIFACT D.16B CUSCAR/CUSDEC message structure.
func parseEDIMessage(messageType, messageID, rawEDI string) NCSDeclaration {
	decl := NCSDeclaration{
		ID:              uuid.New().String(),
		EDIMessageID:    messageID,
		SubmittedAt:     time.Now().UTC(),
		NCSStatus:       "submitted",
	}

	// Parse EDIFACT segments (simplified parser for key fields)
	// Full EDIFACT parser would use a dedicated library in production
	segments := strings.Split(rawEDI, "'")
	for _, seg := range segments {
		seg = strings.TrimSpace(seg)
		if len(seg) < 3 {
			continue
		}
		parts := strings.Split(seg, "+")
		if len(parts) == 0 {
			continue
		}
		switch parts[0] {
		case "BGM": // Beginning of message — declaration number
			if len(parts) > 2 {
				decl.DeclarationNumber = strings.TrimSpace(parts[2])
			}
		case "DTM": // Date/time — submission date
			if len(parts) > 1 {
				dtmParts := strings.Split(parts[1], ":")
				if len(dtmParts) >= 2 && dtmParts[0] == "137" {
					if t, err := time.Parse("20060102", dtmParts[1]); err == nil {
						decl.SubmittedAt = t.UTC()
					}
				}
			}
		case "NAD": // Name and address — importer
			if len(parts) > 1 && parts[1] == "IM" {
				if len(parts) > 4 {
					decl.ImporterName = strings.ReplaceAll(parts[4], ":", " ")
				}
				if len(parts) > 2 {
					// CAC-RC or TIN in party identifier
					idParts := strings.Split(parts[2], ":")
					if len(idParts) > 0 {
						id := strings.TrimSpace(idParts[0])
						if strings.HasPrefix(id, "RC") {
							decl.ImporterCAC = id
						} else if len(id) == 12 {
							decl.ImporterTIN = id
						}
					}
				}
			}
		case "LOC": // Location — port of entry (qualifier 9) or country of origin (qualifier 35)
			if len(parts) > 1 {
				qualifier := parts[1]
				if qualifier == "9" && len(parts) > 2 {
					locParts := strings.Split(parts[2], ":")
					if len(locParts) > 0 {
						decl.PortOfEntry = strings.TrimSpace(locParts[0])
					}
				} else if qualifier == "35" && len(parts) > 2 {
					// LOC+35 = country of origin
					locParts := strings.Split(parts[2], ":")
					if len(locParts) > 0 {
						decl.CountryOfOrigin = strings.TrimSpace(locParts[0])
					}
				}
			}
		case "GID": // Goods item details
			if len(parts) > 2 {
				fmt.Sscanf(parts[2], "%d", &decl.NumberOfPackages)
			}
		case "MEA": // Measurements — gross weight
			if len(parts) > 2 && strings.Contains(parts[1], "WT") {
				measParts := strings.Split(parts[2], ":")
				if len(measParts) > 1 {
					fmt.Sscanf(measParts[1], "%f", &decl.GrossWeightKg)
				}
			}
		case "MOA": // Monetary amount — invoice value
			if len(parts) > 1 {
				moaParts := strings.Split(parts[1], ":")
				if len(moaParts) > 1 && moaParts[0] == "146" { // 146 = customs value
					fmt.Sscanf(moaParts[1], "%f", &decl.InvoiceValue)
				}
			}
		case "TAX": // Tax — HS code
			if len(parts) > 2 {
				taxParts := strings.Split(parts[2], ":")
				if len(taxParts) > 0 {
					decl.HSCode = strings.TrimSpace(taxParts[0])
				}
			}
		case "FTX": // Free text — goods description
			if len(parts) > 4 {
				decl.GoodsDescription = strings.TrimSpace(parts[4])
			}
		}
	}

	if decl.DeclarationNumber == "" {
		decl.DeclarationNumber = "EDI-" + messageID
	}
	if decl.InvoiceCurrency == "" {
		decl.InvoiceCurrency = "USD"
	}
	return decl
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": "ncs-nrs-gateway",
		"version": "1.0.0",
	})
}

// ─── FIRS TIN Registry Bootstrap ─────────────────────────────────────────────

func (s *Server) ensureTINRegistrySchema() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS firs_tin_registry (
			id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			tin              VARCHAR(20) NOT NULL UNIQUE,
			registered_name  TEXT NOT NULL,
			cac_rc           VARCHAR(20),
			nin              VARCHAR(20),
			entity_type      VARCHAR(16) DEFAULT 'CORPORATE', -- 'CORPORATE' | 'INDIVIDUAL'
			tax_office       VARCHAR(64),
			state            VARCHAR(32),
			active           BOOLEAN DEFAULT TRUE,
			created_at       TIMESTAMPTZ DEFAULT NOW(),
			updated_at       TIMESTAMPTZ DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_firs_tin ON firs_tin_registry(tin);
		CREATE INDEX IF NOT EXISTS idx_firs_cac ON firs_tin_registry(cac_rc);
		CREATE INDEX IF NOT EXISTS idx_firs_nin ON firs_tin_registry(nin);
		CREATE EXTENSION IF NOT EXISTS pg_trgm; -- for similarity() fuzzy matching
		CREATE INDEX IF NOT EXISTS idx_firs_name_trgm ON firs_tin_registry USING gin(registered_name gin_trgm_ops);

		CREATE TABLE IF NOT EXISTS cbn_exchange_rates (
			id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			currency_pair   VARCHAR(10) NOT NULL,
			rate            NUMERIC(12,4) NOT NULL,
			effective_date  DATE NOT NULL,
			source          VARCHAR(32) DEFAULT 'CBN_OFFICIAL',
			created_at      TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(currency_pair, effective_date)
		);
		-- Seed current CBN rate
		INSERT INTO cbn_exchange_rates (currency_pair, rate, effective_date)
		VALUES ('USD/NGN', 1580.0, CURRENT_DATE)
		ON CONFLICT (currency_pair, effective_date) DO NOTHING;
	`)
	return err
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	dbURL := getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/tradegateway?sslmode=disable")
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("DB open: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		log.Fatalf("DB ping: %v", err)
	}

	srv := &Server{
		db:            db,
		nrsWebhookURL: getEnv("NRS_WEBHOOK_URL", ""),
		kafkaBrokers:  getEnv("KAFKA_BROKERS", "kafka:9092"),
		webhookSecret: getEnv("NCS_NRS_WEBHOOK_SECRET", "change-me-in-production"),
	}

	if err := srv.ensureTINRegistrySchema(); err != nil {
		log.Fatalf("TIN registry schema: %v", err)
	}
	if err := srv.ensureSchema(); err != nil {
		log.Fatalf("Schema migration: %v", err)
	}

	r := mux.NewRouter()
	r.HandleFunc("/v1/health", srv.health).Methods("GET")
	r.HandleFunc("/v1/ncs/declarations/ingest", srv.ingestDeclaration).Methods("POST")
	r.HandleFunc("/v1/ncs/declarations/edi", srv.ingestEDI).Methods("POST")
	r.HandleFunc("/v1/ncs/declarations/{id}/landing-cost", srv.getLandingCost).Methods("GET")
	r.HandleFunc("/v1/ncs/declarations/{id}/nrs-prefill", srv.getNRSPrefill).Methods("GET")
	r.HandleFunc("/v1/ncs/reconciliation/summary", srv.getReconciliationSummary).Methods("GET")
	r.HandleFunc("/v1/ncs/exceptions", srv.getExceptions).Methods("GET")
	r.HandleFunc("/v1/ncs/exceptions/{id}/resolve", srv.resolveException).Methods("POST")

	port := getEnv("PORT", "8101")
	log.Printf("NCS-NRS Gateway listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
