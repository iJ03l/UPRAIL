# UPRAIL NEAR Go settlement service

The **only** settlement implementation: confidential quotes (1Click), intents
relay submission, refunds, and NEAR sub-account creation. The Cloudflare Worker
never settles onchain by itself — it signs a request and calls this service.

## Run

```bash
cp .env.example .env      # fill in real values (never commit .env)
go build ./... && go vet ./... && go test ./...
go run ./cmd/server       # listens on :PORT (default 8080)
```

Config is read from the environment; `.env` / `../.env` are loaded if present
(`internal/config/config.go`). Secrets are never logged or serialized.

| Variable | Required | Purpose |
| --- | --- | --- |
| `INTERNAL_SERVICE_KEY` | yes | Shared with the Worker; empty ⇒ every internal route returns 503 (fail closed) |
| `ESCROW_PRIVATE_KEY`, `ESCROW_ACCOUNT_ID` | for settling | Escrow signer; missing ⇒ service starts but signer operations fail |
| `NEAR_API_BASE` | yes | 1Click API base |
| `SOLVER_RELAY_URL` | yes | Solver relay RPC |
| `NEAR_PARTNER_API_KEY` | for 1Click | Partner API key |
| `PORT`, `ENVIRONMENT` | no | `8080`, `development` |
| `ALLOWED_ACCOUNT_PARENTS`, `DENIED_ACCOUNT_IDS` | no | Sub-account creation allow/deny lists (defaults in `config.go`) |

## Routes

Only `/` (health) and `/internal/*` exist, and every `/internal/*` route is
behind HMAC auth:

- `GET  /internal/health` — readiness probe (no auth)
- `POST /internal/quote` — confidential quote
- `POST /internal/transfer`, `/internal/refund` — settle / refund
- `POST /internal/account/create`, `/internal/create-account` — sub-account creation
- `GET  /internal/balance`, `GET /internal/tokens`
- `GET  /internal/deposit/status`, `POST /internal/deposit/submit|/internal/submit-deposit`

## Internal authentication

`internal/middleware/auth.go` accepts **only** signed requests:

```
X-Internal-Timestamp : unix seconds, ±5 min skew
X-Internal-Nonce     : single-use UUID, 10 min replay window
X-Internal-Signature : hex(HMAC-SHA256(secret, "v1.<ts>.<nonce>.POST.<path>.<sha256(body)>"))
```

The signature covers method, path and body, so a captured signature cannot be
replayed against a different payload. A bare `X-Internal-Secret` header is
rejected. Empty secret ⇒ 503 (the Worker treats this as "settlement down",
never as "settle elsewhere").

## Validation, idempotency, limits

- `internal/escrow/validation.go` — NEAR account ids, amounts, asset ids,
  payment ids and escrow bindings are validated before any network call;
  invalid input ⇒ 400, conflicting input ⇒ 409.
- `internal/escrow/idempotency.go` — a `Guard` makes transfer/refund
  at-most-once per `(operation, paymentId)`: a duplicate returns `Duplicate`,
  a concurrent attempt returns `InFlight`.
- `internal/middleware/limits.go` — 1 MiB request body cap.
- `internal/middleware/ratelimit.go` — 600 req/min per TCP peer, process-local.
- Errors: typed validation/conflict errors are returned to the caller, every
  other failure is logged in full and reported as a generic
  `"<scope> upstream failure"` (`internal/handler/response.go`) so upstream
  response bodies never reach a client.

## Tests

```bash
go test ./...      # escrow validation + idempotency, HMAC middleware, crypto, intents
gofmt -l ./internal ./cmd    # must print nothing
```
