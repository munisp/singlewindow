// cen-service — WCO Customs Enforcement Network (CEN) Integration
// Handles outbound risk alert dispatch and inbound alert ingestion
// using WCO CEN XML v2.0 message format.
package main

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── WCO CEN XML Types ────────────────────────────────────────────────────────

type CENAlert struct {
	XMLName     xml.Name    `xml:"CEN_Alert" json:"-"`
	Xmlns       string      `xml:"xmlns,attr" json:"-"`
	Version     string      `xml:"version,attr" json:"-"`
	AlertID     string      `xml:"AlertID"`
	SenderCode  string      `xml:"SenderCode"`
	ReceiverCode string     `xml:"ReceiverCode"`
	AlertType   string      `xml:"AlertType"`   // RISK_PROFILE, SEIZURE, WANTED_PERSON, VESSEL_WATCH
	Priority    string      `xml:"Priority"`    // HIGH, MEDIUM, LOW
	Subject     string      `xml:"Subject"`
	Description string      `xml:"Description"`
	TraderRef   string      `xml:"TraderRef,omitempty"`
	UCR         string      `xml:"UCR,omitempty"`
	HSCode      string      `xml:"HSCode,omitempty"`
	VesselIMO   string      `xml:"VesselIMO,omitempty"`
	ContainerID string      `xml:"ContainerID,omitempty"`
	OriginPort  string      `xml:"OriginPort,omitempty"`
	DestPort    string      `xml:"DestPort,omitempty"`
	RiskScore   float64     `xml:"RiskScore,omitempty"`
	CreatedAt   string      `xml:"CreatedAt"`
	ExpiresAt   string      `xml:"ExpiresAt,omitempty"`
	Status      string      `xml:"Status"` // ACTIVE, ACKNOWLEDGED, RESOLVED, EXPIRED
}

// ─── Partner Customs Administration Registry ──────────────────────────────────

type PartnerAdmin struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Region      string `json:"region"`
	GatewayURL  string `json:"gatewayUrl"`
	Protocol    string `json:"protocol"` // CEN-API-v2, CEN-API-v1
	IsActive    bool   `json:"isActive"`
	LastPingMs  int    `json:"lastPingMs"`
}

var partnerRegistry = []PartnerAdmin{
	// Africa
	{Code: "GH", Name: "Ghana Revenue Authority", Region: "Africa", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "NG", Name: "Nigeria Customs Service", Region: "Africa", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "KE", Name: "Kenya Revenue Authority", Region: "Africa", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "ZA", Name: "South African Revenue Service", Region: "Africa", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "ET", Name: "Ethiopian Revenues and Customs Authority", Region: "Africa", Protocol: "CEN-API-v1", IsActive: true},
	{Code: "TZ", Name: "Tanzania Revenue Authority", Region: "Africa", Protocol: "CEN-API-v1", IsActive: true},
	{Code: "UG", Name: "Uganda Revenue Authority", Region: "Africa", Protocol: "CEN-API-v1", IsActive: true},
	{Code: "RW", Name: "Rwanda Revenue Authority", Region: "Africa", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "SN", Name: "Direction Générale des Douanes du Sénégal", Region: "Africa", Protocol: "CEN-API-v1", IsActive: false},
	{Code: "CI", Name: "Direction Générale des Douanes de Côte d'Ivoire", Region: "Africa", Protocol: "CEN-API-v1", IsActive: true},
	// Asia-Pacific
	{Code: "SG", Name: "Singapore Customs", Region: "Asia-Pacific", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "MY", Name: "Royal Malaysian Customs Department", Region: "Asia-Pacific", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "TH", Name: "Thai Customs Department", Region: "Asia-Pacific", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "ID", Name: "Directorate General of Customs and Excise Indonesia", Region: "Asia-Pacific", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "PH", Name: "Bureau of Customs Philippines", Region: "Asia-Pacific", Protocol: "CEN-API-v1", IsActive: true},
	{Code: "VN", Name: "General Department of Vietnam Customs", Region: "Asia-Pacific", Protocol: "CEN-API-v1", IsActive: true},
	{Code: "JP", Name: "Japan Customs", Region: "Asia-Pacific", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "KR", Name: "Korea Customs Service", Region: "Asia-Pacific", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "CN", Name: "General Administration of Customs China", Region: "Asia-Pacific", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "IN", Name: "Central Board of Indirect Taxes and Customs India", Region: "Asia-Pacific", Protocol: "CEN-API-v2", IsActive: true},
	// Europe
	{Code: "GB", Name: "His Majesty's Revenue and Customs", Region: "Europe", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "DE", Name: "Bundeszollverwaltung Germany", Region: "Europe", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "FR", Name: "Direction Générale des Douanes et Droits Indirects France", Region: "Europe", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "NL", Name: "Douane Netherlands", Region: "Europe", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "BE", Name: "Administration générale des douanes et accises Belgium", Region: "Europe", Protocol: "CEN-API-v2", IsActive: true},
	// Americas
	{Code: "US", Name: "US Customs and Border Protection", Region: "Americas", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "CA", Name: "Canada Border Services Agency", Region: "Americas", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "BR", Name: "Receita Federal do Brasil", Region: "Americas", Protocol: "CEN-API-v1", IsActive: true},
	{Code: "MX", Name: "Servicio de Administración Tributaria Mexico", Region: "Americas", Protocol: "CEN-API-v1", IsActive: true},
	// Middle East
	{Code: "AE", Name: "Federal Customs Authority UAE", Region: "Middle East", Protocol: "CEN-API-v2", IsActive: true},
	{Code: "SA", Name: "Zakat, Tax and Customs Authority Saudi Arabia", Region: "Middle East", Protocol: "CEN-API-v2", IsActive: true},
}

