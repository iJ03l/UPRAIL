-- 0013_contacts_and_requests.sql
-- Contacts / "People you pay" and UPRAIL Payment Requests

-- 1. Contacts: Persistent, user-controlled list of trusted or frequently used recipients
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  user_x_id TEXT NOT NULL,
  contact_handle TEXT NOT NULL,
  contact_x_id TEXT,
  nickname TEXT,
  preferred_amount TEXT,
  preferred_asset TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_x_id) REFERENCES x_identities(x_id) ON DELETE CASCADE,
  UNIQUE(user_x_id, contact_handle)
);

CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_x_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_contacts_handle ON contacts(contact_handle);

-- 2. Payment Requests: P2P payment requests through 𝕏 handles
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  requester_x_id TEXT NOT NULL,
  requester_handle TEXT NOT NULL,
  requested_handle TEXT NOT NULL,
  requested_x_id TEXT,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  amount_formatted TEXT NOT NULL,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  decline_reason TEXT,
  payment_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY(requester_x_id) REFERENCES x_identities(x_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_requests_target ON payment_requests(requested_handle, status);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON payment_requests(requester_x_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_status ON payment_requests(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_requests_created ON payment_requests(created_at);

-- 3. Request Blocks: Anti-spam and blocking table
CREATE TABLE IF NOT EXISTS request_blocks (
  user_x_id TEXT NOT NULL,
  blocked_handle TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_x_id, blocked_handle),
  FOREIGN KEY(user_x_id) REFERENCES x_identities(x_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_request_blocks_user ON request_blocks(user_x_id);
