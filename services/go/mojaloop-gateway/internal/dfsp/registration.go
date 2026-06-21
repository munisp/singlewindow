// Package dfsp implements Mojaloop DFSP (Digital Financial Service Provider)
// registration for TradeGateway NGSWTP.
//
// The DFSP registration process involves:
//   1. POST /participants — register the DFSP with the Mojaloop Hub
//   2. POST /participants/{dfspId}/initialPositionAndLimits — set net debit cap
//   3. POST /participants/{dfspId}/accounts — create settlement and position accounts
//   4. PUT  /parties/MSISDN/{msisdn} — register the customs authority party in ALS
//   5. POST /participants/{dfspId}/endpoints — register FSPIOP callback URLs
//
// All operations are idempotent — safe to re-run on restart.
package dfsp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"go.uber.org/zap"
)

// ─── Config ───────────────────────────────────────────────────────────────────

// Config holds all configuration for DFSP registration.
type Config struct {
	// HubURL is the Mojaloop Hub admin API base URL (e.g. http://mojaloop-hub:3001)
	HubURL string
	// FSPIOP_URL is the Mojaloop FSPIOP adapter URL (e.g. http://mojaloop-fspiop:4000)
	FSPIOP_URL string
	// DFSP_ID is the unique identifier for TradeGateway as a DFSP (e.g. "tradegateway")
	DFSP_ID string
	// DFSP_Name is the human-readable DFSP name
	DFSP_Name string
	// CallbackBaseURL is the base URL for FSPIOP callbacks (e.g. http://mojaloop-gateway:8085)
	CallbackBaseURL string
	// Currency is the ISO 4217 currency code (e.g. "NGN")
	Currency string
	// NetDebitCapMinor is the net debit cap in minor units (e.g. 1_000_000_00 = 1M NGN)
	NetDebitCapMinor int64
	// CustomsPartyMSISDN is the MSISDN used to identify the customs authority in ALS
	CustomsPartyMSISDN string
}

