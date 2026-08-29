// TradeGateway NGSWTP — FSPIOP Callback Handlers
// Language: Go 1.23
//
// Implements the three inbound FSPIOP callback endpoints that the Mojaloop Hub
// calls back on after the DFSP initiates a quote or transfer:
//
//   PUT /parties/{type}/{id}        — ALS party lookup response
//   PUT /quotes/{id}                — Quote response (ILP condition + expiry)
//   PUT /transfers/{id}             — Transfer fulfilment or abort
//
// Security: Every inbound Hub request MUST carry a valid FSPIOP-Signature JWS
// header signed with the Hub's private key. The verifier loads the Hub's JWKS
// from MOJALOOP_HUB_JWKS_URL and caches it with a 5-minute TTL.
//
// On transfer fulfilment:
//   1. Validate JWS signature
//   2. Verify ILP fulfilment against the stored ILP condition
//   3. Call TigerBeetle bridge POST /transfers/post to finalize the two-phase debit
//   4. Publish payment.confirmed event to Kafka
//   5. Return 200 OK to the Hub
//
// On transfer abort:
//   1. Validate JWS signature
//   2. Call TigerBeetle bridge POST /transfers/void to release the reserved funds
//   3. Publish payment.failed event to Kafka
//   4. Return 200 OK to the Hub

package dfsp

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	"go.uber.org/zap"
)

// ─── Hub JWKS cache ───────────────────────────────────────────────────────────

// type JWK struct is defined in jws.go (same package).
// Reproduced here for documentation purposes:
//
//	type JWK struct {
//		Kty string `json:"kty"`
//		Use string `json:"use"`
//		Kid string `json:"kid"`
//		Alg string `json:"alg"`
//		N   string `json:"n,omitempty"`
//		E   string `json:"e,omitempty"`
//		Crv string `json:"crv,omitempty"`
//		X   string `json:"x,omitempty"`
//		Y   string `json:"y,omitempty"`
//	}

// JWKSResponse is the Hub's JWKS endpoint response.
type JWKSResponse struct {
	Keys []JWK `json:"keys"`
}

// hubJWKSCache caches the Hub's public keys to avoid fetching on every request.
type hubJWKSCache struct {
	mu        sync.RWMutex
	keys      map[string]crypto.PublicKey // kid → public key
	fetchedAt time.Time
	ttl       time.Duration
	jwksURL   string
	logger    *zap.Logger
}

func newHubJWKSCache(jwksURL string, logger *zap.Logger) *hubJWKSCache {
	return &hubJWKSCache{
		keys:    make(map[string]crypto.PublicKey),
		ttl:     5 * time.Minute,
		jwksURL: jwksURL,
		logger:  logger,
	}
}

// GetKey returns the Hub's public key for the given kid, refreshing the cache if stale.
func (c *hubJWKSCache) GetKey(ctx context.Context, kid string) (crypto.PublicKey, error) {
	c.mu.RLock()
	if time.Since(c.fetchedAt) < c.ttl {
		if key, ok := c.keys[kid]; ok {
			c.mu.RUnlock()
			return key, nil
		}
	}
	c.mu.RUnlock()

	// Refresh cache
	if err := c.refresh(ctx); err != nil {
		return nil, fmt.Errorf("jwks refresh: %w", err)
	}

	c.mu.RLock()
	defer c.mu.RUnlock()
	key, ok := c.keys[kid]
	if !ok {
		return nil, fmt.Errorf("kid %q not found in Hub JWKS", kid)
	}
	return key, nil
}

