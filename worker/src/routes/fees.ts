/**
 * Launchpad creator-fee routing for UP (UPRAIL.app).
 *
 * One router, two faces:
 *  - POST /webhook  — the launchpad-facing integration. A partner registers a
 *    URL + bearer key + HMAC secret and sends signed events:
 *      token.launched → pre-register escrow on the token (no more first-push race)
 *      fee.pending    → register on demand, then hand back the escrow address
 *      fee.paid       → report an inbound fee; UPRAIL verifies and routes it
 *  - POST /resolve and POST /ingest — REST equivalents built on the same helpers
 *    for partners that prefer request/response over events.
 *
 * Every fee is verified against its on-chain transaction before anything is
 * credited, so a partner cannot mint balance by reporting a hash that did not
 * actually pay the escrow account.
 */

import { Context, Hono } from 'hono';
import type { AppContext, Env } from '../types';
import {
  verifyPartnerKey,
  verifyWebhookSignature,
  type LaunchpadPartner,
} from '../services/launchpadKeys';
import {
  normalizeHandle,
  escrowHoldingAccount,
  registerEscrowForToken,
  recordLaunchpadFee,
  contractFromToken,
} from '../services/launchpadFees';

export const feesRouter = new Hono<AppContext>();

interface WebhookEvent {
  event?: string;
  eventId?: string;
  launchpad?: string;
  token?: unknown;
  handle?: unknown;
  creatorHandle?: unknown;
  amount?: unknown;
  txHash?: unknown;
  memo?: unknown;
}

function jsonError(
  c: Context<AppContext>,
  status: 400 | 401 | 404 | 422 | 500,
  message: string,
  code: string
) {
  return c.json({ error: message, code }, status);
}

/** True when a handle is on UPRAIL. */
async function handleIsKnown(env: Env, handle: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      'SELECT 1 AS ok FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
    )
      .bind(handle)
      .first<{ ok: number }>();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Upserts an audit row for an event. Deliberately does NOT gate processing:
 * fee crediting is idempotent by inbound tx hash and registration is memoized,
 * so a partner retry with the same eventId safely re-runs and updates the
 * outcome. This is what makes a transient failure (e.g. an RPC read before a
 * tx is final) recoverable instead of permanently swallowed.
 */
