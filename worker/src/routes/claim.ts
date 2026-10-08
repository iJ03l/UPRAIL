/**
 * Claim routes for UP (UPRAIL.app)
 * Pending payment discovery, WebAuthn passkey registration, claim execution, and balance checks
 */

import { Hono } from 'hono';
import {
  AppContext,
  ClaimExecuteRequest,
  ClaimExecuteResponse,
  ClaimExecuteResult,
  ErrorResponse,
  Payment,
  PaymentStatus,
  RegisterPasskeyRequest,
  RegisterPasskeyResponse,
} from '../types';
import { requireAuth } from '../middleware/session';
import { updateSession } from '../middleware/session';
import * as webauthn from '../services/webauthn';
import * as nearProxy from '../services/nearProxy';

export const claimRouter = new Hono<AppContext>();

/**
 * GET /api/claim/pending
 * Returns pending escrow payments matching the logged-in user's X handle
 */
claimRouter.get('/pending', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const userHandle = session.x_handle.toLowerCase();

    const { results } = await c.env.DB.prepare(
      `
      SELECT * FROM payments
      WHERE LOWER(recipient_handle) = ?
        AND status IN ('PENDING', 'DEPOSIT_WAITING', 'ESCROWED')
      ORDER BY created_at DESC
    `
    )
      .bind(userHandle)
      .all<Payment>();

    return c.json({ payments: results });
  } catch (err: any) {
    console.error('Fetch pending payments error:', err);
    return c.json<ErrorResponse>(
      { error: 'Failed to fetch pending payments', code: 'FETCH_PENDING_ERROR' },
      500
    );
  }
});

/**
 * GET /api/claim/register-options
 * Generates WebAuthn registration options for P-256 passkey creation
 */
claimRouter.get('/register-options', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const rpId = c.env.WEBAUTHN_RP_ID || 'uprail.app';
    const rpName = c.env.WEBAUTHN_RP_NAME || 'UPRAIL';

    const options = await webauthn.generateRegistrationOptions({
      userId: session.x_id,
      userName: session.x_handle,
      rpId,
      rpName,
    });

    // Store challenge in KV for verification (5 min TTL)
    await c.env.CACHE.put(`webauthn_reg:${session.x_id}`, options.challenge, {
      expirationTtl: 300,
    });

    return c.json(options);
  } catch (err: any) {
    console.error('Generate WebAuthn options error:', err);
    return c.json<ErrorResponse>(
      { error: 'Failed to generate registration options', code: 'WEBAUTHN_OPTIONS_ERROR' },
      500
    );
  }
});

/**
 * POST /api/claim/register
 * Verifies WebAuthn attestation, proxies to Go container for confidential NEAR account creation,
 * links account to X identity
 */
claimRouter.post('/register', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const body = await c.req.json<RegisterPasskeyRequest>().catch(() => null);

    if (!body || !body.attestation) {
      return c.json<ErrorResponse>(
        { error: 'Missing WebAuthn attestation payload', code: 'INVALID_REQUEST' },
        400
      );
    }

    // Retrieve expected challenge
    const storedChallenge = await c.env.CACHE.get(`webauthn_reg:${session.x_id}`);
    const expectedChallenge = body.challenge || storedChallenge;

    if (!expectedChallenge) {
      return c.json<ErrorResponse>(
        { error: 'WebAuthn challenge expired or missing', code: 'CHALLENGE_EXPIRED' },
        400
      );
    }

    const rpId = c.env.WEBAUTHN_RP_ID || 'uprail.app';
    const expectedOrigin = c.env.WEBAUTHN_ORIGIN || 'https://uprail.app';

    // Verify attestation and extract P-256 public key
    const verification = await webauthn.verifyRegistration({
      attestation: body.attestation,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpId,
    });

    // Clean up stored challenge
    await c.env.CACHE.delete(`webauthn_reg:${session.x_id}`);

    // Call Go Container to create confidential NEAR account
    const nearResult = await nearProxy.createAccount(c.env, {
      publicKeyHex: verification.publicKeyHex,
      xHandle: session.x_handle,
    });

    const nearAccount = nearResult.nearAccount;
    const now = Date.now();
    const passkeyId = crypto.randomUUID();

    // 1. Store passkey in D1
    await c.env.DB.prepare(
      `
      INSERT INTO passkeys (
        id,
        x_id,
        credential_id,
        public_key,
        counter,
        transports,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(credential_id) DO UPDATE SET
        public_key = excluded.public_key,
        counter = excluded.counter
    `
    )
      .bind(
        passkeyId,
        session.x_id,
        verification.credentialId,
        verification.publicKeyHex,
        verification.counter,
        JSON.stringify(body.attestation.response?.transports || []),
        now
      )
      .run();

    // 2. Update x_identities table in D1
    await c.env.DB.prepare(
      `
      UPDATE x_identities
      SET near_account = ?,
          updated_at = ?
      WHERE x_id = ?
    `
    )
      .bind(nearAccount, now, session.x_id)
      .run();

    // 3. Update active session in KV
    await updateSession(c, {
      near_account: nearAccount,
    });

    return c.json<RegisterPasskeyResponse>({
      success: true,
      nearAccount,
      credentialId: verification.credentialId,
    });
  } catch (err: any) {
    console.error('Passkey registration error:', err);
    return c.json<ErrorResponse>(
      {
        error: `Passkey registration failed: ${err.message || 'Internal error'}`,
        code: 'REGISTRATION_FAILED',
      },
      500
    );
  }
});