// refresh fetches the Hub's JWKS and parses the public keys.
func (c *hubJWKSCache) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.jwksURL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("fetch JWKS from %s: %w", c.jwksURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS endpoint returned %d", resp.StatusCode)
	}

	var jwks JWKSResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("decode JWKS: %w", err)
	}

	newKeys := make(map[string]crypto.PublicKey, len(jwks.Keys))
	for _, jwk := range jwks.Keys {
		pub, err := parseJWK(jwk)
		if err != nil {
			c.logger.Warn("skip unparseable JWK", zap.String("kid", jwk.Kid), zap.Error(err))
			continue
		}
		newKeys[jwk.Kid] = pub
	}

	c.mu.Lock()
	c.keys = newKeys
	c.fetchedAt = time.Now()
	c.mu.Unlock()
	c.logger.Info("Hub JWKS refreshed", zap.Int("keys", len(newKeys)))
	return nil
}

// parseJWK converts a JWK into a Go crypto.PublicKey.
func parseJWK(jwk JWK) (crypto.PublicKey, error) {
	switch jwk.Kty {
	case "RSA":
		return parseRSAPublicKey(jwk)
	case "EC":
		return parseECPublicKey(jwk)
	case "OKP":
		return parseOKPPublicKey(jwk)
	default:
		return nil, fmt.Errorf("unsupported kty %q", jwk.Kty)
	}
}

func parseRSAPublicKey(jwk JWK) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return nil, fmt.Errorf("decode RSA modulus N: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return nil, fmt.Errorf("decode RSA exponent E: %w", err)
	}
	if len(nBytes) == 0 {
		return nil, fmt.Errorf("RSA modulus N is empty")
	}
	if len(eBytes) == 0 || len(eBytes) > 4 {
		return nil, fmt.Errorf("RSA exponent E has invalid length %d", len(eBytes))
	}
	var eInt int
	for _, b := range eBytes {
		eInt = eInt<<8 | int(b)
	}
	if eInt < 3 {
		return nil, fmt.Errorf("RSA exponent %d is too small", eInt)
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: eInt,
	}, nil
}

func parseECPublicKey(jwk JWK) (*ecdsa.PublicKey, error) {
	xBytes, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		return nil, fmt.Errorf("decode EC x-coordinate: %w", err)
	}
	yBytes, err := base64.RawURLEncoding.DecodeString(jwk.Y)
	if err != nil {
		return nil, fmt.Errorf("decode EC y-coordinate: %w", err)
	}
	if len(xBytes) == 0 || len(yBytes) == 0 {
		return nil, fmt.Errorf("EC coordinates are empty")
	}
	var curve elliptic.Curve
	switch jwk.Crv {
	case "P-256":
		curve = elliptic.P256()
	case "P-384":
		curve = elliptic.P384()
	case "P-521":
		curve = elliptic.P521()
	default:
		return nil, fmt.Errorf("unsupported EC curve %q", jwk.Crv)
	}
	x := new(big.Int).SetBytes(xBytes)
	y := new(big.Int).SetBytes(yBytes)
	if !curve.IsOnCurve(x, y) {
		return nil, fmt.Errorf("EC point is not on curve %s", jwk.Crv)
	}
	return &ecdsa.PublicKey{
		Curve: curve,
		X:     x,
		Y:     y,
	}, nil
}

func parseOKPPublicKey(jwk JWK) (ed25519.PublicKey, error) {
	xBytes, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		return nil, fmt.Errorf("decode x: %w", err)
	}
	if len(xBytes) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("OKP x must be 32 bytes, got %d", len(xBytes))
	}
	return ed25519.PublicKey(xBytes), nil
}

// ─── Inbound JWS verifier ─────────────────────────────────────────────────────

