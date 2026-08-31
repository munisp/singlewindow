// Envelope verifier tests — envelopes are produced by a REAL signer that
// mirrors blueeconomy-geo-service internal/sign byte-for-byte (JWS-EdDSA over
// JCS-canonicalized envelope minus provenance.signature).
package envelope

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	jsoncanonicalizer "github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
)

// testSigner signs envelopes exactly like geo-service internal/sign.Signer.
type testSigner struct {
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
	kid  string
}

func newTestSigner(t *testing.T, kid string) *testSigner {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	return &testSigner{priv: priv, pub: pub, kid: kid}
}

func (s *testSigner) sign(t *testing.T, env map[string]any) []byte {
	t.Helper()
	// Marshal, strip signature, JCS-canonicalize — mirroring canonicalPayload.
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var generic map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&generic); err != nil {
		t.Fatalf("decode: %v", err)
	}
	delete(generic["provenance"].(map[string]any), "signature")
	stripped, _ := json.Marshal(generic)
	canonical, err := jsoncanonicalizer.Transform(stripped)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}
	header, _ := json.Marshal(map[string]string{"alg": "EdDSA", "kid": s.kid})
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(canonical)
	sig := ed25519.Sign(s.priv, []byte(input))
	signature := input + "." + base64.RawURLEncoding.EncodeToString(sig)
	generic["provenance"].(map[string]any)["signature"] = signature
	out, _ := json.Marshal(generic)
	return out
}

func testEnvelopeMap(payload map[string]any) map[string]any {
	resource := map[string]any{"@type": "type.googleapis.com/blueeconomy.contracts.v1.VesselPositionReported"}
	for k, v := range payload {
		resource[k] = v
	}
	bundle := map[string]any{
		"resourceType": "Bundle",
		"type":         "message",
		"bundleId":     "bdl-test-1",
		"entry": []any{map[string]any{
			"fullUrl":  "urn:uuid:entry-1",
			"resource": resource,
		}},
	}
	return map[string]any{
		"envelopeVersion": "1.0",
		"eventId":         "evt-" + time.Now().UTC().Format("150405.000000"),
		"eventType":       EventVesselPosition,
		"occurredAt":      time.Now().UTC().Format(time.RFC3339Nano),
		"producer":        Producer,
		"correlationId":   "corr-test-1",
		"classification":  "INTERNAL",
		"fhir":            bundle,
		"provenance": map[string]any{
			"principalId":      "ais-ingest-1",
			"principalRole":    "SYSTEM",
			"ledgerCommitHash": "abc123",
			"signature":        "placeholder",
		},
	}
}

func testPositionPayload() map[string]any {
	return map[string]any{
		"positionReportId":             "pr-1",
		"mmsi":                         "636019825",
		"sourceClass":                  "AIS",
		"latitudeMicros":               5603700,
		"longitudeMicros":              -187000,
		"speedOverGroundMilliknots":    12400,
		"courseOverGroundMillidegrees": 180000,
		"positionAccuracy":             "HIGH",
		"observedAt":                   time.Now().UTC().Format(time.RFC3339Nano),
		"receiverId":                   "tema-rx-1",
		"classification":               "INTERNAL",
		"shipName":                     "MV TEST VESSEL",
	}
}

func trustKeysFor(signers ...*testSigner) TrustKeys {
	keys := TrustKeys{}
	for _, s := range signers {
		keys[s.kid] = s.pub
	}
	return keys
}

func TestVerifyHappyPathAndExtract(t *testing.T) {
	signer := newTestSigner(t, "blueeconomy-geo-service-7")
	raw := signer.sign(t, testEnvelopeMap(testPositionPayload()))

	env, err := Verify(raw, trustKeysFor(signer))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if env.EventType != EventVesselPosition || env.Producer != Producer {
		t.Fatalf("unexpected envelope: %+v", env)
	}
	p, err := ExtractVesselPosition(env)
	if err != nil {
		t.Fatalf("ExtractVesselPosition: %v", err)
	}
	if p.MMSI != "636019825" || p.LatitudeMicros != 5603700 || p.SpeedOverGroundMilliknots != 12400 {
		t.Fatalf("payload mismatch: %+v", p)
	}
}

