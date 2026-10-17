/**
 * HTTP 402 gating middleware (x402 v2 + MPP-compatible).
 *
 * Wrap any handler to require payment to a merchant handle. On a request
 * without a valid payment credential the middleware mints a fresh challenge and
 * returns 402 with the `PAYMENT-REQUIRED` header; with a settled credential it
 * attaches `PAYMENT-RESPONSE` and passes through.
 */

import { Context, MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';
import * as x402 from '../services/x402';
import { mintChallenge, verifySettlement } from '../services/x402Challenge';

export interface X402GateConfig {
  /** Merchant handle that receives the settlement. */
  recipientHandle: string;
  /** Settlement asset symbol (e.g. USDC). */
  asset: string;
  /** Human-readable price. */
  amount: string;
  description?: string;
}

function paymentRequired(
  c: Context<AppContext>,
  requirement: x402.X402PaymentRequired,
  error?: string
): Response {
  const body: x402.X402PaymentRequired = { ...requirement, ...(error ? { error } : {}) };
  return c.json(body, 402, {
    'PAYMENT-REQUIRED': x402.encodePaymentRequired(body),
    'WWW-Authenticate': `Payment realm="uprail", method="${x402.NEAR_INTENTS_METHOD}"`,
  });
}

/** Pulls a base64 payment payload out of an MPP `Authorization: Payment …` header. */
function mppSignatureHeader(authorization: string | undefined): string {
  if (!authorization) return '';
  const trimmed = authorization.trim();
  const match = /^Payment\s+(.+)$/i.exec(trimmed);
  return match ? match[1].trim() : '';
}

export function requireX402(cfg: X402GateConfig): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const signatureHeader =
      c.req.header('PAYMENT-SIGNATURE') || mppSignatureHeader(c.req.header('Authorization'));
    const payload = x402.decodePaymentPayload(signatureHeader);

    const mint = async (): Promise<x402.X402PaymentRequired> => {
      const { requirement } = await mintChallenge(c.env, {
        recipientHandle: cfg.recipientHandle,
        asset: cfg.asset,
        amount: cfg.amount,
        description: cfg.description,
        resourceUrl: c.req.url,
      });
      return requirement;
    };

    if (!payload) {
      try {
        return paymentRequired(c, await mint(), 'PAYMENT-SIGNATURE header is required');
      } catch (err) {
        console.error('[x402] challenge mint failed:', err);
        return c.json({ error: 'Payment required.', code: 'X402_CHALLENGE_FAILED' }, 402);
      }
    }

    const result = await verifySettlement(c.env, payload);
    if (!result.ok) {
      try {
        return paymentRequired(c, await mint(), result.settlement.errorReason);
      } catch {
        return c.json(
          { error: result.settlement.errorDetail || 'Payment not settled.', code: 'X402_PAYMENT_INVALID' },
          402
        );
      }
    }

    await next();
    c.res.headers.set('PAYMENT-RESPONSE', x402.encodeSettlement(result.settlement));
    return;
  };
}
