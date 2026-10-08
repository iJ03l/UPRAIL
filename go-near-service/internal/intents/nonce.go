package intents

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

// NonceSize is the required 32-byte length for NEP-413 intent nonces.
const NonceSize = 32

// GenerateNonce creates a 32-byte base64-encoded nonce composed of a 4-byte contract salt
// and 28 bytes of cryptographically secure random data.
func GenerateNonce(contractSalt []byte) (string, error) {
	nonceBytes := make([]byte, NonceSize)

	// Fill the first 4 bytes with contract salt (if provided)
	if len(contractSalt) > 0 {
		copyLen := 4
		if len(contractSalt) < copyLen {
			copyLen = len(contractSalt)
		}
		copy(nonceBytes[:copyLen], contractSalt[:copyLen])
	}

	// Generate 28 bytes of random data for the remainder
	if _, err := rand.Read(nonceBytes[4:]); err != nil {
		return "", fmt.Errorf("generate random nonce bytes: %w", err)
	}

	return base64.StdEncoding.EncodeToString(nonceBytes), nil
}
