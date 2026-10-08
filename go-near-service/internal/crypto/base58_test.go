package crypto_test

import (
	"bytes"
	"testing"

	"github.com/uprail/near-service/internal/crypto"
)

func TestBase58EncodingDecoding(t *testing.T) {
	cases := []struct {
		name string
		raw  []byte
	}{
		{name: "empty", raw: []byte{}},
		{name: "hello world", raw: []byte("hello world")},
		{name: "32-byte seed", raw: bytes.Repeat([]byte{0x42}, 32)},
		{name: "64-byte key", raw: bytes.Repeat([]byte{0xab}, 64)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			encoded := crypto.Base58Encode(tc.raw)
			decoded, err := crypto.Base58Decode(encoded)
			if err != nil {
				t.Fatalf("unexpected error decoding base58: %v", err)
			}
			if !bytes.Equal(decoded, tc.raw) {
				t.Fatalf("roundtrip mismatch: got %x, want %x", decoded, tc.raw)
			}
		})
	}
}
