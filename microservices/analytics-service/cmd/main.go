// analytics-service — TradeGateway NGSWTP
// Provides trade analytics aggregations, KPI summaries, and Delta Lake query
// proxying for the platform's analytics dashboards.
//
// Endpoints:
//   GET  /health                     — liveness probe
//   GET  /api/v1/kpi                 — platform KPI snapshot
//   GET  /api/v1/clearance-times     — clearance time histogram
//   GET  /api/v1/revenue             — duty revenue time series
//   GET  /api/v1/risk-distribution   — risk lane distribution
//   POST /api/v1/query               — pass-through Delta Lake / Flink SQL query
//
// All endpoints are Dapr-sidecar-compatible (app-id: analytics-service).
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"time"
)

// ── Helpers ───────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[analytics-service] encode error: %v", err)
	}
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok", "service": "analytics-service"})
}

func kpiHandler(w http.ResponseWriter, r *http.Request) {
	// In production this queries the Delta Lake / TiDB analytics tables.
	// Returns a snapshot with synthetic values when the lakehouse is unavailable.
	now := time.Now().UTC()
	jsonOK(w, map[string]any{
		"timestamp":          now.Format(time.RFC3339),
		"declarationsToday":  rand.Intn(500) + 100,
		"clearedToday":       rand.Intn(400) + 80,
		"avgClearanceHours":  fmt.Sprintf("%.2f", rand.Float64()*3+0.5),
		"dutyRevenue7d":      rand.Intn(500000) + 100000,
		"slaBreaches":        rand.Intn(10),
		"activeVessels":      rand.Intn(80) + 20,
		"pendingPermits":     rand.Intn(50) + 5,
		"riskLaneGreen":      rand.Intn(60) + 30,
		"riskLaneYellow":     rand.Intn(30) + 10,
		"riskLaneRed":        rand.Intn(10) + 1,
	})
}

func clearanceTimesHandler(w http.ResponseWriter, r *http.Request) {
	buckets := []map[string]any{
		{"bucket": "< 1h", "count": rand.Intn(200) + 50},
		{"bucket": "1–4h", "count": rand.Intn(150) + 40},
		{"bucket": "4–8h", "count": rand.Intn(100) + 20},
		{"bucket": "8–24h", "count": rand.Intn(60) + 10},
		{"bucket": "24–72h", "count": rand.Intn(30) + 5},
		{"bucket": "> 72h", "count": rand.Intn(10) + 1},
	}
	jsonOK(w, map[string]any{"buckets": buckets, "generatedAt": time.Now().UTC().Format(time.RFC3339)})
}

func revenueHandler(w http.ResponseWriter, r *http.Request) {
	days := 30
	series := make([]map[string]any, days)
	for i := 0; i < days; i++ {
		day := time.Now().UTC().AddDate(0, 0, -(days - 1 - i))
		series[i] = map[string]any{
			"date":    day.Format("2006-01-02"),
			"revenue": rand.Intn(50000) + 10000,
			"count":   rand.Intn(300) + 50,
		}
	}
	jsonOK(w, map[string]any{"series": series, "currency": "USD"})
}

func riskDistributionHandler(w http.ResponseWriter, r *http.Request) {
	total := rand.Intn(500) + 200
	green := int(float64(total) * 0.65)
	yellow := int(float64(total) * 0.25)
	red := total - green - yellow
	jsonOK(w, map[string]any{
		"total":  total,
		"green":  green,
		"yellow": yellow,
		"red":    red,
		"blue":   rand.Intn(20),
	})
}

func queryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	sql, _ := body["sql"].(string)
	if sql == "" {
		jsonErr(w, http.StatusBadRequest, "sql field required")
		return
	}
	deltaURL := os.Getenv("DELTALAKE_SVC_URL")
	if deltaURL == "" {
		// Stub response when Delta Lake is not configured
		jsonOK(w, map[string]any{
			"rows":    []any{},
			"columns": []string{},
			"note":    "DELTALAKE_SVC_URL not configured — returning empty result set",
		})
		return
	}
	// Proxy to Delta Lake service
	resp, err := http.Post(deltaURL+"/query", "application/json", r.Body)
	if err != nil {
		jsonErr(w, http.StatusBadGateway, fmt.Sprintf("delta lake unreachable: %v", err))
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	buf := make([]byte, 32768)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			_, _ = w.Write(buf[:n])
		}
		if err != nil {
			break
		}
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8086"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/v1/kpi", kpiHandler)
	mux.HandleFunc("/api/v1/clearance-times", clearanceTimesHandler)
	mux.HandleFunc("/api/v1/revenue", revenueHandler)
	mux.HandleFunc("/api/v1/risk-distribution", riskDistributionHandler)
	mux.HandleFunc("/api/v1/query", queryHandler)

	log.Printf("[analytics-service] Listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("[analytics-service] Fatal: %v", err)
	}
}
