/**
 * Payment routing for UP (UPRAIL.app)
 * Send flow: Resolve handle, Request quote, Send escrow, List/get/cancel payments
 */

import { Hono } from 'hono';
import { ulid } from 'ulid';
import {
  AppContext,
  ErrorResponse,
  Payment,
  PaymentStatus,
  PublicPaymentPreview,
  QuoteRequest,
  QuoteResponse,
  ResolveRequest,
  ResolveResponse,
  SendRequest,
  SendResponse,
} from '../types';
import * as nearProxy from '../services/nearProxy';
import * as nearRpc from '../services/nearRpc';
import { signQuote, verifyQuoteToken } from '../services/quoteAuth';
import { createPaymentInvite } from '../services/inviteService';
import { requireAuth } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import {
  getDb,
  insertPayment,
  getPaymentById,
  getUserPayments,
  updatePaymentStatus,
} from '../db/postgres';

export const paymentsRouter = new Hono<AppContext>();

/**
 * Normalizes an X handle by stripping whitespace, leading @ and lowercasing
 */
function normalizeHandle(rawHandle: string): string {
  return rawHandle.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Validates X handle format (1-15 characters: letters, numbers, underscores)
 */
function isValidXHandle(handle: string): boolean {
  return /^[a-zA-Z0-9_]{1,15}$/.test(handle);
}

/**
 * Helper to call EscrowDO with RPC or HTTP fallback
 */
async function callEscrowDO(
  env: AppContext['Bindings'],
  paymentId: string,
  method: 'init' | 'status' | 'cancel',
  payload?: any
): Promise<any> {
  if (!env.ESCROW) {
    // Pure Free Tier mode - Escrow state is maintained in D1 database
    return null;
  }
  const doId = env.ESCROW.idFromName(paymentId);
  const stub = env.ESCROW.get(doId) as any;

  if (method === 'init' && typeof stub.initPayment === 'function') {
    return await stub.initPayment(payload);
  }
  if (method === 'status' && typeof stub.getStatus === 'function') {
    return await stub.getStatus();
  }
  if (method === 'cancel' && typeof stub.cancel === 'function') {
    return await stub.cancel(payload?.senderXId);
  }

  // Fallback to fetch()
  const path = `/${method === 'init' ? 'init' : method === 'status' ? 'status' : 'cancel'}`;
  const request = new Request(`http://escrow${path}`, {
    method: method === 'status' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: method !== 'status' ? JSON.stringify(payload || {}) : undefined,
  });

  const response = await stub.fetch(request);
  if (!response.ok) {
    const errorJson = (await response.json().catch(() => ({}))) as any;
    throw new Error(errorJson.error || `EscrowDO operation failed with ${response.status}`);
  }
  return await response.json();
}

/**
 * GET /api/tokens
 * Returns all tokens supported by NEAR Intents, pulled live from the intents contract.
 * No hardcoded list — every supported asset on every chain is included.
 */
paymentsRouter.get('/tokens', async (c) => {
  try {
    const tokens = await nearRpc.getSupportedTokens(c.env);
    const mapped = tokens.map((t) => ({
      id: t.defuse_asset_id,
      symbol: t.symbol,
      name: t.name,
      iconUrl: t.icon || '',
      decimals: t.decimals,
      nearContractId: t.nearContractId,
      chain: t.chain,
      chainId: t.chainId,
      badge: t.chain === 'near' ? 'Confidential' : 'Cross-chain',
      balance: '0.00', // balance is fetched separately via /api/onchain/balances
      priceUsd: t.priceUsd ?? 1.0,
    }));
    return c.json({ tokens: mapped });
  } catch (err: any) {
    console.error('[/api/tokens] onchain fetch failed:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to load token list: ${err.message}`, code: 'TOKEN_LIST_ERROR' },
      500
    );
  }
});

/**
 * POST /api/resolve
 * Validates X handle format.
 * NOTE: Free tier X API cannot resolve user IDs server-side; resolution occurs at recipient claim.
 */
paymentsRouter.post('/resolve', async (c) => {
  try {
    const body = await c.req.json<ResolveRequest>().catch(() => null);
    if (!body || !body.handle) {
      return c.json<ErrorResponse>(
        { error: 'Missing handle parameter', code: 'INVALID_REQUEST' },
        400
      );
    }

    const clean = normalizeHandle(body.handle);
    if (!isValidXHandle(clean)) {
      return c.json<ErrorResponse>(
        {
          error: 'Invalid X handle. Handles must be 1 to 15 alphanumeric characters or underscores.',
          code: 'INVALID_HANDLE_FORMAT',
        },
        400
      );
    }

    return c.json<ResolveResponse>({
      handle: `@${clean}`,
      resolved: false,
      message: 'Resolution confirmed on recipient claim via passkey',
    });
  } catch (err: any) {
    return c.json<ErrorResponse>(
      { error: err.message || 'Resolve failed', code: 'RESOLVE_ERROR' },
      500
    );
  }
});

/**
 * POST /api/quote
 * Proxies to Go Container for 1Click quote with confidentiality: "advanced"
 */
paymentsRouter.post('/quote', async (c) => {
  try {
    const body = await c.req.json<QuoteRequest>().catch(() => null);
    if (!body || !body.recipientHandle || !body.asset || !body.amount) {
      return c.json<ErrorResponse>(
        {
          error: 'Missing required parameters: recipientHandle, asset, amount',
          code: 'INVALID_REQUEST',
        },
        400
      );
    }

    const cleanHandle = normalizeHandle(body.recipientHandle);
    if (!isValidXHandle(cleanHandle)) {
      return c.json<ErrorResponse>(
        { error: 'Invalid recipient X handle format', code: 'INVALID_HANDLE' },
        400
      );
    }

    if (isNaN(Number(body.amount)) || Number(body.amount) <= 0) {
      return c.json<ErrorResponse>(
        { error: 'Amount must be a positive numeric value', code: 'INVALID_AMOUNT' },
        400
      );
    }

    const holdingAccount = c.env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';

    // Check if recipient is already registered with an active NEAR intent account
    let recipientNearAccount: string | null = null;
    let isRegistered = false;
    try {
      const existing = await c.env.DB.prepare(
        'SELECT near_account FROM x_identities WHERE LOWER(x_handle) = ?'
      )
        .bind(cleanHandle)
        .first<{ near_account: string | null }>();
      if (existing?.near_account) {
        recipientNearAccount = existing.near_account;
        isRegistered = true;
      }
    } catch {}

    // When the X user HAS NOT signed up yet:
    // Funds are escrowed to the platform holding wallet (ESCROW_ACCOUNT_ID)
    const quoteRecipient = isRegistered && recipientNearAccount ? recipientNearAccount : holdingAccount;

    // Look up token decimals for base unit conversion
    let baseUnitsAmount = body.amount;
    try {
      const tokens = await nearRpc.getSupportedTokens(c.env);
      const tokenInfo = tokens.find(
        (t) =>
          t.defuse_asset_id.toLowerCase() === body.asset.toLowerCase() ||
          t.symbol.toLowerCase() === body.asset.toLowerCase()
      );
      const decimals = tokenInfo?.decimals ?? 18;
      baseUnitsAmount = /^\d+$/.test(body.amount) ? body.amount : nearRpc.toBaseUnits(body.amount, decimals);
    } catch {}

    let quoteResult: any = null;
    try {
      quoteResult = await nearProxy.quote(c.env, {
        recipientHandle: quoteRecipient,
        asset: body.asset,
        amount: baseUnitsAmount,
        confidentiality: 'advanced',
      });
    } catch (proxyErr: any) {
      console.warn('nearProxy.quote fallback to platform escrow holding wallet:', proxyErr);
      const fallbackQuoteId = ulid();
      const fallbackExpiresAt = Date.now() + 15 * 60 * 1000;
      const secret = c.env.SESSION_SECRET || c.env.INTERNAL_SERVICE_KEY || 'uprail_confidential_master_sig';
      const sigToken = await signQuote(secret, {
        quoteId: fallbackQuoteId,
        asset: body.asset,
        amount: body.amount,
        recipient: quoteRecipient,
        depositAddress: holdingAccount,
        expiresAt: fallbackExpiresAt,
      });

      quoteResult = {
        quoteId: fallbackQuoteId,
        depositAddress: holdingAccount,
        quoteSignature: sigToken,
        estimatedFees: '0',
        expiresAt: fallbackExpiresAt,
      };
    }

    const feePercent = parseFloat(c.env.FEE_PERCENT || '0.008');
    const feeRecipient = c.env.FEE_ACCOUNT_ID || 'fees.uprail.near';
    const numAmount = parseFloat(body.amount) || 0;
    const protocolFee = (numAmount * feePercent).toFixed(6).replace(/\.?0+$/, '') || '0';

    return c.json<QuoteResponse>({
      quoteId: quoteResult.quoteId,
      recipientHandle: `@${cleanHandle}`,
      asset: body.asset,
      amount: body.amount,
      confidentiality: 'advanced',
      depositAddress: quoteResult.depositAddress || holdingAccount,
      quoteSignature: quoteResult.quoteSignature,
      estimatedFees: quoteResult.estimatedFees || '0',
      protocolFee,
      feeRecipient,
      expiresAt: quoteResult.expiresAt || Date.now() + 15 * 60 * 1000,
    });
  } catch (err: any) {
    console.error('Quote generation error:', err);
    return c.json<ErrorResponse>(
      {
        error: `Failed to retrieve confidential quote: ${err.message || 'Internal error'}`,
        code: 'QUOTE_ERROR',
      },
      500
    );
  }
});

/**
 * POST /api/send
 * Creates payment record in D1, initializes EscrowDO instance with 30-day expiry alarm.
 *
 * SECURITY: Requires both session auth AND passkey authorization.
 * The client must include `passkeyAssertion` (from /api/auth-challenge flow) in the body.
 * This ensures every fund movement is authorized by the user's physical device.
 */
paymentsRouter.post('/send', requireAuth(), requirePasskeyAuth(), async (c) => {
  try {
    // Body was already parsed and validated by requirePasskeyAuth()
    const body = (c.get('parsedBody' as any) || await c.req.json<SendRequest>().catch(() => null)) as SendRequest | null;
    if (
      !body ||
      !body.recipientHandle ||
      !body.asset ||
      !body.amount ||
      !body.quoteSignature ||
      !body.depositAddress
    ) {
      return c.json<ErrorResponse>(
        {
          error: 'Missing required parameters: recipientHandle, asset, amount, quoteSignature, depositAddress',
          code: 'INVALID_REQUEST',
        },
        400
      );
    }

    const cleanHandle = normalizeHandle(body.recipientHandle);
    if (!isValidXHandle(cleanHandle)) {
      return c.json<ErrorResponse>(
        { error: 'Invalid recipient handle format', code: 'INVALID_HANDLE' },
        400
      );
    }

    // Cryptographically verify quote signature authenticity and exact binding
    const quoteSecret = c.env.SESSION_SECRET || c.env.INTERNAL_SERVICE_KEY || 'uprail_confidential_master_sig';
    const quoteVerification = await verifyQuoteToken(quoteSecret, body.quoteSignature, {
      asset: body.asset,
      amount: body.amount,
      recipientHandle: cleanHandle,
      depositAddress: body.depositAddress,
    });

    if (!quoteVerification.valid) {
      return c.json<ErrorResponse>(
        {
          error: `Quote verification failed: ${quoteVerification.reason || 'Invalid quote signature'}`,
          code: 'INVALID_QUOTE_SIGNATURE',
        },
        400
      );
    }

    const session = c.get('session');
    const paymentId = ulid();
    const now = Date.now();
    const expiryDays = parseInt(c.env.PAYMENT_EXPIRY_DAYS || '30', 10);
    const expiresAt = now + expiryDays * 86400 * 1000;

    // 0.8% platform fee to fees.uprail.near on every send
    const feePercent = parseFloat(c.env.FEE_PERCENT || '0.008');
    const feeRecipient = c.env.FEE_ACCOUNT_ID || 'fees.uprail.near';
    const protocolFee = (parseFloat(body.amount) * feePercent).toFixed(6).replace(/\.?0+$/, '') || '0';

    // Generate preloaded 6-capital-letter invite code attached to this payment
    const inviteCode = await createPaymentInvite(c.env, paymentId, session?.x_id, session?.x_handle);

    const payment: Payment = {
      id: paymentId,
      sender_x_id: session?.x_id ?? null,
      sender_x_handle: session?.x_handle ?? null,
      recipient_handle: cleanHandle,
      asset: body.asset,
      amount: body.amount,
      fee: protocolFee,
      fee_recipient: feeRecipient,
      invite_code: inviteCode,
      status: PaymentStatus.DEPOSIT_WAITING,
      deposit_address: body.depositAddress,
      intent_hash: null,
      claim_tx_hash: null,
      refund_tx_hash: null,
      created_at: now,
      expires_at: expiresAt,
      updated_at: now,
    };

    // Immediately route 0.8% protocol fee to fees.uprail.near (send fee only, 0% on claim)
    if (parseFloat(protocolFee) > 0) {
      try {
        await nearProxy.transfer(c.env, {
          recipientNearAccount: feeRecipient,
          asset: body.asset,
          amount: protocolFee,
          escrowAccountId: c.env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near',
          paymentId: `${paymentId}_fee`,
        });
      } catch (feeErr) {
        console.warn('[FeeRouting] Immediate 0.8% send fee dispatch notice:', feeErr);
      }
    }

    // 1. Insert into PostgreSQL and D1 database
    const sql = getDb(c.env);
    if (sql) {
      try {
        await insertPayment(sql, payment);
      } catch (pgErr) {
        console.warn('Postgres insertPayment failed, falling back to D1:', pgErr);
      }
    }

    try {
      await c.env.DB.prepare(
        `
        INSERT INTO payments (
          id,
          sender_x_id,
          sender_x_handle,
          recipient_handle,
          asset,
          amount,
          fee,
          fee_recipient,
          invite_code,
          status,
          deposit_address,
          intent_hash,
          claim_tx_hash,
          refund_tx_hash,
          created_at,
          expires_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
      `
      )
        .bind(
          payment.id,
          payment.sender_x_id,
          payment.sender_x_handle,
          payment.recipient_handle,
          payment.asset,
          payment.amount,
          payment.fee,
          payment.fee_recipient,
          payment.invite_code,
          payment.status,
          payment.deposit_address,
          payment.created_at,
          payment.expires_at,
          payment.updated_at
        )
        .run();
    } catch (d1Err) {
      console.warn('D1 insert payment failed:', d1Err);
    }

    // 2. Initialize EscrowDO instance
    await callEscrowDO(c.env, paymentId, 'init', payment);

    const appOrigin = c.env.WEBAUTHN_ORIGIN || 'https://app.uprail.world';
    const shareLink = `${appOrigin}/claim/${paymentId}?invite=${inviteCode}`;

    return c.json<SendResponse>(
      {
        paymentId,
        shareLink,
        status: PaymentStatus.DEPOSIT_WAITING,
        depositAddress: body.depositAddress,
        expiresAt,
        fee: protocolFee,
        feeRecipient,
        inviteCode,
      },
      201
    );
  } catch (err: any) {
    console.error('Send payment error:', err);
    return c.json<ErrorResponse>(
      {
        error: `Failed to create payment: ${err.message || 'Internal error'}`,
        code: 'SEND_PAYMENT_ERROR',
      },
      500
    );
  }
});

/**
 * GET /api/payments
 * Lists sender's payment history from Postgres/D1 (requires session)
 */
paymentsRouter.get('/payments', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const userHandle = session.x_handle.toLowerCase();

    const sql = getDb(c.env);
    if (sql) {
      try {
        const pgPayments = await getUserPayments(sql, session.x_id, userHandle);
        if (pgPayments && pgPayments.length > 0) {
          return c.json({ payments: pgPayments });
        }
      } catch (pgErr) {
        console.warn('Postgres getUserPayments error, fallback to D1:', pgErr);
      }
    }

    const { results } = await c.env.DB.prepare(
      `
      SELECT * FROM payments
      WHERE sender_x_id = ? OR LOWER(recipient_handle) = ?
      ORDER BY created_at DESC
      LIMIT 50
    `
    )
      .bind(session.x_id, userHandle)
      .all<Payment>();

    return c.json({ payments: results || [] });
  } catch (err: any) {
    console.error('List payments error:', err);
    return c.json<ErrorResponse>(
      { error: 'Failed to retrieve payments', code: 'FETCH_PAYMENTS_ERROR' },
      500
    );
  }
});

