// asean-sw-service — ASEAN Single Window G2G Connectivity microservice
// Implements WCO XML message formatting (UN/EDIFACT-aligned), outbound
// message dispatch to ASEAN member state gateways, inbound acknowledgement
// handling, and bilateral connection health monitoring.
package main

import (
	"encoding/xml"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ─── ASEAN member state registry ─────────────────────────────────────────────

type MemberState struct {
	Code        string `json:"code"`        // ISO 3166-1 alpha-2
	Name        string `json:"name"`
	GatewayURL  string `json:"gateway_url"`
	Protocol    string `json:"protocol"`    // REST | SOAP | AS4
	Status      string `json:"status"`      // active | maintenance | offline
	LastPingAt  *time.Time `json:"last_ping_at,omitempty"`
	LatencyMs   int    `json:"latency_ms"`
}

var memberStates = map[string]*MemberState{
	"BN": {Code: "BN", Name: "Brunei Darussalam",   GatewayURL: "https://sw.bdnsw.gov.bn/api/v1",    Protocol: "REST", Status: "active"},
	"KH": {Code: "KH", Name: "Cambodia",            GatewayURL: "https://nsw.customs.gov.kh/api/v1", Protocol: "REST", Status: "active"},
	"ID": {Code: "ID", Name: "Indonesia",            GatewayURL: "https://inatrade.kemendag.go.id/api",Protocol: "SOAP", Status: "active"},
	"LA": {Code: "LA", Name: "Lao PDR",              GatewayURL: "https://laotradeportal.gov.la/api",  Protocol: "REST", Status: "maintenance"},
	"MY": {Code: "MY", Name: "Malaysia",             GatewayURL: "https://mysw.miti.gov.my/api/v2",   Protocol: "REST", Status: "active"},
	"MM": {Code: "MM", Name: "Myanmar",              GatewayURL: "https://myanmartradenet.gov.mm/api", Protocol: "REST", Status: "offline"},
	"PH": {Code: "PH", Name: "Philippines",          GatewayURL: "https://asw.customs.gov.ph/api/v1", Protocol: "REST", Status: "active"},
	"SG": {Code: "SG", Name: "Singapore",            GatewayURL: "https://tradenet.gov.sg/api/v3",    Protocol: "REST", Status: "active"},
	"TH": {Code: "TH", Name: "Thailand",             GatewayURL: "https://nsw.customs.go.th/api/v2",  Protocol: "REST", Status: "active"},
	"VN": {Code: "VN", Name: "Viet Nam",             GatewayURL: "https://vnsw.customs.gov.vn/api/v1",Protocol: "AS4",  Status: "active"},
}

// ─── WCO XML message types ────────────────────────────────────────────────────

// WCO Data Model v3.10 — Declaration message envelope
type WCODeclarationMessage struct {
	XMLName     xml.Name         `xml:"WCO:Declaration"`
	XmlnsWCO   string           `xml:"xmlns:WCO,attr"`
	XmlnsXsi   string           `xml:"xmlns:xsi,attr"`
	MessageID   string           `xml:"WCO:MessageID"`
	SenderID    string           `xml:"WCO:SenderID"`
	ReceiverID  string           `xml:"WCO:ReceiverID"`
	FunctionCode string          `xml:"WCO:FunctionCode"` // 9=original, 13=amendment
	TypeCode    string           `xml:"WCO:TypeCode"`     // IM=import, EX=export, TR=transit
	IssuedAt    string           `xml:"WCO:IssueDateTime"`
	UCR         string           `xml:"WCO:UCR"`
	Declarant   WCOParty         `xml:"WCO:Declarant"`
	Consignment WCOConsignment   `xml:"WCO:Consignment"`
	DutyTaxFee  []WCODutyTaxFee `xml:"WCO:DutyTaxFee,omitempty"`
}

type WCOParty struct {
	ID   string `xml:"WCO:ID"`
	Name string `xml:"WCO:Name"`
}

type WCOConsignment struct {
	UCR          string  `xml:"WCO:UCR"`
	GrossWeight  float64 `xml:"WCO:GrossMassMeasure"`
	InvoiceValue float64 `xml:"WCO:InvoiceAmount"`
	Currency     string  `xml:"WCO:CurrencyCode"`
	HSCode       string  `xml:"WCO:TariffCode"`
	Description  string  `xml:"WCO:GoodsDescription"`
}

type WCODutyTaxFee struct {
	TypeCode string  `xml:"WCO:TypeCode"`
	Amount   float64 `xml:"WCO:PaymentAmount"`
	Currency string  `xml:"WCO:CurrencyCode"`
}

// ─── Message store ────────────────────────────────────────────────────────────

type MessageStatus string

const (
	MsgPending     MessageStatus = "pending"
	MsgSent        MessageStatus = "sent"
	MsgAcknowledged MessageStatus = "acknowledged"
	MsgFailed      MessageStatus = "failed"
	MsgRejected    MessageStatus = "rejected"
)

type OutboundMessage struct {
	ID              string        `json:"id"`
	MessageRef      string        `json:"message_ref"`
	DestinationCode string        `json:"destination_code"`
	MessageType     string        `json:"message_type"` // DECLARATION | PERMIT | CERTIFICATE
	UCR             string        `json:"ucr"`
	XMLPayload      string        `json:"xml_payload"`
	Status          MessageStatus `json:"status"`
	SentAt          *time.Time    `json:"sent_at,omitempty"`
	AcknowledgedAt  *time.Time    `json:"acknowledged_at,omitempty"`
	AckReference    string        `json:"ack_reference,omitempty"`
	ErrorMessage    string        `json:"error_message,omitempty"`
	CreatedAt       time.Time     `json:"created_at"`
}

type store struct {
	mu       sync.RWMutex
	messages map[string]*OutboundMessage
}

var msgStore = &store{
	messages: make(map[string]*OutboundMessage),
}

// ─── WCO XML formatter ────────────────────────────────────────────────────────

func formatWCODeclaration(req struct {
	SenderID    string  `json:"sender_id"`
	ReceiverID  string  `json:"receiver_id"`
	UCR         string  `json:"ucr"`
	TypeCode    string  `json:"type_code"`
	TraderName  string  `json:"trader_name"`
	TraderID    string  `json:"trader_id"`
	HSCode      string  `json:"hs_code"`
	Description string  `json:"description"`
	GrossWeight float64 `json:"gross_weight_kg"`
	InvoiceValue float64 `json:"invoice_value"`
	Currency    string  `json:"currency"`
	DutyAmount  float64 `json:"duty_amount"`
}) (string, error) {
	msg := WCODeclarationMessage{
		XmlnsWCO:    "urn:wco:datamodel:WCO:DEC-DMS:2",
		XmlnsXsi:    "http://www.w3.org/2001/XMLSchema-instance",
		MessageID:   "MSG-" + strings.ToUpper(uuid.New().String()[:12]),
		SenderID:    req.SenderID,
		ReceiverID:  req.ReceiverID,
		FunctionCode: "9",
		TypeCode:    req.TypeCode,
		IssuedAt:    time.Now().UTC().Format(time.RFC3339),
		UCR:         req.UCR,
		Declarant: WCOParty{
			ID:   req.TraderID,
			Name: req.TraderName,
		},
		Consignment: WCOConsignment{
			UCR:          req.UCR,
			GrossWeight:  req.GrossWeight,
			InvoiceValue: req.InvoiceValue,
			Currency:     req.Currency,
			HSCode:       req.HSCode,
			Description:  req.Description,
		},
	}
	if req.DutyAmount > 0 {
		msg.DutyTaxFee = []WCODutyTaxFee{{
			TypeCode: "A00", // import duty
			Amount:   req.DutyAmount,
			Currency: req.Currency,
		}}
	}
	out, err := xml.MarshalIndent(msg, "", "  ")
	if err != nil {
		return "", err
	}
	return xml.Header + string(out), nil
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "asean-sw-service", "ts": time.Now().UTC()})
}

