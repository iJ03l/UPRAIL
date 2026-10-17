-- Migration 0005_launchpad_fees.sql
--
-- Launchpad creator-fee routing. A launchpad points creator fees at an X handle
-- and reports each fee to UPRAIL by webhook. The paired token lands in the
-- pooled escrow account and rides the SAME pipeline as a human send: credited
-- straight into a known handle's vault, or escrowed until an unknown handle
-- signs up. Tokens are held as-is; no protocol fee is taken on them.
--
--   * launchpad_partners — one row per integrated launchpad (bearer key + HMAC
--                          webhook secret + a daily registration cap)
--   * launchpad_events   — idempotency + audit for every webhook event
--   * payments.origin    — marks a row as launchpad-sourced ('launchpad:<name>')
--
-- Tables use IF NOT EXISTS so the migration is also safe against a database
-- bootstrapped from schema.sql. Canonical definitions live in schema.sql.

-- ── launchpad_partners ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS launchpad_partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  -- Bearer key (`up_lp_…`) is shown to the partner exactly once; only its
  -- SHA-256 hash is persisted, so a database read can never yield a key.
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  -- Webhook signing secret. Stored in full because HMAC verification needs the
  -- raw value; it is a server-side shared secret and never returned to clients.
  webhook_secret TEXT NOT NULL,
  -- Each escrow storage registration spends escrow gas, so cap how many a
  -- partner can trigger per UTC day.
  daily_reg_cap INTEGER NOT NULL DEFAULT 25,
  regs_today INTEGER NOT NULL DEFAULT 0,
  regs_day TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_launchpad_partners_name ON launchpad_partners(name);

-- ── launchpad_events ────────────────────────────────────────────────────────
-- Idempotency + audit: a partner that retries the same eventId must not be
-- processed twice (and must not double-deliver a fee).
CREATE TABLE IF NOT EXISTS launchpad_events (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  token TEXT,
  handle TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(partner_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_launchpad_events_tx ON launchpad_events(tx_hash);
CREATE INDEX IF NOT EXISTS idx_launchpad_events_token ON launchpad_events(partner_id, token);

-- ── payments: launchpad origin ──────────────────────────────────────────────
-- NULL for every ordinary send; 'launchpad:<name>' for a routed creator fee.
ALTER TABLE payments ADD COLUMN origin TEXT;
CREATE INDEX IF NOT EXISTS idx_payments_origin ON payments(recipient_handle, origin);
