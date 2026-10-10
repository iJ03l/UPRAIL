/**
 * Request signing for calls from the Worker to the Go settlement service.
 *
 * The Go side (internal/middleware/auth.go) rejects anything that is not a
 * signed request:
 *   X-Internal-Timestamp : unix seconds, ±5 min clock skew
 *   X-Internal-Nonce     : single-use UUID, 10 min replay window
 *   X-Internal-Signature : hex(HMAC-SHA256(secret, "v1.<ts>.<nonce>.<METHOD>.<path>.<sha256(body)>"))
 *
 * The signature covers method, path and body, so a captured signature cannot
 * be replayed against a different payload.
 */

import type { Env } from '../types';
import { getInternalServiceKey } from './secrets';

const SIGNATURE_VERSION = 'v1';

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Builds a signed POST request for an internal Go route.
 * @param pathname must be the final path Go receives (e.g. `/internal/quote`).
 */
export async function signedInternalRequest(
  env: Env,
  pathname: string,
  payload: unknown
): Promise<Request> {
  const secret = getInternalServiceKey(env);
  if (!secret) {
    throw new Error('INTERNAL_SERVICE_KEY is not configured; settlement service calls are disabled');
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(body);
  const canonical = `${SIGNATURE_VERSION}.${timestamp}.${nonce}.POST.${pathname}.${bodyHash}`;
  const signature = await hmacSha256Hex(secret, canonical);

  return new Request(`http://container${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Timestamp': timestamp,
      'X-Internal-Nonce': nonce,
      'X-Internal-Signature': signature,
    },
    body,
  });
}