/**
 * POST /api/claim/execute
 * Claims pending payments for authenticated recipient using their registered NEAR account
 */
claimRouter.post('/execute', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const body = await c.req.json<ClaimExecuteRequest>().catch(() => null);

    if (!body || !Array.isArray(body.paymentIds) || body.paymentIds.length === 0) {
      return c.json<ErrorResponse>(
        { error: 'Missing or empty paymentIds array', code: 'INVALID_REQUEST' },
        400
      );
    }

    // Ensure recipient has a linked NEAR account
    let recipientNearAccount = session.near_account;
    if (!recipientNearAccount) {
      const identity = await c.env.DB.prepare(
        'SELECT near_account FROM x_identities WHERE x_id = ?'
      )
        .bind(session.x_id)
        .first<{ near_account: string | null }>();

      if (!identity || !identity.near_account) {
        return c.json<ErrorResponse>(
          {
            error: 'No NEAR account associated. Please register a passkey first.',
            code: 'NEAR_ACCOUNT_REQUIRED',
          },
          400
        );
      }
      recipientNearAccount = identity.near_account;
    }

    const results: ClaimExecuteResult[] = [];
    const normalizedUserHandle = session.x_handle.toLowerCase();

    for (const paymentId of body.paymentIds) {
      try {
        // Fetch payment record from D1
        const payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?')
          .bind(paymentId)
          .first<Payment>();

        if (!payment) {
          results.push({
            paymentId,
            status: PaymentStatus.PENDING,
            error: 'Payment not found',
          });
          continue;
        }

        // Validate recipient handle matches authenticated user
        if (payment.recipient_handle.toLowerCase() !== normalizedUserHandle) {
          results.push({
            paymentId,
            status: payment.status,
            error: 'Payment recipient does not match authenticated X user',
          });
          continue;
        }

        // Get EscrowDO stub
        const doId = c.env.ESCROW.idFromName(paymentId);
        const stub = c.env.ESCROW.get(doId) as any;

        let claimResponse: { payment: Payment; txHash: string };

        if (typeof stub.claim === 'function') {
          claimResponse = await stub.claim(recipientNearAccount);
        } else {
          const resp = await stub.fetch(
            new Request('http://escrow/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recipientNearAccount }),
            })
          );

          if (!resp.ok) {
            const errJson = (await resp.json().catch(() => ({}))) as any;
            throw new Error(errJson.error || `DO claim failed with HTTP ${resp.status}`);
          }
          claimResponse = await resp.json();
        }

        results.push({
          paymentId,
          status: PaymentStatus.CLAIMED,
          txHash: claimResponse.txHash,
        });
      } catch (err: any) {
        console.error(`Claim error on payment ${paymentId}:`, err);
        results.push({
          paymentId,
          status: PaymentStatus.ESCROWED,
          error: err.message || 'Claim transfer failed',
        });
      }
    }

    return c.json<ClaimExecuteResponse>({ results });
  } catch (err: any) {
    console.error('Execute claims error:', err);
    return c.json<ErrorResponse>(
      { error: err.message || 'Claim execution failed', code: 'CLAIM_FAILED' },
      500
    );
  }
});

/**
 * GET /api/claim/balance
 * Returns confidential NEAR token balance for the authenticated user
 */
claimRouter.get('/balance', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    let nearAccount = session.near_account;

    if (!nearAccount) {
      const identity = await c.env.DB.prepare(
        'SELECT near_account FROM x_identities WHERE x_id = ?'
      )
        .bind(session.x_id)
        .first<{ near_account: string | null }>();

      if (!identity || !identity.near_account) {
        return c.json<ErrorResponse>(
          {
            error: 'No NEAR account linked. Please register a passkey first.',
            code: 'NEAR_ACCOUNT_REQUIRED',
          },
          400
        );
      }
      nearAccount = identity.near_account;
    }

    const asset = c.req.query('asset');
    const balanceData = await nearProxy.getBalance(c.env, {
      nearAccount,
      asset,
    });

    return c.json(balanceData);
  } catch (err: any) {
    console.error('Balance read error:', err);
    return c.json<ErrorResponse>(
      {
        error: `Failed to read confidential balance: ${err.message || 'Internal error'}`,
        code: 'BALANCE_ERROR',
      },
      500
    );
  }
});
