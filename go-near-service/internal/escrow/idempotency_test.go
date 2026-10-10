package escrow

import "testing"

func TestGuardAcquireCompleteDuplicate(t *testing.T) {
	g := NewGuard()
	key := "transfer:01JQ8Z3K4M5N6P7Q8R9S0T1U2V"

	if got := g.Begin(key); got != GuardAcquired {
		t.Fatalf("first Begin = %v, want GuardAcquired", got)
	}
	g.Complete(key, &TransferResult{TxHash: "tx1", Status: "SUBMITTED"})

	if got := g.Begin(key); got != GuardDuplicate {
		t.Fatalf("second Begin = %v, want GuardDuplicate", got)
	}
	cached, ok := g.Result(key).(*TransferResult)
	if !ok || cached == nil || cached.TxHash != "tx1" {
		t.Fatalf("cached result = %#v, want stored TransferResult", g.Result(key))
	}
}

func TestGuardInFlightBlocksSecondCaller(t *testing.T) {
	g := NewGuard()
	key := "transfer:inflight"

	if got := g.Begin(key); got != GuardAcquired {
		t.Fatalf("first Begin = %v, want GuardAcquired", got)
	}
	if got := g.Begin(key); got != GuardInFlight {
		t.Fatalf("concurrent Begin = %v, want GuardInFlight", got)
	}
}

func TestGuardReleaseAllowsRetry(t *testing.T) {
	g := NewGuard()
	key := "refund:retry"

	if got := g.Begin(key); got != GuardAcquired {
		t.Fatalf("first Begin = %v, want GuardAcquired", got)
	}
	g.Release(key)

	if got := g.Begin(key); got != GuardAcquired {
		t.Fatalf("Begin after Release = %v, want GuardAcquired", got)
	}
}

func TestGuardSeparatesTransferAndRefund(t *testing.T) {
	g := NewGuard()
	key := settlementGuardKey("shared-payment-id")

	// The services share ONE guard key per payment so a payment can never be
	// both transferred and refunded.
	if got := g.Begin(key); got != GuardAcquired {
		t.Fatalf("transfer Begin = %v, want GuardAcquired", got)
	}
	g.Complete(key, &settlementRecord{
		kind:        "transfer",
		fingerprint: settlementFingerprint("usdc", "1.5", "alice.near"),
		result:      &TransferResult{TxHash: "tx1", Status: "SUBMITTED"},
	})

	if got := g.Begin(key); got != GuardDuplicate {
		t.Fatalf("refund Begin on settled payment = %v, want GuardDuplicate", got)
	}
}

func TestSettlementReplaySameTermsReturnsCachedResult(t *testing.T) {
	original := &TransferResult{TxHash: "tx1", Status: "SUBMITTED"}
	rec := &settlementRecord{
		kind:        "transfer",
		fingerprint: settlementFingerprint("usdc", "1.5", "alice.near"),
		result:      original,
	}

	got, err := settlementReplay(rec, "transfer", settlementFingerprint("USDC", "1.5", "Alice.Near"), "pay1")
	if err != nil {
		t.Fatalf("same-terms replay should succeed, got %v", err)
	}
	if got != any(original) {
		t.Fatalf("replay returned %#v, want the cached result", got)
	}
}

func TestSettlementReplayRejectsCrossKindAndChangedTerms(t *testing.T) {
	rec := &settlementRecord{
		kind:        "refund",
		fingerprint: settlementFingerprint("usdc", "1.5", "alice.near"),
		result:      &RefundResult{TxHash: "tx1", Status: "SUBMITTED"},
	}

	if _, err := settlementReplay(rec, "transfer", settlementFingerprint("usdc", "1.5", "alice.near"), "pay1"); err == nil {
		t.Fatal("transfer replay on a refunded payment must conflict")
	}
	if _, err := settlementReplay(rec, "refund", settlementFingerprint("usdc", "9.9", "alice.near"), "pay1"); err == nil {
		t.Fatal("replay with a different amount must conflict")
	}
	if _, err := settlementReplay(nil, "refund", settlementFingerprint("usdc", "1.5", "alice.near"), "pay1"); err == nil {
		t.Fatal("replay with no recorded settlement must conflict")
	}
}
