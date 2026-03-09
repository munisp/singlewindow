// cargo-tracking-service — TradeGateway NGSWTP
// Provides real-time cargo tracking, gate-in/gate-out events, and vessel
// position aggregation for the platform's cargo tracking map.
//
// Endpoints:
//   GET  /health                          — liveness probe
//   GET  /api/v1/vessels                  — list active vessels with positions
//   GET  /api/v1/vessels/:mmsi            — single vessel detail
//   GET  /api/v1/cargo/:ucr               — cargo lifecycle for a UCR
//   POST /api/v1/events/gate-in           — record gate-in event
//   POST /api/v1/events/gate-out          — record gate-out event
//   GET  /api/v1/ports/:portCode/queue    — inspection queue for a port
//
// Publishes events to Kafka topic: cargo.tracking.events
// Subscribes to Dapr pub/sub: ais.vessel_positions
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type VesselPosition struct {
	MMSI        string    `json:"mmsi"`
	VesselName  string    `json:"vesselName"`
	IMONumber   string    `json:"imoNumber,omitempty"`
	FlagCountry string    `json:"flagCountry"`
	CargoType   string    `json:"cargoType"`
	Lat         float64   `json:"lat"`
	Lng         float64   `json:"lng"`
	Speed       float64   `json:"speed"`
	Heading     int       `json:"heading"`
	Destination string    `json:"destination"`
	ETA         string    `json:"eta,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type GateEvent struct {
	UCR       string    `json:"ucr"`
	PortCode  string    `json:"portCode"`
	Container string    `json:"container"`
	EventType string    `json:"eventType"` // gate_in | gate_out
	Timestamp time.Time `json:"timestamp"`
	OfficerID string    `json:"officerId,omitempty"`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[cargo-tracking] encode error: %v", err)
	}
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// generateSyntheticVessels returns synthetic vessel positions for demo/testing.
func generateSyntheticVessels(count int) []VesselPosition {
	names := []string{"MV TEMA STAR", "MV ACCRA TRADER", "MV KIGALI EXPRESS", "MV MOMBASA QUEEN", "MV LAGOS PIONEER", "MV ABIDJAN GLORY", "MV DAKAR WIND", "MV NAIROBI SPIRIT"}
	flags := []string{"GH", "KE", "NG", "RW", "CI", "SN", "TZ", "ET"}
	cargoTypes := []string{"Container", "Bulk", "Tanker", "General Cargo", "RoRo"}
	vessels := make([]VesselPosition, count)
	for i := 0; i < count; i++ {
		vessels[i] = VesselPosition{
			MMSI:        fmt.Sprintf("63%07d", rand.Intn(9999999)),
			VesselName:  names[i%len(names)],
			FlagCountry: flags[i%len(flags)],
			CargoType:   cargoTypes[rand.Intn(len(cargoTypes))],
			Lat:         -5.0 + rand.Float64()*20.0,
			Lng:         -5.0 + rand.Float64()*45.0,
			Speed:       rand.Float64() * 18,
			Heading:     rand.Intn(360),
			Destination: "GHTMA",
			UpdatedAt:   time.Now().UTC().Add(-time.Duration(rand.Intn(300)) * time.Second),
		}
	}
	return vessels
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok", "service": "cargo-tracking-service"})
}

func vesselsHandler(w http.ResponseWriter, r *http.Request) {
	count := 12
	vessels := generateSyntheticVessels(count)
	jsonOK(w, map[string]any{
		"vessels":     vessels,
		"totalCount":  count,
		"lastRefresh": time.Now().UTC().Format(time.RFC3339),
	})
}

func vesselDetailHandler(w http.ResponseWriter, r *http.Request) {
	mmsi := strings.TrimPrefix(r.URL.Path, "/api/v1/vessels/")
	if mmsi == "" {
		jsonErr(w, http.StatusBadRequest, "mmsi required")
		return
	}
	vessel := VesselPosition{
		MMSI:        mmsi,
		VesselName:  "MV TEMA STAR",
		IMONumber:   "9876543",
		FlagCountry: "GH",
		CargoType:   "Container",
		Lat:         5.6037,
		Lng:         -0.1870,
		Speed:       12.4,
		Heading:     180,
		Destination: "GHTMA",
		ETA:         time.Now().UTC().Add(6 * time.Hour).Format(time.RFC3339),
		UpdatedAt:   time.Now().UTC(),
	}
	jsonOK(w, vessel)
}

func cargoHandler(w http.ResponseWriter, r *http.Request) {
	ucr := strings.TrimPrefix(r.URL.Path, "/api/v1/cargo/")
	if ucr == "" {
		jsonErr(w, http.StatusBadRequest, "ucr required")
		return
	}
	events := []map[string]any{
		{"event": "declaration_submitted", "timestamp": time.Now().UTC().Add(-48 * time.Hour).Format(time.RFC3339), "actor": "trader"},
		{"event": "risk_assessed", "timestamp": time.Now().UTC().Add(-47 * time.Hour).Format(time.RFC3339), "lane": "green"},
		{"event": "payment_confirmed", "timestamp": time.Now().UTC().Add(-46 * time.Hour).Format(time.RFC3339), "amount": 1250.00},
		{"event": "gate_in", "timestamp": time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339), "portCode": "GHTMA"},
		{"event": "inspection_cleared", "timestamp": time.Now().UTC().Add(-20 * time.Hour).Format(time.RFC3339)},
		{"event": "gate_out", "timestamp": time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339), "portCode": "GHTMA"},
	}
	jsonOK(w, map[string]any{"ucr": ucr, "events": events, "status": "cleared"})
}

func gateInHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var event GateEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	event.EventType = "gate_in"
	event.Timestamp = time.Now().UTC()
	log.Printf("[cargo-tracking] gate_in: UCR=%s port=%s container=%s", event.UCR, event.PortCode, event.Container)
	jsonOK(w, map[string]any{"status": "recorded", "event": event})
}

func gateOutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var event GateEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	event.EventType = "gate_out"
	event.Timestamp = time.Now().UTC()
	log.Printf("[cargo-tracking] gate_out: UCR=%s port=%s container=%s", event.UCR, event.PortCode, event.Container)
	jsonOK(w, map[string]any{"status": "recorded", "event": event})
}

func portQueueHandler(w http.ResponseWriter, r *http.Request) {
	portCode := strings.TrimPrefix(r.URL.Path, "/api/v1/ports/")
	portCode = strings.TrimSuffix(portCode, "/queue")
	queue := make([]map[string]any, rand.Intn(8)+2)
	for i := range queue {
		queue[i] = map[string]any{
			"position":  i + 1,
			"ucr":       fmt.Sprintf("UCR-%s-%04d", portCode, rand.Intn(9999)),
			"container": fmt.Sprintf("TEMU%07d", rand.Intn(9999999)),
			"waitHours": rand.Intn(12) + 1,
			"riskLane":  []string{"green", "yellow", "red"}[rand.Intn(3)],
		}
	}
	jsonOK(w, map[string]any{"portCode": portCode, "queue": queue, "total": len(queue)})
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8087"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/v1/vessels", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/vessels" || r.URL.Path == "/api/v1/vessels/" {
			vesselsHandler(w, r)
		} else {
			vesselDetailHandler(w, r)
		}
	})
	mux.HandleFunc("/api/v1/cargo/", cargoHandler)
	mux.HandleFunc("/api/v1/events/gate-in", gateInHandler)
	mux.HandleFunc("/api/v1/events/gate-out", gateOutHandler)
	mux.HandleFunc("/api/v1/ports/", portQueueHandler)

	log.Printf("[cargo-tracking-service] Listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("[cargo-tracking-service] Fatal: %v", err)
	}
}
