/**
 * UP (UPRAIL.app) Cloudflare Worker Entry Point
 * Confidential payment system for X (Twitter) handles with Passkey claim & NEAR settlement
 */

import { Hono } from 'hono';
import type { AppContext, ErrorResponse } from './types';
import { corsMiddleware } from './middleware/cors';
import { rateLimit } from './middleware/rateLimit';
import { sessionMiddleware } from './middleware/session';
import { authRouter } from './routes/auth';
import { paymentsRouter } from './routes/payments';
import { claimRouter } from './routes/claim';
import { healthRouter } from './routes/health';

// Export Durable Object classes for Cloudflare runtime
export { EscrowDO } from './durable-objects/escrow';
export { NearContainer } from './durable-objects/near-container';

const app = new Hono<AppContext>();

// Global Middlewares
app.use('*', corsMiddleware());
app.use('*', rateLimit({ limit: 60, prefix: 'global' }));
app.use('*', sessionMiddleware());

// Mount Route Groups
// 1. Health checks
app.route('/health', healthRouter);

// 2. X OAuth 2.0 PKCE authentication flow
app.route('/auth/x', authRouter);

// 3. API Routes (payments and claim flows)
const apiRouter = new Hono<AppContext>();
apiRouter.route('/', paymentsRouter);
apiRouter.route('/claim', claimRouter);

app.route('/api', apiRouter);

// Global Error Handler
app.onError((err, c) => {
  console.error('[Unhandled Error]:', err);
  return c.json<ErrorResponse>(
    {
      error: err.message || 'Internal Server Error',
      code: 'INTERNAL_SERVER_ERROR',
    },
    500
  );
});

// 404 Not Found Handler
app.notFound((c) => {
  return c.json<ErrorResponse>(
    {
      error: `Endpoint not found: ${c.req.method} ${c.req.path}`,
      code: 'NOT_FOUND',
    },
    404
  );
});

export default app;
