# UP (UPRAIL.app) Worker

Cloudflare Worker component for **UPRAIL.app** — a confidential payment system allowing users to send crypto to X (Twitter) handles, claimed with WebAuthn passkeys and settled on NEAR.

## Architecture

- **Runtime:** Cloudflare Workers (V8 isolate)
- **Router:** Hono v4
- **State & Storage:**
  - **Durable Objects:** Per-payment escrow state machine with local SQLite storage (`EscrowDO`), container lifecycle controller (`NearContainer`)
  - **D1 Database:** Queryable relational tables (`x_identities`, `passkeys`, `payments`)
  - **KV Namespace:** Session cache with 24-hour TTL, OAuth PKCE exchange, rate limiting
- **Authentication:**
  - X OAuth 2.0 PKCE (Free tier — `/2/users/me`)
  - WebAuthn (P-256 / ES256, COSE alg `-7`)
- **NEAR Settlement:**
  - Proxied to Go Container Worker via `NearContainer` Durable Object
  - 1Click confidential quotes with `"advanced"` confidentiality
  - Escrow ed25519 account operations and automated 30-day refunds

## Routes

### Authentication (`/auth/x/*`)
- `GET /auth/x/login` - Initiate X OAuth 2.0 PKCE authorization
- `GET /auth/x/callback` - OAuth callback, fetches `/2/users/me`, creates D1 profile & KV session
- `GET /auth/x/session` - Return current authenticated session
- `POST /auth/x/logout` - Invalidate session in KV and clear cookie

### Payments (`/api/*`)
- `POST /api/resolve` - Format validation for X handles (server-side resolution occurs at claim)
- `POST /api/quote` - Proxy to Go Container for confidential quote (`confidentiality: "advanced"`)
- `POST /api/send` - Create payment in D1, initialize `EscrowDO`, return payment ID + share link
- `GET /api/payments` - List authenticated user's sent payments
- `GET /api/payments/:id` - Payment status and details
- `POST /api/payments/:id/cancel` - Cancel payment before deposit confirmation

### Claim Flow (`/api/claim/*`)
- `GET /api/claim/pending` - Pending payments matching logged-in user's X handle
- `GET /api/claim/register-options` - WebAuthn registration options for P-256 passkey
- `POST /api/claim/register` - Verify WebAuthn attestation, create NEAR account via Go container, bind to X identity
- `POST /api/claim/execute` - Execute payment claims via `EscrowDO` and NEAR transfer
- `GET /api/claim/balance` - Confidential balance lookup for recipient account

### Health (`/health`)
- `GET /health` - System status and configuration check
