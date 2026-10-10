package escrow

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/uprail/near-service/internal/crypto"
	"github.com/uprail/near-service/internal/intents"
)

// Signer manages ed25519 cryptographic signing for the escrow account.
// Private key material is never logged or exposed.
type Signer struct {
	accountID  string
	publicKey  ed25519.PublicKey
	privateKey ed25519.PrivateKey
}

// NewSigner parses an ed25519 private key from base58 or hex format and binds it to accountID.
// Supports 32-byte seeds, 64-byte private keys, and post-quantum ML-DSA master keys (>64 bytes).
func NewSigner(privateKeyStr, accountID string) (*Signer, error) {
	cleanKey := strings.TrimSpace(privateKeyStr)
	if idx := strings.Index(cleanKey, ":"); idx != -1 {
		cleanKey = cleanKey[idx+1:]
	}

	var keyBytes []byte
	var err error

	// Try base58 decoding first (standard NEAR format)
	keyBytes, err = crypto.Base58Decode(cleanKey)
	if err != nil || len(keyBytes) < 32 {
		// Fallback to hex decoding
		var hexErr error
		keyBytes, hexErr = hex.DecodeString(cleanKey)
		if hexErr != nil || len(keyBytes) < 32 {
			return nil, fmt.Errorf("new signer: invalid private key format (must be at least 32 bytes base58/hex)")
		}
	}

	var privKey ed25519.PrivateKey
	var pubKey ed25519.PublicKey

	switch {
	case len(keyBytes) == 32:
		privKey = ed25519.NewKeyFromSeed(keyBytes)
		pubKey = privKey.Public().(ed25519.PublicKey)
	case len(keyBytes) == 64:
		privKey = ed25519.PrivateKey(keyBytes)
		pubKey = privKey.Public().(ed25519.PublicKey)
	case len(keyBytes) > 64:
		// For master post-quantum keys (e.g. ML-DSA-65), derive the Ed25519 root
		// signer from the first 32 bytes seed, exactly matching nearRpc.deriveUserNearKeypair.
		privKey = ed25519.NewKeyFromSeed(keyBytes[:32])
		pubKey = privKey.Public().(ed25519.PublicKey)
	default:
		return nil, fmt.Errorf("new signer: unexpected key length of %d bytes", len(keyBytes))
	}

	return &Signer{
		accountID:  accountID,
		publicKey:  pubKey,
		privateKey: privKey,
	}, nil
}

// AccountID returns the associated NEAR account ID for this signer.
func (s *Signer) AccountID() string {
	return s.accountID
}

// PublicKey returns the formatted public key "ed25519:<base58_encoded>".
func (s *Signer) PublicKey() string {
	return "ed25519:" + crypto.Base58Encode(s.publicKey)
}

// Sign signs an IntentPayload and returns a NEP-413 SignedData structure.
func (s *Signer) Sign(payload intents.IntentPayload) (*intents.SignedData, error) {
	// Canonical JSON serialization of the payload
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("sign: marshal payload: %w", err)
	}

	// Sign payload directly using ed25519
	signatureBytes := ed25519.Sign(s.privateKey, payloadBytes)
	sigBase58 := "ed25519:" + crypto.Base58Encode(signatureBytes)

	return &intents.SignedData{
		Standard:  intents.StandardNep413,
		Payload:   payload,
		PublicKey: s.PublicKey(),
		Signature: sigBase58,
	}, nil
}
