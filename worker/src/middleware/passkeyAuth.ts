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
import type { AppContext, ErrorResponse } from '../types';
import * as webauthnService from '../services/webauthn';
import { storeChallenge, consumeChallenge } from '../services/challengeService';
import { resolveRpId, allowedWebAuthnOrigins, allowedWebAuthnRpIds } from '../services/webauthnConfig';
import { publicErrorMessage } from '../utils/errors';

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
          error: 'Passkey authorization required. All fund movements must be authorized with your device passkey.',
          code: 'PASSKEY_REQUIRED',
        },
        403
      );
    }

    // Defensive normalization: ensure assertion and all WebAuthn fields are base64url compliant
    if (assertion) {
      if (typeof assertion.id === 'string') {
        assertion.id = assertion.id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
      if (typeof assertion.rawId === 'string') {
        assertion.rawId = assertion.rawId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
      // SimpleWebAuthn strictly requires id === rawId
      if (assertion.id && (!assertion.rawId || assertion.rawId !== assertion.id)) {
        assertion.rawId = assertion.id;
      }

      if (assertion.response && typeof assertion.response === 'object') {
        if (typeof assertion.response.authenticatorData === 'string') {
          assertion.response.authenticatorData = assertion.response.authenticatorData
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        if (typeof assertion.response.clientDataJSON === 'string') {
          assertion.response.clientDataJSON = assertion.response.clientDataJSON
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        if (typeof assertion.response.signature === 'string') {
          assertion.response.signature = assertion.response.signature
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        if (typeof assertion.response.userHandle === 'string') {
          assertion.response.userHandle = assertion.response.userHandle
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
      }
    }

    // Extract challenge from clientDataJSON
    let challenge: string | null = null;
    try {
      if (assertion?.response?.clientDataJSON) {
        const base64 = assertion.response.clientDataJSON
          .replace(/-/g, '+')
          .replace(/_/g, '/');
        const clientDataStr = atob(base64);
        const clientData = JSON.parse(clientDataStr);
        challenge = clientData.challenge;
      }
    } catch {
      challenge = null;
    }

    if (!challenge) {
      return c.json<ErrorResponse>(
        { error: 'Missing or malformed passkey challenge', code: 'INVALID_CHALLENGE' },
        400
      );
    }

    // Verify challenge was issued by this server and consume it (single-use, fail-closed)
    const challengeKey = `passkey_tx_auth:${session.x_id}:${challenge}`;
    const consumed = await consumeChallenge(c.env, {
      key: challengeKey,
      purpose: 'tx_auth',
      expectedChallenge: challenge,
    });

    if (!consumed) {
      return c.json<ErrorResponse>(
        {
          error: 'Passkey challenge expired or not recognized. Request a fresh challenge and retry.',
          code: 'CHALLENGE_EXPIRED',
        },
        400
      );
    }

    // Look up the user's registered passkey credential
    let passkeyRow: { public_key: string; counter: number; credential_id?: string } | null = null;

    if (c.env.DB) {
      try {
        passkeyRow = await c.env.DB.prepare(
          'SELECT public_key, counter FROM passkeys WHERE x_id = ? AND credential_id = ?'
        )
          .bind(session.x_id, assertion.id)
          .first<any>();
      } catch {}
    }

    // Fallback: if only one passkey exists for this user, look it up even if credential_id had an alternate encoding
    if (!passkeyRow && c.env.DB) {
      try {
        const rows = await c.env.DB.prepare(
          'SELECT public_key, counter, credential_id FROM passkeys WHERE x_id = ?'
        )
          .bind(session.x_id)
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
      return c.json<ErrorResponse>(
        {
          error: 'Passkey credential not found. Please register a passkey for your account.',
          code: 'CREDENTIAL_NOT_FOUND',
        },
        403
      );
    }

    // Verify the WebAuthn assertion cryptographically
    let verification: { verified: boolean; newCounter?: number };
    try {
      verification = await webauthnService.verifyAuthentication({
        assertion,
        expectedChallenge: challenge,
        expectedOrigin: allowedWebAuthnOrigins(c.env),
        expectedRPID: allowedWebAuthnRpIds(c.env),
        credential: {
          id: assertion.id,
          publicKey: passkeyRow.public_key,
          counter: Number(passkeyRow.counter) || 0,
        },
      });
    } catch (err: any) {
      console.error('[PasskeyAuth] Verification threw:', err);
      return c.json<ErrorResponse>(
        { error: `Passkey verification failed: ${publicErrorMessage(err)}`, code: 'VERIFICATION_FAILED' },
        403
      );
    }

    if (!verification.verified) {
      return c.json<ErrorResponse>(
        { error: 'Passkey signature invalid. Transaction rejected.', code: 'SIGNATURE_INVALID' },
        403
      );
    }

    // Update counter to prevent clone/replay attacks on the credential
    if (verification.newCounter !== undefined) {
      const newCounter = verification.newCounter;
      if (c.env.DB) {
        await c.env.DB.prepare(
          'UPDATE passkeys SET counter = ? WHERE x_id = ? AND credential_id = ?'
        )
          .bind(newCounter, session.x_id, assertion.id)
          .run()
          .catch(() => {});
      }
    }

    // ✅ Passkey verified — proceed to the handler
    return await next();
  };
};

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
