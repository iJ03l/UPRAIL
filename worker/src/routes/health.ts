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
  // Public, unauthenticated endpoint: expose liveness only. Config values and
  // secret-presence flags (rpId, settlement URL, escrow account, whether keys
  // are set) are useful reconnaissance for an attacker and give no client any
  // benefit — they were removed deliberately.
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'uprail-worker',
    version: '1.0.0',
  });
});
