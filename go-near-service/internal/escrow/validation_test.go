package escrow

import (
	"strings"
	"testing"
)

func TestValidateAmount(t *testing.T) {
	valid := []string{"1", "0.5", "1000000", "0.000001", "123456789012345678901234567890"}
	for _, v := range valid {
		if err := ValidateAmount("amount", v); err != nil {
			t.Errorf("expected %q to be valid, got %v", v, err)
		}
	}

	invalidValues := []string{"", "0", "00", "0.0", "-1", "1e18", "+5", "abc", "1.2345678901234567890", "1,000", " 0 "}
	for _, v := range invalidValues {
		if err := ValidateAmount("amount", v); err == nil {
			t.Errorf("expected %q to be rejected", v)
		}
	}
}

func TestValidateNearAccountID(t *testing.T) {
	valid := []string{"alice.near", "uprail.near", "escrow.uprail.near", "u_9f2c1a0b.uprail.near", "abc"}
	for _, v := range valid {
		if err := ValidateNearAccountID("recipient", v); err != nil {
			t.Errorf("expected %q to be valid, got %v", v, err)
		}
	}

	invalidValues := []string{"", "Alice.near", "a..b.uprail.near", ".uprail.near", "alice.", "0xABCDEF", "alice near", "a"}
	for _, v := range invalidValues {
		if err := ValidateNearAccountID("recipient", v); err == nil {
			t.Errorf("expected %q to be rejected", v)
		}
	}
}

func TestValidateAsset(t *testing.T) {
	if err := ValidateAsset("asset", "nep141:usdc.near"); err != nil {
		t.Errorf("expected valid asset, got %v", err)
	}
	for _, v := range []string{"", "bad asset", "a/b", strings.Repeat("x", 65)} {
		if err := ValidateAsset("asset", v); err == nil {
			t.Errorf("expected %q to be rejected", v)
		}
	}
}

func TestValidatePaymentID(t *testing.T) {
	if err := ValidatePaymentID("01JQ8Z3K4M5N6P7Q8R9S0T1U2V_fee"); err != nil {
		t.Errorf("expected valid payment id, got %v", err)
	}
	for _, v := range []string{"", "short", "has spaces", "id/with/slash"} {
		if err := ValidatePaymentID(v); err == nil {
			t.Errorf("expected %q to be rejected", v)
		}
	}
}

func TestEscrowBinding(t *testing.T) {
	signer, err := NewSigner(
		"1111111111111111111111111111111111111111111111111111111111111111",
		"escrow.uprail.near",
	)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	svc := &TransferService{signer: signer}

	if err := svc.ValidateEscrowBinding(""); err == nil {
		t.Error("empty escrow binding must be rejected (field is required)")
	}
	if err := svc.ValidateEscrowBinding("escrow.uprail.near"); err != nil {
		t.Errorf("matching binding should be allowed, got %v", err)
	}
	if err := svc.ValidateEscrowBinding("attacker.near"); err == nil {
		t.Error("mismatched escrow account must be rejected")
	}
}
