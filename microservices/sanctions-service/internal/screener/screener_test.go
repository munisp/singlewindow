package screener_test

import (
	"testing"

	"github.com/tradegateway/sanctions-service/internal/screener"
)

// testEntries is a small in-memory sanctions list for unit tests.
var testEntries = []screener.Entry{
	{
		ID:         "OFAC-001",
		Name:       "ACME ARMS LIMITED",
		Aliases:    []string{"ACME ARMS LTD", "ACME ARMAMENTS"},
		ListType:   screener.ListOFAC,
		EntityType: "entity",
		Country:    "RU",
	},
	{
		ID:         "UN-001",
		Name:       "GLOBAL CHEMICAL CORPORATION",
		Aliases:    []string{"GLOBAL CHEM CORP", "GCC INDUSTRIES"},
		ListType:   screener.ListUN,
		EntityType: "entity",
		Country:    "IR",
	},
	{
		ID:         "EU-001",
		Name:       "SHADOW TRADE LLC",
		Aliases:    []string{"SHADOW TRADING", "SHADOW TRADE"},
		ListType:   screener.ListEU,
		EntityType: "entity",
		Country:    "BY",
	},
	{
		ID:         "HMT-001",
		Name:       "DARK HARBOR SHIPPING",
		Aliases:    []string{"DARK HARBOUR SHIPPING", "DHS MARITIME"},
		ListType:   screener.ListHMT,
		EntityType: "entity",
		Country:    "KP",
	},
	{
		ID:         "WCO-001",
		Name:       "RESTRICTED EXPORTS GMBH",
		Aliases:    []string{"RESTRICTED EXPORT GMBH"},
		ListType:   screener.ListWCOCEN,
		EntityType: "entity",
		Country:    "SY",
	},
}

func newTestScreener() *screener.Screener {
	return screener.New(testEntries, 0.85)
}

// ─── Exact match tests ────────────────────────────────────────────────────────

func TestExactMatch(t *testing.T) {
	s := newTestScreener()
	result := s.Screen("ACME ARMS LIMITED")
	if !result.Hit {
		t.Fatalf("expected hit for exact match, got score=%.4f", result.Score)
	}
	if result.Score != 1.0 {
		t.Errorf("exact match should score 1.0, got %.4f", result.Score)
	}
	if result.MatchedEntry == nil || result.MatchedEntry.ID != "OFAC-001" {
		t.Errorf("expected OFAC-001, got %v", result.MatchedEntry)
	}
}

func TestExactMatchAlias(t *testing.T) {
	s := newTestScreener()
	result := s.Screen("ACME ARMS LTD")
	if !result.Hit {
		t.Fatalf("expected hit for alias exact match, got score=%.4f", result.Score)
	}
	if result.MatchedName != "ACME ARMS LTD" {
		t.Errorf("expected matched name ACME ARMS LTD, got %q", result.MatchedName)
	}
}

// ─── Fuzzy match tests ────────────────────────────────────────────────────────

func TestFuzzyMatchMinorTypo(t *testing.T) {
	s := newTestScreener()
	// One character transposition: ACME ARMS LIMITD
	result := s.Screen("ACME ARMS LIMITD")
	if !result.Hit {
		t.Fatalf("expected hit for minor typo, got score=%.4f", result.Score)
	}
}

func TestFuzzyMatchCaseInsensitive(t *testing.T) {
	s := newTestScreener()
	result := s.Screen("acme arms limited")
	if !result.Hit {
		t.Fatalf("expected hit for lowercase input, got score=%.4f", result.Score)
	}
}

func TestFuzzyMatchPunctuationStripped(t *testing.T) {
	s := newTestScreener()
	// Punctuation should be stripped during normalisation
	result := s.Screen("ACME-ARMS, LIMITED.")
	if !result.Hit {
		t.Fatalf("expected hit after punctuation stripping, got score=%.4f", result.Score)
	}
}

func TestFuzzyMatchBritishSpelling(t *testing.T) {
	s := newTestScreener()
	// "HARBOUR" vs "HARBOR" — Jaro-Winkler should still score above threshold
	result := s.Screen("DARK HARBOUR SHIPPING")
	if !result.Hit {
		t.Fatalf("expected hit for British spelling variant, got score=%.4f", result.Score)
	}
}

// ─── No-hit tests ─────────────────────────────────────────────────────────────

func TestNoHitLegitimateCompany(t *testing.T) {
	s := newTestScreener()
	result := s.Screen("SUNRISE TRADING COMPANY")
	if result.Hit {
		t.Errorf("expected no hit for legitimate company, got score=%.4f matched=%q",
			result.Score, result.MatchedName)
	}
}