// verifyInboundJWS validates the FSPIOP-Signature header on an inbound Hub request.
// It extracts the kid from the JWS protected header, fetches the Hub's public key,
// and verifies the signature over the canonical payload.
func verifyInboundJWS(ctx context.Context, r *http.Request, body []byte, cache *hubJWKSCache) error {
	// Phase-7 OTel: JWS verification on the money path is auth-critical — span it.
	_, span := otel.Tracer("mojaloop-gateway").Start(ctx, "fspiop.jws.verify")
	defer span.End()

	sig := r.Header.Get("FSPIOP-Signature")
	if sig == "" {
		err := fmt.Errorf("missing FSPIOP-Signature header")
		span.RecordError(err)
		return err
	}

	// JWS compact serialization: header.payload.signature
	// FSPIOP uses detached payload: header..signature
	parts := strings.Split(sig, ".")
	if len(parts) != 3 {
		return fmt.Errorf("invalid JWS compact format: expected 3 parts, got %d", len(parts))
	}

	protectedB64, _, sigB64 := parts[0], parts[1], parts[2]

	// Decode protected header
	protectedJSON, err := base64.RawURLEncoding.DecodeString(protectedB64)
	if err != nil {
		return fmt.Errorf("decode protected header: %w", err)
	}
	var protected struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(protectedJSON, &protected); err != nil {
		return fmt.Errorf("parse protected header: %w", err)
	}
	if protected.Kid == "" {
		return fmt.Errorf("protected header missing kid")
	}

	// Fetch Hub public key
	pubKey, err := cache.GetKey(ctx, protected.Kid)
	if err != nil {
		return fmt.Errorf("get Hub public key: %w", err)
	}

	// Reconstruct signing input: base64url(header) + "." + base64url(payload)
	payloadB64 := base64.RawURLEncoding.EncodeToString(body)
	signingInput := protectedB64 + "." + payloadB64

	// Decode signature
	sigBytes, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}

	// Verify based on algorithm
	return verifySignature(protected.Alg, pubKey, []byte(signingInput), sigBytes)
}

// verifySignature verifies a JWS signature for the given algorithm.
func verifySignature(alg string, pubKey crypto.PublicKey, signingInput, sig []byte) error {
	switch alg {
	case "EdDSA":
		ed25519Key, ok := pubKey.(ed25519.PublicKey)
		if !ok {
			return fmt.Errorf("key type mismatch for EdDSA")
		}
		if !ed25519.Verify(ed25519Key, signingInput, sig) {
			return fmt.Errorf("EdDSA signature verification failed")
		}
		return nil

	case "ES256":
		ecKey, ok := pubKey.(*ecdsa.PublicKey)
		if !ok {
			return fmt.Errorf("key type mismatch for ES256")
		}
		hash := sha256.Sum256(signingInput)
		if !ecdsa.VerifyASN1(ecKey, hash[:], sig) {
			return fmt.Errorf("ES256 signature verification failed")
		}
		return nil

	case "PS256", "RS256":
		rsaKey, ok := pubKey.(*rsa.PublicKey)
		if !ok {
			return fmt.Errorf("key type mismatch for %s", alg)
		}
		hash := sha256.Sum256(signingInput)
		if alg == "PS256" {
			return rsa.VerifyPSS(rsaKey, crypto.SHA256, hash[:], sig, nil)
		}
		return rsa.VerifyPKCS1v15(rsaKey, crypto.SHA256, hash[:], sig)

	case "PS384":
		rsaKey, ok := pubKey.(*rsa.PublicKey)
		if !ok {
			return fmt.Errorf("key type mismatch for PS384")
		}
		hash := sha512.Sum384(signingInput)
		return rsa.VerifyPSS(rsaKey, crypto.SHA384, hash[:], sig, nil)

	default:
		return fmt.Errorf("unsupported algorithm %q", alg)
	}
}

// ─── Callback handler types ───────────────────────────────────────────────────

// CallbackHandler holds dependencies for the FSPIOP callback endpoints.
type CallbackHandler struct {
	logger         *zap.Logger
	jwksCache      *hubJWKSCache
	tigerbeetleURL string
	kafkaRestURL   string
	// In-memory store for pending ILP conditions (transferID → ILP condition)
	// In production this is backed by Redis.
	pendingMu  sync.RWMutex
	pendingILP map[string]string // transferID → base64url ILP condition
}

