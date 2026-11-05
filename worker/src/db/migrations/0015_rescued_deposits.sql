-- Migration 0015_rescued_deposits.sql
-- Tracks on-chain deposits to quote addresses that require escrow recovery

CREATE TABLE IF NOT EXISTS rescued_deposits (
  address TEXT NOT NULL,
  contract TEXT NOT NULL,
  account_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (address, contract)
);
