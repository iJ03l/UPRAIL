package intents

import (
	"fmt"
	"strings"
	"time"
)

const (
	DefaultIntentDuration = 15 * time.Minute
)

// formatDeadline ensures a valid RFC3339 timestamp. If empty, generates a timestamp 15m in future.
func formatDeadline(deadline string) string {
	if strings.TrimSpace(deadline) != "" {
		return deadline
	}
	return time.Now().UTC().Add(DefaultIntentDuration).Format(time.RFC3339)
}

// BuildTransferIntent constructs an IntentPayload containing a token transfer intent.
func BuildTransferIntent(signerID, token, amount, to, deadline string) (*IntentPayload, error) {
	if strings.TrimSpace(signerID) == "" {
		return nil, fmt.Errorf("build transfer intent: signerID is required")
	}
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("build transfer intent: token is required")
	}
	if strings.TrimSpace(amount) == "" {
		return nil, fmt.Errorf("build transfer intent: amount is required")
	}
	if strings.TrimSpace(to) == "" {
		return nil, fmt.Errorf("build transfer intent: recipient 'to' is required")
	}

	nonce, err := GenerateNonce(nil)
	if err != nil {
		return nil, fmt.Errorf("build transfer intent: %w", err)
	}

	return &IntentPayload{
		SignerID:          signerID,
		VerifyingContract: DefaultVerifyingContract,
		Deadline:          formatDeadline(deadline),
		Nonce:             nonce,
		Intents: []any{
			TransferIntent{
				Intent:     "transfer",
				Token:      token,
				Amount:     amount,
				To:         to,
				ReceiverID: to,
			},
		},
	}, nil
}

// BuildTokenDiffIntent constructs an IntentPayload containing a token diff intent.
func BuildTokenDiffIntent(signerID string, diff map[string]string, deadline string) (*IntentPayload, error) {
	if strings.TrimSpace(signerID) == "" {
		return nil, fmt.Errorf("build token diff intent: signerID is required")
	}
	if len(diff) == 0 {
		return nil, fmt.Errorf("build token diff intent: diff map cannot be empty")
	}

	nonce, err := GenerateNonce(nil)
	if err != nil {
		return nil, fmt.Errorf("build token diff intent: %w", err)
	}

	return &IntentPayload{
		SignerID:          signerID,
		VerifyingContract: DefaultVerifyingContract,
		Deadline:          formatDeadline(deadline),
		Nonce:             nonce,
		Intents: []any{
			TokenDiffIntent{
				Intent: "token_diff",
				Diff:   diff,
			},
		},
	}, nil
}

// BuildAddPublicKeyIntent constructs an IntentPayload to register a public key (e.g. WebAuthn P-256).
func BuildAddPublicKeyIntent(signerID, publicKey, deadline string) (*IntentPayload, error) {
	if strings.TrimSpace(signerID) == "" {
		return nil, fmt.Errorf("build add public key intent: signerID is required")
	}
	if strings.TrimSpace(publicKey) == "" {
		return nil, fmt.Errorf("build add public key intent: publicKey is required")
	}

	nonce, err := GenerateNonce(nil)
	if err != nil {
		return nil, fmt.Errorf("build add public key intent: %w", err)
	}

	return &IntentPayload{
		SignerID:          signerID,
		VerifyingContract: DefaultVerifyingContract,
		Deadline:          formatDeadline(deadline),
		Nonce:             nonce,
		Intents: []any{
			AddPublicKeyIntent{
				Intent:    "add_public_key",
				PublicKey: publicKey,
			},
		},
	}, nil
}

// BuildFtWithdrawIntent constructs an IntentPayload to withdraw fungible tokens to an external NEAR account.
func BuildFtWithdrawIntent(signerID, token, amount, receiverID, deadline string) (*IntentPayload, error) {
	if strings.TrimSpace(signerID) == "" {
		return nil, fmt.Errorf("build ft withdraw intent: signerID is required")
	}
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("build ft withdraw intent: token is required")
	}
	if strings.TrimSpace(amount) == "" {
		return nil, fmt.Errorf("build ft withdraw intent: amount is required")
	}
	if strings.TrimSpace(receiverID) == "" {
		return nil, fmt.Errorf("build ft withdraw intent: receiverID is required")
	}

	nonce, err := GenerateNonce(nil)
	if err != nil {
		return nil, fmt.Errorf("build ft withdraw intent: %w", err)
	}

	return &IntentPayload{
		SignerID:          signerID,
		VerifyingContract: DefaultVerifyingContract,
		Deadline:          formatDeadline(deadline),
		Nonce:             nonce,
		Intents: []any{
			FtWithdrawIntent{
				Intent:     "ft_withdraw",
				Token:      token,
				Amount:     amount,
				ReceiverID: receiverID,
			},
		},
	}, nil
}
