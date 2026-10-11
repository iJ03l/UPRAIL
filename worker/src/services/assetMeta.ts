/**
 * assetMeta — live CoinGecko metadata (token artwork + USD price) keyed by
 * the `coingeckoId` the 1Click registry already publishes for ~95% of assets.
 *
 * Why this exists: the registry carries prices but no images, and our local
 * icon table only knows a few dozen contracts, so every other asset in the
 * picker and balance list rendered as an initials circle.
 *
 * Everything here is public market data — no user context is ever sent.
 * Results are cached in KV so a single worker request does not become a
 * CoinGecko call, and a CoinGecko outage degrades to "no image / no price"
 * rather than to invented values.
 */

import type { Env } from '../types';

const KV_KEY = 'asset-meta:v1';

/**
 * Artwork barely changes, and the anonymous CoinGecko endpoint is rate limited
 * hard for shared egress IPs — refresh hourly and keep serving the last good
 * snapshot when the feed says no.
 */
const TTL_MS = 60 * 60 * 1000;

/** CoinGecko's free tier is rate limited — keep batches small. */
const BATCH_SIZE = 50;
const MAX_IDS = 250;

export interface AssetMetaEntry {
  image?: string;
  priceUsd?: number;
}

export type AssetMetaMap = Record<string, AssetMetaEntry>;

async function fetchBatch(ids: string[]): Promise<AssetMetaMap> {
  const params = new URLSearchParams({
    vs_currency: 'usd',
    ids: ids.join(','),
    order: 'market_cap_desc',
    per_page: String(BATCH_SIZE),
    page: '1',
    sparkline: 'false',
  });
  const resp = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params}`, {
    headers: {
      Accept: 'application/json',
      // CoinGecko 403s the default workerd UA on some egress ranges.
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!resp.ok) throw new Error(`coingecko markets ${resp.status}`);

  const rows = (await resp.json()) as any[];
  const out: AssetMetaMap = {};
  if (!Array.isArray(rows)) return out;

  for (const row of rows) {
    const id = row?.id;
    if (typeof id !== 'string' || !id) continue;
    const entry: AssetMetaEntry = {};
    if (typeof row.image === 'string' && row.image.startsWith('https://')) entry.image = row.image;
    if (typeof row.current_price === 'number' && isFinite(row.current_price) && row.current_price > 0) {
      entry.priceUsd = row.current_price;
    }
    out[id] = entry;
  }
  return out;
}

async function fetchAll(ids: string[]): Promise<AssetMetaMap> {
  const out: AssetMetaMap = {};
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const merged = await fetchBatch(ids.slice(i, i + BATCH_SIZE));
    Object.assign(out, merged);
  }
  return out;
}

/**
 * Returns metadata for the given CoinGecko ids, cache-first.
 * Never throws: a missing feed yields an empty (or stale) map.
 */
export async function getAssetMeta(env: Env, ids: string[]): Promise<AssetMetaMap> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(
    0,
    MAX_IDS
  );
  if (unique.length === 0) return {};

  let cached: AssetMetaMap | null = null;
  let cachedAt = 0;
  try {
    const raw = env.CACHE ? await env.CACHE.get(KV_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { at?: number; map?: AssetMetaMap };
      if (parsed?.map && typeof parsed.at === 'number') {
        cached = parsed.map;
        cachedAt = parsed.at;
      }
    }
  } catch (err) {
    console.warn('[assetMeta] KV read failed:', err);
  }

  if (cached && Date.now() - cachedAt < TTL_MS) return cached;

  try {
    const map = await fetchAll(unique);
    if (Object.keys(map).length > 0) {
      // If this refresh only caught part of the universe, keep the old rows
      // for anything we missed instead of dropping artwork we already had.
      const merged: AssetMetaMap = cached ? { ...cached, ...map } : map;
      if (env.CACHE) {
        await env.CACHE.put(KV_KEY, JSON.stringify({ at: Date.now(), map: merged }), {
          expirationTtl: 6 * 3600,
        });
      }
      return merged;
    }
  } catch (err) {
    console.warn('[assetMeta] CoinGecko fetch failed:', err);
  }

  // Feed is down: serve whatever we last saw rather than nothing.
  return cached ?? {};
}
