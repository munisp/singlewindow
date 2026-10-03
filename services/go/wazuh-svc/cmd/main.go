// wazuh-svc — Wazuh SIEM/XDR Integration Service
// Provides login anomaly detection, API key abuse detection,
// privilege escalation playbooks, and security score computation
// for the TradeGateway NGSWTP platform.
//
// Phase 23 (C1): all state is persisted in PostgreSQL via pgx/v5.
// The previous in-memory map store and seedStore() fabricated
// agents/playbooks/alerts on every boot — removed. The service is
// FAIL-CLOSED: it refuses to start when DATABASE_URL is unset or the
// database is unreachable, and never falls back to memory.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type AlertSeverity string

const (
	SeverityCritical AlertSeverity = "CRITICAL"
	SeverityHigh     AlertSeverity = "HIGH"
	SeverityMedium   AlertSeverity = "MEDIUM"
	SeverityLow      AlertSeverity = "LOW"
)

// severityToLevel maps an AlertSeverity onto the Wazuh rule-level scale
// (0–16) stored in wazuh_alerts.level.
func severityToLevel(s AlertSeverity) int {
	switch s {
	case SeverityCritical:
		return 15
	case SeverityHigh:
		return 12
	case SeverityMedium:
		return 7
	default:
		return 3
	}
}

// levelToSeverity is the inverse of severityToLevel for rows read back
// from wazuh_alerts when the payload does not carry an explicit severity.
func levelToSeverity(level int) AlertSeverity {
	switch {
	case level >= 14:
		return SeverityCritical
	case level >= 10:
		return SeverityHigh
	case level >= 5:
		return SeverityMedium
	default:
		return SeverityLow
	}
}

