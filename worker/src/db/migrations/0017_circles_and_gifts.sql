-- Migration 0017_circles_and_gifts.sql
--
-- Adds two Earn-vault features. Purely additive: no existing table is altered.
--
--   * gifts   — 1 sender -> 1 X handle. The sender funds an Earn vault position
--               (1Click receipt token such as TLO / gtUSDCp / kV-gtSOLb) that is
--               held in a Worker-derived custody account on intents.near until
--               `timelock_until`. The recipient claims shares + accrued yield.
--   * circles — multi-member pooled Earn vault with per-member quotas expressed
--               in basis points (must sum to 10000).
--
-- Money columns are TEXT (atomic base units, BigInt-safe) or INTEGER (cents /
-- basis points / ms). There are deliberately no REAL money columns and no
-- ON DELETE CASCADE foreign keys: financial rows must never vanish because an
-- identity row was removed.

CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  sender_x_id TEXT NOT NULL,
  sender_handle TEXT NOT NULL,
  recipient_handle TEXT NOT NULL,
  recipient_x_id TEXT,
  occasion TEXT NOT NULL,
  message TEXT,
  show_amount INTEGER NOT NULL DEFAULT 0,
  vault_asset_id TEXT NOT NULL,
  vault_symbol TEXT NOT NULL,
  vault_decimals INTEGER NOT NULL,
  source_asset TEXT NOT NULL,
  source_symbol TEXT NOT NULL,
  source_decimals INTEGER NOT NULL,
  gross_atomic TEXT NOT NULL,
  principal_usd_cents INTEGER NOT NULL,
  custody_account TEXT NOT NULL,
  deposit_address TEXT,
  deposit_memo TEXT,
  quoted_shares_atomic TEXT NOT NULL,
  balance_before_atomic TEXT NOT NULL DEFAULT '0',
  shares_atomic TEXT,
  fee_shares_atomic TEXT,
  fee_status TEXT NOT NULL DEFAULT 'NONE',
  fee_tx_hash TEXT,
  timelock_until INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_FUNDING',
  intent_hash TEXT,
  claim_tx_hash TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  funded_at INTEGER,
  claimed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_gifts_sender ON gifts(sender_x_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gifts_recipient_handle ON gifts(recipient_handle, status);
CREATE INDEX IF NOT EXISTS idx_gifts_recipient_x_id ON gifts(recipient_x_id, status);
CREATE INDEX IF NOT EXISTS idx_gifts_status ON gifts(status, updated_at);

CREATE TABLE IF NOT EXISTS circles (
  id TEXT PRIMARY KEY,
  creator_x_id TEXT NOT NULL,
  creator_handle TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  note TEXT,
  target_usd_cents INTEGER NOT NULL,
  vault_asset_id TEXT NOT NULL,
  vault_symbol TEXT NOT NULL,
  vault_decimals INTEGER NOT NULL,
  payout_handle TEXT NOT NULL,
  custody_account TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  payout_tx_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_circles_creator ON circles(creator_x_id, created_at);
CREATE INDEX IF NOT EXISTS idx_circles_status ON circles(status, updated_at);

CREATE TABLE IF NOT EXISTS circle_members (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL,
  x_handle TEXT NOT NULL,
  x_id TEXT,
  share_bps INTEGER NOT NULL,
  quota_usd_cents INTEGER NOT NULL,
  contributed_usd_cents INTEGER NOT NULL DEFAULT 0,
  shares_atomic TEXT NOT NULL DEFAULT '0',
  refunded_at INTEGER,
  refund_tx_hash TEXT,
  joined_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(circle_id, x_handle)
);

CREATE INDEX IF NOT EXISTS idx_circle_members_circle ON circle_members(circle_id);
CREATE INDEX IF NOT EXISTS idx_circle_members_handle ON circle_members(x_handle);
CREATE INDEX IF NOT EXISTS idx_circle_members_x_id ON circle_members(x_id);

CREATE TABLE IF NOT EXISTS circle_contributions (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  contributor_x_id TEXT NOT NULL,
  source_asset TEXT NOT NULL,
  source_symbol TEXT NOT NULL,
  source_decimals INTEGER NOT NULL,
  gross_atomic TEXT NOT NULL,
  usd_cents INTEGER NOT NULL,
  deposit_address TEXT,
  deposit_memo TEXT,
  quoted_shares_atomic TEXT NOT NULL,
  balance_before_atomic TEXT NOT NULL DEFAULT '0',
  shares_atomic TEXT,
  fee_shares_atomic TEXT,
  fee_status TEXT NOT NULL DEFAULT 'NONE',
  fee_tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_FUNDING',
  intent_hash TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confirmed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_circle_contrib_circle ON circle_contributions(circle_id, status);
CREATE INDEX IF NOT EXISTS idx_circle_contrib_member ON circle_contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_circle_contrib_status ON circle_contributions(status, updated_at);
