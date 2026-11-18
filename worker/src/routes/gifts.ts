/**
 * 1-to-1 Earn Vault Timelocked Gifting Routes (`/api/gifts/*`).
 *
 * Public endpoints:
 *   - GET  /api/gifts/vaults      — live 1Click Earn Vault catalog (TLO, gtUSDCp, kV-gtSOLb)
 *   - GET  /api/gifts/public/:id  — non-sensitive public SEO card metadata for `/gift/:id`
 *
 * Authenticated endpoints:
 *   - GET  /api/gifts             — list caller's sent and received gifts
 *   - GET  /api/gifts/:id         — full gift view including live yield (strict anti-IDOR)
 *   - POST /api/gifts/quote       — dry-run 1Click Earn Vault quote + 1% protocol fee split
 *   - POST /api/gifts             — passkey-gated gift creation & funding
 *   - POST /api/gifts/:id/claim   — passkey-gated, timelock-enforced, anti-IDOR gift unwrap
 */

import { Hono } from 'hono';
import type { AppContext, ErrorResponse } from '../types';
import { requireAuth, updateSession } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { rateLimit } from '../middleware/rateLimit';
import { handleCustodyActionError } from '../utils/custodyResponse';
import { publicErrorMessage } from '../utils/errors';
import { getEarnVaults } from '../services/earnVaults';
import {
  claimGift,
  getAuthenticatedGift,
  getPublicGiftCardView,
  GiftError,
  listUserGifts,
  quoteGift,
} from '../services/gifts';
import {
  checkGiftCreateSwapStatus,
  prepareSelfCustodyGiftClaim,
  prepareSelfCustodyGiftClaimSwap,
  prepareSelfCustodyGiftCreate,
  prepareSelfCustodyGiftReclaim,
  submitSelfCustodyGiftClaim,
  submitSelfCustodyGiftClaimSwap,
  submitSelfCustodyGiftCreate,
  submitSelfCustodyGiftReclaim,
} from '../services/selfCustodyVaultOps';

export const giftsRouter = new Hono<AppContext>();

// ─── Public Catalog & Public Share Metadata ───────────────────────────────────

giftsRouter.get('/vaults', async (c) => {
  try {
    const vaults = await getEarnVaults(c.env);
    return c.json({ vaults });
  } catch (err: any) {
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err), code: 'EARN_VAULTS_UNAVAILABLE' },
      502
    );
  }
});

giftsRouter.get(
  '/public/:id',
  rateLimit({ limit: 60, prefix: 'gift_public' }),
  async (c) => {
    const id = (c.req.param('id') || '').trim();
    try {
      const gift = await getPublicGiftCardView(c.env, id);
      return c.json({ gift });
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'GIFT_LOOKUP_FAILED' },
        500
      );
    }
  }
);

// ─── Authenticated Gift Routes ────────────────────────────────────────────────

giftsRouter.get('/', requireAuth(), async (c) => {
  const session = c.get('session')!;
  try {
    const result = await listUserGifts(c.env, session);
    return c.json(result);
  } catch (err: any) {
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err), code: 'GIFTS_LIST_FAILED' },
      500
    );
  }
});

giftsRouter.post(
  '/quote',
  requireAuth(),
  rateLimit({ limit: 40, prefix: 'gift_quote', strict: true }),
  async (c) => {
    try {
      const body = await c.req
        .json<{
          vaultAsset?: string;
          sourceAsset?: string;
          originAsset?: string;
          amount?: string;
        }>()
        .catch(() => null);

      const quote = await quoteGift(c.env, {
        vaultAsset: body?.vaultAsset || '',
        sourceAsset: body?.sourceAsset || body?.originAsset || 'USDC',
        amount: String(body?.amount ?? ''),
      });
      return c.json({ quote });
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'GIFT_QUOTE_FAILED' },
        502
      );
    }
  }
);

giftsRouter.get('/:id', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const id = (c.req.param('id') || '').trim();
  try {
    const gift = await getAuthenticatedGift(c.env, session, id);
    return c.json({ gift });
  } catch (err: any) {
    if (err instanceof GiftError) {
      return c.json<ErrorResponse>(
        { error: err.message, code: err.code },
        err.httpStatus as any
      );
    }
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err), code: 'GIFT_FETCH_FAILED' },
      500
    );
  }
});

giftsRouter.post(
  '/',
  rateLimit({ limit: 15, prefix: 'gift_create', strict: true }),
  requireAuth(),
  async (c) => {
    return c.json<ErrorResponse>(
      {
        error: 'Creating Earn Gifts requires Passkey Self-Custody. Upgrade in Settings.',
        code: 'SELF_CUSTODY_REQUIRED',
      },
      403
    );
  }
);

