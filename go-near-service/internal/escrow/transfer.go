package escrow

import (
	"context"
	"fmt"
	"strings"

	"github.com/uprail/near-service/internal/intents"
	"github.com/uprail/near-service/internal/oneclick"
)

// TransferRequest specifies the destination, asset, and quantity for a confidential escrow transfer.
type TransferRequest struct {
	Recipient            string `json:"recipient"`
	RecipientNearAccount string `json:"recipientNearAccount,omitempty"`
	Asset                string `json:"asset"`
	Amount               string `json:"amount"`
	Deadline             string `json:"deadline,omitempty"`
	// EscrowAccountID must match the configured escrow signer account.
	EscrowAccountID string `json:"escrowAccountId,omitempty"`
	// PaymentID binds the transfer to a single payment and drives idempotency.
	PaymentID string `json:"paymentId"`
}

// TransferResult contains the result of publishing the transfer intent.
type TransferResult struct {
	IntentHash string `json:"intentHash"`
	TxHash     string `json:"txHash"`
	Status     string `json:"status"`
}

// TransferService executes transfers from the escrow account to recipients.
type TransferService struct {
	signer   *Signer
	relay    *intents.RelayClient
	guard    *Guard
	oneClick *oneclick.Client
}

// NewTransferService constructs a TransferService.
// The guard is shared with refunds so each payment moves funds at most once per
// operation, even if the caller retries or a duplicate signed request arrives.
func NewTransferService(signer *Signer, relay *intents.RelayClient, guard *Guard, oneClick ...*oneclick.Client) *TransferService {
	if guard == nil {
		guard = NewGuard()
	}
	var oc *oneclick.Client
	if len(oneClick) > 0 {
		oc = oneClick[0]
	}
	return &TransferService{
		signer:   signer,
		relay:    relay,
		guard:    guard,
		oneClick: oc,
	}
}

// Transfer builds, signs, and relays a confidential transfer intent from the escrow account.
func (s *TransferService) Transfer(ctx context.Context, req TransferRequest) (*TransferResult, error) {
	recipient := strings.TrimSpace(req.Recipient)
	if recipient == "" {
		recipient = strings.TrimSpace(req.RecipientNearAccount)
	}
	if err := ValidateRecipient("recipient", recipient); err != nil {
		return nil, fmt.Errorf("transfer: %w", err)
	}
	if err := ValidateAsset("asset", req.Asset); err != nil {
		return nil, fmt.Errorf("transfer: %w", err)
	}
	if err := ValidateAmount("amount", req.Amount); err != nil {
		return nil, fmt.Errorf("transfer: %w", err)
	}
	if err := ValidatePaymentID(req.PaymentID); err != nil {
		return nil, fmt.Errorf("transfer: %w", err)
	}
	if err := s.ValidateEscrowBinding(req.EscrowAccountID); err != nil {
		return nil, fmt.Errorf("transfer: %w", err)
	}
	// Ownership: a "transfer" into the escrow account itself would be a
	// self-payment that moves nothing — reject it as a malformed request.
	if strings.EqualFold(recipient, s.signer.AccountID()) {
		return nil, fmt.Errorf("transfer: %w", invalid("recipient must not be the escrow account itself"))
	}

	fingerprint := settlementFingerprint(req.Asset, req.Amount, recipient)
	guardKey := settlementGuardKey(req.PaymentID)
	switch s.guard.Begin(guardKey) {
	case GuardDuplicate:
		cached, err := settlementReplay(s.guard.Result(guardKey), "transfer", fingerprint, req.PaymentID)
		if err != nil {
			return nil, err
		}
		result, ok := cached.(*TransferResult)
		if !ok {
			return nil, conflict("transfer: payment %s settlement record is inconsistent", req.PaymentID)
		}
		return result, nil
	case GuardInFlight:
		return nil, conflict("transfer: payment %s settlement is already in progress", req.PaymentID)
	}

	result, err := s.execute(ctx, req, recipient)
	if err != nil {
		s.guard.Release(guardKey)
		return nil, err
	}
	s.guard.Complete(guardKey, &settlementRecord{kind: "transfer", fingerprint: fingerprint, result: result})
	return result, nil
}

func (s *TransferService) execute(
	ctx context.Context,
	req TransferRequest,
	recipient string,
) (*TransferResult, error) {
	if s.signer == nil {
		return nil, fmt.Errorf("transfer: escrow signer is not configured")
	}

	var oneClickDepositAddr string
	if IsCrossChainAddress(recipient) {
		if s.oneClick == nil {
			return nil, fmt.Errorf("transfer: cross-chain transfer requested but 1Click client is not configured")
		}
		quote, err := s.oneClick.GetQuote(ctx, oneclick.QuoteRequest{
			SwapType:          "EXACT_INPUT",
			OriginAsset:       req.Asset,
			DestinationAsset:  req.Asset,
			Amount:            req.Amount,
			Recipient:         recipient,
			RecipientType:     "DESTINATION_CHAIN",
			RefundTo:          s.signer.AccountID(),
			RefundType:        "INTENTS",
			DepositType:       "INTENTS",
			SlippageTolerance: 100,
			Deadline:          req.Deadline,
		})
		if err != nil {
			return nil, fmt.Errorf("transfer: 1click cross-chain quote failed: %w", err)
		}
		if quote.DepositAddress == "" {
			return nil, fmt.Errorf("transfer: 1click returned empty deposit address")
		}
		oneClickDepositAddr = quote.DepositAddress
		recipient = quote.DepositAddress
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

	if oneClickDepositAddr != "" && s.oneClick != nil {
		_ = s.oneClick.SubmitDeposit(ctx, intentHash, oneClickDepositAddr)
	}

	return &TransferResult{
		IntentHash: intentHash,
		TxHash:     intentHash,
		Status:     "SUBMITTED",
	}, nil
}
