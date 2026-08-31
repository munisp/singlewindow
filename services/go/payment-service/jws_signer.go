// jws_signer.go — FSPIOP JWS signing/verification for payment-service (P0-8).
//
// PLATFORM CONVENTION (single, documented): all Mojaloop switch-facing HTTP
// traffic carries a FSPIOP-Signature header containing a compact JWS signed
// with the DFSP's Ed25519 private key. This mirrors the verified dialect in
// mojaloop-gateway/internal/dfsp/jws.go:
//
//	FSPIOP-Signature = {"signature": b64url(sig), "protectedHeader": b64url(ph)}
//	protectedHeader  = {"alg":"EdDSA","kid":..., "FSPIOP-URI":...,
//	                    "FSPIOP-HTTP-Method":..., "FSPIOP-Source":...,
//	                    "FSPIOP-Destination":..., "Date":...}
//	signing input    = b64url(protectedHeader) + "." + b64url(body)  (body binding)
//
// FAIL-CLOSED: if no Ed25519 key is configured (DFSP_JWS_PRIVATE_KEY_PATH or
// DFSP_JWS_PRIVATE_KEY_PEM), outbound /transfers are NOT sent — an unsigned
// money-movement call is never made. Inbound callbacks are verified with the
// hub's Ed25519 public key (MOJALOOP_HUB_PUBLIC_KEY_PATH) when configured;
// the legacy HMAC path (MOJALOOP_CALLBACK_SECRET, env-only, no default) is
// retained for interop but unsigned callbacks are ALWAYS rejected.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// fspiopProtectedHeader is the JWS protected header for FSPIOP requests.
type fspiopProtectedHeader struct {
	Alg              string `json:"alg"`
	Kid              string `json:"kid"`
	FSPIOPURI        string `json:"FSPIOP-URI"`
	FSPIOPHTTPMethod string `json:"FSPIOP-HTTP-Method"`
	FSPIOPSource     string `json:"FSPIOP-Source"`
	FSPIOPDest       string `json:"FSPIOP-Destination,omitempty"`
	Date             string `json:"Date"`
}

// fspiopSignature is the JSON object placed in the FSPIOP-Signature header.
type fspiopSignature struct {
	Signature       string `json:"signature"`
	ProtectedHeader string `json:"protectedHeader"`
}

// FSPIOPSigner signs outbound FSPIOP requests with an Ed25519 key.
type FSPIOPSigner struct {
	key    ed25519.PrivateKey
	dfspID string
	keyID  string
}

var (
	signerOnce sync.Once
	signerInst *FSPIOPSigner
	signerErr  error
)

// fspiopSigner returns the process-wide signer, initialised from env on first
// use. Returns an error when no key is configured — callers must fail closed.
func fspiopSigner() (*FSPIOPSigner, error) {
	signerOnce.Do(func() {
		signerInst, signerErr = newFSPIOPSignerFromEnv()
		if signerErr != nil {
			log.Printf("[Payment Service] FSPIOP JWS signer unavailable: %v — outbound /transfers will be REFUSED (fail-closed)", signerErr)
		} else {
			log.Printf("[Payment Service] FSPIOP JWS signer ready (dfsp=%s kid=%s alg=EdDSA)", signerInst.dfspID, signerInst.keyID)
		}
	})
	return signerInst, signerErr
}

func newFSPIOPSignerFromEnv() (*FSPIOPSigner, error) {
	var pemBytes []byte
	if path := os.Getenv("DFSP_JWS_PRIVATE_KEY_PATH"); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read DFSP_JWS_PRIVATE_KEY_PATH: %w", err)
		}
		pemBytes = b
	} else if pemEnv := os.Getenv("DFSP_JWS_PRIVATE_KEY_PEM"); pemEnv != "" {
		pemBytes = []byte(pemEnv)
	} else {
		return nil, errors.New("no DFSP JWS key configured (set DFSP_JWS_PRIVATE_KEY_PATH or DFSP_JWS_PRIVATE_KEY_PEM)")
	}
	return newFSPIOPSignerFromPEM(pemBytes)
}

func newFSPIOPSignerFromPEM(pemBytes []byte) (*FSPIOPSigner, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("jws: failed to decode PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("jws: parse PKCS8 key: %w", err)
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("jws: platform convention is Ed25519 (EdDSA); got %T", parsed)
	}
	dfspID := getEnv("DFSP_ID", "gh-customs-payer-dfsp")
	return &FSPIOPSigner{key: key, dfspID: dfspID, keyID: dfspID + "-v1"}, nil
}

