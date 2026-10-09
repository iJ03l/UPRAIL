/**
 * Passkey Authorization Middleware for UP (UPRAIL.app)
 *
 * Every fund-moving action (send, claim, withdraw) MUST be authorized
 * by a valid WebAuthn passkey signature from the user's registered credential.
 *
 * This is a second-factor beyond session authentication:
 *   1. requireAuth()      — proves the user has a valid session (X OAuth)
 *   2. requirePasskeyAuth() — proves the user physically holds the passkey
 *                             device at the moment of the transaction.
 *
 * The passkey signature is verified against the server-issued challenge
 * stored in KV (single-use, 5-minute TTL). Replay attacks are prevented
 * by consuming the challenge on first use.
 *
 * Usage:
 *   router.post('/send', requireAuth(), requirePasskeyAuth(), async (c) => { ... })
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext, ErrorResponse } from '../types';
import * as webauthnService from '../services/webauthn';
import { getDb } from '../db/postgres';

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
      // We store it in the context variable map
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

    // Verify challenge was issued by this server (fail-closed: reject if not found)
    const challengeKey = `passkey_tx_auth:${session.x_id}:${challenge}`;
    const storedChallenge = await c.env.CACHE.get(challengeKey);
    if (!storedChallenge) {
      return c.json<ErrorResponse>(
        {
          error: 'Passkey challenge expired or not recognized. Request a fresh challenge and retry.',
          code: 'CHALLENGE_EXPIRED',
        },
        400
      );
    }

    // Consume the challenge immediately (single-use; prevents replay attacks)
    await c.env.CACHE.delete(challengeKey);

    // Look up the user's registered passkey credential
    let passkeyRow: { public_key: string; counter: number } | null = null;

    try {
      const sql = getDb(c.env);
      const [row] = await sql<any[]>`
        SELECT public_key, counter FROM passkeys
        WHERE x_id = ${session.x_id} AND credential_id = ${assertion.id}
      `;
      if (row) passkeyRow = row;
    } catch {
      if (c.env.DB) {
        passkeyRow = await c.env.DB.prepare(
          'SELECT public_key, counter FROM passkeys WHERE x_id = ? AND credential_id = ?'
        )
          .bind(session.x_id, assertion.id)
          .first<any>();
      }
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
    const rpId = c.env.WEBAUTHN_RP_ID || 'uprail.world';
    const expectedOrigin = c.env.WEBAUTHN_ORIGIN || 'https://app.uprail.world';

    let verification: { verified: boolean; newCounter?: number };
    try {
      verification = await webauthnService.verifyAuthentication({
        assertion,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpId,
        credential: {
          id: assertion.id,
          publicKey: passkeyRow.public_key,
          counter: Number(passkeyRow.counter) || 0,
        },
      });
    } catch (err: any) {
      console.error('[PasskeyAuth] Verification threw:', err);
      return c.json<ErrorResponse>(
        { error: `Passkey verification failed: ${err.message}`, code: 'VERIFICATION_FAILED' },
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
      try {
        const sql = getDb(c.env);
        await sql`
          UPDATE passkeys SET counter = ${newCounter}
          WHERE x_id = ${session.x_id} AND credential_id = ${assertion.id}
        `;
      } catch {
        if (c.env.DB) {
          await c.env.DB.prepare(
            'UPDATE passkeys SET counter = ? WHERE x_id = ? AND credential_id = ?'
          )
            .bind(newCounter, session.x_id, assertion.id)
            .run()
            .catch(() => {});
        }
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
 * The issued challenge is bound to the authenticated user's x_id and expires in 5 minutes.
 * It is consumed on first use by requirePasskeyAuth().
 *
 * Route: GET /api/auth-challenge
 */
export async function issueTxChallenge(c: any): Promise<Response> {
  const session = c.get('session');
  if (!session) {
    return c.json<ErrorResponse>({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  const rpId = c.env.WEBAUTHN_RP_ID || 'uprail.world';
  const options = await webauthnService.generateAuthenticationOptions({ rpId });

  const challengeKey = `passkey_tx_auth:${session.x_id}:${options.challenge}`;

  // Store challenge with 5-minute TTL (single-use)
  await c.env.CACHE.put(challengeKey, '1', { expirationTtl: 300 });

  return c.json({
    ...options,
    expiresIn: 300,
    message: 'Use this challenge with your device passkey to authorize the transaction.',
  });
}