// DefaultConfig returns a Config populated from environment variables with sensible defaults.
func DefaultConfig() Config {
	return Config{
		HubURL:             getEnv("MOJALOOP_HUB_URL", "http://localhost:3001"),
		FSPIOP_URL:         getEnv("MOJALOOP_FSPIOP_URL", "http://localhost:4000"),
		DFSP_ID:            getEnv("MOJALOOP_DFSP_ID", "tradegateway"),
		DFSP_Name:          getEnv("MOJALOOP_DFSP_NAME", "TradeGateway NGSWTP Customs Authority"),
		CallbackBaseURL:    getEnv("MOJALOOP_CALLBACK_BASE_URL", "http://mojaloop-gateway:8085"),
		Currency:           getEnv("MOJALOOP_CURRENCY", "NGN"),
		NetDebitCapMinor:   100_000_000_00, // 1 billion NGN in kobo
		CustomsPartyMSISDN: getEnv("MOJALOOP_CUSTOMS_MSISDN", "2348000000000"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Registration Result ──────────────────────────────────────────────────────

// RegistrationResult captures the outcome of each registration step.
type RegistrationResult struct {
	Step    string `json:"step"`
	Status  string `json:"status"` // "created" | "already_exists" | "failed"
	Message string `json:"message,omitempty"`
}

// RegistrationReport is the full report returned after registration.
type RegistrationReport struct {
	DFSP_ID string               `json:"dfsp_id"`
	Steps   []RegistrationResult `json:"steps"`
	Success bool                 `json:"success"`
}

// ─── Registrar ────────────────────────────────────────────────────────────────

// Registrar handles all DFSP registration steps.
type Registrar struct {
	cfg    Config
	client *http.Client
	logger *zap.Logger
	// signer is the JWS signer used to add FSPIOP-Signature to all outbound requests.
	// If nil, requests are sent without a signature (development/test mode only).
	signer *Signer
}

// NewRegistrar creates a new Registrar with the given config.
// The signer parameter may be nil — in that case outbound requests are sent
// without FSPIOP-Signature headers (suitable for unit tests and local dev).
func NewRegistrar(cfg Config, logger *zap.Logger, signer *Signer) *Registrar {
	return &Registrar{
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second},
		logger: logger,
		signer: signer,
	}
}

// Register executes all DFSP registration steps in order.
// It is idempotent — steps that have already been completed are skipped.
func (r *Registrar) Register(ctx context.Context) (*RegistrationReport, error) {
	report := &RegistrationReport{
		DFSP_ID: r.cfg.DFSP_ID,
		Steps:   []RegistrationResult{},
	}

	steps := []struct {
		name string
		fn   func(context.Context) RegistrationResult
	}{
		{"register_participant", r.registerParticipant},
		{"set_net_debit_cap", r.setNetDebitCap},
		{"create_accounts", r.createSettlementAccounts},
		{"register_party_als", r.registerPartyInALS},
		{"register_endpoints", r.registerEndpoints},
		{"advertise_quote_capability", r.advertiseQuoteCapability},
		{"advertise_transfer_capability", r.advertiseTransferCapability},
	}

	allSuccess := true
	for _, step := range steps {
		result := step.fn(ctx)
		report.Steps = append(report.Steps, result)
		if result.Status == "failed" {
			allSuccess = false
			r.logger.Error("DFSP registration step failed",
				zap.String("step", step.name),
				zap.String("message", result.Message),
			)
		} else {
			r.logger.Info("DFSP registration step complete",
				zap.String("step", step.name),
				zap.String("status", result.Status),
			)
		}
	}

	report.Success = allSuccess
	return report, nil
}

// ─── Step Implementations ─────────────────────────────────────────────────────

// registerParticipant registers the DFSP with the Mojaloop Hub.
// POST /participants
func (r *Registrar) registerParticipant(ctx context.Context) RegistrationResult {
	step := "register_participant"
	body, _ := json.Marshal(map[string]interface{}{
		"name":     r.cfg.DFSP_ID,
		"currency": r.cfg.Currency,
	})
	resp, err := r.post(ctx, r.cfg.HubURL+"/participants", body)
	if err != nil {
		return RegistrationResult{Step: step, Status: "failed", Message: err.Error()}
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200, 201:
		return RegistrationResult{Step: step, Status: "created",
			Message: fmt.Sprintf("DFSP %s registered with currency %s", r.cfg.DFSP_ID, r.cfg.Currency)}
	case 400, 409:
		// Already exists — idempotent
		return RegistrationResult{Step: step, Status: "already_exists",
			Message: fmt.Sprintf("DFSP %s already registered", r.cfg.DFSP_ID)}
	default:
		respBody, _ := io.ReadAll(resp.Body)
		return RegistrationResult{Step: step, Status: "failed",
			Message: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))}
	}
}

// setNetDebitCap sets the net debit cap for the DFSP.
// POST /participants/{dfspId}/initialPositionAndLimits
func (r *Registrar) setNetDebitCap(ctx context.Context) RegistrationResult {
	step := "set_net_debit_cap"
	body, _ := json.Marshal(map[string]interface{}{
		"currency": r.cfg.Currency,
		"limit": map[string]interface{}{
			"type":  "NET_DEBIT_CAP",
			"value": r.cfg.NetDebitCapMinor,
		},
		"initialPosition": 0,
	})
	url := fmt.Sprintf("%s/participants/%s/initialPositionAndLimits", r.cfg.HubURL, r.cfg.DFSP_ID)
	resp, err := r.post(ctx, url, body)
	if err != nil {
		return RegistrationResult{Step: step, Status: "failed", Message: err.Error()}
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200, 201:
		return RegistrationResult{Step: step, Status: "created",
			Message: fmt.Sprintf("Net debit cap set to %d minor units (%s)", r.cfg.NetDebitCapMinor, r.cfg.Currency)}
	case 400, 409:
		return RegistrationResult{Step: step, Status: "already_exists",
			Message: "Net debit cap already set"}
	default:
		respBody, _ := io.ReadAll(resp.Body)
		return RegistrationResult{Step: step, Status: "failed",
			Message: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))}
	}
}

