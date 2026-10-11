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
import { securityHeaders } from './middleware/securityHeaders';
import { bodyLimit } from './middleware/bodyLimit';
import { authRouter } from './routes/auth';
import { paymentsRouter } from './routes/payments';
import { claimRouter } from './routes/claim';
import { healthRouter } from './routes/health';
import { onchainRouter } from './routes/onchain';
import { invitesRouter } from './routes/invites';
import { issueTxChallenge } from './middleware/passkeyAuth';
import { publicErrorMessage } from './utils/errors';

// Export Durable Object classes for runtime
export { EscrowDO } from './durable-objects/escrow';
export { NearContainer } from './durable-objects/near-container';

const app = new Hono<AppContext>();

// Global Middlewares
// 1. Defense-in-depth security headers (CSP, HSTS, frame options, sniffing protection)
app.use('*', securityHeaders());
// 2. Body size bounded to prevent memory exhaustion
app.use('*', bodyLimit());
// 3. CORS preflight and allowed origins
app.use('*', corsMiddleware());
// 4. Session HMAC authentication (runs before rate limiting)
app.use('*', sessionMiddleware());
// 5. Rate limiting (keyed on verified user or IP)
app.use('*', rateLimit({ limit: 300, prefix: 'global' }));

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
apiRouter.post('/auth-challenge', requireAuth(), issueTxChallenge);

app.route('/api', apiRouter);

// Global Error Handler
app.onError((err, c) => {
  console.error('[Unhandled Error]:', err);
  return c.json<ErrorResponse>(
    {
      error: publicErrorMessage(err, 'Internal Server Error'),
      code: 'INTERNAL_SERVER_ERROR',
    },
    500
  );
});

// Share-link deep links: /claim/<paymentId> and /app/claim/<paymentId>.
// Next.js static export cannot prerender unknown payment IDs, so these paths
// are rewritten onto the static claim page, which reads the id from the URL.
const CLAIM_DEEP_LINK = /^\/(?:app\/)?claim\/([A-Za-z0-9_-]{1,64})\/?$/;

function isBotRequest(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return (
    ua.includes('twitterbot') ||
    ua.includes('facebookexternalhit') ||
    ua.includes('facebot') ||
    ua.includes('telegrambot') ||
    ua.includes('whatsapp') ||
    ua.includes('discordbot') ||
    ua.includes('slackbot') ||
    ua.includes('linkedinbot') ||
    ua.includes('vkshare') ||
    ua.includes('bingpreview') ||
    ua.includes('embedly') ||
    ua.includes('quora link preview') ||
    ua.includes('redditbot') ||
    ua.includes('applebot') ||
    ua.includes('skypeuripreview')
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderShareCardHtml(opts: {
  title: string;
  description: string;
  imageUrl: string;
  url: string;
}): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeHtml(opts.description)}" />
  
  <!-- Open Graph -->
  <meta property="og:site_name" content="UPRAIL" />
  <meta property="og:title" content="${escapeHtml(opts.title)}" />
  <meta property="og:description" content="${escapeHtml(opts.description)}" />
  <meta property="og:image" content="${escapeHtml(opts.imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${escapeHtml(opts.url)}" />
  <meta property="og:type" content="website" />

  <!-- Twitter Card (summary_large_image for full bleed cards on X) -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@uprail_app" />
  <meta name="twitter:creator" content="@uprail_app" />
  <meta name="twitter:title" content="${escapeHtml(opts.title)}" />
  <meta name="twitter:description" content="${escapeHtml(opts.description)}" />
  <meta name="twitter:image" content="${escapeHtml(opts.imageUrl)}" />
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:2rem;text-align:center;background:#000;color:#fff;">
  <h2>${escapeHtml(opts.title)}</h2>
  <p style="color:#aaa;">${escapeHtml(opts.description)}</p>
  <a href="${escapeHtml(opts.url)}" style="color:#fff;text-decoration:underline;">Open in UPRAIL</a>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

// 404 / Asset Fallback Handler
app.notFound(async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    const userAgent = c.req.header('user-agent');
    const isBot = isBotRequest(userAgent);
    const claimMatch = url.pathname.match(CLAIM_DEEP_LINK);

    if (claimMatch) {
      const paymentId = claimMatch[1];
      if (isBot) {
        let recipient = '';
        let amount = '';
        let asset = '';
        if (c.env.DB) {
          try {
            const p = await c.env.DB.prepare(
              'SELECT recipient_handle, amount, asset FROM payments WHERE id = ?'
            )
              .bind(paymentId)
              .first<{ recipient_handle: string; amount: string; asset: string }>();
            if (p) {
              recipient = p.recipient_handle;
              amount = p.amount;
              asset = (p.asset || 'USDC').toUpperCase();
            }
          } catch {}
        }
        const title = recipient
          ? `Payment waiting for @${recipient} on UPRAIL`
          : 'Payment Ready to Claim on UPRAIL';
        const description = amount && recipient
          ? `@${recipient}, you have ${amount} ${asset} ready to claim with your device passkey on UPRAIL.`
          : 'Claim confidential payment on UPRAIL. Instant passkey settlement on NEAR Intents.';

        return renderShareCardHtml({
          title,
          description,
          imageUrl: 'https://app.uprail.world/og/og-send.png',
          url: url.href,
        });
      }

      const basePath = url.pathname.startsWith('/app/') ? '/app/claim' : '/claim';
      const target = new URL(basePath, url);
      // Keep ?invite= / ?payment= — the page reads them from the address bar.
      target.search = url.search;
      const assetResponse = await c.env.ASSETS.fetch(
        new Request(target, {
          method: 'GET',
          headers: c.req.raw.headers,
        })
      );
      if (assetResponse.ok) {
        return assetResponse;
      }
    }

    if (isBot) {
      if (url.pathname.includes('refer') || url.pathname.includes('invite')) {
        return renderShareCardHtml({
          title: 'Join UPRAIL — The Confidential Value Railway for X',
          description: 'Send and receive value across all chains directly with X handles. Instant passkey settlement.',
          imageUrl: 'https://app.uprail.world/og/og-refer.png',
          url: url.href,
        });
      }
      return renderShareCardHtml({
        title: 'UPRAIL — The Confidential Value Railway for X',
        description: 'Send confidential payments to any X handle on NEAR Confidential Intents. Claim instantly with passkeys on app.uprail.world.',
        imageUrl: 'https://app.uprail.world/og/og-landing.png',
        url: url.href,
      });
    }

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
