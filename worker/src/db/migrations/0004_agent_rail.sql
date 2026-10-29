-- Migration 0004_agent_rail.sql
--
-- Programmatic agent payment rail: a user authorizes a named agent to move
-- funds from their own vault under explicit, passkey-approved policy. Every
-- agent action settles through the SAME payment pipeline as a human send, so
-- receipts, expiry and refunds behave identically.
--
--   * agents          — one row per named agent a user creates
--   * agent_keys      — hashed bearer keys bound to an agent + a spend policy
--   * agent_spend     — rolling per-day spend per key (cap enforcement)
--   * agent_approvals — Always-Ask queue: an over-policy request waits for an
--                       on-device passkey approval before any funds move
--   * agent_requests  — idempotency for agent-initiated payments
--
-- Tables use IF NOT EXISTS so the migration is also safe against a database
-- bootstrapped from schema.sql. Canonical definitions live in schema.sql.

-- ── agents ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 'always_ask' | 'autonomous'
  mode TEXT NOT NULL DEFAULT 'always_ask',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_x_id ON agents(x_id);

-- ── agent_keys ──────────────────────────────────────────────────────────────
-- The plaintext key is shown once at creation and never stored; only its hash
-- (SHA-256 hex) is persisted. A key carries the whole policy so it can be
-- revoked or re-scoped without touching the agent.
CREATE TABLE IF NOT EXISTS agent_keys (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  x_id TEXT NOT NULL,
  label TEXT,
  key_hash TEXT NOT NULL UNIQUE,
  -- Short non-secret prefix (e.g. "up_agent_ab12cd") for display/lookup.
  key_prefix TEXT NOT NULL,
  -- NULL asset = any asset the vault can move.
  asset TEXT,
  -- Decimal human-unit caps; NULL = no cap. per_tx applies to a single send,
  -- daily applies to the rolling UTC-day total for this key.
  per_tx_limit TEXT,
  daily_limit TEXT,
  -- JSON array of normalized '@handle' / wallet addresses; NULL = any recipient.
  allowlist TEXT,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_keys_agent ON agent_keys(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_keys_x_id ON agent_keys(x_id);

-- ── agent_spend ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_spend (
  agent_key_id TEXT NOT NULL,
  -- UTC day, YYYY-MM-DD.
  day TEXT NOT NULL,
  spent TEXT NOT NULL DEFAULT '0',
  PRIMARY KEY (agent_key_id, day)
);

-- ── agent_approvals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_approvals (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  agent_key_id TEXT,
  -- JSON payload of the requested action (recipientHandle, asset, amount, memo).
  payload TEXT NOT NULL,
  -- 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED'
  status TEXT NOT NULL DEFAULT 'PENDING',
  result TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_approvals_x_id ON agent_approvals(x_id, status);

-- ── agent_requests ──────────────────────────────────────────────────────────
-- Idempotency: an agent that retries with the same key must not double-pay.
CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY,
  agent_key_id TEXT NOT NULL,
  idempotency_key TEXT,
  payment_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(agent_key_id, idempotency_key)
);

-- ── payments: settlement diagnostics ────────────────────────────────────────
-- Application code (routes/payments.ts, routes/claim.ts) already writes
-- fee_dispatch_status/fee_dispatch_error, but no migration ever created the
-- columns, so those writes silently failed inside a catch. Recording the
-- outcome is the whole point ("a fee that silently never arrives is
-- indistinguishable from one that was never attempted").
ALTER TABLE payments ADD COLUMN fee_dispatch_status TEXT;
ALTER TABLE payments ADD COLUMN fee_dispatch_error TEXT;
