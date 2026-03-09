// opencti-svc — OpenCTI Threat Intelligence Feed Service
// Integrates with OpenCTI GraphQL API to ingest STIX 2.1 indicators,
// enrich CEN alerts with threat graph data, and match declarations
// against known threat actors, malicious HS codes, and sanctioned routes.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ─── STIX 2.1 Types ──────────────────────────────────────────────────────────

type STIXIndicator struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Name        string    `json:"name"`
	Pattern     string    `json:"pattern"`
	PatternType string    `json:"pattern_type"`
	ValidFrom   time.Time `json:"valid_from"`
	ValidUntil  *time.Time `json:"valid_until,omitempty"`
	Confidence  int       `json:"confidence"`
	Labels      []string  `json:"labels"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	// TradeGateway extensions
	HSCodes       []string `json:"hs_codes,omitempty"`
	TraderEntities []string `json:"trader_entities,omitempty"`
	UCRs          []string `json:"ucrs,omitempty"`
	OriginCountries []string `json:"origin_countries,omitempty"`
	ThreatType    string   `json:"threat_type"` // DRUG, WEAPONS, COUNTERFEITING, SANCTIONS, FRAUD
	Severity      string   `json:"severity"`    // CRITICAL, HIGH, MEDIUM, LOW
}

type ThreatActor struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Aliases     []string `json:"aliases"`
	Motivation  string   `json:"motivation"`
	Sophistication string `json:"sophistication"`
	AssociatedIndicators []string `json:"associated_indicators"`
}

type STIXBundle struct {
	Type        string          `json:"type"`
	ID          string          `json:"id"`
	SpecVersion string          `json:"spec_version"`
	Objects     []STIXIndicator `json:"objects"`
	CreatedAt   time.Time       `json:"created_at"`
}

type MatchResult struct {
	UCR         string          `json:"ucr"`
	Matched     bool            `json:"matched"`
	Indicators  []STIXIndicator `json:"indicators"`
	RiskScore   int             `json:"risk_score"`
	ThreatTypes []string        `json:"threat_types"`
	Explanation string          `json:"explanation"`
}

type EnrichedAlert struct {
	AlertID     string          `json:"alert_id"`
	Indicators  []STIXIndicator `json:"indicators"`
	ThreatActors []ThreatActor  `json:"threat_actors"`
	RiskMultiplier float64      `json:"risk_multiplier"`
	EnrichedAt  time.Time       `json:"enriched_at"`
}

// ─── In-Memory Store ─────────────────────────────────────────────────────────

type Store struct {
	mu         sync.RWMutex
	indicators map[string]*STIXIndicator
	actors     map[string]*ThreatActor
	lastSync   time.Time
}

var store = &Store{
	indicators: make(map[string]*STIXIndicator),
	actors:     make(map[string]*ThreatActor),
}

func seedStore() {
	now := time.Now()
	future := now.Add(365 * 24 * time.Hour)

	indicators := []*STIXIndicator{
		{
			ID: "indicator--" + uuid.New().String(), Type: "indicator",
			Name: "Suspected Narcotics HS Code Pattern", Pattern: "[trade:hs_code MATCHES '2939']",
			PatternType: "stix", ValidFrom: now, ValidUntil: &future,
			Confidence: 85, Labels: []string{"drug-trafficking", "narcotics"},
			Description: "HS code 2939.xx frequently associated with narcotics concealment",
			HSCodes: []string{"2939.99", "2939.11", "2939.20"},
			ThreatType: "DRUG", Severity: "HIGH", CreatedAt: now,
		},
		{
			ID: "indicator--" + uuid.New().String(), Type: "indicator",
			Name: "Sanctioned Entity — Acme Trading Co", Pattern: "[trade:trader_name = 'Acme Trading Co']",
			PatternType: "stix", ValidFrom: now, ValidUntil: &future,
			Confidence: 95, Labels: []string{"sanctions", "ofac"},
			Description: "Entity listed on OFAC SDN list as of 2025-01-15",
			TraderEntities: []string{"Acme Trading Co", "ACME TRADING COMPANY"},
			ThreatType: "SANCTIONS", Severity: "CRITICAL", CreatedAt: now,
		},
		{
			ID: "indicator--" + uuid.New().String(), Type: "indicator",
			Name: "High-Risk Origin Route: CO→GH via NG", Pattern: "[trade:route MATCHES 'CO.*NG.*GH']",
			PatternType: "stix", ValidFrom: now, ValidUntil: &future,
			Confidence: 78, Labels: []string{"drug-trafficking", "high-risk-route"},
			Description: "Colombia→Nigeria→Ghana route associated with cocaine transshipment",
			OriginCountries: []string{"CO"},
			ThreatType: "DRUG", Severity: "HIGH", CreatedAt: now,
		},
		{
			ID: "indicator--" + uuid.New().String(), Type: "indicator",
			Name: "Counterfeit Electronics Pattern", Pattern: "[trade:hs_code MATCHES '8471|8517']",
			PatternType: "stix", ValidFrom: now, ValidUntil: &future,
			Confidence: 72, Labels: []string{"counterfeiting", "ipr"},
			Description: "HS codes 8471/8517 with origin CN showing high counterfeit rate",
			HSCodes: []string{"8471.30", "8517.12", "8471.41"},
			OriginCountries: []string{"CN"},
			ThreatType: "COUNTERFEITING", Severity: "MEDIUM", CreatedAt: now,
		},
		{
			ID: "indicator--" + uuid.New().String(), Type: "indicator",
			Name: "Dual-Use Export Control — Missile Components", Pattern: "[trade:hs_code MATCHES '8803|8802']",
			PatternType: "stix", ValidFrom: now, ValidUntil: &future,
			Confidence: 90, Labels: []string{"weapons", "dual-use", "export-control"},
			Description: "Aerospace components subject to Wassenaar Arrangement export controls",
			HSCodes: []string{"8803.30", "8802.60", "8803.10"},
			ThreatType: "WEAPONS", Severity: "CRITICAL", CreatedAt: now,
		},
	}

	actors := []*ThreatActor{
		{
			ID: "threat-actor--" + uuid.New().String(),
			Name: "Cartel Norte", Aliases: []string{"CN Group", "Norte Cartel"},
			Motivation: "financial-gain", Sophistication: "advanced",
			AssociatedIndicators: []string{indicators[0].ID, indicators[2].ID},
		},
		{
			ID: "threat-actor--" + uuid.New().String(),
			Name: "Shadow IPR Network", Aliases: []string{"SIPR"},
			Motivation: "financial-gain", Sophistication: "intermediate",
			AssociatedIndicators: []string{indicators[3].ID},
		},
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	for _, ind := range indicators {
		store.indicators[ind.ID] = ind
	}
	for _, actor := range actors {
		store.actors[actor.ID] = actor
	}
	store.lastSync = time.Now()
}

// ─── Matching Engine ─────────────────────────────────────────────────────────

type DeclarationMatchRequest struct {
	UCR           string   `json:"ucr" binding:"required"`
	HSCodes       []string `json:"hs_codes"`
	TraderName    string   `json:"trader_name"`
	OriginCountry string   `json:"origin_country"`
	DestCountry   string   `json:"dest_country"`
	RouteCountries []string `json:"route_countries"`
}

func matchDeclaration(req DeclarationMatchRequest) MatchResult {
	store.mu.RLock()
	defer store.mu.RUnlock()

	var matched []STIXIndicator
	threatTypes := map[string]bool{}
	riskScore := 0

	for _, ind := range store.indicators {
		hit := false
		// HS code matching
		for _, hs := range req.HSCodes {
			for _, indHS := range ind.HSCodes {
				if strings.HasPrefix(hs, indHS[:4]) {
					hit = true
					break
				}
			}
		}
		// Trader entity matching
		if !hit && req.TraderName != "" {
			for _, entity := range ind.TraderEntities {
				if strings.EqualFold(req.TraderName, entity) {
					hit = true
					break
				}
			}
		}
		// Origin country matching
		if !hit {
			for _, oc := range ind.OriginCountries {
				if strings.EqualFold(req.OriginCountry, oc) {
					hit = true
					break
				}
			}
		}
		if hit {
			matched = append(matched, *ind)
			threatTypes[ind.ThreatType] = true
			switch ind.Severity {
			case "CRITICAL":
				riskScore += 40
			case "HIGH":
				riskScore += 25
			case "MEDIUM":
				riskScore += 15
			case "LOW":
				riskScore += 5
			}
		}
	}

	if riskScore > 100 {
		riskScore = 100
	}

	types := []string{}
	for t := range threatTypes {
		types = append(types, t)
	}

	explanation := "No threat indicators matched."
	if len(matched) > 0 {
		explanation = fmt.Sprintf("%d STIX indicator(s) matched. Threat types: %s. Risk contribution: %d points.",
			len(matched), strings.Join(types, ", "), riskScore)
	}

	return MatchResult{
		UCR:         req.UCR,
		Matched:     len(matched) > 0,
		Indicators:  matched,
		RiskScore:   riskScore,
		ThreatTypes: types,
		Explanation: explanation,
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func handleGetIndicators(c *gin.Context) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	indicators := make([]STIXIndicator, 0, len(store.indicators))
	for _, ind := range store.indicators {
		indicators = append(indicators, *ind)
	}
	c.JSON(http.StatusOK, gin.H{
		"indicators": indicators,
		"count":      len(indicators),
		"last_sync":  store.lastSync,
	})
}

func handleMatchDeclaration(c *gin.Context) {
	var req DeclarationMatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := matchDeclaration(req)
	c.JSON(http.StatusOK, result)
}

func handleEnrichAlert(c *gin.Context) {
	var body struct {
		AlertID       string   `json:"alert_id" binding:"required"`
		UCR           string   `json:"ucr"`
		HSCodes       []string `json:"hs_codes"`
		TraderName    string   `json:"trader_name"`
		OriginCountry string   `json:"origin_country"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	matchReq := DeclarationMatchRequest{
		UCR:           body.UCR,
		HSCodes:       body.HSCodes,
		TraderName:    body.TraderName,
		OriginCountry: body.OriginCountry,
	}
	matchResult := matchDeclaration(matchReq)

	// Find associated threat actors
	store.mu.RLock()
	var relatedActors []ThreatActor
	for _, actor := range store.actors {
		for _, ind := range matchResult.Indicators {
			for _, assocID := range actor.AssociatedIndicators {
				if assocID == ind.ID {
					relatedActors = append(relatedActors, *actor)
					break
				}
			}
		}
	}
	store.mu.RUnlock()

	multiplier := 1.0
	if matchResult.RiskScore > 0 {
		multiplier = 1.0 + float64(matchResult.RiskScore)/100.0
	}

	c.JSON(http.StatusOK, EnrichedAlert{
		AlertID:        body.AlertID,
		Indicators:     matchResult.Indicators,
		ThreatActors:   relatedActors,
		RiskMultiplier: multiplier,
		EnrichedAt:     time.Now(),
	})
}

