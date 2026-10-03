// opencti-svc — Threat-intel enrichment service for TradeGateway.
//
// Phase 23 (C3): REMOVED the in-memory STIX indicator/actor maps and
// seedStore(), which planted FABRICATED threat intel on every boot while the
// live server (server/routers/threatIntel.ts) called this service.
//
// The service is now Postgres-backed (pgx v5) and FAIL-CLOSED:
//   - DATABASE_URL is required; startup aborts if it is missing or the
//     database is unreachable.
//   - STIX indicators persist to the EXISTING threat_intel_feeds table
//     (drizzle/schema.ts). TradeGateway extension fields that predate the
//     table (pattern_type, confidence, hs_codes, trader_entities, ucrs,
//     origin_countries, related declaration links) are packed into the
//     existing tags/related_declarations jsonb columns so the public JSON
//     shapes are unchanged.
//   - Threat actors persist to the NEW threat_intel_actors table
//     (migration 0076). No seed rows are planted anywhere.
//   - /health performs a real SELECT 1.
//
// Routes and JSON shapes are identical to the previous implementation.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── STIX 2.1 Domain Types (unchanged) ──────────────────────────────────────

type STIXIndicator struct {
	ID            string     `json:"id"`
	Type          string     `json:"type"` // "indicator"
	SpecVersion   string     `json:"spec_version"`
	Name          string     `json:"name"`
	Description   string     `json:"description"`
	Pattern       string     `json:"pattern"`        // e.g. [ipv4-addr:value = '1.2.3.4']
	PatternType   string     `json:"pattern_type"`   // "stix"
	ValidFrom     time.Time  `json:"valid_from"`
	ValidUntil    *time.Time `json:"valid_until,omitempty"`
	Severity      string     `json:"severity"` // LOW | MEDIUM | HIGH | CRITICAL
	Confidence    int        `json:"confidence"`
	Labels        []string   `json:"labels"`
	ThreatType    string     `json:"threat_type"` // FRAUD | SMUGGLING | SANCTIONS_EVASION | DOCUMENT_FORGERY
	HSCodes       []string   `json:"hs_codes,omitempty"`
	TraderEntities []string  `json:"trader_entities,omitempty"`
	UCRs          []string   `json:"ucrs,omitempty"`
	OriginCountries []string `json:"origin_countries,omitempty"`
	IsActive      bool       `json:"is_active"`
	CreatedAt     time.Time  `json:"created_at"`
}

