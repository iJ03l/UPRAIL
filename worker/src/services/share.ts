import type { AppContext } from '../types';
import * as nearRpc from './nearRpc';

/** Resolves a stored asset id to a plain-English ticker (never `nep141:…`). */
export async function resolveShareTicker(
  env: AppContext['Bindings'],
  asset: string
): Promise<string> {
  if (!asset) return '';
  let ticker = '';
  try {
    const tokens = await nearRpc.getSupportedTokens(env);
    ticker = nearRpc.resolveTokenForAsset(asset, tokens)?.symbol || '';
  } catch {}
  // Launchpad tokens (e.g. `uptober.nearlytrade.near`) live outside the curated
  // registry head, so the lookup above misses them and the title used to fall
  // back to the literal `'crypto'`. Resolve them from the full Rhea list.
  if (!ticker) {
    try {
      ticker = (await nearRpc.resolveRheaToken(env, asset))?.symbol || '';
    } catch {}
  }
  if (!ticker && /^[a-z0-9]{2,14}$/i.test(asset)) ticker = asset.toUpperCase();
  // Last resort: derive the ticker from the NEP-141 contract label
  // ("nep141:uptober.nearlytrade.near" -> "UPTOBER"). A hex contract address is
  // 64 chars and fails the length guard, so it is never shown as a ticker.
  if (!ticker && asset.startsWith('nep141:')) {
    const label = (asset.slice(7).split('.')[0] || '').trim();
    if (/^[a-z0-9_-]{1,14}$/i.test(label)) ticker = label.toUpperCase();
  }
  return ticker;
}

/** "12.5 USDC" — degrades gracefully when amount or ticker is missing. */
export function plainAmount(amount: string, ticker: string): string {
  if (amount && ticker) return `${amount} ${ticker}`;
  return ticker || amount || '';
}