func handleExportSTIX(c *gin.Context) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	objects := make([]STIXIndicator, 0, len(store.indicators))
	for _, ind := range store.indicators {
		objects = append(objects, *ind)
	}

	bundle := STIXBundle{
		Type:        "bundle",
		ID:          "bundle--" + uuid.New().String(),
		SpecVersion: "2.1",
		Objects:     objects,
		CreatedAt:   time.Now(),
	}
	c.JSON(http.StatusOK, bundle)
}

func handleGetStats(c *gin.Context) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	bySeverity := map[string]int{}
	byThreatType := map[string]int{}
	for _, ind := range store.indicators {
		bySeverity[ind.Severity]++
		byThreatType[ind.ThreatType]++
	}

	c.JSON(http.StatusOK, gin.H{
		"total_indicators": len(store.indicators),
		"total_actors":     len(store.actors),
		"by_severity":      bySeverity,
		"by_threat_type":   byThreatType,
		"last_sync":        store.lastSync,
	})
}

func handleIngestIndicators(c *gin.Context) {
	var body struct {
		Indicators []STIXIndicator `json:"indicators" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	store.mu.Lock()
	for i := range body.Indicators {
		ind := &body.Indicators[i]
		if ind.ID == "" {
			ind.ID = "indicator--" + uuid.New().String()
		}
		ind.CreatedAt = time.Now()
		store.indicators[ind.ID] = ind
	}
	store.lastSync = time.Now()
	store.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"ingested": len(body.Indicators),
		"message":  "Indicators ingested successfully",
	})
}

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "opencti-svc",
		"version":   "1.0.0",
		"timestamp": time.Now(),
	})
}

// ─── JSON Serialization Helper ────────────────────────────────────────────────

func prettyJSON(v any) string {
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8099"
	}

	// Seed with initial threat intelligence data
	seedStore()
	log.Printf("[opencti-svc] Seeded %d STIX indicators", len(store.indicators))

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/health", handleHealth)
	r.GET("/indicators", handleGetIndicators)
	r.POST("/indicators/ingest", handleIngestIndicators)
	r.POST("/match", handleMatchDeclaration)
	r.POST("/enrich", handleEnrichAlert)
	r.GET("/export/stix", handleExportSTIX)
	r.GET("/stats", handleGetStats)

	log.Printf("[opencti-svc] Starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[opencti-svc] Failed to start: %v", err)
	}

	_ = prettyJSON
}
