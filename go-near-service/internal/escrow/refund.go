package escrow

import (
	"context"
	"fmt"
	"strings"

	"github.com/uprail/near-service/internal/intents"
)

// RefundRequest specifies the sender to refund, along with asset and quantity.
type RefundRequest struct {
	RefundTo          string `json:"refundTo"`
	SenderNearAccount string `json:"senderNearAccount,omitempty"`
	Asset             string `json:"asset"`
	Amount            string `json:"amount"`
	Deadline          string `json:"deadline,omitempty"`
}

// RefundResult contains the intent hash and status of the refund.
type RefundResult struct {
	IntentHash string `json:"intentHash"`
	TxHash     string `json:"txHash"`
	Status     string `json:"status"`
}

// RefundService executes refund transfers from escrow back to the original sender.
type RefundService struct {
	signer *Signer
	relay  *intents.RelayClient
}

// NewRefundService constructs a RefundService.
func NewRefundService(signer *Signer, relay *intents.RelayClient) *RefundService {
	return &RefundService{
		signer: signer,
		relay:  relay,
	}
}

// Refund builds, signs, and relays a refund transfer intent from the escrow account.
func (s *RefundService) Refund(ctx context.Context, req RefundRequest) (*RefundResult, error) {
	refundTo := strings.TrimSpace(req.RefundTo)
	if refundTo == "" {
		refundTo = strings.TrimSpace(req.SenderNearAccount)
	}
	if refundTo == "" {
		return nil, fmt.Errorf("refund: refundTo is required")
	}
	if strings.TrimSpace(req.Asset) == "" {
		return nil, fmt.Errorf("refund: asset is required")
	}
	if strings.TrimSpace(req.Amount) == "" {
		return nil, fmt.Errorf("refund: amount is required")
	}

	payload, err := intents.BuildTransferIntent(
		s.signer.AccountID(),
		req.Asset,
		req.Amount,
		refundTo,
		req.Deadline,
	)
	if err != nil {
		return nil, fmt.Errorf("refund: %w", err)
	}

	signedData, err := s.signer.Sign(*payload)
	if err != nil {
		return nil, fmt.Errorf("refund: %w", err)
	}

	intentHash, err := s.relay.PublishIntent(ctx, *signedData)
	if err != nil {
		return nil, fmt.Errorf("refund: %w", err)
	}

	return &RefundResult{
		IntentHash: intentHash,
		TxHash:     intentHash,
		Status:     "SUBMITTED",
	}, nil
}
