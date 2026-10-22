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
import { PaymentStatus } from './types';
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
import { agentRouter } from './routes/agent';
import { mcpRouter } from './routes/mcp';
import { feesRouter } from './routes/fees';
import { ogRouter } from './routes/og';
import { issueTxChallenge } from './middleware/passkeyAuth';
import { publicErrorMessage } from './utils/errors';
import { plainAmount, resolveShareTicker } from './services/share';
import { refundEscrowedPayment } from './services/refunds';
import { syncAllLaunchpadFees } from './services/launchpadFees';
import { pruneExpiredAuthChallenges } from './services/maintenance';

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

// Docs subdomain: serve the exported /docs section as the root of
// docs.uprail.world (e.g. /agents → /docs/agents). Assets with a file
// extension and the framework/api prefixes are left untouched.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname.toLowerCase() === 'docs.uprail.world') {
    const hasExt = /\.[a-z0-9]+$/i.test(url.pathname);
    const isReserved =
      url.pathname.startsWith('/_next') || url.pathname.startsWith('/api');
    if (!url.pathname.startsWith('/docs') && !hasExt && !isReserved) {
      url.pathname = `/docs${url.pathname === '/' ? '' : url.pathname}`;
    }
    if (c.env.ASSETS) {
      return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
    }
  }
  return await next();
});

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
      url.pathname === '/fees' ||
      url.pathname.startsWith('/fees/') ||
      url.pathname === '/agents' ||
      url.pathname.startsWith('/agents/') ||
      url.pathname === '/receipt' ||
      url.pathname.startsWith('/receipt/') ||
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

// AI chat payment rail (scoped Bearer keys + USD spend caps)
apiRouter.route('/agent', agentRouter);

// MCP server (JSON-RPC over Streamable HTTP) — Bearer agent key
apiRouter.route('/mcp', mcpRouter);

// Launchpad creator-fee routing (zero-integration RPC detection)
apiRouter.route('/fees', feesRouter);

// Live onchain data (balances, tokens, deposit addresses, history)
// All scoped per authenticated user — no data leakage across users
apiRouter.route('/onchain', onchainRouter);

// Passkey transaction challenge endpoint (must be authenticated)
// The frontend calls this BEFORE prompting for the passkey,
// then includes the resulting `passkeyAssertion` with fund-moving requests.
apiRouter.get('/auth-challenge', requireAuth(), issueTxChallenge);
apiRouter.post('/auth-challenge', requireAuth(), issueTxChallenge);

app.route('/api', apiRouter);

// Dynamic social cards for share links (claim / invite / receipt).
app.route('/og', ogRouter);

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

/**
 * Bump when the generated card artwork/layout changes. Social platforms cache
 * images per URL for a long time, so the version query gives them a new cache
 * key without changing the payment id.
 */
const OG_CARD_VERSION = '3';

// Wallet-send receipt deep links: /receipt/<withdrawalId> and
// /app/receipt/<withdrawalId>, rewritten onto the static receipt page.
const RECEIPT_DEEP_LINK = /^\/(?:app\/)?receipt\/([A-Za-z0-9_-]{1,64})\/?$/;

const BOT_UA_MARKERS = [
  'twitterbot',
  'facebookexternalhit',
  'facebot',
  'meta-externalagent',
  'telegrambot',
  'whatsapp',
  'discordbot',
  'slackbot',
  'linkedinbot',
  'vkshare',
  'bingpreview',
  'embedly',
  'quora link preview',
  'redditbot',
  'applebot',
  'skypeuripreview',
  'pinterestbot',
  'snapchat',
  'iframely',
  'mattermost',
  'nuzzel',
  'outbrain',
  'flipboard',
  'tumblr',
  'xing',
  'google-pagerenderer',
  'ia_archiver',
  'yandexbot',
  'baiduspider',
  'sogou',
  'exabot',
  'petalbot',
  'duckduckbot',
  'msnbot',
  'ahrefsbot',
  'semrushbot',
  'mj12bot',
  'seznambot',
];

/**
 * Link-preview crawlers get the generated share card; real browsers get the
 * SPA. A missing UA is treated as a crawler because every browser sends one.
 * `?card=1` forces the card for manual testing.
 */
function isBotRequest(
  userAgent: string | null | undefined,
  forceCard = false
): boolean {
  if (forceCard) return true;
  if (!userAgent) return true;
  const ua = userAgent.toLowerCase();
  return BOT_UA_MARKERS.some((marker) => ua.includes(marker));
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
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:alt" content="${escapeHtml(opts.title)}" />
  <meta property="og:url" content="${escapeHtml(opts.url)}" />
  <meta property="og:type" content="website" />

  <!-- Twitter Card (summary_large_image for full bleed cards on X) -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@uprailworld" />
  <meta name="twitter:creator" content="@uprailworld" />
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

/**
 * A crawler that fetches the og:image or any other static file must receive the
 * real asset — never the generated HTML preview card. Without this, X's
 * Twitterbot request for `/og/og-claim.png` matched the catch-all bot branch
 * and got `text/html`, so the image never loaded and the card rendered blank.
 */
const STATIC_ASSET_RE =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|map|woff2?|ttf|otf|eot|mp4|webm|pdf|txt|xml|json|webmanifest)$/i;

