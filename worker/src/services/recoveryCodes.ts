/**
 * One-time passkey recovery codes.
 *
 * Codes are high-entropy (16 Crockford-base32 characters ≈ 80 bits), so only
 * an HMAC-SHA-256 digest is stored. A dedicated RECOVERY_PEPPER keeps these
 * hashes independent from session-cookie keys: rotating SESSION_SECRET must
 * not invalidate every user's recovery codes.
 *
 * Plaintext codes are returned exactly once, at generation time. They are
 * never persisted server-side and never re-readable from the status endpoint.
 */

import type { Env } from '../types';
import { requireRecoveryPepper } from '../utils/secrets';

export const RECOVERY_CODE_COUNT = 10;
const CODE_LENGTH = 16;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface RecoveryStatus {
  hasCodes: boolean;
  remaining: number;
}

export interface RecoveryGenerationResult extends RecoveryStatus {
  codes: string[];
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let raw = '';
  // 256 is an exact multiple of 32, so modulo introduces no bias.
  for (const byte of bytes) raw += ALPHABET[byte % ALPHABET.length];
  return raw;
}

function formatCode(raw: string): string {
  return raw.match(/.{1,4}/g)?.join('-') || raw;
}

/**
 * Accept human input: case-insensitive, dashes/spaces ignored, and the usual
 * Crockford substitutions (I/L → 1, O → 0). Returns null when the shape is not
 * a recovery code.
 */
export function normalizeRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (normalized.length !== CODE_LENGTH) return null;
  for (const char of normalized) {
    if (!ALPHABET.includes(char)) return null;
  }
  return normalized;
}

export async function hashRecoveryCode(env: Env, normalized: string): Promise<string> {
  const pepper = requireRecoveryPepper(env);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`recovery_code:${normalized}`)
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function getRecoveryStatus(env: Env, xId: string): Promise<RecoveryStatus> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS remaining FROM recovery_codes WHERE x_id = ? AND used_at IS NULL'
  )
    .bind(xId)
    .first<{ remaining: number }>();
  const remaining = Number(row?.remaining) || 0;
  return { hasCodes: remaining > 0, remaining };
}

/**
 * Generate a fresh batch. By default this is a no-op when the user already has
 * unused codes, so first-login backfill cannot silently invalidate codes the
 * user already saved. `replace` is for the explicit Settings → Regenerate path.
 */
export async function generateRecoveryCodes(
  env: Env,
  xId: string,
  opts: { replace?: boolean } = {}
): Promise<RecoveryGenerationResult | null> {
  if (!opts.replace) {
    const current = await getRecoveryStatus(env, xId);
    if (current.hasCodes) return null;
  } else {
    await env.DB.prepare('DELETE FROM recovery_codes WHERE x_id = ?').bind(xId).run();
  }

  const now = Date.now();
  const plaintext: string[] = [];
  const statements: D1PreparedStatement[] = [];
  const seen = new Set<string>();

  while (plaintext.length < RECOVERY_CODE_COUNT) {
    const raw = randomCode();
    if (seen.has(raw)) continue;
    seen.add(raw);
    plaintext.push(formatCode(raw));
    const hash = await hashRecoveryCode(env, raw);
    statements.push(
      env.DB.prepare(
        'INSERT INTO recovery_codes (id, x_id, code_hash, created_at) VALUES (?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), xId, hash, now)
    );
  }

  await env.DB.batch(statements);

  return {
    hasCodes: true,
    remaining: plaintext.length,
    codes: plaintext,
  };
}

export async function ensureRecoveryCodes(
  env: Env,
  xId: string
): Promise<RecoveryGenerationResult | null> {
  return generateRecoveryCodes(env, xId, { replace: false });
}

export type VerifyRecoveryResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'invalid' | 'expired' };

export async function verifyRecoveryCode(
  env: Env,
  xId: string,
  rawCode: unknown
): Promise<VerifyRecoveryResult> {
  const normalized = normalizeRecoveryCode(rawCode);
  if (!normalized) return { ok: false, reason: 'invalid' };

  const hash = await hashRecoveryCode(env, normalized);
  const row = await env.DB.prepare(
    'SELECT id FROM recovery_codes WHERE x_id = ? AND code_hash = ? AND used_at IS NULL'
  )
    .bind(xId, hash)
    .first<{ id: string }>();

  if (!row) return { ok: false, reason: 'invalid' };

  // Atomic single-use claim. A concurrent request that already consumed this
  // row gets changes === 0 and must not receive a recovery grant.
  const used = await env.DB.prepare(
    'UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL'
  )
    .bind(Date.now(), row.id)
    .run();

  if (!used.meta || used.meta.changes !== 1) {
    return { ok: false, reason: 'invalid' };
  }

  const status = await getRecoveryStatus(env, xId);
  return { ok: true, remaining: status.remaining };
}
