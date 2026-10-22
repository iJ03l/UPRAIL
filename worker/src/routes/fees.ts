/**
 * Launchpad creator-fee routing for UP (UPRAIL.app).
 *
 * Zero-integration only: a launchpad points its creator fees at
 * `escrow.uprail.near` and names the recipient in the token description.
 * UPRAIL detects incoming fees over NEAR RPC and routes them to the handle.
 *
 *  - POST /prepare — register escrow storage on a token and start watching it
 *  - POST /route   — sync a token's live escrow balance (or verify one txHash)
 *  - POST /sync    — on-demand RPC scan across tracked / held tokens
 *
 * Every fee is verified against its on-chain transaction or live token balance
 * before anything is credited, so a caller cannot mint balance by reporting a
 * hash that did not actually pay the escrow account.
 */

import { Context, Hono } from 'hono';
import type { AppContext } from '../types';
import {
  normalizeHandle,
  escrowHoldingAccount,
  registerEscrowForTokenPublic,
  recordLaunchpadFee,
  contractFromToken,
  deriveHandleFromDescription,
  minFeeUsd,
  protocolFeePercent,
  resolveLaunchpadToken,
  trackLaunchpadToken,
  syncTokenLaunchpadFees,
  syncAllLaunchpadFees,
} from '../services/launchpadFees';

export const feesRouter = new Hono<AppContext>();

function jsonError(
  c: Context<AppContext>,
  status: 400 | 401 | 404 | 422 | 500,
  message: string,
  code: string
) {
  return c.json({ error: message, code }, status);
}

/**
 * POST /api/fees/prepare
 * Zero-integration path: a token that points its creator fees at escrow can be
 * prepared by anyone. Registers escrow on the token so the launchpad's push is
 * accepted, tracks the token + handle for automatic on-chain RPC fee detection,
 * and immediately routes any balance already sitting in `escrow.uprail.near`.
 */
feesRouter.post('/prepare', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { token?: unknown; handle?: unknown; launchpad?: unknown }
    | null;
  const contractId = contractFromToken(body?.token);
  if (!contractId) return jsonError(c, 400, 'A valid NEP-141 token contract is required.', 'INVALID_TOKEN');

  const reg = await registerEscrowForTokenPublic(c.env, contractId);
  if (!reg.registered) {
    return jsonError(c, 422, reg.reason || 'Could not prepare escrow for this token.', 'REGISTRATION_FAILED');
  }

  let handle = normalizeHandle(body?.handle);
  if (!handle) {
    const tokenMeta = await resolveLaunchpadToken(c.env, contractId, true);
    handle = deriveHandleFromDescription(tokenMeta?.description);
  }
  const launchpad = typeof body?.launchpad === 'string' && body.launchpad.trim()
    ? body.launchpad.trim().toLowerCase()
    : undefined;

  await trackLaunchpadToken(c.env, { contractId, handle, launchpad });

  let syncedFee: Record<string, unknown> | undefined;
  if (handle) {
    try {
      const syncRes = await syncTokenLaunchpadFees(c.env, contractId, { handle, launchpad });
      if (syncRes.synced) {
        syncedFee = {
          id: syncRes.id,
          amount: syncRes.amount,
          fee: syncRes.fee,
          routing: syncRes.routing,
          status: syncRes.status,
        };
      }
    } catch {}
  }

  return c.json({
    token: contractId,
    handle: handle || undefined,
    address: escrowHoldingAccount(c.env),
    registered: true,
    autoSync: true,
    feePercent: protocolFeePercent(c.env),
    minFeeUsd: minFeeUsd(c.env),
    ...(syncedFee ? { routed: syncedFee } : {}),
    note: handle
      ? `Escrow is registered and automatic RPC fee routing is active for @${handle}. Any ${contractId} sent to ${escrowHoldingAccount(c.env)} is routed automatically.`
      : 'Point this token\'s creator fees here (100%, permanent) and name the recipient in its description as: Fees to @handle via UPRAIL (or pass `handle`).',
  });
});

