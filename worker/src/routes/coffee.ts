/**
 * Buy Me a Coffee API Routes (`/api/coffee/*`).
 *
 * Owner endpoints (cookie-authenticated):
 *   - GET  /api/coffee/me     — current toggle state, share link, recent coffee tips
 *   - POST /api/coffee/toggle — turn on/off public Buy Me a Coffee link (`uprail.world/<handle>`)
 *
 * Public contributor endpoints (no UPRAIL account or wallet connection required):
 *   - GET  /api/coffee/profile/:handle — public creator metadata & enabled check
 *   - GET  /api/coffee/options         — live supported tokens (USDC/USDT pinned first) & chains
 *   - POST /api/coffee/donate          — generate one-time ephemeral deposit address via 1Click
 *   - GET  /api/coffee/status/:id      — live standby status poll & atomic 99% escrow payout
 */

import { Hono } from 'hono';
import type { AppContext, ErrorResponse } from '../types';
import { requireAuth } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { rateLimit } from '../middleware/rateLimit';
import { publicErrorMessage } from '../utils/errors';
import {
  CoffeeError,
  getCoffeeOptions,
  getCoffeeCreatorProfile,
  createCoffeeDonation,
  checkAndSettleCoffeeDonation,
} from '../services/coffee';

export const coffeeRouter = new Hono<AppContext>();

function coffeeUrlForHandle(handle: string): string {
  return `https://uprail.world/${encodeURIComponent(handle)}`;
}

// ─── Owner Routes ─────────────────────────────────────────────────────────────

coffeeRouter.get('/me', requireAuth(), async (c) => {
  const session = c.get('session')!;
  try {
    const userRow = await c.env.DB.prepare(
      'SELECT x_handle, coffee_enabled FROM x_identities WHERE x_id = ? LIMIT 1'
    )
      .bind(session.x_id)
      .first<{ x_handle: string; coffee_enabled: number }>();

    const handle = userRow?.x_handle || session.x_handle;
    const enabled = Number(userRow?.coffee_enabled ?? 0) === 1;

    const donations = await c.env.DB.prepare(
      `SELECT id, origin_symbol, origin_chain, target_symbol, gross_amount, net_amount, protocol_fee, status, payout_tx_hash, created_at
       FROM coffee_donations
       WHERE recipient_x_id = ? AND status = 'COMPLETED'
       ORDER BY created_at DESC
       LIMIT 20`
    )
      .bind(session.x_id)
      .all<any>();

    return c.json({
      enabled,
      handle,
      url: coffeeUrlForHandle(handle),
      recentDonations: (donations.results || []).map((d) => ({
        id: d.id,
        originSymbol: d.origin_symbol,
        originChain: d.origin_chain,
        targetSymbol: d.target_symbol,
        grossAmount: d.gross_amount,
        netAmount: d.net_amount,
        protocolFee: d.protocol_fee,
        status: d.status,
        payoutTxHash: d.payout_tx_hash || null,
        createdAt: d.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[coffee/me] error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to load Buy Me a Coffee settings'), code: 'COFFEE_ERROR' },
      500
    );
  }
});

coffeeRouter.post('/toggle', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), async (c) => {
  const session = c.get('session')!;
  try {
    const body =
      (c.get('parsedBody' as any) as { enabled?: boolean } | undefined) ||
      (await c.req.json<{ enabled?: boolean }>().catch(() => ({} as { enabled?: boolean })));
    const existing = await c.env.DB.prepare(
      'SELECT x_handle, coffee_enabled FROM x_identities WHERE x_id = ? LIMIT 1'
    )
      .bind(session.x_id)
      .first<{ x_handle: string; coffee_enabled: number }>();

    const currentEnabled = Number(existing?.coffee_enabled ?? 0) === 1;
    const nextEnabled = typeof body.enabled === 'boolean' ? body.enabled : !currentEnabled;
    const handle = existing?.x_handle || session.x_handle;

    await c.env.DB.prepare(
      'UPDATE x_identities SET coffee_enabled = ?, updated_at = ? WHERE x_id = ?'
    )
      .bind(nextEnabled ? 1 : 0, Date.now(), session.x_id)
      .run();

    return c.json({
      enabled: nextEnabled,
      handle,
      url: coffeeUrlForHandle(handle),
    });
  } catch (err: any) {
    console.error('[coffee/toggle] error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to update Buy Me a Coffee status'), code: 'COFFEE_TOGGLE_ERROR' },
      500
    );
  }
});

// ─── Public Contributor Routes ────────────────────────────────────────────────

coffeeRouter.get('/profile/:handle', async (c) => {
  const handle = c.req.param('handle');
  try {
    const profile = await getCoffeeCreatorProfile(c.env, handle);
    c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    return c.json({
      ...profile,
      coffeeUrl: coffeeUrlForHandle(profile.handle),
      agent: {
        supported: profile.found && profile.enabled,
        protocol: 'uprail-coffee-v1',
        authRequired: false,
        payUrl: coffeeUrlForHandle(profile.handle),
        donateUrl: 'https://api.uprail.world/api/coffee/donate',
        optionsUrl: 'https://api.uprail.world/api/coffee/options',
        statusUrlTemplate: 'https://api.uprail.world/api/coffee/status/{id}',
        llmsTxt: 'https://uprail.world/llms.txt',
      },
    });
  } catch (err: any) {
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to load creator profile'), code: 'PROFILE_ERROR' },
      500
    );
  }
});

coffeeRouter.get('/options', async (c) => {
  try {
    const tokens = await getCoffeeOptions(c.env);
    c.header('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=120');
    return c.json({ tokens });
  } catch (err: any) {
    console.error('[coffee/options] error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to load token options'), code: 'OPTIONS_ERROR' },
      502
    );
  }
});

coffeeRouter.post('/donate', rateLimit({ limit: 30, prefix: 'coffee_donate' }), async (c) => {
  try {
    const body = await c.req.json<{
      handle: string;
      amountUsd?: number;
      amountToken?: string | number;
      originSymbol: string;
      originChain: string;
      originAsset?: string;
      targetSymbol?: 'USDC' | 'USDT';
    }>();
    const donation = await createCoffeeDonation(c.env, body);
    return c.json({ donation }, 201);
  } catch (err: any) {
    if (err instanceof CoffeeError) {
      return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
    }
    console.error('[coffee/donate] error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to generate deposit address'), code: 'DONATE_ERROR' },
      502
    );
  }
});

coffeeRouter.get('/status/:id', rateLimit({ limit: 120, prefix: 'coffee_status' }), async (c) => {
  const id = c.req.param('id');
  try {
    const donation = await checkAndSettleCoffeeDonation(c.env, id);
    c.header('Cache-Control', 'no-store');
    return c.json({ donation });
  } catch (err: any) {
    if (err instanceof CoffeeError) {
      return c.json<ErrorResponse>({ error: err.message, code: err.code }, err.httpStatus as any);
    }
    console.error('[coffee/status] error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Failed to check donation status'), code: 'STATUS_ERROR' },
      500
    );
  }
});