giftsRouter.post(
  '/:id/claim',
  rateLimit({ limit: 15, prefix: 'gift_claim', strict: true }),
  requireAuth({ passkeyVerified: true }),
  requirePasskeyAuth(),
  async (c) => {
    const session = c.get('session')!;
    const id = (c.req.param('id') || '').trim();
    try {
      const gift = await claimGift(c.env, session, id);
      return c.json({
        gift,
        txHash: gift.claimTxHash || '',
        sharesClaimed: gift.sharesFormatted,
        ...(gift.payoutAsset ? { payoutAsset: gift.payoutAsset } : {}),
        ...(gift.usdcAmount ? { usdcAmount: gift.usdcAmount } : {}),
        ...(gift.usdcSwapStatus ? { usdcSwapStatus: gift.usdcSwapStatus } : {}),
        ...(gift.usdcDepositAddress ? { usdcDepositAddress: gift.usdcDepositAddress } : {}),
        ...(gift.usdcSwapNote ? { usdcSwapNote: gift.usdcSwapNote } : {}),
      });
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      console.error('[gifts/claim] error:', err);
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'GIFT_CLAIM_FAILED' },
        502
      );
    }
  }
);

giftsRouter.post(
  '/prepare',
  rateLimit({ limit: 20, prefix: 'gift_create_prep', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const body = await c.req.json().catch(() => ({}));
    if (body?.mode === 'escrow') {
      return c.json<ErrorResponse>(
        {
          error: 'Earn Gifts support Passkey Self-Custody on-chain contracts only.',
          code: 'SELF_CUSTODY_ONLY',
        },
        400
      );
    }
    try {
      const res = await prepareSelfCustodyGiftCreate({
        env: c.env,
        session,
        input: { ...(body && typeof body === 'object' ? body : {}), mode: 'contract' },
      });
      return c.json(res);
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
      }
      return handleCustodyActionError(c, err, 'GIFT_PREPARE_FAILED', '[gifts/prepare]');
    }
  }
);

