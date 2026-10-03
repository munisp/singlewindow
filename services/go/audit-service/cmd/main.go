// audit-service — Post-Clearance Audit microservice
// Implements WCO-aligned post-clearance audit with risk-weighted random
// selection, duty discrepancy calculation, and penalty notice generation.
//
// Phase 26 F3: audit state is persisted to PostgreSQL via pgx/v5 against the
// existing post_clearance_audits table (drizzle schema, columns reused
// as-is). DATABASE_URL is REQUIRED — the service fails closed at startup
// without it. Selected audits are inserted as real rows; discrepancy and
// penalty endpoints update existing audit rows and 404 honestly when no
// audit exists. No simulated data remains.
package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── Domain types ─────────────────────────────────────────────────────────────

type RiskProfile struct {
	DeclarationID   int     `json:"declaration_id"`
	TraderID        int     `json:"trader_id"`
	UCR             string  `json:"ucr"`
	HSCode          string  `json:"hs_code"`
	DeclaredValue   float64 `json:"declared_value"`
	DutyPaid        float64 `json:"duty_paid"`
	RiskScore       float64 `json:"risk_score"` // 0–100
	RiskLane        string  `json:"risk_lane"`  // green_lane | yellow_lane | red_lane
	PriorAudits     int     `json:"prior_audits"`
	PriorViolations int     `json:"prior_violations"`
}

type SelectionResult struct {
	Selected       bool    `json:"selected"`
	AuditID        string  `json:"audit_id"`
	TriggerReason  string  `json:"trigger_reason"`
	SelectionScore float64 `json:"selection_score"`
	Priority       string  `json:"priority"` // high | medium | low
}

type DiscrepancyInput struct {
	DeclarationID int     `json:"declaration_id"`
	UCR           string  `json:"ucr"`
	DeclaredValue float64 `json:"declared_value"`
	AuditedValue  float64 `json:"audited_value"`
	DutyRate      float64 `json:"duty_rate"` // e.g. 0.20 for 20%
	DutyPaid      float64 `json:"duty_paid"`
}

type DiscrepancyResult struct {
	ValueDifference    float64 `json:"value_difference"`
	ValueDiffPct       float64 `json:"value_diff_pct"`
	AdditionalDutyOwed float64 `json:"additional_duty_owed"`
	PenaltyMultiplier  float64 `json:"penalty_multiplier"`
	PenaltyAmount      float64 `json:"penalty_amount"`
	Outcome            string  `json:"outcome"` // compliant | minor_discrepancy | major_discrepancy | fraud_suspected
	FindingSummary     string  `json:"finding_summary"`
}

type PenaltyNotice struct {
	NoticeID      string    `json:"notice_id"`
	AuditID       string    `json:"audit_id"`
	UCR           string    `json:"ucr"`
	TraderID      int       `json:"trader_id"`
	PenaltyAmount float64   `json:"penalty_amount"`
	DutyOwed      float64   `json:"duty_owed"`
	TotalPayable  float64   `json:"total_payable"`
	DueDate       time.Time `json:"due_date"`
	IssuedAt      time.Time `json:"issued_at"`
	Narrative     string    `json:"narrative"`
}

var db *pgxpool.Pool

// ─── Selection algorithm ──────────────────────────────────────────────────────

