package account

import (
	"context"
	"fmt"
	"strings"

	"github.com/uprail/near-service/internal/escrow"
	"github.com/uprail/near-service/internal/intents"
)

// CreateAccountRequest specifies parameters for registering a passkey-controlled NEAR account.
type CreateAccountRequest struct {
	PublicKeyP256    string `json:"publicKeyP256"`
	DesiredAccountID string `json:"desiredAccountID"`
	Deadline         string `json:"deadline,omitempty"`
}

// CreateAccountResult returns the confirmed or pending account ID and the intent hash.
type CreateAccountResult struct {
	NearAccountID string `json:"nearAccountID"`
	IntentHash    string `json:"intentHash"`
	Status        string `json:"status"`
}

// Service manages NEAR account creation and passkey onboarding.
type Service struct {
	signer *escrow.Signer
	relay  *intents.RelayClient
}

// NewService constructs an account service.
func NewService(signer *escrow.Signer, relay *intents.RelayClient) *Service {
	return &Service{
		signer: signer,
		relay:  relay,
	}
}

// CreateAccount builds, signs, and relays an add_public_key intent to register a P-256 WebAuthn passkey.
func (s *Service) CreateAccount(ctx context.Context, req CreateAccountRequest) (*CreateAccountResult, error) {
	pubKey := strings.TrimSpace(req.PublicKeyP256)
	if pubKey == "" {
		return nil, fmt.Errorf("create account: publicKeyP256 is required")
	}

	accountID := strings.TrimSpace(req.DesiredAccountID)
	if accountID == "" {
		return nil, fmt.Errorf("create account: desiredAccountID is required")
	}

	// Ensure P-256 key has proper prefix
	formattedKey := pubKey
	if !strings.HasPrefix(formattedKey, "p256:") {
		formattedKey = "p256:" + formattedKey
	}

	// Build add_public_key intent for the desired account ID
	payload, err := intents.BuildAddPublicKeyIntent(accountID, formattedKey, req.Deadline)
	if err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}

	signedData, err := s.signer.Sign(*payload)
	if err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}

	intentHash, err := s.relay.PublishIntent(ctx, *signedData)
	if err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}

	return &CreateAccountResult{
		NearAccountID: accountID,
		IntentHash:    intentHash,
		Status:        "PENDING",
	}, nil
}
