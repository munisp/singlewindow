// jws.go — FSPIOP JWS signing for the Mojaloop DFSP.
//
// The Mojaloop Hub requires every outbound request to carry a
// FSPIOP-Signature header containing a compact JWS (JSON Web Signature)
// signed with the DFSP's private key.
//
// Supported algorithms:
//   - RS256  (RSA PKCS#1 v1.5, SHA-256) — legacy, still accepted by some hubs
//   - PS256  (RSA-PSS, SHA-256)         — recommended for new deployments
//   - EdDSA  (Ed25519)                  — preferred where hub supports it
//
// Key management:
//   - Keys are loaded from PEM files at startup (DFSP_JWS_PRIVATE_KEY_PATH env var)
//   - Key rotation is supported: call Signer.RotateKey() with a new PEM block
//   - The public JWK is exposed at GET /dfsp/jwks.json for hub verification
//
// FSPIOP-Signature format (Mojaloop API Spec §6.5.2):
//
//	{
//	  "signature": "<base64url-encoded DER signature>",
//	  "protectedHeader": "<base64url-encoded protected JWS header>"
//	}
//
// The protected header contains:
//
//	{ "alg": "PS256", "FSPIOP-URI": "/parties/MSISDN/2348012345678",
//	  "FSPIOP-HTTP-Method": "POST", "FSPIOP-Source": "tradegateway",
//	  "FSPIOP-Destination": "hub", "Date": "Sat, 21 Jun 2026 17:00:00 GMT" }
package dfsp

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

// ─── Algorithm constants ──────────────────────────────────────────────────────

// JWSAlgorithm identifies the signing algorithm.
type JWSAlgorithm string

const (
	AlgRS256 JWSAlgorithm = "RS256" // RSA PKCS#1 v1.5 + SHA-256
	AlgPS256 JWSAlgorithm = "PS256" // RSA-PSS + SHA-256 (recommended)
	AlgEdDSA JWSAlgorithm = "EdDSA" // Ed25519
	AlgES256 JWSAlgorithm = "ES256" // ECDSA P-256 + SHA-256
)

// ─── Protected Header ─────────────────────────────────────────────────────────

// FSPIOPProtectedHeader is the JWS protected header for Mojaloop FSPIOP requests.
// It is base64url-encoded and included in the FSPIOP-Signature header.
type FSPIOPProtectedHeader struct {
	Alg             JWSAlgorithm `json:"alg"`
	FSPIOPURI       string       `json:"FSPIOP-URI"`
	FSPIOPHTTPMethod string      `json:"FSPIOP-HTTP-Method"`
	FSPIOPSource    string       `json:"FSPIOP-Source"`
	FSPIOPDest      string       `json:"FSPIOP-Destination,omitempty"`
	Date            string       `json:"Date"`
}

// ─── Signature envelope ───────────────────────────────────────────────────────

// FSPIOPSignature is the JSON object placed in the FSPIOP-Signature header.
type FSPIOPSignature struct {
	Signature       string `json:"signature"`
	ProtectedHeader string `json:"protectedHeader"`
}

// ─── JWK public key ───────────────────────────────────────────────────────────

// JWK represents a JSON Web Key for the DFSP's public key.
type JWK struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	// RSA fields
	N string `json:"n,omitempty"`
	E string `json:"e,omitempty"`
	// EC fields
	Crv string `json:"crv,omitempty"`
	X   string `json:"x,omitempty"`
	Y   string `json:"y,omitempty"`
}

// JWKSet is the JSON Web Key Set returned at /dfsp/jwks.json.
type JWKSet struct {
	Keys []JWK `json:"keys"`
}

// ─── Signer ───────────────────────────────────────────────────────────────────

// Signer holds the DFSP private key and signs FSPIOP requests.
// It is safe for concurrent use.
type Signer struct {
	mu         sync.RWMutex
	privateKey crypto.PrivateKey
	algorithm  JWSAlgorithm
	dfspID     string
	keyID      string
}

// NewSignerFromEnv creates a Signer by loading the private key from the path
// specified in the DFSP_JWS_PRIVATE_KEY_PATH environment variable.
// Falls back to generating an ephemeral RSA-2048 key if the env var is unset
// (development mode only — logs a warning).
func NewSignerFromEnv(dfspID string) (*Signer, error) {
	keyPath := os.Getenv("DFSP_JWS_PRIVATE_KEY_PATH")
	if keyPath == "" {
		// Development fallback: generate ephemeral key
		return newEphemeralSigner(dfspID)
	}
	pemBytes, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("jws: read private key %s: %w", keyPath, err)
	}
	return NewSignerFromPEM(dfspID, pemBytes)
}

