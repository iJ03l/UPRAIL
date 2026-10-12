/**
 * Single source of truth for WebAuthn relying-party parameters.
 *
 * Registration and verification MUST agree on rpId and origin, otherwise a
 * credential created at registration can never authenticate. Every call site
 * resolves these values through this module — no inline defaults anywhere.
 *
 * Production values are set in wrangler.jsonc:
 *   WEBAUTHN_RP_ID   = uprail.world            (covers app./api./www.)
 *   WEBAUTHN_ORIGIN  = https://app.uprail.world
 */

import type { Env } from '../types';

export const DEFAULT_RP_ID = 'uprail.world';
export const DEFAULT_ORIGIN = 'https://app.uprail.world';
/** Canonical app origin used for all generated links (share, invite, OAuth). */
export const APP_ORIGIN = DEFAULT_ORIGIN;

interface WebAuthnEnv {
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_ORIGIN?: string;
}

export function resolveRpId(env: WebAuthnEnv | Env): string {
  const value = env.WEBAUTHN_RP_ID?.trim();
  return value && value.length > 0 ? value : DEFAULT_RP_ID;
}

export function resolveOrigin(env: WebAuthnEnv | Env): string {
  const value = env.WEBAUTHN_ORIGIN?.trim();
  return value && value.length > 0 ? value.replace(/\/+$/, '') : DEFAULT_ORIGIN;
}

/** True when the configured origin points at a local dev server. */
function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Origins a WebAuthn assertion may legitimately come from.
 *
 * Production: exactly the configured origin — nothing else. Hardcoding extra
 * hosts (other subdomains, the apex, localhost) would let an assertion minted
 * anywhere else be accepted as a login.
 *
 * Local development: the configured localhost port plus the ports the dev
 * servers actually run on, since the browser fixes a passkey's rpId/origin at
 * creation time and the operator may run the frontend on a different port.
 */
export function allowedWebAuthnOrigins(env: WebAuthnEnv | Env): string[] {
  const origin = resolveOrigin(env);
  const prodOrigins = [origin, 'https://app.uprail.world', 'https://uprail.world'];
  if (!isLocalOrigin(origin)) return Array.from(new Set(prodOrigins));
  const host = new URL(origin).hostname;
  return Array.from(new Set([...prodOrigins, `http://${host}:3000`, `http://${host}:5173`, `http://${host}:8787`]));
}

/** rpIds accepted when verifying an assertion — mirrors allowedWebAuthnOrigins. */
export function allowedWebAuthnRpIds(env: WebAuthnEnv | Env): string[] {
  const rpId = resolveRpId(env);
  const origin = resolveOrigin(env);
  if (!isLocalOrigin(origin)) return [rpId];
  return Array.from(new Set([rpId, 'localhost', '127.0.0.1']));
}