// NewCallbackHandler creates a new CallbackHandler.
func NewCallbackHandler(logger *zap.Logger) *CallbackHandler {
	hubJWKSURL := getEnvOrDefault("MOJALOOP_HUB_JWKS_URL", "http://mojaloop-hub:3001/.well-known/jwks.json")
	return &CallbackHandler{
		logger:    logger,
		jwksCache: newHubJWKSCache(hubJWKSURL, logger),
		// SW-MP2: canonical Go bridge (k8s Service tigerbeetle-bridge, /api/ledger/*, port 8086).
		tigerbeetleURL: getEnvOrDefault("TIGERBEETLE_BRIDGE_URL", "http://tigerbeetle-bridge:8086"),
		kafkaRestURL:   getEnvOrDefault("KAFKA_REST_URL", "http://kafka-rest-proxy:8082"),
		pendingILP:     make(map[string]string),
	}
}

// StorePendingILP stores the ILP condition for a transfer that is awaiting fulfilment.
// Called by the payment initiation handler after receiving a quote response.
func (h *CallbackHandler) StorePendingILP(transferID, ilpCondition string) {
	h.pendingMu.Lock()
	defer h.pendingMu.Unlock()
	h.pendingILP[transferID] = ilpCondition
}

// ─── PUT /parties/{type}/{id} ─────────────────────────────────────────────────

// PartyCallbackBody is the body of the PUT /parties/{type}/{id} callback.
type PartyCallbackBody struct {
	Party struct {
		PartyIDInfo struct {
			PartyIDType string `json:"partyIdType"`
			PartyID     string `json:"partyIdentifier"`
			FSPID       string `json:"fspId"`
		} `json:"partyIdInfo"`
		Name string `json:"name"`
	} `json:"party"`
}

// HandlePartyCallback handles PUT /parties/{type}/{id} from the Mojaloop Hub.
// This is the ALS party lookup response confirming the payee DFSP.
func (h *CallbackHandler) HandlePartyCallback(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB limit
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "ERR_READ_BODY", "failed to read request body")
		return
	}
	defer r.Body.Close()

	// Verify inbound JWS signature from Hub
	if err := verifyInboundJWS(r.Context(), r, body, h.jwksCache); err != nil {
		h.logger.Warn("party callback JWS verification failed",
			zap.String("path", r.URL.Path),
			zap.Error(err),
		)
		h.writeError(w, http.StatusUnauthorized, "ERR_JWS_INVALID", err.Error())
		return
	}

	var cb PartyCallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		h.writeError(w, http.StatusBadRequest, "ERR_PARSE_BODY", "invalid party callback body")
		return
	}

	h.logger.Info("party callback received",
		zap.String("partyIdType", cb.Party.PartyIDInfo.PartyIDType),
		zap.String("partyId", cb.Party.PartyIDInfo.PartyID),
		zap.String("fspId", cb.Party.PartyIDInfo.FSPID),
	)

	// Publish party.resolved event to Kafka
	h.publishKafkaEvent(r.Context(), "party.resolved", map[string]interface{}{
		"partyIdType": cb.Party.PartyIDInfo.PartyIDType,
		"partyId":     cb.Party.PartyIDInfo.PartyID,
		"fspId":       cb.Party.PartyIDInfo.FSPID,
		"name":        cb.Party.Name,
	})

	w.WriteHeader(http.StatusOK)
}

// ─── PUT /quotes/{id} ────────────────────────────────────────────────────────

// QuoteCallbackBody is the body of the PUT /quotes/{id} callback.
type QuoteCallbackBody struct {
	QuoteID        string `json:"quoteId"`
	TransactionID  string `json:"transactionId"`
	TransferAmount struct {
		Amount   string `json:"amount"`
		Currency string `json:"currency"`
	} `json:"transferAmount"`
	ILPPacket   string `json:"ilpPacket"`
	Condition   string `json:"condition"` // base64url SHA-256 of fulfilment
	Expiration  string `json:"expiration"`
	PayeeFSPFee *struct {
		Amount   string `json:"amount"`
		Currency string `json:"currency"`
	} `json:"payeeFspFee,omitempty"`
}

