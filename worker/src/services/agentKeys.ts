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

export const AGENT_DEFAULT_PER_TX_USD = 25;
export const AGENT_DEFAULT_DAILY_USD = 100;
export const AGENT_MAX_LIMIT_USD = 100_000;
export const AGENT_MAX_NAME_LENGTH = 48;

/** Parse a positive USD limit, rounded to cents. Returns null when invalid. */
export function parseAgentUsdLimit(value: unknown, fallback: number): number | null {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > AGENT_MAX_LIMIT_USD) return null;
  const rounded = Math.round(n * 100) / 100;
  return rounded >= 0.01 ? rounded : null;
}

export interface AgentKeyRow {
  id: string;
  agent_id: string;
  x_id: string;
  label: string | null;
  key_prefix: string;
  per_tx_limit: string | null;
  daily_limit: string | null;
  expires_at: number | null;
  revoked_at: number | null;
  auth_method: 'key' | 'oauth';
  oauth_client_id: string | null;
  oauth_client_name: string | null;
}

const AGENT_KEY_COLUMNS = `id, agent_id, x_id, label, key_prefix, per_tx_limit, daily_limit,
  expires_at, revoked_at, auth_method, oauth_client_id, oauth_client_name`;

/** Resolve a manual Bearer key to its policy row. OAuth tokens never match this. */
export async function findAgentKeyByRawKey(env: Env, rawKey: string): Promise<AgentKeyRow | null> {
  if (!env.DB || !looksLikeAgentKey(rawKey)) return null;
  const keyHash = await hashAgentKey(rawKey);
  return await env.DB.prepare(
    `SELECT ${AGENT_KEY_COLUMNS} FROM agent_keys WHERE key_hash = ?`
  )
    .bind(keyHash)
    .first<AgentKeyRow>();
}

/** Resolve an agent key by id (OAuth token props and dashboard paths). */
export async function getAgentKeyById(env: Env, keyId: string): Promise<AgentKeyRow | null> {
  if (!env.DB) return null;
  return await env.DB.prepare(
    `SELECT ${AGENT_KEY_COLUMNS} FROM agent_keys WHERE id = ?`
  )
    .bind(keyId)
    .first<AgentKeyRow>();
}

export interface OAuthAgentKeyInput {
  xId: string;
  clientId: string;
  clientName: string;
  perTxUsd: number;
  dailyUsd: number;
  expiresAt: number;
}

export interface OAuthAgentKeyResult {
  keyId: string;
  agentId: string;
  name: string;
  created: boolean;
}

/**
 * Create or reuse the OAuth connection row for one user + OAuth client. A
 * reauthorization extends the same connection rather than creating duplicates.
 * No plaintext key exists for OAuth rows; the stored hash is random and unused.
 */
export async function upsertOAuthAgentKey(
  env: Env,
  input: OAuthAgentKeyInput
): Promise<OAuthAgentKeyResult> {
  const name = input.clientName.trim().slice(0, AGENT_MAX_NAME_LENGTH) || 'AI chat';
  const existing = await env.DB.prepare(
    `SELECT id, agent_id FROM agent_keys
      WHERE x_id = ? AND oauth_client_id = ? AND auth_method = 'oauth' AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`
  )
    .bind(input.xId, input.clientId)
    .first<{ id: string; agent_id: string }>();

  const now = Date.now();
  if (existing) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE agent_keys
            SET per_tx_limit = ?, daily_limit = ?, expires_at = ?,
                oauth_client_name = ?, label = COALESCE(label, ?)
          WHERE id = ? AND x_id = ?`
      ).bind(
        String(input.perTxUsd),
        String(input.dailyUsd),
        input.expiresAt,
        name,
        name,
        existing.id,
        input.xId
      ),
      env.DB.prepare('UPDATE agents SET name = ?, updated_at = ? WHERE id = ? AND x_id = ?')
        .bind(name, now, existing.agent_id, input.xId),
    ]);
    return { keyId: existing.id, agentId: existing.agent_id, name, created: false };
  }

  const agentId = crypto.randomUUID();
  const keyId = crypto.randomUUID();
  const generated = await generateAgentKey();
  const prefix = `oauth_${generated.prefix.slice(KEY_PREFIX.length)}`;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO agents (id, x_id, name, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(agentId, input.xId, name, 'autonomous', now, now),
    env.DB.prepare(
      `INSERT INTO agent_keys
        (id, agent_id, x_id, label, key_hash, key_prefix, asset, per_tx_limit, daily_limit,
         allowlist, expires_at, created_at, auth_method, oauth_client_id, oauth_client_name)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, 'oauth', ?, ?)`
    ).bind(
      keyId,
      agentId,
      input.xId,
      name,
      generated.hash,
      prefix,
      String(input.perTxUsd),
      String(input.dailyUsd),
      input.expiresAt,
      now,
      input.clientId,
      name
    ),
  ]);

  return { keyId, agentId, name, created: true };
}

/** Remove a key created by an aborted OAuth consent. */
export async function deleteAbortedOAuthAgentKey(
  env: Env,
  keyId: string,
  agentId: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM agent_spend WHERE agent_key_id = ?').bind(keyId),
    env.DB.prepare('DELETE FROM agent_requests WHERE agent_key_id = ?').bind(keyId),
    env.DB.prepare('DELETE FROM agent_keys WHERE id = ?').bind(keyId),
    env.DB.prepare(
      'DELETE FROM agents WHERE id = ? AND NOT EXISTS (SELECT 1 FROM agent_keys WHERE agent_id = ?)'
    ).bind(agentId, agentId),
  ]);
}
