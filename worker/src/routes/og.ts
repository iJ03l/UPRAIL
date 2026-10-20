/**
 * Dynamic Open Graph images for share links.
 *
 * Routes:
 *   GET /og/claim/<paymentId>.png
 *   GET /og/invite/<code>.png
 *   GET /og/receipt/<withdrawalId>.png
 *
 * The card is generated from the live row so a share always shows the real
 * sender, amount and ticker instead of the generic static artwork.
 */
import { Hono, type Context } from 'hono';
import type { AppContext } from '../types';
import { plainAmount, resolveShareTicker } from '../services/share';
import { renderOgCard } from '../services/ogCard';

export const ogRouter = new Hono<AppContext>();

/** `/abc.png` -> `abc`; rejects anything that is not a single PNG id. */
function pngId(file: string | undefined): string {
  if (!file || !file.endsWith('.png')) return '';
  const id = file.slice(0, -4);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '';
}

async function cached(c: Context<AppContext>, build: () => Promise<Response>) {
  let cache: Cache | undefined;
  try {
    cache = (caches as unknown as { default: Cache }).default;
  } catch {}
  if (!cache) return build();

  const key = new Request(c.req.url, { method: 'GET' });
  try {
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch {}

  const res = await build();
  try {
    await cache.put(key, res.clone());
  } catch {}
  return res;
}

ogRouter.get('/claim/:file', (c) => {
  const id = pngId(c.req.param('file'));
  if (!id) return c.text('Not found', 404);

  return cached(c, async () => {
    let sender = '';
    let recipient = '';
    let amount = '';
    let asset = '';
    try {
      const row = await c.env.DB.prepare(
        'SELECT sender_x_handle, recipient_handle, amount, asset FROM payments WHERE id = ?'
      )
        .bind(id)
        .first<{
          sender_x_handle: string | null;
          recipient_handle: string | null;
          amount: string;
          asset: string;
        }>();
      if (row) {
        sender = row.sender_x_handle || '';
        recipient = row.recipient_handle || '';
        amount = row.amount || '';
        asset = row.asset || '';
      }
    } catch {}

    const ticker = await resolveShareTicker(c.env, asset);
    const amountLabel = plainAmount(amount, ticker);
    return renderOgCard({
      eyebrow: 'CONFIDENTIAL PAYMENT',
      headline: amountLabel || 'A payment',
      subline: sender ? `from @${sender}` : 'sent via UPRAIL',
      detail: recipient
        ? `For @${recipient}. Claim with a passkey — no wallet, no seed phrase.`
        : 'Claim with a passkey — no wallet, no seed phrase.',
    });
  });
});

ogRouter.get('/invite/:file', (c) => {
  const code = pngId(c.req.param('file'));
  if (!code) return c.text('Not found', 404);

  return cached(c, async () => {
    let creator = '';
    let amount = '';
    let asset = '';
    try {
      const inv = await c.env.DB.prepare(
        'SELECT creator_x_handle, payment_id FROM invites WHERE code = ? COLLATE NOCASE'
      )
        .bind(code)
        .first<{ creator_x_handle: string | null; payment_id: string | null }>();
      if (inv) {
        creator = inv.creator_x_handle || '';
        if (inv.payment_id) {
          const p = await c.env.DB.prepare('SELECT amount, asset FROM payments WHERE id = ?')
            .bind(inv.payment_id)
            .first<{ amount: string; asset: string }>();
          if (p) {
            amount = p.amount || '';
            asset = p.asset || '';
          }
        }
      }
    } catch {}

    const ticker = await resolveShareTicker(c.env, asset);
    const amountLabel = plainAmount(amount, ticker);
    return renderOgCard({
      eyebrow: 'INVITE',
      headline: amountLabel || (creator ? `@${creator} invited you` : 'You are invited'),
      subline: amountLabel && creator ? `from @${creator}` : 'to UPRAIL',
      detail: 'Join with a passkey — no wallet, no seed phrase.',
    });
  });
});

ogRouter.get('/receipt/:file', (c) => {
  const id = pngId(c.req.param('file'));
  if (!id) return c.text('Not found', 404);

  return cached(c, async () => {
    let amount = '';
    let asset = '';
    try {
      const row = await c.env.DB.prepare('SELECT amount, asset FROM withdrawals WHERE id = ?')
        .bind(id)
        .first<{ amount: string; asset: string }>();
      if (row) {
        amount = row.amount || '';
        asset = row.asset || '';
      }
    } catch {}

    const ticker = await resolveShareTicker(c.env, asset);
    const amountLabel = plainAmount(amount, ticker);
    return renderOgCard({
      eyebrow: 'SENT',
      headline: amountLabel || 'Payment sent',
      subline: 'Settled privately across chains',
      detail: 'Confidential by default on UPRAIL.',
    });
  });
});
