# UP (UPRAIL.app) Worker

Cloudflare Worker component for **UPRAIL.app** — a confidential payment system allowing users to send crypto to X (Twitter) handles, claimed with WebAuthn passkeys and settled on NEAR.

## Architecture

- **Runtime:** Cloudflare Workers (V8 isolate)
- **Router:** Hono v4
- **State & Storage:**
  - **D1 Database:** All relational state (`x_identities`, `passkeys`, `payments`, `invites`, `withdrawals`, `auth_challenges`, `deposit_addresses`). Schema is owned by `src/db/migrations/*.sql`.
  - **No Durable Objects:** the worker deploys without `durable_objects`/`containers` (free tier cannot run Worker containers). Escrow state lives in D1 and settlement runs in the external Go service.
  - **Sessions:** Stateless HMAC-SHA256 signed cookies (`src/middleware/session.ts`) — zero KV writes. The `CACHE` KV binding is only read to upgrade legacy session cookies.
  - **Challenges:** Single-use WebAuthn/OAuth challenges stored in D1 + in-memory.
  - **Rate limiting:** In-memory per isolate, keyed on the verified session `x_id` (falls back to `cf-connecting-ip` for anonymous traffic).
- **Authentication:**
  - X OAuth 2.0 PKCE (Free tier — `/2/users/me`)
  - WebAuthn (P-256 / ES256, COSE alg `-7`); rpId/origin resolved from `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` via `src/services/webauthnConfig.ts`
- **Secrets:** Never committed. Set with `wrangler secret put <NAME>` (see `.dev.vars.example`); required secrets fail closed when missing (`src/utils/secrets.ts`).
- **NEAR Settlement:**
  - Escrow transfers/refunds are signed by the Worker itself (escrow key in `ESCROW_PRIVATE_KEY`); 1Click quotes are proxied to the Go settlement service when configured (HMAC-signed internal auth, `src/utils/internalAuth.ts`)
  - 1Click confidential quotes with `"advanced"` confidentiality
  - Only real onchain transaction hashes are persisted — settlement responses without a hash fail loudly
  - The hourly cron expires unsettled sends, refunds `ESCROWED` payments past their expiry back to the sender (gross = amount + fee), and retries interrupted refunds (`src/index.ts`)

## Routes

### Authentication (`/auth/*`, legacy alias `/auth/x/*`)
- `GET /auth/init` / `GET /auth/authorize-url` - Start X OAuth 2.0 PKCE (`return_to` is sanitized to a same-site path)
- `GET /auth/login` - Begin login (issue-then-verify passkey flow)
- `GET /auth/callback` - OAuth callback, fetches `/2/users/me`, creates profile + signed session cookie
- `GET /auth/session` / `GET /auth/status` - Current authenticated session
- `POST /auth/logout` - Clear session cookie and browser caches
- `GET /auth/passkey/login-options`, `POST /auth/passkey/login-verify` - Passkey sign-in
- `GET /auth/export-key-challenge`, `POST /auth/export-key` - Passkey-gated key export

### Payments (`/api/*`)
- `POST /api/resolve` - Format validation for X handles (server-side resolution occurs at claim)
- `POST /api/quote` - Signed, recipient-bound confidential quote (HMAC-verified at send time)
- `POST /api/send` - Create payment in D1 (requires session + passkey assertion), return payment ID + share link
- `GET /api/payments` - List authenticated user's payments
- `GET /api/payments/:id` - Payment details (full for sender/recipient, minimal public preview otherwise)
- `POST /api/payments/:id/cancel` - Cancel payment before deposit confirmation

### Claim Flow (`/api/claim/*`)
- `GET /api/claim/pending` - Pending payments matching the caller's X id **or** handle (status-filtered)
- `GET /api/claim/register-options`, `POST /api/claim/register` - Register the claim passkey
- `GET|POST /api/auth-challenge` - Issue single-use `tx_auth` WebAuthn challenge (see `/api/auth-challenge`)
- `POST /api/claim/execute` - Execute payment claims (session + passkey assertion required)
- `POST /api/claim/withdraw` - Withdraw shielded balance to an external address (session + passkey assertion required)
- `GET /api/claim/balance` - Confidential balance lookup for recipient account

### Invites (`/api/invites/*`)
- `POST /api/invites/validate` - Validate a 6-letter invite code (genesis + personal codes)
- `GET /api/invites/status` - Invite/bootstrap status
- `GET /api/invites/my-invite` - The caller's personal invite code + claim status (auth required)
- `POST /api/invites/redeem` - Redeem an invite code (auth required, single-claim guarded)

### Onchain (`/api/onchain/*`)
- Authenticated, per-user live data: balances, token list, intent history, deposit addresses, `deposit-status` (caller must own the deposit address)

### Health (`/health`)
- `GET /health` - System status and configuration check (never exposes key material)

## Security headers

Every response (including static assets, thanks to `run_worker_first`) gets
`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy` and `Permissions-Policy`
from `src/middleware/securityHeaders.ts`. Error responses pass through
`publicErrorMessage()` (`src/utils/errors.ts`) so internal URLs and upstream
bodies never reach a client.
