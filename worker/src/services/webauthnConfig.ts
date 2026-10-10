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