// selectForAudit implements WCO risk-weighted random selection.
// Base selection rate: 5% for green-lane, 20% for yellow, 100% for red.
// Score modifiers: prior violations, high-value goods, sensitive HS codes.
func selectForAudit(p RiskProfile) SelectionResult {
	baseRate := map[string]float64{
		"green_lane":  0.05,
		"yellow_lane": 0.20,
		"red_lane":    1.00,
	}
	rate, ok := baseRate[p.RiskLane]
	if !ok {
		rate = 0.10
	}

	// Score modifiers
	score := p.RiskScore / 100.0 // normalise to 0–1
	if p.PriorViolations > 0 {
		score += float64(p.PriorViolations) * 0.15
	}
	if p.DeclaredValue > 100_000 {
		score += 0.10
	}
	// Sensitive HS chapters: 22 (beverages), 24 (tobacco), 87 (vehicles), 93 (arms)
	chapter := ""
	if len(p.HSCode) >= 2 {
		chapter = p.HSCode[:2]
	}
	sensitiveChapters := map[string]bool{"22": true, "24": true, "87": true, "93": true}
	if sensitiveChapters[chapter] {
		score += 0.20
	}
	if score > 1.0 {
		score = 1.0
	}

	// Effective selection probability
	effectiveRate := rate + (1-rate)*score*0.5
	if effectiveRate > 1.0 {
		effectiveRate = 1.0
	}

	// Deterministic pseudo-random using UCR as seed for reproducibility
	seed := int64(0)
	for _, c := range p.UCR {
		seed = seed*31 + int64(c)
	}
	rng := rand.New(rand.NewSource(seed + int64(p.DeclarationID)))
	selected := rng.Float64() < effectiveRate

	priority := "low"
	if effectiveRate >= 0.80 {
		priority = "high"
	} else if effectiveRate >= 0.40 {
		priority = "medium"
	}

	triggerReasons := []string{}
	if p.RiskLane == "red_lane" {
		triggerReasons = append(triggerReasons, "Red-lane risk classification")
	}
	if p.PriorViolations > 0 {
		triggerReasons = append(triggerReasons, fmt.Sprintf("%d prior violation(s)", p.PriorViolations))
	}
	if sensitiveChapters[chapter] {
		triggerReasons = append(triggerReasons, "Sensitive HS chapter")
	}
	if p.DeclaredValue > 100_000 {
		triggerReasons = append(triggerReasons, "High-value declaration")
	}
	if len(triggerReasons) == 0 {
		triggerReasons = append(triggerReasons, "Random selection")
	}

	auditID := ""
	if selected {
		auditID = "AUD-" + strings.ToUpper(uuid.New().String()[:8])
	}

	return SelectionResult{
		Selected:       selected,
		AuditID:        auditID,
		TriggerReason:  strings.Join(triggerReasons, "; "),
		SelectionScore: math.Round(effectiveRate*100) / 100,
		Priority:       priority,
	}
}

// recordSelectedAudit persists a newly selected audit into
// post_clearance_audits (audit_number, declaration_id, declaration_number,
// trader_id, status, outcome, trigger_reason, declared_value).
func recordSelectedAudit(ctx context.Context, p RiskProfile, res SelectionResult) error {
	_, err := db.Exec(ctx, `
		INSERT INTO post_clearance_audits
			(audit_number, declaration_id, declaration_number, trader_id,
			 status, outcome, trigger_reason, declared_value)
		VALUES ($1, $2, $3, $4, 'scheduled', 'pending', $5, $6)`,
		res.AuditID, p.DeclarationID, p.UCR, p.TraderID, res.TriggerReason, p.DeclaredValue)
	return err
}

// ─── Discrepancy calculator ───────────────────────────────────────────────────

func calcDiscrepancy(inp DiscrepancyInput) DiscrepancyResult {
	diff := inp.AuditedValue - inp.DeclaredValue
	diffPct := 0.0
	if inp.DeclaredValue > 0 {
		diffPct = (diff / inp.DeclaredValue) * 100
	}
	additionalDuty := 0.0
	if diff > 0 {
		additionalDuty = diff * inp.DutyRate
	}

	// WCO penalty matrix
	// < 5%: compliant; 5–20%: minor (1× duty); 20–50%: major (2× duty); > 50%: fraud (4× duty)
	outcome := "compliant"
	penaltyMultiplier := 0.0
	summary := "No discrepancy found. Declaration values are accurate."

	absPct := math.Abs(diffPct)
	if absPct >= 50 {
		outcome = "fraud_suspected"
		penaltyMultiplier = 4.0
		summary = fmt.Sprintf("Severe undervaluation detected (%.1f%%). Referred to fraud investigation unit.", absPct)
	} else if absPct >= 20 {
		outcome = "major_discrepancy"
		penaltyMultiplier = 2.0
		summary = fmt.Sprintf("Major value discrepancy of %.1f%%. Additional duty and 2× penalty assessed.", absPct)
	} else if absPct >= 5 {
		outcome = "minor_discrepancy"
		penaltyMultiplier = 1.0
		summary = fmt.Sprintf("Minor value discrepancy of %.1f%%. Additional duty and 1× penalty assessed.", absPct)
	}

	penaltyAmount := additionalDuty * penaltyMultiplier

	return DiscrepancyResult{
		ValueDifference:    math.Round(diff*100) / 100,
		ValueDiffPct:       math.Round(diffPct*100) / 100,
		AdditionalDutyOwed: math.Round(additionalDuty*100) / 100,
		PenaltyMultiplier:  penaltyMultiplier,
		PenaltyAmount:      math.Round(penaltyAmount*100) / 100,
		Outcome:            outcome,
		FindingSummary:     summary,
	}
}

