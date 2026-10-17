/**
 * Launchpad partner credentials for UP (UPRAIL.app).
 *
 * A launchpad authenticates its webhook with a bearer key (`up_lp_…`) and signs
 * each request body with a per-partner HMAC secret. Only the key's SHA-256 hash
 * is persisted; the signing secret is stored in full because HMAC verification
 * needs the raw value (it is a server-side shared secret, never returned to a
 * client after onboarding).
 *
 * Key string is self-identifying so logs and support can tell it apart from an
 * agent key (`up_agent_…`) or a session cookie without decoding anything.
 */

import type { Env } from '../types';

const KEY_PREFIX = 'up_lp_';
/** 24 random bytes → 48 hex chars. Plenty of entropy for a bearer token. */
const KEY_BYTES = 24;
/** Webhook signatures older/newer than this are rejected as replays. */
const MAX_SIGNATURE_SKEW_MS = 5 * 60 * 1000;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** SHA-256 hex of a key. Deterministic — this is what is stored and looked up. */
export async function hashPartnerKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return toHex(new Uint8Array(digest));
}

export interface GeneratedPartnerKey {
  /** Full secret. Returned to the caller once and never stored. */
  plaintext: string;
  hash: string;
  /** Short, non-secret prefix for display (e.g. "up_lp_ab12cd"). */
  prefix: string;
}

export async function generatePartnerKey(): Promise<GeneratedPartnerKey> {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  const secret = toHex(bytes);
  const plaintext = `${KEY_PREFIX}${secret}`;
  return {
    plaintext,
    hash: await hashPartnerKey(plaintext),
    prefix: `${KEY_PREFIX}${secret.slice(0, 6)}`,
  };
}

/** 32 random bytes as hex — the per-partner webhook signing secret. */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** True when a string looks like one of our partner keys (cheap pre-filter). */
export function looksLikePartnerKey(value: string): boolean {
  return typeof value === 'string' && value.startsWith(KEY_PREFIX);
}

export interface LaunchpadPartner {
  id: string;
  name: string;
  webhook_secret: string;
  daily_reg_cap: number;
  regs_today: number;
  regs_day: string | null;
  revoked_at: number | null;
}

/**
 * Resolves an `Authorization: Bearer up_lp_…` header to its partner row, or
 * null when the key is absent, unknown, or revoked. Lookup is by key hash, so
 * the plaintext key is never compared or stored.
 */
export async function verifyPartnerKey(
  env: Env,
  authorization: string | undefined
): Promise<LaunchpadPartner | null> {
  if (!env.DB) return null;
  const match = /^Bearer\s+(.+)$/i.exec((authorization || '').trim());
  const rawKey = match?.[1]?.trim();
  if (!rawKey || !looksLikePartnerKey(rawKey)) return null;

  try {
    const row = await env.DB.prepare(
      `SELECT id, name, webhook_secret, daily_reg_cap, regs_today, regs_day, revoked_at
         FROM launchpad_partners
        WHERE key_hash = ?`
    )
      .bind(await hashPartnerKey(rawKey))
      .first<LaunchpadPartner>();
    if (!row || row.revoked_at) return null;
    return row;
  } catch (err) {
    console.error('[launchpadKeys] partner lookup failed:', err);
    return null;
  }
}

/** Constant-time-ish string comparison for hex signatures. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(new Uint8Array(sig));
}

/**
 * Builds the `X-UPRAIL-Signature` header value for a raw body:
 *   `t=<unix seconds>,v1=<hex(hmac_sha256(secret, "<t>.<rawBody>"))>`
 * Exposed for tests and documentation.
 */
export async function buildWebhookSignature(
  secret: string,
  rawBody: string,
  at: number = Date.now()
): Promise<string> {
  const t = Math.floor(at / 1000);
  const v1 = await hmacHex(secret, `${t}.${rawBody}`);
  return `t=${t},v1=${v1}`;
}

/**
 * Verifies an `X-UPRAIL-Signature` header against the raw request body.
 * Rejects malformed headers, missing parts, and timestamps outside the allowed
 * skew window (replay protection). Returns false on any doubt.
 */
export async function verifyWebhookSignature(
  secret: string,
  header: string | undefined,
  rawBody: string,
  now: number = Date.now()
): Promise<boolean> {
  if (!secret || !header) return false;
  let t = '';
  let v1 = '';
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') t = (v || '').trim();
    else if (k === 'v1') v1 = (v || '').trim();
  }
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now - ts * 1000) > MAX_SIGNATURE_SKEW_MS) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return safeEqual(expected, v1.toLowerCase());
}
