/**
 * Centralized secret access for UP (UPRAIL.app).
 *
 * Every secret in this worker is FAIL-CLOSED:
 *  - If a secret is missing, the code path that needs it errors out instead of
 *    silently falling back to a hardcoded literal.
 *  - No secret value may ever be written in source. Configure them with
 *    `wrangler secret put <NAME>` (production) or `.dev.vars` (local dev).
 *    See `.dev.vars.example` for the full list.
 */

import type { Env } from '../types';

function clean(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * HMAC key for stateless session cookies and OAuth PKCE state.
 * Returns null when unset so callers can fail closed (reject the request)
 * instead of signing with a guessable constant.
 */
export function getSessionSecret(env: Env): string | null {
  return clean(env.SESSION_SECRET);
}

/**
 * Same as getSessionSecret but throws — for code paths that MUST sign
 * (creating a session, signing PKCE state) and cannot proceed without it.
 */
export function requireSessionSecret(env: Env): string {
  const secret = getSessionSecret(env);
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured; refusing to sign session material');
  }
  return secret;
}

/**
 * HMAC key for quote signature binding. Quotes are defense-in-depth on top of
 * the passkey gate, so a missing secret must not produce a "valid" signature.
 */
export function getQuoteSecret(env: Env): string | null {
  return clean(env.SESSION_SECRET) ?? clean(env.INTERNAL_SERVICE_KEY);
}

/** @throws when no quote signing key is configured. */
export function requireQuoteSecret(env: Env): string {
  const secret = getQuoteSecret(env);
  if (!secret) {
    throw new Error('No quote signing secret configured (SESSION_SECRET / INTERNAL_SERVICE_KEY)');
  }
  return secret;
}

/**
 * Shared secret between this worker and the Go settlement service.
 * Null when unset — the Go side rejects unsigned requests (fail closed).
 */
export function getInternalServiceKey(env: Env): string | null {
  return clean(env.INTERNAL_SERVICE_KEY);
}

/**
 * Pepper for one-time passkey recovery-code hashes.
 *
 * A recovery code is high-entropy, so a fast HMAC is sufficient at rest. The
 * pepper must be separate from SESSION_SECRET: rotating session cookies must
 * not silently invalidate every user's recovery codes.
 */
export function requireRecoveryPepper(env: Env): string {
  const secret = clean(env.RECOVERY_PEPPER);
  if (!secret) {
    throw new Error('RECOVERY_PEPPER is not configured; refusing to create or verify recovery codes');
  }
  return secret;
}