// ─── In-Memory Alert Store ────────────────────────────────────────────────────

type AlertRecord struct {
	ID           string    `json:"id"`
	Direction    string    `json:"direction"` // OUTBOUND, INBOUND
	PartnerCode  string    `json:"partnerCode"`
	AlertType    string    `json:"alertType"`
	Priority     string    `json:"priority"`
	Subject      string    `json:"subject"`
	Description  string    `json:"description"`
	TraderRef    string    `json:"traderRef,omitempty"`
	UCR          string    `json:"ucr,omitempty"`
	HSCode       string    `json:"hsCode,omitempty"`
	RiskScore    float64   `json:"riskScore,omitempty"`
	Status       string    `json:"status"`
	XMLPayload   string    `json:"xmlPayload,omitempty"`
	CorrelatedWith []string `json:"correlatedWith,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type CorrelationResult struct {
	AlertID        string   `json:"alertId"`
	MatchedAlerts  []string `json:"matchedAlerts"`
	CorrelationScore float64 `json:"correlationScore"`
	Reason         string   `json:"reason"`
}

// Phase 24: alerts are persisted in PostgreSQL (cen_alerts) via pgx/v5.
// The service is FAIL-CLOSED: it refuses to start without DATABASE_URL and
// never falls back to an in-memory store.
var db *pgxpool.Pool

const alertColumns = `id, direction, partner_code, alert_type, priority, subject, description,
	trader_ref, ucr, hs_code, risk_score, status, xml_payload, correlated_with, created_at, updated_at`

// scanAlert scans one cen_alerts row (selected with alertColumns) into an AlertRecord.
func scanAlert(row pgx.Row) (*AlertRecord, error) {
	var a AlertRecord
	var correlated []byte
	err := row.Scan(&a.ID, &a.Direction, &a.PartnerCode, &a.AlertType, &a.Priority,
		&a.Subject, &a.Description, &a.TraderRef, &a.UCR, &a.HSCode, &a.RiskScore,
		&a.Status, &a.XMLPayload, &correlated, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if len(correlated) > 0 {
		_ = json.Unmarshal(correlated, &a.CorrelatedWith)
	}
	return &a, nil
}

// insertAlert persists a new alert record.
func insertAlert(ctx context.Context, a *AlertRecord) error {
	correlated, err := json.Marshal(a.CorrelatedWith)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `INSERT INTO cen_alerts (`+alertColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		a.ID, a.Direction, a.PartnerCode, a.AlertType, a.Priority, a.Subject,
		a.Description, a.TraderRef, a.UCR, a.HSCode, a.RiskScore, a.Status,
		a.XMLPayload, correlated, a.CreatedAt, a.UpdatedAt)
	return err
}

// loadAllAlerts fetches every alert (used by the correlation engine).
func loadAllAlerts(ctx context.Context) ([]*AlertRecord, error) {
	rows, err := db.Query(ctx, `SELECT `+alertColumns+` FROM cen_alerts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AlertRecord
	for rows.Next() {
		a, err := scanAlert(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ─── CEN XML Builder ──────────────────────────────────────────────────────────

func buildCENXML(alert *AlertRecord) (string, error) {
	cenAlert := CENAlert{
		Xmlns:       "urn:wco:datamodel:WCO:CEN:2",
		Version:     "2.0",
		AlertID:     alert.ID,
		SenderCode:  "GH-NGSWTP",
		ReceiverCode: alert.PartnerCode,
		AlertType:   alert.AlertType,
		Priority:    alert.Priority,
		Subject:     alert.Subject,
		Description: alert.Description,
		TraderRef:   alert.TraderRef,
		UCR:         alert.UCR,
		HSCode:      alert.HSCode,
		RiskScore:   alert.RiskScore,
		CreatedAt:   alert.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt:   alert.CreatedAt.Add(90 * 24 * time.Hour).UTC().Format(time.RFC3339),
		Status:      alert.Status,
	}
	out, err := xml.MarshalIndent(cenAlert, "", "  ")
	if err != nil {
		return "", err
	}
	return xml.Header + string(out), nil
}

// ─── Alert Correlation Engine ─────────────────────────────────────────────────

func correlateAlert(incoming *AlertRecord) CorrelationResult {
	existing, err := loadAllAlerts(context.Background())
	if err != nil {
		log.Printf("[CEN Service] correlation query failed: %v", err)
		return CorrelationResult{
			AlertID:          incoming.ID,
			MatchedAlerts:    []string{},
			CorrelationScore: 0,
			Reason:           "Correlation unavailable: alert store query failed",
		}
	}

	var matches []string
	var totalScore float64

	for _, existing := range existing {
		id := existing.ID
		if id == incoming.ID {
			continue
		}
		score := 0.0

		// Same trader reference
		if incoming.TraderRef != "" && existing.TraderRef == incoming.TraderRef {
			score += 0.4
		}
		// Same UCR
		if incoming.UCR != "" && existing.UCR == incoming.UCR {
			score += 0.5
		}
		// Same HS code chapter (first 4 digits)
		if len(incoming.HSCode) >= 4 && len(existing.HSCode) >= 4 &&
			incoming.HSCode[:4] == existing.HSCode[:4] {
			score += 0.2
		}
		// Same alert type
		if incoming.AlertType == existing.AlertType {
			score += 0.1
		}
		// High risk score correlation
		if incoming.RiskScore > 0.7 && existing.RiskScore > 0.7 {
			score += 0.15
		}
		// Recent alert (within 30 days)
		if time.Since(existing.CreatedAt) < 30*24*time.Hour {
			score += 0.05
		}

		if score >= 0.3 {
			matches = append(matches, id)
			totalScore += score
		}
	}

	avgScore := 0.0
	if len(matches) > 0 {
		avgScore = totalScore / float64(len(matches))
	}

	reason := "No significant correlations found"
	if len(matches) > 0 {
		parts := []string{}
		if incoming.TraderRef != "" {
			parts = append(parts, "shared trader reference")
		}
		if incoming.UCR != "" {
			parts = append(parts, "matching UCR")
		}
		if len(parts) > 0 {
			reason = fmt.Sprintf("Correlated on: %s", strings.Join(parts, ", "))
		} else {
			reason = fmt.Sprintf("Pattern match across %d existing alerts", len(matches))
		}
	}

	return CorrelationResult{
		AlertID:        incoming.ID,
		MatchedAlerts:  matches,
		CorrelationScore: math.Round(avgScore*100) / 100,
		Reason:         reason,
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func getPartners(c *gin.Context) {
	region := c.Query("region")
	activeOnly := c.Query("activeOnly") == "true"

	result := []PartnerAdmin{}
	for _, p := range partnerRegistry {
		if region != "" && p.Region != region {
			continue
		}
		if activeOnly && !p.IsActive {
			continue
		}
		// Simulate ping latency
		p.LastPingMs = 50 + rand.Intn(400)
		result = append(result, p)
	}
	c.JSON(http.StatusOK, gin.H{"partners": result, "total": len(result)})
}

func sendAlert(c *gin.Context) {
	var req struct {
		PartnerCode string  `json:"partnerCode" binding:"required"`
		AlertType   string  `json:"alertType" binding:"required"`
		Priority    string  `json:"priority" binding:"required"`
		Subject     string  `json:"subject" binding:"required"`
		Description string  `json:"description" binding:"required"`
		TraderRef   string  `json:"traderRef"`
		UCR         string  `json:"ucr"`
		HSCode      string  `json:"hsCode"`
		RiskScore   float64 `json:"riskScore"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate partner exists
	found := false
	for _, p := range partnerRegistry {
		if p.Code == req.PartnerCode && p.IsActive {
			found = true
			break
		}
	}
	if !found {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("partner %s not found or inactive", req.PartnerCode)})
		return
	}

	alert := &AlertRecord{
		ID:          "CEN-" + strings.ToUpper(uuid.New().String()[:8]),
		Direction:   "OUTBOUND",
		PartnerCode: req.PartnerCode,
		AlertType:   req.AlertType,
		Priority:    req.Priority,
		Subject:     req.Subject,
		Description: req.Description,
		TraderRef:   req.TraderRef,
		UCR:         req.UCR,
		HSCode:      req.HSCode,
		RiskScore:   req.RiskScore,
		Status:      "SENT",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	xmlPayload, err := buildCENXML(alert)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build CEN XML"})
		return
	}
	alert.XMLPayload = xmlPayload

	if err := insertAlert(c.Request.Context(), alert); err != nil {
		log.Printf("[CEN Service] failed to persist outbound alert: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist alert"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"alert": alert, "xmlPayload": xmlPayload})
}

func receiveAlert(c *gin.Context) {
	var req struct {
		SenderCode  string  `json:"senderCode" binding:"required"`
		AlertType   string  `json:"alertType" binding:"required"`
		Priority    string  `json:"priority" binding:"required"`
		Subject     string  `json:"subject" binding:"required"`
		Description string  `json:"description" binding:"required"`
		TraderRef   string  `json:"traderRef"`
		UCR         string  `json:"ucr"`
		HSCode      string  `json:"hsCode"`
		RiskScore   float64 `json:"riskScore"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	alert := &AlertRecord{
		ID:          "CEN-IN-" + strings.ToUpper(uuid.New().String()[:8]),
		Direction:   "INBOUND",
		PartnerCode: req.SenderCode,
		AlertType:   req.AlertType,
		Priority:    req.Priority,
		Subject:     req.Subject,
		Description: req.Description,
		TraderRef:   req.TraderRef,
		UCR:         req.UCR,
		HSCode:      req.HSCode,
		RiskScore:   req.RiskScore,
		Status:      "RECEIVED",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	// Auto-correlate on ingestion
	correlation := correlateAlert(alert)
	alert.CorrelatedWith = correlation.MatchedAlerts

	if err := insertAlert(c.Request.Context(), alert); err != nil {
		log.Printf("[CEN Service] failed to persist inbound alert: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist alert"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"alert": alert, "correlation": correlation})
}

func listAlerts(c *gin.Context) {
	direction := c.Query("direction") // OUTBOUND, INBOUND, or empty for all
	priority := c.Query("priority")
	alertType := c.Query("alertType")

	query := `SELECT ` + alertColumns + ` FROM cen_alerts WHERE ($1 = '' OR direction = $1) AND ($2 = '' OR priority = $2) AND ($3 = '' OR alert_type = $3)`
	rows, err := db.Query(c.Request.Context(), query, direction, priority, alertType)
	if err != nil {
		log.Printf("[CEN Service] list alerts query failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query alerts"})
		return
	}
	defer rows.Close()

	result := []*AlertRecord{}
	for rows.Next() {
		a, err := scanAlert(rows)
		if err != nil {
			log.Printf("[CEN Service] scan alert failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query alerts"})
			return
		}
		result = append(result, a)
	}

	// Sort by createdAt descending
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})

	c.JSON(http.StatusOK, gin.H{"alerts": result, "total": len(result)})
}

func correlateAlerts(c *gin.Context) {
	alertID := c.Param("id")

	alert, err := scanAlert(db.QueryRow(c.Request.Context(),
		`SELECT `+alertColumns+` FROM cen_alerts WHERE id = $1`, alertID))
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "alert not found"})
		return
	}
	if err != nil {
		log.Printf("[CEN Service] get alert failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query alert"})
		return
	}

	result := correlateAlert(alert)
	c.JSON(http.StatusOK, result)
}

