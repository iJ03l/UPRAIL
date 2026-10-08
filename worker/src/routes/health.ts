/**
 * Health check router for UP (UPRAIL.app)
 */

import { Hono } from 'hono';
import type { AppContext } from '../types';

export const healthRouter = new Hono<AppContext>();

/**
 * GET /health
 * Status check endpoint
 */
healthRouter.get('/', async (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'uprail-worker',
    version: '1.0.0',
    env: {
      rpId: c.env.WEBAUTHN_RP_ID,
      nearApi: c.env.NEAR_API_BASE,
      escrowAccount: c.env.ESCROW_ACCOUNT_ID,
    },
  });
});
