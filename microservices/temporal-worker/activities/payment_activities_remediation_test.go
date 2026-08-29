package activities

import (
	"math"
	"testing"
)

// SW-S2-9: amount conversion at activity boundaries must reject
// NaN/negative/overflow instead of silently truncating/wrapping.
func TestMinorUnitsGuards(t *testing.T) {
	if v, err := minorUnits(0.29); err != nil || v != 29 {
		t.Fatalf("minorUnits(0.29) = %d, %v; want 29, nil", v, err)
	}
	for _, bad := range []float64{0, -100, math.NaN(), math.Inf(1), math.Inf(-1), 1e15} {
		if _, err := minorUnits(bad); err == nil {
			t.Errorf("minorUnits(%v) should fail", bad)
		}
	}
}

// SW-S2-9: GenerateILPComponents must not wrap a bad amount into the packet.
func TestGenerateILPComponentsAmountGuard(t *testing.T) {
	if _, _, _, err := GenerateILPComponents(0, "dest"); err == nil {
		t.Fatal("zero amount accepted")
	}
	if _, _, _, err := GenerateILPComponents(-5, "dest"); err == nil {
		t.Fatal("negative amount accepted (would wrap into uint64 packet)")
	}
	if _, _, _, err := GenerateILPComponents(maxMinorUnits+1, "dest"); err == nil {
		t.Fatal("overflow amount accepted")
	}
	pkt, cond, ful, err := GenerateILPComponents(29, "g.ng.customs.revenue.ngn")
	if err != nil || pkt == "" || cond == "" || ful == "" {
		t.Fatalf("valid amount failed: %v", err)
	}
}
