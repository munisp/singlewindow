// handlers — HTTP handlers for profile-service
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

	"github.com/tradegateway/profile-service/internal/store"
)

type Handler struct {
	store    *store.Store
	daprPort string
	http     *http.Client
}

func New(st *store.Store, daprPort string) *Handler {
	return &Handler{
		store:    st,
		daprPort: daprPort,
		http:     &http.Client{Timeout: 10 * time.Second},
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
	return 0, fmt.Errorf("segment %s not found", segment)
}

func (h *Handler) publish(ctx context.Context, topic string, data interface{}) {
	payload, _ := json.Marshal(data)
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/%s", h.daprPort, topic)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.http.Do(req)
	if err != nil {
		log.Printf("[profile-service] Dapr publish error (topic=%s): %v", topic, err)
		return
	}
	resp.Body.Close()
}

// GetProfile handles GET /api/profiles/{id}
func (h *Handler) GetProfile(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "profiles")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid profile id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	profile, err := h.store.GetProfile(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if profile == nil {
		writeError(w, http.StatusNotFound, "profile not found")
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

// UpdateProfile handles PUT /api/profiles/{id}
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "profiles")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid profile id")
		return
	}

	var body struct {
		Address *string `json:"address,omitempty"`
		Phone   *string `json:"phone,omitempty"`
		Email   *string `json:"email,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.store.UpdateProfile(ctx, id, body.Address, body.Phone, body.Email); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"profileId": id, "updated": true})
}

// GetComplianceScore handles GET /api/profiles/{id}/compliance
func (h *Handler) GetComplianceScore(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "profiles")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid profile id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	profile, err := h.store.GetProfile(ctx, id)
	if err != nil || profile == nil {
		writeError(w, http.StatusNotFound, "profile not found")
		return
	}

	// Calculate AEO eligibility based on compliance score
	aeoEligible := profile.ComplianceScore >= 95 && profile.TotalDeclarations >= 50
	aeoTier := "none"
	if aeoEligible {
		if profile.ComplianceScore >= 99 {
			aeoTier = "gold"
		} else if profile.ComplianceScore >= 97 {
			aeoTier = "silver"
		} else {
			aeoTier = "bronze"
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"profileId":            id,
		"companyName":          profile.CompanyName,
		"complianceScore":      profile.ComplianceScore,
		"totalDeclarations":    profile.TotalDeclarations,
		"clearedDeclarations":  profile.ClearedDeclarations,
		"rejectedDeclarations": profile.RejectedDeclarations,
		"clearanceRate":        func() float64 {
			if profile.TotalDeclarations == 0 {
				return 100.0
			}
			return 100.0 * float64(profile.ClearedDeclarations) / float64(profile.TotalDeclarations)
		}(),
		"aeoEligible": aeoEligible,
		"aeoTier":     aeoTier,
		"kycStatus":   profile.KYCStatus,
	})
}

// VerifyKYC handles POST /api/profiles/{id}/kyc/verify
func (h *Handler) VerifyKYC(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "profiles")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid profile id")
		return
	}

	var body struct {
		Documents []string `json:"documents"` // Document IDs to verify
		VerifiedBy string  `json:"verifiedBy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.store.UpdateKYCStatus(ctx, id, "verified"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	go h.publish(context.Background(), "profile.kyc.verified", map[string]interface{}{
		"profileId":  id,
		"verifiedBy": body.VerifiedBy,
		"verifiedAt": time.Now().UTC(),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"profileId":  id,
		"kycStatus":  "verified",
		"verifiedAt": time.Now().UTC(),
	})
}

// GetAEOStatus handles GET /api/profiles/{id}/aeo
func (h *Handler) GetAEOStatus(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "profiles")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid profile id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	profile, err := h.store.GetProfile(ctx, id)
	if err != nil || profile == nil {
		writeError(w, http.StatusNotFound, "profile not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"profileId":  id,
		"aeoStatus":  profile.AEOStatus,
		"aeoTier":    profile.AEOTier,
		"eligible":   profile.ComplianceScore >= 95 && profile.TotalDeclarations >= 50,
		"score":      profile.ComplianceScore,
		"minScore":   95.0,
		"minDecls":   50,
		"totalDecls": profile.TotalDeclarations,
	})
}

// ApplyForAEO handles POST /api/profiles/{id}/aeo/apply
func (h *Handler) ApplyForAEO(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "profiles")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid profile id")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	profile, err := h.store.GetProfile(ctx, id)
	if err != nil || profile == nil {
		writeError(w, http.StatusNotFound, "profile not found")
		return
	}

	if profile.ComplianceScore < 95 || profile.TotalDeclarations < 50 {
		writeError(w, http.StatusConflict, fmt.Sprintf(
			"AEO eligibility requirements not met (score: %.1f/95, declarations: %d/50)",
			profile.ComplianceScore, profile.TotalDeclarations))
		return
	}

	tier := "bronze"
	if profile.ComplianceScore >= 99 {
		tier = "gold"
	} else if profile.ComplianceScore >= 97 {
		tier = "silver"
	}

	if err := h.store.UpdateAEOStatus(ctx, id, "pending", tier); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	go h.publish(context.Background(), "profile.aeo.applied", map[string]interface{}{
		"profileId":   id,
		"companyName": profile.CompanyName,
		"tier":        tier,
		"score":       profile.ComplianceScore,
		"appliedAt":   time.Now().UTC(),
	})

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"profileId": id,
		"aeoStatus": "pending",
		"aeoTier":   tier,
		"message":   fmt.Sprintf("AEO application submitted for %s tier review", tier),
	})
}

// ListProfiles handles GET /api/profiles
func (h *Handler) ListProfiles(w http.ResponseWriter, r *http.Request) {
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

	var kycStatus *string
	if s := q.Get("kycStatus"); s != "" {
		kycStatus = &s
	}
	var aeoStatus *string
	if s := q.Get("aeoStatus"); s != "" {
		aeoStatus = &s
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	profiles, total, err := h.store.ListProfiles(ctx, kycStatus, aeoStatus, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"profiles": profiles,
		"total":    total,
		"limit":    limit,
		"offset":   offset,
	})
}

// ── Dapr event handlers ───────────────────────────────────────────────────────

// OnDeclarationCleared updates compliance score when a declaration is cleared
func (h *Handler) OnDeclarationCleared(w http.ResponseWriter, r *http.Request) {
	var event struct {
		Data struct {
			DeclarationId int64 `json:"declarationId"`
			TraderId      int64 `json:"traderId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.store.RecordDeclarationOutcome(ctx, event.Data.TraderId, true); err != nil {
		log.Printf("[profile-service] OnDeclarationCleared: update score failed: %v", err)
	}
	w.WriteHeader(http.StatusOK)
}

// OnDeclarationRejected updates compliance score when a declaration is rejected
func (h *Handler) OnDeclarationRejected(w http.ResponseWriter, r *http.Request) {
	var event struct {
		Data struct {
			DeclarationId int64 `json:"declarationId"`
			TraderId      int64 `json:"traderId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeError(w, http.StatusBadRequest, "invalid event payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.store.RecordDeclarationOutcome(ctx, event.Data.TraderId, false); err != nil {
		log.Printf("[profile-service] OnDeclarationRejected: update score failed: %v", err)
	}
	w.WriteHeader(http.StatusOK)
}
