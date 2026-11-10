.PHONY: help verify check-mainnet test check-endpoints

help:
	@echo "UPRAIL Verification Suite (NEAR Hackathon)"
	@echo "=========================================="
	@echo "make verify           Run 10 live mainnet/feature checks + 166 automated tests"
	@echo "make check-mainnet    Verify sponsor, sub-accounts, intents.near & live APIs (10 checks)"
	@echo "make test             Run 166 automated tests across 39 suites (Miniflare + unit)"
	@echo "make check-endpoints  Quick curl inspection of live production endpoints"

verify: check-mainnet test
	@echo "\n==========================================================="
	@echo "🎉 ALL VERIFICATION CHECKS AND AUTOMATED TESTS PASSED!"
	@echo "==========================================================="

check-mainnet:
	@python3 scripts/verify-mainnet.py

test:
	@echo "\n--> Running worker automated test suite (158 tests)..."
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
