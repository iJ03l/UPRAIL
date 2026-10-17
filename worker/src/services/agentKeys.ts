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

/** True when a string looks like one of our agent keys (cheap pre-filter). */
export function looksLikeAgentKey(value: string): boolean {
  return typeof value === 'string' && value.startsWith(KEY_PREFIX);
}

/**
 * Parses a stored allowlist (JSON array) into normalized entries. Accepts
 * '@Handle' or a wallet address; handles are lowercased and stripped of '@'.
 * Returns null when the raw value is absent or not a usable array, meaning
 * "no recipient restriction".
 */
export function parseAllowlist(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const out = parsed
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(normalizeRecipient);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Normalizes a recipient for allowlist comparison: '@Foo' → 'foo', addresses kept as-is. */
export function normalizeRecipient(value: string): string {
  const trimmed = (value || '').trim();
  // A NEAR account / 0x address / base58 address is not an X handle.
  if (/^[a-zA-Z0-9_.-]+\.(near|testnet)$/i.test(trimmed) || /^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed.replace(/^@+/, '').toLowerCase();
}

/** UTC calendar day as YYYY-MM-DD, the bucket for daily spend. */
export function currentUtcDay(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Spend recorded for a key in the current UTC day (0 when none). */
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
 * Adds `amount` to a key's spend for the current UTC day. Best-effort: a failed
 * write is logged, never thrown — the money has already moved successfully.
 */
export async function addAgentSpend(env: Env, keyId: string, amount: number): Promise<void> {
  if (!env.DB || !(amount > 0)) return;
  const day = currentUtcDay();
  try {
    await env.DB.prepare(
      `INSERT INTO agent_spend (agent_key_id, day, spent) VALUES (?, ?, ?)
       ON CONFLICT(agent_key_id, day) DO UPDATE SET spent = CAST(CAST(agent_spend.spent AS REAL) + ? AS TEXT)`
    )
      .bind(keyId, day, String(amount), amount)
      .run();
  } catch (err) {
    console.warn('[agentKeys] spend write failed:', err);
  }
}