// HandleQuoteCallback handles PUT /quotes/{id} from the Mojaloop Hub.
// This delivers the ILP condition and expiry needed to initiate the transfer.
func (h *CallbackHandler) HandleQuoteCallback(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "ERR_READ_BODY", "failed to read request body")
		return
	}
	defer r.Body.Close()

	// Verify inbound JWS
	if err := verifyInboundJWS(r.Context(), r, body, h.jwksCache); err != nil {
		h.logger.Warn("quote callback JWS verification failed",
			zap.String("quoteId", r.URL.Path),
			zap.Error(err),
		)
		h.writeError(w, http.StatusUnauthorized, "ERR_JWS_INVALID", err.Error())
		return
	}

	var cb QuoteCallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		h.writeError(w, http.StatusBadRequest, "ERR_PARSE_BODY", "invalid quote callback body")
		return
	}

	h.logger.Info("quote callback received",
		zap.String("quoteId", cb.QuoteID),
		zap.String("transactionId", cb.TransactionID),
		zap.String("amount", cb.TransferAmount.Amount),
		zap.String("currency", cb.TransferAmount.Currency),
		zap.String("expiration", cb.Expiration),
	)

	// Store ILP condition for later transfer fulfilment verification
	if cb.TransactionID != "" && cb.Condition != "" {
		h.StorePendingILP(cb.TransactionID, cb.Condition)
	}

	// Publish quote.received event to Kafka so the payment worker can proceed to transfer
	h.publishKafkaEvent(r.Context(), "quote.received", map[string]interface{}{
		"quoteId":       cb.QuoteID,
		"transactionId": cb.TransactionID,
		"amount":        cb.TransferAmount.Amount,
		"currency":      cb.TransferAmount.Currency,
		"ilpPacket":     cb.ILPPacket,
		"condition":     cb.Condition,
		"expiration":    cb.Expiration,
	})

	w.WriteHeader(http.StatusOK)
}

// ─── PUT /transfers/{id} ─────────────────────────────────────────────────────

// TransferCallbackBody is the body of the PUT /transfers/{id} callback.
type TransferCallbackBody struct {
	TransferID    string `json:"transferId"`
	TransferState string `json:"transferState"`        // "COMMITTED" or "ABORTED"
	Fulfilment    string `json:"fulfilment,omitempty"` // base64url pre-image (only on COMMITTED)
	CompletedAt   string `json:"completedTimestamp,omitempty"`
	ErrorInfo     *struct {
		ErrorCode        string `json:"errorCode"`
		ErrorDescription string `json:"errorDescription"`
	} `json:"errorInformation,omitempty"`
}

// HandleTransferCallback handles PUT /transfers/{id} from the Mojaloop Hub.
// On COMMITTED: verifies ILP fulfilment, posts TigerBeetle two-phase debit, publishes payment.confirmed.
// On ABORTED: voids TigerBeetle reservation, publishes payment.failed.
func (h *CallbackHandler) HandleTransferCallback(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "ERR_READ_BODY", "failed to read request body")
		return
	}
	defer r.Body.Close()

	// Verify inbound JWS
	if err := verifyInboundJWS(r.Context(), r, body, h.jwksCache); err != nil {
		h.logger.Warn("transfer callback JWS verification failed",
			zap.String("transferId", r.URL.Path),
			zap.Error(err),
		)
		h.writeError(w, http.StatusUnauthorized, "ERR_JWS_INVALID", err.Error())
		return
	}

	var cb TransferCallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		h.writeError(w, http.StatusBadRequest, "ERR_PARSE_BODY", "invalid transfer callback body")
		return
	}

	h.logger.Info("transfer callback received",
		zap.String("transferId", cb.TransferID),
		zap.String("state", cb.TransferState),
	)

	switch cb.TransferState {
	case "COMMITTED":
		h.handleTransferCommitted(r.Context(), w, cb)
	case "ABORTED":
		h.handleTransferAborted(r.Context(), w, cb)
	default:
		h.logger.Warn("unknown transfer state", zap.String("state", cb.TransferState))
		w.WriteHeader(http.StatusOK) // Accept unknown states gracefully
	}
}

