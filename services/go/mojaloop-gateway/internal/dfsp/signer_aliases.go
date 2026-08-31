// signer_aliases.go — exported aliases for Signer constructors used by cmd packages.
// These thin wrappers expose the internal helpers under the names expected by
// cmd/main.go, cmd/register-dfsp/main.go, and test files.
package dfsp

import (
	"os"
)

// NOTE: NewSigner lives in jws.go (constructor used by cmd/main.go with the
// logger parameter). It was previously ALSO declared here with a different
// signature — a duplicate declaration that broke the package build. Only the
// file/ephemeral helpers below remain in this file.

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
