// verify.go — RS256 signature verification using standard library crypto.
package keycloak

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// verifySignature verifies an RS256 JWT signature.
// signingInput is the raw bytes of "header.payload".
// sigB64 is the base64url-encoded signature from the JWT third part.
func verifySignature(signingInput []byte, sigB64 string, pub *rsa.PublicKey) error {
	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}
	digest := sha256.Sum256(signingInput)
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], sig); err != nil {
		return fmt.Errorf("RS256 verification: %w", err)
	}
	return nil
}

// signRS256 signs data with RS256 (used in tests only).
func signRS256(data []byte, priv *rsa.PrivateKey) (string, error) {
	digest := sha256.Sum256(data)
	sig, err := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(sig), nil
}
