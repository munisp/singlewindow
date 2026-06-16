package main

import (
	"testing"
)

// ─── State machine tests ──────────────────────────────────────────────────────

func TestCanTransition(t *testing.T) {
	tests := []struct {
		from     DeclarationStatus
		to       DeclarationStatus
		expected bool
	}{
		{StatusDraft, StatusSubmitted, true},
		{StatusSubmitted, StatusAssessed, true},
		{StatusSubmitted, StatusRejected, true},
		{StatusAssessed, StatusCleared, true},
		{StatusAssessed, StatusRejected, true},
		{StatusCleared, StatusAmended, true},
		// Invalid transitions
		{StatusDraft, StatusCleared, false},
		{StatusDraft, StatusRejected, false},
		{StatusCleared, StatusSubmitted, false},
		{StatusRejected, StatusCleared, false},
		{StatusRejected, StatusSubmitted, false},
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
