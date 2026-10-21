-- Migration 0006_payment_cancel_reason.sql
--
-- A CANCELLED payment used to carry no explanation: the row was flipped to
-- CANCELLED after a settlement error (or a sender cancellation), but the
-- reason lived only in a console log. This adds a durable, user-safe reason
-- and a stable code so the History view can explain what happened.
--
--   * payments.cancel_reason — human-readable reason (already sanitized by
--                              publicErrorMessage before it is stored)
--   * payments.cancel_code   — USER_CANCELLED | SETTLEMENT_FAILED | ESCROW_LOCK_FAILED

ALTER TABLE payments ADD COLUMN cancel_reason TEXT;
ALTER TABLE payments ADD COLUMN cancel_code TEXT;
