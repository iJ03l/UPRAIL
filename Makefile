.PHONY: help verify check-mainnet test check-endpoints

help:
	@echo "UPRAIL Verification Suite (NEAR Hackathon)"
	@echo "=========================================="
	@echo "make verify           Run live on-chain mainnet checks + full 158 automated tests"
	@echo "make check-mainnet    Verify escrow sponsor & sub-accounts on NEAR mainnet"
	@echo "make test             Run 158 automated tests in worker (Miniflare sandbox)"
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