func acknowledgeAlert(c *gin.Context) {
	alertID := c.Param("id")

	now := time.Now()
	alert, err := scanAlert(db.QueryRow(c.Request.Context(),
		`UPDATE cen_alerts SET status = 'ACKNOWLEDGED', updated_at = $2 WHERE id = $1 RETURNING `+alertColumns,
		alertID, now))
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "alert not found"})
		return
	}
	if err != nil {
		log.Printf("[CEN Service] acknowledge alert failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update alert"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"alert": alert})
}

func getStats(c *gin.Context) {
	alerts, err := loadAllAlerts(c.Request.Context())
	if err != nil {
		log.Printf("[CEN Service] stats query failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute stats"})
		return
	}

	stats := map[string]interface{}{
		"total":      len(alerts),
		"outbound":   0,
		"inbound":    0,
		"high":       0,
		"medium":     0,
		"low":        0,
		"active":     0,
		"acknowledged": 0,
	}

	for _, a := range alerts {
		if a.Direction == "OUTBOUND" {
			stats["outbound"] = stats["outbound"].(int) + 1
		} else {
			stats["inbound"] = stats["inbound"].(int) + 1
		}
		switch a.Priority {
		case "HIGH":
			stats["high"] = stats["high"].(int) + 1
		case "MEDIUM":
			stats["medium"] = stats["medium"].(int) + 1
		case "LOW":
			stats["low"] = stats["low"].(int) + 1
		}
		if a.Status == "SENT" || a.Status == "RECEIVED" {
			stats["active"] = stats["active"].(int) + 1
		} else if a.Status == "ACKNOWLEDGED" {
			stats["acknowledged"] = stats["acknowledged"].(int) + 1
		}
	}

	activePartners := 0
	for _, p := range partnerRegistry {
		if p.IsActive {
			activePartners++
		}
	}
	stats["activePartners"] = activePartners
	stats["totalPartners"] = len(partnerRegistry)

	c.JSON(http.StatusOK, stats)
}