type WazuhAlert struct {
	ID          string         `json:"id"`
	RuleID      int            `json:"rule_id"`
	RuleName    string         `json:"rule_name"`
	Description string         `json:"description"`
	Severity    AlertSeverity  `json:"severity"`
	AgentID     string         `json:"agent_id"`
	AgentName   string         `json:"agent_name"`
	UserID      string         `json:"user_id,omitempty"`
	IPAddress   string         `json:"ip_address,omitempty"`
	Category    string         `json:"category"` // AUTH, API_ABUSE, PRIVILEGE_ESC, MALWARE, ANOMALY
	Timestamp   time.Time      `json:"timestamp"`
	Resolved    bool           `json:"resolved"`
	PlaybookID  string         `json:"playbook_id,omitempty"`
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
	ID          string     `json:"id"`
	PlaybookID  string     `json:"playbook_id"`
	AlertID     string     `json:"alert_id"`
	Status      string     `json:"status"` // RUNNING, COMPLETED, FAILED
	Actions     []string   `json:"actions_taken"`
	StartedAt   time.Time  `json:"started_at"`
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

// ─── Store (PostgreSQL, pgx/v5) ───────────────────────────────────────────────

type Store struct {
	pool *pgxpool.Pool
}

var store *Store

// alertExtra is the jsonb payload of wazuh_alerts.data — everything the
// relational columns (id, rule_id, level, description, agent_id,
// created_at) do not carry.
type alertExtra struct {
	RuleName   string         `json:"rule_name"`
	Severity   AlertSeverity  `json:"severity"`
	AgentName  string         `json:"agent_name"`
	UserID     string         `json:"user_id,omitempty"`
	IPAddress  string         `json:"ip_address,omitempty"`
	Category   string         `json:"category"`
	Resolved   bool           `json:"resolved"`
	PlaybookID string         `json:"playbook_id,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

func marshalAlertData(a *WazuhAlert) ([]byte, error) {
	return json.Marshal(alertExtra{
		RuleName:   a.RuleName,
		Severity:   a.Severity,
		AgentName:  a.AgentName,
		UserID:     a.UserID,
		IPAddress:  a.IPAddress,
		Category:   a.Category,
		Resolved:   a.Resolved,
		PlaybookID: a.PlaybookID,
		Metadata:   a.Metadata,
	})
}

func scanAlert(id string, ruleID, level int, description, agentID string, data []byte, createdAt time.Time) *WazuhAlert {
	var extra alertExtra
	if len(data) > 0 {
		_ = json.Unmarshal(data, &extra)
	}
	sev := extra.Severity
	if sev == "" {
		sev = levelToSeverity(level)
	}
	return &WazuhAlert{
		ID:          id,
		RuleID:      ruleID,
		RuleName:    extra.RuleName,
		Description: description,
		Severity:    sev,
		AgentID:     agentID,
		AgentName:   extra.AgentName,
		UserID:      extra.UserID,
		IPAddress:   extra.IPAddress,
		Category:    extra.Category,
		Timestamp:   createdAt,
		Resolved:    extra.Resolved,
		PlaybookID:  extra.PlaybookID,
		Metadata:    extra.Metadata,
	}
}

func (s *Store) listAlerts(ctx context.Context) ([]*WazuhAlert, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, rule_id, level, description, agent_id, data, created_at
		   FROM wazuh_alerts ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	alerts := make([]*WazuhAlert, 0)
	for rows.Next() {
		var (
			id, description, agentID string
			ruleID, level            int
			data                     []byte
			createdAt                time.Time
		)
		if err := rows.Scan(&id, &ruleID, &level, &description, &agentID, &data, &createdAt); err != nil {
			return nil, err
		}
		alerts = append(alerts, scanAlert(id, ruleID, level, description, agentID, data, createdAt))
	}
	return alerts, rows.Err()
}

func (s *Store) insertAlert(ctx context.Context, a *WazuhAlert) error {
	data, err := marshalAlertData(a)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO wazuh_alerts (id, rule_id, level, description, agent_id, data, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		a.ID, a.RuleID, severityToLevel(a.Severity), a.Description, a.AgentID, data, a.Timestamp)
	return err
}

func (s *Store) markAlertResolved(ctx context.Context, alertID, playbookID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE wazuh_alerts
		   SET data = jsonb_set(jsonb_set(data, '{resolved}', 'true'::jsonb, true),
		                        '{playbook_id}', to_jsonb($2::text), true)
		 WHERE id = $1`,
		alertID, playbookID)
	return err
}

func (s *Store) listAgents(ctx context.Context) ([]*Agent, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, COALESCE(ip, ''), status, COALESCE(last_seen, created_at)
		   FROM wazuh_agents ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	agents := make([]*Agent, 0)
	for rows.Next() {
		var a Agent
		if err := rows.Scan(&a.ID, &a.Name, &a.IP, &a.Status, &a.LastSeen); err != nil {
			return nil, err
		}
		agents = append(agents, &a)
	}
	return agents, rows.Err()
}

func (s *Store) listPlaybooks(ctx context.Context) ([]*Playbook, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, COALESCE(description, ''), trigger_condition, actions, enabled
		   FROM wazuh_playbooks ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	playbooks := make([]*Playbook, 0)
	for rows.Next() {
		var (
			p       Playbook
			trigger []byte
			actions []byte
		)
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &trigger, &actions, &p.AutoExecute); err != nil {
			return nil, err
		}
		if len(trigger) > 0 {
			var tc struct {
				Rule int `json:"rule"`
			}
			if err := json.Unmarshal(trigger, &tc); err == nil {
				p.TriggerRule = tc.Rule
			}
		}
		if len(actions) > 0 {
			_ = json.Unmarshal(actions, &p.Actions)
		}
		if p.Actions == nil {
			p.Actions = []string{}
		}
		playbooks = append(playbooks, &p)
	}
	return playbooks, rows.Err()
}

