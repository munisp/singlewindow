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
// No event publication endpoint is exposed; events are read from Fluvio only.
//
// Environment variables:
//   FLUVIO_ENDPOINT   — configured Fluvio SC address
//   FLUVIO_HTTP_PROXY — configured Fluvio HTTP proxy address
//   FLUVIO_TOPIC      — topic name (default: cargo-events)
//   PORT              — HTTP listen port (default: 8093)
//   MAX_RING_SIZE     — ring buffer size per partition (default: 500)
//   ALLOWED_ORIGINS   — comma-separated CORS origins (default: *)

package main

import (
	"context"
	"encoding/json"
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
	fluvioEndpoint = os.Getenv("FLUVIO_ENDPOINT")
	fluvioProxy    = os.Getenv("FLUVIO_HTTP_PROXY")
	fluvioTopic    = getEnv("FLUVIO_TOPIC", "cargo-events")
	listenPort     = getEnv("PORT", "8093")
	maxRingSize    = func() int {
		n, err := strconv.Atoi(getEnv("MAX_RING_SIZE", "500"))
		if err != nil || n < 10 {
			return 500
		}
		return n
	}()
	sourceConnected bool
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
	Metadata      json.RawMessage `json:"metadata,omitempty"`
	Timestamp     time.Time `json:"timestamp"`
	Partition     int       `json:"partition"`
	Offset        int64     `json:"offset"`
}

type SourceStatus struct {
	Status    string    `json:"status"`
	Reason    string    `json:"reason,omitempty"`
	LastEvent time.Time `json:"last_event,omitempty"`
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

func (h *Hub) BroadcastStatus(status SourceStatus) {
	data, err := json.Marshal(status)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.send <- data:
		default:
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

// ─── Fluvio consumer ─────────────────────────────────────────────────────────

func startConsumer(ctx context.Context, ring *RingBuffer, hub *Hub, logger *zap.Logger) {
	if fluvioProxy == "" && fluvioEndpoint == "" {
		sourceConnected = false
		logger.Warn("Fluvio source is unconfigured")
		hub.BroadcastStatus(SourceStatus{Status: "unconfigured", Reason: "fluvio_source_not_configured"})
		return
	}
	if fluvioProxy == "" {
		sourceConnected = false
		logger.Warn("Fluvio HTTP proxy is not configured")
		hub.BroadcastStatus(SourceStatus{Status: "unavailable", Reason: "fluvio_http_proxy_not_configured"})
		return
	}
	client := &http.Client{Timeout: 10 * time.Second}
	go func() {
		offset := int64(0)
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			url := strings.TrimRight(fluvioProxy, "/") + "/api/topics/" + fluvioTopic + "/consume?offset=" + strconv.FormatInt(offset, 10)
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
			if err != nil {
				sourceConnected = false
				hub.BroadcastStatus(SourceStatus{Status: "unavailable", Reason: "fluvio_request_invalid"})
				time.Sleep(3 * time.Second)
				continue
			}
			res, err := client.Do(req)
			if err != nil || res.StatusCode >= http.StatusBadRequest {
				sourceConnected = false
				if res != nil {
					res.Body.Close()
				}
				hub.BroadcastStatus(SourceStatus{Status: "unavailable", Reason: "fluvio_source_unreachable"})
				time.Sleep(3 * time.Second)
				continue
			}
			var events []CargoEvent
			err = json.NewDecoder(res.Body).Decode(&events)
			res.Body.Close()
			if err != nil {
				sourceConnected = false
				hub.BroadcastStatus(SourceStatus{Status: "unavailable", Reason: "fluvio_payload_invalid"})
				time.Sleep(3 * time.Second)
				continue
			}
			last := time.Time{}
			for _, event := range events {
				ring.Push(event)
				hub.Broadcast(event)
				if event.Offset >= offset {
					offset = event.Offset + 1
				}
				if event.Timestamp.After(last) {
					last = event.Timestamp
				}
			}
			sourceConnected = true
			status := SourceStatus{Status: "connected"}
			if !last.IsZero() {
				status.LastEvent = last
			}
			hub.BroadcastStatus(status)
			time.Sleep(3 * time.Second)
		}
	}()
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func healthHandler(c *gin.Context) {
	status := "unconfigured"
	reason := "fluvio_source_not_configured"
	if fluvioProxy != "" || fluvioEndpoint != "" {
		status = "unavailable"
		reason = "fluvio_source_not_connected"
		if sourceConnected {
			status = "connected"
			reason = ""
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"status":    status,
		"reason":    reason,
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

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	ring := newRingBuffer(maxRingSize)
	hub := newHub(logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	startConsumer(ctx, ring, hub, logger)

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