func healthCheck(c *gin.Context) {
	var one int
	if err := db.QueryRow(c.Request.Context(), "SELECT 1").Scan(&one); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":    "unhealthy",
			"service":   "cen-service",
			"version":   "1.0.0",
			"partners":  len(partnerRegistry),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "cen-service",
		"version":   "1.0.0",
		"partners":  len(partnerRegistry),
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		// Default 8093 per the gateway PORTS registry (SW-MP8). Previously
		// 8097, which collided with profile-service (P0-7).
		port = "8093"
	}

	// Fail-closed: no database, no service. Never fall back to memory.
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("[CEN Service] DATABASE_URL is required; refusing to start (fail-closed)")
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("[CEN Service] Invalid DATABASE_URL: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("[CEN Service] Database unreachable: %v (fail-closed, refusing to start)", err)
	}
	db = pool
	log.Printf("[CEN Service] Connected to PostgreSQL")

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	// Phase 26 F1: fail-closed Keycloak JWT authz on all non-probe routes.
	r.Use(authGuard())

	r.GET("/health", healthCheck)
	r.GET("/partners", getPartners)
	r.POST("/alerts/send", sendAlert)
	r.POST("/alerts/receive", receiveAlert)
	r.GET("/alerts", listAlerts)
	r.GET("/alerts/:id/correlate", correlateAlerts)
	r.PUT("/alerts/:id/acknowledge", acknowledgeAlert)
	r.GET("/stats", getStats)

	log.Printf("[CEN Service] Starting on port %s with %d partner administrations", port, len(partnerRegistry))
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start: %v", err)
	}
}