// applyDiscrepancy records the audit outcome onto the latest
// post_clearance_audits row for the declaration. Returns false when no audit
// exists — the handler then fails closed with 404 rather than inventing one.
func applyDiscrepancy(ctx context.Context, inp DiscrepancyInput, res DiscrepancyResult) (bool, error) {
	tag, err := db.Exec(ctx, `
		UPDATE post_clearance_audits
		SET audited_value = $1,
		    value_difference = $2,
		    additional_duty_assessed = $3,
		    penalty_amount = $4,
		    outcome = $5,
		    findings = $6,
		    status = 'completed',
		    completed_at = now(),
		    updated_at = now()
		WHERE id = (
			SELECT id FROM post_clearance_audits
			WHERE declaration_id = $7
			ORDER BY created_at DESC LIMIT 1
		)`,
		inp.AuditedValue, res.ValueDifference, res.AdditionalDutyOwed,
		res.PenaltyAmount, res.Outcome, res.FindingSummary, inp.DeclarationID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ─── Penalty notice generator ─────────────────────────────────────────────────

func issuePenaltyNotice(auditID, ucr string, traderID int, disc DiscrepancyResult) PenaltyNotice {
	now := time.Now().UTC()
	dueDate := now.AddDate(0, 0, 30) // 30-day payment window
	total := disc.AdditionalDutyOwed + disc.PenaltyAmount

	narrative := fmt.Sprintf(
		"Post-clearance audit %s found a value discrepancy of %.2f%% on declaration %s. "+
			"Additional duty assessed: USD %.2f. Penalty (%.0f× multiplier): USD %.2f. "+
			"Total payable: USD %.2f. Payment due by %s.",
		auditID, math.Abs(disc.ValueDiffPct), ucr,
		disc.AdditionalDutyOwed, disc.PenaltyMultiplier, disc.PenaltyAmount,
		total, dueDate.Format("2006-01-02"),
	)

	return PenaltyNotice{
		NoticeID:      "PEN-" + strings.ToUpper(uuid.New().String()[:8]),
		AuditID:       auditID,
		UCR:           ucr,
		TraderID:      traderID,
		PenaltyAmount: disc.PenaltyAmount,
		DutyOwed:      disc.AdditionalDutyOwed,
		TotalPayable:  math.Round(total*100) / 100,
		DueDate:       dueDate,
		IssuedAt:      now,
		Narrative:     narrative,
	}
}

// applyPenaltyNotice records the issued penalty against the persisted audit.
// Returns false when the audit does not exist.
func applyPenaltyNotice(ctx context.Context, n PenaltyNotice) (bool, error) {
	tag, err := db.Exec(ctx, `
		UPDATE post_clearance_audits
		SET penalty_amount = $1,
		    officer_notes = $2,
		    status = 'escalated',
		    updated_at = now()
		WHERE audit_number = $3`,
		n.PenaltyAmount, n.Narrative, n.AuditID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func handleHealth(c *gin.Context) {
	var one int
	if err := db.QueryRow(c.Request.Context(), "SELECT 1").Scan(&one); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable", "service": "audit-service", "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "audit-service", "ts": time.Now().UTC()})
}

func handleSelect(c *gin.Context) {
	var p RiskProfile
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := selectForAudit(p)
	if result.Selected {
		if err := recordSelectedAudit(c.Request.Context(), p, result); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist selected audit: " + err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, result)
}

func handleDiscrepancy(c *gin.Context) {
	var inp DiscrepancyInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := calcDiscrepancy(inp)
	updated, err := applyDiscrepancy(c.Request.Context(), inp, result)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist discrepancy: " + err.Error()})
		return
	}
	if !updated {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("no post-clearance audit exists for declaration %d; run /api/audit/select first", inp.DeclarationID)})
		return
	}
	c.JSON(http.StatusOK, result)
}