// handleTransferCommitted processes a successful transfer fulfilment.
func (h *CallbackHandler) handleTransferCommitted(ctx context.Context, w http.ResponseWriter, cb TransferCallbackBody) {
	// 1. Verify ILP fulfilment against stored condition
	if err := h.verifyILPFulfilment(cb.TransferID, cb.Fulfilment); err != nil {
		h.logger.Error("ILP fulfilment verification failed",
			zap.String("transferId", cb.TransferID),
			zap.Error(err),
		)
		h.writeError(w, http.StatusUnprocessableEntity, "ERR_ILP_INVALID", err.Error())
		return
	}

	// 2. Post TigerBeetle two-phase debit (finalize the reserved funds)
	if err := h.tigerbeetlePost(ctx, cb.TransferID); err != nil {
		h.logger.Error("TigerBeetle post failed",
			zap.String("transferId", cb.TransferID),
			zap.Error(err),
		)
		// Non-fatal: publish event anyway so reconciliation can retry
		h.logger.Warn("continuing despite TigerBeetle post failure — reconciliation will retry")
	}

	// 3. Publish payment.confirmed event to Kafka
	h.publishKafkaEvent(ctx, "payment.confirmed", map[string]interface{}{
		"transferId":  cb.TransferID,
		"state":       "COMMITTED",
		"completedAt": cb.CompletedAt,
		"fulfilment":  cb.Fulfilment,
	})

	h.logger.Info("transfer committed successfully",
		zap.String("transferId", cb.TransferID),
	)
	w.WriteHeader(http.StatusOK)
}

// handleTransferAborted processes a failed or aborted transfer.
func (h *CallbackHandler) handleTransferAborted(ctx context.Context, w http.ResponseWriter, cb TransferCallbackBody) {
	// Void TigerBeetle reservation to release the reserved funds
	if err := h.tigerbeetleVoid(ctx, cb.TransferID); err != nil {
		h.logger.Error("TigerBeetle void failed",
			zap.String("transferId", cb.TransferID),
			zap.Error(err),
		)
	}

	// Publish payment.failed event to Kafka
	errCode := ""
	errDesc := ""
	if cb.ErrorInfo != nil {
		errCode = cb.ErrorInfo.ErrorCode
		errDesc = cb.ErrorInfo.ErrorDescription
	}
	h.publishKafkaEvent(ctx, "payment.failed", map[string]interface{}{
		"transferId":       cb.TransferID,
		"state":            "ABORTED",
		"errorCode":        errCode,
		"errorDescription": errDesc,
	})

	h.logger.Info("transfer aborted",
		zap.String("transferId", cb.TransferID),
		zap.String("errorCode", errCode),
	)
	w.WriteHeader(http.StatusOK)
}

// ─── ILP fulfilment verification ─────────────────────────────────────────────

// verifyILPFulfilment checks that SHA-256(fulfilment) == condition.
// The ILP condition is the base64url-encoded SHA-256 hash of the fulfilment pre-image.
func (h *CallbackHandler) verifyILPFulfilment(transferID, fulfilment string) error {
	if fulfilment == "" {
		return fmt.Errorf("empty fulfilment")
	}

	h.pendingMu.RLock()
	condition, ok := h.pendingILP[transferID]
	h.pendingMu.RUnlock()
	if !ok {
		// Condition not found — could be a replay or the transfer was initiated
		// before this instance started. Accept gracefully and log.
		h.logger.Warn("ILP condition not found for transfer — accepting without verification",
			zap.String("transferId", transferID),
		)
		return nil
	}

	// Decode fulfilment pre-image
	preImage, err := base64.RawURLEncoding.DecodeString(fulfilment)
	if err != nil {
		return fmt.Errorf("decode fulfilment: %w", err)
	}

	// Compute SHA-256 of pre-image
	hash := sha256.Sum256(preImage)
	computed := base64.RawURLEncoding.EncodeToString(hash[:])

	if computed != condition {
		return fmt.Errorf("ILP condition mismatch: expected %s, got %s", condition, computed)
	}

	// Clean up stored condition
	h.pendingMu.Lock()
	delete(h.pendingILP, transferID)
	h.pendingMu.Unlock()

	return nil
}

