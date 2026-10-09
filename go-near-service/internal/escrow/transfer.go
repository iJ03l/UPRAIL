package escrow

import (
	"context"
	"fmt"
	"strings"

	"github.com/uprail/near-service/internal/intents"
)

// TransferRequest specifies the destination, asset, and quantity for a confidential escrow transfer.
type TransferRequest struct {
	Recipient            string `json:"recipient"`
	RecipientNearAccount string `json:"recipientNearAccount,omitempty"`
	Asset                string `json:"asset"`
	Amount               string `json:"amount"`
	Deadline             string `json:"deadline,omitempty"`
}

// TransferResult contains the result of publishing the transfer intent.
type TransferResult struct {
	IntentHash string `json:"intentHash"`
	TxHash     string `json:"txHash"`
	Status     string `json:"status"`
}

// TransferService executes transfers from the escrow account to recipients.
type TransferService struct {
	signer *Signer
	relay  *intents.RelayClient
}

// NewTransferService constructs a TransferService.
func NewTransferService(signer *Signer, relay *intents.RelayClient) *TransferService {
	return &TransferService{
		signer: signer,
		relay:  relay,
	}
}

// Transfer builds, signs, and relays a confidential transfer intent from the escrow account.
func (s *TransferService) Transfer(ctx context.Context, req TransferRequest) (*TransferResult, error) {
	recipient := strings.TrimSpace(req.Recipient)
	if recipient == "" {
		recipient = strings.TrimSpace(req.RecipientNearAccount)
	}
	if recipient == "" {
		return nil, fmt.Errorf("transfer: recipient is required")
	}
	if strings.TrimSpace(req.Asset) == "" {
		return nil, fmt.Errorf("transfer: asset is required")
	}
	if strings.TrimSpace(req.Amount) == "" {
		return nil, fmt.Errorf("transfer: amount is required")
	}

	payload, err := intents.BuildTransferIntent(
		s.signer.AccountID(),
		req.Asset,
		req.Amount,
		recipient,
		req.Deadline,
	)
	if err != nil {
		return nil, fmt.Errorf("transfer: %w", err)
	}

	signedData, err := s.signer.Sign(*payload)
	if err != nil {
		return nil, fmt.Errorf("transfer: %w", err)
	}

	intentHash, err := s.relay.PublishIntent(ctx, *signedData)
	if err != nil {
		return nil, fmt.Errorf("transfer: %w", err)
	}

	return &TransferResult{
		IntentHash: intentHash,
		TxHash:     intentHash,
		Status:     "SUBMITTED",
	}, nil
}