// SignRequest signs an outbound FSPIOP request (sets Date + FSPIOP-Signature).
func (s *FSPIOPSigner) SignRequest(req *http.Request, destination string, body []byte) error {
	if req.Header.Get("Date") == "" {
		req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	}
	protected := fspiopProtectedHeader{
		Alg:              "EdDSA",
		Kid:              s.keyID,
		FSPIOPURI:        req.URL.RequestURI(),
		FSPIOPHTTPMethod: req.Method,
		FSPIOPSource:     s.dfspID,
		FSPIOPDest:       destination,
		Date:             req.Header.Get("Date"),
	}
	protectedJSON, err := json.Marshal(protected)
	if err != nil {
		return fmt.Errorf("jws: marshal protected header: %w", err)
	}
	protectedB64 := base64.RawURLEncoding.EncodeToString(protectedJSON)

	bodyB64 := ""
	if len(body) > 0 {
		bodyB64 = base64.RawURLEncoding.EncodeToString(body)
	}
	sig := ed25519.Sign(s.key, []byte(protectedB64+"."+bodyB64))

	envelope, err := json.Marshal(fspiopSignature{
		Signature:       base64.RawURLEncoding.EncodeToString(sig),
		ProtectedHeader: protectedB64,
	})
	if err != nil {
		return fmt.Errorf("jws: marshal signature envelope: %w", err)
	}
	req.Header.Set("FSPIOP-Signature", string(envelope))
	return nil
}

// ─── Inbound verification ─────────────────────────────────────────────────────

var (
	hubKeyOnce sync.Once
	hubPubKey  ed25519.PublicKey
)

// hubPublicKey loads the hub's Ed25519 public key (MOJALOOP_HUB_PUBLIC_KEY_PATH
// or MOJALOOP_HUB_PUBLIC_KEY_PEM). Returns nil when not configured — in that
// case the legacy HMAC callback path is used (secret still env-required).
func hubPublicKey() ed25519.PublicKey {
	hubKeyOnce.Do(func() {
		var pemBytes []byte
		if path := os.Getenv("MOJALOOP_HUB_PUBLIC_KEY_PATH"); path != "" {
			b, err := os.ReadFile(path)
			if err != nil {
				log.Printf("[Payment Service] cannot read MOJALOOP_HUB_PUBLIC_KEY_PATH: %v", err)
				return
			}
			pemBytes = b
		} else if pemEnv := os.Getenv("MOJALOOP_HUB_PUBLIC_KEY_PEM"); pemEnv != "" {
			pemBytes = []byte(pemEnv)
		} else {
			return
		}
		block, _ := pem.Decode(pemBytes)
		if block == nil {
			log.Printf("[Payment Service] MOJALOOP hub public key: invalid PEM")
			return
		}
		parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			log.Printf("[Payment Service] MOJALOOP hub public key: %v", err)
			return
		}
		key, ok := parsed.(ed25519.PublicKey)
		if !ok {
			log.Printf("[Payment Service] MOJALOOP hub public key is not Ed25519 (%T) — ignored", parsed)
			return
		}
		hubPubKey = key
		log.Printf("[Payment Service] inbound FSPIOP JWS verification ENABLED (Ed25519 hub key)")
	})
	return hubPubKey
}

// verifyFSPIOPSignature validates the FSPIOP-Signature header on an inbound
// request against the hub's Ed25519 public key (body-bound, same dialect as
// outbound). Any failure is an error — callers reject the request.
func verifyFSPIOPSignature(pub ed25519.PublicKey, method, requestURI string, body []byte, header string) error {
	if header == "" {
		return errors.New("missing FSPIOP-Signature header")
	}
	var env fspiopSignature
	if err := json.Unmarshal([]byte(header), &env); err != nil {
		return errors.New("invalid FSPIOP-Signature envelope")
	}
	protectedJSON, err := base64.RawURLEncoding.DecodeString(env.ProtectedHeader)
	if err != nil {
		return errors.New("invalid protected header encoding")
	}
	var ph fspiopProtectedHeader
	if err := json.Unmarshal(protectedJSON, &ph); err != nil {
		return errors.New("invalid protected header")
	}
	if ph.Alg != "EdDSA" {
		return fmt.Errorf("unexpected alg %q (platform convention is EdDSA)", ph.Alg)
	}
	// Bind the signature to THIS request: method, URI and body must match.
	if ph.FSPIOPHTTPMethod != method || ph.FSPIOPURI != requestURI {
		return errors.New("protected header does not match request method/URI")
	}
	bodyB64 := ""
	if len(body) > 0 {
		bodyB64 = base64.RawURLEncoding.EncodeToString(body)
	}
	sig, err := base64.RawURLEncoding.DecodeString(env.Signature)
	if err != nil {
		return errors.New("invalid signature encoding")
	}
	if !ed25519.Verify(pub, []byte(env.ProtectedHeader+"."+bodyB64), sig) {
		return errors.New("FSPIOP signature verification failed")
	}
	return nil
}

// generateTestKey is used by tests to produce a PKCS8 Ed25519 PEM key.
func generateTestKey() (ed25519.PublicKey, []byte, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, nil, err
	}
	return pub, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}
