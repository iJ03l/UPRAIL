/**
 * UP (UPRAIL.app) Cloudflare Worker Entry Point
 * Confidential payment system for X (Twitter) handles with Passkey claim & NEAR settlement
 *
 * Architecture:
 *  - All dashboard data is per-user and access-controlled via session
 *  - All fund-moving actions (send, claim) require passkey authorization
 *  - All balances, tokens, and deposit addresses are pulled live from onchain
 *  - NEAR RPC: QuikNode NEAR mainnet (NEAR_RPC_URL env var)
 */

import { Hono } from 'hono';
import type { AppContext, ErrorResponse } from './types';
import { corsMiddleware } from './middleware/cors';
import { rateLimit } from './middleware/rateLimit';
import { sessionMiddleware, requireAuth } from './middleware/session';
import { authRouter } from './routes/auth';
import { paymentsRouter } from './routes/payments';
import { claimRouter } from './routes/claim';
import { healthRouter } from './routes/health';
import { onchainRouter } from './routes/onchain';
import { invitesRouter } from './routes/invites';
import { issueTxChallenge } from './middleware/passkeyAuth';

// Export Durable Object classes for runtime
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

// 2. X OAuth 2.0 PKCE & Passkey authentication flow
app.route('/auth/x', authRouter);
app.route('/auth', authRouter);

// 3. API Routes
const apiRouter = new Hono<AppContext>();

// Payments, invites, and claim flows
apiRouter.route('/', paymentsRouter);
apiRouter.route('/invites', invitesRouter);
apiRouter.route('/claim', claimRouter);

// Live onchain data (balances, tokens, deposit addresses, history)
// All scoped per authenticated user — no data leakage across users
apiRouter.route('/onchain', onchainRouter);

// Passkey transaction challenge endpoint (must be authenticated)
// The frontend calls this BEFORE prompting for the passkey,
// then includes the resulting `passkeyAssertion` with fund-moving requests.
apiRouter.get('/auth-challenge', requireAuth(), issueTxChallenge);

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

// 404 / Asset Fallback Handler
app.notFound(async (c) => {
  if (c.env.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json<ErrorResponse>(
    {
      error: `Endpoint not found: ${c.req.method} ${c.req.path}`,
      code: 'NOT_FOUND',
    },
    404
  );
});

export default {
  fetch: app.fetch,
  async scheduled(event: any, env: AppContext['Bindings'], ctx: any) {
    if (env.DB) {
      const now = Date.now();
      try {
        const expired = await env.DB.prepare(
          "SELECT id FROM payments WHERE expires_at < ? AND status IN ('PENDING', 'DEPOSIT_WAITING')"
        )
          .bind(now)
          .all();
        for (const payment of (expired.results || []) as { id: string }[]) {
          await env.DB.prepare(
            "UPDATE payments SET status = 'EXPIRED', updated_at = ? WHERE id = ?"
          )
            .bind(now, payment.id)
            .run();
        }
      } catch (e) {
        console.warn('Scheduled expiry check failed:', e);
      }
    }
  },
};
