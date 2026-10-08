/**
 * PostgreSQL Database Client for UPRAIL
 * Connects via connection string (DATABASE_URL) or Cloudflare Hyperdrive
 */

import postgres from 'postgres';
import type { Env, Payment, PaymentStatus, Session, XIdentity } from '../types';

let cachedSql: postgres.Sql | null = null;

export function getDb(env: Env): postgres.Sql {
  if (cachedSql) {
    return cachedSql;
  }

  // Support direct DATABASE_URL or Hyperdrive connection string
  const connectionString =
    (env as any).DATABASE_URL ||
    (env as any).HYPERDRIVE?.connectionString ||
    'postgres://postgres@127.0.0.1:5432/uprail';

  cachedSql = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 5,
    onnotice: () => {}, // Suppress notice logs
  });

  return cachedSql;
}

// -------------------------------------------------------------
// Identity & Auth Queries
// -------------------------------------------------------------

export async function upsertXIdentity(
  sql: postgres.Sql,
  data: { x_id: string; x_handle: string; x_name: string }
): Promise<XIdentity> {
  const [row] = await sql<XIdentity[]>`
    INSERT INTO x_identities (x_id, x_handle, x_name, created_at, updated_at)
    VALUES (${data.x_id}, ${data.x_handle.toLowerCase()}, ${data.x_name}, NOW(), NOW())
    ON CONFLICT (x_id) DO UPDATE SET
      x_handle = EXCLUDED.x_handle,
      x_name = EXCLUDED.x_name,
      updated_at = NOW()
    RETURNING x_id, x_handle, x_name, near_account, 
              EXTRACT(EPOCH FROM created_at) * 1000 AS created_at,
              EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at
  `;
  return row;
}

export async function getXIdentity(
  sql: postgres.Sql,
  xId: string
): Promise<XIdentity | null> {
  const [row] = await sql<XIdentity[]>`
    SELECT x_id, x_handle, x_name, near_account,
           EXTRACT(EPOCH FROM created_at) * 1000 AS created_at,
           EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at
    FROM x_identities
    WHERE x_id = ${xId}
  `;
  return row || null;
}

export async function updateIdentityNearAccount(
  sql: postgres.Sql,
  xId: string,
  nearAccount: string
): Promise<void> {
  await sql`
    UPDATE x_identities
    SET near_account = ${nearAccount}, updated_at = NOW()
    WHERE x_id = ${xId}
  `;
}

// -------------------------------------------------------------
// Session Management
// -------------------------------------------------------------

export async function saveSession(
  sql: postgres.Sql,
  session: Session
): Promise<void> {
  await sql`
    INSERT INTO user_sessions (session_id, x_id, x_handle, x_name, near_account, created_at, expires_at)
    VALUES (
      ${session.session_id},
      ${session.x_id},
      ${session.x_handle.toLowerCase()},
      ${session.x_name},
      ${session.near_account || null},
      TO_TIMESTAMP(${session.created_at} / 1000.0),
      TO_TIMESTAMP(${session.expires_at} / 1000.0)
    )
    ON CONFLICT (session_id) DO UPDATE SET
      near_account = EXCLUDED.near_account,
      expires_at = EXCLUDED.expires_at
  `;
}

export async function getSession(
  sql: postgres.Sql,
  sessionId: string
): Promise<Session | null> {
  const [row] = await sql<any[]>`
    SELECT session_id, x_id, x_handle, x_name, near_account,
           ROUND(EXTRACT(EPOCH FROM created_at) * 1000) AS created_at,
           ROUND(EXTRACT(EPOCH FROM expires_at) * 1000) AS expires_at
    FROM user_sessions
    WHERE session_id = ${sessionId} AND expires_at > NOW()
  `;
  if (!row) return null;
  return {
    session_id: row.session_id,
    x_id: row.x_id,
    x_handle: row.x_handle,
    x_name: row.x_name,
    near_account: row.near_account,
    created_at: Number(row.created_at),
    expires_at: Number(row.expires_at),
  };
}

export async function deleteSession(
  sql: postgres.Sql,
  sessionId: string
): Promise<void> {
  await sql`
    DELETE FROM user_sessions WHERE session_id = ${sessionId}
  `;
}

// -------------------------------------------------------------
// WebAuthn Passkeys & Challenges
// -------------------------------------------------------------

export async function saveAuthChallenge(
  sql: postgres.Sql,
  xId: string,
  challenge: string,
  purpose: string = 'registration',
  ttlSeconds: number = 300
): Promise<void> {
  await sql`
    INSERT INTO auth_challenges (x_id, challenge, purpose, created_at, expires_at)
    VALUES (
      ${xId},
      ${challenge},
      ${purpose},
      NOW(),
      NOW() + (${ttlSeconds} || ' seconds')::INTERVAL
    )
  `;
}

export async function consumeAuthChallenge(
  sql: postgres.Sql,
  xId: string,
  purpose: string = 'registration'
): Promise<string | null> {
  const [row] = await sql<any[]>`
    DELETE FROM auth_challenges
    WHERE id = (
      SELECT id FROM auth_challenges
      WHERE x_id = ${xId} AND purpose = ${purpose} AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    )
    RETURNING challenge
  `;
  return row ? row.challenge : null;
}

