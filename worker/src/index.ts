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

// Enforce strict separation: /app is strictly forbidden on apex uprail.world,
// and all login/app routes on apex are redirected to app.uprail.world
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const host = url.hostname.toLowerCase();
  const isApex = host === 'uprail.world' || host === 'www.uprail.world';

  if (isApex) {
    // 1. /app is strictly forbidden on apex
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
      return c.html(
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>403 Forbidden — UPRAIL</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0c0a09; color: #f5f5f4; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
    .card { max-width: 440px; background: #1c1917; border: 1px solid #292524; padding: 36px 32px; border-radius: 24px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    .tag { display: inline-block; padding: 4px 12px; border-radius: 9999px; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #f87171; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 20px; font-family: monospace; letter-spacing: 0.05em; }
    h1 { font-size: 26px; margin: 0 0 12px; font-weight: 800; letter-spacing: -0.02em; }
    p { font-size: 14px; color: #a8a29e; line-height: 1.6; margin: 0 0 24px; }
    .domain { background: #0c0a09; border: 1px solid #292524; padding: 12px; border-radius: 12px; font-family: monospace; color: #E05326; font-weight: bold; margin-bottom: 24px; font-size: 14px; }
    a { display: inline-flex; align-items: center; justify-content: center; width: 100%; box-sizing: border-box; padding: 14px 24px; background: #ffffff; color: #000000; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; text-decoration: none; border-radius: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">403 Forbidden</div>
    <h1>Application Restricted</h1>
    <p>/app is strictly forbidden on uprail.world.<br>The application is hosted on the dedicated secure subdomain:</p>
    <div class="domain">https://app.uprail.world</div>
    <a href="https://app.uprail.world" target="_blank" rel="noopener noreferrer">Launch app.uprail.world &rarr;</a>
  </div>
</body>
</html>`,
        403
      );
    }

    // 2. Login, onboarding, and internal routes on apex redirect directly to app.uprail.world
    if (
      url.pathname === '/login' ||
      url.pathname.startsWith('/login/') ||
      url.pathname === '/parking' ||
      url.pathname.startsWith('/parking/') ||
      url.pathname === '/send' ||
      url.pathname.startsWith('/send/') ||
      url.pathname === '/receive' ||
      url.pathname.startsWith('/receive/') ||
      url.pathname === '/claim' ||
      url.pathname.startsWith('/claim/') ||
      url.pathname === '/history' ||
      url.pathname.startsWith('/history/') ||
      url.pathname === '/privacy' ||
      url.pathname.startsWith('/privacy/') ||
      url.pathname === '/terms' ||
      url.pathname.startsWith('/terms/') ||
      url.pathname.startsWith('/auth/')
    ) {
      return c.redirect(`https://app.uprail.world${url.pathname}${url.search}`, 302);
    }
  }

  return await next();
});

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
