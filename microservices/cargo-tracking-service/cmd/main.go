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
	"sync"
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

// ── Real gate-event store (SW-FLAG2) ─────────────────────────────────────────
// Gate events posted to this service are the ONLY data source for the port
// queue and cargo event history — no random/synthetic entries are ever served.
type gateEventStore struct {
	mu     sync.Mutex
	events []GateEvent
}

var gateEvents = &gateEventStore{}

func (st *gateEventStore) record(e GateEvent) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.events = append(st.events, e)
}

func (st *gateEventStore) byUCR(ucr string) []GateEvent {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := []GateEvent{}
	for _, e := range st.events {
		if e.UCR == ucr {
			out = append(out, e)
		}
	}
	return out
}

// queueForPort: containers with a gate_in at the port and no subsequent gate_out,
// ordered by arrival. Position and wait time derive from REAL timestamps.
func (st *gateEventStore) queueForPort(portCode string) []map[string]any {
	st.mu.Lock()
	defer st.mu.Unlock()
	gatedOut := map[string]bool{}
	for _, e := range st.events {
		if e.EventType == "gate_out" && e.PortCode == portCode {
			gatedOut[e.Container] = true
		}
	}
	queue := []map[string]any{}
	pos := 1
	for _, e := range st.events {
		if e.EventType == "gate_in" && e.PortCode == portCode && !gatedOut[e.Container] {
			waitHours := int(time.Since(e.Timestamp).Hours())
			if waitHours < 0 {
				waitHours = 0
			}
			queue = append(queue, map[string]any{
				"position":  pos,
				"ucr":       e.UCR,
				"container": e.Container,
				"waitHours": waitHours,
				"gateInAt":  e.Timestamp.Format(time.RFC3339),
				// riskLane intentionally absent: gate events carry no risk data
				// and fabricating lanes would mislead targeting officers.
			})
			pos++
		}
	}
	return queue
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
		// Explicit honesty label: these are NOT live AIS positions.
		"synthetic":   true,
		"dataSource":  "SYNTHETIC_DEMO_NOT_LIVE_AIS",
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
	// Explicit honesty label: NOT a live AIS position for this MMSI.
	jsonOK(w, map[string]any{
		"vessel":     vessel,
		"synthetic":  true,
		"dataSource": "SYNTHETIC_DEMO_NOT_LIVE_AIS",
	})
}

func cargoHandler(w http.ResponseWriter, r *http.Request) {
	ucr := strings.TrimPrefix(r.URL.Path, "/api/v1/cargo/")
	if ucr == "" {
		jsonErr(w, http.StatusBadRequest, "ucr required")
		return
	}
	// SW-FLAG2: serve ONLY real recorded gate events for this UCR — the canned
	// "cleared" timeline fabricated compliance evidence for any arbitrary UCR.
	recorded := gateEvents.byUCR(ucr)
	events := []map[string]any{}
	for _, e := range recorded {
		events = append(events, map[string]any{
			"event":     e.EventType,
			"timestamp": e.Timestamp.Format(time.RFC3339),
			"portCode":  e.PortCode,
			"container": e.Container,
		})
	}
	status := "UNKNOWN"
	if len(recorded) > 0 {
		status = "GATE_EVENTS_RECORDED"
	}
	jsonOK(w, map[string]any{
		"ucr":     ucr,
		"events":  events,
		"status":  status,
		"noData":  len(recorded) == 0,
		"source":  "recorded_gate_events",
	})
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
	gateEvents.record(event)
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
	gateEvents.record(event)
	log.Printf("[cargo-tracking] gate_out: UCR=%s port=%s container=%s", event.UCR, event.PortCode, event.Container)
	jsonOK(w, map[string]any{"status": "recorded", "event": event})
}

func portQueueHandler(w http.ResponseWriter, r *http.Request) {
	// SW-FLAG2: the queue is derived ONLY from real recorded gate events.
	// An empty queue is an honest no-data state, never random filler.
	portCode := strings.TrimPrefix(r.URL.Path, "/api/v1/ports/")
	portCode = strings.TrimSuffix(portCode, "/queue")
	queue := gateEvents.queueForPort(portCode)
	jsonOK(w, map[string]any{
		"portCode": portCode,
		"queue":    queue,
		"total":    len(queue),
		"noData":   len(queue) == 0,
		"source":   "recorded_gate_events",
	})
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
