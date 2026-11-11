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
import { requireAuth } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { rateLimit } from '../middleware/rateLimit';
import { publicErrorMessage } from '../utils/errors';
import { getEarnVaults } from '../services/earnVaults';
import {
  claimGift,
  createGift,
  getAuthenticatedGift,
  getPublicGiftCardView,
  GiftError,
  listUserGifts,
  quoteGift,
} from '../services/gifts';

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
          amount?: string;
        }>()
        .catch(() => null);

      const quote = await quoteGift(c.env, {
        vaultAsset: body?.vaultAsset || '',
        sourceAsset: body?.sourceAsset || 'USDC',
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
  requireAuth({ passkeyVerified: true }),
  requirePasskeyAuth(),
  async (c) => {
    const session = c.get('session')!;
    try {
      const body = (c.get('parsedBody' as any) ||
        (await c.req.json().catch(() => null))) as Record<string, any> | null;

      const gift = await createGift(c.env, session, {
        recipientHandle: String(body?.recipientHandle || ''),
        occasion: String(body?.occasion || 'JUST_BECAUSE'),
        message: typeof body?.message === 'string' ? body.message : undefined,
        showAmount: Boolean(body?.showAmount),
        vaultAsset: String(body?.vaultAsset || ''),
        sourceAsset: String(body?.sourceAsset || 'USDC'),
        amount: String(body?.amount ?? ''),
        timelockUntil: Number(body?.timelockUntil || 0),
        fundingMode: body?.fundingMode === 'EXTERNAL_DEPOSIT' ? 'EXTERNAL_DEPOSIT' : 'BALANCE',
      });
      return c.json({ gift }, 201);
    } catch (err: any) {
      if (err instanceof GiftError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      console.error('[gifts/create] error:', err);
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'GIFT_CREATE_FAILED' },
        502
      );
    }
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
      return c.json({ gift });
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
