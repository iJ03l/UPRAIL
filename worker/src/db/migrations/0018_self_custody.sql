-- Migration 0018_self_custody.sql
--
-- Opt-in passkey self-custody on intents.near + circle.uprail.near contract
-- routing metadata for new Circles, Vault Gifts, and unclaimed @handle sends.
-- Default stays custody_mode = 'server' and contract_mode = 'escrow' so all
-- existing users and in-flight escrows continue working without disruption.

ALTER TABLE x_identities ADD COLUMN custody_mode TEXT NOT NULL DEFAULT 'server';
ALTER TABLE x_identities ADD COLUMN backup_pubkey TEXT;
ALTER TABLE x_identities ADD COLUMN self_custody_at INTEGER;
ALTER TABLE x_identities ADD COLUMN self_custody_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_x_identities_custody ON x_identities(custody_mode);

ALTER TABLE passkeys ADD COLUMN near_p256_pubkey TEXT;
ALTER TABLE passkeys ADD COLUMN onchain_added_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_passkeys_near_pubkey ON passkeys(near_p256_pubkey);

ALTER TABLE payments ADD COLUMN contract_mode TEXT NOT NULL DEFAULT 'escrow';
ALTER TABLE payments ADD COLUMN escrow_contract_id TEXT;
ALTER TABLE payments ADD COLUMN escrow_send_id TEXT;

ALTER TABLE gifts ADD COLUMN contract_mode TEXT NOT NULL DEFAULT 'escrow';
ALTER TABLE gifts ADD COLUMN escrow_contract_id TEXT;
ALTER TABLE gifts ADD COLUMN onchain_gift_id TEXT;

ALTER TABLE circles ADD COLUMN contract_mode TEXT NOT NULL DEFAULT 'escrow';
ALTER TABLE circles ADD COLUMN escrow_contract_id TEXT;
ALTER TABLE circles ADD COLUMN onchain_circle_id TEXT;
ALTER TABLE circles ADD COLUMN dissolve_initiated_at INTEGER;
ALTER TABLE circles ADD COLUMN dissolve_deadline_at INTEGER;

ALTER TABLE circle_members ADD COLUMN p256_pubkey TEXT;
ALTER TABLE circle_members ADD COLUMN terms_signed_at INTEGER;
ALTER TABLE circle_members ADD COLUMN dissolve_signed_at INTEGER;

CREATE TABLE IF NOT EXISTS pending_custody_actions (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  challenge_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  meta_json TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(x_id) REFERENCES x_identities(x_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pending_custody_x_id ON pending_custody_actions(x_id, used_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_custody_digest ON pending_custody_actions(challenge_digest);