type ThreatActor struct {
	ID            string    `json:"id"`
	Type          string    `json:"type"` // "threat-actor"
	SpecVersion   string    `json:"spec_version"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	ActorType     string    `json:"actor_type"` // crime-syndicate | nation-state | insider
	Aliases       []string  `json:"aliases"`
	Motivation    string    `json:"motivation"`
	Sophistication string   `json:"sophistication"`
	FirstSeen     time.Time `json:"first_seen"`
	LastSeen      time.Time `json:"last_seen"`
	AssociatedIndicators []string `json:"associated_indicators"`
}

type STIXBundle struct {
	Type        string        `json:"type"` // "bundle"
	ID          string        `json:"id"`
	SpecVersion string        `json:"spec_version"`
	Objects     []interface{} `json:"objects"`
}

type MatchRequest struct {
	HSCode          string   `json:"hs_code"`
	TraderEntity    string   `json:"trader_entity"`
	UCR             string   `json:"ucr"`
	OriginCountry   string   `json:"origin_country"`
	DeclarationText string   `json:"declaration_text"`
}

type MatchResult struct {
	DeclarationRef string          `json:"declaration_ref"`
	Matches        []STIXIndicator `json:"matches"`
	RiskScore      int             `json:"risk_score"`
	HighestSeverity string         `json:"highest_severity"`
	RequiresReview bool            `json:"requires_review"`
}

// ─── Persistence mapping ────────────────────────────────────────────────────
//
// threat_intel_feeds columns: id serial, feed_source, indicator_type,
// indicator_value, severity (enum: info|low|medium|high|critical), description,
// tags jsonb, first_seen, last_seen, is_active, related_declarations jsonb,
// created_at.
//
// The pre-existing TradeGateway STIX extension fields do not have dedicated
// columns; they round-trip through the two jsonb columns so that ALL public
// JSON shapes stay byte-identical:
//   tags                → indicator labels ([]string)
//   related_declarations→ indicatorExtras object (everything else)

const feedSource = "opencti-svc"

type indicatorExtras struct {
	StixID              string     `json:"stix_id"`
	Name                string     `json:"name"`
	PatternType         string     `json:"pattern_type"`
	ValidUntil          *time.Time `json:"valid_until,omitempty"`
	Confidence          int        `json:"confidence"`
	HSCodes             []string   `json:"hs_codes,omitempty"`
	TraderEntities      []string   `json:"trader_entities,omitempty"`
	UCRs                []string   `json:"ucrs,omitempty"`
	OriginCountries     []string   `json:"origin_countries,omitempty"`
	RelatedDeclarations []string   `json:"related_declarations,omitempty"`
}

// actorExtras payload stored in threat_intel_actors.motivation (jsonb).
// The public API exposes motivation as a plain string; the first entry of
// Values is served. associated_indicators round-trips here because the table
// has no dedicated column for it.
type actorExtras struct {
	Values               []string `json:"values"`
	AssociatedIndicators []string `json:"associated_indicators,omitempty"`
}

var validDBSeverities = map[string]bool{
	"info": true, "low": true, "medium": true, "high": true, "critical": true,
}

func severityToDB(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if !validDBSeverities[s] {
		return "medium"
	}
	return s
}

func severityFromDB(s string) string {
	return strings.ToUpper(s)
}

func indicatorToRow(ind *STIXIndicator) (indicatorType, indicatorValue, severity string,
	tags, extras []byte, firstSeen, lastSeen time.Time, err error) {
	indicatorType = ind.ThreatType
	if indicatorType == "" {
		indicatorType = "indicator"
	}
	indicatorValue = ind.Pattern
	if indicatorValue == "" {
		indicatorValue = ind.Name
	}
	severity = severityToDB(ind.Severity)
	labels := ind.Labels
	if labels == nil {
		labels = []string{}
	}
	tags, err = json.Marshal(labels)
	if err != nil {
		return
	}
	extras, err = json.Marshal(indicatorExtras{
		StixID:          ind.ID,
		Name:            ind.Name,
		PatternType:     ind.PatternType,
		ValidUntil:      ind.ValidUntil,
		Confidence:      ind.Confidence,
		HSCodes:         ind.HSCodes,
		TraderEntities:  ind.TraderEntities,
		UCRs:            ind.UCRs,
		OriginCountries: ind.OriginCountries,
	})
	if err != nil {
		return
	}
	firstSeen = ind.ValidFrom
	if firstSeen.IsZero() {
		firstSeen = time.Now().UTC()
	}
	lastSeen = time.Now().UTC()
	return
}

func rowToIndicator(feedSourceV, indicatorType, indicatorValue, severity, description string,
	tagsRaw, extrasRaw []byte, firstSeen, lastSeen time.Time, isActive bool, createdAt time.Time) STIXIndicator {
	ind := STIXIndicator{
		Type:        "indicator",
		SpecVersion: "2.1",
		ThreatType:  indicatorType,
		Pattern:     indicatorValue,
		Severity:    severityFromDB(severity),
		Description: description,
		ValidFrom:   firstSeen,
		IsActive:    isActive,
		CreatedAt:   createdAt,
		Labels:      []string{},
	}
	if err := json.Unmarshal(tagsRaw, &ind.Labels); err != nil || ind.Labels == nil {
		ind.Labels = []string{}
	}
	var ex indicatorExtras
	if err := json.Unmarshal(extrasRaw, &ex); err == nil {
		ind.ID = ex.StixID
		ind.Name = ex.Name
		ind.PatternType = ex.PatternType
		ind.ValidUntil = ex.ValidUntil
		ind.Confidence = ex.Confidence
		ind.HSCodes = ex.HSCodes
		ind.TraderEntities = ex.TraderEntities
		ind.UCRs = ex.UCRs
		ind.OriginCountries = ex.OriginCountries
	}
	if ind.PatternType == "" {
		ind.PatternType = "stix"
	}
	return ind
}

func rowToActor(id, name string, actorType, sophistication, description *string,
	aliasesRaw, motivationRaw []byte, firstSeen, lastSeen time.Time) ThreatActor {
	actor := ThreatActor{
		ID:          id,
		Type:        "threat-actor",
		SpecVersion: "2.1",
		Name:        name,
		FirstSeen:   firstSeen,
		LastSeen:    lastSeen,
		Aliases:     []string{},
	}
	if actorType != nil {
		actor.ActorType = *actorType
	}
	if sophistication != nil {
		actor.Sophistication = *sophistication
	}
	if description != nil {
		actor.Description = *description
	}
	if err := json.Unmarshal(aliasesRaw, &actor.Aliases); err != nil || actor.Aliases == nil {
		actor.Aliases = []string{}
	}
	var ex actorExtras
	if err := json.Unmarshal(motivationRaw, &ex); err == nil {
		if len(ex.Values) > 0 {
			actor.Motivation = ex.Values[0]
		}
		actor.AssociatedIndicators = ex.AssociatedIndicators
	}
	return actor
}

// ─── Service ────────────────────────────────────────────────────────────────

type OpenCTIService struct {
	db *pgxpool.Pool
}

func (s *OpenCTIService) loadIndicators(ctx context.Context) ([]STIXIndicator, error) {
	rows, err := s.db.Query(ctx, `
		SELECT feed_source, indicator_type, indicator_value, severity::text,
		       COALESCE(description, ''), tags, related_declarations,
		       first_seen, last_seen, is_active, created_at
		FROM threat_intel_feeds
		WHERE is_active = TRUE
		ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	indicators := []STIXIndicator{}
	for rows.Next() {
		var fs, it, iv, sev, desc string
		var tagsRaw, extrasRaw []byte
		var firstSeen, lastSeen, createdAt time.Time
		var isActive bool
		if err := rows.Scan(&fs, &it, &iv, &sev, &desc, &tagsRaw, &extrasRaw,
			&firstSeen, &lastSeen, &isActive, &createdAt); err != nil {
			return nil, err
		}
		indicators = append(indicators, rowToIndicator(fs, it, iv, sev, desc,
			tagsRaw, extrasRaw, firstSeen, lastSeen, isActive, createdAt))
	}
	return indicators, rows.Err()
}

