package handlers

import (
	"math"
	"testing"
)

// SW-M3/M14: money conversion must reject NaN/negative/overflow instead of
// silently truncating into uint64.
func TestMinorUnitsGuards(t *testing.T) {
	cases := []struct {
		amount float64
		ok     bool
	}{
		{0.29, true},
		{100.25, true},
		{0, false},
		{-5, false},
		{math.NaN(), false},
		{math.Inf(1), false},
		{1e15, false},
	}
	for _, c := range cases {
		_, err := minorUnits(c.amount)
		if c.ok && err != nil {
			t.Errorf("minorUnits(%v) unexpectedly failed: %v", c.amount, err)
		}
		if !c.ok && err == nil {
			t.Errorf("minorUnits(%v) should have failed", c.amount)
		}
	}
	if v, _ := minorUnits(0.29); v != 29 {
		t.Errorf("minorUnits(0.29) = %d, want 29", v)
	}
}

// SW-M3: callback signatures must verify (and reject forgeries).
func TestVerifySwitchSignature(t *testing.T) {
	t.Setenv("MOJALOOP_CALLBACK_SECRET", "test-secret-key-0123456789abcdef")
	body := []byte(`{"transferId":"x","transferState":"COMMITTED"}`)
	// compute valid signature
	// (duplicate of production logic to keep test self-contained)
	// hmac-sha256 hex
	// ── valid ──
	mac := func() string {
		// inline hmac
		return computeTestHMAC(body, "test-secret-key-0123456789abcdef")
	}()
	if !verifySwitchSignature(body, "sha256="+mac) {
		t.Fatal("valid signature rejected")
	}
	if verifySwitchSignature(body, "sha256="+computeTestHMAC(body, "wrong-secret")) {
		t.Fatal("forged signature accepted")
	}
	if verifySwitchSignature(body, "") {
		t.Fatal("missing signature accepted")
	}
}
