// TradeGateway NGSWTP — Kubecost Per-Tenant Cost Allocation Service
// Port: 8105
//
// Aggregates Kubernetes resource costs per tenant namespace using the
// Kubecost Allocation API, generates chargeback reports by plan tier,
// and surfaces idle resource recommendations.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"time"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantCost struct {
	TenantID       string  `json:"tenant_id"`
	TenantName     string  `json:"tenant_name"`
	Namespace      string  `json:"namespace"`
	Plan           string  `json:"plan"`
	Period         string  `json:"period"`
	CPUCostUSD     float64 `json:"cpu_cost_usd"`
	MemoryCostUSD  float64 `json:"memory_cost_usd"`
	StorageCostUSD float64 `json:"storage_cost_usd"`
	NetworkCostUSD float64 `json:"network_cost_usd"`
	TotalCostUSD   float64 `json:"total_cost_usd"`
	IdleCostUSD    float64 `json:"idle_cost_usd"`
	EfficiencyPct  float64 `json:"efficiency_pct"`
}

type IdleResource struct {
	Namespace          string  `json:"namespace"`
	ResourceType       string  `json:"resource_type"`
	ResourceName       string  `json:"resource_name"`
	IdleCPUCores       float64 `json:"idle_cpu_cores"`
	IdleMemoryGB       float64 `json:"idle_memory_gb"`
	IdleCostUSDPerDay  float64 `json:"idle_cost_usd_per_day"`
	Recommendation     string  `json:"recommendation"`
}

type DailyCost struct {
	Date           string  `json:"date"`
	TotalCostUSD   float64 `json:"total_cost_usd"`
	CPUCostUSD     float64 `json:"cpu_cost_usd"`
	MemoryCostUSD  float64 `json:"memory_cost_usd"`
	StorageCostUSD float64 `json:"storage_cost_usd"`
	NetworkCostUSD float64 `json:"network_cost_usd"`
}

type ClusterSummary struct {
	TotalCostUSD   float64 `json:"total_cost_usd"`
	CPUCostUSD     float64 `json:"cpu_cost_usd"`
	MemoryCostUSD  float64 `json:"memory_cost_usd"`
	StorageCostUSD float64 `json:"storage_cost_usd"`
	NetworkCostUSD float64 `json:"network_cost_usd"`
	IdleCostUSD    float64 `json:"idle_cost_usd"`
	EfficiencyPct  float64 `json:"efficiency_pct"`
	ActiveTenants  int     `json:"active_tenants"`
}

type ChargebackReport struct {
	Period              string       `json:"period"`
	TotalClusterCostUSD float64      `json:"total_cluster_cost_usd"`
	Tenants             []TenantCost `json:"tenants"`
}

// ─── Mock data generators ─────────────────────────────────────────────────────

var tenantRegistry = []struct {
	ID        string
	Name      string
	Namespace string
	Plan      string
}{
	{"gha-001", "Ghana Revenue Authority", "tradegateway-gha", "enterprise"},
	{"rwa-001", "Rwanda Revenue Authority", "tradegateway-rwa", "standard"},
	{"sgp-001", "Singapore Customs", "tradegateway-sgp", "enterprise"},
	{"ken-001", "Kenya Revenue Authority", "tradegateway-ken", "standard"},
	{"nga-001", "Nigeria Customs Service", "tradegateway-nga", "starter"},
}

func generateTenantCosts(period string) []TenantCost {
	costs := make([]TenantCost, 0, len(tenantRegistry))
	rng := rand.New(rand.NewSource(int64(len(period))))
	for _, t := range tenantRegistry {
		var base float64
		switch t.Plan {
		case "enterprise":
			base = 350.0
		case "standard":
			base = 130.0
		default:
			base = 55.0
		}
		cpu := base*0.45 + rng.Float64()*20
		mem := base*0.30 + rng.Float64()*10
		stor := base*0.15 + rng.Float64()*5
		net := base*0.05 + rng.Float64()*3
		idle := base * 0.05 * rng.Float64()
		total := cpu + mem + stor + net
		eff := 100.0 - (idle/total)*100.0
		costs = append(costs, TenantCost{
			TenantID:       t.ID,
			TenantName:     t.Name,
			Namespace:      t.Namespace,
			Plan:           t.Plan,
			Period:         period,
			CPUCostUSD:     round2(cpu),
			MemoryCostUSD:  round2(mem),
			StorageCostUSD: round2(stor),
			NetworkCostUSD: round2(net),
			TotalCostUSD:   round2(total),
			IdleCostUSD:    round2(idle),
			EfficiencyPct:  round2(eff),
		})
	}
	return costs
}

