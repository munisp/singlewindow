// Phase-6 regression tests for SW-S2-5 (rustfs-svc auth + key scoping).
// Run with: RUSTFS_ACCESS_KEY=test RUSTFS_SECRET_KEY=test go test ./...
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScopedKeyPrefixesCallerNamespace(t *testing.T) {
	got, err := scopedKey("trpc-backend/", "vault/42/doc.pdf")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "trpc-backend/vault/42/doc.pdf" {
		t.Fatalf("expected namespaced key, got %q", got)
	}
}

func TestScopedKeyIdempotentOnPrefixedKey(t *testing.T) {
	got, err := scopedKey("trpc-backend/", "trpc-backend/vault/42/doc.pdf")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "trpc-backend/vault/42/doc.pdf" {
		t.Fatalf("double-prefix detected: %q", got)
	}
}

func TestScopedKeyRejectsTraversal(t *testing.T) {
	for _, bad := range []string{"../secrets/x", "vault/../../etc/passwd", "/../x"} {
		if _, err := scopedKey("trpc-backend/", bad); err == nil {
			t.Fatalf("expected traversal rejection for %q", bad)
		}
	}
}

func TestScopedKeyRejectsEmpty(t *testing.T) {
	if _, err := scopedKey("trpc-backend/", "  "); err == nil {
		t.Fatal("expected empty key rejection")
	}
}

func TestCallerPrefixSanitises(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/download/x", nil)
	req.Header.Set("X-Rustfs-Caller", "trpc backend/../../evil")
	prefix, err := callerPrefix(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// sanitiser replaces '/' and other unsafe chars; '..' inside a single
	// segment is harmless once the segment cannot be a path separator
	for _, c := range []string{"/", "\\"} {
		if contains(prefix[:len(prefix)-1], c) {
			t.Fatalf("prefix contains path separator: %q", prefix)
		}
	}
}

func TestCallerPrefixMissing(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/download/x", nil)
	if _, err := callerPrefix(req); err == nil {
		t.Fatal("expected error when X-Rustfs-Caller is missing")
	}
}

func contains(s string, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}

func TestRequireServiceToken(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	h := requireServiceToken(ok)

	// No token → 401
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/upload", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", rec.Code)
	}

	// Wrong token → 401
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/upload", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with wrong token, got %d", rec.Code)
	}

	// Correct token → pass through (dev token in non-production test env)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/upload", nil)
	req.Header.Set("Authorization", "Bearer "+serviceToken)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 with valid token, got %d", rec.Code)
	}

	// /health is public for probes
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected /health to be public, got %d", rec.Code)
	}
}
