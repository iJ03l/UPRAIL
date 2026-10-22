-- Signed partner webhook removed. Creator fees are detected over NEAR RPC from
-- escrow.uprail.near; no partner keys or webhook secrets are issued.
DROP INDEX IF EXISTS idx_launchpad_partners_name;
DROP TABLE IF EXISTS launchpad_partners;