async function recordEvent(
  env: Env,
  partner: LaunchpadPartner,
  eventId: string,
  type: string,
  token: string | null,
  handle: string | null,
  txHash: string | null,
  status: string,
  error: string | null
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO launchpad_events (id, partner_id, event_id, type, token, handle, tx_hash, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(partner_id, event_id) DO UPDATE SET
         status = excluded.status,
         error = excluded.error`
    )
      .bind(
        `lpe_${crypto.randomUUID()}`,
        partner.id,
        eventId,
        type,
        token,
        handle,
        txHash,
        status,
        error,
        Date.now()
      )
      .run();
  } catch (err) {
    console.warn('[fees] event record failed:', err);
  }
}

/**
 * POST /api/fees/webhook
 * Launchpad → UPRAIL events. Authenticated by bearer partner key + HMAC
 * signature over the raw body.
 */
feesRouter.post('/webhook', async (c) => {
  const rawBody = await c.req.text();
  const partner = await verifyPartnerKey(c.env, c.req.header('Authorization'));
  if (!partner) {
    return jsonError(c, 401, 'Invalid or missing partner key.', 'PARTNER_KEY_INVALID');
  }

  const signature = c.req.header('X-UPRAIL-Signature');
  const signatureOk = await verifyWebhookSignature(partner.webhook_secret, signature, rawBody);
  if (!signatureOk) {
    return jsonError(c, 401, 'Invalid webhook signature.', 'SIGNATURE_INVALID');
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonError(c, 400, 'Body must be JSON.', 'INVALID_JSON');
  }

  if (!event || typeof event !== 'object') {
    return jsonError(c, 400, 'Body must be a JSON object.', 'INVALID_BODY');
  }
  const eventId = typeof event.eventId === 'string' ? event.eventId.trim() : '';
  if (!eventId) {
    return jsonError(c, 400, 'eventId is required.', 'INVALID_EVENT_ID');
  }

  const contractId = contractFromToken(event.token);
  if (!contractId) {
    return jsonError(c, 400, 'A valid NEP-141 token contract is required.', 'INVALID_TOKEN');
  }

  switch (event.event) {
    case 'token.launched': {
      const reg = await registerEscrowForToken(c.env, partner, contractId);
      await recordEvent(
        c.env,
        partner,
        eventId,
        'token.launched',
        contractId,
        null,
        null,
        reg.registered ? 'registered' : 'failed',
        reg.reason || null
      );
      return c.json(
        { received: true, eventId, escrowRegistered: reg.registered, reason: reg.reason },
        202
      );
    }

    case 'fee.pending': {
      const handle = normalizeHandle(event.handle);
      if (!handle) return jsonError(c, 400, 'A valid X handle is required.', 'INVALID_HANDLE');
      const reg = await registerEscrowForToken(c.env, partner, contractId);
      await recordEvent(
        c.env,
        partner,
        eventId,
        'fee.pending',
        contractId,
        handle,
        null,
        reg.registered ? 'ready' : 'failed',
        reg.reason || null
      );
      if (!reg.registered) {
        return jsonError(c, 422, reg.reason || 'Could not prepare escrow for this token.', 'REGISTRATION_FAILED');
      }
      const known = await handleIsKnown(c.env, handle);
      return c.json(
        {
          received: true,
          eventId,
          ready: true,
          address: escrowHoldingAccount(c.env),
          mode: known ? 'direct' : 'escrow',
        },
        202
      );
    }

    case 'fee.paid': {
      const handle = normalizeHandle(event.handle);
      if (!handle) return jsonError(c, 400, 'A valid X handle is required.', 'INVALID_HANDLE');
      const txHash = typeof event.txHash === 'string' ? event.txHash.trim() : '';
      if (!txHash) return jsonError(c, 400, 'txHash is required.', 'INVALID_TX_HASH');

      const result = await recordLaunchpadFee(c.env, {
        launchpad: partner.name,
        handle,
        token: contractId,
        txHash,
        memo: typeof event.memo === 'string' ? event.memo : undefined,
      });
      await recordEvent(
        c.env,
        partner,
        eventId,
        'fee.paid',
        contractId,
        handle,
        txHash,
        result.ok ? 'routed' : 'failed',
        result.ok ? null : result.error || 'not routed'
      );
      if (!result.ok) {
        return jsonError(c, 422, result.error || 'Could not route this fee.', 'FEE_NOT_ROUTED');
      }
      return c.json(
        {
          received: true,
          eventId,
          id: result.id,
          asset: result.asset,
          amount: result.amount,
          routing: result.routing,
          status: result.status,
        },
        202
      );
    }

    default:
      return jsonError(c, 400, `Unknown event: ${String(event.event)}`, 'UNKNOWN_EVENT');
  }
});

/**
 * POST /api/fees/resolve
 * REST equivalent of `fee.pending`: register escrow on the token and report
 * where the launchpad should send and whether the handle is direct or escrow.
 */
feesRouter.post('/resolve', async (c) => {
  const partner = await verifyPartnerKey(c.env, c.req.header('Authorization'));
  if (!partner) {
    return jsonError(c, 401, 'Invalid or missing partner key.', 'PARTNER_KEY_INVALID');
  }

  const body = (await c.req.json().catch(() => null)) as
    | { handle?: unknown; token?: unknown }
    | null;
  const contractId = contractFromToken(body?.token);
  if (!contractId) return jsonError(c, 400, 'A valid NEP-141 token contract is required.', 'INVALID_TOKEN');
  const handle = normalizeHandle(body?.handle);
  if (!handle) return jsonError(c, 400, 'A valid X handle is required.', 'INVALID_HANDLE');

  const reg = await registerEscrowForToken(c.env, partner, contractId);
  if (!reg.registered) {
    return jsonError(c, 422, reg.reason || 'Could not prepare escrow for this token.', 'REGISTRATION_FAILED');
  }
  const known = await handleIsKnown(c.env, handle);
  return c.json({
    handle,
    token: contractId,
    address: escrowHoldingAccount(c.env),
    mode: known ? 'direct' : 'escrow',
    registered: true,
  });
});

/**
 * POST /api/fees/ingest
 * REST equivalent of `fee.paid`: report an inbound fee; UPRAIL verifies it and
 * routes it to the handle.
 */
feesRouter.post('/ingest', async (c) => {
  const partner = await verifyPartnerKey(c.env, c.req.header('Authorization'));
  if (!partner) {
    return jsonError(c, 401, 'Invalid or missing partner key.', 'PARTNER_KEY_INVALID');
  }

  const body = (await c.req.json().catch(() => null)) as
    | { handle?: unknown; token?: unknown; txHash?: unknown; amount?: unknown; memo?: unknown }
    | null;
  const contractId = contractFromToken(body?.token);
  if (!contractId) return jsonError(c, 400, 'A valid NEP-141 token contract is required.', 'INVALID_TOKEN');
  const handle = normalizeHandle(body?.handle);
  if (!handle) return jsonError(c, 400, 'A valid X handle is required.', 'INVALID_HANDLE');
  const txHash = typeof body?.txHash === 'string' ? body.txHash.trim() : '';
  if (!txHash) return jsonError(c, 400, 'txHash is required.', 'INVALID_TX_HASH');

  const result = await recordLaunchpadFee(c.env, {
    launchpad: partner.name,
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
      routing: result.routing,
      status: result.status,
    },
    201
  );
});