// 404 / Asset Fallback Handler
app.notFound(async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    const userAgent = c.req.header('user-agent');
    const isBot = isBotRequest(userAgent, url.searchParams.get('card') === '1');
    const claimMatch = url.pathname.match(CLAIM_DEEP_LINK);

    if (claimMatch) {
      const paymentId = claimMatch[1];
      if (isBot && !STATIC_ASSET_RE.test(url.pathname)) {
        let sender = '';
        let amount = '';
        let asset = '';
        if (c.env.DB) {
          try {
            const p = await c.env.DB.prepare(
              'SELECT sender_x_handle, amount, asset FROM payments WHERE id = ?'
            )
              .bind(paymentId)
              .first<{ sender_x_handle: string | null; amount: string; asset: string }>();
            if (p) {
              sender = p.sender_x_handle || '';
              amount = p.amount;
              asset = p.asset || '';
            }
          } catch {}
        }
        const ticker = await resolveShareTicker(c.env, asset);
        const amountLabel = plainAmount(amount, ticker);
        const title = sender
          ? `@${sender} sent you ${amountLabel || 'crypto'}`
          : amountLabel
          ? `${amountLabel} is waiting for you`
          : 'You have crypto waiting on UPRAIL';
        const description =
          'Open to receive it. Sign in with X, then confirm with Face ID or fingerprint. No crypto wallet needed.';

        return renderShareCardHtml({
          title,
          description,
          imageUrl: `${url.origin}/og/claim/${paymentId}.png?v=${OG_CARD_VERSION}`,
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

    const receiptMatch = url.pathname.match(RECEIPT_DEEP_LINK);
    if (receiptMatch) {
      const withdrawalId = receiptMatch[1];
      if (isBot && !STATIC_ASSET_RE.test(url.pathname)) {
        let amount = '';
        let asset = '';
        if (c.env.DB) {
          try {
            const w = await c.env.DB.prepare(
              'SELECT amount, asset FROM withdrawals WHERE id = ?'
            )
              .bind(withdrawalId)
              .first<{ amount: string; asset: string }>();
            if (w) {
              amount = w.amount;
              asset = w.asset;
            }
          } catch {}
        }
        const ticker = await resolveShareTicker(c.env, asset);
        const amountLabel = plainAmount(amount, ticker);
        return renderShareCardHtml({
          title: amountLabel ? `Payment of ${amountLabel} sent` : 'Payment sent on UPRAIL',
          description:
            'Settled confidentially across chains on UPRAIL — no wallet, no seed phrase.',
          imageUrl: `${url.origin}/og/receipt/${withdrawalId}.png?v=${OG_CARD_VERSION}`,
          url: url.href,
        });
      }

      const target = new URL('/receipt', url);
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

    if (isBot && !STATIC_ASSET_RE.test(url.pathname)) {
      // Invite links arrive as `/login?invite=CODE` (plus `/invite/CODE` and
      // legacy `/refer…` shapes), so the code lives in the query string, not
      // the path — the old pathname-only check rendered the generic card.
      const inviteCode =
        url.searchParams.get('invite') ||
        url.searchParams.get('code') ||
        url.pathname.match(/\/(?:invite|refer)\/([A-Za-z0-9_-]{1,32})/)?.[1] ||
        '';

      if (inviteCode) {
        let creator = '';
        let amount = '';
        let asset = '';
        if (c.env.DB) {
          try {
            const inv = await c.env.DB.prepare(
              'SELECT creator_x_handle, payment_id FROM invites WHERE code = ? COLLATE NOCASE'
            )
              .bind(inviteCode)
              .first<{ creator_x_handle: string | null; payment_id: string | null }>();
            if (inv) {
              creator = inv.creator_x_handle || '';
              const paymentId = inv.payment_id || url.searchParams.get('payment') || '';
              if (paymentId) {
                const p = await c.env.DB.prepare(
                  'SELECT amount, asset FROM payments WHERE id = ?'
                )
                  .bind(paymentId)
                  .first<{ amount: string; asset: string }>();
                if (p) {
                  amount = p.amount;
                  asset = p.asset || '';
                }
              }
            }
          } catch {}
        }
        const ticker = await resolveShareTicker(c.env, asset);
        const amountLabel = plainAmount(amount, ticker);
        const title = creator
          ? amountLabel
            ? `@${creator} sent you ${amountLabel}`
            : `@${creator} invited you to UPRAIL`
          : amountLabel
          ? `${amountLabel} is waiting for you on UPRAIL`
          : 'You are invited to UPRAIL';
        return renderShareCardHtml({
          title,
          description: 'Open to receive it. Sign in with X, then confirm with Face ID or fingerprint.',
          imageUrl: `${url.origin}/og/invite/${inviteCode}.png?v=${OG_CARD_VERSION}`,
          url: url.href,
        });
      }

      return renderShareCardHtml({
        title: 'UPRAIL — The Confidential Value Railway for X',
        description:
          'Send money to any X handle — privately. Recipients receive it with a tap, no crypto wallet needed.',
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
    if (!env.DB) return;
    const now = Date.now();

    // 1. Expiry sweep for sends whose funds never moved (PENDING /
    //    DEPOSIT_WAITING): safe to expire, nothing to refund.
    try {
      const expired = await env.DB.prepare(
        `SELECT * FROM payments WHERE expires_at < ? AND status IN ('PENDING', 'DEPOSIT_WAITING') AND intent_hash IS NULL`
      )
        .bind(now)
        .all<{ id: string }>();
      for (const payment of (expired.results || [])) {
        await env.DB.prepare(
          "UPDATE payments SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status IN ('PENDING', 'DEPOSIT_WAITING')"
        )
          .bind(now, payment.id)
          .run();
        console.log(`[cron] expired unsettled payment ${payment.id}`);
      }
    } catch (e) {
      console.warn('[cron] expiry sweep failed:', e);
    }

    // 2. Crash recovery: stale PENDING rows with no escrow deposit intent —
    //    the send flow crashed between insert and settlement. Nothing moved
    //    (intent_hash NULL), so expire them; escalate if any are older than
    //    15 minutes (they should have finalized or failed immediately).
    try {
      const stale = await env.DB.prepare(
        `SELECT id, created_at FROM payments WHERE status IN ('PENDING', 'DEPOSIT_WAITING')
           AND intent_hash IS NULL AND created_at < ?`
      )
        .bind(now - 15 * 60 * 1000)
        .all<{ id: string; created_at: number }>();
      for (const payment of (stale.results || [])) {
        console.error(
          `[cron] CRITICAL: stale unsettled payment ${payment.id} (created ${new Date(payment.created_at).toISOString()}) — send flow left it behind, expiring`
        );
        await env.DB.prepare(
          "UPDATE payments SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status IN ('PENDING', 'DEPOSIT_WAITING') AND intent_hash IS NULL"
        )
          .bind(now, payment.id)
          .run();
      }
    } catch (e) {
      console.warn('[cron] stale-payment sweep failed:', e);
    }

    // 3. Refund ESCROWED payments past their expiry — the pooled escrow holds
    //    the gross (amount + fee); refundEscrowedPayment flips the row
    //    atomically so a concurrent claim can never both win.
    try {
      const due = await env.DB.prepare(
        `SELECT * FROM payments WHERE status = ? AND expires_at < ? ORDER BY created_at ASC LIMIT 50`
      )
        .bind(PaymentStatus.ESCROWED, now)
        .all<any>();
      for (const row of (due.results || [])) {
        const res = await refundEscrowedPayment(env, row);
        if (res.refunded) {
          console.log(`[cron] refunded expired payment ${row.id} (tx ${res.txHash})`);
        } else if (!res.alreadyRefunded) {
          console.warn(`[cron] refund skipped for ${row.id}: ${res.error}`);
        }
      }
    } catch (e) {
      console.warn('[cron] refund sweep failed:', e);
    }

    // 4. Crash recovery: REFUNDED rows whose refund_tx_hash never got written
    //    — the flip succeeded but the transfer/hash write did not complete.
    try {
      const stuck = await env.DB.prepare(
        `SELECT * FROM payments WHERE status = ? AND refund_tx_hash IS NULL ORDER BY created_at ASC LIMIT 25`
      )
        .bind(PaymentStatus.REFUNDED)
        .all<any>();
      for (const row of (stuck.results || [])) {
        const res = await refundEscrowedPayment(env, row);
        if (res.refunded) {
          console.log(`[cron] completed interrupted refund ${row.id} (tx ${res.txHash})`);
        } else {
          console.warn(`[cron] interrupted refund ${row.id} still pending: ${res.error}`);
        }
      }
    } catch (e) {
      console.warn('[cron] interrupted-refund recovery failed:', e);
    }

    // 5. Auto-discover and route incoming launchpad creator fees on escrow.uprail.near
    //    via NEAR_RPC_URL (zero-API / no-txHash launchpad fee routing).
    try {
      const feeSync = await syncAllLaunchpadFees(env, { maxTokens: 15 });
      if (feeSync.routed > 0) {
        console.log(`[cron] auto-routed ${feeSync.routed} launchpad creator fee(s) across ${feeSync.checked} token(s)`);
      }
    } catch (e) {
      console.warn('[cron] launchpad fee auto-sync failed:', e);
    }

    // 6. Prune expired WebAuthn/OAuth challenges. They are single-use and
    //    rejected once expired, so a day of rows is enough for debugging.
    try {
      const pruned = await pruneExpiredAuthChallenges(env, now);
      if (pruned > 0) {
        console.log(`[cron] pruned ${pruned} expired auth challenge(s)`);
      }
    } catch (e) {
      console.warn('[cron] auth challenge prune failed:', e);
    }
  },
};