giftsRouter.post(
  '/submit',
  rateLimit({ limit: 20, prefix: 'gift_create_sub', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const body = await c.req.json().catch(() => ({}));
    const actionId = typeof body?.actionId === 'string' ? body.actionId.trim() : '';
    const assertion = body?.assertion;
    const step = typeof body?.step === 'string' ? body.step.trim() : undefined;
    if (!actionId || !assertion) {
      return c.json<ErrorResponse>(
        { error: 'Missing actionId or WebAuthn assertion.', code: 'MISSING_FIELDS' },
        400
      );
    }
    try {
      const res = await submitSelfCustodyGiftCreate({
        env: c.env,
        session,
        actionId,
        assertion,
        step,
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      const giftId = (res as any)?.giftId;
      const gift =
        giftId && (res as any)?.completed !== false
          ? await getAuthenticatedGift(c.env, session, giftId).catch(() => null)
          : null;
      return c.json({ ...res, ...(gift ? { gift } : {}) });
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
      }
      return handleCustodyActionError(c, err, 'GIFT_SUBMIT_FAILED', '[gifts/submit]');
    }
  }
);

giftsRouter.post(
  '/swap-status',
  rateLimit({ limit: 60, prefix: 'gift_swap_status', strict: false }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const body = await c.req.json().catch(() => ({}));
    const depositAddress = typeof body?.depositAddress === 'string' ? body.depositAddress.trim() : '';
    const vaultAssetId = typeof body?.vaultAssetId === 'string' ? body.vaultAssetId.trim() : '';
    const balanceBeforeAtomic =
      typeof body?.balanceBeforeAtomic === 'string' ? body.balanceBeforeAtomic.trim() : '0';
    if (!depositAddress || !vaultAssetId) {
      return c.json<ErrorResponse>(
        { error: 'Missing depositAddress or vaultAssetId.', code: 'MISSING_FIELDS' },
        400
      );
    }
    try {
      const res = await checkGiftCreateSwapStatus({
        env: c.env,
        session,
        depositAddress,
        vaultAssetId,
        balanceBeforeAtomic,
      });
      return c.json(res);
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
      }
      return handleCustodyActionError(c, err, 'GIFT_SWAP_STATUS_FAILED', '[gifts/swap-status]');
    }
  }
);

giftsRouter.post(
  '/:id/claim/prepare',
  rateLimit({ limit: 20, prefix: 'gift_claim_prep', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const giftId = (c.req.param('id') || '').trim();
    try {
      const res = await prepareSelfCustodyGiftClaim({
        env: c.env,
        session,
        giftId,
      });
      return c.json(res);
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
      }
      return handleCustodyActionError(c, err, 'GIFT_CLAIM_PREPARE_FAILED', '[gifts/claim/prepare]');
    }
  }
);

giftsRouter.post(
  '/:id/claim/submit',
  rateLimit({ limit: 20, prefix: 'gift_claim_sub', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const giftId = (c.req.param('id') || '').trim();
    const body = await c.req.json().catch(() => ({}));
    const actionId = typeof body?.actionId === 'string' ? body.actionId.trim() : '';
    const assertion = body?.assertion;
    if (!actionId || !assertion) {
      return c.json<ErrorResponse>(
        { error: 'Missing actionId or WebAuthn assertion.', code: 'MISSING_FIELDS' },
        400
      );
    }
    try {
      const res = await submitSelfCustodyGiftClaim({
        env: c.env,
        session,
        giftId,
        actionId,
        assertion,
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      const gift = await getAuthenticatedGift(c.env, session, giftId).catch(() => null);
      return c.json({
        ...res,
        ...(gift ? { gift, sharesClaimed: gift.sharesFormatted } : {}),
      });
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
      }
      return handleCustodyActionError(c, err, 'GIFT_CLAIM_SUBMIT_FAILED', '[gifts/claim/submit]');
    }
  }
);

giftsRouter.post(
  '/:id/claim/swap/prepare',
  rateLimit({ limit: 20, prefix: 'gift_claim_swap_prep', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const giftId = (c.req.param('id') || '').trim();
    try {
      const res = await prepareSelfCustodyGiftClaimSwap({
        env: c.env,
        session,
        giftId,
      });
      return c.json(res);
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
      }
      return handleCustodyActionError(c, err, 'GIFT_CLAIM_SWAP_PREPARE_FAILED', '[gifts/claim/swap/prepare]');
    }
  }
);

giftsRouter.post(
  '/:id/claim/swap/submit',
  rateLimit({ limit: 20, prefix: 'gift_claim_swap', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const giftId = (c.req.param('id') || '').trim();
    const body = await c.req.json().catch(() => ({}));
    const actionId = typeof body?.actionId === 'string' ? body.actionId.trim() : '';
    const assertion = body?.assertion;
    if (!actionId || !assertion) {
      return c.json<ErrorResponse>(
        { error: 'Missing actionId or WebAuthn assertion.', code: 'MISSING_FIELDS' },
        400
      );
    }
    try {
      const res = await submitSelfCustodyGiftClaimSwap({
        env: c.env,
        session,
        giftId,
        actionId,
        assertion,
      });
      return c.json(res);
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
      }
      return handleCustodyActionError(c, err, 'GIFT_CLAIM_SWAP_FAILED', '[gifts/claim/swap/submit]');
    }
  }
);

giftsRouter.post(
  '/:id/reclaim/prepare',
  rateLimit({ limit: 20, prefix: 'gift_reclaim_prep', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const giftId = (c.req.param('id') || '').trim();
    try {
      const res = await prepareSelfCustodyGiftReclaim({
        env: c.env,
        session,
        giftId,
      });
      return c.json(res);
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
      }
      return handleCustodyActionError(c, err, 'GIFT_RECLAIM_PREPARE_FAILED', '[gifts/reclaim/prepare]');
    }
  }
);

giftsRouter.post(
  '/:id/reclaim/submit',
  rateLimit({ limit: 20, prefix: 'gift_reclaim_sub', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const giftId = (c.req.param('id') || '').trim();
    const body = await c.req.json().catch(() => ({}));
    const actionId = typeof body?.actionId === 'string' ? body.actionId.trim() : '';
    const assertion = body?.assertion;
    if (!actionId || !assertion) {
      return c.json<ErrorResponse>(
        { error: 'Missing actionId or WebAuthn assertion.', code: 'MISSING_FIELDS' },
        400
      );
    }
    try {
      const res = await submitSelfCustodyGiftReclaim({
        env: c.env,
        session,
        giftId,
        actionId,
        assertion,
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      const gift = await getAuthenticatedGift(c.env, session, giftId).catch(() => null);
      return c.json({
        ...res,
        ...(gift ? { gift, sharesClaimed: gift.sharesFormatted } : {}),
      });
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
      }
      return handleCustodyActionError(c, err, 'GIFT_RECLAIM_SUBMIT_FAILED', '[gifts/reclaim/submit]');
    }
  }
);