/**
 * POST /api/fees/route
 * Zero-integration path: report or sync an inbound creator fee.
 * - If `txHash` is supplied: verifies that exact transaction on-chain.
 * - If `txHash` is omitted: reads `escrow.uprail.near`'s live balance on the
 *   token via `NEAR_RPC_URL` and routes any uncredited surplus automatically.
 */
feesRouter.post('/route', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { token?: unknown; txHash?: unknown; handle?: unknown; memo?: unknown }
    | null;
  const contractId = contractFromToken(body?.token);
  if (!contractId) return jsonError(c, 400, 'A valid NEP-141 token contract is required.', 'INVALID_TOKEN');
  const txHash = typeof body?.txHash === 'string' ? body.txHash.trim() : '';

  let handle = normalizeHandle(body?.handle);
  if (!handle) {
    const token = await resolveLaunchpadToken(c.env, contractId, true);
    handle = deriveHandleFromDescription(token?.description);
  }

  if (!txHash) {
    const syncRes = await syncTokenLaunchpadFees(c.env, contractId, {
      handle,
      memo: typeof body?.memo === 'string' ? body.memo : undefined,
    });
    if (!syncRes.ok) {
      return jsonError(c, 422, syncRes.error || 'Could not sync fees for this token.', 'FEE_NOT_ROUTED');
    }
    return c.json(
      {
        id: syncRes.id || null,
        handle: syncRes.handle || handle,
        asset: syncRes.asset,
        amount: syncRes.amount || '0',
        fee: syncRes.fee,
        routing: syncRes.routing,
        status: syncRes.status,
        synced: syncRes.synced,
        deferred: syncRes.deferred || false,
      },
      syncRes.synced ? 201 : 200
    );
  }

  if (!handle) {
    return jsonError(
      c,
      422,
      'No recipient handle provided and none found in the token description. Add "Fees to @handle via UPRAIL" or pass `handle`.',
      'NO_RECIPIENT'
    );
  }

  const result = await recordLaunchpadFee(c.env, {
    launchpad: 'direct',
    handle,
    token: contractId,
    txHash,
    memo: typeof body?.memo === 'string' ? body.memo : undefined,
  });
  if (!result.ok) {
    return jsonError(c, 422, result.error || 'Could not route this fee.', 'FEE_NOT_ROUTED');
  }
  return c.json(
    {
      id: result.id,
      handle,
      asset: result.asset,
      amount: result.amount,
      fee: result.fee,
      routing: result.routing,
      status: result.status,
      deferred: result.deferred || false,
    },
    201
  );
});

/**
 * POST /api/fees/sync
 * On-demand RPC scan for incoming launchpad creator fees on `escrow.uprail.near`.
 * Accepts optional `{ token, handle }`; when omitted, scans all tracked / held
 * launchpad tokens (prioritizing the logged-in user's handle if authenticated).
 */
feesRouter.post('/sync', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { token?: unknown; handle?: unknown }
    | null;
  const session = c.get('session');
  const handle = normalizeHandle(body?.handle) || normalizeHandle(session?.x_handle);
  const contractId = contractFromToken(body?.token);

  if (contractId) {
    const res = await syncTokenLaunchpadFees(c.env, contractId, { handle });
    if (!res.ok) {
      return jsonError(c, 422, res.error || 'Could not sync token fees.', 'SYNC_FAILED');
    }
    return c.json({
      ok: true,
      synced: res.synced,
      token: contractId,
      handle: res.handle,
      id: res.id,
      asset: res.asset,
      amount: res.amount,
      fee: res.fee,
      routing: res.routing,
      status: res.status,
    });
  }

  const summary = await syncAllLaunchpadFees(c.env, { handle: handle || undefined });
  return c.json({
    ok: true,
    checked: summary.checked,
    routed: summary.routed,
    results: summary.results,
  });
});
