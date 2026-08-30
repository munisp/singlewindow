// Package envelope verifies blueeconomy-geo-service geo.*.v1 provenance
// envelopes (Phase-9 WP-B, cargo-tracking-service ingestion boundary).
//
// Contract (mirrors blueeconomy-geo-service internal/sign, envelope
// envelopeVersion 1.0):
//   - the envelope JSON carries provenance.signature as a JWS compact
//     serialization (EdDSA/Ed25519) over the JCS-canonicalized (RFC 8785)
//     envelope with the provenance.signature field excluded;
//   - the JWS protected header is {"alg":"EdDSA","kid":"blueeconomy-geo-service-<epoch>"};
//   - trust keys are env-only (GEO_ENVELOPE_TRUST_KEYS), keyed by full kid.
//
// Fail-closed: ANY deviation (unknown version, wrong producer, disallowed
// event type, malformed JWS, wrong alg, kid not matching the
// blueeconomy-geo-service-<epoch> pattern, untrusted kid, canonical-payload
// mismatch, bad signature) is a typed VerifyError and the event is never
// persisted.
package envelope

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	jsoncanonicalizer "github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
)

const (
	// Version is the only supported envelope contract version.
	Version = "1.0"
	// Producer is the only trusted envelope producer.
	Producer = "blueeconomy-geo-service"
	// KeyIDPrefix is the trusted kid prefix: blueeconomy-geo-service-<epoch>.
	KeyIDPrefix = "blueeconomy-geo-service-"
	// TrustKeysEnv carries comma-separated kid=base64-or-hex-public-key pairs.
	TrustKeysEnv = "GEO_ENVELOPE_TRUST_KEYS"

	// EventVesselPosition is the event type consumed for vessel tracking.
	EventVesselPosition = "geo.vessel-position.v1"
)

// allowedEventTypes is the contract-governed fail-closed event set.
var allowedEventTypes = map[string]bool{
	"geo.vessel-position.v1":    true,
	"geo.vessel-static.v1":      true,
	"geo.geofence-event.v1":     true,
	"geo.app-position-report.v1": true,
	"geo.sos.v1":                true,
	"geo.sos-acknowledged.v1":   true,
	"geo.sos-resolved.v1":       true,
}

// VerifyError is a typed verification failure (fail-closed).
type VerifyError struct{ Reason string }

func (e *VerifyError) Error() string { return "envelope verification failed: " + e.Reason }

// Provenance mirrors the producer's provenance block.
type Provenance struct {
	PrincipalID      string `json:"principalId"`
	PrincipalRole    string `json:"principalRole"`
	LedgerCommitHash string `json:"ledgerCommitHash"`
	Signature        string `json:"signature"`
}

// Envelope is the platform geo.*.v1 envelope (envelopeVersion 1.0).
type Envelope struct {
	EnvelopeVersion string          `json:"envelopeVersion"`
	EventID         string          `json:"eventId"`
	EventType       string          `json:"eventType"`
	OccurredAt      time.Time       `json:"occurredAt"`
	Producer        string          `json:"producer"`
	CorrelationID   string          `json:"correlationId"`
	Classification  string          `json:"classification"`
	FHIR            json.RawMessage `json:"fhir"`
	Provenance      Provenance      `json:"provenance"`
}

// VesselPositionPayload is the geo.vessel-position.v1 primary resource.
type VesselPositionPayload struct {
	PositionReportID             string    `json:"positionReportId"`
	MMSI                         string    `json:"mmsi"`
	SourceClass                  string    `json:"sourceClass"`
	LatitudeMicros               int32     `json:"latitudeMicros"`
	LongitudeMicros              int32     `json:"longitudeMicros"`
	SpeedOverGroundMilliknots    uint32    `json:"speedOverGroundMilliknots"`
	CourseOverGroundMillidegrees uint32    `json:"courseOverGroundMillidegrees"`
	HeadingMillidegrees          *uint32   `json:"headingMillidegrees,omitempty"`
	NavStatus                    *int32    `json:"navStatus,omitempty"`
	PositionAccuracy             string    `json:"positionAccuracy"`
	ObservedAt                   time.Time `json:"observedAt"`
	ReceiverID                   string    `json:"receiverId"`
	AISMessageType               *int32    `json:"aisMessageType,omitempty"`
	Classification               string    `json:"classification"`
	IMO                          string    `json:"imo,omitempty"`
	Callsign                     string    `json:"callsign,omitempty"`
	ShipName                     string    `json:"shipName,omitempty"`
}