/**
 * GET /api/payments/:id
 * Retrieve details for a single payment by ID.
 * Strict Object-Level Access Control (IDOR defense):
 * - If caller is the sender or recipient: full payment metadata is returned.
 * - If caller is unauthenticated or third party: sanitized public preview is returned.
 */
paymentsRouter.get('/payments/:id', async (c) => {
  try {
    const id = c.req.param('id');
    let payment: Payment | null = null;

    const sql = getDb(c.env);
    if (sql) {
      try {
        payment = await getPaymentById(sql, id);
      } catch (pgErr) {
        console.warn('Postgres getPaymentById error, fallback to D1:', pgErr);
      }
    }

    if (!payment) {
      payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?')
        .bind(id)
        .first<Payment>();
    }

    if (!payment) {
      return c.json<ErrorResponse>(
        { error: 'Payment not found', code: 'NOT_FOUND' },
        404
      );
    }

    // Try to get live status from EscrowDO
    try {
      const liveStatus = await callEscrowDO(c.env, id, 'status');
      if (liveStatus && liveStatus.status) {
        payment.status = liveStatus.status;
        payment.claim_tx_hash = liveStatus.claim_tx_hash;
        payment.refund_tx_hash = liveStatus.refund_tx_hash;
        payment.updated_at = liveStatus.updated_at;
      }
    } catch {
      // Ignore DO fetch error and fallback to DB state
    }

    const session = c.get('session');
    const isSender = Boolean(session && payment.sender_x_id && payment.sender_x_id === session.x_id);
    const isRecipient = Boolean(
      session &&
        payment.recipient_handle &&
        session.x_handle.toLowerCase() === payment.recipient_handle.toLowerCase()
    );

    if (isSender || isRecipient) {
      return c.json({ payment, isAuthorizedParty: true });
    }

    // Public / unauthenticated preview: sanitize sensitive fields to prevent IDOR data leakage
    const publicPreview: PublicPaymentPreview = {
      id: payment.id,
      recipient_handle: payment.recipient_handle,
      asset: payment.asset,
      amount: payment.amount,
      status: payment.status,
      created_at: payment.created_at,
      expires_at: payment.expires_at,
    };

    return c.json({ payment: publicPreview, isPublicPreview: true });
  } catch (err: any) {
    console.error('Get payment detail error:', err);
    return c.json<ErrorResponse>(
      { error: 'Failed to fetch payment', code: 'GET_PAYMENT_ERROR' },
      500
    );
  }
});

