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
	// EscrowAccountID must match the configured escrow signer account.
	EscrowAccountID string `json:"escrowAccountId,omitempty"`
	// PaymentID binds the refund to a single payment and drives idempotency.
	PaymentID string `json:"paymentId"`
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
	guard  *Guard
}

// NewRefundService constructs a RefundService. Pass the same Guard used for
// transfers so a payment can never both settle and refund concurrently.
func NewRefundService(signer *Signer, relay *intents.RelayClient, guard *Guard) *RefundService {
	if guard == nil {
		guard = NewGuard()
	}
	return &RefundService{
		signer: signer,
		relay:  relay,
		guard:  guard,
	}
}

// Refund builds, signs, and relays a refund transfer intent from the escrow account.
func (s *RefundService) Refund(ctx context.Context, req RefundRequest) (*RefundResult, error) {
	refundTo := strings.TrimSpace(req.RefundTo)
	if refundTo == "" {
		refundTo = strings.TrimSpace(req.SenderNearAccount)
	}
	if err := ValidateNearAccountID("refundTo", refundTo); err != nil {
		return nil, fmt.Errorf("refund: %w", err)
	}
	if err := ValidateAsset("asset", req.Asset); err != nil {
		return nil, fmt.Errorf("refund: %w", err)
	}
	if err := ValidateAmount("amount", req.Amount); err != nil {
		return nil, fmt.Errorf("refund: %w", err)
	}
	if err := ValidatePaymentID(req.PaymentID); err != nil {
		return nil, fmt.Errorf("refund: %w", err)
	}
	if err := s.ValidateEscrowBinding(req.EscrowAccountID); err != nil {
		return nil, fmt.Errorf("refund: %w", err)
	}
	// Ownership: a refund into the escrow account itself would strand the
	// funds — only the original sender's account is a valid destination.
	if strings.EqualFold(refundTo, s.signer.AccountID()) {
		return nil, fmt.Errorf("refund: %w", invalid("refundTo must be the original sender's account, not the escrow account"))
	}

	fingerprint := settlementFingerprint(req.Asset, req.Amount, refundTo)
	guardKey := settlementGuardKey(req.PaymentID)
	switch s.guard.Begin(guardKey) {
	case GuardDuplicate:
		cached, err := settlementReplay(s.guard.Result(guardKey), "refund", fingerprint, req.PaymentID)
		if err != nil {
			return nil, err
		}
		result, ok := cached.(*RefundResult)
		if !ok {
			return nil, conflict("refund: payment %s settlement record is inconsistent", req.PaymentID)
		}
		return result, nil
	case GuardInFlight:
		return nil, conflict("refund: payment %s refund is already in progress", req.PaymentID)
	}

	result, err := s.execute(ctx, req, refundTo)
	if err != nil {
		s.guard.Release(guardKey)
		return nil, err
	}
	s.guard.Complete(guardKey, &settlementRecord{kind: "refund", fingerprint: fingerprint, result: result})
	return result, nil
}

func (s *RefundService) execute(
	ctx context.Context,
	req RefundRequest,
	refundTo string,
) (*RefundResult, error) {
	if s.signer == nil {
		return nil, fmt.Errorf("refund: escrow signer is not configured")
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
