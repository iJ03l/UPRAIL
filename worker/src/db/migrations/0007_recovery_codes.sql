-- Migration 0007_recovery_codes.sql
--
-- One-time passkey recovery codes. Only HMAC-SHA-256 digests are stored; the
-- plaintext codes are shown to the user exactly once and never persisted.
--
-- A code is scoped to one x_id and can be consumed once. Successful recovery
-- registration revokes the account's previous passkeys in application code.

CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY(x_id) REFERENCES x_identities(x_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_x_id
  ON recovery_codes(x_id, used_at);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_hash
  ON recovery_codes(code_hash);
