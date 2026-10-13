/**
 * Payment routing for UP (UPRAIL.app)
 * Send flow: Resolve handle, Request quote, Send escrow, List/get/cancel payments
 */

import { Hono } from 'hono';
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
import { refundEscrowedPayment } from '../services/refunds';
import { signQuote, verifyQuoteToken } from '../services/quoteAuth';
import { requireQuoteSecret } from '../utils/secrets';
import { resolveOrigin } from '../services/webauthnConfig';
import { createPaymentInvite } from '../services/inviteService';
import { requireAuth } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { publicErrorMessage } from '../utils/errors';

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
 * Shapes one registry token for the picker: badge, category and the live
 * price passed through untouched (undefined stays undefined — the UI renders
 * "—"). Shared by /api/tokens and /api/tokens/search so both lists agree.
 */
function mapPublicToken(t: any) {
  const symUpper = (t.symbol || '').toUpperCase();
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
  } else if (t.chain === 'near') {
    badge = 'NEAR Native';
  }

  const isNativeCanonical =
    (symUpper === 'NEAR' && (t.chain === 'near' || t.nearContractId === 'wrap.near')) ||
    (symUpper === 'USDC' && (t.nearContractId?.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1') || t.chain === 'near')) ||
    (symUpper === 'USDT' && (t.nearContractId?.includes('usdt.tether-token.near') || t.chain === 'near')) ||
    (symUpper === 'ETH' && (t.nearContractId?.includes('eth.bridge.near') || t.chain === 'near')) ||
    (symUpper === 'BTC' && (t.nearContractId?.includes('btc.omft.near') || t.chain === 'btc')) ||
    (symUpper === 'SOL' && (t.nearContractId?.includes('sol.omft.near') || t.chain === 'sol'));

  let category: 'popular' | 'stables' | 'l1' | 'memes' | 'all' = t.category || 'all';
  if (isNativeCanonical) {
    category = 'popular';
  } else if (category === 'all' || category === 'memes') {
    if (nearRpc.isMemeAsset(symUpper, t.nearContractId || t.defuse_asset_id || '')) {
      category = 'memes';
    } else if (['USDC', 'USDT', 'DAI', 'FRAX', 'USDG'].some((s) => symUpper.includes(s))) {
      category = 'stables';
    } else if (['NEAR', 'ETH', 'BTC', 'SOL', 'AVAX', 'BNB', 'AURORA'].some((s) => symUpper.includes(s))) {
      category = 'l1';
    }
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
    // Live registry price, passed through untouched. Undefined means the
    // registry had no quote for this asset — the UI renders "—".
    priceUsd: t.priceUsd,
  };
}

/**
 * GET /api/tokens
 * Returns all tokens supported by NEAR Intents, pulled live from the intents
 * contract, plus a curated head of native NEAR (Rhea/Ref) tokens — including
 * launchpad memes — that Intents does not cover. No hardcoded list.
 */
paymentsRouter.get('/tokens', async (c) => {
  try {
    const tokens = await nearRpc.getSupportedTokens(c.env);
    const mapped = tokens.map(mapPublicToken);
    return c.json({ tokens: mapped });
  } catch (err: any) {
    console.error('[/api/tokens] onchain fetch failed:', err);
    return c.json<ErrorResponse>(
      { error: `Failed to load token list: ${publicErrorMessage(err)}`, code: 'TOKEN_LIST_ERROR' },
      500
    );
  }
});

/**
 * GET /api/tokens/search?q=
 * Searches the full Rhea (Ref) native NEAR token list — the long tail that
 * does not fit the curated /api/tokens head (launchpad memes such as
 * `*.nearlytrade.near`, long-tail NEP-141s). Public, no user data.
 * Returns at most 25 matches shaped exactly like /api/tokens entries.
 */
paymentsRouter.get('/tokens/search', async (c) => {
  try {
    const q = (c.req.query('q') || '').trim().toLowerCase();
    if (q.length < 2) return c.json({ tokens: [] });
    const rhea = await nearRpc.getRheaTokens(c.env);
    const matches = rhea
      .filter(
        (e) =>
          e.symbol.toLowerCase().includes(q) ||
          e.contractId.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q)
      )
      .slice(0, 25)
      .map((e) => nearRpc.rheaToOnchainToken(e))
      .map(mapPublicToken);
    return c.json({ tokens: matches });
  } catch (err: any) {
    console.error('[/api/tokens/search] error:', err);
    return c.json<ErrorResponse>(
      { error: `Token search failed: ${publicErrorMessage(err)}`, code: 'TOKEN_SEARCH_ERROR' },
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
      { error: publicErrorMessage(err, 'Resolve failed'), code: 'RESOLVE_ERROR' },
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

    // `body.amount` is ALWAYS a human-readable decimal string ("5", "0.005").
    // Convert to base units with the token's decimals. Integer-looking values
    // must not be treated as already-converted base units: "5" used to be
    // passed through verbatim and quote 5e-6 tokens instead of 5.
    const amountStr = String(body.amount ?? '').trim();
    if (!/^\d{1,15}(\.\d{1,15})?$/.test(amountStr) || Number(amountStr) <= 0) {
      return c.json<ErrorResponse>(
        { error: 'Invalid amount: expected a positive decimal number', code: 'INVALID_AMOUNT' },
        400
      );
    }

    let baseUnitsAmount: string;
    try {
      const tokens = await nearRpc.getSupportedTokens(c.env);
      let tokenInfo = nearRpc.resolveTokenForAsset(body.asset, tokens);
      // Rhea long tail: an asset found via /api/tokens/search may not sit in
      // the curated head — resolve it straight from the cached Rhea list.
      if (!tokenInfo) {
        tokenInfo = await nearRpc.resolveRheaToken(c.env, body.asset);
      }
      if (!tokenInfo) {
        return c.json<ErrorResponse>(
          { error: `Unsupported asset: ${body.asset}`, code: 'UNSUPPORTED_ASSET' },
          400
        );
      }
      baseUnitsAmount = nearRpc.toBaseUnits(amountStr, tokenInfo.decimals);
    } catch (tokenErr) {
      console.warn('[send] token registry unavailable, cannot convert amount:', tokenErr);
      return c.json<ErrorResponse>(
        { error: 'Unable to resolve asset metadata; try again', code: 'TOKEN_REGISTRY_UNAVAILABLE' },
        502
      );
    }

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
      const fallbackQuoteId = crypto.randomUUID();
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

    const feePercent = parseFloat(c.env.FEE_PERCENT || '0.05');
    const feeRecipient = c.env.FEE_ACCOUNT_ID || 'fees.uprail.near';
    const numAmount = parseFloat(body.amount) || 0;
    const protocolFee = (numAmount * feePercent).toFixed(6).replace(/\.?0+$/, '') || '0';
    // The fee is carved out of the amount being sent — the recipient gets
    // amount − fee, never less than promised minus the published rate.
    const recipientAmount =
      (numAmount - parseFloat(protocolFee)).toFixed(6).replace(/\.?0+$/, '') || '0';

    return c.json<QuoteResponse>({
      quoteId: quoteResult.quoteId,
      recipientHandle: recipient.isAddress ? cleanHandle : `@${cleanHandle}`,
      asset: body.asset,
      amount: body.amount,
      recipientAmount,
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
        error: `Failed to retrieve confidential quote: ${publicErrorMessage(err, 'Internal error')}`,
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

    // Amount is stored and signed as a human-readable decimal; reject anything
    // that would turn into NaN/Infinity downstream (fee math, base-unit math).
    const amountStr = String(body.amount ?? '').trim();
    if (!/^\d{1,15}(\.\d{1,15})?$/.test(amountStr) || Number(amountStr) <= 0) {
      return c.json<ErrorResponse>(
        { error: 'Invalid amount: expected a positive decimal number', code: 'INVALID_AMOUNT' },
        400
      );
    }

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
    const paymentId = crypto.randomUUID();
    const now = Date.now();
    const expiryDays = parseInt(c.env.PAYMENT_EXPIRY_DAYS || '30', 10);
    const expiresAt = now + expiryDays * 86400 * 1000;

    // Resolve the recipient's immutable X identity (if already registered) so
    // claim authorization never depends on a mutable handle. NULL when the
    // recipient has not signed up yet — claim falls back to the handle and
    // backfills this column atomically. Wallet-address recipients never map
    // to an x_identities row and stay NULL.
    let recipientXId: string | null = null;
    let recipientNearAccount: string | null = null;
    let isRecipientRegistered = false;
    if (!recipient.isAddress) {
      try {
        const row = await c.env.DB.prepare(
          'SELECT x_id, near_account, is_activated FROM x_identities WHERE LOWER(x_handle) = ?'
        )
          .bind(cleanHandle)
          .first<{ x_id: string; near_account: string | null; is_activated: number | boolean }>();
        if (row) {
          recipientXId = row.x_id;
          recipientNearAccount = row.near_account;
          isRecipientRegistered = Boolean(row.near_account || row.is_activated);
        }
      } catch (lookupErr) {
        console.warn('[send] recipient x_id lookup failed:', lookupErr);
      }
    }

    const memo = typeof (body as any).memo === 'string' ? (body as any).memo.trim().slice(0, 280) : null;

    // Protocol fee to fees.uprail.near on every send (FEE_PERCENT, 5%).
    // The fee is carved out of the amount being sent: the recipient claims
    // amount − fee and the sender's balance is only ever debited `amount`.
    const feePercent = parseFloat(c.env.FEE_PERCENT || '0.05');
    const feeRecipient = c.env.FEE_ACCOUNT_ID || 'fees.uprail.near';
    const grossAmount = parseFloat(body.amount) || 0;
    const protocolFee = (grossAmount * feePercent).toFixed(6).replace(/\.?0+$/, '') || '0';
    const recipientAmount =
      (grossAmount - parseFloat(protocolFee)).toFixed(6).replace(/\.?0+$/, '') || '0';
    if (parseFloat(recipientAmount) <= 0) {
      return c.json<ErrorResponse>(
        { error: 'Amount too small to cover the protocol fee', code: 'INVALID_AMOUNT' },
        400
      );
    }

    // Verify sender has sufficient available balance — only the amount being
    // sent leaves their balance (the fee comes out of it, not on top of it).
    if (session) {
      const available = await nearRpc.getUserAvailableBalance(c.env, session, body.asset);
      if (grossAmount > available + 0.0001) {
        return c.json<ErrorResponse>(
          {
            error: `Insufficient balance. Available: ${available.toFixed(2)}`,
            code: 'INSUFFICIENT_FUNDS',
          },
          400
        );
      }
    }

    // ── 1. Record FIRST, move funds SECOND ─────────────────────────────────
    // The payment row is written before any onchain movement so a crash,
    // timeout or DB failure can never leave transferred funds without a
    // claimable record. The row starts PENDING and is finalized to
    // CLAIMED/ESCROWED (with the settlement hashes) only after the onchain
    // transfer confirms. A failed settlement marks it CANCELLED.
    const holdingAccount = c.env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';

    // Generate preloaded invite code only when the recipient is not yet registered
    const inviteCode = isRecipientRegistered
      ? null
      : await createPaymentInvite(c.env, paymentId, session?.x_id, session?.x_handle);

    const payment: Payment = {
      id: paymentId,
      sender_x_id: session?.x_id ?? null,
      sender_x_handle: session?.x_handle ?? null,
      recipient_handle: cleanHandle,
      recipient_x_id: recipientXId,
      asset: body.asset,
      // The row stores what the recipient can actually claim (amount − fee);
      // the fee column carries the carved-out protocol fee separately.
      amount: recipientAmount,
      fee: protocolFee,
      fee_recipient: feeRecipient,
      invite_code: inviteCode,
      memo,
      status: PaymentStatus.PENDING,
      deposit_address: body.depositAddress,
      intent_hash: null,
      claim_tx_hash: null,
      refund_tx_hash: null,
      created_at: now,
      expires_at: expiresAt,
      updated_at: now,
    };

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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
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
          payment.intent_hash,
          payment.claim_tx_hash,
          payment.created_at,
          payment.expires_at,
          payment.updated_at
        )
        .run();
    } catch (d1Err) {
      console.error('[send] D1 insert payment failed before settlement:', d1Err);
      return c.json<ErrorResponse>(
        {
          error: 'Could not record the payment — no funds were moved. Please retry.',
          code: 'PAYMENT_RECORD_FAILED',
        },
        500
      );
    }

    /**
     * Settlement failed before/while funds moved: mark the still-PENDING row
     * CANCELLED so it never shows up as claimable, then return the error.
     */
    const failSend = async (
      code: string,
      message: string,
      status: 400 | 500 | 502
    ): Promise<Response> => {
      try {
        await c.env.DB.prepare(
          'UPDATE payments SET status = ?, updated_at = ? WHERE id = ? AND status = ?'
        )
          .bind(PaymentStatus.CANCELLED, Date.now(), paymentId, PaymentStatus.PENDING)
          .run();
      } catch (cancelErr) {
        console.error(`[send] failed to mark ${paymentId} cancelled after settlement failure:`, cancelErr);
      }
      return c.json<ErrorResponse>({ error: message, code }, status);
    };

    // ── 2. Move funds ──────────────────────────────────────────────────────
    let claimTxHash: string | null = null;
    let escrowDepositTxHash: string | null = null;

    // Plain-balance path: tokens received directly into the sender's own pk
    // sub-account move into intents with ft_transfer_call(msg = credit target)
    // — the recipient's platform account when registered, the escrow holding
    // account otherwise (exactly the targets the signed-intent path uses).
    // Direct sends deliver amount − fee to the recipient; escrowed sends lock
    // the gross amount (the fee is carved out of escrow at claim time), so in
    // every case the sender's vault loses exactly `amount`.
    const creditTarget =
      isRecipientRegistered && recipientNearAccount ? recipientNearAccount : holdingAccount;
    const creditAmount = isRecipientRegistered ? recipientAmount : body.amount;
    const plainDeposit = await nearRpc.depositPlainBalanceToIntents(
      c.env,
      session!.x_id,
      body.asset,
      creditAmount,
      creditTarget
    );

    if (plainDeposit.deposited && plainDeposit.txHash) {
      if (isRecipientRegistered) claimTxHash = plainDeposit.txHash;
      else escrowDepositTxHash = plainDeposit.txHash;
    } else if (isRecipientRegistered && recipientNearAccount) {
      const transferResult = await nearRpc.executeTransferIntent(
        c.env,
        session!.x_id,
        recipientNearAccount,
        body.asset,
        recipientAmount
      );
      if (transferResult?.success && transferResult.txHash) {
        claimTxHash = transferResult.txHash;
      } else {
        console.error('[send] direct transfer onchain error:', transferResult?.error);
        return await failSend(
          'SETTLEMENT_FAILED',
          publicErrorMessage(new Error(transferResult?.error || ''), 'Onchain settlement failed'),
          502
        );
      }
    } else {
      // Recipient is not registered yet. Debit sender's vault onchain into the escrow holding account.
      const transferResult = await nearRpc.executeTransferIntent(
        c.env,
        session!.x_id,
        holdingAccount,
        body.asset,
        body.amount
      );
      if (transferResult?.success && transferResult.txHash) {
        escrowDepositTxHash = transferResult.txHash;
      } else {
        console.error('[send] escrow lock onchain error:', transferResult?.error);
        return await failSend(
          'ESCROW_LOCK_FAILED',
          publicErrorMessage(new Error(transferResult?.error || ''), 'Escrow lock failed'),
          502
        );
      }
    }

    // ── 3. Finalize the record with the settlement hashes ──────────────────
    const paymentStatus = isRecipientRegistered ? PaymentStatus.CLAIMED : PaymentStatus.ESCROWED;
    try {
      const finalize = await c.env.DB.prepare(
        `UPDATE payments
            SET status = ?, deposit_address = ?, intent_hash = ?, claim_tx_hash = ?, updated_at = ?
          WHERE id = ? AND status = ?`
      )
        .bind(
          paymentStatus,
          escrowDepositTxHash || payment.deposit_address,
          escrowDepositTxHash,
          claimTxHash,
          Date.now(),
          paymentId,
          PaymentStatus.PENDING
        )
        .run();
      if ((finalize.meta?.changes ?? 0) === 0) {
        console.error(
          `[send] CRITICAL: settlement ${claimTxHash || escrowDepositTxHash} succeeded but ${paymentId} was no longer PENDING`
        );
        return c.json<ErrorResponse>(
          {
            error: `Payment settled but could not be finalized — quote payment id ${paymentId} to support`,
            code: 'SEND_NOT_RECORDED',
          },
          500
        );
      }
    } catch (finErr) {
      console.error(`[send] CRITICAL: settlement succeeded but finalize failed for ${paymentId}:`, finErr);
      return c.json<ErrorResponse>(
        {
          error: `Payment settled but could not be recorded — quote payment id ${paymentId} to support`,
          code: 'SEND_NOT_RECORDED',
        },
        500
      );
    }

    // ── 4. Protocol fee ────────────────────────────────────────────────────
    // Direct sends route the fee from the sender's own vault immediately.
    // Escrowed sends keep the fee inside escrow: it is dispatched to
    // fees.uprail.near when the recipient claims (or returned to the sender
    // with the gross amount if the payment expires unclaimed).
    //
    // The outcome is recorded on the payment row rather than only logged:
    // the recipient has already been paid by this point, so a fee that cannot
    // be routed must never roll the send back — but it must also never be
    // invisible. An unrecorded failure is indistinguishable from a fee that
    // was never attempted, which is how fees.uprail.near stayed at zero.
    let feeDispatchStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
    let feeDispatchError: string | null = null;
    if (isRecipientRegistered && parseFloat(protocolFee) > 0) {
      try {
        const feeDeposit = await nearRpc.depositPlainBalanceToIntents(
          c.env,
          session!.x_id,
          body.asset,
          protocolFee,
          feeRecipient
        );
        if (feeDeposit.deposited) {
          feeDispatchStatus = 'sent';
        } else {
          const feeTx = await nearRpc.executeTransferIntent(
            c.env,
            session!.x_id,
            feeRecipient,
            body.asset,
            protocolFee
          );
          if (feeTx?.success) {
            feeDispatchStatus = 'sent';
          } else {
            feeDispatchStatus = 'failed';
            feeDispatchError = feeTx?.error || 'fee intent transfer failed';
          }
        }
      } catch (feeErr: any) {
        feeDispatchStatus = 'failed';
        feeDispatchError = feeErr?.message || String(feeErr);
        console.warn('[FeeRouting] Direct-send fee dispatch failed:', feeErr);
      }
    } else if (parseFloat(protocolFee) > 0) {
      feeDispatchStatus = 'skipped';
      feeDispatchError = 'held in escrow until claim';
    }
    if (feeDispatchStatus !== 'skipped' || feeDispatchError) {
      try {
        await c.env.DB.prepare(
          'UPDATE payments SET fee_dispatch_status = ?, fee_dispatch_error = ?, updated_at = ? WHERE id = ?'
        )
          .bind(feeDispatchStatus, feeDispatchError, Date.now(), paymentId)
          .run();
      } catch (feeDbErr) {
        console.error(`[FeeRouting] could not record fee dispatch for ${paymentId}:`, feeDbErr);
      }
    }

    const appOrigin = resolveOrigin(c.env);
    const shareLink = isRecipientRegistered
      ? ''
      : `${appOrigin}/claim/${paymentId}?invite=${inviteCode}`;

    return c.json<SendResponse>(
      {
        paymentId,
        shareLink,
        status: paymentStatus,
        depositAddress: body.depositAddress,
        expiresAt,
        fee: protocolFee,
        recipientAmount,
        feeRecipient,
        inviteCode: inviteCode || undefined,
        isDirect: isRecipientRegistered,
      },
      201
    );
  } catch (err: any) {
    console.error('Send payment error:', err);
    return c.json<ErrorResponse>(
      {
        error: `Failed to create payment: ${publicErrorMessage(err, 'Internal error')}`,
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

    payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?')
      .bind(id)
      .first<Payment>();

    if (!payment) {
      return c.json<ErrorResponse>(
        { error: 'Payment not found', code: 'NOT_FOUND' },
        404
      );
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
 * Cancels an unclaimed escrowed payment and refunds the escrowed gross
 * (amount + fee) back to the sender's vault.
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

    if (payment.status === PaymentStatus.CLAIMED) {
      return c.json<ErrorResponse>(
        { error: 'Payment was already claimed and can no longer be cancelled', code: 'INVALID_STATUS' },
        400
      );
    }

    if (payment.status === PaymentStatus.REFUNDED) {
      return c.json({ success: true, paymentId: id, status: payment.status, txHash: payment.refund_tx_hash });
    }

    if (payment.status !== PaymentStatus.ESCROWED) {
      return c.json<ErrorResponse>(
        { error: `Payment in status ${payment.status} cannot be cancelled`, code: 'INVALID_STATUS' },
        400
      );
    }

    const refund = await refundEscrowedPayment(c.env, payment);
    if (refund.alreadyRefunded) {
      return c.json({ success: true, paymentId: id, status: PaymentStatus.REFUNDED });
    }
    if (!refund.refunded) {
      console.warn(`[cancel] refund failed for ${id}:`, refund.error);
      return c.json<ErrorResponse>(
        {
          error: publicErrorMessage(new Error(refund.error || ''), 'Could not settle the refund'),
          code: 'CANCEL_REFUND_FAILED',
        },
        502
      );
    }

    return c.json({
      success: true,
      paymentId: id,
      status: PaymentStatus.REFUNDED,
      txHash: refund.txHash,
    });
  } catch (err: any) {
    console.error('Cancel payment error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to cancel payment'), code: 'CANCEL_ERROR' },
      500
    );
  }
});
