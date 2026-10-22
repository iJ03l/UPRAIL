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
 * prepared by anyone. The recipient is read from the token's on-chain
 * description, never from the caller, so a stranger cannot redirect fees to
 * themselves. Registers escrow on the token, tracks it for automatic RPC fee
 * detection, and routes any balance already sitting in `escrow.uprail.near`.
 */
feesRouter.post('/prepare', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { token?: unknown; launchpad?: unknown }
    | null;
  const contractId = contractFromToken(body?.token);
  if (!contractId) return jsonError(c, 400, 'A valid NEP-141 token contract is required.', 'INVALID_TOKEN');

  const token = await resolveLaunchpadToken(c.env, contractId, true);
  if (!token) return jsonError(c, 422, 'Unknown or non-NEP-141 token contract.', 'UNKNOWN_TOKEN');

  const handle = deriveHandleFromDescription(token.description);
  if (!handle) {
    return jsonError(
      c,
      422,
      'No creator handle found. Add "Fees to @handle via UPRAIL" to the token description.',
      'NO_RECIPIENT'
    );
  }

  const reg = await registerEscrowForTokenPublic(c.env, contractId);
  if (!reg.registered) {
    return jsonError(c, 422, reg.reason || 'Could not prepare escrow for this token.', 'REGISTRATION_FAILED');
  }

  const launchpad = typeof body?.launchpad === 'string' && body.launchpad.trim()
    ? body.launchpad.trim().toLowerCase()
    : undefined;

  await trackLaunchpadToken(c.env, { contractId, handle, launchpad });

  let syncedFee: Record<string, unknown> | undefined;
  try {
    const syncRes = await syncTokenLaunchpadFees(c.env, contractId, { launchpad });
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

  return c.json({
    token: contractId,
    handle,
    address: escrowHoldingAccount(c.env),
    registered: true,
    autoSync: true,
    feePercent: protocolFeePercent(c.env),
    minFeeUsd: minFeeUsd(c.env),
    ...(syncedFee ? { routed: syncedFee } : {}),
    note: `Escrow is registered and automatic RPC fee routing is active for @${handle}. Any ${contractId} sent to ${escrowHoldingAccount(c.env)} is routed automatically.`,
  });
});

/**
 * POST /api/fees/route
 * Zero-integration path: report or sync an inbound creator fee.
 * - If `txHash` is supplied: verifies that exact transaction on-chain.
 * - If `txHash` is omitted: reads `escrow.uprail.near`'s live balance on the
 *   token via `NEAR_RPC_URL` and routes any uncredited surplus automatically.
 * The recipient always comes from the token description.
 */
feesRouter.post('/route', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { token?: unknown; txHash?: unknown; memo?: unknown }
    | null;
  const contractId = contractFromToken(body?.token);
  if (!contractId) return jsonError(c, 400, 'A valid NEP-141 token contract is required.', 'INVALID_TOKEN');
  const txHash = typeof body?.txHash === 'string' ? body.txHash.trim() : '';

  const token = await resolveLaunchpadToken(c.env, contractId, true);
  if (!token) return jsonError(c, 422, 'Unknown or non-NEP-141 token contract.', 'UNKNOWN_TOKEN');

  const handle = deriveHandleFromDescription(token.description);
  if (!handle) {
    return jsonError(
      c,
      422,
      'No creator handle found. Add "Fees to @handle via UPRAIL" to the token description.',
      'NO_RECIPIENT'
    );
  }

  if (!txHash) {
    const syncRes = await syncTokenLaunchpadFees(c.env, contractId, {
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

  const result = await recordLaunchpadFee(c.env, {
    launchpad: 'direct',
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
 * Accepts optional `{ token }`; when omitted, scans tracked / held launchpad
 * tokens. Recipients come from each token's description, never from the caller.
 * An authenticated session's handle is used only to prioritize tokens, not to
 * choose who gets credited.
 */
feesRouter.post('/sync', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { token?: unknown }
    | null;
  const contractId = contractFromToken(body?.token);

  if (contractId) {
    const res = await syncTokenLaunchpadFees(c.env, contractId);
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

  const filterHandle = normalizeHandle(c.get('session')?.x_handle);
  const summary = await syncAllLaunchpadFees(c.env, { handle: filterHandle || undefined });
  return c.json({
    ok: true,
    checked: summary.checked,
    routed: summary.routed,
    results: summary.results,
  });
});
