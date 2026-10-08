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
import { requireAuth } from '../middleware/session';

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

    // Call Go Container via NearProxy
    const quoteResult = await nearProxy.quote(c.env, {
      recipientHandle: cleanHandle,
      asset: body.asset,
      amount: body.amount,
      confidentiality: 'advanced',
    });

    return c.json<QuoteResponse>({
      quoteId: quoteResult.quoteId,
      recipientHandle: `@${cleanHandle}`,
      asset: body.asset,
      amount: body.amount,
      confidentiality: 'advanced',
      depositAddress: quoteResult.depositAddress,
      quoteSignature: quoteResult.quoteSignature,
      estimatedFees: quoteResult.estimatedFees || '0',
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
 * Creates payment record in D1, initializes EscrowDO instance with 30-day expiry alarm
 */
paymentsRouter.post('/send', async (c) => {
  try {
    const body = await c.req.json<SendRequest>().catch(() => null);
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

    const session = c.get('session');
    const paymentId = ulid();
    const now = Date.now();
    const expiryDays = parseInt(c.env.PAYMENT_EXPIRY_DAYS || '30', 10);
    const expiresAt = now + expiryDays * 86400 * 1000;

    const payment: Payment = {
      id: paymentId,
      sender_x_id: session?.x_id ?? null,
      sender_x_handle: session?.x_handle ?? null,
      recipient_handle: cleanHandle,
      asset: body.asset,
      amount: body.amount,
      status: PaymentStatus.DEPOSIT_WAITING,
      deposit_address: body.depositAddress,
      intent_hash: null,
      claim_tx_hash: null,
      refund_tx_hash: null,
      created_at: now,
      expires_at: expiresAt,
      updated_at: now,
    };

    // 1. Insert into D1 database
    await c.env.DB.prepare(
      `
      INSERT INTO payments (
        id,
        sender_x_id,
        sender_x_handle,
        recipient_handle,
        asset,
        amount,
        status,
        deposit_address,
        intent_hash,
        claim_tx_hash,
        refund_tx_hash,
        created_at,
        expires_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
    `
    )
      .bind(
        payment.id,
        payment.sender_x_id,
        payment.sender_x_handle,
        payment.recipient_handle,
        payment.asset,
        payment.amount,
        payment.status,
        payment.deposit_address,
        payment.created_at,
        payment.expires_at,
        payment.updated_at
      )
      .run();

    // 2. Initialize EscrowDO instance
    await callEscrowDO(c.env, paymentId, 'init', payment);

    const shareLink = `https://uprail.app/claim/${paymentId}`;

    return c.json<SendResponse>(
      {
        paymentId,
        shareLink,
        status: PaymentStatus.DEPOSIT_WAITING,
        depositAddress: body.depositAddress,
        expiresAt,
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
 * Lists sender's payment history from D1 (requires session)
 */
paymentsRouter.get('/payments', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const userHandle = session.x_handle.toLowerCase();
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

    return c.json({ payments: results });
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
    const payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?')
      .bind(id)
      .first<Payment>();

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
      // Ignore DO fetch error and fallback to D1 state
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

    const payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?')
      .bind(id)
      .first<Payment>();

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

    // Update D1 record status
    const now = Date.now();
    await c.env.DB.prepare(
      'UPDATE payments SET status = ?, updated_at = ? WHERE id = ?'
    )
      .bind(PaymentStatus.CANCELLED, now, id)
      .run();

    return c.json({
      success: true,
      paymentId: id,
      status: updated.status || PaymentStatus.CANCELLED,
    });
  } catch (err: any) {
    console.error('Cancel payment error:', err);
    return c.json<ErrorResponse>(
      { error: err.message || 'Failed to cancel payment', code: 'CANCEL_ERROR' },
      500
    );
  }
});
