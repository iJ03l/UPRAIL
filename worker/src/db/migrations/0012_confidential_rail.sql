-- Confidential Intents rail: explicit privacy provenance and settlement state.
-- Existing rows keep the public rail so no historical payment is relabeled.

ALTER TABLE payments ADD COLUMN privacy_rail TEXT NOT NULL DEFAULT 'public';
ALTER TABLE payments ADD COLUMN settlement_status TEXT;
ALTER TABLE payments ADD COLUMN claim_deposit_address TEXT;
ALTER TABLE payments ADD COLUMN confirmed_at INTEGER;

ALTER TABLE withdrawals ADD COLUMN privacy_rail TEXT NOT NULL DEFAULT 'public';
ALTER TABLE withdrawals ADD COLUMN settlement_status TEXT;
ALTER TABLE withdrawals ADD COLUMN deposit_address TEXT;
ALTER TABLE withdrawals ADD COLUMN intent_hash TEXT;
ALTER TABLE withdrawals ADD COLUMN confirmed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_payments_privacy_rail ON payments(privacy_rail);
CREATE INDEX IF NOT EXISTS idx_payments_settlement_status ON payments(settlement_status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_privacy_rail ON withdrawals(privacy_rail);
CREATE INDEX IF NOT EXISTS idx_withdrawals_settlement_status ON withdrawals(settlement_status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_deposit_address ON withdrawals(deposit_address);

-- One row per user/asset migration attempt. The unique key makes the migration
-- idempotent and lets an operator resume after a failed broadcast without
-- double-shielding the same funds.
CREATE TABLE IF NOT EXISTS confidential_balance_migrations (
  id TEXT PRIMARY KEY,
  x_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  source_rail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  deposit_address TEXT,
  intent_hash TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(x_id, asset, source_rail)
);

CREATE INDEX IF NOT EXISTS idx_confidential_migrations_status
  ON confidential_balance_migrations(status);
CREATE INDEX IF NOT EXISTS idx_confidential_migrations_x_id
  ON confidential_balance_migrations(x_id);
