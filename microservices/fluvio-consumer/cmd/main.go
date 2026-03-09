// fluvio-consumer — Real-time cargo event streaming service for TradeGateway NGSWTP
//
// Subscribes to Kafka topics (mirroring Fluvio streams), maintains a ring buffer
// of recent events, and broadcasts to WebSocket subscribers.
//
// HTTP API:
//   GET  /health                      — health check
//   GET  /events?limit=N&decl=ID      — recent events from ring buffer
//   POST /events/publish              — inject a synthetic event (dev/test)
//   GET  /ws?filter=DECL_ID           — WebSocket subscription
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tradegateway/fluvio-consumer/internal/consumer"
	"github.com/tradegateway/fluvio-consumer/internal/hub"
	"github.com/tradegateway/fluvio-consumer/internal/producer"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true }, // CORS handled by APISIX
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8093"
	}

	kafkaBrokers := strings.Split(getEnv("KAFKA_BROKERS", "localhost:9092"), ",")
	groupID := getEnv("KAFKA_GROUP_ID", "fluvio-consumer-group")

	// ── Hub ──────────────────────────────────────────────────────────────────
	h := hub.New()

	// ── Kafka consumer ───────────────────────────────────────────────────────
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	c := consumer.New(h, kafkaBrokers, groupID)
	c.Start(ctx)

	// ── Synthetic AIS ticker (demo mode when Kafka is unavailable) ───────────
	if getEnv("DEMO_MODE", "true") == "true" {
		aisProd := producer.NewAISProducer(kafkaBrokers)
		go func() {
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			vessels := []string{"IMO9876543", "IMO1234567", "IMO4567890"}
			i := 0
			for range ticker.C {
				port := producer.GhanaPorts[i%len(producer.GhanaPorts)]
				vessel := vessels[i%len(vessels)]
				speed := 12.5 + float64(i%5)
				if err := aisProd.PublishSyntheticAIS(ctx, vessel, port, speed); err != nil {
					// Kafka not available — inject directly into hub
					lat := port.Lat + 0.001*float64(i%10)
					lon := port.Lon + 0.001*float64(i%10)
					h.Publish(&hub.CargoEvent{
						EventID:   "DEMO-AIS-" + strconv.Itoa(i),
						EventType: "AIS_POSITION_UPDATE",
						PortCode:  port.Code,
						Location:  port.Name,
						Actor:     "AIS_TRANSPONDER",
						Message:   vessel + " position update near " + port.Name,
						Severity:  "INFO",
						Latitude:  &lat,
						Longitude: &lon,
						Timestamp: time.Now().UTC(),
						Source:    "synthetic",
					})
				}
				i++
			}
		}()
	}

	// ── HTTP routes ──────────────────────────────────────────────────────────
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":  "ok",
			"service": "fluvio-consumer",
			"topics":  consumer.Topics,
			"time":    time.Now().UTC(),
		})
	})

	// Recent events (REST)
	mux.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if n, err := strconv.Atoi(l); err == nil && n > 0 {
				limit = n
			}
		}
		var declID int64
		if d := r.URL.Query().Get("decl"); d != "" {
			if n, err := strconv.ParseInt(d, 10, 64); err == nil {
				declID = n
			}
		}

		events := h.RecentEvents(limit, declID)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"events": events,
			"count":  len(events),
		})
	})

	// Publish synthetic event (POST /events/publish)
	mux.HandleFunc("/events/publish", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var evt hub.CargoEvent
		if err := json.NewDecoder(r.Body).Decode(&evt); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if evt.Timestamp.IsZero() {
			evt.Timestamp = time.Now().UTC()
		}
		evt.Source = "synthetic"
		h.Publish(&evt)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "event_id": evt.EventID})
	})

	// WebSocket endpoint
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("[ws] upgrade error: %v", err)
			return
		}
		filter := r.URL.Query().Get("filter")
		client := h.AddClient(conn, filter)

		// Read pump (handle client disconnect)
		go func() {
			defer h.RemoveClient(client)
			conn.SetReadLimit(512)
			conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			conn.SetPongHandler(func(string) error {
				conn.SetReadDeadline(time.Now().Add(60 * time.Second))
				return nil
			})
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					break
				}
			}
		}()
	})

	// ── Server ───────────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("[fluvio-consumer] listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[fluvio-consumer] server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[fluvio-consumer] shutting down...")
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	srv.Shutdown(shutdownCtx)
	log.Println("[fluvio-consumer] stopped")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