// createSettlementAccounts creates the DFSP's settlement and position accounts.
// POST /participants/{dfspId}/accounts
func (r *Registrar) createSettlementAccounts(ctx context.Context) RegistrationResult {
	step := "create_accounts"
	accounts := []map[string]interface{}{
		{"type": "SETTLEMENT", "currency": r.cfg.Currency},
		{"type": "POSITION", "currency": r.cfg.Currency},
	}
	created := 0
	var lastErr string
	for _, acct := range accounts {
		body, _ := json.Marshal(acct)
		url := fmt.Sprintf("%s/participants/%s/accounts", r.cfg.HubURL, r.cfg.DFSP_ID)
		resp, err := r.post(ctx, url, body)
		if err != nil {
			lastErr = err.Error()
			continue
		}
		resp.Body.Close()
		if resp.StatusCode == 200 || resp.StatusCode == 201 || resp.StatusCode == 409 {
			created++
		}
	}
	if created == len(accounts) {
		return RegistrationResult{Step: step, Status: "created",
			Message: fmt.Sprintf("Settlement and position accounts created for %s", r.cfg.Currency)}
	}
	if lastErr != "" {
		return RegistrationResult{Step: step, Status: "failed", Message: lastErr}
	}
	return RegistrationResult{Step: step, Status: "failed",
		Message: fmt.Sprintf("Only %d of %d accounts created", created, len(accounts))}
}

// registerPartyInALS registers the customs authority party in the Account Lookup Service.
// POST /participants/MSISDN/{msisdn}
func (r *Registrar) registerPartyInALS(ctx context.Context) RegistrationResult {
	step := "register_party_als"
	body, _ := json.Marshal(map[string]interface{}{
		"fspId":      r.cfg.DFSP_ID,
		"currency":   r.cfg.Currency,
		"partyIdType": "MSISDN",
		"partyIdentifier": r.cfg.CustomsPartyMSISDN,
	})
	url := fmt.Sprintf("%s/participants/MSISDN/%s", r.cfg.FSPIOP_URL, r.cfg.CustomsPartyMSISDN)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return RegistrationResult{Step: step, Status: "failed", Message: err.Error()}
	}
	r.setFSPIOPHeaders(req)
	resp, err := r.client.Do(req)
	if err != nil {
		return RegistrationResult{Step: step, Status: "failed", Message: err.Error()}
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200, 201, 202:
		return RegistrationResult{Step: step, Status: "created",
			Message: fmt.Sprintf("Party MSISDN/%s registered for DFSP %s", r.cfg.CustomsPartyMSISDN, r.cfg.DFSP_ID)}
	case 400, 409:
		return RegistrationResult{Step: step, Status: "already_exists",
			Message: "Party already registered in ALS"}
	default:
		respBody, _ := io.ReadAll(resp.Body)
		return RegistrationResult{Step: step, Status: "failed",
			Message: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))}
	}
}

// registerEndpoints registers the DFSP's FSPIOP callback URLs with the Hub.
// POST /participants/{dfspId}/endpoints
func (r *Registrar) registerEndpoints(ctx context.Context) RegistrationResult {
	step := "register_endpoints"
	endpoints := []map[string]interface{}{
		{
			"type":  "FSPIOP_CALLBACK_URL_PARTIES_GET",
			"value": r.cfg.CallbackBaseURL + "/fspiop/parties/{{partyIdType}}/{{partyIdentifier}}",
		},
		{
			"type":  "FSPIOP_CALLBACK_URL_PARTIES_PUT",
			"value": r.cfg.CallbackBaseURL + "/fspiop/parties/{{partyIdType}}/{{partyIdentifier}}",
		},
		{
			"type":  "FSPIOP_CALLBACK_URL_PARTIES_PUT_ERROR",
			"value": r.cfg.CallbackBaseURL + "/fspiop/parties/{{partyIdType}}/{{partyIdentifier}}/error",
		},
		{
			"type":  "FSPIOP_CALLBACK_URL_QUOTES",
			"value": r.cfg.CallbackBaseURL + "/fspiop/quotes",
		},
		{
			"type":  "FSPIOP_CALLBACK_URL_TRANSFER_POST",
			"value": r.cfg.CallbackBaseURL + "/fspiop/transfers",
		},
		{
			"type":  "FSPIOP_CALLBACK_URL_TRANSFER_PUT",
			"value": r.cfg.CallbackBaseURL + "/fspiop/transfers/{{transferId}}",
		},
		{
			"type":  "FSPIOP_CALLBACK_URL_TRANSFER_ERROR",
			"value": r.cfg.CallbackBaseURL + "/fspiop/transfers/{{transferId}}/error",
		},
	}

	registered := 0
	for _, ep := range endpoints {
		body, _ := json.Marshal(ep)
		url := fmt.Sprintf("%s/participants/%s/endpoints", r.cfg.HubURL, r.cfg.DFSP_ID)
		resp, err := r.post(ctx, url, body)
		if err != nil {
			continue
		}
		resp.Body.Close()
		if resp.StatusCode == 200 || resp.StatusCode == 201 || resp.StatusCode == 409 {
			registered++
		}
	}

	if registered == len(endpoints) {
		return RegistrationResult{Step: step, Status: "created",
			Message: fmt.Sprintf("Registered %d FSPIOP callback endpoints", registered)}
	}
	return RegistrationResult{Step: step, Status: "failed",
		Message: fmt.Sprintf("Only %d of %d endpoints registered", registered, len(endpoints))}
}

