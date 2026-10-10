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
import { requireQuoteSecret } from '../utils/secrets';
import { resolveOrigin } from '../services/webauthnConfig';
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

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_ACCOUNT_RE =
  /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)*$/;
const IMPLICIT_ACCOUNT_RE = /^[0-9a-f]{64}$/;

/**
 * Classifies a raw recipient value as either a raw chain address
 * ("Send to Wallet": EVM, Solana, NEAR named/implicit account) or an X handle.
 * Handles are lowercased without '@'; addresses keep their canonical form
 * (EVM/NEAR named accounts are case-insensitive → lowercase; Solana base58
 * and64-hex implicit accounts are case-sensitive → preserved).
 */
function classifyRecipient(raw: string): { isAddress: boolean; value: string } {
  const t = raw.trim();
  if (EVM_ADDRESS_RE.test(t)) return { isAddress: true, value: t.toLowerCase() };
  if (IMPLICIT_ACCOUNT_RE.test(t)) return { isAddress: true, value: t };
  if (SOLANA_ADDRESS_RE.test(t)) return { isAddress: true, value: t };
  // NEAR named accounts always contain a dot; X handles never do.
  if (t.includes('.') && NEAR_ACCOUNT_RE.test(t)) return { isAddress: true, value: t.toLowerCase() };
  return { isAddress: false, value: normalizeHandle(t) };
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
    const mapped = tokens.map((t) => {
      const symUpper = t.symbol.toUpperCase();
      let badge = 'Cross-chain';
      if (t.chain === 'near' && (symUpper === 'NEAR' || symUpper === 'WNEAR')) {
        badge = 'Native Shield';
      } else if (t.chain === 'near' && (symUpper === 'USDC' || symUpper === 'USDT')) {
        badge = 'Confidential';
      } else if (t.chain === 'base') {
        badge = 'Base L2';
      } else if (t.chain === 'arbitrum' || t.chain === 'arb') {
        badge = 'Arbitrum L2';
      } else if (t.chain === 'sol') {
        badge = 'Solana SPL';
      } else if (t.chain === 'eth') {
        badge = 'Ethereum L1';
      } else if (t.chain === 'btc') {
        badge = 'Bitcoin Native';
      }

      const isNativeCanonical =
        (symUpper === 'NEAR' && (t.chain === 'near' || t.nearContractId === 'wrap.near')) ||
        (symUpper === 'USDC' && (t.nearContractId?.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1') || t.chain === 'near')) ||
        (symUpper === 'USDT' && (t.nearContractId?.includes('usdt.tether-token.near') || t.chain === 'near')) ||
        (symUpper === 'ETH' && (t.nearContractId?.includes('eth.bridge.near') || t.chain === 'near')) ||
        (symUpper === 'BTC' && (t.nearContractId?.includes('btc.omft.near') || t.chain === 'btc')) ||
        (symUpper === 'SOL' && (t.nearContractId?.includes('sol.omft.near') || t.chain === 'sol'));

      let category: 'popular' | 'stables' | 'l1' | 'all' = 'all';
      if (isNativeCanonical) {
        category = 'popular';
      } else if (['USDC', 'USDT', 'DAI', 'FRAX', 'USDG'].some((s) => symUpper.includes(s))) {
        category = 'stables';
      } else if (['NEAR', 'ETH', 'BTC', 'SOL', 'AVAX', 'BNB', 'AURORA'].some((s) => symUpper.includes(s))) {
        category = 'l1';
      }

      return {
        id: t.defuse_asset_id,
        symbol: t.symbol,
        name: t.name,
        iconUrl: t.icon || '',
        decimals: t.decimals,
        nearContractId: t.nearContractId,
        chain: t.chain,
        chainId: t.chainId,
        badge,
        category,
        balance: '0.00',
        priceUsd: t.priceUsd ?? 1.0,
      };
    });
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

    const recipient = classifyRecipient(body.recipientHandle);
    if (!recipient.isAddress && !isValidXHandle(recipient.value)) {
      return c.json<ErrorResponse>(
        { error: 'Invalid recipient: expected an X handle or a valid wallet address', code: 'INVALID_HANDLE' },
        400
      );
    }
    const cleanHandle = recipient.value;

    if (isNaN(Number(body.amount)) || Number(body.amount) <= 0) {
      return c.json<ErrorResponse>(
        { error: 'Amount must be a positive numeric value', code: 'INVALID_AMOUNT' },
        400
      );
    }

    const holdingAccount = c.env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';

    // Check if recipient is already registered with an active NEAR intent account
    // (only meaningful for X-handle recipients; wallet addresses never map to
    // an x_identities row).
    let recipientNearAccount: string | null = null;
    let isRegistered = false;
    if (!recipient.isAddress) {
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
    }

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
        // Sign with the X handle + human amount: that is exactly what
        // /api/send verifies against.
        signing: { recipient: cleanHandle, amount: body.amount },
      });
    } catch (proxyErr: any) {
      console.warn('nearProxy.quote fallback to platform escrow holding wallet:', proxyErr);
      const fallbackQuoteId = ulid();
      const fallbackExpiresAt = Date.now() + 15 * 60 * 1000;
      const secret = requireQuoteSecret(c.env);
      const sigToken = await signQuote(secret, {
        quoteId: fallbackQuoteId,
        asset: body.asset,
        amount: body.amount,
        recipient: cleanHandle,
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
      recipientHandle: recipient.isAddress ? cleanHandle : `@${cleanHandle}`,
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

    const recipient = classifyRecipient(body.recipientHandle);
    if (!recipient.isAddress && !isValidXHandle(recipient.value)) {
      return c.json<ErrorResponse>(
        { error: 'Invalid recipient: expected an X handle or a valid wallet address', code: 'INVALID_HANDLE' },
        400
      );
    }
    const cleanHandle = recipient.value;

    // Cryptographically verify quote signature authenticity and exact binding
    const quoteSecret = requireQuoteSecret(c.env);
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

    // Resolve the recipient's immutable X identity (if already registered) so
    // claim authorization never depends on a mutable handle. NULL when the
    // recipient has not signed up yet — claim falls back to the handle and
    // backfills this column atomically. Wallet-address recipients never map
    // to an x_identities row and stay NULL.
    let recipientXId: string | null = null;
    if (!recipient.isAddress) {
      try {
        const row = await c.env.DB.prepare(
          'SELECT x_id FROM x_identities WHERE LOWER(x_handle) = ?'
        )
          .bind(cleanHandle)
          .first<{ x_id: string }>();
        recipientXId = row?.x_id ?? null;
      } catch (lookupErr) {
        console.warn('[send] recipient x_id lookup failed:', lookupErr);
      }
    }

    const memo = typeof (body as any).memo === 'string' ? (body as any).memo.trim().slice(0, 280) : null;

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
      recipient_x_id: recipientXId,
      asset: body.asset,
      amount: body.amount,
      fee: protocolFee,
      fee_recipient: feeRecipient,
      invite_code: inviteCode,
      memo,
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
          recipient_x_id,
          asset,
          amount,
          fee,
          fee_recipient,
          invite_code,
          memo,
          status,
          deposit_address,
          intent_hash,
          claim_tx_hash,
          refund_tx_hash,
          created_at,
          expires_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
      `
      )
        .bind(
          payment.id,
          payment.sender_x_id,
          payment.sender_x_handle,
          payment.recipient_handle,
          payment.recipient_x_id,
          payment.asset,
          payment.amount,
          payment.fee,
          payment.fee_recipient,
          payment.invite_code,
          payment.memo,
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

    const appOrigin = resolveOrigin(c.env);
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
        ((payment.recipient_x_id && payment.recipient_x_id === session.x_id) ||
          (payment.recipient_handle &&
            session.x_handle.toLowerCase() === payment.recipient_handle.toLowerCase()))
    );

    if (isSender || isRecipient) {
      return c.json({ payment, isAuthorizedParty: true });
    }

    // Public preview: only non-sensitive fields. See PublicPaymentPreview.
    const publicPreview: PublicPaymentPreview = {
      id: payment.id,
      asset: payment.asset,
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
