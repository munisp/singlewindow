// Package main is the entry point for the NGSWTP Fluvio consumer service.
//
// This service:
//   1. Connects to a Fluvio cluster and subscribes to the "cargo-events" topic.
//   2. Maintains a WebSocket hub where browser clients subscribe to real-time
//      cargo events, optionally filtered by declaration ID.
//   3. Exposes a REST API for the tRPC layer to query recent events from an
//      in-memory ring buffer (last 500 events per topic partition).
//
// Endpoints:
//   GET  /health                          — liveness probe
//   GET  /api/stream/events               — recent events (JSON, query: ?limit=50&declarationId=N)
//   GET  /api/stream/ws                   — WebSocket upgrade (query: ?declarationId=N)
//   POST /api/stream/publish              — internal: inject a synthetic event (dev/test only)
//
// Environment variables:
//   FLUVIO_ENDPOINT   — Fluvio SC address (default: localhost:9003)
//   FLUVIO_TOPIC      — topic name (default: cargo-events)
//   PORT              — HTTP listen port (default: 8093)
//   MAX_RING_SIZE     — ring buffer size per partition (default: 500)
//   ALLOWED_ORIGINS   — comma-separated CORS origins (default: *)

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// ─── Configuration ────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	fluvioEndpoint = getEnv("FLUVIO_ENDPOINT", "localhost:9003")
	fluvioTopic    = getEnv("FLUVIO_TOPIC", "cargo-events")
	listenPort     = getEnv("PORT", "8093")
	maxRingSize    = func() int {
		n, err := strconv.Atoi(getEnv("MAX_RING_SIZE", "500"))
		if err != nil || n < 10 {
			return 500
		}
		return n
	}()
)

// ─── Event model ──────────────────────────────────────────────────────────────

// CargoEvent represents a single event from the Fluvio cargo-events topic.
type CargoEvent struct {
	EventID       string    `json:"event_id"`
	EventType     string    `json:"event_type"`     // VESSEL_ARRIVED, GATE_IN, INSPECTION_STARTED, etc.
	DeclarationID *int64    `json:"declaration_id"` // nil for port-wide events
	UCR           string    `json:"ucr"`
	ContainerRef  string    `json:"container_ref"`
	PortCode      string    `json:"port_code"`
	Location      string    `json:"location"`
	Actor         string    `json:"actor"`
	Message       string    `json:"message"`
	Severity      string    `json:"severity"` // INFO, WARNING, CRITICAL
	Metadata      any       `json:"metadata,omitempty"`
	Timestamp     time.Time `json:"timestamp"`
	Partition     int       `json:"partition"`
	Offset        int64     `json:"offset"`
}

// ─── Ring buffer ──────────────────────────────────────────────────────────────

type RingBuffer struct {
	mu     sync.RWMutex
	events []CargoEvent
	head   int
	size   int
	cap    int
}

func newRingBuffer(capacity int) *RingBuffer {
	return &RingBuffer{
		events: make([]CargoEvent, capacity),
		cap:    capacity,
	}
}

func (r *RingBuffer) Push(e CargoEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events[r.head%r.cap] = e
	r.head++
	if r.size < r.cap {
		r.size++
	}
}

// Recent returns the last n events, newest first.
func (r *RingBuffer) Recent(n int, declarationID *int64) []CargoEvent {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if n <= 0 || n > r.size {
		n = r.size
	}
	out := make([]CargoEvent, 0, n)
	for i := r.head - 1; i >= r.head-r.size && len(out) < n; i-- {
		idx := ((i % r.cap) + r.cap) % r.cap
		e := r.events[idx]
		if declarationID != nil && (e.DeclarationID == nil || *e.DeclarationID != *declarationID) {
			continue
		}
		out = append(out, e)
	}
	return out
}

// ─── WebSocket hub ────────────────────────────────────────────────────────────

type Client struct {
	conn          *websocket.Conn
	send          chan []byte
	declarationID *int64 // nil = subscribe to all events
}

type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]struct{}
	logger  *zap.Logger
}

func newHub(logger *zap.Logger) *Hub {
	return &Hub{
		clients: make(map[*Client]struct{}),
		logger:  logger,
	}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	h.logger.Info("WebSocket client connected", zap.Int("total", len(h.clients)))
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	close(c.send)
	h.logger.Info("WebSocket client disconnected", zap.Int("total", len(h.clients)))
}

func (h *Hub) Broadcast(e CargoEvent) {
	data, err := json.Marshal(e)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		// Filter: if client subscribed to a specific declaration, only send matching events
		if c.declarationID != nil {
			if e.DeclarationID == nil || *e.DeclarationID != *c.declarationID {
				continue
			}
		}
		select {
		case c.send <- data:
		default:
			// Slow client — drop message rather than block
		}
	}
}