// NewSignerFromPEM creates a Signer from a PEM-encoded private key.
// Supports RSA (PKCS#1 and PKCS#8), EC (P-256), and Ed25519 keys.
func NewSignerFromPEM(dfspID string, pemBytes []byte) (*Signer, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("jws: failed to decode PEM block")
	}

	var (
		key  crypto.PrivateKey
		alg  JWSAlgorithm
		err  error
	)

	switch block.Type {
	case "RSA PRIVATE KEY":
		key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("jws: parse RSA PKCS1 key: %w", err)
		}
		alg = AlgPS256

	case "PRIVATE KEY":
		parsed, parseErr := x509.ParsePKCS8PrivateKey(block.Bytes)
		if parseErr != nil {
			return nil, fmt.Errorf("jws: parse PKCS8 key: %w", parseErr)
		}
		switch k := parsed.(type) {
		case *rsa.PrivateKey:
			key = k
			alg = AlgPS256
		case *ecdsa.PrivateKey:
			key = k
			alg = AlgES256
		case ed25519.PrivateKey:
			key = k
			alg = AlgEdDSA
		default:
			return nil, fmt.Errorf("jws: unsupported PKCS8 key type %T", parsed)
		}

	case "EC PRIVATE KEY":
		key, err = x509.ParseECPrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("jws: parse EC key: %w", err)
		}
		alg = AlgES256

	default:
		return nil, fmt.Errorf("jws: unsupported PEM block type %q", block.Type)
	}

	return &Signer{
		privateKey: key,
		algorithm:  alg,
		dfspID:     dfspID,
		keyID:      dfspID + "-v1",
	}, nil
}

// newEphemeralSigner generates an ephemeral RSA-2048 key for development.
func newEphemeralSigner(dfspID string) (*Signer, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("jws: generate ephemeral RSA key: %w", err)
	}
	return &Signer{
		privateKey: key,
		algorithm:  AlgPS256,
		dfspID:     dfspID,
		keyID:      dfspID + "-ephemeral",
	}, nil
}

// RotateKey replaces the current private key with a new PEM-encoded key.
// Existing in-flight requests complete with the old key; new requests use the new key.
func (s *Signer) RotateKey(newPEM []byte) error {
	newSigner, err := NewSignerFromPEM(s.dfspID, newPEM)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.privateKey = newSigner.privateKey
	s.algorithm = newSigner.algorithm
	s.keyID = s.dfspID + "-v" + time.Now().Format("20060102")
	return nil
}

// Algorithm returns the current signing algorithm.
func (s *Signer) Algorithm() JWSAlgorithm {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.algorithm
}

// ─── Sign ─────────────────────────────────────────────────────────────────────

// SignRequest signs an outbound FSPIOP HTTP request and sets the
// FSPIOP-Signature header. It also sets Date if not already present.
//
// Parameters:
//   - req: the outbound *http.Request (must have URL and Method set)
//   - destination: the FSPIOP-Destination value (hub or target DFSP ID)
//   - body: the raw request body bytes (nil for GET/DELETE)
func (s *Signer) SignRequest(req *http.Request, destination string, body []byte) error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if req.Header.Get("Date") == "" {
		req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	}

	protected := FSPIOPProtectedHeader{
		Alg:              s.algorithm,
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

	// Signing input = base64url(protectedHeader) + "." + base64url(body)
	bodyB64 := ""
	if len(body) > 0 {
		bodyB64 = base64.RawURLEncoding.EncodeToString(body)
	}
	signingInput := protectedB64 + "." + bodyB64

	sig, err := s.sign([]byte(signingInput))
	if err != nil {
		return fmt.Errorf("jws: sign: %w", err)
	}

	envelope := FSPIOPSignature{
		Signature:       base64.RawURLEncoding.EncodeToString(sig),
		ProtectedHeader: protectedB64,
	}
	envelopeJSON, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("jws: marshal signature envelope: %w", err)
	}

	req.Header.Set("FSPIOP-Signature", string(envelopeJSON))
	return nil
}

// sign produces a raw signature over the input bytes using the current key.
func (s *Signer) sign(input []byte) ([]byte, error) {
	switch k := s.privateKey.(type) {
	case *rsa.PrivateKey:
		digest := sha256.Sum256(input)
		switch s.algorithm {
		case AlgPS256:
			return rsa.SignPSS(rand.Reader, k, crypto.SHA256, digest[:], &rsa.PSSOptions{
				SaltLength: rsa.PSSSaltLengthEqualsHash,
				Hash:       crypto.SHA256,
			})
		case AlgRS256:
			return rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, digest[:])
		default:
			return nil, fmt.Errorf("jws: algorithm %s not supported for RSA key", s.algorithm)
		}

	case *ecdsa.PrivateKey:
		digest := sha256.Sum256(input)
		return k.Sign(rand.Reader, digest[:], crypto.SHA256)

	case ed25519.PrivateKey:
		// Ed25519 signs the message directly (no pre-hashing)
		return ed25519.Sign(k, input), nil

	default:
		return nil, fmt.Errorf("jws: unsupported key type %T", s.privateKey)
	}
}

// ─── Verify ───────────────────────────────────────────────────────────────────

