package escrow_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"

	"github.com/uprail/near-service/internal/crypto"
	"github.com/uprail/near-service/internal/escrow"
	"github.com/uprail/near-service/internal/intents"
)

func TestSignerLifecycle(t *testing.T) {
	// Generate random 32-byte seed
	seed := make([]byte, 32)
	_, _ = rand.Read(seed)

	privKey := ed25519.NewKeyFromSeed(seed)
	base58Priv := crypto.Base58Encode(privKey)

	signer, err := escrow.NewSigner(base58Priv, "escrow.uprail.near")
	if err != nil {
		t.Fatalf("unexpected error initializing signer: %v", err)
	}

	if signer.AccountID() != "escrow.uprail.near" {
		t.Errorf("expected escrow.uprail.near, got %s", signer.AccountID())
	}

	payload, err := intents.BuildTransferIntent("escrow.uprail.near", "wrap.near", "100", "bob.near", "")
	if err != nil {
		t.Fatalf("failed to build intent: %v", err)
	}

	signedData, err := signer.Sign(*payload)
	if err != nil {
		t.Fatalf("failed to sign payload: %v", err)
	}

	if signedData.Standard != "nep413" {
		t.Errorf("expected standard nep413, got %s", signedData.Standard)
	}
	if signedData.PublicKey != signer.PublicKey() {
		t.Errorf("public key mismatch")
	}
}

func TestSignerWithPostQuantumMasterKey(t *testing.T) {
	// 4032 bytes master key (ML-DSA-65 format)
	largeKey := make([]byte, 4032)
	for i := range largeKey {
		largeKey[i] = byte(i % 251)
	}
	b58Key := "ml-dsa-65:" + crypto.Base58Encode(largeKey)

	signer, err := escrow.NewSigner(b58Key, "escrow.uprail.near")
	if err != nil {
		t.Fatalf("unexpected error initializing signer with ML-DSA master key: %v", err)
	}

	expectedRootPriv := ed25519.NewKeyFromSeed(largeKey[:32])
	expectedPub := "ed25519:" + crypto.Base58Encode(expectedRootPriv.Public().(ed25519.PublicKey))

	if signer.PublicKey() != expectedPub {
		t.Errorf("expected public key %s, got %s", expectedPub, signer.PublicKey())
	}
}
