-- UPRAIL (UPRAIL.app) PostgreSQL Schema
-- Production-ready schema for X OAuth 2.0 PKCE identities, NIST P-256 WebAuthn Passkeys,
-- Sessions, and NEAR Intent settlements.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. X Identities: Stores authenticated X user profiles and linked NEAR intent accounts
CREATE TABLE IF NOT EXISTS x_identities (
    x_id VARCHAR(64) PRIMARY KEY,              -- Stable numeric Snowflake ID from X (Twitter)
    x_handle VARCHAR(32) NOT NULL,             -- Normalized username (without leading @, lowercase)
    x_name VARCHAR(128) NOT NULL,              -- Display name
    near_account VARCHAR(128),                 -- Linked NEAR / Intent account (e.g. x_<x_id>.uprail.near)
    avatar_url TEXT,                           -- Profile image URL
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive unique index on x_handle
CREATE UNIQUE INDEX IF NOT EXISTS uq_x_identities_handle_lower ON x_identities(LOWER(x_handle));
CREATE INDEX IF NOT EXISTS idx_x_identities_near_account ON x_identities(near_account);

-- 2. Passkeys: Hardware-bound WebAuthn credentials (NIST P-256 / secp256r1)
CREATE TABLE IF NOT EXISTS passkeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    x_id VARCHAR(64) NOT NULL REFERENCES x_identities(x_id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,       -- WebAuthn raw credential ID (base64url)
    public_key TEXT NOT NULL,                 -- P-256 public key (hex or base58 NEAR format p256:...)
    counter BIGINT NOT NULL DEFAULT 0,        -- Signature counter to prevent clone/replay
    transports JSONB NOT NULL DEFAULT '[]'::jsonb, -- e.g. ["internal", "hybrid"]
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_passkeys_x_id ON passkeys(x_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_cred_id ON passkeys(credential_id);

-- 3. Sessions: Authenticated user sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id VARCHAR(64) PRIMARY KEY,       -- Secure session token UUID
    x_id VARCHAR(64) NOT NULL REFERENCES x_identities(x_id) ON DELETE CASCADE,
    x_handle VARCHAR(32) NOT NULL,
    x_name VARCHAR(128) NOT NULL,
    near_account VARCHAR(128),
    ip_hash VARCHAR(64),                      -- SHA256 of IP for anomaly detection
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_x_id ON user_sessions(x_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- 4. Auth Challenges: Server-authoritative, strictly single-use WebAuthn challenges
CREATE TABLE IF NOT EXISTS auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    x_id VARCHAR(64) NOT NULL REFERENCES x_identities(x_id) ON DELETE CASCADE,
    challenge TEXT NOT NULL UNIQUE,
    purpose VARCHAR(32) NOT NULL DEFAULT 'registration', -- 'registration' | 'claim' | 'transfer'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_lookup ON auth_challenges(x_id, purpose, expires_at);

-- 5. Payments & Intents: Confidential payment lifecycle
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY,               -- ULID identifier
    sender_x_id VARCHAR(64) REFERENCES x_identities(x_id) ON DELETE SET NULL,
    sender_x_handle VARCHAR(32),
    recipient_handle VARCHAR(32) NOT NULL,     -- Target handle without @
    recipient_x_id VARCHAR(64) REFERENCES x_identities(x_id) ON DELETE SET NULL,
    asset VARCHAR(32) NOT NULL,               -- e.g. 'usdc', 'usdt', 'near', 'eth', 'btc'
    amount VARCHAR(64) NOT NULL,              -- Exact string numeric amount
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, DEPOSIT_WAITING, ESCROWED, CLAIMED, REFUNDED, CANCELLED, EXPIRED
    deposit_address TEXT,                     -- 1Click cross-chain deposit address
    intent_hash TEXT,                         -- Defuse / NEAR Intents hash
    claim_tx_hash TEXT,                       -- NEAR transaction hash on claim
    refund_tx_hash TEXT,                      -- Refund transaction hash on expiry
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_sender_x_id ON payments(sender_x_id);
CREATE INDEX IF NOT EXISTS idx_payments_recipient_handle_lower ON payments(LOWER(recipient_handle), status);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_expires_at ON payments(expires_at);

-- Helper trigger for auto-updating updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_x_identities_updated ON x_identities;
CREATE TRIGGER trg_x_identities_updated
BEFORE UPDATE ON x_identities
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_payments_updated ON payments;
CREATE TRIGGER trg_payments_updated
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
