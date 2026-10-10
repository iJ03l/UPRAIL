-- Migration 0002_payment_identity_and_missing_tables.sql
--
-- Adds the columns/tables that application code reads and writes but that
-- 0001 did not create:
--   * payments.recipient_x_id  — immutable recipient identity for claim auth
--   * payments.memo / fee / fee_recipient / invite_code
--   * x_identities activation + invite columns
--   * invites, withdrawals, auth_challenges, deposit_addresses
--
-- Column additions are plain ALTER TABLE: each migration runs exactly once per
-- database (tracked by wrangler). Table creation uses IF NOT EXISTS so the
-- migration is also safe against a database bootstrapped from schema.sql.

-- ── x_identities ────────────────────────────────────────────────────────────
ALTER TABLE x_identities ADD COLUMN is_activated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE x_identities ADD COLUMN personal_invite_code TEXT;
ALTER TABLE x_identities ADD COLUMN invited_by_code TEXT;
ALTER TABLE x_identities ADD COLUMN invited_by_handle TEXT;

CREATE INDEX IF NOT EXISTS idx_x_identities_activated ON x_identities(is_activated);
CREATE INDEX IF NOT EXISTS idx_x_identities_personal_code ON x_identities(personal_invite_code);

-- ── payments ────────────────────────────────────────────────────────────────
ALTER TABLE payments ADD COLUMN recipient_x_id TEXT;
ALTER TABLE payments ADD COLUMN fee TEXT;
ALTER TABLE payments ADD COLUMN fee_recipient TEXT;
ALTER TABLE payments ADD COLUMN invite_code TEXT;
ALTER TABLE payments ADD COLUMN memo TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_recipient_x_id ON payments(recipient_x_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_invite ON payments(invite_code);

-- ── invites ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  creator_x_id TEXT,
  creator_x_handle TEXT,
  claimed_by_x_id TEXT,
  claimed_by_x_handle TEXT,
  payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_invites_creator ON invites(creator_x_id);
CREATE INDEX IF NOT EXISTS idx_invites_claimed_by ON invites(claimed_by_x_id);
CREATE INDEX IF NOT EXISTS idx_invites_payment ON invites(payment_id);
CREATE INDEX IF NOT EXISTS idx_invites_status ON invites(status);

-- ── withdrawals ─────────────────────────────────────────────────────────────
-- Canonical definition lives in worker/src/db/schema.sql — keep in sync.
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  x_handle TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_x_id ON withdrawals(x_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created ON withdrawals(created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_x_asset_status ON withdrawals(x_id, asset, status);

-- ── auth_challenges ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_challenges_x_id ON auth_challenges(x_id);
CREATE INDEX IF NOT EXISTS idx_challenges_lookup ON auth_challenges(challenge, purpose);

-- ── deposit_addresses ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposit_addresses (
  account_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  chain_name TEXT NOT NULL,
  address TEXT NOT NULL,
  memo TEXT,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, chain)
);

CREATE INDEX IF NOT EXISTS idx_deposit_addresses_account ON deposit_addresses(account_id);
