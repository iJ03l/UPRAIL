/**
 * Agent API-key primitives for UP (UPRAIL.app).
 *
 * Keys are bearer credentials shown to the user exactly once. Only a SHA-256
 * hash is persisted, so a database read can never yield a usable key. The key
 * string is self-identifying (`up_agent_<hex>`) so logs and support can tell it
 * apart from a session cookie without decoding anything.
 */

import type { Env } from '../types';

const KEY_PREFIX = 'up_agent_';
const AGENT_KEY_RE = new RegExp(`^${KEY_PREFIX}[0-9a-f]{48}$`);
/** 24 random bytes → 48 hex chars. Plenty of entropy for a bearer token. */
const KEY_BYTES = 24;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** SHA-256 hex of a key. Deterministic — this is what is stored and looked up. */
export async function hashAgentKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return toHex(new Uint8Array(digest));
}

export interface GeneratedAgentKey {
  /** Full secret. Returned to the caller once and never stored. */
  plaintext: string;
  hash: string;
  /** Short, non-secret prefix for display (e.g. "up_agent_ab12cd"). */
  prefix: string;
}

export async function generateAgentKey(): Promise<GeneratedAgentKey> {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  const secret = toHex(bytes);
  const plaintext = `${KEY_PREFIX}${secret}`;
  return {
    plaintext,
    hash: await hashAgentKey(plaintext),
    prefix: `${KEY_PREFIX}${secret.slice(0, 6)}`,
  };
}

/** True when a string is exactly one of our agent keys (cheap pre-filter). */
export function looksLikeAgentKey(value: string): boolean {
  return typeof value === 'string' && AGENT_KEY_RE.test(value);
}

/** UTC calendar day as YYYY-MM-DD, the bucket for daily spend. */
export function currentUtcDay(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** USD spend recorded for a key in the current UTC day (0 when none). */
export async function getAgentSpendToday(env: Env, keyId: string): Promise<number> {
  if (!env.DB) return 0;
  try {
    const row = await env.DB.prepare(
      'SELECT spent FROM agent_spend WHERE agent_key_id = ? AND day = ?'
    )
      .bind(keyId, currentUtcDay())
      .first<{ spent: string | null }>();
    return parseFloat(row?.spent || '0') || 0;
  } catch (err) {
    console.warn('[agentKeys] spend read failed:', err);
    return 0;
  }
}

/**
 * Atomically reserves `usd` against a key's daily cap BEFORE any funds move.
 * The conditional upsert only applies when the new total stays within the cap,
 * so two concurrent requests can never both slip under it. Returns false when
 * the reservation would exceed the cap (or the DB is unavailable — fail closed).
 */
export async function reserveAgentSpend(
  env: Env,
  keyId: string,
  usd: number,
  dailyLimitUsd: number
): Promise<boolean> {
  if (!env.DB || !(usd > 0) || usd > dailyLimitUsd + 1e-9) return false;
  try {
    const res = await env.DB.prepare(
      `INSERT INTO agent_spend (agent_key_id, day, spent) VALUES (?, ?, ?)
       ON CONFLICT(agent_key_id, day) DO UPDATE
         SET spent = CAST(CAST(agent_spend.spent AS REAL) + ? AS TEXT)
         WHERE CAST(agent_spend.spent AS REAL) + ? <= ?`
    )
      .bind(keyId, currentUtcDay(), String(usd), usd, usd, dailyLimitUsd + 1e-9)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  } catch (err) {
    console.error('[agentKeys] spend reservation failed:', err);
    return false;
  }
}

/** Returns a reservation when the payment did not go through. Best-effort. */
export async function releaseAgentSpend(env: Env, keyId: string, usd: number): Promise<void> {
  if (!env.DB || !(usd > 0)) return;
  try {
    await env.DB.prepare(
      `UPDATE agent_spend
          SET spent = CAST(MAX(0, CAST(spent AS REAL) - ?) AS TEXT)
        WHERE agent_key_id = ? AND day = ?`
    )
      .bind(usd, keyId, currentUtcDay())
      .run();
  } catch (err) {
    console.warn('[agentKeys] spend release failed:', err);
  }
}
