/**
 * x402 / MPP facilitator endpoints.
 *
 * Merchants (or agents) use these to charge for and settle any resource over
 * the NEAR Intents rail, without running settlement themselves:
 *
 *   POST /api/x402/challenge  → mint a 402 PaymentRequired for a merchant
 *   POST /api/x402/verify     → check a presented payment (read-only)
 *   POST /api/x402/settle     → verify + redeem the payment (single-use)
 *
 * `GET /api/x402/demo` is an example resource gated by the requireX402
 * middleware, proving the challenge → pay → settle round-trip end to end.
 */

import { Hono } from 'hono';
import type { AppContext } from '../types';
import * as x402 from '../services/x402';
import { mintChallenge, verifySettlement } from '../services/x402Challenge';
import { requireX402 } from '../middleware/x402';

export const x402Router = new Hono<AppContext>();

interface ChallengeBody {
  recipientHandle?: string;
  asset?: string;
  amount?: string | number;
  description?: string;
  resource?: string;
  maxTimeoutSeconds?: number | string;
}

/**
 * Accepts either a full x402 PaymentPayload (with a nested `payload`), or a
 * flat credential ({ reference, txHash, sender, … }) and wraps the latter, so
 * a caller does not have to hand-build the envelope.
 */
function asPaymentPayload(body: any): x402.X402PaymentPayload | null {
  if (!body || typeof body !== 'object') return null;
  const candidate = body.paymentPayload || body.payment || body;
  if (typeof candidate !== 'object' || candidate === null) return null;

  if (typeof candidate.payload === 'object' && candidate.payload !== null) {
    return candidate as x402.X402PaymentPayload;
  }

  const flat = {
    reference: candidate.reference,
    id: candidate.id,
    depositAddress: candidate.depositAddress,
    payTo: candidate.payTo,
    txHash: candidate.txHash,
    transaction: candidate.transaction,
    sender: candidate.sender,
  };
  if (!Object.values(flat).some((v) => typeof v === 'string' && v)) return null;

  return {
    x402Version: candidate.x402Version || x402.X402_VERSION,
    scheme: candidate.scheme || 'exact',
    network: candidate.network || x402.NEAR_MAINNET,
    payload: flat,
  };
}

/**
 * POST /api/x402/challenge
 * Public. Mints a fresh payment requirement for a merchant handle.
 */
x402Router.post('/challenge', async (c) => {
  let body: ChallengeBody;
  try {
    body = (await c.req.json()) as ChallengeBody;
  } catch {
    return c.json({ error: 'Invalid JSON body.', code: 'INVALID_BODY' }, 400);
  }

  const recipientHandle = String(body.recipientHandle || '').trim();
  const asset = String(body.asset || '').trim();
  const amount = body.amount === undefined ? '' : String(body.amount).trim();

  if (!recipientHandle) {
    return c.json({ error: 'recipientHandle is required.', code: 'MISSING_RECIPIENT' }, 400);
  }
  if (!asset) {
    return c.json({ error: 'asset is required.', code: 'MISSING_ASSET' }, 400);
  }
  if (!amount || !(parseFloat(amount) > 0)) {
    return c.json({ error: 'amount must be a positive number.', code: 'INVALID_AMOUNT' }, 400);
  }

  try {
    const { requirement, challenge } = await mintChallenge(c.env, {
      recipientHandle,
      asset,
      amount,
      description: body.description ? String(body.description).slice(0, 256) : undefined,
      resourceUrl: body.resource ? String(body.resource).slice(0, 512) : undefined,
      maxTimeoutSeconds: body.maxTimeoutSeconds ? Number(body.maxTimeoutSeconds) : undefined,
    });

    return c.json(
      {
        requirement,
        // Ready-to-send header value for a server returning its own 402.
        paymentRequiredHeader: x402.encodePaymentRequired(requirement),
        reference: challenge.id,
        rail: challenge.rail,
        depositAddress: challenge.payTo,
        expiresAt: challenge.expiresAt,
      },
      201,
      { 'PAYMENT-REQUIRED': x402.encodePaymentRequired(requirement) }
    );
  } catch (err: any) {
    console.error('[x402] challenge mint failed:', err);
    return c.json({ error: 'Could not create a payment challenge.', code: 'X402_CHALLENGE_FAILED' }, 502);
  }
});

/**
 * POST /api/x402/verify
 * Public, read-only. Confirms a payment is settled for the issued challenge.
 */
x402Router.post('/verify', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body.', code: 'INVALID_BODY' }, 400);
  }

  const payload = asPaymentPayload(body);
  if (!payload) {
    return c.json({ error: 'A payment payload is required.', code: 'MISSING_PAYMENT' }, 400);
  }

  const result = await verifySettlement(c.env, payload, { consume: false });
  return c.json({
    isValid: result.ok,
    payer: result.settlement.payer || result.probe?.payer || result.tx?.signer || undefined,
    transaction: result.settlement.transaction,
    amount: result.challenge?.amount,
    recipient: result.challenge?.recipientHandle,
    rail: result.challenge?.rail,
    reason: result.ok ? undefined : result.settlement.errorReason,
    detail: result.ok ? undefined : result.settlement.errorDetail,
  });
});

/**
 * POST /api/x402/settle
 * Public. Verifies and redeems a payment (single-use). Emits PAYMENT-RESPONSE.
 */
x402Router.post('/settle', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body.', code: 'INVALID_BODY' }, 400);
  }

  const payload = asPaymentPayload(body);
  if (!payload) {
    return c.json({ error: 'A payment payload is required.', code: 'MISSING_PAYMENT' }, 400);
  }

  const result = await verifySettlement(c.env, payload, { consume: true });
  const status = result.ok ? 200 : 402;
  return c.json(result.settlement, status, {
    'PAYMENT-RESPONSE': x402.encodeSettlement(result.settlement),
  });
});

/**
 * GET /api/x402/demo
 * Example paid resource: gated by requireX402. Configure with query params so
 * the round-trip can be exercised without a database-driven price table.
 */
x402Router.get(
  '/demo',
  (c, next) => {
    const recipientHandle = c.req.query('recipient') || 'uprail';
    const asset = c.req.query('asset') || 'USDC';
    const amount = c.req.query('amount') || '0.01';
    return requireX402({
      recipientHandle,
      asset,
      amount,
      description: 'UPRAIL x402 demo resource',
    })(c, next);
  },
  (c) =>
    c.json({
      ok: true,
      message: 'Payment settled. This is the protected resource.',
      paidAt: new Date().toISOString(),
    })
);
