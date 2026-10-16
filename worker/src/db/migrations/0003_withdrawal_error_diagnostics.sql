-- Migration 0003_withdrawal_error_diagnostics.sql
--
-- Persist WHY a withdrawal failed so a support report ("my withdrawal failed")
-- is diagnosable after the fact. Previously a failed withdrawal only carried
-- status='FAILED' with tx_hash=NULL — the actual reason lived solely in a
-- console.error that is not retained, so there was no way to answer "what
-- caused this user's withdrawal failure?" without the live tail.
--
--   * withdrawals.error       — human-readable failure reason
--   * withdrawals.error_code  — machine code (e.g. SETTLEMENT_FAILED, RAIL_UNAVAILABLE)
--   * withdrawals.rail        — settlement rail attempted (native | intents | cross_chain)

ALTER TABLE withdrawals ADD COLUMN error TEXT;
ALTER TABLE withdrawals ADD COLUMN error_code TEXT;
ALTER TABLE withdrawals ADD COLUMN rail TEXT;
