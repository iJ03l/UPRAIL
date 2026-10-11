# UP — UPRAIL.app

Confidential payments to X (Twitter) handles, claimed with a hardware passkey and settled on NEAR through NEAR Intents.

A sender pays to `@handle`; the recipient claims with Touch ID / Face ID; amounts, balances and recipients stay shielded. "Send to Wallet" withdraws your own shielded balance to any chain (NEAR / EVM / Solana / Bitcoin) through 1Click.

## Repository layout

| Path | What it is |
| --- | --- |
| `frontend/` | Next.js 14 app, **static export** served by the Worker |
| `worker/` | Cloudflare Worker (Hono): auth, payments, claim, invites, onchain proxy, static assets |
| `go-near-service/` | Go settlement service: 1Click quotes, intents relay, refunds, account creation |
| `db/postgres_schema.sql` | Postgres schema (optional store) |
| `worker/src/db/` | D1 schema + migrations (`migrations/*.sql`) |

## Architecture

```
browser ──► Cloudflare Worker (app.uprail.world / api.uprail.world)
              │  D1 + KV, sessions, quotes, claim orchestration
              │  serves frontend/dist as static assets
              └─signed HMAC──► Go settlement service (SETTLEMENT_SERVICE_URL)
                                 └─► 1Click API + solver relay ──► NEAR Intents
```

Settlement lives **only** in the Go service. The Worker never signs intents itself.

- Worker → Go calls are HMAC-signed (`worker/src/utils/internalAuth.ts`,
  `go-near-service/internal/middleware/auth.go`): timestamp + single-use nonce +
  `HMAC(secret, "v1.<ts>.<nonce>.POST.<path>.<sha256(body)>")`.
  A bare shared-secret header is rejected; a missing secret fails closed (503).
- Escrow state is in D1. There is **no** Durable Object / container binding:
  the Worker deploys on the free tier, which cannot run Worker containers.

## Quick start

```bash
# Frontend (Next dev on :3000, API proxied to the Worker on :8787)
cd frontend && npm install && npm run dev

# Worker (requires frontend/dist to exist: run `npm run build` in frontend/)
cd worker && npm install && cp .dev.vars.example .dev.vars   # fill in secrets
npm run typecheck && npm test

# Go settlement service
cd go-near-service && cp .env.example .env                   # fill in secrets
go build ./... && go vet ./... && go test ./...
go run ./cmd/server
```

### Build & deploy

```bash
cd frontend && npm run build      # next build → out/ → dist/ (copy-export)
cd ../worker && npm run typecheck && npm test
npm run deploy                    # wrangler deploy (serves ../frontend/dist)
```

`npm run build` in `frontend/` is the only build step: it emits the static
export and syncs it into `frontend/dist`, which is the directory
`worker/wrangler.jsonc` publishes.

## Secrets (never committed)

Local: `worker/.dev.vars` and `go-near-service/.env` (both gitignored; templates
in `.env.example`). Production: `wrangler secret put <NAME>`.

| Secret | Used by | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Worker | HMAC for stateless session cookies + OAuth PKCE state |
| `X_CLIENT_SECRET` | Worker | X OAuth 2.0 confidential client |
| `INTERNAL_SERVICE_KEY` | Worker **and** Go | Signs Worker → Go internal requests (must match) |
| `SETTLEMENT_SERVICE_URL` | Worker | Base URL of the Go settlement service |
| `ESCROW_PRIVATE_KEY` | Worker, Go | Escrow root key; derives per-user vault keys |
| `NEAR_RPC_URL` | Worker | NEAR JSON-RPC endpoint (may embed a provider token) |
| `DATABASE_URL` | Worker | Optional Postgres — needs a Hyperdrive binding to reach TCP from a Worker; falls back to D1 when absent or unreachable |
| `NEAR_PARTNER_API_KEY` | Go | 1Click partner API key |

Secrets **fail closed**: a missing value returns an error instead of falling
back to a default (`worker/src/utils/secrets.ts`).

## Security model (summary)

- Sessions: stateless HMAC-signed cookies, verified before rate-limit identity.
- Passkeys: WebAuthn P-256; `rpId`/origin come from `WEBAUTHN_RP_ID` /
  `WEBAUTHN_ORIGIN` only (`worker/src/services/webauthnConfig.ts`) — no
  hardcoded host allowlists. In local dev only, localhost ports are accepted.
- Every fund-moving endpoint requires **session + passkey assertion**.
- Quotes are signed by the Worker and bound to `(asset, amount, recipient,
  depositAddress, expiry)` — compared exactly, never by substring.
- Claim is reserved atomically (`UPDATE … WHERE status IN (…)`), so two
  concurrent claims cannot both settle; a failed settlement reverts the row.
- Withdrawals reserve balance with an atomic `INSERT … SELECT` guard.
- Response headers: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy` (`worker/src/middleware/securityHeaders.ts`).
- Error messages are scrubbed before leaving the process
  (`worker/src/utils/errors.ts`); the Go side returns generic upstream errors.

## Known limitations (tracked)

- `Content-Security-Policy` ships `script-src 'self' 'unsafe-inline'` because a
  static Next export cannot carry nonces. Cross-origin script loads, framing,
  form posts and connections are already restricted; switching the inline
  bootstrap to hashes is the follow-up.
- Browser caches (`localStorage`) hold balances/pending payments in cleartext,
  scoped to the signed-in account and cleared on logout — but not encrypted.
- Token prices fall back to a static map only when the live registry is down.
- `INTERNAL_SERVICE_KEY` appeared in git history (`go-near-service/.env.example`);
  it must be rotated everywhere it was ever used (`wrangler secret put`,
  `worker/.dev.vars`, `go-near-service/.env`).

## Verification commands

```bash
cd worker           && npm run typecheck && npm test          # tsc + 28 miniflare tests
cd frontend         && npx tsc --noEmit && npm run build      # types + static export
cd go-near-service  && go build ./... && go vet ./... && go test ./...
gofmt -l ./go-near-service/internal ./go-near-service/cmd     # must print nothing
```