// TrustKeys maps full JWS kid → Ed25519 public key.
type TrustKeys map[string]ed25519.PublicKey

// ParseTrustKeys parses GEO_ENVELOPE_TRUST_KEYS: comma-separated
// "kid=base64-or-hex-key" entries. Fails closed on any malformed entry.
func ParseTrustKeys(raw string) (TrustKeys, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New(TrustKeysEnv + " is empty or unset")
	}
	keys := TrustKeys{}
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		kid, encoded, ok := strings.Cut(entry, "=")
		if !ok || strings.TrimSpace(kid) == "" {
			return nil, fmt.Errorf("malformed trust-key entry %q (want kid=key)", entry)
		}
		if err := ValidateKeyID(strings.TrimSpace(kid)); err != nil {
			return nil, err
		}
		pub, err := parsePublicKey(strings.TrimSpace(encoded))
		if err != nil {
			return nil, fmt.Errorf("trust key %q: %w", kid, err)
		}
		keys[strings.TrimSpace(kid)] = pub
	}
	if len(keys) == 0 {
		return nil, errors.New(TrustKeysEnv + " contains no keys")
	}
	return keys, nil
}

// ValidateKeyID enforces the kid contract: blueeconomy-geo-service-<epoch>
// with a decimal epoch.
func ValidateKeyID(kid string) error {
	if !strings.HasPrefix(kid, KeyIDPrefix) {
		return fmt.Errorf("kid %q does not match the %s<epoch> pattern", kid, KeyIDPrefix)
	}
	epoch := strings.TrimPrefix(kid, KeyIDPrefix)
	if epoch == "" {
		return fmt.Errorf("kid %q has no key-rotation epoch", kid)
	}
	if _, err := strconv.ParseUint(epoch, 10, 64); err != nil {
		return fmt.Errorf("kid %q epoch is not decimal: %w", kid, err)
	}
	return nil
}

func parsePublicKey(encoded string) (ed25519.PublicKey, error) {
	for _, decode := range []func(string) ([]byte, error){
		base64.RawURLEncoding.DecodeString,
		base64.URLEncoding.DecodeString,
		base64.RawStdEncoding.DecodeString,
		base64.StdEncoding.DecodeString,
		func(v string) ([]byte, error) { return hex.DecodeString(v) },
	} {
		raw, err := decode(encoded)
		if err != nil {
			continue
		}
		if len(raw) == ed25519.PublicKeySize {
			return ed25519.PublicKey(raw), nil
		}
	}
	return nil, fmt.Errorf("must be base64 or hex of %d bytes", ed25519.PublicKeySize)
}

// canonicalPayload renders the envelope minus provenance.signature as
// JCS-canonical JSON (mirrors the producer byte-for-byte; numbers are
// decoded as literals).
func canonicalPayload(raw []byte) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var generic map[string]any
	if err := decoder.Decode(&generic); err != nil {
		return nil, fmt.Errorf("decode envelope for verification: %w", err)
	}
	provenance, ok := generic["provenance"].(map[string]any)
	if !ok {
		return nil, errors.New("envelope provenance block is missing")
	}
	if _, present := provenance["signature"]; !present {
		return nil, errors.New("envelope provenance signature is missing")
	}
	delete(provenance, "signature")
	stripped, err := json.Marshal(generic)
	if err != nil {
		return nil, fmt.Errorf("re-encode envelope for verification: %w", err)
	}
	canonical, err := jsoncanonicalizer.Transform(stripped)
	if err != nil {
		return nil, fmt.Errorf("JCS-canonicalize envelope: %w", err)
	}
	return canonical, nil
}