func handlePenalty(c *gin.Context) {
	var req struct {
		AuditID  string            `json:"audit_id"`
		UCR      string            `json:"ucr"`
		TraderID int               `json:"trader_id"`
		Disc     DiscrepancyResult `json:"discrepancy"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Disc.Outcome == "compliant" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no penalty for compliant declarations"})
		return
	}
	notice := issuePenaltyNotice(req.AuditID, req.UCR, req.TraderID, req.Disc)
	updated, err := applyPenaltyNotice(c.Request.Context(), notice)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist penalty notice: " + err.Error()})
		return
	}
	if !updated {
		c.JSON(http.StatusNotFound, gin.H{"error": "audit not found: " + req.AuditID})
		return
	}
	c.JSON(http.StatusCreated, notice)
}

func handleBatchSelect(c *gin.Context) {
	var profiles []RiskProfile
	if err := c.ShouldBindJSON(&profiles); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	results := make([]SelectionResult, len(profiles))
	for i, p := range profiles {
		results[i] = selectForAudit(p)
		if results[i].Selected {
			if err := recordSelectedAudit(c.Request.Context(), p, results[i]); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to persist audit for declaration %d: %v", p.DeclarationID, err)})
				return
			}
		}
	}
	selected := 0
	for _, r := range results {
		if r.Selected {
			selected++
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"total":    len(profiles),
		"selected": selected,
		"results":  results,
	})
}

func handleSelectionStats(c *gin.Context) {
	// Selection policy metadata (static configuration) plus real audit counts
	// from post_clearance_audits.
	byStatus := map[string]int{}
	rows, err := db.Query(c.Request.Context(), `SELECT status, COUNT(*) FROM post_clearance_audits GROUP BY status`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	total := 0
	for rows.Next() {
		var s string
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		byStatus[s] = n
		total += n
	}
	c.JSON(http.StatusOK, gin.H{
		"selection_rates": gin.H{
			"green_lane":  "5% base + risk modifiers",
			"yellow_lane": "20% base + risk modifiers",
			"red_lane":    "100% (mandatory)",
		},
		"penalty_matrix": []gin.H{
			{"range": "< 5% discrepancy", "outcome": "compliant", "multiplier": 0},
			{"range": "5–20% discrepancy", "outcome": "minor_discrepancy", "multiplier": 1},
			{"range": "20–50% discrepancy", "outcome": "major_discrepancy", "multiplier": 2},
			{"range": "> 50% discrepancy", "outcome": "fraud_suspected", "multiplier": 4},
		},
		"audits_total":     total,
		"audits_by_status": byStatus,
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	// Phase 26 F3: DATABASE_URL is mandatory. This service persists audits to
	// post_clearance_audits and refuses to start without a database.
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required; refusing to start without PostgreSQL persistence")
	}
	var err error
	db, err = pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("DATABASE_URL parse failed: %v", err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.Ping(ctx); err != nil {
		log.Fatalf("PostgreSQL unreachable at startup (fail-closed): %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8094"
	}
	if _, err := strconv.Atoi(port); err != nil {
		log.Fatalf("invalid PORT: %s", port)
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	// Phase 26 F1: fail-closed Keycloak JWT authz on all non-probe routes.
	r.Use(authGuard())

	r.GET("/health", handleHealth)
	r.GET("/api/audit/stats", handleSelectionStats)
	r.POST("/api/audit/select", handleSelect)
	r.POST("/api/audit/select/batch", handleBatchSelect)
	r.POST("/api/audit/discrepancy", handleDiscrepancy)
	r.POST("/api/audit/penalty", handlePenalty)

	log.Printf("[audit-service] listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
