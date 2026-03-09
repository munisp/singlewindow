// handlers — HTTP handlers for oga-service
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tradegateway/oga-service/internal/pubsub"
	"github.com/tradegateway/oga-service/internal/store"
)

// OGA agencies registry
var agencies = []map[string]string{
	{"code": "FDA", "name": "Food & Drug Authority", "slaHours": "48"},
	{"code": "EPA", "name": "Environmental Protection Agency", "slaHours": "72"},
	{"code": "MOH", "name": "Ministry of Health", "slaHours": "48"},
	{"code": "MOFA", "name": "Ministry of Foreign Affairs", "slaHours": "24"},
	{"code": "MOTI", "name": "Ministry of Trade & Industry", "slaHours": "48"},
	{"code": "MOAG", "name": "Ministry of Agriculture", "slaHours": "48"},
	{"code": "MOEN", "name": "Ministry of Energy", "slaHours": "72"},
	{"code": "NCA", "name": "Nuclear & Radiation Authority", "slaHours": "96"},
	{"code": "CEPS", "name": "Customs & Excise Preventive Service", "slaHours": "24"},
	{"code": "DVLA", "name": "Driver & Vehicle Licensing Authority", "slaHours": "48"},
	{"code": "GSA", "name": "Ghana Standards Authority", "slaHours": "48"},
	{"code": "GIPC", "name": "Ghana Investment Promotion Centre", "slaHours": "72"},
}

type Handler struct {
	store  *store.Store
	pubsub *pubsub.Client
}

func New(st *store.Store, ps *pubsub.Client) *Handler {
	return &Handler{store: st, pubsub: ps}
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
	return 0, fmt.Errorf("segment %s not found", segment)
}

func pathString(r *http.Request, segment string) string {
	parts := strings.Split(r.URL.Path, "/")
	for i, p := range parts {
		if p == segment && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

// ListPermits handles GET /api/oga/permits
func (h *Handler) ListPermits(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 50
	offset := 0
	if l := q.Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}
	if o := q.Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil {
			offset = v
		}
	}

	var agencyCode *string
	if a := q.Get("agencyCode"); a != "" {
		agencyCode = &a
	}
	var status *string
	if s := q.Get("status"); s != "" {
		status = &s
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	permits, total, err := h.store.ListPermits(ctx, agencyCode, status, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"permits": permits,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

// GetPermit handles GET /api/oga/permits/{id}
func (h *Handler) GetPermit(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "permits")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid permit id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	permit, err := h.store.GetPermit(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if permit == nil {
		writeError(w, http.StatusNotFound, "permit not found")
		return
	}
	writeJSON(w, http.StatusOK, permit)
}

// ApprovePermit handles POST /api/oga/permits/{id}/approve
func (h *Handler) ApprovePermit(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "permits")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid permit id")
		return
	}

	var body struct {
		PermitNumber string `json:"permitNumber"`
		ReviewedBy   string `json:"reviewedBy"`
		Notes        string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	permit, err := h.store.GetPermit(ctx, id)
	if err != nil || permit == nil {
		writeError(w, http.StatusNotFound, "permit not found")
		return
	}

	if err := h.store.ApprovePermit(ctx, id, body.PermitNumber, body.ReviewedBy, body.Notes); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Publish approval event
	go h.pubsub.Publish(context.Background(), "oga.permit.approved", pubsub.PermitApprovedEvent{
		PermitId:      id,
		DeclarationId: permit.DeclarationId,
		AgencyCode:    permit.AgencyCode,
		AgencyName:    permit.AgencyName,
		PermitRef:     body.PermitNumber,
		ApprovedBy:    body.ReviewedBy,
		ApprovedAt:    time.Now().UTC(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"permitId":      id,
		"declarationId": permit.DeclarationId,
		"status":        "approved",
		"permitNumber":  body.PermitNumber,
		"approvedAt":    time.Now().UTC(),
	})
}

// RejectPermit handles POST /api/oga/permits/{id}/reject
func (h *Handler) RejectPermit(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "permits")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid permit id")
		return
	}

	var body struct {
		ReviewedBy string `json:"reviewedBy"`
		Reason     string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	permit, err := h.store.GetPermit(ctx, id)
	if err != nil || permit == nil {
		writeError(w, http.StatusNotFound, "permit not found")
		return
	}

	if err := h.store.RejectPermit(ctx, id, body.ReviewedBy, body.Reason); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	go h.pubsub.Publish(context.Background(), "oga.permit.rejected", pubsub.PermitRejectedEvent{
		PermitId:      id,
		DeclarationId: permit.DeclarationId,
		AgencyCode:    permit.AgencyCode,
		AgencyName:    permit.AgencyName,
		Reason:        body.Reason,
		RejectedBy:    body.ReviewedBy,
		RejectedAt:    time.Now().UTC(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"permitId":      id,
		"declarationId": permit.DeclarationId,
		"status":        "rejected",
		"reason":        body.Reason,
		"rejectedAt":    time.Now().UTC(),
	})
}

// ListAgencies handles GET /api/oga/agencies
func (h *Handler) ListAgencies(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"agencies": agencies,
		"total":    len(agencies),
	})
}

// SLAReport handles GET /api/oga/sla/report
func (h *Handler) SLAReport(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	stats, err := h.store.GetSLAStats(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"report":      stats,
		"generatedAt": time.Now().UTC(),
	})
}

