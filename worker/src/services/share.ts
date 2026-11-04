import type { AppContext } from '../types';
import * as nearRpc from './nearRpc';
import { cleanMemeSymbol, NATIVE_NEAR_ALIASES } from '../utils/token';

export { cleanMemeSymbol };

/** Resolves a stored asset id to a plain-English ticker (never `nep141:…`). */
export async function resolveShareTicker(
  env: AppContext['Bindings'],
  asset: string
): Promise<string> {
  if (!asset) return '';
  if (NATIVE_NEAR_ALIASES.has(asset.trim().toLowerCase())) return 'NEAR';
  if (asset.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')) return 'USDC';
  let ticker = '';
  try {
    const tokens = await nearRpc.getSupportedTokens(env);
    ticker = nearRpc.resolveTokenForAsset(asset, tokens)?.symbol || '';
  } catch {}
  // Launchpad tokens (e.g. `uptober.nearlytrade.near`, `raen-e1328c.launchpad.justhoot.near`)
  // live outside the curated registry head, so the lookup above misses them and the title
  // used to fall back to the literal `'crypto'`. Resolve them from the full Rhea list / RPC metadata.
  if (!ticker) {
    try {
      ticker = (await nearRpc.resolveRheaToken(env, asset))?.symbol || '';
    } catch {}
  }
  if (!ticker && /^[a-z0-9]{2,14}$/i.test(asset)) ticker = asset;
  // Last resort: derive the ticker from the NEP-141 contract label
  // ("nep141:uptober.nearlytrade.near" -> "UPTOBER", "nep141:raen-e1328c.launchpad.justhoot.near" -> "RAEN").
  if (!ticker && asset.startsWith('nep141:')) {
    ticker = asset.slice(7);
  }
  return cleanMemeSymbol(ticker || asset);
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

/** Calculates the gross payment amount sent by the user before fees (net + protocol fee). */
export function grossPaymentAmount(netAmount: string, fee?: string | null): string {
  if (!netAmount) return '';
  const net = parseFloat(netAmount) || 0;
  const f = parseFloat(fee || '0') || 0;
  if (f <= 0) return netAmount;
  return Number((net + f).toFixed(8)).toString();
}

/** "12.34 USDC" — degrades gracefully when amount or ticker is missing. */
export function plainAmount(amount: string, ticker: string): string {
  if (amount && ticker) return `${formatShareAmount(amount)} ${ticker}`;
  return ticker || amount || '';
}
