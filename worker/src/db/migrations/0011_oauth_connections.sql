-- Migration 0011_oauth_connections.sql
--
-- OAuth 2.1 connections reuse the existing agent rail. An OAuth connection has
-- no plaintext bearer key: key_hash stores a random, discarded value so the
-- unique constraint still holds. D1 remains the authoritative revocation check
-- on every MCP request, even while an OAuth token is still live in KV.

ALTER TABLE agent_keys ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'key';
ALTER TABLE agent_keys ADD COLUMN oauth_client_id TEXT;
ALTER TABLE agent_keys ADD COLUMN oauth_client_name TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_keys_oauth_client
  ON agent_keys(x_id, oauth_client_id);
