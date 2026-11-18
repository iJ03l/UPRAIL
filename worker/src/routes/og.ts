/**
 * Dynamic Open Graph images for share links.
 *
 * Routes:
 *   GET /og/claim/<paymentId>.png
 *   GET /og/invite/<code>.png
 *   GET /og/receipt/<withdrawalId>.png
 *   GET /og/fees/<handle>.png?asset=<asset>&k=<signed-key>
 *
 * The card is generated from the live row so a share always shows the real
 * sender, amount and ticker instead of the generic static artwork.
 */
import { Hono, type Context } from 'hono';
import type { AppContext } from '../types';
import { plainAmount, resolveShareTicker } from '../services/share';
import { renderOgCard, renderCoffeeOgCard } from '../services/ogCard';
import {
  creatorFeeCardKeyValid,
  emptyCreatorFeeCardSummary,
  getCreatorFeeCardSummary,
  normalizeCreatorFeeAsset,
  normalizeCreatorFeeHandle,
} from '../services/creatorFeesCard';

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
  if (!(res.headers.get('cache-control') || '').includes('no-store')) {
    try {
      await cache.put(key, res.clone());
    } catch {}
  }
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
        'SELECT sender_x_handle, recipient_handle, amount, fee, asset FROM payments WHERE id = ?'
      )
        .bind(id)
        .first<{
          sender_x_handle: string | null;
          recipient_handle: string | null;
          amount: string;
          fee: string | null;
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
      eyebrow: 'PAYMENT WAITING',
      headline: amountLabel || 'A payment',
      subline: sender ? `from @${sender}` : 'sent via UPRAIL',
      detail: recipient
        ? `For @${recipient}. Confirm with Face ID or fingerprint.`
        : 'Confirm with Face ID or fingerprint.',
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
          const p = await c.env.DB.prepare('SELECT amount, fee, asset FROM payments WHERE id = ?')
            .bind(inv.payment_id)
            .first<{ amount: string; fee: string | null; asset: string }>();
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
      detail: 'Open to receive it — no crypto wallet needed.',
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

ogRouter.get('/fees/:file', (c) => {
  const handle = normalizeCreatorFeeHandle(pngId(c.req.param('file')));
  const asset = normalizeCreatorFeeAsset(c.req.query('asset'));
  if (!handle || !asset) return c.text('Not found', 404);

  return cached(c, async () => {
    const valid = await creatorFeeCardKeyValid(c.env, handle, asset, c.req.query('k'));
    const summary = valid
      ? await getCreatorFeeCardSummary(c.env, handle, asset)
      : emptyCreatorFeeCardSummary(handle, asset);
    return renderOgCard({
      eyebrow: 'CREATOR FEES',
      headline: summary.headline,
      subline: summary.subline,
      detail: valid
        ? summary.detail
        : 'Open the private claim link to see the pending total.',
      cacheControl: 'public, max-age=60, s-maxage=60',
    });
  });
});

ogRouter.get('/request/:file', (c) => {
  const id = pngId(c.req.param('file'));
  if (!id) return c.text('Not found', 404);

  return cached(c, async () => {
    let requester = '';
    let target = '';
    let amount = '';
    let asset = '';
    let memo = '';
    try {
      const row = await c.env.DB.prepare(
        'SELECT requester_handle, requested_handle, amount, asset, memo FROM payment_requests WHERE id = ?'
      )
        .bind(id)
        .first<{
          requester_handle: string | null;
          requested_handle: string | null;
          amount: string;
          asset: string;
          memo: string | null;
        }>();
      if (row) {
        requester = row.requester_handle || '';
        target = row.requested_handle || '';
        amount = row.amount || '';
        asset = row.asset || '';
        memo = row.memo || '';
      }
    } catch {}

    const ticker = await resolveShareTicker(c.env, asset);
    const amountLabel = plainAmount(amount, ticker);
    const shortMemo = memo ? (memo.length > 45 ? `${memo.slice(0, 42)}…` : memo) : '';

    let detail = '';
    if (shortMemo && target) {
      detail = `“${shortMemo}” — Request for @${target} on UPRAIL. Tap to view or pay.`;
    } else if (shortMemo) {
      detail = `“${shortMemo}” — Tap to view or pay.`;
    } else if (target) {
      detail = `Request for @${target} on UPRAIL. Tap to view or pay.`;
    } else {
      detail = 'Payment request on UPRAIL. Tap to view or pay.';
    }

    return renderOgCard({
      eyebrow: 'PAYMENT REQUEST',
      headline: amountLabel || 'Payment requested',
      subline: requester ? `requested by @${requester}` : 'via UPRAIL',
      detail,
    });
  });
});

async function resolveFxTwitterAvatarUrl(handle: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`, {
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'UPRAIL/1.0', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as any;
    const raw = typeof data?.user?.avatar_url === 'string' ? data.user.avatar_url.trim() : '';
    if (!raw || !raw.startsWith('https://')) return null;
    return raw.replace(/_normal\.(jpg|jpeg|png)$/i, '_400x400.$1');
  } catch {
    return null;
  }
}

async function fetchImageAsDataUri(rawUrl: string): Promise<string | null> {
  if (!rawUrl) return null;
  try {
    const resp = await fetch(rawUrl, {
      signal: AbortSignal.timeout(4500),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; UPRAIL/1.0)',
        Accept: 'image/png,image/jpeg,image/*,*/*;q=0.8',
      },
    });
    if (!resp.ok) return null;
    const ct = (resp.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (ct !== 'image/png' && ct !== 'image/jpeg' && ct !== 'image/jpg' && ct !== 'image/gif') {
      return null;
    }
    const buf = await resp.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 512 * 1024) return null;
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const mime = ct === 'image/jpg' ? 'image/jpeg' : ct;
    return `data:${mime};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

async function resolveCoffeeAvatarDataUri(
  env: any,
  handle: string,
  dbAvatarUrl: string | null
): Promise<string | null> {
  const kvKey = `avatar_uri_v1:${handle.toLowerCase()}`;
  try {
    const cachedUri = await env.CACHE?.get(kvKey);
    if (typeof cachedUri === 'string' && cachedUri.startsWith('data:image/')) {
      return cachedUri;
    }
  } catch {}

  const candidates: string[] = [];
  if (dbAvatarUrl) candidates.push(dbAvatarUrl);
  const fxUrl = await resolveFxTwitterAvatarUrl(handle);
  if (fxUrl) candidates.push(fxUrl);
  candidates.push(`https://unavatar.io/x/${encodeURIComponent(handle)}`);
  candidates.push(`https://unavatar.io/twitter/${encodeURIComponent(handle)}`);

  for (const url of candidates) {
    const dataUri = await fetchImageAsDataUri(url);
    if (dataUri) {
      try {
        await env.CACHE?.put(kvKey, dataUri, { expirationTtl: 21600 });
      } catch {}
      return dataUri;
    }
  }
  return null;
}

ogRouter.get('/coffee/:file', (c) => {
  const handle = pngId(c.req.param('file')).toLowerCase();
  if (!handle) return c.text('Not found', 404);

  return cached(c, async () => {
    let displayHandle = handle;
    let displayName = handle;
    let dbAvatarUrl: string | null = null;
    try {
      const row = await c.env.DB.prepare(
        'SELECT x_handle, x_name, avatar_url FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
      )
        .bind(handle)
        .first<{ x_handle: string; x_name: string | null; avatar_url: string | null }>();
      if (row) {
        displayHandle = row.x_handle || handle;
        displayName = row.x_name || displayHandle;
        dbAvatarUrl = row.avatar_url || null;
      }
    } catch {}

    const avatarDataUri = await resolveCoffeeAvatarDataUri(c.env, displayHandle, dbAvatarUrl);

    return renderCoffeeOgCard({
      handle: displayHandle,
      name: displayName,
      avatarDataUri,
      cacheControl: avatarDataUri ? 'public, max-age=600, s-maxage=600' : 'no-store',
    });
  });
});

ogRouter.get('/gift/:file', (c) => {
  const id = pngId(c.req.param('file'));
  if (!id || !/^gft_[a-f0-9]{16,64}$/.test(id)) return c.text('Not found', 404);

  return cached(c, async () => {
    const row = await c.env.DB.prepare(
      `SELECT sender_handle, recipient_handle, occasion, show_amount,
              vault_symbol, principal_usd_cents, timelock_until, status
       FROM gifts WHERE id = ? LIMIT 1`
    )
      .bind(id)
      .first<{
        sender_handle: string;
        recipient_handle: string;
        occasion: string;
        show_amount: number;
        vault_symbol: string;
        principal_usd_cents: number;
        timelock_until: number;
        status: string;
      }>();

    if (!row) {
      return renderOgCard({
        eyebrow: 'UPRAIL · EARN VAULT GIFT',
        headline: 'An Earn Vault gift awaits you',
        subline: 'Sign in with your 𝕏 handle & passkey to unwrap',
        cacheControl: 'no-store',
      });
    }

    const occasionLabels: Record<string, string> = {
      BIRTHDAY: 'BIRTHDAY GIFT',
      CHRISTMAS: 'CHRISTMAS GIFT',
      HOLIDAY: 'HOLIDAY GIFT',
      ANNIVERSARY: 'ANNIVERSARY GIFT',
      CONGRATS: 'CONGRATULATIONS GIFT',
      JUST_BECAUSE: 'SURPRISE EARN GIFT',
    };
    const occLabel = occasionLabels[String(row.occasion || '').toUpperCase()] || 'EARN VAULT GIFT';
    const unlockDate = new Date(Number(row.timelock_until || 0)).toISOString().slice(0, 10);
    const isUnlocked = Date.now() >= Number(row.timelock_until || 0);
    const showAmt = Number(row.show_amount) === 1;
    const usdStr = showAmt
      ? `$${(Number(row.principal_usd_cents || 0) / 100).toFixed(2)} in ${row.vault_symbol}`
      : `${row.vault_symbol} Earn Vault`;

    return renderOgCard({
      eyebrow: `UPRAIL · ${occLabel}`,
      headline: `@${row.sender_handle} → @${row.recipient_handle}`,
      subline: `${usdStr} · Compounding Yield on NEAR Intents`,
      detail:
        row.status === 'CLAIMED'
          ? 'Unwrapped & claimed on UPRAIL'
          : isUnlocked
          ? 'Unlocked & ready to unwrap with Passkey'
          : `Timelocked until ${unlockDate}`,
      cacheControl: 'public, max-age=120, s-maxage=120',
    });
  });
});

