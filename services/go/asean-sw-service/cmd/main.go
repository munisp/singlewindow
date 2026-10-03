// asean-sw-service — ASEAN Single Window G2G Connectivity microservice
// Implements WCO XML message formatting (UN/EDIFACT-aligned), outbound
// message dispatch to ASEAN member state gateways, inbound acknowledgement
// handling, and bilateral connection health monitoring.
//
// Phase 26 F3: all message state is persisted to PostgreSQL
// (asean_sw_messages table) via pgx/v5. DATABASE_URL is REQUIRED — the
// service fails closed at startup without it. Message acknowledgements are
// no longer simulated: a message stays "sent" until a real ACK arrives via
// /api/asean/messages/ack. Connection tests perform real HTTP probes against
// the member-state gateway URLs.
package main

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── ASEAN member state registry ─────────────────────────────────────────────
// Static reference configuration: official public gateway endpoints of the
// ASEAN member state National Single Windows. Not fabricated telemetry.

type MemberState struct {
	Code       string     `json:"code"` // ISO 3166-1 alpha-2
	Name       string     `json:"name"`
	GatewayURL string     `json:"gateway_url"`
	Protocol   string     `json:"protocol"` // REST | SOAP | AS4
	Status     string     `json:"status"`   // active | maintenance | offline
	LastPingAt *time.Time `json:"last_ping_at,omitempty"`
	LatencyMs  int        `json:"latency_ms"`
}

var memberStates = map[string]*MemberState{
	"BN": {Code: "BN", Name: "Brunei Darussalam", GatewayURL: "https://sw.bdnsw.gov.bn/api/v1", Protocol: "REST", Status: "active"},
	"KH": {Code: "KH", Name: "Cambodia", GatewayURL: "https://nsw.customs.gov.kh/api/v1", Protocol: "REST", Status: "active"},
	"ID": {Code: "ID", Name: "Indonesia", GatewayURL: "https://inatrade.kemendag.go.id/api", Protocol: "SOAP", Status: "active"},
	"LA": {Code: "LA", Name: "Lao PDR", GatewayURL: "https://laotradeportal.gov.la/api", Protocol: "REST", Status: "maintenance"},
	"MY": {Code: "MY", Name: "Malaysia", GatewayURL: "https://mysw.miti.gov.my/api/v2", Protocol: "REST", Status: "active"},
	"MM": {Code: "MM", Name: "Myanmar", GatewayURL: "https://myanmartradenet.gov.mm/api", Protocol: "REST", Status: "offline"},
	"PH": {Code: "PH", Name: "Philippines", GatewayURL: "https://asw.customs.gov.ph/api/v1", Protocol: "REST", Status: "active"},
	"SG": {Code: "SG", Name: "Singapore", GatewayURL: "https://tradenet.gov.sg/api/v3", Protocol: "REST", Status: "active"},
	"TH": {Code: "TH", Name: "Thailand", GatewayURL: "https://nsw.customs.go.th/api/v2", Protocol: "REST", Status: "active"},
	"VN": {Code: "VN", Name: "Viet Nam", GatewayURL: "https://vnsw.customs.gov.vn/api/v1", Protocol: "AS4", Status: "active"},
}

// ─── WCO XML message types ────────────────────────────────────────────────────

