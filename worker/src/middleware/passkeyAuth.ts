/**
 * Passkey Authorization Middleware for UP (UPRAIL.app)
 *
 * Every fund-moving action (send, claim, withdraw) MUST be authorized
 * by a valid WebAuthn passkey signature from the user's registered credential.
 *
 * This is a second-factor beyond session authentication:
 *   1. requireAuth()        — proves the user has a valid session (X OAuth)
 *   2. requirePasskeyAuth() — proves the user physically holds the passkey
 *                             device at the moment of the transaction.
 *
 * Challenges are managed via in-memory cache and D1 (zero KV writes).
 * Replay attacks are prevented by consuming the challenge on first use.
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext, Env, ErrorResponse } from '../types';
import * as webauthnService from '../services/webauthn';
import { storeChallenge, consumeChallenge } from '../services/challengeService';
import { resolveRpId, allowedWebAuthnOrigins, allowedWebAuthnRpIds } from '../services/webauthnConfig';
import { publicErrorMessage } from '../utils/errors';
import { updateSession } from './session';

/**
 * Middleware that verifies a WebAuthn passkey assertion is present and valid
 * in the request body before allowing the handler to proceed.
 *
 * The client MUST include `passkeyAssertion` (a WebAuthn AuthenticatorAssertionResponse)
 * in the request body alongside the normal payload.
 *
 * If verification fails, the request is rejected with 403.
 */
export const requirePasskeyAuth = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const session = c.get('session');
    if (!session) {
      return c.json<ErrorResponse>(
        { error: 'Authentication required', code: 'UNAUTHORIZED' },
        401
      );
    }

    // Parse body — we need to read it but also make it available to downstream handlers
    let body: Record<string, any>;
    try {
      body = await c.req.json();
      // Re-attach parsed body for downstream handlers via a cached approach
      c.set('parsedBody' as any, body);
    } catch {
      return c.json<ErrorResponse>(
        { error: 'Invalid JSON request body', code: 'INVALID_REQUEST' },
        400
      );
    }

    let assertion = body?.passkeyAssertion || body?.assertion;
    if (!assertion && typeof body?.passkeySignature === 'string') {
      try { assertion = JSON.parse(body.passkeySignature); } catch {}
    } else if (!assertion && body?.passkeySignature) {
      assertion = body.passkeySignature;
    }

    if (!assertion) {
      return c.json<ErrorResponse>(
        {
          error: 'Confirm with Face ID or fingerprint to continue.',
          code: 'PASSKEY_REQUIRED',
        },
        403
      );
    }

    const verified = await verifyPasskeyAssertion(c.env, session.x_id, assertion);
    if (!verified.ok) {
      return c.json<ErrorResponse>(
        { error: verified.message, code: verified.code },
        verified.status
      );
    }

    await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
    return await next();
  };
};

export const RECENT_PASSKEY_MS = 5 * 60 * 1000;

export function hasRecentPasskey(session: { passkey_verified?: boolean; passkey_verified_at?: number } | null): boolean {
  return Boolean(
    session?.passkey_verified &&
    session.passkey_verified_at &&
    Date.now() - session.passkey_verified_at < RECENT_PASSKEY_MS
  );
}

export type PasskeyVerificationResult =
  | { ok: true }
  | { ok: false; status: 400 | 403; message: string; code: string };

