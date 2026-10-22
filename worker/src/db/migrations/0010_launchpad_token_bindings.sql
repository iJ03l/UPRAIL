-- Launchpad-native creator-fee routing. A launchpad points creator fees at the
-- escrow holding account and registers the token with the X handle that should
-- receive them. This removes the token-description dependency for integrated
-- launches while keeping the zero-integration description path as a fallback.

CREATE TABLE IF NOT EXISTS launchpad_token_bindings (
  token TEXT PRIMARY KEY,
  launchpad TEXT NOT NULL,
  launchpad_name TEXT,
  handle TEXT NOT NULL,
  authority TEXT,
  verification_json TEXT,
  claim_json TEXT,
  launch_id TEXT,
  verified_fee_to TEXT NOT NULL,
  pending_claim_tx TEXT,
  pending_claim_at INTEGER,
  pending_claim_token_atomic TEXT,
  pending_claim_quote_atomic TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_launchpad_token_bindings_handle
  ON launchpad_token_bindings(handle);
CREATE INDEX IF NOT EXISTS idx_launchpad_token_bindings_launchpad
  ON launchpad_token_bindings(launchpad);
CREATE INDEX IF NOT EXISTS idx_launchpad_token_bindings_pending
  ON launchpad_token_bindings(pending_claim_tx);
CREATE INDEX IF NOT EXISTS idx_launchpad_token_bindings_claim
  ON launchpad_token_bindings(claim_json);
