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

-- Recovery codes: one-time HMAC digests that can replace a lost passkey.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY(x_id) REFERENCES x_identities(x_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_x_id ON recovery_codes(x_id, used_at);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_hash ON recovery_codes(code_hash);

-- Payments: Confidential escrow records tracking payment lifecycle
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  sender_x_id TEXT,
  sender_x_handle TEXT,
  recipient_handle TEXT NOT NULL,
  -- Immutable X identity of the recipient when it was known at send time.
  -- Claim authorization prefers this over recipient_handle (handles are mutable).
  recipient_x_id TEXT,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  fee TEXT,
  fee_recipient TEXT,
  -- Settlement diagnostics for the carved-out protocol fee (migration 0004).
  fee_dispatch_status TEXT,
  fee_dispatch_error TEXT,
  -- NULL for an ordinary send; 'launchpad:<name>' for a routed creator fee.
  origin TEXT,
  invite_code TEXT,
  memo TEXT,
  status TEXT NOT NULL,
  -- Why a CANCELLED send was cancelled (user cancel, settlement failure, etc.).
  cancel_reason TEXT,
  cancel_code TEXT,
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
CREATE INDEX IF NOT EXISTS idx_payments_recipient_x_id ON payments(recipient_x_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_origin ON payments(recipient_handle, origin);

-- Deposit addresses: cached 1Click one-time cross-chain deposit addresses
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
-- Canonical definition — migration 0002 must stay in sync with this block.
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  x_handle TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- Failure diagnostics (migration 0003): the reason a withdrawal reached
  -- FAILED, the machine code, and which settlement rail was attempted.
  error TEXT,
  error_code TEXT,
  rail TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_x_id ON withdrawals(x_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created ON withdrawals(created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_x_asset_status ON withdrawals(x_id, asset, status);

-- Auth Challenges: Single-use WebAuthn and OAuth challenges (replaces KV writes)
CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_challenges_x_id ON auth_challenges(x_id);
CREATE INDEX IF NOT EXISTS idx_challenges_lookup ON auth_challenges(challenge, purpose);

-- ── Agent payment rail (migration 0004) ─────────────────────────────────────
-- A user authorizes a named agent to move funds from their own vault under an
-- explicit, passkey-approved policy. Agent sends settle through the same
-- pipeline as a human send.

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'always_ask', -- 'always_ask' | 'autonomous'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_x_id ON agents(x_id);

CREATE TABLE IF NOT EXISTS agent_keys (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  x_id TEXT NOT NULL,
  label TEXT,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  asset TEXT,
  per_tx_limit TEXT,
  daily_limit TEXT,
  allowlist TEXT,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_keys_agent ON agent_keys(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_keys_x_id ON agent_keys(x_id);

CREATE TABLE IF NOT EXISTS agent_spend (
  agent_key_id TEXT NOT NULL,
  day TEXT NOT NULL,
  spent TEXT NOT NULL DEFAULT '0',
  PRIMARY KEY (agent_key_id, day)
);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  agent_key_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | DENIED | EXPIRED
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_approvals_x_id ON agent_approvals(x_id, status);

CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY,
  agent_key_id TEXT NOT NULL,
  idempotency_key TEXT,
  payment_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(agent_key_id, idempotency_key)
);

-- ── Launchpad creator-fee routing (migration 0005) ──────────────────────────
-- A launchpad points creator fees at an X handle and reports each fee by
-- webhook. The paired token lands in the pooled escrow account and rides the
-- same claim pipeline as a human send.

CREATE TABLE IF NOT EXISTS launchpad_partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  daily_reg_cap INTEGER NOT NULL DEFAULT 25,
  regs_today INTEGER NOT NULL DEFAULT 0,
  regs_day TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_launchpad_partners_name ON launchpad_partners(name);

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

