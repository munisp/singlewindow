// Package hub implements a WebSocket broadcast hub with a ring buffer for
// real-time cargo and AIS event streaming in TradeGateway NGSWTP.
package hub

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const ringBufferSize = 500

// CargoEvent is the canonical event structure published to Fluvio topics and
// broadcast to WebSocket subscribers.
type CargoEvent struct {
	EventID       string    `json:"event_id"`
	EventType     string    `json:"event_type"`
	DeclarationID *int64    `json:"declaration_id,omitempty"`
	UCR           string    `json:"ucr,omitempty"`
	ContainerRef  string    `json:"container_ref,omitempty"`
	PortCode      string    `json:"port_code"`
	Location      string    `json:"location,omitempty"`
	Actor         string    `json:"actor"`
	Message       string    `json:"message"`
	Severity      string    `json:"severity"` // INFO | WARNING | CRITICAL
	Latitude      *float64  `json:"latitude,omitempty"`
	Longitude     *float64  `json:"longitude,omitempty"`
	Timestamp     time.Time `json:"timestamp"`
	Partition     int       `json:"partition"`
	Offset        int64     `json:"offset"`
	Source        string    `json:"source"` // fluvio | kafka | synthetic
}

// Client represents a single WebSocket subscriber.
type Client struct {
	conn   *websocket.Conn
	send   chan []byte
	filter string // optional declarationId filter (empty = all events)
}

// Hub manages all active WebSocket clients and the ring buffer.
type Hub struct {
	mu         sync.RWMutex
	clients    map[*Client]bool
	broadcast  chan *CargoEvent
	register   chan *Client
	unregister chan *Client
	ring       [ringBufferSize]*CargoEvent
	ringHead   int
	ringCount  int
}

// New creates and starts a Hub.
func New() *Hub {
	h := &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan *CargoEvent, 256),
		register:   make(chan *Client, 32),
		unregister: make(chan *Client, 32),
	}
	go h.run()
	return h
}

// Publish pushes an event into the hub for broadcast and ring buffer storage.
func (h *Hub) Publish(evt *CargoEvent) {
	h.broadcast <- evt
}

// RecentEvents returns up to n events from the ring buffer, optionally filtered
// by declarationId (pass 0 to return all events).
func (h *Hub) RecentEvents(n int, declarationID int64) []*CargoEvent {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if n <= 0 || n > ringBufferSize {
		n = ringBufferSize
	}

	result := make([]*CargoEvent, 0, n)
	count := h.ringCount
	if count > ringBufferSize {
		count = ringBufferSize
	}

	// Walk ring buffer from newest to oldest
	for i := 0; i < count && len(result) < n; i++ {
		idx := (h.ringHead - 1 - i + ringBufferSize) % ringBufferSize
		evt := h.ring[idx]
		if evt == nil {
			continue
		}
		if declarationID != 0 && (evt.DeclarationID == nil || *evt.DeclarationID != declarationID) {
			continue
		}
		result = append(result, evt)
	}
	return result
}

// AddClient registers a new WebSocket client with the hub.
func (h *Hub) AddClient(conn *websocket.Conn, filter string) *Client {
	c := &Client{conn: conn, send: make(chan []byte, 64), filter: filter}
	h.register <- c
	go c.writePump()
	return c
}

// RemoveClient unregisters a client.
func (h *Hub) RemoveClient(c *Client) {
	h.unregister <- c
}

// run is the hub's main event loop.
func (h *Hub) run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = true
			h.mu.Unlock()
			log.Printf("[hub] client registered (total: %d)", len(h.clients))

		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()
			log.Printf("[hub] client unregistered (total: %d)", len(h.clients))

		case evt := <-h.broadcast:
			// Store in ring buffer
			h.mu.Lock()
			h.ring[h.ringHead] = evt
			h.ringHead = (h.ringHead + 1) % ringBufferSize
			h.ringCount++
			h.mu.Unlock()

			// Broadcast to all matching clients
			payload, err := json.Marshal(evt)
			if err != nil {
				log.Printf("[hub] marshal error: %v", err)
				continue
			}

			h.mu.RLock()
			for c := range h.clients {
				if c.filter != "" && (evt.DeclarationID == nil || c.filter != fmt.Sprintf("%d", *evt.DeclarationID)) {
					continue
				}
				select {
				case c.send <- payload:
				default:
					// Slow client — drop message
				}
			}
			h.mu.RUnlock()
		}
	}
}

// writePump sends queued messages to the WebSocket connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