// AgencyWebhook handles POST /api/oga/webhooks/{agencyCode}
// Receives approval/rejection webhooks from external OGA systems
func (h *Handler) AgencyWebhook(w http.ResponseWriter, r *http.Request) {
	agencyCode := pathString(r, "webhooks")
	if agencyCode == "" {
		writeError(w, http.StatusBadRequest, "missing agency code")
		return
	}

	var payload struct {
		PermitID     int64  `json:"permitId"`
		Action       string `json:"action"` // "approve" or "reject"
		PermitNumber string `json:"permitNumber,omitempty"`
		ReviewedBy   string `json:"reviewedBy"`
		Notes        string `json:"notes,omitempty"`
		Reason       string `json:"reason,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid webhook payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	switch payload.Action {
	case "approve":
		if err := h.store.ApprovePermit(ctx, payload.PermitID, payload.PermitNumber, payload.ReviewedBy, payload.Notes); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		permit, _ := h.store.GetPermit(ctx, payload.PermitID)
		if permit != nil {
			go h.pubsub.Publish(context.Background(), "oga.permit.approved", pubsub.PermitApprovedEvent{
				PermitId:      payload.PermitID,
				DeclarationId: permit.DeclarationId,
				AgencyCode:    agencyCode,
				PermitRef:     payload.PermitNumber,
				ApprovedBy:    payload.ReviewedBy,
				ApprovedAt:    time.Now().UTC(),
			})
		}
		log.Printf("[oga-service] Webhook: %s approved permit %d", agencyCode, payload.PermitID)

	case "reject":
		if err := h.store.RejectPermit(ctx, payload.PermitID, payload.ReviewedBy, payload.Reason); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		permit, _ := h.store.GetPermit(ctx, payload.PermitID)
		if permit != nil {
			go h.pubsub.Publish(context.Background(), "oga.permit.rejected", pubsub.PermitRejectedEvent{
				PermitId:      payload.PermitID,
				DeclarationId: permit.DeclarationId,
				AgencyCode:    agencyCode,
				Reason:        payload.Reason,
				RejectedBy:    payload.ReviewedBy,
				RejectedAt:    time.Now().UTC(),
			})
		}
		log.Printf("[oga-service] Webhook: %s rejected permit %d", agencyCode, payload.PermitID)

	default:
		writeError(w, http.StatusBadRequest, "action must be 'approve' or 'reject'")
		return
	}

	w.WriteHeader(http.StatusOK)
}

// OnPermitRequested handles Dapr subscription event: oga.permit.requested
func (h *Handler) OnPermitRequested(w http.ResponseWriter, r *http.Request) {
	var event struct {
		Data struct {
			PermitId      int64  `json:"permitId"`
			DeclarationId int64  `json:"declarationId"`
			AgencyCode    string `json:"agencyCode"`
			AgencyName    string `json:"agencyName"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event payload")
		return
	}

	log.Printf("[oga-service] Permit %d requested for agency %s (declaration %d)",
		event.Data.PermitId, event.Data.AgencyCode, event.Data.DeclarationId)

	// In production, this would notify the agency via email/API/portal notification
	// For now, we just log and acknowledge
	w.WriteHeader(http.StatusOK)
}

// RunSLAMonitor runs a background goroutine that checks for SLA breaches every 5 minutes
func (h *Handler) RunSLAMonitor(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.checkSLABreaches(ctx)
		}
	}
}

func (h *Handler) checkSLABreaches(ctx context.Context) {
	permits, err := h.store.GetOverduePermits(ctx)
	if err != nil {
		log.Printf("[oga-service] SLA monitor error: %v", err)
		return
	}

	for _, p := range permits {
		hoursOverdue := time.Since(*p.SLADeadline).Hours()
		go h.pubsub.Publish(ctx, "oga.sla.breach", pubsub.SLABreachEvent{
			PermitId:      p.ID,
			DeclarationId: p.DeclarationId,
			AgencyCode:    p.AgencyCode,
			SLADeadline:   *p.SLADeadline,
			HoursOverdue:  hoursOverdue,
			DetectedAt:    time.Now().UTC(),
		})
		log.Printf("[oga-service] SLA breach: permit %d (agency %s) is %.1f hours overdue",
			p.ID, p.AgencyCode, hoursOverdue)
	}
}