func TestNoHitEmptyString(t *testing.T) {
	s := newTestScreener()
	result := s.Screen("")
	if result.Hit {
		t.Errorf("expected no hit for empty string, got score=%.4f", result.Score)
	}
}

func TestNoHitShortName(t *testing.T) {
	s := newTestScreener()
	result := s.Screen("ABC")
	if result.Hit {
		t.Errorf("expected no hit for very short unrelated name, got score=%.4f", result.Score)
	}
}

// ─── Batch screening tests ────────────────────────────────────────────────────

func TestBatchScreening(t *testing.T) {
	s := newTestScreener()
	names := []string{
		"ACME ARMS LIMITED",     // hit
		"SUNRISE TRADING CO",    // no hit
		"GLOBAL CHEM CORP",      // hit (alias)
		"ORDINARY IMPORTS LTD",  // no hit
		"SHADOW TRADE LLC",      // hit
	}
	results := s.ScreenBatch(names)
	if len(results) != len(names) {
		t.Fatalf("expected %d results, got %d", len(names), len(results))
	}
	expected := []bool{true, false, true, false, true}
	for i, r := range results {
		if r.Hit != expected[i] {
			t.Errorf("batch[%d] %q: expected hit=%v, got hit=%v score=%.4f",
				i, names[i], expected[i], r.Hit, r.Score)
		}
	}
}

// ─── Threshold tests ──────────────────────────────────────────────────────────

func TestCustomThreshold(t *testing.T) {
	// Lower threshold should catch more near-misses
	s := screener.New(testEntries, 0.70)
	result := s.Screen("ACME ARMAMENT CORP")
	if !result.Hit {
		t.Logf("score=%.4f jw=%.4f lev=%.4f", result.Score, result.JaroWinklerScore, result.LevenshteinScore)
		t.Fatalf("expected hit at 0.70 threshold for near-match, got score=%.4f", result.Score)
	}
}

func TestHighThresholdNoFalsePositive(t *testing.T) {
	// Very high threshold should not flag near-misses
	s := screener.New(testEntries, 0.99)
	result := s.Screen("ACME ARMS LIMITD")
	if result.Hit {
		t.Errorf("expected no hit at 0.99 threshold for typo variant, got score=%.4f", result.Score)
	}
}

// ─── Score component tests ────────────────────────────────────────────────────

func TestScoreComponentsExposed(t *testing.T) {
	s := newTestScreener()
	result := s.Screen("GLOBAL CHEMICAL CORP")
	if result.JaroWinklerScore <= 0 {
		t.Errorf("expected positive JaroWinklerScore, got %.4f", result.JaroWinklerScore)
	}
	if result.LevenshteinScore <= 0 {
		t.Errorf("expected positive LevenshteinScore, got %.4f", result.LevenshteinScore)
	}
}

func TestScoreBoundedZeroToOne(t *testing.T) {
	s := newTestScreener()
	names := []string{"ACME ARMS LIMITED", "SUNRISE TRADING", "", "X", "GLOBAL CHEMICAL CORPORATION"}
	for _, name := range names {
		r := s.Screen(name)
		if r.Score < 0 || r.Score > 1.0 {
			t.Errorf("score out of bounds for %q: %.4f", name, r.Score)
		}
		if r.JaroWinklerScore < 0 || r.JaroWinklerScore > 1.0 {
			t.Errorf("JaroWinklerScore out of bounds for %q: %.4f", name, r.JaroWinklerScore)
		}
		if r.LevenshteinScore < 0 || r.LevenshteinScore > 1.0 {
			t.Errorf("LevenshteinScore out of bounds for %q: %.4f", name, r.LevenshteinScore)
		}
	}
}

// ─── Multi-list tests ─────────────────────────────────────────────────────────

func TestMultipleListsHit(t *testing.T) {
	s := newTestScreener()
	// Each entry is from a different list; verify we can hit all of them
	cases := []struct {
		name     string
		wantList screener.ListType
	}{
		{"ACME ARMS LIMITED", screener.ListOFAC},
		{"GLOBAL CHEMICAL CORPORATION", screener.ListUN},
		{"SHADOW TRADE LLC", screener.ListEU},
		{"DARK HARBOR SHIPPING", screener.ListHMT},
		{"RESTRICTED EXPORTS GMBH", screener.ListWCOCEN},
	}
	for _, tc := range cases {
		r := s.Screen(tc.name)
		if !r.Hit {
			t.Errorf("%q: expected hit on list %s, got score=%.4f", tc.name, tc.wantList, r.Score)
			continue
		}
		if r.MatchedEntry.ListType != tc.wantList {
			t.Errorf("%q: expected list %s, got %s", tc.name, tc.wantList, r.MatchedEntry.ListType)
		}
	}
}
