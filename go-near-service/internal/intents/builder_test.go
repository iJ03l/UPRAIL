package intents_test

import (
	"testing"

	"github.com/uprail/near-service/internal/intents"
)

func TestBuildTransferIntent(t *testing.T) {
	payload, err := intents.BuildTransferIntent("escrow.uprail.near", "wrap.near", "1000000000000000000000000", "alice.near", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if payload.SignerID != "escrow.uprail.near" {
		t.Errorf("expected signer escrow.uprail.near, got %s", payload.SignerID)
	}
	if payload.VerifyingContract != "intents.near" {
		t.Errorf("expected verifying contract intents.near, got %s", payload.VerifyingContract)
	}
	if len(payload.Intents) != 1 {
		t.Fatalf("expected 1 intent action, got %d", len(payload.Intents))
	}
}

func TestBuildAddPublicKeyIntent(t *testing.T) {
	payload, err := intents.BuildAddPublicKeyIntent("escrow.uprail.near", "p256:7v8Q...", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if payload.SignerID != "escrow.uprail.near" {
		t.Errorf("expected signer escrow.uprail.near, got %s", payload.SignerID)
	}
	if len(payload.Intents) != 1 {
		t.Fatalf("expected 1 intent, got %d", len(payload.Intents))
	}
}