// VerifyRequest verifies the FSPIOP-Signature header on an inbound request.
// publicKey must be the sender's public key (obtained from their JWKS endpoint).
func VerifyRequest(req *http.Request, body []byte, publicKey crypto.PublicKey) error {
	sigHeader := req.Header.Get("FSPIOP-Signature")
	if sigHeader == "" {
		return errors.New("jws: missing FSPIOP-Signature header")
	}

	var envelope FSPIOPSignature
	if err := json.Unmarshal([]byte(sigHeader), &envelope); err != nil {
		return fmt.Errorf("jws: unmarshal signature envelope: %w", err)
	}

	protectedJSON, err := base64.RawURLEncoding.DecodeString(envelope.ProtectedHeader)
	if err != nil {
		return fmt.Errorf("jws: decode protected header: %w", err)
	}

	var protected FSPIOPProtectedHeader
	if err := json.Unmarshal(protectedJSON, &protected); err != nil {
		return fmt.Errorf("jws: parse protected header: %w", err)
	}

	bodyB64 := ""
	if len(body) > 0 {
		bodyB64 = base64.RawURLEncoding.EncodeToString(body)
	}
	signingInput := envelope.ProtectedHeader + "." + bodyB64

	rawSig, err := base64.RawURLEncoding.DecodeString(envelope.Signature)
	if err != nil {
		return fmt.Errorf("jws: decode signature: %w", err)
	}

	return verify(protected.Alg, publicKey, []byte(signingInput), rawSig)
}

// verify checks the signature against the signing input using the given algorithm.
func verify(alg JWSAlgorithm, publicKey crypto.PublicKey, input, sig []byte) error {
	switch k := publicKey.(type) {
	case *rsa.PublicKey:
		digest := sha256.Sum256(input)
		switch alg {
		case AlgPS256:
			return rsa.VerifyPSS(k, crypto.SHA256, digest[:], sig, &rsa.PSSOptions{
				SaltLength: rsa.PSSSaltLengthEqualsHash,
				Hash:       crypto.SHA256,
			})
		case AlgRS256:
			return rsa.VerifyPKCS1v15(k, crypto.SHA256, digest[:], sig)
		default:
			return fmt.Errorf("jws: algorithm %s not supported for RSA public key", alg)
		}

	case *ecdsa.PublicKey:
		digest := sha256.Sum256(input)
		if !ecdsa.VerifyASN1(k, digest[:], sig) {
			return errors.New("jws: ECDSA signature verification failed")
		}
		return nil

	case ed25519.PublicKey:
		if !ed25519.Verify(k, input, sig) {
			return errors.New("jws: Ed25519 signature verification failed")
		}
		return nil

	default:
		return fmt.Errorf("jws: unsupported public key type %T", publicKey)
	}
}

// ─── JWKS endpoint ────────────────────────────────────────────────────────────

// PublicJWK returns the JWK representation of the signer's public key.
// This is served at GET /dfsp/jwks.json for hub verification.
func (s *Signer) PublicJWK() (JWK, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	switch k := s.privateKey.(type) {
	case *rsa.PrivateKey:
		pub := &k.PublicKey
		return JWK{
			Kty: "RSA",
			Use: "sig",
			Kid: s.keyID,
			Alg: string(s.algorithm),
			N:   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
			E:   encodeRSAExponent(pub.E),
		}, nil

	case *ecdsa.PrivateKey:
		pub := &k.PublicKey
		return JWK{
			Kty: "EC",
			Use: "sig",
			Kid: s.keyID,
			Alg: string(s.algorithm),
			Crv: "P-256",
			X:   base64.RawURLEncoding.EncodeToString(pub.X.Bytes()),
			Y:   base64.RawURLEncoding.EncodeToString(pub.Y.Bytes()),
		}, nil

	case ed25519.PrivateKey:
		pub := k.Public().(ed25519.PublicKey)
		return JWK{
			Kty: "OKP",
			Use: "sig",
			Kid: s.keyID,
			Alg: string(s.algorithm),
			Crv: "Ed25519",
			X:   base64.RawURLEncoding.EncodeToString(pub),
		}, nil

	default:
		return JWK{}, fmt.Errorf("jws: unsupported key type %T for JWK export", s.privateKey)
	}
}

// JWKSHandler returns an http.HandlerFunc that serves the DFSP's public JWK set.
func (s *Signer) JWKSHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jwk, err := s.PublicJWK()
		if err != nil {
			http.Error(w, "failed to export JWK", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(JWKSet{Keys: []JWK{jwk}}) //nolint:errcheck
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// encodeRSAExponent encodes the RSA public exponent as a base64url big-endian integer.
func encodeRSAExponent(e int) string {
	b := make([]byte, 4)
	b[0] = byte(e >> 24)
	b[1] = byte(e >> 16)
	b[2] = byte(e >> 8)
	b[3] = byte(e)
	// Trim leading zero bytes
	i := 0
	for i < len(b)-1 && b[i] == 0 {
		i++
	}
	return base64.RawURLEncoding.EncodeToString(b[i:])
}
