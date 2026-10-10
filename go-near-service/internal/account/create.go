package account

import (
	"context"
	"crypto/sha256"
	"fmt"
	"regexp"
	"strings"

	"github.com/uprail/near-service/internal/escrow"
	"github.com/uprail/near-service/internal/intents"
)

// subaccountLabelRe matches the label part of an allowed subaccount
// (e.g. "u_9f2c1a…", "alice"). No dots — single-level subaccounts only.
var subaccountLabelRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,62}$`)

// CreateAccountRequest specifies parameters for registering a passkey-controlled NEAR account.
type CreateAccountRequest struct {
	PublicKeyP256    string `json:"publicKeyP256"`
	PublicKeyHex     string `json:"publicKeyHex,omitempty"`
	DesiredAccountID string `json:"desiredAccountID"`
	XHandle          string `json:"xHandle,omitempty"`
	Deadline         string `json:"deadline,omitempty"`
}

// CreateAccountResult returns the confirmed or pending account ID and the intent hash.
type CreateAccountResult struct {
	NearAccountID string `json:"nearAccountID"`
	NearAccount   string `json:"nearAccount"`
	IntentHash    string `json:"intentHash"`
	TxHash        string `json:"txHash"`
	Status        string `json:"status"`
}

// Service manages NEAR account creation and passkey onboarding.
//
// Account creation is an allowlisted operation: it may only create
// single-level subaccounts of the configured parent accounts, and never
// touches platform accounts (escrow, fees, the parent itself).
type Service struct {
	signer         *escrow.Signer
	relay          *intents.RelayClient
	allowedParents []string
	deniedIDs      map[string]struct{}
}

// NewService constructs an account service.
func NewService(signer *escrow.Signer, relay *intents.RelayClient, allowedParents, deniedIDs []string) *Service {
	parents := make([]string, 0, len(allowedParents))
	for _, p := range allowedParents {
		if p = strings.ToLower(strings.TrimSpace(p)); p != "" {
			parents = append(parents, p)
		}
	}
	denied := make(map[string]struct{}, len(deniedIDs))
	for _, d := range deniedIDs {
		if d = strings.ToLower(strings.TrimSpace(d)); d != "" {
			denied[d] = struct{}{}
		}
	}
	return &Service{
		signer:         signer,
		relay:          relay,
		allowedParents: parents,
		deniedIDs:      denied,
	}
}

// CreateAccount builds, signs, and relays an add_public_key intent to register a P-256 WebAuthn passkey.
func (s *Service) CreateAccount(ctx context.Context, req CreateAccountRequest) (*CreateAccountResult, error) {
	pubKey := strings.TrimSpace(req.PublicKeyP256)
	if pubKey == "" {
		pubKey = strings.TrimSpace(req.PublicKeyHex)
	}
	if pubKey == "" {
		return nil, fmt.Errorf("create account: publicKeyP256 is required")
	}

	accountID := strings.TrimSpace(req.DesiredAccountID)
	if accountID == "" {
		hash := sha256.Sum256([]byte(pubKey))
		accountID = fmt.Sprintf("u_%x.%s", hash[:8], "uprail.near")
	}

	// Ensure P-256 key has proper prefix
	formattedKey := pubKey
	if !strings.HasPrefix(formattedKey, "p256:") {
		formattedKey = "p256:" + formattedKey
	}

	if err := s.validateDesiredAccountID(accountID); err != nil {
		return nil, err
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
		NearAccount:   accountID,
		IntentHash:    intentHash,
		TxHash:        intentHash,
		Status:        "PENDING",
	}, nil
}

// validateDesiredAccountID enforces the account-creation allowlist.
//
// Allowed: <label>.<parent> where <parent> is in AllowedAccountParents and
// <label> is a single-level subaccount label. Anything else — including every
// denied platform account — is rejected.
func (s *Service) validateDesiredAccountID(accountID string) error {
	clean := strings.ToLower(strings.TrimSpace(accountID))
	if clean == "" {
		return &escrow.ValidationError{Msg: "create account: desiredAccountID is required"}
	}
	if len(clean) > 64 {
		return &escrow.ValidationError{Msg: "create account: desiredAccountID is too long"}
	}
	if _, denied := s.deniedIDs[clean]; denied {
		return &escrow.ValidationError{Msg: "create account: that account may not be created here"}
	}

	dot := strings.LastIndex(clean, ".")
	if dot <= 0 || dot == len(clean)-1 {
		return &escrow.ValidationError{
			Msg: "create account: only subaccounts of the configured parents may be created",
		}
	}
	label, parent := clean[:dot], clean[dot+1:]

	allowed := false
	for _, p := range s.allowedParents {
		if parent == p {
			allowed = true
			break
		}
	}
	if !allowed {
		return &escrow.ValidationError{
			Msg: "create account: parent account is not in the allowlist",
		}
	}
	if !subaccountLabelRe.MatchString(label) {
		return &escrow.ValidationError{
			Msg: "create account: invalid subaccount label",
		}
	}
	return nil
}