func (s *OpenCTIService) loadActors(ctx context.Context) ([]ThreatActor, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, actor_type, sophistication, description,
		       aliases, motivation, first_seen, last_seen
		FROM threat_intel_actors
		ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	actors := []ThreatActor{}
	for rows.Next() {
		var id, name string
		var actorType, sophistication, description *string
		var aliasesRaw, motivationRaw []byte
		var firstSeen, lastSeen time.Time
		if err := rows.Scan(&id, &name, &actorType, &sophistication, &description,
			&aliasesRaw, &motivationRaw, &firstSeen, &lastSeen); err != nil {
			return nil, err
		}
		actors = append(actors, rowToActor(id, name, actorType, sophistication,
			description, aliasesRaw, motivationRaw, firstSeen, lastSeen))
	}
	return actors, rows.Err()
}

func (s *OpenCTIService) lastSync(ctx context.Context) (time.Time, error) {
	var ts time.Time
	err := s.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(last_seen), now()) FROM threat_intel_feeds`).Scan(&ts)
	return ts, err
}

func (s *OpenCTIService) insertIndicator(ctx context.Context, ind *STIXIndicator) error {
	it, iv, sev, tags, extras, firstSeen, lastSeen, err := indicatorToRow(ind)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `
		INSERT INTO threat_intel_feeds
		  (feed_source, indicator_type, indicator_value, severity, description,
		   tags, first_seen, last_seen, is_active, related_declarations)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb)`,
		feedSource, it, iv, sev, ind.Description,
		string(tags), firstSeen, lastSeen, ind.IsActive, string(extras))
	return err
}

// ─── Matching logic (unchanged semantics, now DB-backed) ───────────────────

func (s *OpenCTIService) matchDeclaration(req MatchRequest, indicators []STIXIndicator) []STIXIndicator {
	var matches []STIXIndicator
	for _, ind := range indicators {
		matched := false
		for _, hs := range ind.HSCodes {
			if strings.HasPrefix(req.HSCode, hs) || hs == req.HSCode {
				matched = true
				break
			}
		}
		if !matched {
			for _, te := range ind.TraderEntities {
				if strings.EqualFold(te, req.TraderEntity) {
					matched = true
					break
				}
			}
		}
		if !matched && req.UCR != "" {
			for _, u := range ind.UCRs {
				if u == req.UCR {
					matched = true
					break
				}
			}
		}
		if !matched {
			for _, oc := range ind.OriginCountries {
				if strings.EqualFold(oc, req.OriginCountry) && ind.ThreatType == "SANCTIONS_EVASION" {
					matched = true
					break
				}
			}
		}
		if matched {
			matches = append(matches, ind)
		}
	}
	return matches
}

func computeRiskScore(matches []STIXIndicator) int {
	if len(matches) == 0 {
		return 0
	}
	score := 0
	for _, m := range matches {
		switch m.Severity {
		case "CRITICAL":
			score += 40
		case "HIGH":
			score += 25
		case "MEDIUM":
			score += 15
		case "LOW":
			score += 5
		}
		score += m.Confidence / 10
	}
	if score > 100 {
		score = 100
	}
	return score
}

func highestSeverity(matches []STIXIndicator) string {
	order := map[string]int{"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
	best := "LOW"
	for _, m := range matches {
		if order[m.Severity] > order[best] {
			best = m.Severity
		}
	}
	return best
}

// ─── HTTP Handlers (routes and JSON shapes unchanged) ──────────────────────

func (s *OpenCTIService) healthHandler(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()
	var one int
	if err := s.db.QueryRow(ctx, `SELECT 1`).Scan(&one); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unhealthy",
			"service": "opencti-svc",
			"error":   "database unreachable",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "opencti-svc",
		"version":   "1.0.0",
		"timestamp": time.Now().UTC(),
	})
}

func (s *OpenCTIService) getIndicatorsHandler(c *gin.Context) {
	indicators, err := s.loadIndicators(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load indicators"})
		return
	}
	lastSync, err := s.lastSync(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load indicators"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"indicators": indicators,
		"count":      len(indicators),
		"last_sync":  lastSync,
	})
}

func (s *OpenCTIService) ingestIndicatorHandler(c *gin.Context) {
	var req struct {
		Indicators []STIXIndicator `json:"indicators" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ingested := 0
	for _, ind := range req.Indicators {
		if ind.ID == "" {
			ind.ID = "indicator--" + uuid.New().String()
		}
		if ind.Type == "" {
			ind.Type = "indicator"
		}
		if ind.SpecVersion == "" {
			ind.SpecVersion = "2.1"
		}
		ind.CreatedAt = time.Now().UTC()
		ind.IsActive = true
		if err := s.insertIndicator(c.Request.Context(), &ind); err != nil {
			log.Printf("ingest: failed to persist indicator %s: %v", ind.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist indicators"})
			return
		}
		ingested++
	}
	c.JSON(http.StatusAccepted, gin.H{
		"ingested": ingested,
		"status":   "accepted",
	})
}

