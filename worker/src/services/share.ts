import type { AppContext } from '../types';
import * as nearRpc from './nearRpc';

/**
 * Every representation of native NEAR that can reach a stored payment. NEAR is
 * wrapped for settlement (`nep141:wrap.near`) but must never render as
 * "WRAP" — and `native:near` must not fall through to the generic `.near`
 * suffix match, which could pick an unrelated NEP-141 token.
 */
const NATIVE_NEAR_ALIASES = new Set([
  'near',
  'wnear',
  'wrap.near',
  'native:near',
  'nep141:near',
  'nep141:wrap.near',
]);

/** Resolves a stored asset id to a plain-English ticker (never `nep141:…`). */
export async function resolveShareTicker(
  env: AppContext['Bindings'],
  asset: string
): Promise<string> {
  if (!asset) return '';
  if (NATIVE_NEAR_ALIASES.has(asset.trim().toLowerCase())) return 'NEAR';
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

/** Token amounts in shared cards/links get two decimals; sub-cent stays visible. */
function formatShareAmount(amount: string): string {
  const num = Number(amount);
  if (!isFinite(num)) return amount;
  if (num === 0) return '0.00';
  const abs = Math.abs(num);
  if (abs >= 0.01) {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  const formatted = num
    .toFixed(8)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
  return formatted === '0' ? '<0.00000001' : formatted;
}

/** "12.34 USDC" — degrades gracefully when amount or ticker is missing. */
export function plainAmount(amount: string, ticker: string): string {
  if (amount && ticker) return `${formatShareAmount(amount)} ${ticker}`;
  return ticker || amount || '';
}
