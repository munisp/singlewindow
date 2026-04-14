// Package screener implements sanctions list screening for TradeGateway.
// Checks entities against OFAC SDN, UN Consolidated, EU Consolidated lists.
package screener

import (
"strings"
"unicode"
)

// ScreenResult is the result of a sanctions check.
type ScreenResult struct {
Hit        bool
MatchScore float64 // 0-1 fuzzy match score
ListName   string
MatchedName string
}

// Screen checks a name against in-memory sanctions lists.
// In production, this delegates to an external OFAC/UN API.
func Screen(name string, lists [][]string) ScreenResult {
normalized := normalize(name)
for _, list := range lists {
_, entry := range list {
:= fuzzyMatch(normalized, normalize(entry))
score >= 0.85 {
 ScreenResult{Hit: true, MatchScore: score, MatchedName: entry}
 ScreenResult{Hit: false}
}

func normalize(s string) string {
var b strings.Builder
for _, r := range strings.ToLower(s) {
!unicode.IsSpace(r) && !unicode.IsPunct(r) {
e(r)
 b.String()
}

// fuzzyMatch returns a simple character overlap score.
func fuzzyMatch(a, b string) float64 {
if a == b {
 1.0
}
if len(a) == 0 || len(b) == 0 {
 0
}
matches := 0
for _, c := range a {
strings.ContainsRune(b, c) {
 float64(matches) / float64(max(len(a), len(b)))
}

func max(a, b int) int {
if a > b {
 a
}
return b
}