func handleGetConnections(c *gin.Context) {
	states := make([]*MemberState, 0, len(memberStates))
	for _, s := range memberStates {
		states = append(states, s)
	}
	active := 0
	for _, s := range states {
		if s.Status == "active" {
			active++
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"connections": states,
		"total":       len(states),
		"active":      active,
	})
}

func handleTestConnection(c *gin.Context) {
	code := strings.ToUpper(c.Param("code"))
	ms, ok := memberStates[code]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("member state %s not found", code)})
		return
	}
	// Simulate ping (in production: HTTP HEAD to gateway URL)
	now := time.Now().UTC()
	latency := 45 + (int(now.UnixNano()%100)) // simulated 45–145ms
	ms.LastPingAt = &now
	ms.LatencyMs = latency
	c.JSON(http.StatusOK, gin.H{
		"code":       ms.Code,
		"name":       ms.Name,
		"status":     ms.Status,
		"latency_ms": latency,
		"gateway":    ms.GatewayURL,
		"pinged_at":  now,
	})
}

func handleSendMessage(c *gin.Context) {
	var req struct {
		DestinationCode string  `json:"destination_code" binding:"required"`
		UCR             string  `json:"ucr" binding:"required"`
		SenderID        string  `json:"sender_id"`
		TraderName      string  `json:"trader_name"`
		TraderID        string  `json:"trader_id"`
		HSCode          string  `json:"hs_code"`
		Description     string  `json:"description"`
		GrossWeight     float64 `json:"gross_weight_kg"`
		InvoiceValue    float64 `json:"invoice_value"`
		Currency        string  `json:"currency"`
		DutyAmount      float64 `json:"duty_amount"`
		TypeCode        string  `json:"type_code"` // IM | EX | TR
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	destCode := strings.ToUpper(req.DestinationCode)
	ms, ok := memberStates[destCode]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("member state %s not found", destCode)})
		return
	}
	if ms.Status == "offline" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": fmt.Sprintf("gateway for %s (%s) is currently offline", ms.Name, destCode),
		})
		return
	}

	if req.SenderID == "" {
		req.SenderID = "GH-NGSWTP"
	}
	if req.TypeCode == "" {
		req.TypeCode = "IM"
	}
	if req.Currency == "" {
		req.Currency = "USD"
	}

	xmlPayload, err := formatWCODeclaration(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "XML formatting failed: " + err.Error()})
		return
	}

	now := time.Now().UTC()
	msgID := uuid.New().String()
	msgRef := "ASW-" + strings.ToUpper(msgID[:8])
	msg := &OutboundMessage{
		ID:              msgID,
		MessageRef:      msgRef,
		DestinationCode: destCode,
		MessageType:     "DECLARATION",
		UCR:             req.UCR,
		XMLPayload:      xmlPayload,
		Status:          MsgSent,
		SentAt:          &now,
		CreatedAt:       now,
	}

	// Simulate acknowledgement for active connections
	if ms.Status == "active" {
		ackTime := now.Add(200 * time.Millisecond)
		msg.Status = MsgAcknowledged
		msg.AcknowledgedAt = &ackTime
		msg.AckReference = "ACK-" + strings.ToUpper(uuid.New().String()[:8])
	}

	msgStore.mu.Lock()
	msgStore.messages[msgID] = msg
	msgStore.mu.Unlock()

	c.JSON(http.StatusCreated, gin.H{
		"message":     msg,
		"xml_preview": xmlPayload[:min(500, len(xmlPayload))],
	})
}

