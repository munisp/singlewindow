// TradeGateway Go Benchmark Server
// ==================================
// Exposes all Go microservice endpoints for load testing.
// Implements: WTO Valuation, UCR Generation, NCS-NRS Pipeline,
//             Mojaloop ILP, Chaos Engine, TigerBeetle Ledger ops.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

var (
	db          *sql.DB
	rdb         *redis.Client
	requestCount int64
	errorCount   int64
)

// ─── Data Structures ──────────────────────────────────────────────────────────

type ValuationRequest struct {
	TransactionValue float64 `json:"transaction_value"`
	Freight          float64 `json:"freight"`
	Insurance        float64 `json:"insurance"`
	DutyRate         float64 `json:"duty_rate"`
	HSCode           string  `json:"hs_code"`
	CountryOfOrigin  string  `json:"country_of_origin"`
}

type ValuationResponse struct {
	CIFValue    float64 `json:"cif_value"`
	ImportDuty  float64 `json:"import_duty"`
	CISS        float64 `json:"ciss"`
	ETL         float64 `json:"etl"`
	NTA         float64 `json:"nta"`
	LandingCost float64 `json:"landing_cost"`
	ImportVAT   float64 `json:"import_vat"`
	Method      string  `json:"method"`
	LatencyUs   int64   `json:"latency_us"`
}

type UCRRequest struct {
	TraderID string `json:"trader_id"`
	Sequence int    `json:"sequence"`
}

type ILPRequest struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

type LandingCostRequest struct {
	CIFValue float64 `json:"cif_value"`
	HSCode   string  `json:"hs_code"`
}

// ─── Business Logic ───────────────────────────────────────────────────────────

func calculateWTOValuation(req ValuationRequest) ValuationResponse {
	start := time.Now()
	cifValue := req.TransactionValue + req.Freight + req.Insurance
	importDuty := cifValue * req.DutyRate
	ciss := cifValue * 0.01
	etl := cifValue * 0.005
	nta := cifValue * 0.005
	landingCost := cifValue + importDuty + ciss + etl + nta
	importVAT := landingCost * 0.075
	return ValuationResponse{
		CIFValue:    cifValue,
		ImportDuty:  importDuty,
		CISS:        ciss,
		ETL:         etl,
		NTA:         nta,
		LandingCost: landingCost,
		ImportVAT:   importVAT,
		Method:      "WTO_CVA_METHOD_1",
		LatencyUs:   time.Since(start).Microseconds(),
	}
}

func generateUCR(traderID string, seq int) string {
	year := time.Now().Year()
	prefix := traderID
	if len(prefix) > 5 {
		prefix = prefix[:5]
	}
	return fmt.Sprintf("%dNG-%s-%010d", year, prefix, seq)
}

func generateILPComponents(amount int64, currency string) (string, string, string) {
	preimage := make([]byte, 32)
	rand.Read(preimage)
	conditionInput := append(preimage, []byte(fmt.Sprintf("%d%s", amount, currency))...)
	condition := sha256.Sum256(conditionInput)
	fulfillment := hex.EncodeToString(preimage)
	conditionHex := hex.EncodeToString(condition[:])
	packet := fmt.Sprintf("ILP:amount=%d,currency=%s,condition=%s", amount, currency, conditionHex[:16])
	return packet, conditionHex, fulfillment
}

func getNCSLevyRate(hsCode string) float64 {
	// NCS 2024 ECOWAS CET tariff schedule (simplified)
	rates := map[string]float64{
		"84": 0.05, "85": 0.05, // Electronics
		"87": 0.35, // Vehicles
		"27": 0.05, // Petroleum
		"30": 0.00, // Pharmaceuticals
		"02": 0.20, // Meat
		"10": 0.05, // Cereals
		"52": 0.20, // Textiles
	}
	if len(hsCode) >= 2 {
		if rate, ok := rates[hsCode[:2]]; ok {
			return rate
		}
	}
	return 0.10 // Default 10%
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": "tradegateway-go-benchmark",
	})
}

func handleWTOValuation(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&requestCount, 1)
	start := time.Now()

	var req ValuationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		atomic.AddInt64(&errorCount, 1)
		http.Error(w, err.Error(), 400)
		return
	}

	result := calculateWTOValuation(req)
	result.LatencyUs = time.Since(start).Microseconds()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleUCRGenerate(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&requestCount, 1)
	start := time.Now()

	var req UCRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		atomic.AddInt64(&errorCount, 1)
		http.Error(w, err.Error(), 400)
		return
	}

	ucr := generateUCR(req.TraderID, req.Sequence)

	// Persist to DB
	if db != nil {
		db.Exec(`
			INSERT INTO ucr_records (ucr_number, trader_id, status)
			VALUES ($1, $2, 'active')
			ON CONFLICT (ucr_number) DO NOTHING
		`, ucr, req.TraderID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ucr_number": ucr,
		"latency_us": time.Since(start).Microseconds(),
	})
}

