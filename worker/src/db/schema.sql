-- UP (UPRAIL.app) D1 Database Schema

-- X Identities: Stores authenticated X user profiles and linked NEAR accounts
CREATE TABLE IF NOT EXISTS x_identities (
  x_id TEXT PRIMARY KEY,
  x_handle TEXT NOT NULL UNIQUE,
  x_name TEXT NOT NULL,
  near_account TEXT,
  is_activated INTEGER NOT NULL DEFAULT 0,
  personal_invite_code TEXT,
  invited_by_code TEXT,
  invited_by_handle TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_x_identities_handle ON x_identities(x_handle);
CREATE INDEX IF NOT EXISTS idx_x_identities_near ON x_identities(near_account);
CREATE INDEX IF NOT EXISTS idx_x_identities_activated ON x_identities(is_activated);

-- Passkeys: WebAuthn credentials bound to X identities for claiming
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(x_id) REFERENCES x_identities(x_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkeys_x_id ON passkeys(x_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_cred_id ON passkeys(credential_id);

-- Payments: Confidential escrow records tracking payment lifecycle
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  sender_x_id TEXT,
  sender_x_handle TEXT,
  recipient_handle TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  fee TEXT,
  fee_recipient TEXT,
  invite_code TEXT,
  status TEXT NOT NULL,
  deposit_address TEXT,
  intent_hash TEXT,
  claim_tx_hash TEXT,
  refund_tx_hash TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_recipient ON payments(recipient_handle, status);
CREATE INDEX IF NOT EXISTS idx_payments_sender ON payments(sender_x_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_invite ON payments(invite_code);

-- Invites: 6 capital letter invite codes (1 per user + preloaded payment invites)
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  creator_x_id TEXT,
  creator_x_handle TEXT,
  claimed_by_x_id TEXT,
  claimed_by_x_handle TEXT,
  payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'USED', 'EXPIRED'
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_invites_creator ON invites(creator_x_id);
CREATE INDEX IF NOT EXISTS idx_invites_claimed_by ON invites(claimed_by_x_id);
CREATE INDEX IF NOT EXISTS idx_invites_payment ON invites(payment_id);
CREATE INDEX IF NOT EXISTS idx_invites_status ON invites(status);

-- Withdrawals: Vault settlement to external blockchain addresses
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  x_handle TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_x_id ON withdrawals(x_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created ON withdrawals(created_at);
