// handlers — HTTP handlers for declaration-service
package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tradegateway/declaration-service/internal/pubsub"
	"github.com/tradegateway/declaration-service/internal/store"
)

// Handler holds dependencies for HTTP handlers
type Handler struct {
	store  *store.Store
	pubsub *pubsub.Client
}

// New creates a new Handler
func New(st *store.Store, ps *pubsub.Client) *Handler {
	return &Handler{store: st, pubsub: ps}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func pathID(r *http.Request, segment string) (int64, error) {
	// Extract {id} from URL path like /api/declarations/42
	parts := strings.Split(r.URL.Path, "/")
	for i, p := range parts {
		if p == segment && i+1 < len(parts) {
			return strconv.ParseInt(parts[i+1], 10, 64)
		}
	}
	return 0, nil
}

// ── Declaration handlers ──────────────────────────────────────────────────────

// GetDeclaration handles GET /api/declarations/{id}
func (h *Handler) GetDeclaration(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "declarations")
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "invalid declaration id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	decl, err := h.store.GetDeclaration(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if decl == nil {
		writeError(w, http.StatusNotFound, "declaration not found")
		return
	}
	writeJSON(w, http.StatusOK, decl)
}

// ListDeclarations handles GET /api/declarations
func (h *Handler) ListDeclarations(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 50
	offset := 0
	if l := q.Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}
	if o := q.Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	var traderId *int64
	if t := q.Get("traderId"); t != "" {
		if v, err := strconv.ParseInt(t, 10, 64); err == nil {
			traderId = &v
		}
	}

	var status *string
	if s := q.Get("status"); s != "" {
		status = &s
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	decls, total, err := h.store.ListDeclarations(ctx, traderId, status, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"declarations": decls,
		"total":        total,
		"limit":        limit,
		"offset":       offset,
	})
}

// CreateDeclaration handles POST /api/declarations
func (h *Handler) CreateDeclaration(w http.ResponseWriter, r *http.Request) {
	// In production, this would parse and validate the full declaration payload.
	// For now, we return a 501 since declarations are created via the tRPC server.
	writeJSON(w, http.StatusNotImplemented, map[string]string{
		"message": "Use the tRPC declarations.create procedure to create declarations",
	})
}

// UpdateDeclarationStatus handles PUT /api/declarations/{id}/status
func (h *Handler) UpdateDeclarationStatus(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "declarations")
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "invalid declaration id")
		return
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// SW-M4: status updates require an officer role.
	if role, _ := r.Context().Value("role").(string); role != "admin" && role != "customs_officer" && role != "inspector" && role != "service" {
		writeError(w, http.StatusForbidden, "status updates require an officer role")
		return
	}

	validStatuses := map[string]bool{
		"submitted": true, "under_review": true, "inspection_required": true,
		"payment_pending": true, "rejected": true, "cancelled": true,
	}
	if !validStatuses[body.Status] {
		// SW-M4: payment_confirmed flows only from the verified payment event;
		// cleared flows only from POST /clear with payment+permit verification.
		writeError(w, http.StatusBadRequest, "invalid or restricted status value (payment_confirmed and cleared are system-controlled)")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.store.UpdateDeclarationStatus(ctx, id, body.Status); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Publish status change event
	topic := "declaration." + strings.ReplaceAll(body.Status, "_", "-")
	go h.pubsub.Publish(context.Background(), topic, map[string]interface{}{
		"declarationId": id,
		"status":        body.Status,
		"updatedAt":     time.Now().UTC(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"declarationId": id,
		"status":        body.Status,
		"updated":       true,
	})
}

// TriggerRiskScore handles POST /api/declarations/{id}/score
func (h *Handler) TriggerRiskScore(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "declarations")
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "invalid declaration id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	decl, err := h.store.GetDeclaration(ctx, id)
	if err != nil || decl == nil {
		writeError(w, http.StatusNotFound, "declaration not found")
		return
	}

	// Publish to risk-engine via Dapr pub/sub
	err = h.pubsub.Publish(ctx, "declaration.submitted", pubsub.DeclarationSubmittedEvent{
		DeclarationId:     decl.ID,
		DeclarationNumber: decl.DeclarationNumber,
		TraderId:          decl.TraderId,
		HSCode:            decl.HSCode,
		DeclaredValue:     decl.DeclaredValue,
		OriginCountry:     decl.OriginCountry,
		SubmittedAt:       time.Now().UTC(),
	})
	if err != nil {
		log.Printf("[declaration-service] Warning: could not publish to risk-engine: %v", err)
		// Graceful degradation: return success anyway (Dapr may be offline)
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"declarationId": id,
		"message":       "Risk scoring triggered via Dapr pub/sub (kafka topic: declaration.submitted)",
		"daprAvailable": err == nil,
	})
}

