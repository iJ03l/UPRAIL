import type { Env } from '../types';

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]+$/;

export type AgentRequestClaim =
  | { state: 'new' }
  | { state: 'replay'; paymentId: string | null }
  | { state: 'in_progress' }
  | { state: 'unknown' }
  | { state: 'unavailable' };

export type AgentRequestFailure = 'FAILED' | 'UNKNOWN';

export function normalizeIdempotencyKey(
  raw: unknown
): { ok: true; key: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, key: null };
  if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false };
  const key = String(raw).trim();
  if (!key) return { ok: true, key: null };
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !IDEMPOTENCY_KEY_RE.test(key)) {
    return { ok: false };
  }
  return { ok: true, key };
}

async function getRequest(env: Env, keyId: string, idempotencyKey: string) {
  return env.DB!.prepare(
    `SELECT id, payment_id, status
       FROM agent_requests
      WHERE agent_key_id = ? AND idempotency_key = ?`
  )
    .bind(keyId, idempotencyKey)
    .first<{ id: string; payment_id: string | null; status: string }>();
}

export async function claimAgentRequest(
  env: Env,
  keyId: string,
  idempotencyKey: string
): Promise<AgentRequestClaim> {
  if (!env.DB) return { state: 'unavailable' };

  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO agent_requests
        (id, agent_key_id, idempotency_key, payment_id, status, created_at)
       VALUES (?, ?, ?, NULL, 'PENDING', ?)`
    )
      .bind(crypto.randomUUID(), keyId, idempotencyKey, now)
      .run();
    return { state: 'new' };
  } catch {
  }

  let row: { id: string; payment_id: string | null; status: string } | null;
  try {
    row = await getRequest(env, keyId, idempotencyKey);
  } catch {
    return { state: 'unavailable' };
  }
  if (!row) return { state: 'unavailable' };

  if (row.status === 'COMPLETED') {
    return { state: 'replay', paymentId: row.payment_id };
  }
  if (row.status === 'UNKNOWN') {
    return { state: 'unknown' };
  }
  if (row.status === 'FAILED') {
    try {
      const retried = await env.DB.prepare(
        `UPDATE agent_requests
            SET status = 'PENDING', payment_id = NULL, created_at = ?
          WHERE id = ? AND status = 'FAILED'`
      )
        .bind(now, row.id)
        .run();
      if ((retried.meta?.changes ?? 0) > 0) return { state: 'new' };
    } catch {}
  }

  return { state: 'in_progress' };
}

export async function completeAgentRequest(
  env: Env,
  keyId: string,
  idempotencyKey: string,
  paymentId: string
): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const result = await env.DB.prepare(
      `UPDATE agent_requests
          SET status = 'COMPLETED', payment_id = ?
        WHERE agent_key_id = ? AND idempotency_key = ? AND status = 'PENDING'`
    )
      .bind(paymentId, keyId, idempotencyKey)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function failAgentRequest(
  env: Env,
  keyId: string,
  idempotencyKey: string,
  status: AgentRequestFailure
): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE agent_requests
          SET status = ?
        WHERE agent_key_id = ? AND idempotency_key = ? AND status = 'PENDING'`
    )
      .bind(status, keyId, idempotencyKey)
      .run();
  } catch {}
}