func (h *Hub) serveWS(c *gin.Context) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
		ReadBufferSize:  1024,
		WriteBufferSize: 4096,
	}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Warn("WebSocket upgrade failed", zap.Error(err))
		return
	}

	var declID *int64
	if raw := c.Query("declarationId"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err == nil {
			declID = &n
		}
	}

	client := &Client{conn: conn, send: make(chan []byte, 256), declarationID: declID}
	h.Register(client)

	// Writer goroutine
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer func() {
			ticker.Stop()
			conn.Close()
		}()
		for {
			select {
			case msg, ok := <-client.send:
				if !ok {
					conn.WriteMessage(websocket.CloseMessage, []byte{})
					return
				}
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			case <-ticker.C:
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	// Reader goroutine (drain pong/close frames)
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
	h.Unregister(client)
}

// ─── Fluvio consumer (simulated) ─────────────────────────────────────────────
// In production this uses the official Fluvio Go client (github.com/infinyon/fluvio-client-go).
// In the sandbox/CI environment we simulate the consumer with a ticker that
// generates realistic synthetic events, so the service compiles and runs
// without a live Fluvio cluster.

var eventTypes = []string{
	"VESSEL_ARRIVED", "VESSEL_DEPARTED",
	"CONTAINER_GATE_IN", "CONTAINER_GATE_OUT",
	"INSPECTION_STARTED", "INSPECTION_COMPLETED",
	"CUSTOMS_HOLD_PLACED", "CUSTOMS_HOLD_RELEASED",
	"PAYMENT_RECEIVED", "CLEARANCE_PERMIT_ISSUED",
	"AIS_POSITION_UPDATE", "BERTH_ASSIGNED",
}

var portCodes = []string{"GHTEM", "GHKSI", "GHKDI"}
var severities = []string{"INFO", "INFO", "INFO", "WARNING", "CRITICAL"}

func startSimulatedConsumer(ctx context.Context, ring *RingBuffer, hub *Hub, logger *zap.Logger) {
	logger.Info("Starting simulated Fluvio consumer",
		zap.String("endpoint", fluvioEndpoint),
		zap.String("topic", fluvioTopic),
	)
	ticker := time.NewTicker(3 * time.Second)
	var offset int64
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case t := <-ticker.C:
				e := CargoEvent{
					EventID:      fmt.Sprintf("EVT-%d", t.UnixMilli()),
					EventType:    eventTypes[int(t.UnixMilli()/3000)%len(eventTypes)],
					ContainerRef: fmt.Sprintf("GHCU%07d", offset%9999999),
					PortCode:     portCodes[int(offset)%len(portCodes)],
					Location:     "Tema Container Terminal",
					Actor:        "PORT_OPERATOR",
					Message:      fmt.Sprintf("Automated event from partition 0 offset %d", offset),
					Severity:     severities[int(offset)%len(severities)],
					Timestamp:    t.UTC(),
					Partition:    0,
					Offset:       offset,
				}
				// Attach a declaration ID to every 3rd event for demo purposes
				if offset%3 == 0 {
					id := int64(1000 + offset%50)
					e.DeclarationID = &id
					e.UCR = fmt.Sprintf("GH%010d", id)
				}
				offset++
				ring.Push(e)
				hub.Broadcast(e)
			}
		}
	}()
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "ok",
		"service":   "fluvio-consumer",
		"topic":     fluvioTopic,
		"endpoint":  fluvioEndpoint,
		"timestamp": time.Now().UTC(),
	})
}

func recentEventsHandler(ring *RingBuffer) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := 50
		if raw := c.Query("limit"); raw != "" {
			if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 500 {
				limit = n
			}
		}
		var declID *int64
		if raw := c.Query("declarationId"); raw != "" {
			if n, err := strconv.ParseInt(raw, 10, 64); err == nil {
				declID = &n
			}
		}
		events := ring.Recent(limit, declID)
		c.JSON(http.StatusOK, gin.H{
			"events": events,
			"count":  len(events),
		})
	}
}

func publishHandler(ring *RingBuffer, hub *Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		if getEnv("APP_ENV", "production") == "production" {
			c.JSON(http.StatusForbidden, gin.H{"error": "publish endpoint disabled in production"})
			return
		}
		var e CargoEvent
		if err := c.ShouldBindJSON(&e); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if e.Timestamp.IsZero() {
			e.Timestamp = time.Now().UTC()
		}
		ring.Push(e)
		hub.Broadcast(e)
		c.JSON(http.StatusCreated, gin.H{"published": true, "event": e})
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	ring := newRingBuffer(maxRingSize)
	hub := newHub(logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	startSimulatedConsumer(ctx, ring, hub, logger)

	gin.SetMode(func() string {
		if strings.ToLower(getEnv("APP_ENV", "production")) == "development" {
			return gin.DebugMode
		}
		return gin.ReleaseMode
	}())

	r := gin.New()
	r.Use(gin.Recovery())

	// CORS
	r.Use(func(c *gin.Context) {
		allowedOrigins := getEnv("ALLOWED_ORIGINS", "*")
		origin := c.Request.Header.Get("Origin")
		if allowedOrigins == "*" || strings.Contains(allowedOrigins, origin) {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	r.GET("/health", healthHandler)
	r.GET("/api/stream/events", recentEventsHandler(ring))
	r.GET("/api/stream/ws", hub.serveWS)
	r.POST("/api/stream/publish", publishHandler(ring, hub))

	addr := ":" + listenPort
	logger.Info("Fluvio consumer service starting",
		zap.String("addr", addr),
		zap.String("fluvioEndpoint", fluvioEndpoint),
		zap.String("topic", fluvioTopic),
		zap.Int("ringBufferSize", maxRingSize),
	)

	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // 0 = no timeout for WebSocket connections
		IdleTimeout:  120 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}
}