// CreateOGAPermits handles POST /api/declarations/{id}/oga-permits
func (h *Handler) CreateOGAPermits(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "declarations")
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "invalid declaration id")
		return
	}

	var body struct {
		Permits []struct {
			AgencyCode string  `json:"agencyCode"`
			AgencyName string  `json:"agencyName"`
			PermitType *string `json:"permitType,omitempty"`
		} `json:"permits"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var created []int64
	for _, p := range body.Permits {
		permitId, err := h.store.CreateOGAPermit(ctx, &store.OGAPermit{
			DeclarationId: id,
			AgencyCode:    p.AgencyCode,
			AgencyName:    p.AgencyName,
			PermitType:    p.PermitType,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		created = append(created, permitId)

		// Notify OGA via Dapr pub/sub
		permitType := ""
		if p.PermitType != nil {
			permitType = *p.PermitType
		}
		go h.pubsub.Publish(context.Background(), "oga.permit.requested", pubsub.OGAPermitRequestedEvent{
			PermitId:      permitId,
			DeclarationId: id,
			AgencyCode:    p.AgencyCode,
			AgencyName:    p.AgencyName,
			PermitType:    permitType,
			RequestedAt:   time.Now().UTC(),
		})
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"declarationId": id,
		"permitsCreated": len(created),
		"permitIds":     created,
	})
}

// GetOGAPermits handles GET /api/declarations/{id}/oga-permits
func (h *Handler) GetOGAPermits(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "declarations")
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "invalid declaration id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	permits, err := h.store.GetOGAPermits(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"declarationId": id,
		"permits":       permits,
		"total":         len(permits),
	})
}

// IssueClearance handles POST /api/declarations/{id}/clear
func (h *Handler) IssueClearance(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "declarations")
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "invalid declaration id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// SW-M4: clearance requires an officer role.
	if role, _ := r.Context().Value("role").(string); role != "admin" && role != "customs_officer" && role != "service" {
		writeError(w, http.StatusForbidden, "clearance requires a customs officer role")
		return
	}

	// Check all OGA permits are resolved
	allApproved, anyRejected, err := h.store.AllOGAPermitsResolved(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if anyRejected {
		writeError(w, http.StatusConflict, "cannot clear: one or more OGA permits rejected")
		return
	}
	if !allApproved {
		// SW-M4: zero-permit auto-clear removed — an explicit exemption is required.
		exempt, _ := h.store.HasPermitExemption(ctx, id)
		if !exempt {
			writeError(w, http.StatusConflict, "cannot clear: awaiting OGA permit approvals or an explicit permit exemption")
			return
		}
	}

	// SW-M4: clearance REQUIRES verified payment — set only by the
	// payment.confirmed event consumer, never by the caller.
	paid, err := h.store.DeclarationPaymentConfirmed(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !paid {
		writeError(w, http.StatusConflict, "cannot clear: payment is not confirmed")
		return
	}

	if err := h.store.UpdateDeclarationStatus(ctx, id, "cleared"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Publish clearance event
	go h.pubsub.Publish(context.Background(), "declaration.cleared", pubsub.DeclarationClearedEvent{
		DeclarationId: id,
		ClearedAt:     time.Now().UTC(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"declarationId": id,
		"status":        "cleared",
		"clearedAt":     time.Now().UTC(),
		"message":       "Declaration cleared. Cargo release authorization issued.",
	})
}

// ── Dapr event handlers ───────────────────────────────────────────────────────

// OnPaymentConfirmed handles Dapr subscription event: payment.confirmed
func (h *Handler) OnPaymentConfirmed(w http.ResponseWriter, r *http.Request) {
	var event struct {
		Data struct {
			DeclarationId int64 `json:"declarationId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.store.UpdateDeclarationStatus(ctx, event.Data.DeclarationId, "payment_confirmed"); err != nil {
		log.Printf("[declaration-service] OnPaymentConfirmed: update status failed: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	log.Printf("[declaration-service] Payment confirmed for declaration %d — status updated to payment_confirmed", event.Data.DeclarationId)
	w.WriteHeader(http.StatusOK)
}

// OnOGAPermitApproved handles Dapr subscription event: oga.permit.approved
func (h *Handler) OnOGAPermitApproved(w http.ResponseWriter, r *http.Request) {
	var event struct {
		Data struct {
			DeclarationId int64  `json:"declarationId"`
			AgencyCode    string `json:"agencyCode"`
			PermitId      int64  `json:"permitId"`
			PermitRef     string `json:"permitRef"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.store.UpdateOGAPermitStatus(ctx, event.Data.PermitId, "approved", event.Data.PermitRef); err != nil {
		log.Printf("[declaration-service] OnOGAPermitApproved: update permit failed: %v", err)
	}

	// Check if all permits are now approved
	allApproved, anyRejected, err := h.store.AllOGAPermitsResolved(ctx, event.Data.DeclarationId)
	if err == nil && allApproved && !anyRejected {
		// Auto-issue clearance if payment already confirmed
		decl, _ := h.store.GetDeclaration(ctx, event.Data.DeclarationId)
		if decl != nil && decl.Status == "payment_confirmed" {
			h.store.UpdateDeclarationStatus(ctx, event.Data.DeclarationId, "cleared")
			go h.pubsub.Publish(context.Background(), "declaration.cleared", map[string]interface{}{
				"declarationId": event.Data.DeclarationId,
				"clearedAt":     time.Now().UTC(),
			})
			log.Printf("[declaration-service] All OGA permits approved + payment confirmed — declaration %d auto-cleared", event.Data.DeclarationId)
		}
	}

	w.WriteHeader(http.StatusOK)
}

// OnOGAPermitRejected handles Dapr subscription event: oga.permit.rejected
func (h *Handler) OnOGAPermitRejected(w http.ResponseWriter, r *http.Request) {
	var event struct {
		Data struct {
			DeclarationId int64  `json:"declarationId"`
			AgencyCode    string `json:"agencyCode"`
			PermitId      int64  `json:"permitId"`
			Reason        string `json:"reason"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	h.store.UpdateOGAPermitStatus(ctx, event.Data.PermitId, "rejected", "")
	h.store.UpdateDeclarationStatus(ctx, event.Data.DeclarationId, "rejected")

	go h.pubsub.Publish(context.Background(), "declaration.rejected", pubsub.DeclarationRejectedEvent{
		DeclarationId: event.Data.DeclarationId,
		Reason:        event.Data.Reason,
		AgencyCode:    event.Data.AgencyCode,
		RejectedAt:    time.Now().UTC(),
	})

	log.Printf("[declaration-service] OGA permit rejected by %s — declaration %d rejected", event.Data.AgencyCode, event.Data.DeclarationId)
	w.WriteHeader(http.StatusOK)
}

// OnSanctionsHit handles Dapr subscription event: sanctions.hit
func (h *Handler) OnSanctionsHit(w http.ResponseWriter, r *http.Request) {
	var event struct {
		Data struct {
			DeclarationId int64  `json:"declarationId"`
			EntityType    string `json:"entityType"`
			ListName      string `json:"listName"`
			MatchScore    float64 `json:"matchScore"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// Freeze declaration pending compliance review
	h.store.UpdateDeclarationStatus(ctx, event.Data.DeclarationId, "under_review")
	log.Printf("[declaration-service] Sanctions hit on declaration %d (entity: %s, list: %s, score: %.2f) — frozen for review",
		event.Data.DeclarationId, event.Data.EntityType, event.Data.ListName, event.Data.MatchScore)

	w.WriteHeader(http.StatusOK)
}
