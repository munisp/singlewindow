// TradeGateway NGSWTP — Kubecost Per-Tenant Cost Allocation Service
// Port: 8105
//
// Phase 26 F3: all cost figures now come from the real Kubecost Allocation
// API. KUBECOST_URL is REQUIRED (fail-closed at startup); any upstream
// failure surfaces as 503 with an honest error. No fabricated or simulated
// cost data remains in this service.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// ─── Response types (JSON shapes unchanged) ──────────────────────────────────

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
	Namespace         string  `json:"namespace"`
	ResourceType      string  `json:"resource_type"`
	ResourceName      string  `json:"resource_name"`
	IdleCPUCores      float64 `json:"idle_cpu_cores"`
	IdleMemoryGB      float64 `json:"idle_memory_gb"`
	IdleCostUSDPerDay float64 `json:"idle_cost_usd_per_day"`
	Recommendation    string  `json:"recommendation"`
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

// ─── Kubecost Allocation API client ───────────────────────────────────────────

// allocation mirrors the subset of the Kubecost Allocation API asset fields
// this service consumes. All figures are populated by upstream, never here.
type allocation struct {
	Properties struct {
		Namespace string            `json:"namespace"`
		Labels    map[string]string `json:"labels"`
	} `json:"properties"`
	CPUCost              float64 `json:"cpuCost"`
	RAMCost              float64 `json:"ramCost"`
	PVCost               float64 `json:"pvCost"`
	NetworkCost          float64 `json:"networkCost"`
	TotalCost            float64 `json:"totalCost"`
	TotalEfficiency      float64 `json:"totalEfficiency"`
	CPUCoreRequestAvg    float64 `json:"cpuCoreRequestAverage"`
	CPUCoreUsageAvg      float64 `json:"cpuCoreUsageAverage"`
	RAMByteRequestAvg    float64 `json:"ramByteRequestAverage"`
	RAMByteUsageAvg      float64 `json:"ramByteUsageAverage"`
}

type allocationResponse struct {
	Code  int                             `json:"code"`
	Error string                          `json:"error"`
	Data  []map[string]allocation         `json:"data"`
}

var (
	kubecostURL string
	httpClient  = &http.Client{Timeout: 15 * time.Second}
)

// fetchAllocations queries the Kubecost Allocation API. Any failure is
// returned as an error so handlers can fail closed with 503.
func fetchAllocations(ctx context.Context, window, step string) ([]map[string]allocation, error) {
	q := url.Values{}
	q.Set("window", window)
	q.Set("aggregate", "namespace")
	if step != "" {
		q.Set("step", step)
	}
	endpoint := strings.TrimRight(kubecostURL, "/") + "/model/allocation?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("kubecost unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("kubecost returned HTTP %d", resp.StatusCode)
	}
	var ar allocationResponse
	if err := json.NewDecoder(resp.Body).Decode(&ar); err != nil {
		return nil, fmt.Errorf("kubecost response decode: %w", err)
	}
	if ar.Code != 0 && ar.Code != http.StatusOK {
		return nil, fmt.Errorf("kubecost error: %s", ar.Error)
	}
	return ar.Data, nil
}

// windowForPeriod converts a YYYY-MM period into a Kubecost window range.
func windowForPeriod(period string) (string, error) {
	start, err := time.Parse("2006-01", period)
	if err != nil {
		return "", fmt.Errorf("invalid period %q (want YYYY-MM)", period)
	}
	end := start.AddDate(0, 1, 0)
	return fmt.Sprintf("%sT00:00:00Z,%sT00:00:00Z",
		start.Format("2006-01-02"), end.Format("2006-01-02")), nil
}