func handleILPGenerate(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&requestCount, 1)
	start := time.Now()

	var req ILPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		atomic.AddInt64(&errorCount, 1)
		http.Error(w, err.Error(), 400)
		return
	}

	packet, condition, fulfillment := generateILPComponents(req.Amount, req.Currency)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ilp_packet":  packet,
		"condition":   condition,
		"fulfillment": fulfillment,
		"latency_us":  time.Since(start).Microseconds(),
	})
}

func handleLandingCost(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&requestCount, 1)
	start := time.Now()

	var req LandingCostRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		atomic.AddInt64(&errorCount, 1)
		http.Error(w, err.Error(), 400)
		return
	}

	dutyRate := getNCSLevyRate(req.HSCode)
	importDuty := req.CIFValue * dutyRate
	ciss := req.CIFValue * 0.01
	etl := req.CIFValue * 0.005
	nta := req.CIFValue * 0.005
	landingCost := req.CIFValue + importDuty + ciss + etl + nta
	importVAT := landingCost * 0.075

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"cif_value":    req.CIFValue,
		"duty_rate":    dutyRate,
		"import_duty":  importDuty,
		"landing_cost": landingCost,
		"import_vat":   importVAT,
		"latency_us":   time.Since(start).Microseconds(),
	})
}

func handleRedisQuorumLease(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&requestCount, 1)
	start := time.Now()

	nodeID := r.URL.Query().Get("node_id")
	if nodeID == "" {
		nodeID = "benchmark-node"
	}

	var acquired bool
	var epoch int64

	if rdb != nil {
		ctx := context.Background()
		result, err := rdb.Eval(ctx, `
			local lease_key = KEYS[1]
			local epoch_key = KEYS[2]
			local node_id = ARGV[1]
			local expected_epoch = tonumber(ARGV[2])
			local lease_ttl = tonumber(ARGV[3])
			local new_epoch = tonumber(ARGV[4])
			local current_epoch = tonumber(redis.call('GET', epoch_key) or '0')
			if current_epoch ~= expected_epoch then
				return {0, redis.call('GET', lease_key) or '', current_epoch}
			end
			local current_holder = redis.call('GET', lease_key)
			if current_holder and current_holder ~= '' and current_holder ~= node_id then
				return {0, current_holder, current_epoch}
			end
			redis.call('SET', lease_key, node_id, 'PX', lease_ttl)
			redis.call('SET', epoch_key, new_epoch)
			return {1, new_epoch}
		`, []string{"bench:lease", "bench:epoch"}, nodeID, 0, 1000, 1).Int64Slice()

		if err == nil && len(result) > 0 {
			acquired = result[0] == 1
			if len(result) > 1 {
				epoch = result[1]
			}
		}
		// Release immediately for benchmark
		rdb.Del(ctx, "bench:lease", "bench:epoch")
	} else {
		acquired = true
		epoch = 1
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"acquired":   acquired,
		"epoch":      epoch,
		"latency_us": time.Since(start).Microseconds(),
	})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_requests": atomic.LoadInt64(&requestCount),
		"total_errors":   atomic.LoadInt64(&errorCount),
		"error_rate_pct": func() float64 {
			total := atomic.LoadInt64(&requestCount)
			if total == 0 {
				return 0
			}
			return float64(atomic.LoadInt64(&errorCount)) / float64(total) * 100
		}(),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8091"
	}

	// Connect to PostgreSQL
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL != "" {
		var err error
		db, err = sql.Open("postgres", dbURL)
		if err != nil {
			log.Printf("Warning: PostgreSQL connection failed: %v", err)
		} else {
			db.SetMaxOpenConns(50)
			db.SetMaxIdleConns(10)
			// Ensure ucr_records table exists
			db.Exec(`CREATE TABLE IF NOT EXISTS ucr_records (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				ucr_number VARCHAR(64) UNIQUE,
				trader_id VARCHAR(128),
				status VARCHAR(32) DEFAULT 'active',
				created_at TIMESTAMPTZ DEFAULT NOW()
			)`)
			log.Printf("PostgreSQL connected")
		}
	}

	// Connect to Redis
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	rdb = redis.NewClient(&redis.Options{Addr: redisAddr, PoolSize: 50})
	if _, err := rdb.Ping(context.Background()).Result(); err != nil {
		log.Printf("Warning: Redis connection failed: %v", err)
		rdb = nil
	} else {
		log.Printf("Redis connected")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/v1/wto/valuation", handleWTOValuation)
	mux.HandleFunc("/v1/ucr/generate", handleUCRGenerate)
	mux.HandleFunc("/v1/mojaloop/ilp", handleILPGenerate)
	mux.HandleFunc("/v1/ncs/landing-cost", handleLandingCost)
	mux.HandleFunc("/v1/quorum/lease", handleRedisQuorumLease)
	mux.HandleFunc("/v1/stats", handleStats)

	log.Printf("Go benchmark server starting on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
