// cargo-tracking-service — TradeGateway NGSWTP
// Provides real-time cargo tracking, gate-in/gate-out events, and vessel
// position aggregation for the platform's cargo tracking map.
//
// Endpoints:
//   GET  /health, /healthz                — liveness + honest gaps (GAP-AIS-FEED)
//   GET  /api/v1/vessels                  — latest position per vessel (persisted, JWS-verified ingest)
//   GET  /api/v1/vessels/:mmsi            — single vessel detail (persisted)
//   GET  /api/v1/cargo/:ucr               — cargo lifecycle for a UCR
//   POST /api/v1/events/gate-in           — record gate-in event
//   POST /api/v1/events/gate-out          — record gate-out event
//   GET  /api/v1/ports/:portCode/queue    — inspection queue for a port
//
// Phase-9 WP-B: the synthetic demo vessels path was DELETED. Vessel positions
// are ingested from VERIFIED blueeconomy-geo-service geo.vessel-position.v1
// envelopes (Kafka topic vessels.events; JWS-EdDSA over RFC 8785 JCS; trust
// keys env-only via GEO_ENVELOPE_TRUST_KEYS) and persisted in PostgreSQL.
// With no AIS feed configured the API serves an honest empty state.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"

	"github.com/blueeconomy/cargo-tracking-service/internal/consumer"
	"github.com/blueeconomy/cargo-tracking-service/internal/envelope"
	"github.com/blueeconomy/cargo-tracking-service/internal/store"
)

// ── Types ─────────────────────────────────────────────────────────────────────

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

// The synthetic vessel generator was DELETED in Phase-9 WP-B: /api/v1/vessels
// serves exclusively from persisted, JWS-verified geo-service events.

// ── Handlers ──────────────────────────────────────────────────────────────────
// Vessel endpoints serve EXCLUSIVELY from persisted, JWS-verified geo-service
// events (internal/store). There is no synthetic data path: the generator was
// deleted in Phase-9 WP-B.

func healthHandler(w http.ResponseWriter, r *http.Request) {
	dbOK := false
	if vesselStore != nil && vesselStore.Ping(r.Context()) == nil {
		dbOK = true
	}
	gaps := []string{}
	if geoConsumer == nil {
		gaps = append(gaps, "GAP-AIS-FEED: "+ingestionGapReason)
	}
	var ingested, rejected int64
	var lastMsg time.Time
	var lastErr error
	if geoConsumer != nil {
		ingested, rejected, lastMsg, lastErr = geoConsumer.Stats()
	}
	status := "ok"
	if !dbOK {
		status = "unhealthy"
	}
	jsonOK(w, map[string]any{
		"status":   status,
		"service":  "cargo-tracking-service",
		"database": map[string]bool{"reachable": dbOK},
		"ingestion": map[string]any{
			"configured":  geoConsumer != nil,
			"ingested":    ingested,
			"rejected":    rejected,
			"lastMessage": lastMsg,
			"lastError":   errString(lastErr),
		},
		"gaps": gaps,
	})
}

func vesselsHandler(w http.ResponseWriter, r *http.Request) {
	vessels, err := vesselStore.LatestVessels(r.Context())
	if err != nil {
		jsonErr(w, http.StatusServiceUnavailable, "vessel store unavailable: "+err.Error())
		return
	}
	jsonOK(w, map[string]any{
		"vessels":    vessels,
		"totalCount": len(vessels),
		// Honest provenance: only verified geo-service envelopes.
		"dataSource": "blueeconomy-geo-service geo.vessel-position.v1 (JWS-verified)",
	})
}

func vesselDetailHandler(w http.ResponseWriter, r *http.Request) {
	mmsi := strings.TrimPrefix(r.URL.Path, "/api/v1/vessels/")
	if mmsi == "" {
		jsonErr(w, http.StatusBadRequest, "mmsi required")
		return
	}
	vessel, err := vesselStore.LatestByMMSI(r.Context(), mmsi)
	if err == store.ErrNotFound {
		jsonErr(w, http.StatusNotFound, "no persisted vessel events for this MMSI")
		return
	}
	if err != nil {
		jsonErr(w, http.StatusServiceUnavailable, "vessel store unavailable: "+err.Error())
		return
	}
	jsonOK(w, map[string]any{
		"vessel":     vessel,
		"dataSource": "blueeconomy-geo-service geo.vessel-position.v1 (JWS-verified)",
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

// vesselStore / geoConsumer are the process-level integration surfaces.
var (
	vesselStore        *store.Store
	geoConsumer        *consumer.Consumer
	ingestionGapReason string
)

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8087"
	}

	// DATABASE_URL is required: /api/v1/vessels serves exclusively from
	// persisted vessel events (fail-closed).
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("[cargo-tracking-service] DATABASE_URL is not set (fail-closed: vessel API is backed by persisted geo-service events)")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("[cargo-tracking-service] open database: %v", err)
	}
	defer db.Close()
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := db.PingContext(pingCtx); err != nil {
		pingCancel()
		log.Fatalf("[cargo-tracking-service] database unreachable (fail-closed): %v", err)
	}
	pingCancel()
	vesselStore = store.New(db)
	if err := vesselStore.EnsureSchema(context.Background()); err != nil {
		log.Fatalf("[cargo-tracking-service] schema migration failed: %v", err)
	}

	// Ingestion side: configured → real consumer; unconfigured → honest
	// GAP-AIS-FEED on /health, /healthz.
	consumerCfg := consumer.ConfigFromEnv()
	if consumerCfg == nil {
		ingestionGapReason = "KAFKA_BROKERS not set"
	} else if keys, err := envelope.ParseTrustKeys(os.Getenv(envelope.TrustKeysEnv)); err != nil {
		ingestionGapReason = envelope.TrustKeysEnv + ": " + err.Error()
	} else {
		geoConsumer = consumer.New(consumerCfg, keys, vesselStore)
		go geoConsumer.Run(context.Background())
		log.Printf("[cargo-tracking-service] geo envelope consumer started (topic=%s group=%s dlq=%s)",
			consumerCfg.Topic, consumerCfg.GroupID, consumerCfg.DLQTopic)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/healthz", healthHandler)
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

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	go func() {
		log.Printf("[cargo-tracking-service] Listening on :%s", port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("[cargo-tracking-service] Fatal: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	if geoConsumer != nil {
		geoConsumer.Close()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
