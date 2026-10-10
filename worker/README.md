# UP (UPRAIL.app) Worker

Cloudflare Worker component for **UPRAIL.app** — a confidential payment system allowing users to send crypto to X (Twitter) handles, claimed with WebAuthn passkeys and settled on NEAR.

## Architecture

- **Runtime:** Cloudflare Workers (V8 isolate)
- **Router:** Hono v4
- **State & Storage:**
  - **Durable Objects:** Per-payment escrow state machine with local SQLite storage (`EscrowDO`), container lifecycle controller (`NearContainer`)
  - **D1 Database:** All relational state (`x_identities`, `passkeys`, `payments`, `invites`, `withdrawals`, `auth_challenges`, `deposit_addresses`). Schema is owned by `src/db/migrations/*.sql`.
  - **Sessions:** Stateless HMAC-SHA256 signed cookies (`src/middleware/session.ts`) — zero KV writes. The `CACHE` KV binding is only read to upgrade legacy session cookies.
  - **Challenges:** Single-use WebAuthn/OAuth challenges stored in D1 + in-memory.
  - **Rate limiting:** In-memory per isolate, keyed on the verified session `x_id` (falls back to `cf-connecting-ip` for anonymous traffic).
- **Authentication:**
  - X OAuth 2.0 PKCE (Free tier — `/2/users/me`)
  - WebAuthn (P-256 / ES256, COSE alg `-7`); rpId/origin resolved from `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` via `src/services/webauthnConfig.ts`
- **Secrets:** Never committed. Set with `wrangler secret put <NAME>` (see `.dev.vars.example`); required secrets fail closed when missing (`src/utils/secrets.ts`).
- **NEAR Settlement:**
  - Proxied to the Go settlement service (HMAC-signed internal auth, `src/utils/internalAuth.ts`)
  - 1Click confidential quotes with `"advanced"` confidentiality
  - Only real onchain transaction hashes are persisted — settlement responses without a hash fail loudly
  - The hourly cron marks expired payments `EXPIRED`; refunds are requested explicitly, not automated

## Routes

### Authentication (`/auth/*`)
- `GET /auth/x/login` - Initiate X OAuth 2.0 PKCE authorization (sanitized `return_to` allowlist)
- `GET /auth/x/callback` - OAuth callback, fetches `/2/users/me`, creates D1 profile + signed session cookie
- `GET /auth/x/session` - Return current authenticated session
- `POST /auth/logout` - Clear session cookie

### Payments (`/api/*`)
- `POST /api/resolve` - Format validation for X handles (server-side resolution occurs at claim)
- `POST /api/quote` - Signed, recipient-bound confidential quote (HMAC-verified at send time)
- `POST /api/send` - Create payment in D1 (requires session + passkey assertion), return payment ID + share link
- `GET /api/payments` - List authenticated user's payments
- `GET /api/payments/:id` - Payment details (full for sender/recipient, minimal public preview otherwise)
- `POST /api/payments/:id/cancel` - Cancel payment before deposit confirmation

### Claim Flow (`/api/claim/*`)
- `GET /api/claim/pending` - Pending payments matching logged-in user's X handle
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
- `GET /health` - System status and configuration check
