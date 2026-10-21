/**
 * One-time passkey recovery codes.
 *
 * Codes are high-entropy (16 Crockford-base32 characters ≈ 80 bits). A
 * dedicated RECOVERY_PEPPER keeps recovery material independent from
 * session-cookie keys: rotating SESSION_SECRET must not invalidate every
 * user's recovery codes.
 *
 * The HMAC digest is used for verification. An AES-GCM ciphertext is also
 * stored so the owner can re-view unused codes in Settings after a fresh
 * passkey check; plaintext is never persisted.
 */

import type { Env } from '../types';
import { requireRecoveryPepper } from '../utils/secrets';

export const RECOVERY_CODE_COUNT = 10;
const CODE_LENGTH = 16;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface RecoveryStatus {
  hasCodes: boolean;
  remaining: number;
  viewable: number;
}

export interface RecoveryGenerationResult extends RecoveryStatus {
  codes: string[];
}

export interface RecoveryCodeList {
  codes: string[];
  remaining: number;
  legacy: number;
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

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`recovery-code-encryption:v1:${requireRecoveryPepper(env)}`)
  );
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptRecoveryCode(
  env: Env,
  xId: string,
  code: string
): Promise<string> {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`recovery_code:${xId}`) },
    key,
    encoder.encode(code)
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptRecoveryCode(
  env: Env,
  xId: string,
  payload: string | null | undefined
): Promise<string | null> {
  if (!payload) return null;
  try {
    const [ivPart, cipherPart] = payload.split('.');
    if (!ivPart || !cipherPart) return null;
    const key = await encryptionKey(env);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(ivPart),
        additionalData: encoder.encode(`recovery_code:${xId}`),
      },
      key,
      base64UrlToBytes(cipherPart)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
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

export async function hashRecoveryCode(
  env: Env,
  normalized: string,
  xId?: string
): Promise<string> {
  const pepper = requireRecoveryPepper(env);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const message = xId
    ? `recovery_code:v2:${xId}:${normalized}`
    : `recovery_code:${normalized}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function getRecoveryStatus(env: Env, xId: string): Promise<RecoveryStatus> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS remaining,
            SUM(CASE WHEN code_ciphertext IS NOT NULL THEN 1 ELSE 0 END) AS viewable
     FROM recovery_codes WHERE x_id = ? AND used_at IS NULL`
  )
    .bind(xId)
    .first<{ remaining: number; viewable: number }>();
  const remaining = Number(row?.remaining) || 0;
  const viewable = Number(row?.viewable) || 0;
  return { hasCodes: remaining > 0, remaining, viewable };
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
    const index = plaintext.length;
    const formatted = formatCode(raw);
    plaintext.push(formatted);
    const hash = await hashRecoveryCode(env, raw, xId);
    const ciphertext = await encryptRecoveryCode(env, xId, formatted);
    statements.push(
      env.DB.prepare(
        'INSERT INTO recovery_codes (id, x_id, code_hash, code_ciphertext, code_index, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), xId, hash, ciphertext, index, now)
    );
  }

  await env.DB.batch(statements);

  return {
    hasCodes: true,
    remaining: plaintext.length,
    viewable: plaintext.length,
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

  const hashes = [await hashRecoveryCode(env, normalized, xId)];
  const legacyHash = await hashRecoveryCode(env, normalized);
  if (legacyHash !== hashes[0]) hashes.push(legacyHash);

  let row: { id: string } | null = null;
  for (const hash of hashes) {
    row = await env.DB.prepare(
      'SELECT id FROM recovery_codes WHERE x_id = ? AND code_hash = ? AND used_at IS NULL'
    )
      .bind(xId, hash)
      .first<{ id: string }>();
    if (row) break;
  }

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

export async function listRecoveryCodes(env: Env, xId: string): Promise<RecoveryCodeList> {
  const rows = await env.DB.prepare(
    `SELECT code_ciphertext FROM recovery_codes
     WHERE x_id = ? AND used_at IS NULL
     ORDER BY code_index ASC, created_at ASC, id ASC`
  )
    .bind(xId)
    .all<{ code_ciphertext: string | null }>();

  const codes: string[] = [];
  let legacy = 0;
  for (const row of rows.results || []) {
    const code = await decryptRecoveryCode(env, xId, row.code_ciphertext);
    if (code) codes.push(code);
    else legacy += 1;
  }
  return { codes, remaining: codes.length + legacy, legacy };
}