// WCO Data Model v3.10 — Declaration message envelope
type WCODeclarationMessage struct {
	XMLName      xml.Name        `xml:"WCO:Declaration"`
	XmlnsWCO     string          `xml:"xmlns:WCO,attr"`
	XmlnsXsi     string          `xml:"xmlns:xsi,attr"`
	MessageID    string          `xml:"WCO:MessageID"`
	SenderID     string          `xml:"WCO:SenderID"`
	ReceiverID   string          `xml:"WCO:ReceiverID"`
	FunctionCode string          `xml:"WCO:FunctionCode"` // 9=original, 13=amendment
	TypeCode     string          `xml:"WCO:TypeCode"`     // IM=import, EX=export, TR=transit
	IssuedAt     string          `xml:"WCO:IssueDateTime"`
	UCR          string          `xml:"WCO:UCR"`
	Declarant    WCOParty        `xml:"WCO:Declarant"`
	Consignment  WCOConsignment  `xml:"WCO:Consignment"`
	DutyTaxFee   []WCODutyTaxFee `xml:"WCO:DutyTaxFee,omitempty"`
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

// ─── Message persistence ──────────────────────────────────────────────────────

type MessageStatus string

const (
	MsgPending      MessageStatus = "pending"
	MsgSent         MessageStatus = "sent"
	MsgAcknowledged MessageStatus = "acknowledged"
	MsgFailed       MessageStatus = "failed"
	MsgRejected     MessageStatus = "rejected"
)

// OutboundMessage is the JSON shape served by the API. It is hydrated from
// the asean_sw_messages table (drizzle schema, columns preserved):
// message_id, message_type, sender_country, receiver_country, payload (jsonb),
// status, sent_at, acknowledged_at, error_message, created_at.
// Fields with no dedicated column (message_ref, ucr, xml_payload,
// ack_reference) round-trip inside the jsonb payload.
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

// messagePayload is the jsonb document stored in asean_sw_messages.payload.
type messagePayload struct {
	MessageRef   string `json:"message_ref"`
	UCR          string `json:"ucr"`
	XMLPayload   string `json:"xml_payload"`
	AckReference string `json:"ack_reference,omitempty"`
	MessageType  string `json:"message_type"` // logical type (DECLARATION etc.)
}

// dbMessageType maps the logical message type onto the asean_sw_message_type
// enum (CUSCAR, CUSRES, CUSDEC, IFTMIN, IFTSTA, COPARN, COARRI).
func dbMessageType(logical string) string {
	switch logical {
	case "DECLARATION":
		return "CUSDEC"
	case "PERMIT":
		return "CUSRES"
	case "CERTIFICATE":
		return "COPARN"
	default:
		return "CUSDEC"
	}
}

var db *pgxpool.Pool
var senderCountry string

func insertMessage(ctx context.Context, m *OutboundMessage) error {
	payload, err := json.Marshal(messagePayload{
		MessageRef:   m.MessageRef,
		UCR:          m.UCR,
		XMLPayload:   m.XMLPayload,
		AckReference: m.AckReference,
		MessageType:  m.MessageType,
	})
	if err != nil {
		return err
	}
	var errMsg *string
	if m.ErrorMessage != "" {
		errMsg = &m.ErrorMessage
	}
	_, err = db.Exec(ctx, `
		INSERT INTO asean_sw_messages
			(message_id, message_type, sender_country, receiver_country, payload, status, sent_at, acknowledged_at, error_message)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		m.ID, dbMessageType(m.MessageType), senderCountry, m.DestinationCode,
		payload, string(m.Status), m.SentAt, m.AcknowledgedAt, errMsg)
	return err
}

const selectMessagesSQL = `
	SELECT message_id, receiver_country, payload, status, sent_at, acknowledged_at, error_message, created_at
	FROM asean_sw_messages`

func scanMessage(row interface {
	Scan(dest ...any) error
}) (*OutboundMessage, error) {
	var (
		m       OutboundMessage
		payload []byte
		status  string
		errMsg  *string
	)
	if err := row.Scan(&m.ID, &m.DestinationCode, &payload, &status, &m.SentAt, &m.AcknowledgedAt, &errMsg, &m.CreatedAt); err != nil {
		return nil, err
	}
	var p messagePayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil, fmt.Errorf("corrupt payload for message %s: %w", m.ID, err)
	}
	m.MessageRef = p.MessageRef
	m.UCR = p.UCR
	m.XMLPayload = p.XMLPayload
	m.AckReference = p.AckReference
	m.MessageType = p.MessageType
	if m.MessageType == "" {
		m.MessageType = "DECLARATION"
	}
	m.Status = MessageStatus(status)
	if errMsg != nil {
		m.ErrorMessage = *errMsg
	}
	return &m, nil
}

func getMessageByID(ctx context.Context, id string) (*OutboundMessage, error) {
	row := db.QueryRow(ctx, selectMessagesSQL+` WHERE message_id = $1`, id)
	return scanMessage(row)
}

func listMessages(ctx context.Context, destCode string) ([]*OutboundMessage, error) {
	var rows interface {
		Next() bool
		Scan(dest ...any) error
		Err() error
		Close()
	}
	var err error
	if destCode == "" {
		rows, err = db.Query(ctx, selectMessagesSQL+` ORDER BY created_at DESC`)
	} else {
		rows, err = db.Query(ctx, selectMessagesSQL+` WHERE receiver_country = $1 ORDER BY created_at DESC`, destCode)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]*OutboundMessage, 0)
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, rows.Err()
}

func ackMessageByRef(ctx context.Context, ref, ackRef, status, reason string) (*OutboundMessage, error) {
	now := time.Now().UTC()
	var errMsg *string
	if reason != "" {
		errMsg = &reason
	}
	tag, err := db.Exec(ctx, `
		UPDATE asean_sw_messages
		SET status = $1,
		    acknowledged_at = $2,
		    error_message = $3,
		    payload = jsonb_set(payload, '{ack_reference}', to_jsonb($4::text))
		WHERE payload->>'message_ref' = $5`,
		status, now, errMsg, ackRef, ref)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, nil
	}
	row := db.QueryRow(ctx, selectMessagesSQL+` WHERE payload->>'message_ref' = $1`, ref)
	return scanMessage(row)
}

// ─── WCO XML formatter ────────────────────────────────────────────────────────

// declarationRequest is the inbound send-message payload.
type declarationRequest struct {
	DestinationCode string  `json:"destination_code" binding:"required"`
	UCR             string  `json:"ucr" binding:"required"`
	SenderID        string  `json:"sender_id"`
	ReceiverID      string  `json:"receiver_id"`
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

func formatWCODeclaration(req declarationRequest) (string, error) {
	msg := WCODeclarationMessage{
		XmlnsWCO:     "urn:wco:datamodel:WCO:DEC-DMS:2",
		XmlnsXsi:     "http://www.w3.org/2001/XMLSchema-instance",
		MessageID:    "MSG-" + strings.ToUpper(uuid.New().String()[:12]),
		SenderID:     req.SenderID,
		ReceiverID:   req.ReceiverID,
		FunctionCode: "9",
		TypeCode:     req.TypeCode,
		IssuedAt:     time.Now().UTC().Format(time.RFC3339),
		UCR:          req.UCR,
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
	var one int
	if err := db.QueryRow(c.Request.Context(), "SELECT 1").Scan(&one); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable", "service": "asean-sw-service", "error": err.Error()})
		return
	}
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
	// Real probe: HTTP HEAD against the member-state gateway with a strict
	// timeout. Latency is measured, not simulated. Fail-closed: unreachable
	// gateways surface as 503 with the honest transport error.
	client := &http.Client{Timeout: 5 * time.Second}
	start := time.Now()
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodHead, ms.GatewayURL, nil)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": fmt.Sprintf("probe setup failed: %v", err), "gateway": ms.GatewayURL})
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		now := time.Now().UTC()
		ms.LastPingAt = &now
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":    fmt.Sprintf("gateway %s unreachable: %v", ms.GatewayURL, err),
			"code":     ms.Code,
			"name":     ms.Name,
			"gateway":  ms.GatewayURL,
			"pinged_at": now,
		})
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	now := time.Now().UTC()
	latency := int(time.Since(start).Milliseconds())
	ms.LastPingAt = &now
	ms.LatencyMs = latency
	c.JSON(http.StatusOK, gin.H{
		"code":       ms.Code,
		"name":       ms.Name,
		"status":     ms.Status,
		"latency_ms": latency,
		"gateway":    ms.GatewayURL,
		"pinged_at":  now,
		"upstream_http_status": resp.StatusCode,
	})
}

func handleSendMessage(c *gin.Context) {
	var req declarationRequest
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
		Status:          MsgPending,
		CreatedAt:       now,
	}

	// Real dispatch: POST the WCO XML to the member-state gateway. No
	// acknowledgement is simulated — the message stays "sent" until the
	// gateway calls /api/asean/messages/ack.
	client := &http.Client{Timeout: 15 * time.Second}
	dispatchReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, ms.GatewayURL, strings.NewReader(xmlPayload))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "dispatch setup failed: " + err.Error()})
		return
	}
	dispatchReq.Header.Set("Content-Type", "application/xml")
	dispatchReq.Header.Set("X-Message-Ref", msgRef)
	resp, err := client.Do(dispatchReq)
	if err != nil {
		msg.Status = MsgFailed
		msg.ErrorMessage = fmt.Sprintf("gateway dispatch failed: %v", err)
	} else {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			msg.Status = MsgSent
			msg.SentAt = &now
		} else {
			msg.Status = MsgFailed
			msg.ErrorMessage = fmt.Sprintf("gateway returned HTTP %d", resp.StatusCode)
		}
	}

	if err := insertMessage(c.Request.Context(), msg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "persistence failed: " + err.Error()})
		return
	}

	if msg.Status == MsgFailed {
		c.JSON(http.StatusBadGateway, gin.H{
			"message": msg,
			"error":   msg.ErrorMessage,
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":     msg,
		"xml_preview": xmlPayload[:min(500, len(xmlPayload))],
	})
}

func handleGetMessageStatus(c *gin.Context) {
	msgID := c.Param("id")
	msg, err := getMessageByID(c.Request.Context(), msgID)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, msg)
}

func handleListMessages(c *gin.Context) {
	destCode := strings.ToUpper(c.Query("destination"))
	list, err := listMessages(c.Request.Context(), destCode)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
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
	status := string(MsgAcknowledged)
	if ack.Status == "rejected" {
		status = string(MsgRejected)
	}
	msg, err := ackMessageByRef(c.Request.Context(), ack.MessageRef, ack.AckReference, status, ack.Reason)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if msg == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "message not found by ref: " + ack.MessageRef})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true, "message": msg})
}

func handleMessageStats(c *gin.Context) {
	counts := map[string]int{
		"pending":      0,
		"sent":         0,
		"acknowledged": 0,
		"failed":       0,
		"rejected":     0,
	}
	rows, err := db.Query(c.Request.Context(), `SELECT status, COUNT(*) FROM asean_sw_messages GROUP BY status`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	total := 0
	for rows.Next() {
		var s string
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		counts[s] = n
		total += n
	}
	c.JSON(http.StatusOK, gin.H{
		"total":     total,
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
	// Phase 26 F3: DATABASE_URL is mandatory. This service persists ASEAN SW
	// messages to asean_sw_messages and refuses to start without a database.
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required; refusing to start without PostgreSQL persistence")
	}
	var err error
	db, err = pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("DATABASE_URL parse failed: %v", err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.Ping(ctx); err != nil {
		log.Fatalf("PostgreSQL unreachable at startup (fail-closed): %v", err)
	}

	senderCountry = os.Getenv("ASEAN_SENDER_COUNTRY")
	if senderCountry == "" {
		senderCountry = "GH" // Ghana NGSWTP host country
	}

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
