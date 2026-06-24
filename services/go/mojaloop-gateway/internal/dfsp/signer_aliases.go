// signer_aliases.go — exported aliases for Signer constructors used by cmd packages.
// These thin wrappers expose the internal helpers under the names expected by
// cmd/main.go, cmd/register-dfsp/main.go, and test files.
package dfsp

import (
	"os"
)

// NewSigner creates a Signer by loading the PEM key from the path given in the
// MOJALOOP_JWS_PRIVATE_KEY_PATH environment variable, falling back to an
// ephemeral key when the variable is unset (development / CI mode).
func NewSigner(dfspID string) (*Signer, error) {
	if path := os.Getenv("MOJALOOP_JWS_PRIVATE_KEY_PATH"); path != "" {
		return NewSignerFromFile(dfspID, path)
	}
	return NewEphemeralSigner(dfspID)
}

// NewSignerFromFile loads a PEM-encoded private key from disk and returns a
// Signer configured for the given DFSP ID.
func NewSignerFromFile(dfspID, path string) (*Signer, error) {
	pem, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return NewSignerFromPEM(dfspID, pem)
}

// NewEphemeralSigner generates a fresh EC P-256 key pair in memory.
// Suitable for tests and local development where no persistent key is needed.
func NewEphemeralSigner(dfspID string) (*Signer, error) {
	return newEphemeralSigner(dfspID)
}
