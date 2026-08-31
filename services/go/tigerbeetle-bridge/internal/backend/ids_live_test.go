//go:build tigerbeetle

// Unit tests for the ID conversion helpers and the v0.17.9 result-contract
// handling. These need no live cluster (CGO only for the client package).
package backend

import (
	"strings"
	"testing"

	tb "github.com/tigerbeetle/tigerbeetle-go"
)

func TestHexToUint128Forms(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    uint64 // expected low 64 bits
		wantHi  bool   // expect upper 64 bits set
		wantErr bool
	}{
		{"16-char hex standard account", "0000000000000001", 1, false, false},
		{"0x-prefixed hex", "0x00000000000000ff", 255, false, false},
		{"digit-only string parses as hex (documented precedence)", "42", 0x42, false, false},
		{"32-char hex (full 128-bit)", "f47ac10b58cc4372a5670e02b2c3d479", 0xa5670e02b2c3d479, true, false},
		{"uuid form", "f47ac10b-58cc-4372-a567-0e02b2c3d479", 0xa5670e02b2c3d479, true, false},
		{"empty", "", 0, false, true},
		{"too long", strings.Repeat("a", 33), 0, false, true},
		{"non-numeric", "not-an-id", 0, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u, err := hexToUint128(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("hexToUint128(%q): expected error", tc.in)
				}
				return
			}
			if err != nil {
				t.Fatalf("hexToUint128(%q): %v", tc.in, err)
			}
			bi := u.BigInt()
			if bi.Uint64() != tc.want {
				t.Fatalf("hexToUint128(%q) low64 = %#x, want %#x", tc.in, bi.Uint64(), tc.want)
			}
			if gotHi := bi.BitLen() > 64; gotHi != tc.wantHi {
				t.Fatalf("hexToUint128(%q) upper-bits-set = %v, want %v", tc.in, gotHi, tc.wantHi)
			}
		})
	}
}

func TestUint128ToHexRoundTrip(t *testing.T) {
	// 16-char standard ids keep their format.
	u1, err := hexToUint128("0000000000000001")
	if err != nil {
		t.Fatal(err)
	}
	if got := uint128ToHex(u1); got != "0000000000000001" {
		t.Fatalf("uint128ToHex standard id = %q", got)
	}
	// uuid-derived ids round-trip to 32-char hex (dasherless).
	u2, err := hexToUint128("f47ac10b-58cc-4372-a567-0e02b2c3d479")
	if err != nil {
		t.Fatal(err)
	}
	if got := uint128ToHex(u2); got != "f47ac10b58cc4372a5670e02b2c3d479" {
		t.Fatalf("uint128ToHex uuid id = %q", got)
	}
	// canonicalID maps every accepted spelling to one key.
	if canonicalID("f47ac10b-58cc-4372-a567-0e02b2c3d479") != canonicalID("f47ac10b58cc4372a5670e02b2c3d479") {
		t.Fatal("canonicalID must normalize uuid and hex spellings to the same key")
	}
	if canonicalID("0000000000000001") != "0000000000000001" {
		t.Fatal("canonicalID must preserve the standard account format")
	}
}

// TestV017SuccessContractPins — compile-time + value pins for the v0.17.9
// contract: success results are included in CreateTransfers/CreateAccounts
// result sets with the 0xFFFFFFFF sentinel status.
func TestV017SuccessContractPins(t *testing.T) {
	if tb.TransferCreated != 0xFFFFFFFF {
		t.Fatalf("TransferCreated sentinel changed: %#x", uint32(tb.TransferCreated))
	}
	if tb.AccountCreated != 0xFFFFFFFF {
		t.Fatalf("AccountCreated sentinel changed: %#x", uint32(tb.AccountCreated))
	}
	// The success sentinels must be distinct from the idempotent-exists and
	// error statuses so the accept logic cannot conflate them.
	if tb.TransferCreated == tb.TransferExists {
		t.Fatal("TransferCreated must differ from TransferExists")
	}
	if tb.AccountCreated == tb.AccountExists {
		t.Fatal("AccountCreated must differ from AccountExists")
	}
}