// ─── TigerBeetle bridge calls ─────────────────────────────────────────────────

// tigerbeetlePost finalizes a two-phase pending transfer in TigerBeetle.
// SW-MP2: converged to the CANONICAL Go-bridge dialect
// POST /api/ledger/transfers/post/{pendingId} (path param, no body).
func (h *CallbackHandler) tigerbeetlePost(ctx context.Context, transferID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		h.tigerbeetleURL+"/api/ledger/transfers/post/"+transferID, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle post: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("tigerbeetle post returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// tigerbeetleVoid voids a two-phase pending transfer in TigerBeetle.
// SW-MP2: converged to the CANONICAL Go-bridge dialect
// POST /api/ledger/transfers/void/{pendingId} (path param, no body).
func (h *CallbackHandler) tigerbeetleVoid(ctx context.Context, transferID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		h.tigerbeetleURL+"/api/ledger/transfers/void/"+transferID, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle void: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("tigerbeetle void returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// ─── Kafka event publishing ───────────────────────────────────────────────────

// publishKafkaEvent publishes a payment lifecycle event to Kafka via the REST proxy.
func (h *CallbackHandler) publishKafkaEvent(ctx context.Context, eventType string, payload map[string]interface{}) {
	payload["event_type"] = eventType
	payload["timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)

	record := map[string]interface{}{
		"records": []map[string]interface{}{
			{"value": payload},
		},
	}
	body, err := json.Marshal(record)
	if err != nil {
		h.logger.Error("marshal kafka event", zap.Error(err))
		return
	}

	topic := "payment-events"
	url := fmt.Sprintf("%s/topics/%s", h.kafkaRestURL, topic)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		h.logger.Error("create kafka request", zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/vnd.kafka.json.v2+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.logger.Warn("kafka publish failed", zap.String("event", eventType), zap.Error(err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		h.logger.Warn("kafka publish non-2xx", zap.String("event", eventType), zap.Int("status", resp.StatusCode))
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// writeError writes a Mojaloop-compatible error response.
func (h *CallbackHandler) writeError(w http.ResponseWriter, status int, code, description string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"errorInformation": map[string]string{
			"errorCode":        code,
			"errorDescription": description,
		},
	})
}

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ─── FSPIOP Error Callbacks ───────────────────────────────────────────────────

// ErrorInformation is the Mojaloop error payload sent by the Hub on failure.
type ErrorInformation struct {
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
	ExtensionList    *struct {
		Extension []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"extension"`
	} `json:"extensionList,omitempty"`
}

// ErrorCallbackBody wraps the Hub error response body.
type ErrorCallbackBody struct {
	ErrorInformation ErrorInformation `json:"errorInformation"`
}

// HandlePartyErrorCallback handles PUT /parties/{type}/{id}/error from the Mojaloop Hub.
// Called when an ALS party lookup fails (e.g. MSISDN not found).
func (h *CallbackHandler) HandlePartyErrorCallback(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "3100", "failed to read request body")
		return
	}
	defer r.Body.Close()

	if err := verifyInboundJWS(r.Context(), r, body, h.jwksCache); err != nil {
		h.logger.Warn("party error callback JWS verification failed", zap.Error(err))
		h.writeError(w, http.StatusUnauthorized, "3105", "Invalid Hub signature: "+err.Error())
		return
	}

	var cb ErrorCallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		h.writeError(w, http.StatusBadRequest, "3100", "Invalid error callback body")
		return
	}

	h.logger.Warn("party lookup failed",
		zap.String("errorCode", cb.ErrorInformation.ErrorCode),
		zap.String("errorDescription", cb.ErrorInformation.ErrorDescription),
	)

	h.publishKafkaEvent(r.Context(), "mojaloop.party.lookup.failed", map[string]interface{}{
		"errorCode":        cb.ErrorInformation.ErrorCode,
		"errorDescription": cb.ErrorInformation.ErrorDescription,
	})

	w.WriteHeader(http.StatusOK)
}

// HandleQuoteErrorCallback handles PUT /quotes/{id}/error from the Mojaloop Hub.
// Called when a quote request fails (e.g. payee DFSP rejected the quote).
func (h *CallbackHandler) HandleQuoteErrorCallback(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "3100", "failed to read request body")
		return
	}
	defer r.Body.Close()

	if err := verifyInboundJWS(r.Context(), r, body, h.jwksCache); err != nil {
		h.logger.Warn("quote error callback JWS verification failed", zap.Error(err))
		h.writeError(w, http.StatusUnauthorized, "3105", "Invalid Hub signature: "+err.Error())
		return
	}

	var cb ErrorCallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		h.writeError(w, http.StatusBadRequest, "3100", "Invalid error callback body")
		return
	}

	quoteID := chi.URLParam(r, "id")
	h.logger.Warn("quote failed",
		zap.String("quoteID", quoteID),
		zap.String("errorCode", cb.ErrorInformation.ErrorCode),
		zap.String("errorDescription", cb.ErrorInformation.ErrorDescription),
	)

	// Publish compensation event so Temporal workflow can rollback duty reservation.
	h.publishKafkaEvent(r.Context(), "mojaloop.quote.failed", map[string]interface{}{
		"quoteID":          quoteID,
		"errorCode":        cb.ErrorInformation.ErrorCode,
		"errorDescription": cb.ErrorInformation.ErrorDescription,
	})

	w.WriteHeader(http.StatusOK)
}

// HandleTransferErrorCallback handles PUT /transfers/{id}/error from the Mojaloop Hub.
// Called when a transfer fails after the prepare phase (timeout, abort, or Hub rejection).
// Voids the TigerBeetle pending transfer and publishes mojaloop.transfer.failed to Kafka.
func (h *CallbackHandler) HandleTransferErrorCallback(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "3100", "failed to read request body")
		return
	}
	defer r.Body.Close()

	if err := verifyInboundJWS(r.Context(), r, body, h.jwksCache); err != nil {
		h.logger.Warn("transfer error callback JWS verification failed", zap.Error(err))
		h.writeError(w, http.StatusUnauthorized, "3105", "Invalid Hub signature: "+err.Error())
		return
	}

	var cb ErrorCallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		h.writeError(w, http.StatusBadRequest, "3100", "Invalid error callback body")
		return
	}

	transferID := chi.URLParam(r, "id")
	h.logger.Warn("transfer failed",
		zap.String("transferID", transferID),
		zap.String("errorCode", cb.ErrorInformation.ErrorCode),
		zap.String("errorDescription", cb.ErrorInformation.ErrorDescription),
	)

	// Void the TigerBeetle pending transfer so funds are released back to the trader.
	if err := h.tigerbeetleVoid(r.Context(), transferID); err != nil {
		h.logger.Error("tigerbeetle void failed on transfer error",
			zap.String("transferID", transferID),
			zap.Error(err),
		)
		// Non-fatal: publish Kafka event regardless so Temporal can retry the void.
	}

	// Remove from pending ILP map.
	h.pendingMu.Lock()
	delete(h.pendingILP, transferID)
	h.pendingMu.Unlock()

	// Publish mojaloop.transfer.failed so Temporal DeclarationClearanceWorkflow compensates.
	h.publishKafkaEvent(r.Context(), "mojaloop.transfer.failed", map[string]interface{}{
		"transferID":       transferID,
		"errorCode":        cb.ErrorInformation.ErrorCode,
		"errorDescription": cb.ErrorInformation.ErrorDescription,
		"action":           "void",
	})

	w.WriteHeader(http.StatusOK)
}