export async function verifyPasskeyAssertion(
  env: Env,
  xId: string,
  assertion: any
): Promise<PasskeyVerificationResult> {
  if (typeof assertion.id === 'string') {
    assertion.id = assertion.id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  if (typeof assertion.rawId === 'string') {
    assertion.rawId = assertion.rawId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  if (assertion.id && (!assertion.rawId || assertion.rawId !== assertion.id)) {
    assertion.rawId = assertion.id;
  }

  if (assertion.response && typeof assertion.response === 'object') {
    for (const key of ['authenticatorData', 'clientDataJSON', 'signature', 'userHandle'] as const) {
      if (typeof assertion.response[key] === 'string') {
        assertion.response[key] = assertion.response[key]
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
    }
  }

  let challenge: string | null = null;
  try {
    if (assertion?.response?.clientDataJSON) {
      const base64 = assertion.response.clientDataJSON.replace(/-/g, '+').replace(/_/g, '/');
      const clientData = JSON.parse(atob(base64));
      challenge = clientData.challenge;
    }
  } catch {
    challenge = null;
  }

  if (!challenge) {
    return { ok: false, status: 400, message: 'Missing or malformed passkey challenge', code: 'INVALID_CHALLENGE' };
  }

  const challengeKey = `passkey_tx_auth:${xId}:${challenge}`;
  const consumed = await consumeChallenge(env, {
    key: challengeKey,
    purpose: 'tx_auth',
    expectedChallenge: challenge,
  });
  if (!consumed) {
    return {
      ok: false,
      status: 400,
      message: 'Passkey challenge expired or not recognized. Request a fresh challenge and retry.',
      code: 'CHALLENGE_EXPIRED',
    };
  }

  let passkeyRow: { x_id?: string; public_key: string; counter: number; credential_id?: string } | null = null;

  if (env.DB) {
    try {
      passkeyRow = await env.DB.prepare(
        'SELECT x_id, public_key, counter FROM passkeys WHERE x_id = ? AND credential_id = ?'
      )
        .bind(xId, assertion.id)
        .first<any>();
    } catch {}
  }

  if (!passkeyRow && env.DB) {
    try {
      const foreign = await env.DB.prepare(
        'SELECT x_id FROM passkeys WHERE credential_id = ?'
      )
        .bind(assertion.id)
        .first<{ x_id: string }>();
      if (foreign && foreign.x_id !== xId) {
        return {
          ok: false,
          status: 403,
          message: 'This passkey belongs to a different UPRAIL account.',
          code: 'ACCOUNT_MISMATCH',
        };
      }
    } catch {}
  }

  if (!passkeyRow && env.DB) {
    try {
      const rows = await env.DB.prepare(
        'SELECT x_id, public_key, counter, credential_id FROM passkeys WHERE x_id = ?'
      )
        .bind(xId)
        .all<any>();
      if (rows.results && rows.results.length === 1) {
        passkeyRow = rows.results[0];
        if (passkeyRow && passkeyRow.credential_id) {
          assertion.id = webauthnService.toBase64Url(passkeyRow.credential_id);
          assertion.rawId = assertion.id;
        }
      }
    } catch {}
  }

  if (!passkeyRow) {
    return {
      ok: false,
      status: 403,
      message: 'Passkey credential not found. Please register a passkey for your account.',
      code: 'CREDENTIAL_NOT_FOUND',
    };
  }

  if (passkeyRow.x_id && passkeyRow.x_id !== xId) {
    return {
      ok: false,
      status: 403,
      message: 'This passkey belongs to a different UPRAIL account.',
      code: 'ACCOUNT_MISMATCH',
    };
  }

  let verification: { verified: boolean; newCounter?: number };
  try {
    verification = await webauthnService.verifyAuthentication({
      assertion,
      expectedChallenge: challenge,
      expectedOrigin: allowedWebAuthnOrigins(env),
      expectedRPID: allowedWebAuthnRpIds(env),
      credential: {
        id: assertion.id,
        publicKey: passkeyRow.public_key,
        counter: Number(passkeyRow.counter) || 0,
      },
    });
  } catch (err: any) {
    console.error('[PasskeyAuth] Verification threw:', err);
    return {
      ok: false,
      status: 403,
      message: `Passkey verification failed: ${publicErrorMessage(err)}`,
      code: 'VERIFICATION_FAILED',
    };
  }

  if (!verification.verified) {
    return {
      ok: false,
      status: 403,
      message: 'Passkey signature invalid. Transaction rejected.',
      code: 'SIGNATURE_INVALID',
    };
  }

  if (verification.newCounter !== undefined && env.DB) {
    const newCounter = verification.newCounter;
    await env.DB.prepare(
      'UPDATE passkeys SET counter = ? WHERE x_id = ? AND credential_id = ?'
    )
      .bind(newCounter, xId, assertion.id)
      .run()
      .catch(() => {});
  }

  return { ok: true };
}

/**
 * GET handler — issues a fresh single-use passkey challenge for a fund-moving action.
 * The client must call this BEFORE requesting a passkey assertion from the browser.
 *
 * Route: GET /api/auth-challenge
 */
export async function issueTxChallenge(c: any): Promise<Response> {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  const rpId = resolveRpId(c.env);
  // Passkey Discoverable Authentication:
  // Do not restrict allowCredentials so the platform biometric prompt (Face ID / Touch ID)
  // triggers natively without locking the user to a foreign or cross-device security key.
  const options = await webauthnService.generateAuthenticationOptions({ rpId });

  const challengeKey = `passkey_tx_auth:${session.x_id}:${options.challenge}`;

  // Store challenge with 5-minute TTL via challengeService (0 KV writes)
  await storeChallenge(c.env, {
    key: challengeKey,
    challenge: options.challenge,
    xId: session.x_id,
    purpose: 'tx_auth',
    ttlSeconds: 300,
  });

  return c.json({
    ...options,
    rpId,
    expiresIn: 300,
    message: 'Use this challenge with your device passkey to authorize the transaction.',
  });
}
