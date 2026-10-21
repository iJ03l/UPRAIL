-- Migration 0008_recovery_code_ciphertext.sql
--
-- Makes unused recovery codes re-viewable in Settings without storing plaintext.
-- Each code is encrypted with AES-GCM using a key derived from RECOVERY_PEPPER.
-- Existing rows have NULL code_ciphertext and stay verifiable via their HMAC;
-- they become viewable after one explicit regeneration.

ALTER TABLE recovery_codes ADD COLUMN code_ciphertext TEXT;
ALTER TABLE recovery_codes ADD COLUMN code_index INTEGER;