// advertiseQuoteCapability advertises the DFSP's quote capability.
func (r *Registrar) advertiseQuoteCapability(ctx context.Context) RegistrationResult {
	step := "advertise_quote_capability"
	body, _ := json.Marshal(map[string]interface{}{
		"type":  "FSPIOP_CALLBACK_URL_QUOTES",
		"value": r.cfg.CallbackBaseURL + "/fspiop/quotes",
	})
	url := fmt.Sprintf("%s/participants/%s/endpoints", r.cfg.HubURL, r.cfg.DFSP_ID)
	resp, err := r.post(ctx, url, body)
	if err != nil {
		return RegistrationResult{Step: step, Status: "failed", Message: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 || resp.StatusCode == 201 || resp.StatusCode == 409 {
		return RegistrationResult{Step: step, Status: "created",
			Message: "Quote capability advertised"}
	}
	respBody, _ := io.ReadAll(resp.Body)
	return RegistrationResult{Step: step, Status: "failed",
		Message: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))}
}

// advertiseTransferCapability advertises the DFSP's transfer capability.
func (r *Registrar) advertiseTransferCapability(ctx context.Context) RegistrationResult {
	step := "advertise_transfer_capability"
	body, _ := json.Marshal(map[string]interface{}{
		"type":  "FSPIOP_CALLBACK_URL_TRANSFER_POST",
		"value": r.cfg.CallbackBaseURL + "/fspiop/transfers",
	})
	url := fmt.Sprintf("%s/participants/%s/endpoints", r.cfg.HubURL, r.cfg.DFSP_ID)
	resp, err := r.post(ctx, url, body)
	if err != nil {
		return RegistrationResult{Step: step, Status: "failed", Message: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 || resp.StatusCode == 201 || resp.StatusCode == 409 {
		return RegistrationResult{Step: step, Status: "created",
			Message: "Transfer capability advertised"}
	}
	respBody, _ := io.ReadAll(resp.Body)
	return RegistrationResult{Step: step, Status: "failed",
		Message: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))}
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

// post sends a POST request with JSON content-type and optional JWS signature.
func (r *Registrar) post(ctx context.Context, url string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request failed: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("FSPIOP-Source", r.cfg.DFSP_ID)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	if r.signer != nil {
		if signErr := r.signer.SignRequest(req); signErr != nil {
			r.logger.Warn("JWS signing failed — sending unsigned request",
				zap.Error(signErr), zap.String("url", url))
		}
	}
	return r.client.Do(req)
}

// setFSPIOPHeaders sets standard FSPIOP headers and applies JWS signing.
func (r *Registrar) setFSPIOPHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/vnd.interoperability.participants+json;version=1.1")
	req.Header.Set("Accept", "application/vnd.interoperability.participants+json;version=1.1")
	req.Header.Set("FSPIOP-Source", r.cfg.DFSP_ID)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	if r.signer != nil {
		if signErr := r.signer.SignRequest(req); signErr != nil {
			r.logger.Warn("JWS signing failed for FSPIOP request",
				zap.Error(signErr), zap.String("url", req.URL.String()))
		}
	}
}
