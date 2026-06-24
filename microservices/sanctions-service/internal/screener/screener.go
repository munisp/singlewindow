// Package screener implements sanctions list screening for TradeGateway NGSWTP.
//
// Screening algorithm:
//   - Normalise: lowercase, strip punctuation/diacritics, collapse whitespace
//   - Exact match: instant hit at score 1.0
//   - Jaro-Winkler similarity (primary): industry standard for name matching
//   - Levenshtein distance (secondary): catches transpositions and OCR errors
//   - Combined score = 0.7 * JaroWinkler + 0.3 * (1 - normalised_levenshtein)
//   - Configurable threshold (default 0.85)
//
// Lists supported:
//   - OFAC SDN (US Treasury)
//   - UN Security Council Consolidated List
//   - EU Consolidated Sanctions List
//   - HM Treasury (UK)
//   - WCO CEN (Customs Enforcement Network)
//
// In production, lists are loaded from OpenCTI/OFAC API on startup and
// refreshed every 6 hours via a background goroutine.
package screener

import (
	"math"
	"strings"
	"unicode"
)

// ListType identifies the sanctions list that produced a hit.
type ListType string

const (
	ListOFAC   ListType = "OFAC-SDN"
	ListUN     ListType = "UN-SC"
	ListEU     ListType = "EU-CONS"
	ListHMT    ListType = "HMT-UK"
	ListWCOCEN ListType = "WCO-CEN"
)

// Entry is a single entry in a sanctions list.
type Entry struct {
	ID       string
	Name     string
	Aliases  []string
	ListType ListType
	// EntityType: "individual" | "entity" | "vessel" | "aircraft"
	EntityType string
	// Country of registration/nationality (ISO-3166-1 alpha-2)
	Country string
}

// ScreenResult is the result of a sanctions screening check.
type ScreenResult struct {
	// Hit is true when the combined score meets or exceeds the threshold.
	Hit bool
	// Score is the combined Jaro-Winkler + Levenshtein score (0-1).
	Score float64
	// MatchedEntry is the entry that triggered the hit (nil if no hit).
	MatchedEntry *Entry
	// MatchedName is the specific name/alias that matched.
	MatchedName string
	// JaroWinklerScore is the raw Jaro-Winkler component.
	JaroWinklerScore float64
	// LevenshteinScore is the normalised Levenshtein component (1 - normalised_distance).
	LevenshteinScore float64
}

// Screener holds a set of sanctions lists and a match threshold.
type Screener struct {
	Entries   []Entry
	Threshold float64
}

// New creates a Screener with the given entries and threshold.
// If threshold is 0, the default of 0.85 is used.
func New(entries []Entry, threshold float64) *Screener {
	if threshold == 0 {
		threshold = 0.85
	}
	return &Screener{Entries: entries, Threshold: threshold}
}

// Screen checks a single name against all loaded sanctions lists.
// It returns the highest-scoring result found. If no entry meets the
// threshold, Hit is false and Score reflects the best near-miss.
func (s *Screener) Screen(name string) ScreenResult {
	normalized := normalize(name)
	best := ScreenResult{}

	for i := range s.Entries {
		entry := &s.Entries[i]
		// Check primary name
		if result := s.checkName(normalized, entry.Name, entry); result.Score > best.Score {
			best = result
		}
		// Check all aliases
		for _, alias := range entry.Aliases {
			if result := s.checkName(normalized, alias, entry); result.Score > best.Score {
				best = result
			}
		}
	}

	best.Hit = best.Score >= s.Threshold
	return best
}

// ScreenBatch screens multiple names and returns a result for each.
func (s *Screener) ScreenBatch(names []string) []ScreenResult {
	results := make([]ScreenResult, len(names))
	for i, name := range names {
		results[i] = s.Screen(name)
	}
	return results
}

// checkName computes the combined score between the query and a single candidate name.
func (s *Screener) checkName(normalizedQuery, candidateName string, entry *Entry) ScreenResult {
	normalizedCandidate := normalize(candidateName)

	// Fast path: exact match
	if normalizedQuery == normalizedCandidate {
		return ScreenResult{
			Score:            1.0,
			MatchedEntry:     entry,
			MatchedName:      candidateName,
			JaroWinklerScore: 1.0,
			LevenshteinScore: 1.0,
		}
	}

	jw := jaroWinkler(normalizedQuery, normalizedCandidate)
	lev := normalizedLevenshtein(normalizedQuery, normalizedCandidate)
	combined := 0.7*jw + 0.3*lev

	return ScreenResult{
		Score:            combined,
		MatchedEntry:     entry,
		MatchedName:      candidateName,
		JaroWinklerScore: jw,
		LevenshteinScore: lev,
	}
}

