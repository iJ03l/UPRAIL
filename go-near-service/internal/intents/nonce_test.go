package intents_test

import (
	"encoding/base64"
	"testing"

	"github.com/uprail/near-service/internal/intents"
)

func TestGenerateNonce(t *testing.T) {
	salt := []byte{0x01, 0x02, 0x03, 0x04}
	nonceStr, err := intents.GenerateNonce(salt)
	if err != nil {
		t.Fatalf("unexpected error generating nonce: %v", err)
	}

	raw, err := base64.StdEncoding.DecodeString(nonceStr)
	if err != nil {
		t.Fatalf("nonce is not valid base64: %v", err)
	}

	if len(raw) != 32 {
		t.Fatalf("expected 32 bytes, got %d", len(raw))
	}

	// Verify salt prefix
	if raw[0] != 0x01 || raw[1] != 0x02 || raw[2] != 0x03 || raw[3] != 0x04 {
		t.Fatalf("salt prefix mismatch in nonce")
	}
}