// tenantCostsFromAllocation maps upstream allocation entries onto TenantCost.
// Tenant identity comes from the namespace itself plus namespace labels when
// Kubecost surfaces them; no registry is invented here.
func tenantCostsFromAllocation(sets []map[string]allocation, period string) []TenantCost {
	if len(sets) == 0 {
		return []TenantCost{}
	}
	costs := make([]TenantCost, 0, len(sets[0]))
	for name, a := range sets[0] {
		if name == "__idle__" || name == "__unmounted__" {
			continue
		}
		ns := a.Properties.Namespace
		if ns == "" {
			ns = name
		}
		plan := ""
		if a.Properties.Labels != nil {
			plan = a.Properties.Labels["plan"]
			if plan == "" {
				plan = a.Properties.Labels["app.kubernetes.io/plan"]
			}
		}
		eff := a.TotalEfficiency
		if eff < 0 {
			eff = 0
		}
		if eff > 1 {
			eff = 1
		}
		idle := a.TotalCost * (1 - eff)
		costs = append(costs, TenantCost{
			TenantID:       ns,
			TenantName:     ns,
			Namespace:      ns,
			Plan:           plan,
			Period:         period,
			CPUCostUSD:     round2(a.CPUCost),
			MemoryCostUSD:  round2(a.RAMCost),
			StorageCostUSD: round2(a.PVCost),
			NetworkCostUSD: round2(a.NetworkCost),
			TotalCostUSD:   round2(a.TotalCost),
			IdleCostUSD:    round2(idle),
			EfficiencyPct:  round2(eff * 100),
		})
	}
	return costs
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

// failClosed returns 503 with an honest upstream error.
func failClosed(w http.ResponseWriter, err error) {
	log.Printf("kubecost upstream failure: %v", err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	json.NewEncoder(w).Encode(map[string]string{
		"error":   "kubecost upstream unavailable",
		"details": err.Error(),
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"status": "ok", "service": "kubecost-svc"})
}

func tenantCostsHandler(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	if period == "" {
		period = time.Now().Format("2006-01")
	}
	window, err := windowForPeriod(period)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	sets, err := fetchAllocations(r.Context(), window, "")
	if err != nil {
		failClosed(w, err)
		return
	}
	writeJSON(w, tenantCostsFromAllocation(sets, period))
}

func chargebackHandler(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	if period == "" {
		period = time.Now().Format("2006-01")
	}
	window, err := windowForPeriod(period)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	sets, err := fetchAllocations(r.Context(), window, "")
	if err != nil {
		failClosed(w, err)
		return
	}
	costs := tenantCostsFromAllocation(sets, period)
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
	sets, err := fetchAllocations(r.Context(), "1d", "")
	if err != nil {
		failClosed(w, err)
		return
	}
	resources := make([]IdleResource, 0)
	if len(sets) > 0 {
		for name, a := range sets[0] {
			if name == "__idle__" || name == "__unmounted__" {
				continue
			}
			ns := a.Properties.Namespace
			if ns == "" {
				ns = name
			}
			idleCPU := a.CPUCoreRequestAvg - a.CPUCoreUsageAvg
			if idleCPU < 0 {
				idleCPU = 0
			}
			idleMemBytes := a.RAMByteRequestAvg - a.RAMByteUsageAvg
			if idleMemBytes < 0 {
				idleMemBytes = 0
			}
			eff := a.TotalEfficiency
			if eff < 0 {
				eff = 0
			}
			if eff > 1 {
				eff = 1
			}
			idleCost := a.TotalCost * (1 - eff)
			if idleCPU == 0 && idleMemBytes == 0 && idleCost == 0 {
				continue // nothing idle — do not invent waste
			}
			rec := fmt.Sprintf("Namespace %s requests %.2f CPU cores but uses %.2f; review replica count and resource requests",
				ns, a.CPUCoreRequestAvg, a.CPUCoreUsageAvg)
			resources = append(resources, IdleResource{
				Namespace:         ns,
				ResourceType:      "Namespace",
				ResourceName:      ns,
				IdleCPUCores:      round2(idleCPU),
				IdleMemoryGB:      round2(idleMemBytes / (1024 * 1024 * 1024)),
				IdleCostUSDPerDay: round2(idleCost),
				Recommendation:    rec,
			})
		}
	}
	writeJSON(w, resources)
}

func trendHandler(w http.ResponseWriter, r *http.Request) {
	days := 30
	if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 90 {
			days = v
		}
	}
	sets, err := fetchAllocations(r.Context(), fmt.Sprintf("%dd", days), "1d")
	if err != nil {
		failClosed(w, err)
		return
	}
	trend := make([]DailyCost, 0, len(sets))
	start := time.Now().AddDate(0, 0, -(len(sets) - 1))
	for i, set := range sets {
		var dc DailyCost
		dc.Date = start.AddDate(0, 0, i).Format("2006-01-02")
		for name, a := range set {
			if name == "__idle__" || name == "__unmounted__" {
				continue
			}
			dc.TotalCostUSD += a.TotalCost
			dc.CPUCostUSD += a.CPUCost
			dc.MemoryCostUSD += a.RAMCost
			dc.StorageCostUSD += a.PVCost
			dc.NetworkCostUSD += a.NetworkCost
		}
		dc.TotalCostUSD = round2(dc.TotalCostUSD)
		dc.CPUCostUSD = round2(dc.CPUCostUSD)
		dc.MemoryCostUSD = round2(dc.MemoryCostUSD)
		dc.StorageCostUSD = round2(dc.StorageCostUSD)
		dc.NetworkCostUSD = round2(dc.NetworkCostUSD)
		trend = append(trend, dc)
	}
	writeJSON(w, trend)
}

func summaryHandler(w http.ResponseWriter, r *http.Request) {
	period := time.Now().Format("2006-01")
	window, err := windowForPeriod(period)
	if err != nil {
		failClosed(w, err)
		return
	}
	sets, err := fetchAllocations(r.Context(), window, "")
	if err != nil {
		failClosed(w, err)
		return
	}
	costs := tenantCostsFromAllocation(sets, period)
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
	// Phase-7 OTel: guarded by OTEL_EXPORTER_OTLP_ENDPOINT — unset = telemetry
	// disabled, boot unaffected (sanctioned fail-open, OTEL_DESIGN.md §1).
	otelShutdown, otelEnabled := InitTelemetry(context.Background())
	if otelEnabled {
		defer otelShutdown(context.Background())
	}

	// Phase 26 F3: KUBECOST_URL is mandatory. Without a real upstream this
	// service has no data source and must not start.
	kubecostURL = os.Getenv("KUBECOST_URL")
	if kubecostURL == "" {
		log.Fatal("KUBECOST_URL is required (e.g. http://kubecost-cost-analyzer:9090); refusing to start without a real cost data source")
	}

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
	log.Printf("kubecost-svc listening on %s (upstream: %s)", addr, kubecostURL)
	if err := http.ListenAndServe(addr, tracedHandler("kubecost-svc.http", mux)); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
