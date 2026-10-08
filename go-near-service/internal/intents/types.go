package intents

import "encoding/json"

// StandardNep413 identifies the NEP-413 signature standard used for intents.
const (
	StandardNep413           = "nep413"
	DefaultVerifyingContract = "intents.near"
)

// IntentPayload represents the structured payload containing intents to be signed.
type IntentPayload struct {
	SignerID          string `json:"signer_id"`
	VerifyingContract string `json:"verifying_contract"`
	Deadline          string `json:"deadline"`
	Nonce             string `json:"nonce"`
	Intents           []any  `json:"intents"`
}

// TransferIntent transfers tokens to a recipient NEAR account.
type TransferIntent struct {
	Intent     string `json:"intent"` // "transfer"
	Token      string `json:"token"`
	Amount     string `json:"amount"`
	To         string `json:"to"`
	ReceiverID string `json:"receiver_id,omitempty"`
}

// TokenDiffIntent describes a balance delta on the intent contract.
type TokenDiffIntent struct {
	Intent string            `json:"intent"` // "token_diff"
	Diff   map[string]string `json:"diff"`
}

// AddPublicKeyIntent adds a public key (such as a WebAuthn P-256 passkey) to an account.
type AddPublicKeyIntent struct {
	Intent    string `json:"intent"` // "add_public_key"
	PublicKey string `json:"public_key"`
}

// FtWithdrawIntent withdraws fungible tokens from the intents contract to an on-chain account.
type FtWithdrawIntent struct {
	Intent     string `json:"intent"` // "ft_withdraw"
	Token      string `json:"token"`
	Amount     string `json:"amount"`
	ReceiverID string `json:"receiver_id"`
}

// SignedData holds the payload alongside its cryptographic signature and public key.
type SignedData struct {
	Standard  string `json:"standard"`
	Payload   any    `json:"payload"`
	PublicKey string `json:"public_key"`
	Signature string `json:"signature"`
}

// MarshalJSON ensures both snake_case and camelCase compatibility for JSON-RPC solvers.
func (s SignedData) MarshalJSON() ([]byte, error) {
	type Alias SignedData
	return json.Marshal(&struct {
		Alias
		PublicKeyCamel string `json:"publicKey"`
	}{
		Alias:          Alias(s),
		PublicKeyCamel: s.PublicKey,
	})
}
