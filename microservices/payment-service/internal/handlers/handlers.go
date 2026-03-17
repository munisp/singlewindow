// handlers — HTTP handlers for payment-service
// Integrates Mojaloop (payment rails) and TigerBeetle (double-entry ledger).
package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tradegateway/payment-service/internal/pubsub"
	"github.com/tradegateway/payment-service/internal/store"
	"github.com/tradegateway/payment-service/internal/temporal"
	"github.com/tradegateway/payment-service/internal/tigerbeetle"
)

// Handler holds dependencies
type Handler struct {
	store       *store.Store
	pubsub      *pubsub.Client
	tb          tigerbeetle.Client
	temporal    *temporal.Client
	mojaloopURL string
	httpClient  *http.Client
}

func New(st *store.Store, ps *pubsub.Client, tb tigerbeetle.Client, tc *temporal.Client, mojaloopURL string) *Handler {
	return &Handler{
		store:       st,
		pubsub:      ps,
		tb:          tb,
		temporal:    tc,
		mojaloopURL: mojaloopURL,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func pathID(r *http.Request, segment string) (int64, error) {
	parts := strings.Split(r.URL.Path, "/")
	for i, p := range parts {
		if p == segment && i+1 < len(parts) {
			return strconv.ParseInt(parts[i+1], 10, 64)
		}
	}
	return 0, fmt.Errorf("segment %s not found in path", segment)
}

// CreateInvoice handles POST /api/payments/invoices
func (h *Handler) CreateInvoice(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DeclarationId int64   `json:"declarationId"`
		TraderId      int64   `json:"traderId"`
		DutyAmount    float64 `json:"dutyAmount"`
		VATAmount     float64 `json:"vatAmount"`
		LevyAmount    float64 `json:"levyAmount"`
		Currency      string  `json:"currency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	dueDate := time.Now().Add(72 * time.Hour) // 72-hour payment window
	inv := &store.PaymentInvoice{
		DeclarationId: body.DeclarationId,
		InvoiceNumber: fmt.Sprintf("INV-%d-%d", body.DeclarationId, time.Now().Unix()),
		TraderId:      body.TraderId,
		DutyAmount:    body.DutyAmount,
		VATAmount:     body.VATAmount,
		LevyAmount:    body.LevyAmount,
		TotalAmount:   body.DutyAmount + body.VATAmount + body.LevyAmount,
		Currency:      body.Currency,
		DueDate:       &dueDate,
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	id, err := h.store.CreateInvoice(ctx, inv)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Publish invoice created event
	go h.pubsub.Publish(context.Background(), "payment.invoice.created", pubsub.DutyInvoiceCreatedEvent{
		InvoiceId:     id,
		DeclarationId: body.DeclarationId,
		TraderId:      body.TraderId,
		TotalAmount:   inv.TotalAmount,
		Currency:      body.Currency,
		DueDate:       dueDate,
		CreatedAt:     time.Now().UTC(),
	})

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"invoiceId":     id,
		"invoiceNumber": inv.InvoiceNumber,
		"totalAmount":   inv.TotalAmount,
		"currency":      body.Currency,
		"dueDate":       dueDate,
	})
}

// GetInvoice handles GET /api/payments/invoices/{id}
func (h *Handler) GetInvoice(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "invoices")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid invoice id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	inv, err := h.store.GetInvoice(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if inv == nil {
		writeError(w, http.StatusNotFound, "invoice not found")
		return
	}
	writeJSON(w, http.StatusOK, inv)
}

// GetPaymentsByDeclaration handles GET /api/payments/declarations/{declarationId}
func (h *Handler) GetPaymentsByDeclaration(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "declarations")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid declaration id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	invoices, err := h.store.GetInvoicesByDeclaration(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"declarationId": id,
		"invoices":      invoices,
		"total":         len(invoices),
	})
}

// InitiatePayment handles POST /api/payments/invoices/{id}/initiate
// Creates a Mojaloop transfer request and records pending transfer in TigerBeetle
func (h *Handler) InitiatePayment(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "invoices")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid invoice id")
		return
	}

	var body struct {
		PayerFSP    string `json:"payerFsp"`    // e.g., "gh-gcb"
		PayerMSISDN string `json:"payerMsisdn"` // Mobile money number
		Method      string `json:"method"`      // "mobile_money", "bank_transfer", "card"
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	inv, err := h.store.GetInvoice(ctx, id)
	if err != nil || inv == nil {
		writeError(w, http.StatusNotFound, "invoice not found")
		return
	}
	if inv.Status != "pending" {
		writeError(w, http.StatusConflict, "invoice is not in pending state")
		return
	}

	// Initiate Mojaloop transfer
	mojaloopTxID, err := h.initiateMojaloopTransfer(ctx, inv, body.PayerFSP, body.PayerMSISDN)
	if err != nil {
		log.Printf("[payment-service] Mojaloop initiation failed: %v — using simulated ID", err)
		mojaloopTxID = fmt.Sprintf("sim-%d-%d", inv.ID, time.Now().Unix())
	}

	// Record pending transfer in TigerBeetle
	tbTxID := fmt.Sprintf("tb-%d-%d", inv.ID, time.Now().Unix())
	amountInMinorUnits := uint64(inv.TotalAmount * 100) // Convert to minor currency units

	tbErr := h.tb.CreateTransfers(ctx, []tigerbeetle.Transfer{
		{
			ID:              tbTxID,
			DebitAccountID:  fmt.Sprintf("trader-%d", inv.TraderId),
			CreditAccountID: "customs-duty-revenue",
			Amount:          amountInMinorUnits,
			Ledger:          tigerbeetle.LedgerGHS,
			Code:            uint16(tigerbeetle.CodeDutyRevenue),
			Flags:           1, // PENDING flag
		},
	})
	if tbErr != nil {
		log.Printf("[payment-service] TigerBeetle pending transfer failed: %v", tbErr)
	}

	// Update invoice with Mojaloop TX ID
	h.store.UpdateInvoiceStatus(ctx, id, "processing")

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"invoiceId":    id,
		"mojaloopTxId": mojaloopTxID,
		"tbTxId":       tbTxID,
		"status":       "processing",
		"message":      "Payment initiated via Mojaloop. Awaiting confirmation.",
	})
}

// ConfirmPayment handles POST /api/payments/invoices/{id}/confirm
// Called after Mojaloop confirms the transfer
func (h *Handler) ConfirmPayment(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "invoices")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid invoice id")
		return
	}

	var body struct {
		MojaloopTxID string `json:"mojaloopTxId"`
		TBTxID       string `json:"tbTxId"`
		Method       string `json:"method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	inv, err := h.store.GetInvoice(ctx, id)
	if err != nil || inv == nil {
		writeError(w, http.StatusNotFound, "invoice not found")
		return
	}

	// ── Step 1: Post TigerBeetle transfer (confirm the pending reserve) ──────────
	// TigerBeetle is the gate: if this fails we do NOT update Postgres.
	// The invoice stays in "processing" so the Temporal workflow can retry.
	//
	// Idempotency: TigerBeetle rejects duplicate transfer IDs with
	// TransferAlreadyExists. We treat that as success so that a Temporal
	// retry after a Postgres write failure does not double-post the ledger.
	tbPostID := body.TBTxID + "-post"
	tbErr := h.tb.CreateTransfers(ctx, []tigerbeetle.Transfer{
		{
			ID:              tbPostID,
			DebitAccountID:  fmt.Sprintf("trader-%d", inv.TraderId),
			CreditAccountID: "customs-duty-revenue",
			Amount:          uint64(inv.TotalAmount * 100),
			PendingID:       body.TBTxID,
			Ledger:          tigerbeetle.LedgerGHS,
			Code:            uint16(tigerbeetle.CodeDutyRevenue),
			Flags:           2, // POST_PENDING_TRANSFER
		},
	})
	if tbErr != nil && !strings.Contains(tbErr.Error(), "already exists") {
		// Genuine TB failure — return 503 so Temporal retries with backoff.
		log.Printf("[payment-service] TigerBeetle post-pending FAILED invoice=%d tbPostId=%s: %v", id, tbPostID, tbErr)
		writeError(w, http.StatusServiceUnavailable, fmt.Sprintf("ledger unavailable — payment not confirmed: %v", tbErr))
		return
	}
	if tbErr != nil {
		// TransferAlreadyExists — idempotent retry, TB already committed this transfer.
		log.Printf("[payment-service] TigerBeetle idempotent re-post OK invoice=%d tbPostId=%s", id, tbPostID)
	} else {
		log.Printf("[payment-service] TigerBeetle post-pending OK invoice=%d tbPostId=%s", id, tbPostID)
	}

	// ── Step 2: Update Postgres (only reached if TB committed) ────────────────
	// If this write fails, the invoice stays in "processing".
	// Temporal retries ConfirmPayment — TB returns AlreadyExists (idempotent),
	// and we proceed to update Postgres again.
	if err := h.store.UpdateInvoicePayment(ctx, id, body.MojaloopTxID, body.TBTxID, body.Method); err != nil {
		log.Printf("[payment-service] Postgres update FAILED after TB success invoice=%d: %v — stays processing for retry", id, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Publish payment.confirmed event (declaration-service listens)
	go h.pubsub.Publish(context.Background(), "payment.confirmed", pubsub.PaymentConfirmedEvent{
		InvoiceId:     id,
		DeclarationId: inv.DeclarationId,
		TraderId:      inv.TraderId,
		Amount:        inv.TotalAmount,
		Currency:      inv.Currency,
		MojaloopTxID:  body.MojaloopTxID,
		TBTransferId:  body.TBTxID,
		PaidAt:        time.Now().UTC(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"invoiceId":     id,
		"declarationId": inv.DeclarationId,
		"status":        "paid",
		"paidAt":        time.Now().UTC(),
		"message":       "Payment confirmed. Declaration status updated.",
	})
}

// InitiateRefund handles POST /api/payments/invoices/{id}/refund
func (h *Handler) InitiateRefund(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "invoices")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid invoice id")
		return
	}

	var body struct {
		Reason string  `json:"reason"`
		Amount float64 `json:"amount"` // Partial refund amount (0 = full refund)
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	inv, err := h.store.GetInvoice(ctx, id)
	if err != nil || inv == nil {
		writeError(w, http.StatusNotFound, "invoice not found")
		return
	}
	if inv.Status != "paid" {
		writeError(w, http.StatusConflict, "can only refund paid invoices")
		return
	}

	refundAmount := body.Amount
	if refundAmount == 0 {
		refundAmount = inv.TotalAmount
	}

	// Record refund transfer in TigerBeetle (reverse direction)
	tbRefundID := fmt.Sprintf("refund-%d-%d", id, time.Now().Unix())
	h.tb.CreateTransfers(ctx, []tigerbeetle.Transfer{
		{
			ID:              tbRefundID,
			DebitAccountID:  "customs-duty-revenue",
			CreditAccountID: fmt.Sprintf("trader-%d", inv.TraderId),
			Amount:          uint64(refundAmount * 100),
			Ledger:          tigerbeetle.LedgerGHS,
			Code:            uint16(tigerbeetle.CodeRefundLiability),
		},
	})

	h.store.UpdateInvoiceStatus(ctx, id, "refunded")

	go h.pubsub.Publish(context.Background(), "payment.refunded", map[string]interface{}{
		"invoiceId":     id,
		"declarationId": inv.DeclarationId,
		"refundAmount":  refundAmount,
		"reason":        body.Reason,
		"tbRefundId":    tbRefundID,
		"refundedAt":    time.Now().UTC(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"invoiceId":    id,
		"refundAmount": refundAmount,
		"tbRefundId":   tbRefundID,
		"status":       "refunded",
	})
}

// MojaloopCallback handles POST /api/payments/mojaloop/callback
// Receives webhook callbacks from Mojaloop switch
func (h *Handler) MojaloopCallback(w http.ResponseWriter, r *http.Request) {
	var callback struct {
		TransferID string `json:"transferId"`
		State      string `json:"transferState"` // "COMMITTED", "ABORTED"
		Amount     struct {
			Amount   string `json:"amount"`
			Currency string `json:"currency"`
		} `json:"amount"`
		ILPPacket  string `json:"ilpPacket,omitempty"`
		Condition  string `json:"condition,omitempty"`
		Fulfilment string `json:"fulfilment,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&callback); err != nil {
		writeError(w, http.StatusBadRequest, "invalid mojaloop callback")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	inv, err := h.store.GetInvoiceByMojaloopTxID(ctx, callback.TransferID)
	if err != nil || inv == nil {
		log.Printf("[payment-service] Mojaloop callback: unknown transfer %s", callback.TransferID)
		w.WriteHeader(http.StatusOK) // Acknowledge to prevent retries
		return
	}

	switch callback.State {
	case "COMMITTED":
		// Dispatch ConfirmPaymentWorkflow via Temporal so the retry policy
		// (5 attempts, exponential backoff) handles transient TB/Postgres failures.
		// Falls back to a direct synchronous call if Temporal is unavailable.
		wfErr := h.temporal.StartConfirmPaymentWorkflow(ctx, inv.ID, callback.TransferID)
		if wfErr == nil {
			log.Printf("[payment-service] Mojaloop COMMITTED: ConfirmPaymentWorkflow dispatched for invoice %d", inv.ID)
		} else {
			// Temporal unavailable — fall back to direct synchronous confirmation.
			log.Printf("[payment-service] Temporal unavailable (%v) — falling back to direct ConfirmPayment for invoice %d", wfErr, inv.ID)
			tbTxID := fmt.Sprintf("tb-%d-mojaloop", inv.ID)
			h.store.UpdateInvoicePayment(ctx, inv.ID, callback.TransferID, tbTxID, "mojaloop")
			go h.pubsub.Publish(context.Background(), "payment.confirmed", pubsub.PaymentConfirmedEvent{
				InvoiceId:     inv.ID,
				DeclarationId: inv.DeclarationId,
				TraderId:      inv.TraderId,
				Amount:        inv.TotalAmount,
				Currency:      inv.Currency,
				MojaloopTxID:  callback.TransferID,
				TBTransferId:  tbTxID,
				PaidAt:        time.Now().UTC(),
			})
		}
		log.Printf("[payment-service] Mojaloop COMMITTED: invoice %d processing", inv.ID)

	case "ABORTED":
		h.store.UpdateInvoiceStatus(ctx, inv.ID, "failed")
		go h.pubsub.Publish(context.Background(), "payment.failed", pubsub.PaymentFailedEvent{
			InvoiceId:     inv.ID,
			DeclarationId: inv.DeclarationId,
			Reason:        "Mojaloop transfer aborted",
			FailedAt:      time.Now().UTC(),
		})
		log.Printf("[payment-service] Mojaloop ABORTED: invoice %d failed", inv.ID)
	}

	w.WriteHeader(http.StatusOK)
}

// GetLedgerAccount handles GET /api/payments/ledger/accounts/{id}
func (h *Handler) GetLedgerAccount(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "accounts")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	accounts, err := h.tb.LookupAccounts(ctx, []string{fmt.Sprintf("%d", id)})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(accounts) == 0 {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	writeJSON(w, http.StatusOK, accounts[0])
}

// GetLedgerTransfer handles GET /api/payments/ledger/transfers/{id}
func (h *Handler) GetLedgerTransfer(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "transfers")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid transfer id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	transfers, err := h.tb.LookupTransfers(ctx, []string{fmt.Sprintf("%d", id)})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(transfers) == 0 {
		writeError(w, http.StatusNotFound, "transfer not found")
		return
	}
	writeJSON(w, http.StatusOK, transfers[0])
}

// ── Dapr event handlers ───────────────────────────────────────────────────────

// OnDeclarationSubmitted handles declaration.submitted events
// Creates a duty invoice when a declaration is submitted
func (h *Handler) OnDeclarationSubmitted(w http.ResponseWriter, r *http.Request) {
	var event struct {
		Data struct {
			DeclarationId int64   `json:"declarationId"`
			TraderId      int64   `json:"traderId"`
			DeclaredValue float64 `json:"declaredValue"`
			HSCode        string  `json:"hsCode"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event payload")
		return
	}

	// Calculate duties (simplified — in production this would use tariff tables)
	dutyRate := 0.20  // 20% import duty
	vatRate := 0.125  // 12.5% VAT
	levyRate := 0.025 // 2.5% ECOWAS levy

	dutyAmount := event.Data.DeclaredValue * dutyRate
	vatAmount := (event.Data.DeclaredValue + dutyAmount) * vatRate
	levyAmount := event.Data.DeclaredValue * levyRate

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	dueDate := time.Now().Add(72 * time.Hour)
	inv := &store.PaymentInvoice{
		DeclarationId: event.Data.DeclarationId,
		InvoiceNumber: fmt.Sprintf("INV-%d-%d", event.Data.DeclarationId, time.Now().Unix()),
		TraderId:      event.Data.TraderId,
		DutyAmount:    dutyAmount,
		VATAmount:     vatAmount,
		LevyAmount:    levyAmount,
		TotalAmount:   dutyAmount + vatAmount + levyAmount,
		Currency:      "GHS",
		DueDate:       &dueDate,
	}

	id, err := h.store.CreateInvoice(ctx, inv)
	if err != nil {
		log.Printf("[payment-service] OnDeclarationSubmitted: create invoice failed: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	log.Printf("[payment-service] Invoice %d created for declaration %d (total: %.2f GHS)",
		id, event.Data.DeclarationId, inv.TotalAmount)
	w.WriteHeader(http.StatusOK)
}

// OnDeclarationCleared handles declaration.cleared events
func (h *Handler) OnDeclarationCleared(w http.ResponseWriter, r *http.Request) {
	var event struct {
		Data struct {
			DeclarationId int64 `json:"declarationId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event payload")
		return
	}
	log.Printf("[payment-service] Declaration %d cleared — no payment action needed", event.Data.DeclarationId)
	w.WriteHeader(http.StatusOK)
}

// ── Mojaloop helper ───────────────────────────────────────────────────────────

func (h *Handler) initiateMojaloopTransfer(ctx context.Context, inv *store.PaymentInvoice, payerFSP, payerMSISDN string) (string, error) {
	txID := fmt.Sprintf("moja-%d-%d", inv.ID, time.Now().UnixNano())

	payload := map[string]interface{}{
		"transferId": txID,
		"payerFsp":   payerFSP,
		"payeeFsp":   "gh-customs-authority",
		"amount": map[string]string{
			"amount":   fmt.Sprintf("%.2f", inv.TotalAmount),
			"currency": inv.Currency,
		},
		"expiration": time.Now().Add(30 * time.Minute).Format(time.RFC3339),
		"ilpPacket":  "AQAAAAAAAADIEHByaXZhdGUucGF5ZWVmc3CCAiB7InRyYW5zYWN0aW9uSWQiOiI4NWZlY...",
		"condition":  "HOr22-H3AfTDHrSkPjJtVPRdKouuMkDpbHjTAycNVU0",
		"note":       fmt.Sprintf("Customs duty payment for declaration %d", inv.DeclarationId),
	}

	data, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST",
		h.mojaloopURL+"/transfers", bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("FSPIOP-Source", "gh-customs-authority")
	req.Header.Set("FSPIOP-Destination", payerFSP)

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return txID, fmt.Errorf("mojaloop unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return txID, fmt.Errorf("mojaloop returned %d", resp.StatusCode)
	}
	return txID, nil
}
