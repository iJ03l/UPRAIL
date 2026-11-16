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
import { requireAuth, updateSession } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { rateLimit } from '../middleware/rateLimit';
import { publicErrorMessage } from '../utils/errors';
import { handleCustodyActionError } from '../utils/custodyResponse';
import { getEarnVaults } from '../services/earnVaults';
import { GiftError, quoteGift } from '../services/gifts';
import {
  checkCircleContributeSwapStatus,
  prepareSelfCustodyCircleContribute,
  prepareSelfCustodyCircleCreate,
  prepareSelfCustodyCircleDissolve,
  prepareSelfCustodyCircleJoin,
  prepareSelfCustodyCircleSettle,
  submitSelfCustodyCircleContribute,
  submitSelfCustodyCircleCreate,
  submitSelfCustodyCircleDissolve,
  submitSelfCustodyCircleJoin,
  submitSelfCustodyCircleSettle,
} from '../services/selfCustodyVaultOps';
import {
  CircleError,
  contributeToCircle,
  createCircle,
  dissolveCircle,
  getCircleDetail,
  joinCircle,
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
          originAsset?: string;
          amount?: string;
        }>()
        .catch(() => null);

      const quote = await quoteGift(c.env, {
        vaultAsset: body?.vaultAsset || '',
        sourceAsset: body?.sourceAsset || body?.originAsset || 'USDC',
        amount: String(body?.amount ?? ''),
        zeroFee: true,
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
        customPurpose: typeof body?.customPurpose === 'string' ? body.customPurpose : undefined,
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
  '/:id/join',
  rateLimit({ limit: 20, prefix: 'circle_join', strict: true }),
  requireAuth({ passkeyVerified: true }),
  requirePasskeyAuth(),
  async (c) => {
    const session = c.get('session')!;
    const id = (c.req.param('id') || '').trim();
    try {
      const circle = await joinCircle(c.env, session, id);
      return c.json({ circle });
    } catch (err: any) {
      if (err instanceof CircleError) {
        return c.json<ErrorResponse>(
          { error: err.message, code: err.code },
          err.httpStatus as any
        );
      }
      console.error('[circles/join] error:', err);
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err), code: 'CIRCLE_JOIN_FAILED' },
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
        sourceAsset: String(body?.sourceAsset || body?.originAsset || 'USDC'),
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
      return c.json({
        circle,
        txHash: circle.payoutTxHash || '',
        payoutHandle: circle.payoutHandle,
        sharesSettledFormatted: circle.totalSharesFormatted,
      });
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
      return c.json({
        circle,
        refundedMembers: circle.members.filter((m) => Boolean(m.refundedAt)).length,
      });
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

// ─── Self-Custody Circle Prepare / Submit Routes ──────────────────────────────

circlesRouter.post(
  '/create/prepare',
  rateLimit({ limit: 15, prefix: 'circle_sc_create_prep', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    try {
      const body = await c.req.json();
      const result = await prepareSelfCustodyCircleCreate({ env: c.env, session, input: body });
      return c.json(result);
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_CREATE_PREPARE_FAILED', '[circles/create/prepare]');
    }
  }
);

circlesRouter.post(
  '/create/submit',
  rateLimit({ limit: 15, prefix: 'circle_sc_create_sub', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    try {
      const body = await c.req.json<{ actionId: string; assertion: unknown }>();
      const res = await submitSelfCustodyCircleCreate({
        env: c.env,
        session,
        actionId: String(body?.actionId || ''),
        assertion: body?.assertion,
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      const circle = await getCircleDetail(c.env, session, res.circleId).catch(() => null);
      return c.json({ ...res, ...(circle ? { circle } : {}) });
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_CREATE_SUBMIT_FAILED', '[circles/create/submit]');
    }
  }
);

circlesRouter.post(
  '/:id/join/prepare',
  rateLimit({ limit: 20, prefix: 'circle_sc_join_prep', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const circleId = (c.req.param('id') || '').trim();
    try {
      const result = await prepareSelfCustodyCircleJoin({ env: c.env, session, circleId });
      if ((result as any).alreadyActive || (result as any).alreadySigned) {
        const circle = await getCircleDetail(c.env, session, circleId).catch(() => null);
        return c.json({ ...result, ...(circle ? { circle } : {}) });
      }
      return c.json(result);
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_JOIN_PREPARE_FAILED', '[circles/join/prepare]');
    }
  }
);

circlesRouter.post(
  '/:id/join/submit',
  rateLimit({ limit: 20, prefix: 'circle_sc_join_sub', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const circleId = (c.req.param('id') || '').trim();
    try {
      const body = await c.req.json<{ actionId: string; assertion: unknown }>();
      const res = await submitSelfCustodyCircleJoin({
        env: c.env,
        session,
        circleId,
        actionId: String(body?.actionId || ''),
        assertion: body?.assertion,
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      const circle = await getCircleDetail(c.env, session, circleId).catch(() => null);
      return c.json({ ...res, ...(circle ? { circle } : {}) });
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_JOIN_SUBMIT_FAILED', '[circles/join/submit]');
    }
  }
);

circlesRouter.post(
  '/:id/contribute/prepare',
  rateLimit({ limit: 25, prefix: 'circle_sc_contrib_prep', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const circleId = (c.req.param('id') || '').trim();
    try {
      const body = await c.req.json<{ sourceAsset?: string; amount: string }>();
      const result = await prepareSelfCustodyCircleContribute({
        env: c.env,
        session,
        circleId,
        sourceAsset: String(body?.sourceAsset || ''),
        amount: String(body?.amount || ''),
      });
      return c.json(result);
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_CONTRIBUTE_PREPARE_FAILED', '[circles/contribute/prepare]');
    }
  }
);

circlesRouter.post(
  '/:id/contribute/submit',
  rateLimit({ limit: 25, prefix: 'circle_sc_contrib_sub', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const circleId = (c.req.param('id') || '').trim();
    try {
      const body = await c.req.json<{ actionId: string; assertion: unknown; step?: string }>();
      const res = await submitSelfCustodyCircleContribute({
        env: c.env,
        session,
        circleId,
        actionId: String(body?.actionId || ''),
        assertion: body?.assertion,
        step: body?.step,
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      const circle = (res as any).completed
        ? await getCircleDetail(c.env, session, circleId).catch(() => null)
        : null;
      return c.json({ ...res, ...(circle ? { circle } : {}) });
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_CONTRIBUTE_SUBMIT_FAILED', '[circles/contribute/submit]');
    }
  }
);

circlesRouter.post(
  '/:id/contribute/swap-status',
  rateLimit({ limit: 60, prefix: 'circle_sc_swap_status', strict: false }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    try {
      const body = await c.req.json<{
        depositAddress: string;
        vaultAssetId: string;
        balanceBeforeAtomic: string;
      }>();
      const result = await checkCircleContributeSwapStatus({
        env: c.env,
        session,
        depositAddress: String(body?.depositAddress || ''),
        vaultAssetId: String(body?.vaultAssetId || ''),
        balanceBeforeAtomic: String(body?.balanceBeforeAtomic || '0'),
      });
      return c.json(result);
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_SWAP_STATUS_FAILED', '[circles/contribute/swap-status]');
    }
  }
);

circlesRouter.post(
  '/:id/settle/prepare',
  rateLimit({ limit: 10, prefix: 'circle_sc_settle_prep', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const circleId = (c.req.param('id') || '').trim();
    try {
      const result = await prepareSelfCustodyCircleSettle({ env: c.env, session, circleId });
      return c.json(result);
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_SETTLE_PREPARE_FAILED', '[circles/settle/prepare]');
    }
  }
);

circlesRouter.post(
  '/:id/settle/submit',
  rateLimit({ limit: 10, prefix: 'circle_sc_settle_sub', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const circleId = (c.req.param('id') || '').trim();
    try {
      const body = await c.req.json<{ actionId?: string; assertion?: unknown; retry?: boolean }>();
      const res = await submitSelfCustodyCircleSettle({
        env: c.env,
        session,
        circleId,
        actionId: body?.actionId,
        assertion: body?.assertion,
        retry: Boolean(body?.retry),
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      const circle = await getCircleDetail(c.env, session, circleId).catch(() => null);
      return c.json({ ...res, ...(circle ? { circle } : {}) });
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_SETTLE_SUBMIT_FAILED', '[circles/settle/submit]');
    }
  }
);

circlesRouter.post(
  '/:id/dissolve/prepare',
  rateLimit({ limit: 10, prefix: 'circle_sc_dissolve_prep', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const circleId = (c.req.param('id') || '').trim();
    try {
      const result = await prepareSelfCustodyCircleDissolve({ env: c.env, session, circleId });
      return c.json(result);
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_DISSOLVE_PREPARE_FAILED', '[circles/dissolve/prepare]');
    }
  }
);

circlesRouter.post(
  '/:id/dissolve/submit',
  rateLimit({ limit: 10, prefix: 'circle_sc_dissolve_sub', strict: true }),
  requireAuth(),
  async (c) => {
    const session = c.get('session')!;
    const circleId = (c.req.param('id') || '').trim();
    try {
      const body = await c.req.json<{
        actionId?: string;
        assertion?: unknown;
        finalizeSafeguard?: boolean;
      }>();
      const res = await submitSelfCustodyCircleDissolve({
        env: c.env,
        session,
        circleId,
        actionId: body?.actionId,
        assertion: body?.assertion,
        finalizeSafeguard: Boolean(body?.finalizeSafeguard),
      });
      await updateSession(c, { passkey_verified: true, passkey_verified_at: Date.now() });
      const circle = await getCircleDetail(c.env, session, circleId).catch(() => null);
      return c.json({
        ...res,
        ...(circle
          ? {
              circle,
              refundedMembers: circle.members.filter((m) => Boolean(m.refundedAt)).length,
            }
          : {}),
      });
    } catch (err: any) {
      return handleCustodyActionError(c, err, 'CIRCLE_DISSOLVE_SUBMIT_FAILED', '[circles/dissolve/submit]');
    }
  }
);