func (s *OpenCTIService) matchHandler(c *gin.Context) {
	var req MatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	indicators, err := s.loadIndicators(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load indicators"})
		return
	}
	matches := s.matchDeclaration(req, indicators)
	if matches == nil {
		matches = []STIXIndicator{}
	}
	riskScore := computeRiskScore(matches)
	result := MatchResult{
		DeclarationRef:  req.UCR,
		Matches:         matches,
		RiskScore:       riskScore,
		HighestSeverity: highestSeverity(matches),
		RequiresReview:  riskScore >= 40,
	}
	c.JSON(http.StatusOK, result)
}

func (s *OpenCTIService) exportSTIXHandler(c *gin.Context) {
	indicators, err := s.loadIndicators(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load indicators"})
		return
	}
	objects := make([]interface{}, 0, len(indicators))
	for _, ind := range indicators {
		objects = append(objects, ind)
	}
	bundle := STIXBundle{
		Type:        "bundle",
		ID:          "bundle--" + uuid.New().String(),
		SpecVersion: "2.1",
		Objects:     objects,
	}
	c.JSON(http.StatusOK, bundle)
}

func (s *OpenCTIService) statsHandler(c *gin.Context) {
	ctx := c.Request.Context()
	indicators, err := s.loadIndicators(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load indicators"})
		return
	}
	actors, err := s.loadActors(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load actors"})
		return
	}
	lastSync, err := s.lastSync(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute stats"})
		return
	}
	byThreatType := make(map[string]int)
	bySeverity := make(map[string]int)
	for _, ind := range indicators {
		byThreatType[ind.ThreatType]++
		bySeverity[ind.Severity]++
	}
	c.JSON(http.StatusOK, gin.H{
		"total_indicators": len(indicators),
		"total_actors":     len(actors),
		"by_threat_type":   byThreatType,
		"by_severity":      bySeverity,
		"last_sync":        lastSync,
	})
}