// ─── Normalisation ────────────────────────────────────────────────────────────

// normalize lowercases the string, strips punctuation, diacritics, and
// collapses all whitespace to a single space, then trims.
func normalize(s string) string {
	var b strings.Builder
	prevSpace := false
	for _, r := range strings.ToLower(s) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevSpace = false
		case unicode.IsSpace(r) || r == '-' || r == '_':
			if !prevSpace && b.Len() > 0 {
				b.WriteRune(' ')
				prevSpace = true
			}
		// strip all other punctuation and diacritics
		}
	}
	return strings.TrimRight(b.String(), " ")
}

// ─── Jaro-Winkler ─────────────────────────────────────────────────────────────

// jaro computes the Jaro similarity between two strings.
func jaro(s1, s2 string) float64 {
	if s1 == s2 {
		return 1.0
	}
	r1 := []rune(s1)
	r2 := []rune(s2)
	l1, l2 := len(r1), len(r2)
	if l1 == 0 || l2 == 0 {
		return 0.0
	}

	matchDist := int(math.Max(float64(l1), float64(l2))/2.0) - 1
	if matchDist < 0 {
		matchDist = 0
	}

	matched1 := make([]bool, l1)
	matched2 := make([]bool, l2)

	matches := 0
	transpositions := 0

	for i := 0; i < l1; i++ {
		start := int(math.Max(0, float64(i-matchDist)))
		end := int(math.Min(float64(l2-1), float64(i+matchDist)))
		for j := start; j <= end; j++ {
			if matched2[j] || r1[i] != r2[j] {
				continue
			}
			matched1[i] = true
			matched2[j] = true
			matches++
			break
		}
	}

	if matches == 0 {
		return 0.0
	}

	k := 0
	for i := 0; i < l1; i++ {
		if !matched1[i] {
			continue
		}
		for !matched2[k] {
			k++
		}
		if r1[i] != r2[k] {
			transpositions++
		}
		k++
	}

	m := float64(matches)
	return (m/float64(l1) + m/float64(l2) + (m-float64(transpositions)/2.0)/m) / 3.0
}

// jaroWinkler extends Jaro with a prefix bonus (p = 0.1, max prefix = 4).
func jaroWinkler(s1, s2 string) float64 {
	j := jaro(s1, s2)
	if j < 0.7 {
		return j
	}

	r1 := []rune(s1)
	r2 := []rune(s2)
	prefixLen := 0
	maxPrefix := int(math.Min(4, math.Min(float64(len(r1)), float64(len(r2)))))
	for i := 0; i < maxPrefix; i++ {
		if r1[i] == r2[i] {
			prefixLen++
		} else {
			break
		}
	}

	return j + float64(prefixLen)*0.1*(1.0-j)
}

// ─── Levenshtein ──────────────────────────────────────────────────────────────

// levenshtein computes the edit distance between two strings.
func levenshtein(s1, s2 string) int {
	r1 := []rune(s1)
	r2 := []rune(s2)
	l1, l2 := len(r1), len(r2)

	if l1 == 0 {
		return l2
	}
	if l2 == 0 {
		return l1
	}

	// Use two-row DP to save memory
	prev := make([]int, l2+1)
	curr := make([]int, l2+1)
	for j := 0; j <= l2; j++ {
		prev[j] = j
	}

	for i := 1; i <= l1; i++ {
		curr[0] = i
		for j := 1; j <= l2; j++ {
			cost := 1
			if r1[i-1] == r2[j-1] {
				cost = 0
			}
			curr[j] = min3(curr[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev, curr = curr, prev
	}
	return prev[l2]
}

// normalizedLevenshtein returns 1 - (edit_distance / max_len), so 1.0 = identical.
func normalizedLevenshtein(s1, s2 string) float64 {
	maxLen := math.Max(float64(len([]rune(s1))), float64(len([]rune(s2))))
	if maxLen == 0 {
		return 1.0
	}
	dist := levenshtein(s1, s2)
	return 1.0 - float64(dist)/maxLen
}

func min3(a, b, c int) int {
	if a < b {
		if a < c {
			return a
		}
		return c
	}
	if b < c {
		return b
	}
	return c
}
