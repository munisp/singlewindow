// wazuh-svc — Wazuh SIEM/XDR Integration Service
// Provides login anomaly detection, API key abuse detection,
// privilege escalation playbooks, and security score computation
// for the TradeGateway NGSWTP platform.
package main

import (
	"log"
	"math"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type AlertSeverity string

const (
	SeverityCritical AlertSeverity = "CRITICAL"
	SeverityHigh     AlertSeverity = "HIGH"
	SeverityMedium   AlertSeverity = "MEDIUM"
	SeverityLow      AlertSeverity = "LOW"
)

type WazuhAlert struct {
	ID          string        `json:"id"`
	RuleID      int           `json:"rule_id"`
	RuleName    string        `json:"rule_name"`
	Description string        `json:"description"`
	Severity    AlertSeverity `json:"severity"`
	AgentID     string        `json:"agent_id"`
	AgentName   string        `json:"agent_name"`
	UserID      string        `json:"user_id,omitempty"`
	IPAddress   string        `json:"ip_address,omitempty"`
	Category    string        `json:"category"` // AUTH, API_ABUSE, PRIVILEGE_ESC, MALWARE, ANOMALY
	Timestamp   time.Time     `json:"timestamp"`
	Resolved    bool          `json:"resolved"`
	PlaybookID  string        `json:"playbook_id,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type Agent struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	IP       string    `json:"ip"`
	OS       string    `json:"os"`
	Status   string    `json:"status"` // active, disconnected, never_connected
	LastSeen time.Time `json:"last_seen"`
	Version  string    `json:"version"`
	Groups   []string  `json:"groups"`
}

type Playbook struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	TriggerRule int      `json:"trigger_rule"`
	Actions     []string `json:"actions"`
	AutoExecute bool     `json:"auto_execute"`
}

type PlaybookExecution struct {
	ID         string    `json:"id"`
	PlaybookID string    `json:"playbook_id"`
	AlertID    string    `json:"alert_id"`
	Status     string    `json:"status"` // RUNNING, COMPLETED, FAILED
	Actions    []string  `json:"actions_taken"`
	StartedAt  time.Time `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

type LoginEvent struct {
	UserID    string    `json:"user_id"`
	IPAddress string    `json:"ip_address"`
	Country   string    `json:"country"`
	Timestamp time.Time `json:"timestamp"`
	Success   bool      `json:"success"`
}

type AnomalyResult struct {
	Detected    bool          `json:"detected"`
	AnomalyType string        `json:"anomaly_type"`
	Severity    AlertSeverity `json:"severity"`
	Description string        `json:"description"`
	Score       float64       `json:"score"`
}

// ─── Store ────────────────────────────────────────────────────────────────────

type Store struct {
	mu          sync.RWMutex
	alerts      map[string]*WazuhAlert
	agents      map[string]*Agent
	playbooks   map[string]*Playbook
	executions  map[string]*PlaybookExecution
	loginEvents []LoginEvent
}

var store = &Store{
	alerts:    make(map[string]*WazuhAlert),
	agents:    make(map[string]*Agent),
	playbooks: make(map[string]*Playbook),
	executions: make(map[string]*PlaybookExecution),
}

func seedStore() {
	now := time.Now()

	agents := []*Agent{
		{ID: "001", Name: "customs-api-gateway-01", IP: "10.0.1.10", OS: "Ubuntu 22.04", Status: "active", LastSeen: now, Version: "4.7.0", Groups: []string{"api-gateway", "production"}},
		{ID: "002", Name: "customs-db-primary-01", IP: "10.0.2.10", OS: "Ubuntu 22.04", Status: "active", LastSeen: now.Add(-2 * time.Minute), Version: "4.7.0", Groups: []string{"database", "production"}},
		{ID: "003", Name: "keycloak-svc-01", IP: "10.0.3.10", OS: "Ubuntu 22.04", Status: "active", LastSeen: now.Add(-1 * time.Minute), Version: "4.7.0", Groups: []string{"auth", "production"}},
		{ID: "004", Name: "mojaloop-gateway-01", IP: "10.0.4.10", OS: "Ubuntu 22.04", Status: "active", LastSeen: now.Add(-30 * time.Second), Version: "4.7.0", Groups: []string{"payments", "production"}},
		{ID: "005", Name: "risk-engine-01", IP: "10.0.5.10", OS: "Ubuntu 22.04", Status: "disconnected", LastSeen: now.Add(-15 * time.Minute), Version: "4.7.0", Groups: []string{"ml", "production"}},
	}

	playbooks := []*Playbook{
		{
			ID: "pb-001", Name: "Brute Force Response",
			Description: "Auto-block IP after 5 failed logins within 5 minutes",
			TriggerRule: 5710, AutoExecute: true,
			Actions: []string{"block_ip_firewall", "revoke_active_sessions", "notify_owner", "create_incident"},
		},
		{
			ID: "pb-002", Name: "Privilege Escalation Response",
			Description: "Revoke elevated permissions and alert security team",
			TriggerRule: 5902, AutoExecute: true,
			Actions: []string{"revoke_admin_token", "demote_role_to_user", "notify_owner", "create_incident", "require_mfa_reenrollment"},
		},
		{
			ID: "pb-003", Name: "API Key Abuse Response",
			Description: "Suspend API key and rate-limit IP on abuse detection",
			TriggerRule: 9001, AutoExecute: true,
			Actions: []string{"suspend_api_key", "block_ip_rate_limit", "notify_owner"},
		},
		{
			ID: "pb-004", Name: "Impossible Travel Response",
			Description: "Flag account for review when login from geographically impossible location",
			TriggerRule: 5715, AutoExecute: false,
			Actions: []string{"flag_account_for_review", "require_additional_verification", "notify_owner"},
		},
		{
			ID: "pb-005", Name: "Malware Detection Response",
			Description: "Isolate affected agent and trigger forensic scan",
			TriggerRule: 87105, AutoExecute: true,
			Actions: []string{"isolate_agent", "trigger_forensic_scan", "notify_owner", "create_incident"},
		},
	}

	// Seed some sample alerts
	alerts := []*WazuhAlert{
		{
			ID: uuid.New().String(), RuleID: 5710, RuleName: "Multiple failed logins",
			Description: "5 failed login attempts from 192.168.1.100 within 3 minutes",
			Severity: SeverityHigh, AgentID: "003", AgentName: "keycloak-svc-01",
			IPAddress: "192.168.1.100", Category: "AUTH",
			Timestamp: now.Add(-10 * time.Minute), Resolved: false,
			Metadata: map[string]any{"failed_count": 5, "window_minutes": 3},
		},
		{
			ID: uuid.New().String(), RuleID: 9001, RuleName: "API key rate spike",
			Description: "API key ngswtp_prod_abc123 exceeded 1000 req/min (normal: 60)",
			Severity: SeverityMedium, AgentID: "001", AgentName: "customs-api-gateway-01",
			Category: "API_ABUSE",
			Timestamp: now.Add(-5 * time.Minute), Resolved: false,
			Metadata: map[string]any{"key_prefix": "ngswtp_prod_abc", "req_per_min": 1000},
		},
	}

	store.mu.Lock()
	for _, a := range agents {
		store.agents[a.ID] = a
	}
	for _, p := range playbooks {
		store.playbooks[p.ID] = p
	}
	for _, al := range alerts {
		store.alerts[al.ID] = al
	}
	store.mu.Unlock()
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

func detectLoginAnomaly(events []LoginEvent) AnomalyResult {
	if len(events) < 2 {
		return AnomalyResult{Detected: false}
	}

	// Brute force: >5 failures in 5 minutes
	recent := time.Now().Add(-5 * time.Minute)
	failCount := 0
	for _, e := range events {
		if !e.Success && e.Timestamp.After(recent) {
			failCount++
		}
	}
	if failCount >= 5 {
		return AnomalyResult{
			Detected:    true,
			AnomalyType: "BRUTE_FORCE",
			Severity:    SeverityHigh,
			Description: "5+ failed login attempts within 5 minutes",
			Score:       math.Min(float64(failCount)*15, 100),
		}
	}

	// Impossible travel: login from 2 different countries within 1 hour
	oneHourAgo := time.Now().Add(-1 * time.Hour)
	countries := map[string]bool{}
	for _, e := range events {
		if e.Success && e.Timestamp.After(oneHourAgo) && e.Country != "" {
			countries[e.Country] = true
		}
	}
	if len(countries) >= 2 {
		return AnomalyResult{
			Detected:    true,
			AnomalyType: "IMPOSSIBLE_TRAVEL",
			Severity:    SeverityHigh,
			Description: "Successful logins from multiple countries within 1 hour",
			Score:       85,
		}
	}

	// Off-hours login: between 22:00 and 06:00 local
	for _, e := range events {
		if e.Success {
			hour := e.Timestamp.UTC().Hour()
			if hour >= 22 || hour < 6 {
				return AnomalyResult{
					Detected:    true,
					AnomalyType: "OFF_HOURS_LOGIN",
					Severity:    SeverityLow,
					Description: "Login detected outside business hours (22:00–06:00 UTC)",
					Score:       30,
				}
			}
		}
	}

	return AnomalyResult{Detected: false, Score: 0}
}

func computeSecurityScore(alerts []*WazuhAlert, agents []*Agent) int {
	score := 100
	for _, a := range alerts {
		if !a.Resolved {
			switch a.Severity {
			case SeverityCritical:
				score -= 20
			case SeverityHigh:
				score -= 10
			case SeverityMedium:
				score -= 5
			case SeverityLow:
				score -= 2
			}
		}
	}
	disconnected := 0
	for _, ag := range agents {
		if ag.Status == "disconnected" {
			disconnected++
		}
	}
	score -= disconnected * 5
	if score < 0 {
		score = 0
	}
	return score
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func handleGetAlerts(c *gin.Context) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	alerts := make([]*WazuhAlert, 0, len(store.alerts))
	for _, a := range store.alerts {
		alerts = append(alerts, a)
	}
	c.JSON(http.StatusOK, gin.H{"alerts": alerts, "count": len(alerts)})
}

func handleGetAgents(c *gin.Context) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	agents := make([]*Agent, 0, len(store.agents))
	for _, a := range store.agents {
		agents = append(agents, a)
	}
	c.JSON(http.StatusOK, gin.H{"agents": agents, "count": len(agents)})
}

func handleListPlaybooks(c *gin.Context) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	playbooks := make([]*Playbook, 0, len(store.playbooks))
	for _, p := range store.playbooks {
		playbooks = append(playbooks, p)
	}
	c.JSON(http.StatusOK, gin.H{"playbooks": playbooks})
}

func handleTriggerPlaybook(c *gin.Context) {
	var body struct {
		PlaybookID string `json:"playbook_id" binding:"required"`
		AlertID    string `json:"alert_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	store.mu.Lock()
	pb, ok := store.playbooks[body.PlaybookID]
	if !ok {
		store.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "playbook not found"})
		return
	}

	now := time.Now()
	exec := &PlaybookExecution{
		ID:         uuid.New().String(),
		PlaybookID: body.PlaybookID,
		AlertID:    body.AlertID,
		Status:     "COMPLETED",
		Actions:    pb.Actions,
		StartedAt:  now,
		CompletedAt: &now,
	}
	store.executions[exec.ID] = exec

	// Mark alert as resolved
	if al, exists := store.alerts[body.AlertID]; exists {
		al.Resolved = true
		al.PlaybookID = body.PlaybookID
	}
	store.mu.Unlock()

	c.JSON(http.StatusOK, exec)
}

func handleDetectAnomaly(c *gin.Context) {
	var body struct {
		Events []LoginEvent `json:"events" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := detectLoginAnomaly(body.Events)

	// If anomaly detected, create an alert
	if result.Detected {
		store.mu.Lock()
		ruleMap := map[string]int{
			"BRUTE_FORCE":       5710,
			"IMPOSSIBLE_TRAVEL": 5715,
			"OFF_HOURS_LOGIN":   5720,
		}
		alert := &WazuhAlert{
			ID:          uuid.New().String(),
			RuleID:      ruleMap[result.AnomalyType],
			RuleName:    result.AnomalyType,
			Description: result.Description,
			Severity:    result.Severity,
			Category:    "AUTH",
			Timestamp:   time.Now(),
			Resolved:    false,
		}
		store.alerts[alert.ID] = alert
		store.mu.Unlock()
	}

	c.JSON(http.StatusOK, result)
}

func handleGetSecurityScore(c *gin.Context) {
	store.mu.RLock()
	alerts := make([]*WazuhAlert, 0, len(store.alerts))
	for _, a := range store.alerts {
		alerts = append(alerts, a)
	}
	agents := make([]*Agent, 0, len(store.agents))
	for _, a := range store.agents {
		agents = append(agents, a)
	}
	store.mu.RUnlock()

	score := computeSecurityScore(alerts, agents)
	unresolvedCount := 0
	for _, a := range alerts {
		if !a.Resolved {
			unresolvedCount++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"score":            score,
		"grade":            scoreToGrade(score),
		"unresolved_alerts": unresolvedCount,
		"total_agents":     len(agents),
		"computed_at":      time.Now(),
	})
}

func scoreToGrade(score int) string {
	switch {
	case score >= 90:
		return "A"
	case score >= 80:
		return "B"
	case score >= 70:
		return "C"
	case score >= 60:
		return "D"
	default:
		return "F"
	}
}

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "wazuh-svc",
		"version":   "1.0.0",
		"timestamp": time.Now(),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8100"
	}

	seedStore()
	log.Printf("[wazuh-svc] Seeded %d agents, %d playbooks", len(store.agents), len(store.playbooks))

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/health", handleHealth)
	r.GET("/alerts", handleGetAlerts)
	r.GET("/agents", handleGetAgents)
	r.GET("/playbooks", handleListPlaybooks)
	r.POST("/playbooks/trigger", handleTriggerPlaybook)
	r.POST("/detect/anomaly", handleDetectAnomaly)
	r.GET("/security-score", handleGetSecurityScore)

	log.Printf("[wazuh-svc] Starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[wazuh-svc] Failed to start: %v", err)
	}
}