func generateIdleResources() []IdleResource {
	return []IdleResource{
		{
			Namespace:         "tradegateway-rwa",
			ResourceType:      "Deployment",
			ResourceName:      "asean-sw-service",
			IdleCPUCores:      0.4,
			IdleMemoryGB:      0.8,
			IdleCostUSDPerDay: 3.20,
			Recommendation:    "Scale down replicas from 3 to 1 during off-peak hours (21:00–06:00 UTC)",
		},
		{
			Namespace:         "tradegateway-gha",
			ResourceType:      "PersistentVolumeClaim",
			ResourceName:      "rustfs-data-pvc",
			IdleCPUCores:      0,
			IdleMemoryGB:      0,
			IdleCostUSDPerDay: 1.80,
			Recommendation:    "Reduce PVC size from 50Gi to 20Gi — only 8Gi currently used",
		},
		{
			Namespace:         "tradegateway-nga",
			ResourceType:      "Deployment",
			ResourceName:      "keycloak-service",
			IdleCPUCores:      0.2,
			IdleMemoryGB:      0.5,
			IdleCostUSDPerDay: 2.10,
			Recommendation:    "Starter plan: reduce Keycloak to single replica; HA not required",
		},
	}
}

func generateCostTrend(days int) []DailyCost {
	trend := make([]DailyCost, 0, days)
	base := 720.0
	for i := 0; i < days; i++ {
		d := time.Now().AddDate(0, 0, -(days - 1 - i))
		wave := math.Sin(float64(i) / 5.0)
		noise := rand.Float64()*20 - 10
		total := base + wave*40 + noise
		trend = append(trend, DailyCost{
			Date:           d.Format("2006-01-02"),
			TotalCostUSD:   round2(total),
			CPUCostUSD:     round2(total * 0.52),
			MemoryCostUSD:  round2(total * 0.31),
			StorageCostUSD: round2(total*0.12 + float64(i)*0.5),
			NetworkCostUSD: round2(total * 0.05),
		})
	}
	return trend
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON error: %v", err)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"status": "ok", "service": "kubecost-svc"})
}

func tenantCostsHandler(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	if period == "" {
		period = time.Now().Format("2006-01")
	}
	writeJSON(w, generateTenantCosts(period))
}

func chargebackHandler(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	if period == "" {
		period = time.Now().Format("2006-01")
	}
	costs := generateTenantCosts(period)
	var total float64
	for _, c := range costs {
		total += c.TotalCostUSD
	}
	writeJSON(w, ChargebackReport{
		Period:              period,
		TotalClusterCostUSD: round2(total),
		Tenants:             costs,
	})
}

func idleHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, generateIdleResources())
}

func trendHandler(w http.ResponseWriter, r *http.Request) {
	days := 30
	if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 90 {
			days = v
		}
	}
	writeJSON(w, generateCostTrend(days))
}

func summaryHandler(w http.ResponseWriter, r *http.Request) {
	period := time.Now().Format("2006-01")
	costs := generateTenantCosts(period)
	var sum ClusterSummary
	sum.ActiveTenants = len(costs)
	for _, c := range costs {
		sum.TotalCostUSD += c.TotalCostUSD
		sum.CPUCostUSD += c.CPUCostUSD
		sum.MemoryCostUSD += c.MemoryCostUSD
		sum.StorageCostUSD += c.StorageCostUSD
		sum.NetworkCostUSD += c.NetworkCostUSD
		sum.IdleCostUSD += c.IdleCostUSD
	}
	sum.TotalCostUSD = round2(sum.TotalCostUSD)
	sum.CPUCostUSD = round2(sum.CPUCostUSD)
	sum.MemoryCostUSD = round2(sum.MemoryCostUSD)
	sum.StorageCostUSD = round2(sum.StorageCostUSD)
	sum.NetworkCostUSD = round2(sum.NetworkCostUSD)
	sum.IdleCostUSD = round2(sum.IdleCostUSD)
	if sum.TotalCostUSD > 0 {
		sum.EfficiencyPct = round2(100.0 - (sum.IdleCostUSD/sum.TotalCostUSD)*100.0)
	}
	writeJSON(w, sum)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8105"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/costs/tenants", tenantCostsHandler)
	mux.HandleFunc("/costs/chargeback", chargebackHandler)
	mux.HandleFunc("/costs/idle", idleHandler)
	mux.HandleFunc("/costs/trend", trendHandler)
	mux.HandleFunc("/costs/summary", summaryHandler)

	addr := fmt.Sprintf(":%s", port)
	log.Printf("kubecost-svc listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