// enrichHandler combines indicator matching with actor attribution.
func (s *OpenCTIService) enrichHandler(c *gin.Context) {
	var req MatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx := c.Request.Context()
	indicators, err := s.loadIndicators(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load indicators"})
		return
	}
	actors, err := s.loadActors(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load actors"})
		return
	}
	matches := s.matchDeclaration(req, indicators)
	if matches == nil {
		matches = []STIXIndicator{}
	}
	matchedIDs := make(map[string]bool, len(matches))
	for _, m := range matches {
		matchedIDs[m.ID] = true
	}
	relevantActors := []ThreatActor{}
	for _, actor := range actors {
		for _, indID := range actor.AssociatedIndicators {
			if matchedIDs[indID] {
				relevantActors = append(relevantActors, actor)
				break
			}
		}
	}
	riskScore := computeRiskScore(matches)
	c.JSON(http.StatusOK, gin.H{
		"matches":          matches,
		"actors":           relevantActors,
		"risk_score":       riskScore,
		"highest_severity": highestSeverity(matches),
		"requires_review":  riskScore >= 40,
		"enriched_at":      time.Now().UTC(),
	})
}

// ─── Main ───────────────────────────────────────────────────────────────────

func main() {
	// FAIL CLOSED: no DATABASE_URL, no service. The previous implementation
	// booted with fabricated seed intel and no database at all.
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("FATAL: DATABASE_URL is required — opencti-svc refuses to start without Postgres (fail closed)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("FATAL: invalid DATABASE_URL: %v", err)
	}
	defer db.Close()
	if err := db.Ping(ctx); err != nil {
		log.Fatalf("FATAL: cannot reach Postgres at DATABASE_URL: %v", err)
	}
	log.Println("Connected to Postgres — threat intel is served exclusively from threat_intel_feeds / threat_intel_actors (no seed data)")

	svc := &OpenCTIService{db: db}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	// Phase 26 F1: fail-closed Keycloak JWT authz on all non-probe routes.
	r.Use(authGuard())

	r.GET("/health", svc.healthHandler)
	r.GET("/indicators", svc.getIndicatorsHandler)
	r.POST("/indicators/ingest", svc.ingestIndicatorHandler)
	r.POST("/match", svc.matchHandler)
	r.GET("/export/stix", svc.exportSTIXHandler)
	r.GET("/stats", svc.statsHandler)
	r.POST("/enrich", svc.enrichHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8085"
	}
	addr := fmt.Sprintf(":%s", port)
	log.Printf("opencti-svc listening on %s", addr)
	if err := r.Run(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server error: %v", err)
	}
}