export async function savePasskey(
  sql: postgres.Sql,
  data: {
    x_id: string;
    credential_id: string;
    public_key: string;
    counter: number;
    transports: string[];
  }
): Promise<void> {
  await sql`
    INSERT INTO passkeys (x_id, credential_id, public_key, counter, transports, created_at)
    VALUES (
      ${data.x_id},
      ${data.credential_id},
      ${data.public_key},
      ${data.counter},
      ${JSON.stringify(data.transports)}::jsonb,
      NOW()
    )
    ON CONFLICT (credential_id) DO UPDATE SET
      public_key = EXCLUDED.public_key,
      counter = EXCLUDED.counter,
      transports = EXCLUDED.transports
  `;
}

// -------------------------------------------------------------
// Payments & Intents
// -------------------------------------------------------------

export async function insertPayment(
  sql: postgres.Sql,
  payment: Payment
): Promise<void> {
  await sql`
    INSERT INTO payments (
      id, sender_x_id, sender_x_handle, recipient_handle, asset, amount,
      status, deposit_address, intent_hash, claim_tx_hash, refund_tx_hash,
      created_at, expires_at, updated_at
    ) VALUES (
      ${payment.id},
      ${payment.sender_x_id ?? null},
      ${payment.sender_x_handle ?? null},
      ${payment.recipient_handle.toLowerCase()},
      ${payment.asset},
      ${payment.amount},
      ${payment.status},
      ${payment.deposit_address ?? null},
      ${payment.intent_hash ?? null},
      ${payment.claim_tx_hash ?? null},
      ${payment.refund_tx_hash ?? null},
      TO_TIMESTAMP(${payment.created_at} / 1000.0),
      TO_TIMESTAMP(${payment.expires_at} / 1000.0),
      TO_TIMESTAMP(${payment.updated_at} / 1000.0)
    )
  `;
}

export async function getPaymentById(
  sql: postgres.Sql,
  paymentId: string
): Promise<Payment | null> {
  const [row] = await sql<any[]>`
    SELECT id, sender_x_id, sender_x_handle, recipient_handle, asset, amount,
           status, deposit_address, intent_hash, claim_tx_hash, refund_tx_hash,
           ROUND(EXTRACT(EPOCH FROM created_at) * 1000) AS created_at,
           ROUND(EXTRACT(EPOCH FROM expires_at) * 1000) AS expires_at,
           ROUND(EXTRACT(EPOCH FROM updated_at) * 1000) AS updated_at
    FROM payments
    WHERE id = ${paymentId}
  `;
  if (!row) return null;
  return {
    ...row,
    created_at: Number(row.created_at),
    expires_at: Number(row.expires_at),
    updated_at: Number(row.updated_at),
  };
}

export async function getUserPayments(
  sql: postgres.Sql,
  xId: string,
  handle: string
): Promise<Payment[]> {
  const rows = await sql<any[]>`
    SELECT id, sender_x_id, sender_x_handle, recipient_handle, asset, amount,
           status, deposit_address, intent_hash, claim_tx_hash, refund_tx_hash,
           ROUND(EXTRACT(EPOCH FROM created_at) * 1000) AS created_at,
           ROUND(EXTRACT(EPOCH FROM expires_at) * 1000) AS expires_at,
           ROUND(EXTRACT(EPOCH FROM updated_at) * 1000) AS updated_at
    FROM payments
    WHERE sender_x_id = ${xId} OR LOWER(recipient_handle) = ${handle.toLowerCase()}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return rows.map((r) => ({
    ...r,
    created_at: Number(r.created_at),
    expires_at: Number(r.expires_at),
    updated_at: Number(r.updated_at),
  }));
}

export async function getPendingPaymentsForRecipient(
  sql: postgres.Sql,
  handle: string
): Promise<Payment[]> {
  const rows = await sql<any[]>`
    SELECT id, sender_x_id, sender_x_handle, recipient_handle, asset, amount,
           status, deposit_address, intent_hash, claim_tx_hash, refund_tx_hash,
           ROUND(EXTRACT(EPOCH FROM created_at) * 1000) AS created_at,
           ROUND(EXTRACT(EPOCH FROM expires_at) * 1000) AS expires_at,
           ROUND(EXTRACT(EPOCH FROM updated_at) * 1000) AS updated_at
    FROM payments
    WHERE LOWER(recipient_handle) = ${handle.toLowerCase()}
      AND status IN ('PENDING', 'DEPOSIT_WAITING', 'ESCROWED')
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    ...r,
    created_at: Number(r.created_at),
    expires_at: Number(r.expires_at),
    updated_at: Number(r.updated_at),
  }));
}

export async function updatePaymentStatus(
  sql: postgres.Sql,
  paymentId: string,
  status: PaymentStatus,
  extra?: { claimTxHash?: string; refundTxHash?: string }
): Promise<void> {
  await sql`
    UPDATE payments
    SET status = ${status},
        claim_tx_hash = COALESCE(${extra?.claimTxHash ?? null}, claim_tx_hash),
        refund_tx_hash = COALESCE(${extra?.refundTxHash ?? null}, refund_tx_hash),
        updated_at = NOW()
    WHERE id = ${paymentId}
  `;
}
