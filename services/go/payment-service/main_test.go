package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
)

// SW-11: money conversion guards.
func TestMinorUnitsGuards(t *testing.T) {
	if v, err := minorUnits(0.29); err != nil || v != 29 {
		t.Fatalf("minorUnits(0.29) = %d, %v", v, err)
	}
	for _, bad := range []float64{0, -5, math.NaN(), math.Inf(1), 1e15} {
		if _, err := minorUnits(bad); err == nil {
			t.Errorf("minorUnits(%v) should fail", bad)
		}
	}
	if minorToDecimal(123456) != "1234.56" {
		t.Fatalf("minorToDecimal wrong: %s", minorToDecimal(123456))
	}
}

// SW-11: webhook signature verification.
func TestVerifyWebhookSignature(t *testing.T) {
	t.Setenv("MOJALOOP_CALLBACK_SECRET", "secret-0123456789abcdef0123")
	body := []byte(`{"transferId":"x","transferState":"COMMITTED"}`)
	mac := hmac.New(sha256.New, []byte("secret-0123456789abcdef0123"))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))
	if !verifyWebhookSignature(body, "sha256="+sig) {
		t.Fatal("valid signature rejected")
	}
	if verifyWebhookSignature(body, "sha256="+sig[:60]+"ffff") {
		t.Fatal("tampered signature accepted")
	}
	if verifyWebhookSignature(body, "") {
		t.Fatal("missing signature accepted")
	}
}

// SW-11: tariff fails closed in production without a tariff source.
func TestTariffFailsClosedInProduction(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	old := tariffServiceURL
	tariffServiceURL = ""
	defer func() { tariffServiceURL = old }()
	if _, _, err := lookupTariff(context.Background(), "8471"); err == nil {
		t.Fatal("production tariff lookup must fail without a tariff source")
	}
}

// SW-11: tariff service is used when configured (authoritative source).
func TestTariffFromAuthoritativeService(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"importDutyBp": 2000, "vatBp": 1250, "levyBp": 100, "description": "Motor vehicles",
		})
	}))
	defer srv.Close()
	old := tariffServiceURL
	tariffServiceURL = srv.URL
	defer func() { tariffServiceURL = old }()
	rates, source, err := lookupTariff(context.Background(), "87031010")
	if err != nil || rates.ImportDutyBP != 2000 || source != "tariff-service" {
		t.Fatalf("authoritative lookup failed: %v %v %v", rates, source, err)
	}
}

// SW-11: assessment uses integer minor units.
func TestAssessDutyIntegerMinorUnits(t *testing.T) {
	old := tariffServiceURL
	tariffServiceURL = ""
	t.Setenv("APP_ENV", "development")
	defer func() { tariffServiceURL = old }()
	a, err := assessDuty(context.Background(), 1, "87031010", 1000.33, "USD")
	if err != nil {
		t.Fatal(err)
	}
	// 100033 minor: duty 20% = 20006.6→20007; vat base 120040 *12.5% = 15005; levy 2% = 2000.66→2001
	var duty, vat, levy int64
	for _, li := range a.DutyBreakdown {
		switch li.DutyType {
		case "import_duty":
			duty = li.AmountMinor
		case "vat":
			vat = li.AmountMinor
		case "levy":
			levy = li.AmountMinor
		}
	}
	if duty != 20007 || vat != 15005 || levy != 2001 {
		t.Fatalf("minor-unit assessment wrong: duty=%d vat=%d levy=%d", duty, vat, levy)
	}
	if a.TariffSource != "STATIC-FALLBACK-NON-PRODUCTION" {
		t.Fatalf("tariff source not labelled: %s", a.TariffSource)
	}
}

// SW-11: ledger post returns the real bridge id and errors on failure.
func TestPostSettlementToLedger(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"id": "bridge-real-1", "status": "posted"})
	}))
	defer srv.Close()
	old := tigerBeetleBridgeURL
	tigerBeetleBridgeURL = srv.URL
	defer func() { tigerBeetleBridgeURL = old }()
	id, err := postSettlementToLedger(context.Background(), 1, "TG-x", 100, "USD")
	if err != nil || id != "bridge-real-1" {
		t.Fatalf("ledger post failed: %q %v", id, err)
	}

	tigerBeetleBridgeURL = "http://127.0.0.1:1"
	if _, err := postSettlementToLedger(context.Background(), 1, "TG-x", 100, "USD"); err == nil {
		t.Fatal("unreachable bridge must error — no fabricated TB-LOCAL- ids")
	}
}
