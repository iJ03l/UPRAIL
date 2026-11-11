/**
 * Multi-Member Quota Circles Routes (`/api/circles/*`).
 *
 * Endpoints:
 *   - GET  /api/circles/vaults          — live 1Click Earn Vault catalog
 *   - POST /api/circles/quote           — dry-run quote for Circle contribution
 *   - GET  /api/circles                 — list caller's Circles (creator or member)
 *   - GET  /api/circles/:id             — get Circle detail (strict anti-IDOR)
 *   - POST /api/circles                 — passkey-gated Circle creation
 *   - POST /api/circles/:id/contribute  — passkey-gated member quota contribution
 *   - POST /api/circles/:id/settle      — passkey-gated creator payout
 *   - POST /api/circles/:id/dissolve    — passkey-gated creator pro-rata refund
 */

import { Hono } from 'hono';
import type { AppContext, ErrorResponse } from '../types';
import { requireAuth } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { rateLimit } from '../middleware/rateLimit';
import { publicErrorMessage } from '../utils/errors';
import { getEarnVaults } from '../services/earnVaults';
import { GiftError, quoteGift } from '../services/gifts';
import {
  CircleError,
  contributeToCircle,
  createCircle,
  dissolveCircle,
  getCircleDetail,
  listUserCircles,
  settleCircle,
} from '../services/circles';

export const circlesRouter = new Hono<AppContext>();

circlesRouter.get('/vaults', async (c) => {
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

circlesRouter.post(
  '/quote',
  requireAuth(),
  rateLimit({ limit: 40, prefix: 'circle_quote', strict: true }),
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
      if (err instanceof GiftError || err instanceof CircleError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'CIRCLE_QUOTE_FAILED' },
        502
      );
    }
  }
);

circlesRouter.get('/', requireAuth(), async (c) => {
  const session = c.get('session')!;
  try {
    const circles = await listUserCircles(c.env, session);
    return c.json({ circles });
  } catch (err: any) {
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err), code: 'CIRCLES_LIST_FAILED' },
      500
    );
  }
});

circlesRouter.get('/:id', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const id = (c.req.param('id') || '').trim();
  try {
    const circle = await getCircleDetail(c.env, session, id);
    return c.json({ circle });
  } catch (err: any) {
    if (err instanceof CircleError) {
      return c.json<ErrorResponse>(
        { error: err.message, code: err.code },
        err.httpStatus as any
      );
    }
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err), code: 'CIRCLE_FETCH_FAILED' },
      500
    );
  }
});

circlesRouter.post(
  '/',
  rateLimit({ limit: 15, prefix: 'circle_create', strict: true }),
  requireAuth({ passkeyVerified: true }),
  requirePasskeyAuth(),
  async (c) => {
    const session = c.get('session')!;
    try {
      const body = (c.get('parsedBody' as any) ||
        (await c.req.json().catch(() => null))) as Record<string, any> | null;

      const circle = await createCircle(c.env, session, {
        name: String(body?.name || ''),
        purpose: String(body?.purpose || 'SHARED_GOAL'),
        note: typeof body?.note === 'string' ? body.note : undefined,
        targetAmountUsd: Number(body?.targetAmountUsd || 0),
        vaultAsset: String(body?.vaultAsset || ''),
        payoutHandle: typeof body?.payoutHandle === 'string' ? body.payoutHandle : undefined,
        members: Array.isArray(body?.members) ? body.members : [],
      });
      return c.json({ circle }, 201);
    } catch (err: any) {
      if (err instanceof CircleError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      console.error('[circles/create] error:', err);
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'CIRCLE_CREATE_FAILED' },
        502
      );
    }
  }
);

circlesRouter.post(
  '/:id/contribute',
  rateLimit({ limit: 20, prefix: 'circle_contribute', strict: true }),
  requireAuth({ passkeyVerified: true }),
  requirePasskeyAuth(),
  async (c) => {
    const session = c.get('session')!;
    const id = (c.req.param('id') || '').trim();
    try {
      const body = (c.get('parsedBody' as any) ||
        (await c.req.json().catch(() => null))) as Record<string, any> | null;

      const result = await contributeToCircle(c.env, session, id, {
        sourceAsset: String(body?.sourceAsset || 'USDC'),
        amount: String(body?.amount ?? ''),
        fundingMode: body?.fundingMode === 'EXTERNAL_DEPOSIT' ? 'EXTERNAL_DEPOSIT' : 'BALANCE',
      });
      return c.json(result);
    } catch (err: any) {
      if (err instanceof CircleError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      console.error('[circles/contribute] error:', err);
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'CIRCLE_CONTRIBUTE_FAILED' },
        502
      );
    }
  }
);

circlesRouter.post(
  '/:id/settle',
  rateLimit({ limit: 10, prefix: 'circle_settle', strict: true }),
  requireAuth({ passkeyVerified: true }),
  requirePasskeyAuth(),
  async (c) => {
    const session = c.get('session')!;
    const id = (c.req.param('id') || '').trim();
    try {
      const circle = await settleCircle(c.env, session, id);
      return c.json({ circle });
    } catch (err: any) {
      if (err instanceof CircleError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      console.error('[circles/settle] error:', err);
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'CIRCLE_SETTLE_FAILED' },
        502
      );
    }
  }
);

circlesRouter.post(
  '/:id/dissolve',
  rateLimit({ limit: 10, prefix: 'circle_dissolve', strict: true }),
  requireAuth({ passkeyVerified: true }),
  requirePasskeyAuth(),
  async (c) => {
    const session = c.get('session')!;
    const id = (c.req.param('id') || '').trim();
    try {
      const circle = await dissolveCircle(c.env, session, id);
      return c.json({ circle });
    } catch (err: any) {
      if (err instanceof CircleError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      console.error('[circles/dissolve] error:', err);
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'CIRCLE_DISSOLVE_FAILED' },
        502
      );
    }
  }
);