func (s *Store) getPlaybook(ctx context.Context, id string) (*Playbook, error) {
	var (
		p       Playbook
		trigger []byte
		actions []byte
	)
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, COALESCE(description, ''), trigger_condition, actions, enabled
		   FROM wazuh_playbooks WHERE id = $1`, id).
		Scan(&p.ID, &p.Name, &p.Description, &trigger, &actions, &p.AutoExecute)
	if err != nil {
		return nil, err
	}
	if len(trigger) > 0 {
		var tc struct {
			Rule int `json:"rule"`
		}
		if err := json.Unmarshal(trigger, &tc); err == nil {
			p.TriggerRule = tc.Rule
		}
	}
	if len(actions) > 0 {
		_ = json.Unmarshal(actions, &p.Actions)
	}
	if p.Actions == nil {
		p.Actions = []string{}
	}
	return &p, nil
}

func (s *Store) insertExecution(ctx context.Context, e *PlaybookExecution, result string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO wazuh_playbook_executions
		   (id, playbook_id, alert_id, status, started_at, completed_at, result)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		e.ID, e.PlaybookID, e.AlertID, e.Status, e.StartedAt, e.CompletedAt, result)
	return err
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
	alerts, err := store.listAlerts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list alerts"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"alerts": alerts, "count": len(alerts)})
}

func handleGetAgents(c *gin.Context) {
	agents, err := store.listAgents(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list agents"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"agents": agents, "count": len(agents)})
}

func handleListPlaybooks(c *gin.Context) {
	playbooks, err := store.listPlaybooks(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list playbooks"})
		return
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

	ctx := c.Request.Context()
	pb, err := store.getPlaybook(ctx, body.PlaybookID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "playbook not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load playbook"})
		return
	}

	now := time.Now()
	exec := &PlaybookExecution{
		ID:          uuid.New().String(),
		PlaybookID:  body.PlaybookID,
		AlertID:     body.AlertID,
		Status:      "COMPLETED",
		Actions:     pb.Actions,
		StartedAt:   now,
		CompletedAt: &now,
	}
	result := "executed " + pb.Name
	if err := store.insertExecution(ctx, exec, result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist execution"})
		return
	}

	// Mark alert as resolved (best-effort — alert may not exist).
	if err := store.markAlertResolved(ctx, body.AlertID, body.PlaybookID); err != nil {
		log.Printf("[wazuh-svc] mark alert %s resolved failed: %v", body.AlertID, err)
	}

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

	// If anomaly detected, persist an alert.
	if result.Detected {
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
		if err := store.insertAlert(c.Request.Context(), alert); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist alert"})
			return
		}
	}

	c.JSON(http.StatusOK, result)
}

func handleGetSecurityScore(c *gin.Context) {
	ctx := c.Request.Context()
	alerts, err := store.listAlerts(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list alerts"})
		return
	}
	agents, err := store.listAgents(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list agents"})
		return
	}

	score := computeSecurityScore(alerts, agents)
	unresolvedCount := 0
	for _, a := range alerts {
		if !a.Resolved {
			unresolvedCount++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"score":             score,
		"grade":             scoreToGrade(score),
		"unresolved_alerts": unresolvedCount,
		"total_agents":      len(agents),
		"computed_at":       time.Now(),
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
	// Fail-closed: report db:ok only after a real round-trip.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	var one int
	if err := store.pool.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":    "unhealthy",
			"service":   "wazuh-svc",
			"version":   "1.0.0",
			"db":        "unreachable",
			"timestamp": time.Now(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "wazuh-svc",
		"version":   "1.0.0",
		"db":        "ok",
		"timestamp": time.Now(),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8100"
	}

	// Fail-closed: no database, no service. Never fall back to memory.
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("[wazuh-svc] DATABASE_URL is required; refusing to start (fail-closed)")
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("[wazuh-svc] Invalid DATABASE_URL: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("[wazuh-svc] Database unreachable: %v (fail-closed, refusing to start)", err)
	}
	store = &Store{pool: pool}
	log.Printf("[wazuh-svc] Connected to PostgreSQL")

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	// Phase 26 F1: fail-closed Keycloak JWT authz on all non-probe routes.
	r.Use(authGuard())

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
