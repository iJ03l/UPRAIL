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

export interface ClaimAgentRequestOptions {
  /**
   * Optional deduplication window (ms) for completed/in-progress requests.
   * Used by server-side intent fingerprints so automatic LLM retries within
   * the window are caught even if the model mutates or omits `idempotencyKey`,
   * while intentional repeat sends after the window still work.
   */
  windowMs?: number;
  /** Optional window (ms) for ambiguous (`UNKNOWN`) outcomes. Defaults to `windowMs`. */
  unknownWindowMs?: number;
}

export const AGENT_FINGERPRINT_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
export const AGENT_FINGERPRINT_UNKNOWN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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

function normalizeFingerprintAmount(amount: string | number): string {
  const str = String(amount ?? '').trim();
  const num = Number(str);
  return Number.isFinite(num) && num > 0 ? num.toString() : str;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes a canonical server-side fingerprint key (`fp:<hex>`) for an agent
 * payment intent so retries that omit or mutate `idempotencyKey` (e.g.
 * appending `-retry`) still resolve to the same deduplication lock.
 */
export async function buildAgentPayFingerprint(
  recipients: Array<{ handle: string; amount: string }>,
  asset: string
): Promise<string> {
  const normAsset = String(asset || '').trim().toUpperCase();
  const normRecipients = recipients
    .map(
      (r) =>
        `${String(r.handle || '').trim().replace(/^@+/, '').toLowerCase()}:${normalizeFingerprintAmount(r.amount)}`
    )
    .sort()
    .join(',');
  const hash = await sha256Hex(`pay|${normAsset}|${normRecipients}`);
  return `fp:${hash.slice(0, 48)}`;
}

/**
 * Computes a canonical server-side fingerprint key (`fp:<hex>`) for an agent
 * withdrawal intent.
 */
export async function buildAgentWithdrawFingerprint(
  destinationAddress: string,
  destinationChain: string | undefined,
  asset: string,
  amount: string
): Promise<string> {
  const normAsset = String(asset || '').trim().toUpperCase();
  const normChain = String(destinationChain || '').trim().toLowerCase();
  const normAddr = String(destinationAddress || '').trim();
  const normAmt = normalizeFingerprintAmount(amount);
  const hash = await sha256Hex(`withdraw|${normAsset}|${normChain}|${normAddr}|${normAmt}`);
  return `fp:${hash.slice(0, 48)}`;
}

async function getRequest(env: Env, keyId: string, idempotencyKey: string) {
  return env.DB!.prepare(
    `SELECT id, payment_id, status, created_at
       FROM agent_requests
      WHERE agent_key_id = ? AND idempotency_key = ?`
  )
    .bind(keyId, idempotencyKey)
    .first<{ id: string; payment_id: string | null; status: string; created_at: number }>();
}

export async function claimAgentRequest(
  env: Env,
  keyId: string,
  idempotencyKey: string,
  options?: ClaimAgentRequestOptions
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

  let row: { id: string; payment_id: string | null; status: string; created_at: number } | null;
  try {
    row = await getRequest(env, keyId, idempotencyKey);
  } catch {
    return { state: 'unavailable' };
  }
  if (!row) return { state: 'unavailable' };

  const windowMs = options?.windowMs;
  const unknownWindowMs = options?.unknownWindowMs ?? windowMs;
  const ageMs = Math.max(0, now - Number(row.created_at || 0));

  const expiredByWindow =
    (row.status === 'COMPLETED' && typeof windowMs === 'number' && ageMs >= windowMs) ||
    (row.status === 'PENDING' && typeof windowMs === 'number' && ageMs >= windowMs) ||
    (row.status === 'UNKNOWN' && typeof unknownWindowMs === 'number' && ageMs >= unknownWindowMs);

  if (row.status === 'FAILED' || expiredByWindow) {
    try {
      const retried = await env.DB.prepare(
        `UPDATE agent_requests
            SET status = 'PENDING', payment_id = NULL, created_at = ?
          WHERE id = ? AND status = ? AND created_at = ?`
      )
        .bind(now, row.id, row.status, row.created_at)
        .run();
      if ((retried.meta?.changes ?? 0) > 0) return { state: 'new' };
    } catch {}
  }

  if (row.status === 'COMPLETED') {
    return { state: 'replay', paymentId: row.payment_id };
  }
  if (row.status === 'UNKNOWN') {
    return { state: 'unknown' };
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

