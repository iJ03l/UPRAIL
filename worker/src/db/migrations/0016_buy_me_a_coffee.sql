-- Migration 0016_buy_me_a_coffee.sql
--
-- Adds Buy Me a Coffee public tipping link support:
--   * x_identities.coffee_enabled — opt-in toggle for uprail.world/<handle>
--   * coffee_donations — tracks anonymous cross-chain deposits via 1Click into
--     escrow.uprail.near, carving out 1% protocol fee and settling 99% net
--     into the creator's UPRAIL vault.

ALTER TABLE x_identities ADD COLUMN coffee_enabled INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_x_identities_coffee ON x_identities(coffee_enabled);

CREATE TABLE IF NOT EXISTS coffee_donations (
  id TEXT PRIMARY KEY,
  recipient_x_id TEXT NOT NULL,
  recipient_handle TEXT NOT NULL,
  recipient_near_account TEXT NOT NULL,
  origin_asset TEXT NOT NULL,
  origin_chain TEXT NOT NULL,
  origin_symbol TEXT NOT NULL,
  target_symbol TEXT NOT NULL,
  target_asset TEXT NOT NULL,
  gross_amount TEXT NOT NULL,
  gross_atomic TEXT NOT NULL,
  quoted_out_atomic TEXT NOT NULL,
  net_amount TEXT NOT NULL,
  net_atomic TEXT NOT NULL,
  protocol_fee TEXT NOT NULL,
  fee_atomic TEXT NOT NULL,
  deposit_address TEXT NOT NULL,
  deposit_memo TEXT,
  status TEXT NOT NULL DEFAULT 'WAITING_DEPOSIT',
  intent_hash TEXT,
  payout_tx_hash TEXT,
  settled_amount_atomic TEXT,
  rail TEXT NOT NULL DEFAULT 'confidential',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(recipient_x_id) REFERENCES x_identities(x_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coffee_recipient ON coffee_donations(recipient_x_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_coffee_deposit ON coffee_donations(deposit_address);
CREATE INDEX IF NOT EXISTS idx_coffee_status ON coffee_donations(status, expires_at);
