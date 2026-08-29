package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"testing"
	"time"
)

// ─── State machine tests ──────────────────────────────────────────────────────

func TestCanTransition(t *testing.T) {
	tests := []struct {
		from     DeclarationStatus
		to       DeclarationStatus
		expected bool
	}{
		{StatusDraft, StatusSubmitted, true},
		{StatusSubmitted, StatusUnderAssessment, true},
		{StatusSubmitted, StatusRejected, true},
		// SW-14/SW-16: cleared is reachable ONLY from payment_confirmed or
		// examination_complete — never from assessed/submitted/payment_pending.
		{StatusPaymentConfirmed, StatusCleared, true},
		{StatusExaminationComplete, StatusCleared, true},
		{StatusSubmitted, StatusCleared, false},
		{StatusUnderAssessment, StatusCleared, false},
		{StatusPaymentPending, StatusCleared, false},
		// Invalid transitions
		{StatusDraft, StatusCleared, false},
		{StatusDraft, StatusRejected, false},
		{StatusCleared, StatusSubmitted, false},
		{StatusRejected, StatusCleared, false},
		{StatusRejected, StatusSubmitted, true},
	}

	for _, tt := range tests {
		t.Run(string(tt.from)+"->"+string(tt.to), func(t *testing.T) {
			result := canTransition(tt.from, tt.to)
			if result != tt.expected {
				t.Errorf("canTransition(%s, %s) = %v, want %v",
					tt.from, tt.to, result, tt.expected)
			}
		})
	}
}

// ─── UCR generation tests ─────────────────────────────────────────────────────

func TestGenerateUCR(t *testing.T) {
	ucr := generateUCR()

	// UCR must start with "NG"
	if len(ucr) < 2 || ucr[:2] != "NG" {
		t.Errorf("UCR must start with NG, got: %s", ucr)
	}

	// UCR must be at least 18 chars: NG + 8 date + 8 hex
	if len(ucr) < 18 {
		t.Errorf("UCR too short: %s (len=%d)", ucr, len(ucr))
	}

	// UCRs must be unique
	ucr2 := generateUCR()
	if ucr == ucr2 {
		t.Errorf("UCR collision: %s == %s", ucr, ucr2)
	}
}

// ─── getEnv tests ─────────────────────────────────────────────────────────────

func TestGetEnv(t *testing.T) {
	t.Setenv("TEST_VAR", "hello")
	if v := getEnv("TEST_VAR", "default"); v != "hello" {
		t.Errorf("expected 'hello', got '%s'", v)
	}
	if v := getEnv("NONEXISTENT_VAR", "fallback"); v != "fallback" {
		t.Errorf("expected 'fallback', got '%s'", v)
	}
}

// ─── SW-16: clearance gate ────────────────────────────────────────────────────

func TestCanClear(t *testing.T) {
	// Payment confirmed, green lane → allowed
	if err := canClear("payment_confirmed", "GREEN"); err != nil {
		t.Errorf("payment_confirmed/GREEN should clear: %v", err)
	}
	// Payment confirmed but active yellow hold → blocked
	if err := canClear("payment_confirmed", "YELLOW"); err == nil {
		t.Error("payment_confirmed/YELLOW must NOT clear (active hold)")
	}
	// Hold discharged through examination → allowed
	if err := canClear("examination_complete", "RED"); err != nil {
		t.Errorf("examination_complete/RED should clear: %v", err)
	}
	// Never from submitted/under_assessment/payment_pending
	for _, st := range []string{"draft", "submitted", "under_assessment", "payment_pending"} {
		if err := canClear(st, "GREEN"); err == nil {
			t.Errorf("%s must NOT clear without payment confirmation", st)
		}
	}
}

// ─── SW-16: JWT verification ─────────────────────────────────────────────────

func makeTestJWT(sub, role, secret string, exp int64) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(
		fmt.Sprintf(`{"sub":%q,"role":%q,"exp":%d}`, sub, role, exp)))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(header + "." + payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return header + "." + payload + "." + sig
}

func TestParseAndVerifyJWT(t *testing.T) {
	secret := "test-secret-0123456789abcdef"
	valid := makeTestJWT("officer-1", "customs_officer", secret, time.Now().Add(time.Hour).Unix())
	sub, role, err := parseAndVerifyJWT(valid, secret)
	if err != nil || sub != "officer-1" || role != "customs_officer" {
		t.Fatalf("valid token rejected: %v", err)
	}
	// Forged signature
	if _, _, err := parseAndVerifyJWT(makeTestJWT("officer-1", "admin", "wrong-secret", 0), secret); err == nil {
		t.Error("forged token accepted")
	}
	// Expired
	if _, _, err := parseAndVerifyJWT(makeTestJWT("o", "admin", secret, time.Now().Add(-time.Hour).Unix()), secret); err == nil {
		t.Error("expired token accepted")
	}
	// Malformed
	if _, _, err := parseAndVerifyJWT("not.a.jwt.at.all", secret); err == nil {
		t.Error("malformed token accepted")
	}
}