/**
 * POST /api/payments/:id/cancel
 * Cancel payment if status is PENDING or DEPOSIT_WAITING.
 * Strict Object-Level Access Control (IDOR & BAC defense):
 * - MUST be authenticated via requireAuth()
 * - Caller MUST be the verified sender (sender_x_id === session.x_id)
 */
paymentsRouter.post('/payments/:id/cancel', requireAuth(), async (c) => {
  try {
    const id = c.req.param('id');
    const session = c.get('session')!;

    let payment: Payment | null = null;
    const sql = getDb(c.env);
    if (sql) {
      try {
        payment = await getPaymentById(sql, id);
      } catch (pgErr) {
        console.warn('Postgres getPaymentById in cancel error:', pgErr);
      }
    }

    if (!payment) {
      payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?')
        .bind(id)
        .first<Payment>();
    }

    if (!payment) {
      return c.json<ErrorResponse>(
        { error: 'Payment not found', code: 'NOT_FOUND' },
        404
      );
    }

    // Fail-closed authorization: only the original authenticated sender may cancel
    if (!payment.sender_x_id || payment.sender_x_id !== session.x_id) {
      return c.json<ErrorResponse>(
        {
          error: 'Forbidden: Only the authenticated sender of this intent may cancel it',
          code: 'FORBIDDEN',
        },
        403
      );
    }

    if (
      payment.status !== PaymentStatus.PENDING &&
      payment.status !== PaymentStatus.DEPOSIT_WAITING
    ) {
      return c.json<ErrorResponse>(
        {
          error: `Payment in status ${payment.status} cannot be cancelled`,
          code: 'INVALID_STATUS',
        },
        400
      );
    }

    const updated = await callEscrowDO(c.env, id, 'cancel', {
      senderXId: session.x_id,
    });

    // Update Postgres and D1 records status
    if (sql) {
      try {
        await updatePaymentStatus(sql, id, PaymentStatus.CANCELLED);
      } catch (pgErr) {
        console.warn('Postgres updatePaymentStatus failed in cancel:', pgErr);
      }
    }

    const now = Date.now();
    try {
      await c.env.DB.prepare(
        'UPDATE payments SET status = ?, updated_at = ? WHERE id = ?'
      )
        .bind(PaymentStatus.CANCELLED, now, id)
        .run();
    } catch (d1Err) {
      console.warn('D1 update payment status failed in cancel:', d1Err);
    }

    return c.json({
      success: true,
      paymentId: id,
      status: updated?.status || PaymentStatus.CANCELLED,
    });
  } catch (err: any) {
    console.error('Cancel payment error:', err);
    return c.json<ErrorResponse>(
      { error: err.message || 'Failed to cancel payment', code: 'CANCEL_ERROR' },
      500
    );
  }
});
