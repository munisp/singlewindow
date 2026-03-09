// cen-service — WCO Customs Enforcement Network (CEN) Integration
// Handles outbound risk alert dispatch and inbound alert ingestion
// using WCO CEN XML v2.0 message format.
package main

import (
	"encoding/xml"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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

var (
	alertStore   = make(map[string]*AlertRecord)
	alertStoreMu sync.RWMutex
)

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
	alertStoreMu.RLock()
	defer alertStoreMu.RUnlock()

	var matches []string
	var totalScore float64

	for id, existing := range alertStore {
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

	alertStoreMu.Lock()
	alertStore[alert.ID] = alert
	alertStoreMu.Unlock()

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

	alertStoreMu.Lock()
	alertStore[alert.ID] = alert
	alertStoreMu.Unlock()

	c.JSON(http.StatusCreated, gin.H{"alert": alert, "correlation": correlation})
}

func listAlerts(c *gin.Context) {
	direction := c.Query("direction") // OUTBOUND, INBOUND, or empty for all
	priority := c.Query("priority")
	alertType := c.Query("alertType")

	alertStoreMu.RLock()
	defer alertStoreMu.RUnlock()

	result := []*AlertRecord{}
	for _, a := range alertStore {
		if direction != "" && a.Direction != direction {
			continue
		}
		if priority != "" && a.Priority != priority {
			continue
		}
		if alertType != "" && a.AlertType != alertType {
			continue
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

	alertStoreMu.RLock()
	alert, exists := alertStore[alertID]
	alertStoreMu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "alert not found"})
		return
	}

	result := correlateAlert(alert)
	c.JSON(http.StatusOK, result)
}

func acknowledgeAlert(c *gin.Context) {
	alertID := c.Param("id")

	alertStoreMu.Lock()
	defer alertStoreMu.Unlock()

	alert, exists := alertStore[alertID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "alert not found"})
		return
	}

	alert.Status = "ACKNOWLEDGED"
	alert.UpdatedAt = time.Now()
	c.JSON(http.StatusOK, gin.H{"alert": alert})
}

func getStats(c *gin.Context) {
	alertStoreMu.RLock()
	defer alertStoreMu.RUnlock()

	stats := map[string]interface{}{
		"total":      len(alertStore),
		"outbound":   0,
		"inbound":    0,
		"high":       0,
		"medium":     0,
		"low":        0,
		"active":     0,
		"acknowledged": 0,
	}

	for _, a := range alertStore {
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
		port = "8097"
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

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
