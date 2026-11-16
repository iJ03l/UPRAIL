.PHONY: help verify check-mainnet test check-endpoints deploy-circle

help:
	@echo "UPRAIL Verification Suite (NEAR Hackathon)"
	@echo "=========================================="
	@echo "make verify           Run 11 live mainnet/feature checks + 200 automated tests (186 Worker + 14 contract)"
	@echo "make check-mainnet    Verify sponsor, sub-accounts, intents.near, Circles/Gifts & live APIs (11 checks)"
	@echo "make test             Run 186 Worker tests (40 suites) + 14 Rust smart contract tests"
	@echo "make check-endpoints  Quick curl inspection of live production endpoints"
	@echo "make deploy-circle    Securely deploy/upgrade circle.uprail.near (hidden TTY key prompt)"

verify: check-mainnet test
	@echo "\n==========================================================="
	@echo "🎉 ALL VERIFICATION CHECKS AND AUTOMATED TESTS PASSED!"
	@echo "==========================================================="

check-mainnet:
	@python3 scripts/verify-mainnet.py

deploy-circle:
	@node scripts/deploy-circle-contract.mjs

test:
	@echo "\n--> Running worker automated test suite (186 tests) + contract Rust tests (14 tests)..."
	@cargo test --manifest-path contracts/circle-escrow/Cargo.toml
	@if [ -s "$$HOME/.nvm/nvm.sh" ]; then \
		bash -c "source $$HOME/.nvm/nvm.sh && nvm use 22.22.0 >/dev/null 2>&1 || true && cd worker && npm test"; \
	else \
		cd worker && npm test; \
	fi

check-endpoints:
	@echo "\n1. Checking Health:"
	@curl -sS https://api.uprail.world/health | jq .
	@echo "\n2. Resolving Handle (@uprailworld):"
	@curl -sS "https://api.uprail.world/api/resolve?handle=uprailworld" | jq .
	@echo "\n3. Checking OAuth 2.1 Protected Resource (MCP):"
	@curl -sS https://api.uprail.world/.well-known/oauth-protected-resource/api/mcp | jq .
	@echo "\n4. Checking Circles & Earn Vault Catalog:"
	@curl -sS https://api.uprail.world/api/circles/vaults | jq '.vaults | map({symbol, estimatedApyPct, minDepositUsd})'