func handleGetMessageStatus(c *gin.Context) {
	msgID := c.Param("id")
	msgStore.mu.RLock()
	msg, ok := msgStore.messages[msgID]
	msgStore.mu.RUnlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
		return
	}
	c.JSON(http.StatusOK, msg)
}

func handleListMessages(c *gin.Context) {
	destCode := strings.ToUpper(c.Query("destination"))
	msgStore.mu.RLock()
	defer msgStore.mu.RUnlock()
	list := make([]*OutboundMessage, 0)
	for _, m := range msgStore.messages {
		if destCode == "" || m.DestinationCode == destCode {
			list = append(list, m)
		}
	}
	c.JSON(http.StatusOK, gin.H{"messages": list, "total": len(list)})
}

func handleInboundAck(c *gin.Context) {
	var ack struct {
		MessageRef   string `json:"message_ref" binding:"required"`
		AckReference string `json:"ack_reference" binding:"required"`
		Status       string `json:"status"` // accepted | rejected
		Reason       string `json:"reason,omitempty"`
	}
	if err := c.ShouldBindJSON(&ack); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	msgStore.mu.Lock()
	defer msgStore.mu.Unlock()
	for _, m := range msgStore.messages {
		if m.MessageRef == ack.MessageRef {
			now := time.Now().UTC()
			m.AcknowledgedAt = &now
			m.AckReference = ack.AckReference
			if ack.Status == "rejected" {
				m.Status = MsgRejected
				m.ErrorMessage = ack.Reason
			} else {
				m.Status = MsgAcknowledged
			}
			c.JSON(http.StatusOK, gin.H{"updated": true, "message": m})
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "message not found by ref: " + ack.MessageRef})
}

func handleMessageStats(c *gin.Context) {
	msgStore.mu.RLock()
	defer msgStore.mu.RUnlock()
	counts := map[string]int{
		"pending":      0,
		"sent":         0,
		"acknowledged": 0,
		"failed":       0,
		"rejected":     0,
	}
	for _, m := range msgStore.messages {
		counts[string(m.Status)]++
	}
	c.JSON(http.StatusOK, gin.H{
		"total":   len(msgStore.messages),
		"by_status": counts,
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8096"
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/health", handleHealth)
	r.GET("/api/asean/connections", handleGetConnections)
	r.GET("/api/asean/connections/:code/test", handleTestConnection)
	r.POST("/api/asean/messages/send", handleSendMessage)
	r.GET("/api/asean/messages/:id", handleGetMessageStatus)
	r.GET("/api/asean/messages", handleListMessages)
	r.POST("/api/asean/messages/ack", handleInboundAck)
	r.GET("/api/asean/stats", handleMessageStats)

	log.Printf("[asean-sw-service] listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