// Verify parses and verifies a raw envelope against the trust keys. It
// returns the verified envelope or a typed VerifyError — never both.
func Verify(raw []byte, keys TrustKeys) (*Envelope, error) {
	if len(keys) == 0 {
		return nil, &VerifyError{Reason: "no trust keys configured"}
	}
	var env Envelope
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&env); err != nil {
		return nil, &VerifyError{Reason: "envelope is not valid JSON: " + err.Error()}
	}
	if env.EnvelopeVersion != Version {
		return nil, &VerifyError{Reason: fmt.Sprintf("envelopeVersion %q is not %q", env.EnvelopeVersion, Version)}
	}
	if env.Producer != Producer {
		return nil, &VerifyError{Reason: fmt.Sprintf("producer %q is not %q", env.Producer, Producer)}
	}
	if !allowedEventTypes[env.EventType] {
		return nil, &VerifyError{Reason: fmt.Sprintf("eventType %q is not a geo v1 contract type", env.EventType)}
	}
	if env.EventID == "" || env.CorrelationID == "" {
		return nil, &VerifyError{Reason: "eventId and correlationId are required"}
	}

	parts := strings.Split(env.Provenance.Signature, ".")
	if len(parts) != 3 {
		return nil, &VerifyError{Reason: "provenance signature is not a JWS compact serialization"}
	}
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, &VerifyError{Reason: "decode JWS protected header: " + err.Error()}
	}
	var parsed struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
	}
	if err := json.Unmarshal(header, &parsed); err != nil {
		return nil, &VerifyError{Reason: "parse JWS protected header: " + err.Error()}
	}
	if parsed.Algorithm != "EdDSA" {
		return nil, &VerifyError{Reason: fmt.Sprintf("JWS alg %q is not EdDSA", parsed.Algorithm)}
	}
	if err := ValidateKeyID(parsed.KeyID); err != nil {
		return nil, &VerifyError{Reason: err.Error()}
	}
	publicKey, ok := keys[parsed.KeyID]
	if !ok {
		return nil, &VerifyError{Reason: fmt.Sprintf("kid %q is not in the trusted key set", parsed.KeyID)}
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, &VerifyError{Reason: "decode JWS signature: " + err.Error()}
	}
	canonical, err := canonicalPayload(raw)
	if err != nil {
		return nil, &VerifyError{Reason: err.Error()}
	}
	if base64.RawURLEncoding.EncodeToString(canonical) != parts[1] {
		return nil, &VerifyError{Reason: "envelope does not match the signed canonical payload"}
	}
	if !ed25519.Verify(publicKey, []byte(parts[0]+"."+parts[1]), signature) {
		return nil, &VerifyError{Reason: "JWS signature verification failed"}
	}
	return &env, nil
}

// ExtractVesselPosition unwraps the verified envelope's FHIR message bundle
// primary resource as a geo.vessel-position.v1 payload. Fail-closed: any
// structural deviation is an error.
func ExtractVesselPosition(env *Envelope) (*VesselPositionPayload, error) {
	if env.EventType != EventVesselPosition {
		return nil, &VerifyError{Reason: fmt.Sprintf("eventType %q is not %s", env.EventType, EventVesselPosition)}
	}
	var bundle struct {
		ResourceType string `json:"resourceType"`
		Type         string `json:"type"`
		Entry        []struct {
			Resource json.RawMessage `json:"resource"`
		} `json:"entry"`
	}
	decoder := json.NewDecoder(bytes.NewReader(env.FHIR))
	decoder.UseNumber()
	if err := decoder.Decode(&bundle); err != nil {
		return nil, &VerifyError{Reason: "decode FHIR bundle: " + err.Error()}
	}
	if bundle.ResourceType != "Bundle" || bundle.Type != "message" || len(bundle.Entry) != 1 {
		return nil, &VerifyError{Reason: "FHIR payload is not a single-entry message Bundle"}
	}
	var payload VesselPositionPayload
	decoder = json.NewDecoder(bytes.NewReader(bundle.Entry[0].Resource))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	// The resource carries the contract "@type" discriminator alongside the
	// payload fields; strip it before strict decoding.
	var raw map[string]json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return nil, &VerifyError{Reason: "decode position resource: " + err.Error()}
	}
	typeURL, present := raw["@type"]
	if !present {
		return nil, &VerifyError{Reason: "position resource is missing the @type discriminator"}
	}
	var typeStr string
	if err := json.Unmarshal(typeURL, &typeStr); err != nil || typeStr != "type.googleapis.com/blueeconomy.contracts.v1.VesselPositionReported" {
		return nil, &VerifyError{Reason: fmt.Sprintf("position resource @type %q is not VesselPositionReported", typeStr)}
	}
	delete(raw, "@type")
	stripped, _ := json.Marshal(raw)
	strict := json.NewDecoder(bytes.NewReader(stripped))
	strict.UseNumber()
	strict.DisallowUnknownFields()
	if err := strict.Decode(&payload); err != nil {
		return nil, &VerifyError{Reason: "position payload does not match the contract: " + err.Error()}
	}
	if payload.PositionReportID == "" || payload.MMSI == "" || payload.ReceiverID == "" {
		return nil, &VerifyError{Reason: "positionReportId, mmsi and receiverId are required"}
	}
	if payload.ObservedAt.IsZero() {
		return nil, &VerifyError{Reason: "observedAt is required"}
	}
	return &payload, nil
}