func TestVerifyTamperedPayloadRejected(t *testing.T) {
	signer := newTestSigner(t, "blueeconomy-geo-service-7")
	raw := signer.sign(t, testEnvelopeMap(testPositionPayload()))

	// Tamper: change the MMSI inside the signed payload, keep the signature.
	var generic map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&generic); err != nil {
		t.Fatalf("decode: %v", err)
	}
	bundle := generic["fhir"].(map[string]any)
	entry := bundle["entry"].([]any)[0].(map[string]any)
	entry["resource"].(map[string]any)["mmsi"] = "999999999"
	tampered, _ := json.Marshal(generic)

	_, err := Verify(tampered, trustKeysFor(signer))
	var verr *VerifyError
	if !errors.As(err, &verr) {
		t.Fatalf("tampered envelope must be rejected with VerifyError, got %v", err)
	}
}

func TestVerifyWrongKeyRejected(t *testing.T) {
	signer := newTestSigner(t, "blueeconomy-geo-service-7")
	other := newTestSigner(t, "blueeconomy-geo-service-7") // same kid, different key
	raw := signer.sign(t, testEnvelopeMap(testPositionPayload()))
	if _, err := Verify(raw, trustKeysFor(other)); err == nil {
		t.Fatal("signature under a different key must not verify")
	}
}

func TestVerifyUntrustedKIDRejected(t *testing.T) {
	signer := newTestSigner(t, "blueeconomy-geo-service-7")
	raw := signer.sign(t, testEnvelopeMap(testPositionPayload()))
	attacker := newTestSigner(t, "blueeconomy-geo-service-99")
	if _, err := Verify(raw, trustKeysFor(attacker)); err == nil {
		t.Fatal("untrusted kid must be rejected")
	}
}

func TestVerifyDeviationsRejected(t *testing.T) {
	signer := newTestSigner(t, "blueeconomy-geo-service-7")
	keys := trustKeysFor(signer)

	mutate := func(mut func(map[string]any)) []byte {
		env := testEnvelopeMap(testPositionPayload())
		mut(env)
		return signer.sign(t, env)
	}

	cases := []struct {
		name string
		raw  []byte
	}{
		{"wrong version", mutate(func(e map[string]any) { e["envelopeVersion"] = "2.0" })},
		{"wrong producer", mutate(func(e map[string]any) { e["producer"] = "evil-producer" })},
		{"disallowed event type", mutate(func(e map[string]any) { e["eventType"] = "geo.hacked.v9" })},
		{"missing eventId", mutate(func(e map[string]any) { e["eventId"] = "" })},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var verr *VerifyError
			if _, err := Verify(tc.raw, keys); !errors.As(err, &verr) {
				t.Fatalf("expected VerifyError, got %v", err)
			}
		})
	}

	// kid not matching the prefix pattern.
	badKid := newTestSigner(t, "someone-else-7")
	if _, err := Verify(badKid.sign(t, testEnvelopeMap(testPositionPayload())), TrustKeys{badKid.kid: badKid.pub}); err == nil {
		t.Fatal("kid outside blueeconomy-geo-service-<epoch> must be rejected")
	}
}

func TestParseTrustKeys(t *testing.T) {
	signer := newTestSigner(t, "blueeconomy-geo-service-3")
	encoded := base64.RawURLEncoding.EncodeToString(signer.pub)
	keys, err := ParseTrustKeys(" blueeconomy-geo-service-3=" + encoded + " ")
	if err != nil {
		t.Fatalf("ParseTrustKeys: %v", err)
	}
	if !bytes.Equal(keys["blueeconomy-geo-service-3"], signer.pub) {
		t.Fatal("parsed key mismatch")
	}
	if _, err := ParseTrustKeys(""); err == nil {
		t.Fatal("empty trust keys must fail closed")
	}
	if _, err := ParseTrustKeys("bad-entry-without-equals"); err == nil {
		t.Fatal("malformed entry must fail closed")
	}
	if _, err := ParseTrustKeys("wrong-prefix-1=" + encoded); err == nil {
		t.Fatal("kid outside the prefix must fail closed")
	}
}

func TestExtractRejectsNonPositionEvent(t *testing.T) {
	signer := newTestSigner(t, "blueeconomy-geo-service-7")
	env := testEnvelopeMap(testPositionPayload())
	env["eventType"] = "geo.vessel-static.v1"
	raw := signer.sign(t, env)
	verified, err := Verify(raw, trustKeysFor(signer))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if _, err := ExtractVesselPosition(verified); err == nil {
		t.Fatal("vessel-static must not extract as a position")
	}
	_ = strings.TrimSpace("") // keep strings import
}
