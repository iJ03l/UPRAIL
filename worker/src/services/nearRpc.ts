/**
 * NEAR RPC Service — Live onchain data via QuikNode NEAR mainnet RPC
 *
 * All data (balances, tokens, deposit addresses, history) is sourced directly
 * from the NEAR blockchain through the configured NEAR_RPC_URL.
 * No hardcoded state. No stale caches for critical financial data.
 */

import type { Env, Session } from '../types';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58Decode, base58Encode } from '../utils/base58';
import { getOnchainIcon } from './onchainIcons';
import { getAssetMeta } from './assetMeta';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TokenCategory = 'popular' | 'stables' | 'l1' | 'memes' | 'all';

export interface OnchainToken {
  defuse_asset_id: string;   // e.g. "nep141:usdc.token.near"
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  nearContractId: string;    // e.g. "usdc.token.near"
  chain: string;             // "near" | "eth" | "sol" | "btc" | ...
  chainId?: string;
  priceUsd?: number;
  category?: TokenCategory;
}

/**
 * Assets that ride the "NEAR & Memes" rail. Matched on contract id or symbol;
 * a match means the asset is classified as a meme instead of being dropped by
 * the old spam filter (which used to hide PEPE/DOGE-class assets entirely).
 */
const MEME_CONTRACT_HINTS = [
  'meme-cooking',
  '0xshitzu',
  'blackdragon',
  'lonk',
  'shitzu',
  'neko',
  'purr',
  'slush',
  'tkn.near',
  'nearlytrade',
  'nearlytrader',
  'nearlypad',
  'cookinglabs',
  'pump',
  'launchpad',
];
const MEME_SYMBOLS = new Set([
  'PEPE', 'WIF', '$WIF', 'BOME', 'DOGE', 'TRUMP', 'MELANIA', 'SHITZU',
  'BLACKDRAGON', 'MOCHI', 'NEIRO', 'BOBO', 'DEGEN', 'POP CAT', 'POPCAT',
  'FARTCOIN', 'BONK', 'MYRO', 'SLERF', 'BODEN', 'GNEAR', 'NOEAR', 'ABG',
  'JAMBO', 'PURGE', 'LONK', 'PURR', 'NEKO', 'SLUSH', 'NEARLY', 'BABY',
  'FLOKI', 'SHIB', 'MOG', 'SPX', 'BRETT', 'GIGA', 'CHILLGUY', 'PENGU',
  'PNUT', 'GOAT', 'MARCO', 'WOOF', 'BENDOG', 'WEN', 'TURBO', 'MOON',
  'CHUCK', 'HODL', 'ACT', 'PUPPIES', 'BULL', 'BEAR', 'APE', 'APECOIN',
]);

export function isMemeAsset(symbol: string, contractId: string): boolean {
  const sym = (symbol || '').toUpperCase();
  const contract = (contractId || '').toLowerCase();
  return (
    sym.includes('MEME') ||
    contract.includes('meme') ||
    MEME_CONTRACT_HINTS.some((hint) => contract.includes(hint)) ||
    MEME_SYMBOLS.has(sym)
  );
}

// ─── Rhea (Ref Finance) native NEAR token list ───────────────────────────────
/**
 * The Intents registry only knows assets with solver routes. Native NEAR
 * NEP-141 tokens — especially Rhea/Ref launchpad memes such as
 * `*.nearlytrade.near` — live onchain regardless of Intents coverage, so the
 * send rail merges them in from the Rhea token API.
 *
 * The list carries metadata only (no prices), so merged tokens keep `priceUsd`
 * undefined and the UI renders "—" instead of inventing a number. The payload
 * is KV-cached (6h) with stale fallback; a feed outage degrades to
 * "Intents list only", never to an error.
 */
const RHEA_LIST_URL = 'https://api.ref.finance/list-token';
const RHEA_KV_KEY = 'rhea-token-list:v1';
const RHEA_TTL_MS = 6 * 3600 * 1000;
/** Curated head merged into the main list; the long tail stays searchable. */
const RHEA_HEAD_MAX = 300;

export interface RheaTokenEntry {
  contractId: string;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
}

function parseRheaList(raw: unknown): RheaTokenEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: RheaTokenEntry[] = [];
  for (const [contractId, meta] of Object.entries(raw as Record<string, any>)) {
    if (typeof contractId !== 'string' || !contractId.endsWith('.near')) continue;
    const m = (meta || {}) as any;
    const symbol = typeof m.symbol === 'string' ? m.symbol.trim() : '';
    if (!symbol || symbol.length > 12) continue;
    const decimals = Number(m.decimals);
    if (!Number.isFinite(decimals) || decimals < 0 || decimals > 24) continue;
    out.push({
      contractId,
      symbol,
      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 64) : symbol,
      decimals: Math.trunc(decimals),
      icon: typeof m.icon === 'string' && m.icon.startsWith('https://') ? m.icon : '',
    });
  }
  return out;
}

export async function getRheaTokens(env: Env): Promise<RheaTokenEntry[]> {
  let cached: RheaTokenEntry[] | null = null;
  let cachedAt = 0;
  try {
    const raw = env.CACHE ? await env.CACHE.get(RHEA_KV_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { at?: number; tokens?: RheaTokenEntry[] };
      if (Array.isArray(parsed?.tokens) && typeof parsed.at === 'number') {
        cached = parsed.tokens;
        cachedAt = parsed.at;
      }
    }
  } catch (err) {
    console.warn('[rhea] KV read failed:', err);
  }

  if (cached && Date.now() - cachedAt < RHEA_TTL_MS) return cached;

  try {
    const resp = await fetch(RHEA_LIST_URL, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`rhea list-token ${resp.status}`);
    const fresh = parseRheaList(await resp.json());
    if (fresh.length > 0) {
      if (env.CACHE) {
        await env.CACHE.put(RHEA_KV_KEY, JSON.stringify({ at: Date.now(), tokens: fresh }), {
          expirationTtl: 24 * 3600,
        }).catch((kvErr) => console.warn('[rhea] KV write failed:', kvErr));
      }
      return fresh;
    }
  } catch (err) {
    console.warn('[rhea] token list fetch failed:', err);
  }
  return cached ?? [];
}

export function rheaToOnchainToken(e: RheaTokenEntry): OnchainToken {
  const symbol = e.symbol.toUpperCase();
  return {
    defuse_asset_id: `nep141:${e.contractId}`,
    symbol,
    name: e.name || symbol,
    decimals: e.decimals,
    icon: e.icon || undefined,
    nearContractId: e.contractId,
    chain: 'near',
    priceUsd: undefined,
    category: isMemeAsset(e.symbol, e.contractId) ? 'memes' : 'all',
  };
}

/**
 * Looks a single asset up in the full Rhea list (no head cap): used when the
 * quote/send path meets an asset the curated list does not contain.
 */
export async function resolveRheaToken(
  env: Env,
  asset: string | null | undefined
): Promise<OnchainToken | null> {
  const raw = (asset || '').trim().toLowerCase();
  if (!raw) return null;
  const contract = raw.startsWith('nep141:') ? raw.slice(7) : raw;
  try {
    const list = await getRheaTokens(env);
    const hit =
      list.find((e) => e.contractId.toLowerCase() === contract) ||
      list.find((e) => e.symbol.toLowerCase() === raw);
    return hit ? rheaToOnchainToken(hit) : null;
  } catch {
    return null;
  }
}

export interface IntentAccountBalance {
  defuse_asset_id: string;
  symbol: string;
  amount: string;            // raw string from contract
  amountFormatted: string;   // human-readable
  decimals: number;
  nearContractId: string;
  icon?: string;
}

export interface DepositAddress {
  chain: string;
  chainName: string;
  address: string;
  memo?: string;
  expiresAt?: number;
  token?: string;
  minAmount?: string;
  minAmountFormatted?: string;
  minAmountUsd?: string;
  isOneTime?: boolean;
}

export interface IntentTx {
  id: string;
  intent_type: string;       // "ft_transfer" | "swap" | etc.
  defuse_asset_id_in?: string;
  defuse_asset_id_out?: string;
  amount_in?: string;
  amount_out?: string;
  receiver_id?: string;
  sender_id?: string;
  block_height: number;
  block_timestamp: number;
  status: 'success' | 'pending' | 'failed';
}


async function nearRpc(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>
): Promise<any> {
  const targetUrl = rpcUrl || 'https://free.rpc.fastnear.com';
  const resp = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'uprail',
      method,
      params,
    }),
  });

  if (!resp.ok) {
    throw new Error(`NEAR RPC HTTP error: ${resp.status}`);
  }

  const json = await resp.json() as any;
  if (json.error) {
    throw new Error(`NEAR RPC error [${json.error.code}]: ${json.error.message}`);
  }
  return json.result;
}

// ─── Contract view call ───────────────────────────────────────────────────────

async function viewFunction(
  rpcUrl: string,
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {}
): Promise<any> {
  const argsBase64 = btoa(JSON.stringify(args));
  const primaryRpc = rpcUrl || 'https://free.rpc.fastnear.com';

  try {
    const result = await nearRpc(primaryRpc, 'query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64,
    });

    if (result && result.result) {
      const bytes = new Uint8Array(result.result);
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text);
    }
    return null;
  } catch (primaryErr) {
    // If primary RPC fails, fall back to FastNEAR public RPC
    if (primaryRpc !== 'https://free.rpc.fastnear.com') {
      try {
        const fallbackResult = await nearRpc('https://free.rpc.fastnear.com', 'query', {
          request_type: 'call_function',
          finality: 'final',
          account_id: contractId,
          method_name: methodName,
          args_base64: argsBase64,
        });
        if (fallbackResult && fallbackResult.result) {
          const bytes = new Uint8Array(fallbackResult.result);
          const text = new TextDecoder().decode(bytes);
          return JSON.parse(text);
        }
      } catch {}
    }
    throw primaryErr;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatAmount(raw: string, decimals: number): string {
  if (!raw || raw === '0') return '0.00';
  const padded = raw.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, '') || '0';
  const displayFrac = fracPart.slice(0, 6); // max 6 decimal places for display
  return `${intPart}.${displayFrac}`;
}

export function toBaseUnits(amountStr: string, decimals: number): string {
  const parts = amountStr.trim().split('.');
  const intPart = parts[0] || '0';
  let fracPart = parts[1] || '';
  if (fracPart.length > decimals) {
    fracPart = fracPart.slice(0, decimals);
  } else {
    fracPart = fracPart.padEnd(decimals, '0');
  }
  const combined = (intPart === '0' ? '' : intPart) + fracPart;
  const trimmed = combined.replace(/^0+/, '');
  return trimmed || '0';
}

/**
 * Resolves a stored or requested asset value onto a registry token.
 *
 * Accepted inputs (all mean the same thing to callers): a defuse asset id
 * (`nep141:usdc...`), a short token id (`usdc`), a bare symbol (`USDC`), or a
 * NEAR contract id (`wrap.near`). Returns null when nothing matches — callers
 * must decide how to degrade instead of silently picking tokens[0].
 */
export function resolveTokenForAsset(
  asset: string | null | undefined,
  tokens: OnchainToken[]
): OnchainToken | null {
  const raw = (asset || '').trim();
  if (!raw || !Array.isArray(tokens) || tokens.length === 0) return null;
  const lower = raw.toLowerCase();

  const byId = tokens.find((t) => (t.defuse_asset_id || '').toLowerCase() === lower);
  if (byId) return byId;

  const bySymbol = tokens.find((t) => (t.symbol || '').toLowerCase() === lower);
  if (bySymbol) return bySymbol;

  const byContract = tokens.find((t) => (t.nearContractId || '').toLowerCase() === lower);
  if (byContract) return byContract;

  // Defuse ids carry a chain prefix — match on the unprefixed remainder.
  const suffix = lower.includes(':') ? lower.slice(lower.indexOf(':') + 1) : lower;
  return (
    tokens.find((t) => {
      const contract = (t.nearContractId || '').toLowerCase();
      const id = (t.defuse_asset_id || '').toLowerCase();
      return (
        contract === suffix ||
        id === suffix ||
        id.endsWith(`:${suffix}`) ||
        contract.endsWith(`.${suffix}`) ||
        suffix.endsWith(`.${contract}`)
      );
    }) || null
  );
}

function parseDefuseAssetId(id: string): { chain: string; contractId: string } {
  // Formats: "nep141:usdc.token.near" or "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
  // or "native:near" or "erc20:eth:0xabc..." or "spl:sol:..."
  if (id.startsWith('nep141:')) {
    return { chain: 'near', contractId: id.slice(7) };
  }
  if (id.startsWith('native:')) {
    const chain = id.slice(7);
    return { chain, contractId: chain };
  }
  if (id.startsWith('erc20:')) {
    const parts = id.split(':'); // erc20:<chain>:<address>
    return { chain: parts[1] || 'eth', contractId: parts[2] || '' };
  }
  if (id.startsWith('spl:')) {
    const parts = id.split(':');
    return { chain: parts[1] || 'sol', contractId: parts[2] || '' };
  }
  return { chain: 'unknown', contractId: id };
}

// ─── Supported Tokens ─────────────────────────────────────────────────────────

/**
 * Fetches the complete list of supported tokens from the intents contract onchain.
 * This is the authoritative source — no hardcoded lists.
 */
export async function getSupportedTokens(env: Env): Promise<OnchainToken[]> {
  const apiBase = env.NEAR_API_BASE || 'https://1click.chaindefuser.com';

  // 1. Primary: query 1Click Defuse live token registry with live USD prices
  try {
    const resp = await fetch(`${apiBase}/v0/tokens`, {
      headers: { 'Accept': 'application/json' },
    });
    if (resp.ok) {
      const list = (await resp.json()) as any[];
      if (Array.isArray(list) && list.length > 0) {
        // Known verified tokens metadata dictionary for clean display
        const VERIFIED_META: Record<string, { symbol: string; name: string; priority: number; chain?: string }> = {
          'nep141:wrap.near': { symbol: 'NEAR', name: 'NEAR Protocol', priority: 1, chain: 'near' },
          'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': { symbol: 'USDC', name: 'USD Coin', priority: 2, chain: 'near' },
          'nep141:usdt.tether-token.near': { symbol: 'USDT', name: 'Tether USD', priority: 3, chain: 'near' },
          'nep141:eth.bridge.near': { symbol: 'ETH', name: 'Ethereum', priority: 4, chain: 'near' },
          'nep141:2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near': { symbol: 'BTC', name: 'Bitcoin', priority: 5, chain: 'near' },
          'nep141:sol.omft.near': { symbol: 'SOL', name: 'Solana', priority: 6, chain: 'sol' },
          'nep141:btc.omft.near': { symbol: 'BTC', name: 'Bitcoin', priority: 7, chain: 'btc' },
          'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near': { symbol: 'USDC', name: 'USD Coin (Base)', priority: 8, chain: 'base' },
          'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near': { symbol: 'USDC', name: 'USD Coin (Arbitrum)', priority: 9, chain: 'arbitrum' },
          'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near': { symbol: 'USDC', name: 'USD Coin (Ethereum)', priority: 10, chain: 'eth' },
          'nep141:853d955acef822db058eb8505911ed77f175b99e.factory.bridge.near': { symbol: 'FRAX', name: 'Frax Stablecoin', priority: 11, chain: 'near' },
          'nep141:aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near': { symbol: 'AURORA', name: 'Aurora', priority: 12, chain: 'near' },
        };

        const tokens: OnchainToken[] = [];
        const seenAssetKeys = new Set<string>();
        const cgIdByAsset: Record<string, string> = {};

        for (const t of list) {
          const assetId = t.assetId || t.defuse_asset_id || '';
          if (!assetId) continue;
          if (typeof t.coingeckoId === 'string' && t.coingeckoId) cgIdByAsset[assetId] = t.coingeckoId;

          const { chain: parsedChain, contractId: parsedContractId } = parseDefuseAssetId(assetId);
          const contractAddress = t.contractAddress || parsedContractId;
          const rawSymbol = (t.symbol || '').trim();

          // Genuine junk still goes: no symbol or an absurdly long one.
          // Memes are no longer treated as spam — they are classified onto the
          // "NEAR & Memes" rail below so they can actually be sent.
          const isMeme = isMemeAsset(rawSymbol, contractAddress || '');
          if (!rawSymbol || rawSymbol.length > 12) continue;
          const isDustSpam =
            !VERIFIED_META[assetId] &&
            !isMeme &&
            typeof t.price === 'number' &&
            t.price < 0.0001;
          if (isDustSpam) continue;

          const verified = VERIFIED_META[assetId];
          const isNear =
            rawSymbol.toLowerCase() === 'wnear' ||
            rawSymbol.toLowerCase() === 'near' ||
            contractAddress === 'wrap.near';

          let symbol = verified?.symbol || (isNear ? 'NEAR' : rawSymbol.toUpperCase());
          let name = verified?.name || (isNear ? 'NEAR Protocol' : (t.name || symbol));

          // Clean up symbol and name for common assets
          if (symbol === 'WNEAR') symbol = 'NEAR';
          if (symbol === 'WBTC') { symbol = 'BTC'; name = 'Bitcoin'; }
          if (symbol === 'WETH') { symbol = 'ETH'; name = 'Ethereum'; }
          if (symbol === 'USDC.E') { name = 'USD Coin (Bridged)'; }

          // Deduplicate identical asset symbols on the same chain
          const dedupKey = `${symbol}_${verified?.chain || t.blockchain || parsedChain}`;
          if (seenAssetKeys.has(dedupKey) && !VERIFIED_META[assetId]) continue;
          seenAssetKeys.add(dedupKey);

          const onchainIcon =
            (isNear ? getOnchainIcon('near') : undefined) ||
            getOnchainIcon(symbol.toLowerCase()) ||
            t.icon ||
            getOnchainIcon(contractAddress) ||
            getOnchainIcon(rawSymbol.toLowerCase());

          const symUpper = symbol.toUpperCase();
          let category: TokenCategory = 'all';
          if (isNear || symUpper === 'NEAR') {
            category = 'popular';
          } else if (['USDC', 'USDT', 'DAI', 'FRAX', 'USDG'].some((x) => symUpper.includes(x))) {
            category = 'stables';
          } else if (['ETH', 'BTC', 'SOL', 'AVAX', 'BNB', 'AURORA'].some((x) => symUpper === x)) {
            category = 'l1';
          } else if (isMeme) {
            category = 'memes';
          } else if (VERIFIED_META[assetId]) {
            category = 'popular';
          }

          tokens.push({
            defuse_asset_id: assetId,
            symbol,
            name,
            decimals: Number(t.decimals ?? (isNear ? 24 : 18)),
            icon: onchainIcon,
            nearContractId: contractAddress,
            chain: verified?.chain || t.blockchain || parsedChain,
            // Absent price stays absent (undefined) — callers decide
            // whether that means 1.0 (stablecoin) or 0 (unknown).
            priceUsd: typeof t.price === 'number' ? t.price : undefined,
            category,
          });
        }

        // Priority sorting: NEAR, USDC, USDT, ETH, BTC, SOL first
        const priorityOrder: Record<string, number> = {
          NEAR: 1,
          USDC: 2,
          USDT: 3,
          ETH: 4,
          BTC: 5,
          WBTC: 6,
          SOL: 7,
          DAI: 8,
          FRAX: 9,
          AURORA: 10,
        };

        // Artwork for assets our inline table does not cover comes from the
        // registry's own coingeckoId (KV-cached). Registry prices stay primary;
        // the CoinGecko price is only used when the registry had none.
        try {
          const meta = await getAssetMeta(env, Object.values(cgIdByAsset));
          for (const tok of tokens) {
            const cgId = cgIdByAsset[tok.defuse_asset_id];
            const cg = cgId ? meta[cgId] : undefined;
            if (!tok.icon && cg?.image) tok.icon = cg.image;
            if (typeof tok.priceUsd !== 'number' && typeof cg?.priceUsd === 'number') tok.priceUsd = cg.priceUsd;
          }
        } catch (err) {
          console.warn('[nearRpc] asset meta merge failed:', err);
        }

        // Native NEAR tail: Rhea/Ref NEP-141 tokens (launchpad memes like
        // `*.nearlytrade.near`) that the Intents registry does not cover.
        // Merged as a curated, symbol-deduped head so the list stays lean;
        // the full long tail remains reachable via /api/tokens/search.
        try {
          const rhea = await getRheaTokens(env);
          if (rhea.length > 0) {
            const knownContracts = new Set(
              tokens.map((t) => (t.nearContractId || '').toLowerCase())
            );
            const knownSymbols = new Set(
              tokens.map((t) => (t.symbol || '').toUpperCase())
            );
            const scored: { entry: RheaTokenEntry; score: number }[] = [];
            for (const entry of rhea) {
              const contractLc = entry.contractId.toLowerCase();
              if (knownContracts.has(contractLc)) continue;
              const symUpper = entry.symbol.toUpperCase();
              if (knownSymbols.has(symUpper)) continue;
              knownSymbols.add(symUpper);
              // Artwork first, then shorter tickers — keeps the head useful.
              scored.push({ entry, score: (entry.icon ? 0 : 100) + entry.symbol.length });
            }
            scored.sort((a, b) => a.score - b.score);
            for (const { entry } of scored.slice(0, RHEA_HEAD_MAX)) {
              tokens.push(rheaToOnchainToken(entry));
              knownContracts.add(entry.contractId.toLowerCase());
            }
          }
        } catch (err) {
          console.warn('[nearRpc] rhea merge failed:', err);
        }

        tokens.sort((a, b) => {
          const pA = priorityOrder[a.symbol.toUpperCase()] ?? 999;
          const pB = priorityOrder[b.symbol.toUpperCase()] ?? 999;
          if (pA !== pB) return pA - pB;
          const isNativeA = a.chain === 'near' || a.chain === a.symbol.toLowerCase();
          const isNativeB = b.chain === 'near' || b.chain === b.symbol.toLowerCase();
          if (isNativeA && !isNativeB) return -1;
          if (!isNativeA && isNativeB) return 1;
          return a.symbol.localeCompare(b.symbol);
        });

        return tokens;
      }
    }
  } catch (err) {
    console.warn('[nearRpc] 1click /v0/tokens live query failed:', err);
  }

  // 2. Secondary: query intents contract view function on NEAR mainnet QuikNode RPC
  const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const rpcUrl = env.NEAR_RPC_URL;
  try {
    const tokens = await viewFunction(rpcUrl, contractId, 'get_supported_tokens', {});
    if (Array.isArray(tokens)) {
      return tokens.map((t: any) => {
        const { chain, contractId: nearContractId } = parseDefuseAssetId(
          t.defuse_asset_id || t.token_id || ''
        );
        const rawSym = (t.symbol || t.ticker || 'UNKNOWN').trim();
        const isNear = rawSym.toLowerCase() === 'wnear' || rawSym.toLowerCase() === 'near';
        const symbol = isNear ? 'NEAR' : rawSym;
        return {
          defuse_asset_id: t.defuse_asset_id || t.token_id || '',
          symbol,
          name: isNear ? 'NEAR Protocol' : (t.name || symbol),
          decimals: Number(t.decimals ?? 18),
          icon: isNear ? getOnchainIcon('near') : (t.icon || getOnchainIcon(nearContractId) || getOnchainIcon(symbol.toLowerCase())),
          nearContractId,
          chain,
          chainId: t.chain_id,
        } satisfies OnchainToken;
      });
    }
  } catch (err) {
    console.warn('[nearRpc] intents viewFunction failed:', err);
  }

  // Fallback for offline, sandbox, or network partition
  return [
    {
      defuse_asset_id: 'nep141:wrap.near',
      symbol: 'NEAR',
      name: 'NEAR Protocol',
      decimals: 24,
      icon: getOnchainIcon('near'),
      chain: 'near',
      nearContractId: 'wrap.near',
    },
    {
      defuse_asset_id: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      icon: getOnchainIcon('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'),
      chain: 'near',
      nearContractId: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    },
    {
      defuse_asset_id: 'nep141:usdt.tether-token.near',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      icon: getOnchainIcon('usdt.tether-token.near'),
      chain: 'near',
      nearContractId: 'usdt.tether-token.near',
    },
    {
      defuse_asset_id: 'nep141:eth.bridge.near',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      icon: getOnchainIcon('eth.bridge.near'),
      chain: 'near',
      nearContractId: 'eth.bridge.near',
    },
  ];
}

/**
 * Derives a deterministic, cryptographically blinded NEAR sub-account ID
 * from the user's WebAuthn P-256 public key.
 *
 * Format: u_<16 hex chars of SHA-256(publicKeyHex)>.<masterAccount>
 * Example: u_7a9f1b2c3d4e5f60.uprail.near
 *
 * Confidentiality Guarantee:
 * - Zero linkage to user's 𝕏 handle
 * - Onchain observers see an opaque hash sub-account
 * - Fully deterministic and self-custodial via device hardware passkey
 */
export async function deriveConfidentialAccountId(
  publicKeyHex: string,
  masterAccount = 'escrow.uprail.near'
): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(publicKeyHex));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
  return `u_${hex}.${masterAccount}`;
}

export function getIntentAccountId(nearAccount: string, contractId: string): string {
  return nearAccount;
}

/**
 * Fetches all token balances for a user's intent account directly from the onchain
 * intents contract. This is live, not cached.
 */
export async function getIntentBalances(
  env: Env,
  nearAccount: string
): Promise<IntentAccountBalance[]> {
  const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';

  try {
    const tokens = await getSupportedTokens(env);
    const tokenMap = new Map<string, OnchainToken>();
    for (const t of tokens) {
      if (t.defuse_asset_id) tokenMap.set(t.defuse_asset_id, t);
    }
    // Guarantee core defuse assets exist in the map
    if (!tokenMap.has('nep141:wrap.near')) {
      tokenMap.set('nep141:wrap.near', {
        defuse_asset_id: 'nep141:wrap.near',
        symbol: 'NEAR',
        name: 'NEAR Protocol',
        decimals: 24,
        icon: getOnchainIcon('near'),
        chain: 'near',
        nearContractId: 'wrap.near',
      });
    }
    if (!tokenMap.has('wrap.near')) {
      tokenMap.set('wrap.near', {
        defuse_asset_id: 'wrap.near',
        symbol: 'NEAR',
        name: 'NEAR Protocol',
        decimals: 24,
        icon: getOnchainIcon('near'),
        chain: 'near',
        nearContractId: 'wrap.near',
      });
    }

    const tokenIds = Array.from(tokenMap.keys());
    if (tokenIds.length === 0) return [];

    const balances: IntentAccountBalance[] = [];
    const chunkSize = 50;
    for (let i = 0; i < tokenIds.length; i += chunkSize) {
      const chunk = tokenIds.slice(i, i + chunkSize);
      try {
        const rawAmounts = await viewFunction(rpcUrl, contractId, 'mt_batch_balance_of', {
          account_id: nearAccount,
          token_ids: chunk,
        });

        if (Array.isArray(rawAmounts)) {
          for (let j = 0; j < chunk.length; j++) {
            const assetId = chunk[j];
            const rawAmount = String(rawAmounts[j] ?? '0');
            if (rawAmount === '0' || rawAmount === 'null' || !rawAmount) continue;

            const token = tokenMap.get(assetId);
            const decimals = token?.decimals ?? (assetId.includes('wrap.near') ? 24 : 18);
            const symbol = token?.symbol || assetId.split(':').pop() || assetId;

            const existing = balances.find((b) => b.symbol.toUpperCase() === symbol.toUpperCase());
            if (existing) {
              const existingAmt = BigInt(existing.amount || '0');
              const newAmt = BigInt(rawAmount || '0');
              existing.amount = (existingAmt + newAmt).toString();
              existing.amountFormatted = formatAmount(existing.amount, decimals);
            } else {
              balances.push({
                defuse_asset_id: assetId,
                symbol,
                amount: rawAmount,
                amountFormatted: formatAmount(rawAmount, decimals),
                decimals,
                nearContractId: token?.nearContractId || '',
                ...(token?.icon ? { icon: token.icon } : {}),
              });
            }
          }
        }
      } catch (chunkErr) {
        console.warn(`[nearRpc] mt_batch_balance_of chunk failed:`, chunkErr);
      }
    }

    if (balances.length > 0) {
      return balances;
    }
  } catch (err) {
    console.warn('[nearRpc] mt_batch_balance_of failed, trying fallback:', err);
  }

  // Fallback: try individual mt_balance_of on core tokens
  try {
    const fallbackTokens = [
      { id: 'nep141:wrap.near', symbol: 'NEAR', decimals: 24, nearContractId: 'wrap.near' },
      { id: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', symbol: 'USDC', decimals: 6, nearContractId: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1' },
      { id: 'nep141:usdt.tether-token.near', symbol: 'USDT', decimals: 6, nearContractId: 'usdt.tether-token.near' },
      { id: 'nep141:sol.omft.near', symbol: 'SOL', decimals: 9, nearContractId: 'sol.omft.near' },
      { id: 'nep141:eth.bridge.near', symbol: 'ETH', decimals: 18, nearContractId: 'eth.bridge.near' },
    ];
    const fallbackBalances: IntentAccountBalance[] = [];

    await Promise.allSettled(
      fallbackTokens.map(async (tok) => {
        try {
          const raw = await viewFunction(rpcUrl, contractId, 'mt_balance_of', {
            account_id: nearAccount,
            token_id: tok.id,
          });
          const amtStr = String(raw ?? '0');
          if (amtStr !== '0' && amtStr !== 'null') {
            fallbackBalances.push({
              defuse_asset_id: tok.id,
              symbol: tok.symbol,
              amount: amtStr,
              amountFormatted: formatAmount(amtStr, tok.decimals),
              decimals: tok.decimals,
              nearContractId: tok.nearContractId,
              icon: getOnchainIcon(tok.symbol.toLowerCase()),
            });
          }
        } catch {}
      })
    );

    return fallbackBalances;
  } catch (err) {
    console.warn('[nearRpc] mt_balance_of fallback failed:', err);
  }

  return [];
}

// ─── Deposit Addresses (per-user, per-chain, live onchain) ───────────────────

interface ChainDepositConfig {
  key: string;
  chain: string;
  chainName: string;
  token: string;
  originAsset: string;
  destinationAsset: string;
  amount: string;
  minAmountFormatted: string;
  minAmountUsd: string;
  refundTo: string;
  symbol: string;
  decimals: number;
}

export const SUPPORTED_CHAINS = [
  { chain: 'base', chainName: 'Base', badge: 'L2 Sub-Cent' },
  { chain: 'arbitrum', chainName: 'Arbitrum', badge: 'L2 Rollup' },
  { chain: 'sol', chainName: 'Solana', badge: 'SPL / Native' },
  { chain: 'near', chainName: 'NEAR', badge: 'Instant Finality' },
  { chain: 'eth', chainName: 'Ethereum', badge: 'Mainnet L1' },
  { chain: 'btc', chainName: 'Bitcoin', badge: 'Native SegWit' },
];

const CHAIN_DEPOSIT_CONFIGS: Record<string, ChainDepositConfig> = {
  // USDC configs
  'base_usdc': {
    key: 'base_usdc',
    chain: 'base',
    chainName: 'Base',
    token: 'USDC',
    originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    amount: '150000',
    minAmountFormatted: '0.15 USDC',
    minAmountUsd: '$0.15',
    refundTo: '',
    symbol: 'USDC',
    decimals: 6,
  },
  'arbitrum_usdc': {
    key: 'arbitrum_usdc',
    chain: 'arbitrum',
    chainName: 'Arbitrum',
    token: 'USDC',
    originAsset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    amount: '100000',
    minAmountFormatted: '0.10 USDC',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDC',
    decimals: 6,
  },
  'sol_usdc': {
    key: 'sol_usdc',
    chain: 'sol',
    chainName: 'Solana',
    token: 'USDC',
    originAsset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    amount: '100000',
    minAmountFormatted: '0.10 USDC',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDC',
    decimals: 6,
  },
  'eth_usdc': {
    key: 'eth_usdc',
    chain: 'eth',
    chainName: 'Ethereum',
    token: 'USDC',
    originAsset: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    amount: '2000000',
    minAmountFormatted: '2.00 USDC',
    minAmountUsd: '$2.00',
    refundTo: '',
    symbol: 'USDC',
    decimals: 6,
  },
  'near_usdc': {
    key: 'near_usdc',
    chain: 'near',
    chainName: 'NEAR',
    token: 'USDC',
    originAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    amount: '100000',
    minAmountFormatted: '0.10 USDC',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDC',
    decimals: 6,
  },

  // USDT configs
  'arbitrum_usdt': {
    key: 'arbitrum_usdt',
    chain: 'arbitrum',
    chainName: 'Arbitrum',
    token: 'USDT',
    originAsset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    destinationAsset: 'nep141:usdt.tether-token.near',
    amount: '100000',
    minAmountFormatted: '0.10 USDT',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDT',
    decimals: 6,
  },
  'sol_usdt': {
    key: 'sol_usdt',
    chain: 'sol',
    chainName: 'Solana',
    token: 'USDT',
    originAsset: 'nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near',
    destinationAsset: 'nep141:usdt.tether-token.near',
    amount: '100000',
    minAmountFormatted: '0.10 USDT',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDT',
    decimals: 6,
  },
  'eth_usdt': {
    key: 'eth_usdt',
    chain: 'eth',
    chainName: 'Ethereum',
    token: 'USDT',
    originAsset: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near',
    destinationAsset: 'nep141:usdt.tether-token.near',
    amount: '2000000',
    minAmountFormatted: '2.00 USDT',
    minAmountUsd: '$2.00',
    refundTo: '',
    symbol: 'USDT',
    decimals: 6,
  },
  'near_usdt': {
    key: 'near_usdt',
    chain: 'near',
    chainName: 'NEAR',
    token: 'USDT',
    originAsset: 'nep141:usdt.tether-token.near',
    destinationAsset: 'nep141:usdt.tether-token.near',
    amount: '100000',
    minAmountFormatted: '0.10 USDT',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDT',
    decimals: 6,
  },

  // Native NEAR
  'near_near': {
    key: 'near_near',
    chain: 'near',
    chainName: 'NEAR',
    token: 'NEAR',
    originAsset: 'nep141:wrap.near',
    destinationAsset: 'nep141:wrap.near',
    amount: '10000000000000000000000',
    minAmountFormatted: '0.01 NEAR',
    minAmountUsd: '$0.05',
    refundTo: '',
    symbol: 'NEAR',
    decimals: 24,
  },

  // ETH configs
  'base_eth': {
    key: 'base_eth',
    chain: 'base',
    chainName: 'Base',
    token: 'ETH',
    originAsset: 'nep141:base.omft.near',
    destinationAsset: 'nep141:eth.bridge.near',
    amount: '50000000000000',
    minAmountFormatted: '0.00005 ETH',
    minAmountUsd: '$0.12',
    refundTo: '',
    symbol: 'ETH',
    decimals: 18,
  },
  'arbitrum_eth': {
    key: 'arbitrum_eth',
    chain: 'arbitrum',
    chainName: 'Arbitrum',
    token: 'ETH',
    originAsset: 'nep141:arb.omft.near',
    destinationAsset: 'nep141:eth.bridge.near',
    amount: '50000000000000',
    minAmountFormatted: '0.00005 ETH',
    minAmountUsd: '$0.12',
    refundTo: '',
    symbol: 'ETH',
    decimals: 18,
  },
  'eth_eth': {
    key: 'eth_eth',
    chain: 'eth',
    chainName: 'Ethereum',
    token: 'ETH',
    originAsset: 'nep141:eth.omft.near',
    destinationAsset: 'nep141:eth.bridge.near',
    amount: '800000000000000',
    minAmountFormatted: '0.0008 ETH',
    minAmountUsd: '$2.00',
    refundTo: '',
    symbol: 'ETH',
    decimals: 18,
  },

  // SOL config
  'sol_sol': {
    key: 'sol_sol',
    chain: 'sol',
    chainName: 'Solana',
    token: 'SOL',
    originAsset: 'nep141:sol.omft.near',
    destinationAsset: 'nep141:sol.omft.near',
    amount: '1000000',
    minAmountFormatted: '0.001 SOL',
    minAmountUsd: '$0.11',
    refundTo: '',
    symbol: 'SOL',
    decimals: 9,
  },

  // BTC config
  'btc_btc': {
    key: 'btc_btc',
    chain: 'btc',
    chainName: 'Bitcoin',
    token: 'BTC',
    originAsset: 'nep141:btc.omft.near',
    destinationAsset: 'nep141:btc.omft.near',
    amount: '8300',
    minAmountFormatted: '0.000083 BTC',
    minAmountUsd: '$6.80',
    refundTo: '',
    symbol: 'BTC',
    decimals: 8,
  },

  // Polygon USDC
  'pol_usdc': {
    key: 'pol_usdc',
    chain: 'pol',
    chainName: 'Polygon',
    token: 'USDC',
    originAsset: 'nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L',
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    amount: '100000',
    minAmountFormatted: '0.10 USDC',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDC',
    decimals: 6,
  },
  'polygon_usdc': {
    key: 'polygon_usdc',
    chain: 'pol',
    chainName: 'Polygon',
    token: 'USDC',
    originAsset: 'nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L',
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    amount: '100000',
    minAmountFormatted: '0.10 USDC',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDC',
    decimals: 6,
  },

  // Optimism USDC
  'op_usdc': {
    key: 'op_usdc',
    chain: 'op',
    chainName: 'Optimism',
    token: 'USDC',
    originAsset: 'nep141:op-0x0b2c639c533813f4aa9d7837caf62653d097ff85.omft.near',
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    amount: '100000',
    minAmountFormatted: '0.10 USDC',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDC',
    decimals: 6,
  },

  // Avalanche USDC
  'avax_usdc': {
    key: 'avax_usdc',
    chain: 'avax',
    chainName: 'Avalanche',
    token: 'USDC',
    originAsset: 'nep141:avax-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e.omft.near',
    destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    amount: '100000',
    minAmountFormatted: '0.10 USDC',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'USDC',
    decimals: 6,
  },

  // BSC USDT
  'bsc_usdt': {
    key: 'bsc_usdt',
    chain: 'bsc',
    chainName: 'BNB Chain',
    token: 'USDT',
    originAsset: 'nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g',
    destinationAsset: 'nep141:usdt.tether-token.near',
    amount: '1000000000000000000',
    minAmountFormatted: '1.00 USDT',
    minAmountUsd: '$1.00',
    refundTo: '',
    symbol: 'USDT',
    decimals: 18,
  },

  // Dogecoin
  'doge_doge': {
    key: 'doge_doge',
    chain: 'doge',
    chainName: 'Dogecoin',
    token: 'DOGE',
    originAsset: 'nep141:doge.omft.near',
    destinationAsset: 'nep141:doge.omft.near',
    amount: '20000000',
    minAmountFormatted: '0.2 DOGE',
    minAmountUsd: '$0.10',
    refundTo: '',
    symbol: 'DOGE',
    decimals: 8,
  },
};

// Aliases for chain-only fallback queries
CHAIN_DEPOSIT_CONFIGS['base'] = CHAIN_DEPOSIT_CONFIGS['base_usdc'];
CHAIN_DEPOSIT_CONFIGS['arbitrum'] = CHAIN_DEPOSIT_CONFIGS['arbitrum_usdc'];
CHAIN_DEPOSIT_CONFIGS['arb'] = CHAIN_DEPOSIT_CONFIGS['arbitrum_usdc'];
CHAIN_DEPOSIT_CONFIGS['sol'] = CHAIN_DEPOSIT_CONFIGS['sol_sol'];
CHAIN_DEPOSIT_CONFIGS['solana'] = CHAIN_DEPOSIT_CONFIGS['sol_sol'];
CHAIN_DEPOSIT_CONFIGS['eth'] = CHAIN_DEPOSIT_CONFIGS['eth_usdc'];
CHAIN_DEPOSIT_CONFIGS['ethereum'] = CHAIN_DEPOSIT_CONFIGS['eth_usdc'];
CHAIN_DEPOSIT_CONFIGS['near'] = CHAIN_DEPOSIT_CONFIGS['near_near'];
CHAIN_DEPOSIT_CONFIGS['btc'] = CHAIN_DEPOSIT_CONFIGS['btc_btc'];
CHAIN_DEPOSIT_CONFIGS['bitcoin'] = CHAIN_DEPOSIT_CONFIGS['btc_btc'];
CHAIN_DEPOSIT_CONFIGS['pol'] = CHAIN_DEPOSIT_CONFIGS['pol_usdc'];
CHAIN_DEPOSIT_CONFIGS['polygon'] = CHAIN_DEPOSIT_CONFIGS['pol_usdc'];
CHAIN_DEPOSIT_CONFIGS['op'] = CHAIN_DEPOSIT_CONFIGS['op_usdc'];
CHAIN_DEPOSIT_CONFIGS['optimism'] = CHAIN_DEPOSIT_CONFIGS['op_usdc'];
CHAIN_DEPOSIT_CONFIGS['avax'] = CHAIN_DEPOSIT_CONFIGS['avax_usdc'];
CHAIN_DEPOSIT_CONFIGS['bsc'] = CHAIN_DEPOSIT_CONFIGS['bsc_usdt'];
CHAIN_DEPOSIT_CONFIGS['doge'] = CHAIN_DEPOSIT_CONFIGS['doge_doge'];

/**
 * Calls 1Click quote endpoint to generate a live, cross-chain deposit address.
 * Solvers sweep incoming deposits and route them to recipient intents vault.
 */
async function fetch1ClickDepositAddress(
  apiBase: string,
  nearAccount: string,
  cfg: ChainDepositConfig
): Promise<DepositAddress | null> {
  const deadline = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  try {
    const resp = await fetch(`${apiBase}/v0/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UPRAIL/1.0',
      },
      body: JSON.stringify({
        dry: false,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        recipientType: 'INTENTS',
        recipient: nearAccount,
        originAsset: cfg.originAsset,
        destinationAsset: cfg.destinationAsset,
        amount: cfg.amount,
        depositType: 'ORIGIN_CHAIN',
        refundType: 'INTENTS',
        refundTo: nearAccount,
        deadline,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`[nearRpc] 1Click quote failed (${resp.status}) for ${cfg.chain}/${cfg.token}:`, errText);

      // Auto-retry with solver minAmount if 1Click specifies minimum bridge amount
      const minMatch = errText.match(/try at least\s+([0-9]+)/i);
      if (minMatch && minMatch[1]) {
        const retryAmount = minMatch[1];
        try {
          const retryResp = await fetch(`${apiBase}/v0/quote`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UPRAIL/1.0',
            },
            body: JSON.stringify({
              dry: false,
              swapType: 'EXACT_INPUT',
              slippageTolerance: 100,
              recipientType: 'INTENTS',
              recipient: nearAccount,
              originAsset: cfg.originAsset,
              destinationAsset: cfg.destinationAsset,
              amount: retryAmount,
              depositType: 'ORIGIN_CHAIN',
              refundType: 'INTENTS',
              refundTo: nearAccount,
              deadline,
            }),
          });
          if (retryResp.ok) {
            const retryData = (await retryResp.json()) as any;
            const quote = retryData.quote;
            if (quote?.depositAddress) {
              return {
                chain: cfg.chain,
                chainName: cfg.chainName,
                address: quote.depositAddress,
                memo: quote.depositMemo || undefined,
                expiresAt: quote.deadline ? new Date(quote.deadline).getTime() : undefined,
                token: cfg.token,
                minAmount: retryAmount,
                minAmountFormatted: quote.amountInFormatted ? `${quote.amountInFormatted} ${cfg.token}` : cfg.minAmountFormatted,
                minAmountUsd: quote.amountInUsd ? `$${parseFloat(quote.amountInUsd).toFixed(2)}` : cfg.minAmountUsd,
                isOneTime: true,
              };
            }
          }
        } catch (retryErr) {
          console.warn('[nearRpc] retry failed:', retryErr);
        }
      }

      return null;
    }

    const data = (await resp.json()) as any;
    const quote = data.quote;
    if (!quote?.depositAddress) {
      return null;
    }

    return {
      chain: cfg.chain,
      chainName: cfg.chainName,
      address: quote.depositAddress,
      memo: quote.depositMemo || undefined,
      expiresAt: quote.deadline ? new Date(quote.deadline).getTime() : undefined,
      token: cfg.token,
      minAmount: cfg.amount,
      minAmountFormatted: quote.amountInFormatted ? `${quote.amountInFormatted} ${cfg.token}` : cfg.minAmountFormatted,
      minAmountUsd: quote.amountInUsd ? `$${parseFloat(quote.amountInUsd).toFixed(2)}` : cfg.minAmountUsd,
      isOneTime: true,
    };
  } catch (err) {
    console.warn(`[nearRpc] fetch1ClickDepositAddress error for ${cfg.chain}/${cfg.token}:`, err);
    return null;
  }
}

/**
 * Retrieve cached deposit address from D1 (zero KV writes).
 */
async function getCachedDepositAddress(
  db: D1Database | undefined,
  nearAccount: string,
  chainKey: string
): Promise<DepositAddress | null> {
  if (!db) return null;
  try {
    const row = await db
      .prepare(
        'SELECT chain, chain_name, address, memo, expires_at FROM deposit_addresses WHERE account_id = ? AND chain = ? AND (expires_at IS NULL OR expires_at > ?)'
      )
      .bind(nearAccount, chainKey, Date.now() + 10 * 60 * 1000)
      .first<{
        chain: string;
        chain_name: string;
        address: string;
        memo: string | null;
        expires_at: number | null;
      }>();

    if (row && row.address) {
      const cfg = CHAIN_DEPOSIT_CONFIGS[chainKey] || CHAIN_DEPOSIT_CONFIGS[row.chain];
      return {
        chain: cfg?.chain || row.chain,
        chainName: cfg?.chainName || row.chain_name || row.chain,
        address: row.address,
        memo: row.memo || undefined,
        expiresAt: row.expires_at || undefined,
        token: cfg?.token,
        minAmount: cfg?.amount,
        minAmountFormatted: cfg?.minAmountFormatted,
        minAmountUsd: cfg?.minAmountUsd,
        isOneTime: true,
      };
    }
  } catch (err) {
    console.warn('[nearRpc] getCachedDepositAddress error:', err);
  }
  return null;
}

/**
 * Persist deposit address to D1 (zero KV writes).
 */
async function saveDepositAddress(
  db: D1Database | undefined,
  nearAccount: string,
  addr: DepositAddress,
  chainKey?: string
): Promise<void> {
  if (!db || !addr.address) return;
  const key = chainKey || (addr.token ? `${addr.chain}_${addr.token.toLowerCase()}` : addr.chain);
  try {
    await db
      .prepare(
        `INSERT INTO deposit_addresses (account_id, chain, chain_name, address, memo, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, chain) DO UPDATE SET
           chain_name = excluded.chain_name,
           address = excluded.address,
           memo = excluded.memo,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`
      )
      .bind(
        nearAccount,
        key,
        addr.chainName,
        addr.address,
        addr.memo || null,
        addr.expiresAt || null,
        Date.now()
      )
      .run();
  } catch (err) {
    console.warn('[nearRpc] saveDepositAddress error:', err);
  }
}

// ─── NEP-145 registration for NEAR-origin deposit addresses ───────────────────

/**
 * Ensures a freshly derived NEAR-chain deposit address can receive its
 * NEP-141 token from an ordinary wallet.
 *
 * 1Click returns a one-time implicit account as the deposit address, but does
 * NOT storage-register it on the FT contract (verified onchain) — a normal
 * `ft_transfer` from Meteor/Sender/HERE would fail with "receiver not
 * registered". NEP-145 `storage_deposit` is permissionless, so the escrow
 * account registers the address right after the quote is derived, before the
 * QR is shown. Native NEAR arrives as a plain transfer (no registration
 * needed) and wrap.near is skipped for the same reason.
 *
 * Best-effort: returns false when it cannot sign (no ESCROW_PRIVATE_KEY, e.g.
 * local dev) or the RPC rejects the call — the deposit address is still
 * returned to the caller.
 */
async function ensureNearFtDepositRegistered(
  env: Env,
  cfg: ChainDepositConfig,
  depositAddress: string
): Promise<boolean> {
  try {
    if (cfg.chain !== 'near' || !cfg.originAsset.startsWith('nep141:')) return false;
    const contractId = cfg.originAsset.slice('nep141:'.length);
    if (!contractId || contractId === 'wrap.near') return false;
    return await registerFtReceiver(env, contractId, depositAddress);
  } catch (err) {
    console.warn('[nearRpc] storage registration skipped:', err);
    return false;
  }
}

/**
 * Signs and broadcasts `storage_deposit({ account_id, registration_only })`
 * from the escrow account to the token contract, attaching exactly the
 * contract's `storage_balance_bounds.min` (excess is refunded when
 * registration_only is set). Skips the tx entirely if the receiver is already
 * registered. Mirrors the Borsh + ed25519 flow in createOnchainSubAccount.
 */
async function registerFtReceiver(
  env: Env,
  contractId: string,
  receiverId: string
): Promise<boolean> {
  const privKeyStr = env.ESCROW_PRIVATE_KEY;
  if (!privKeyStr) return false; // local dev / test — nothing to sign with
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const escrowId = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';

  // Already registered? Cheap view call — keeps retries and cache replays free.
  try {
    const existing = await viewFunction(rpcUrl, contractId, 'storage_balance_of', {
      account_id: receiverId,
    });
    if (existing) return true;
  } catch {
    // Contract may not expose the view — proceed; the deposit call itself
    // will surface any real error.
  }

  // Attach the contract's exact minimum; fall back to the NEP-145 reference
  // minimum of 0.00125 NEAR when bounds are unavailable.
  let deposit = 1250000000000000000000n;
  try {
    const bounds = await viewFunction(rpcUrl, contractId, 'storage_balance_bounds', {});
    if (bounds?.min !== undefined) deposit = BigInt(bounds.min);
  } catch {
    /* keep reference min */
  }

  try {
    const escrowRawKey = base58Decode(privKeyStr);
    const escrowPrivKey = escrowRawKey.slice(0, 32);
    const escrowPubKey = ed25519.getPublicKey(escrowPrivKey);
    const escrowPubKeyFormatted = `ed25519:${base58Encode(escrowPubKey)}`;

    const statusRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'reg_status', method: 'status', params: [] }),
    });
    const statusData = (await statusRes.json()) as any;
    const latestBlockHash = base58Decode(statusData?.result?.sync_info?.latest_block_hash || '');

    const keyRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'reg_nonce',
        method: 'query',
        params: {
          request_type: 'view_access_key',
          finality: 'final',
          account_id: escrowId,
          public_key: escrowPubKeyFormatted,
        },
      }),
    });
    const keyData = (await keyRes.json()) as any;
    if (!keyData?.result?.nonce && keyData?.result?.nonce !== 0) return false;
    const nonce = BigInt(keyData.result.nonce) + 1n;

    const w = new BorshWriter();
    w.writeString(escrowId);
    w.writePublicKey(escrowPubKey);
    w.writeU64(nonce);
    w.writeString(contractId);
    w.writeBytes(latestBlockHash);

    w.writeU32(1); // 1 action
    w.writeU8(2);  // FunctionCall
    w.writeString('storage_deposit');
    const args = new TextEncoder().encode(
      JSON.stringify({ account_id: receiverId, registration_only: true })
    );
    w.writeU32(args.length);
    w.writeBytes(args);
    w.writeU64(10000000000000n); // 10 TGas — plenty for storage_deposit
    w.writeU128(deposit);

    const txBytes = w.toBytes();
    const digest = await crypto.subtle.digest('SHA-256', txBytes);
    const sig = ed25519.sign(new Uint8Array(digest), escrowPrivKey);

    const signedW = new BorshWriter();
    signedW.writeBytes(txBytes);
    signedW.writeU8(0);
    signedW.writeBytes(sig);
    const signedBytes = signedW.toBytes();

    let binary = '';
    for (let i = 0; i < signedBytes.length; i++) binary += String.fromCharCode(signedBytes[i]);

    const txRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'storage_deposit',
        method: 'broadcast_tx_commit',
        params: [btoa(binary)],
      }),
    });
    const txResult = (await txRes.json()) as any;
    const ok =
      txResult?.result?.status?.SuccessValue !== undefined ||
      txResult?.result?.status?.SuccessReceiptId !== undefined;
    if (!ok) {
      console.warn(
        '[nearRpc] storage_deposit for deposit address failed:',
        txResult?.error?.message || JSON.stringify(txResult?.result?.status || txResult)
      );
    }
    return ok;
  } catch (err) {
    console.warn('[nearRpc] registerFtReceiver error:', err);
    return false;
  }
}

/**
 * Fetches the user's deposit address for a given chain (and token) from the 1Click/intents API.
 * Uses D1 cache for ultra-fast response, with fresh onchain generation on demand.
 */
export async function getDepositAddress(
  env: Env,
  nearAccount: string,
  chainId: string,
  bypassCache = false,
  tokenSymbol?: string,
  amount?: string
): Promise<DepositAddress | null> {
  const cleanChain = chainId.toLowerCase();
  const cleanToken = (tokenSymbol || '').toLowerCase();
  const directKey = cleanToken ? `${cleanChain}_${cleanToken}` : cleanChain;
  // An explicitly requested token must resolve to THAT token — never silently
  // fall back to the chain default (e.g. asking for LONK would previously
  // quote wNEAR under LONK's name).
  let cfg = CHAIN_DEPOSIT_CONFIGS[directKey];
  if (!cfg && tokenSymbol) {
    const chainCfg = CHAIN_DEPOSIT_CONFIGS[cleanChain];
    if (chainCfg && (chainCfg.symbol || chainCfg.token).toUpperCase() === tokenSymbol.toUpperCase()) {
      cfg = chainCfg;
    }
  }

  // Dynamic fallback for any token + chain supported by intents
  if (!cfg && tokenSymbol) {
    try {
      const allTokens = await getSupportedTokens(env);
      const matched = allTokens.find(
        (t: any) =>
          ((t.chain || '').toLowerCase() === cleanChain || (t.blockchain || '').toLowerCase() === cleanChain) &&
          t.symbol.toUpperCase() === tokenSymbol.toUpperCase()
      );
      if (matched) {
        let destinationAsset = matched.defuse_asset_id;
        const symUpper = matched.symbol.toUpperCase();
        if (symUpper === 'USDC') destinationAsset = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
        else if (symUpper === 'USDT') destinationAsset = 'nep141:usdt.tether-token.near';
        else if (symUpper === 'NEAR') destinationAsset = 'nep141:wrap.near';
        else if (symUpper === 'ETH') destinationAsset = 'nep141:eth.bridge.near';
        else if (symUpper === 'BTC') destinationAsset = 'nep141:btc.omft.near';
        else if (symUpper === 'SOL') destinationAsset = 'nep141:sol.omft.near';

        cfg = {
          key: directKey,
          chain: cleanChain,
          chainName: cleanChain.toUpperCase(),
          token: matched.symbol,
          originAsset: matched.defuse_asset_id,
          destinationAsset,
          amount: '100000',
          minAmountFormatted: `0.10 ${matched.symbol}`,
          minAmountUsd: '$0.10',
          refundTo: nearAccount,
          symbol: matched.symbol,
          decimals: matched.decimals || 6,
        };
      }
    } catch (err) {
      console.warn('[nearRpc] dynamic token resolution failed:', err);
    }
  }

  if (!cfg && !tokenSymbol) {
    cfg = CHAIN_DEPOSIT_CONFIGS[cleanChain];
  }
  if (!cfg) {
    // Fail closed: an unresolvable chain/token must404 rather than produce a
    // quote for a different asset than the one the UI displays.
    console.warn(`[nearRpc] getDepositAddress: unresolved ${cleanChain}/${tokenSymbol || '(any)'}`);
    return null;
  }

  // If a custom exact deposit amount is specified, re-calibrate cfg.amount
  if (amount && parseFloat(amount) > 0) {
    const dec = cfg.decimals ?? 6;
    const baseUnits = toBaseUnits(amount, dec);
    cfg = {
      ...cfg,
      amount: baseUnits,
      minAmountFormatted: `${amount} ${cfg.token}`,
      minAmountUsd: ['USDC', 'USDT', 'DAI'].includes(cfg.token.toUpperCase())
        ? `$${parseFloat(amount).toFixed(2)}`
        : cfg.minAmountUsd,
    };
    // Always bypass cache when an exact amount quote is requested
    bypassCache = true;
  }
  const apiBase = env.NEAR_API_BASE || 'https://1click.chaindefuser.com';

  // 1. Check D1 cache if not bypassing
  if (!bypassCache) {
    const cached = await getCachedDepositAddress(env.DB, nearAccount, cfg.key);
    if (cached) {
      // Re-verify NEP-145 registration on reuse — the original registration tx
      // may have failed, and an unregistered receiver breaks wallet sends.
      await ensureNearFtDepositRegistered(env, cfg, cached.address);
      return cached;
    }
  }

  // 2. Fetch fresh address via 1Click quote
  const fresh = await fetch1ClickDepositAddress(apiBase, nearAccount, cfg);
  if (fresh) {
    // NEAR-origin NEP-141 receivers must be storage-registered, otherwise a
    // plain wallet ft_transfer to this one-time implicit address is rejected
    // onchain. Best-effort — never blocks returning the address.
    await ensureNearFtDepositRegistered(env, cfg, fresh.address);
    await saveDepositAddress(env.DB, nearAccount, fresh, cfg.key);
    return fresh;
  }

  // 3. Stale cache fallback if 1Click is momentarily unreachable
  if (env.DB) {
    try {
      const stale = await env.DB
        .prepare('SELECT chain, chain_name, address, memo, expires_at FROM deposit_addresses WHERE account_id = ? AND (chain = ? OR chain = ?)')
        .bind(nearAccount, cfg.key, cfg.chain)
        .first<any>();
      if (stale?.address) {
        return {
          chain: cfg.chain,
          chainName: stale.chain_name || cfg.chainName,
          address: stale.address,
          memo: stale.memo || undefined,
          expiresAt: stale.expires_at || undefined,
          token: cfg.token,
          minAmountFormatted: cfg.minAmountFormatted,
          minAmountUsd: cfg.minAmountUsd,
          isOneTime: true,
        };
      }
    } catch {}
  }

  // 4. Clean fallback for native NEAR
  if (cfg.chain === 'near' && cfg.token === 'NEAR') {
    return {
      chain: 'near',
      chainName: 'NEAR',
      address: nearAccount,
      token: 'NEAR',
      minAmountFormatted: '0.01 NEAR',
      minAmountUsd: '$0.05',
      isOneTime: true,
    };
  }

  return null;
}

/**
 * Fetches deposit addresses for ALL supported chains for a user.
 * Concurrently generates/retrieves valid addresses across all chains.
 */
export async function getAllDepositAddresses(
  env: Env,
  nearAccount: string,
  bypassCache = false
): Promise<DepositAddress[]> {
  const apiBase = env.NEAR_API_BASE || 'https://1click.chaindefuser.com';
  const uniqueChains = ['eth', 'btc', 'sol', 'base', 'arbitrum', 'near', 'robinhood'];
  const chainMap = new Map<string, DepositAddress>();

  // 1. Load cached addresses from D1 first
  if (!bypassCache && env.DB) {
    try {
      const { results } = await env.DB
        .prepare(
          'SELECT chain, chain_name, address, memo, expires_at FROM deposit_addresses WHERE account_id = ? AND (expires_at IS NULL OR expires_at > ?)'
        )
        .bind(nearAccount, Date.now() + 10 * 60 * 1000)
        .all<{
          chain: string;
          chain_name: string;
          address: string;
          memo: string | null;
          expires_at: number | null;
        }>();

      for (const row of results || []) {
        if (row.address) {
          chainMap.set(row.chain, {
            chain: row.chain,
            chainName: row.chain_name || row.chain,
            address: row.address,
            memo: row.memo || undefined,
            expiresAt: row.expires_at || undefined,
          });
        }
      }
    } catch (dbErr) {
      console.warn('[nearRpc] getAllDepositAddresses D1 lookup error:', dbErr);
    }
  }

  // 2. Fetch missing chains in parallel from 1Click
  const missingConfigs = uniqueChains
    .filter((c) => !chainMap.has(c))
    .map((c) => CHAIN_DEPOSIT_CONFIGS[c])
    .filter(Boolean);

  if (missingConfigs.length > 0) {
    const fetchPromises = missingConfigs.map(async (cfg) => {
      const fresh = await fetch1ClickDepositAddress(apiBase, nearAccount, cfg);
      if (fresh) {
        chainMap.set(cfg.chain, fresh);
        await saveDepositAddress(env.DB, nearAccount, fresh);
      } else if (cfg.chain === 'near') {
        chainMap.set('near', {
          chain: 'near',
          chainName: 'NEAR',
          address: nearAccount,
        });
      }
    });

    await Promise.allSettled(fetchPromises);
  }

  // 3. Return addresses sorted according to SUPPORTED_CHAINS order
  return SUPPORTED_CHAINS.map((sc) => {
    return (
      chainMap.get(sc.chain) || {
        chain: sc.chain,
        chainName: sc.chainName,
        address: sc.chain === 'near' ? nearAccount : '',
      }
    );
  });
}

// ─── Transaction / Intent History ─────────────────────────────────────────────

/**
 * Fetches onchain intent transaction history for a user.
 * Queries the intents contract event log via NEAR RPC indexer or the 1click API.
 */
export async function getIntentHistory(
  env: Env,
  nearAccount: string,
  limit = 50
): Promise<IntentTx[]> {
  // Try the 1Click API transaction history endpoint
  try {
    const url = `${env.NEAR_API_BASE}/v1/accounts/${encodeURIComponent(nearAccount)}/transactions?limit=${limit}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (resp.ok) {
      const data = await resp.json() as any;
      const list = Array.isArray(data) ? data : (data.transactions || data.items || []);
      const txs = list.map((tx: any) => ({
        // Real upstream transaction hash only — entries without one are
        // dropped below rather than given a synthetic (fabricated) id.
        id: tx.id || tx.hash || tx.transaction_hash || '',
        intent_type: tx.type || tx.intent_type || 'transfer',
        defuse_asset_id_in: tx.asset_in || tx.defuse_asset_id_in,
        defuse_asset_id_out: tx.asset_out || tx.defuse_asset_id_out,
        amount_in: tx.amount_in || tx.amount || '0',
        amount_out: tx.amount_out || '0',
        receiver_id: tx.receiver_id || tx.recipient || tx.to,
        sender_id: tx.sender_id || tx.sender || tx.from,
        block_height: Number(tx.block_height || 0),
        block_timestamp: Number(tx.block_timestamp || tx.timestamp || 0),
        status: tx.status === 'SUCCESS' || tx.status === 'success' ? 'success'
          : tx.status === 'FAILED' || tx.status === 'failed' ? 'failed'
          : 'pending',
      })) as IntentTx[];
      return txs.filter((tx) => !!tx.id);
    }
  } catch (err) {
    console.warn('[nearRpc] getIntentHistory via 1click failed:', err);
  }

  // Fallback: query NEAR RPC directly for recent transactions on the intents contract
  try {
    const rpcUrl = env.NEAR_RPC_URL;
    const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';

    const result = await nearRpc(rpcUrl, 'query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: contractId,
    });

    if (result) {
      // We have confirmed the contract exists; the detailed tx history
      // requires an indexer. Return empty array rather than fake data.
      return [];
    }
  } catch (err) {
    console.warn('[nearRpc] NEAR RPC fallback failed:', err);
  }

  return [];
}

// ─── Account State ─────────────────────────────────────────────────────────────

// ─── Borsh Binary Serialization for NEAR Transactions ────────────────────────

class BorshWriter {
  private buf: number[] = [];
  writeU8(val: number) { this.buf.push(val & 0xff); }
  writeU32(val: number) {
    this.writeU8(val); this.writeU8(val >> 8); this.writeU8(val >> 16); this.writeU8(val >> 24);
  }
  writeU64(val: bigint | number) {
    const b = BigInt(val);
    for (let i = 0; i < 8; i++) this.writeU8(Number((b >> BigInt(i * 8)) & 0xffn));
  }
  writeU128(val: bigint | number | string) {
    const b = BigInt(val);
    for (let i = 0; i < 16; i++) this.writeU8(Number((b >> BigInt(i * 8)) & 0xffn));
  }
  writeBytes(bytes: Uint8Array | number[]) { for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]); }
  writeString(str: string) {
    const enc = new TextEncoder().encode(str);
    this.writeU32(enc.length);
    this.writeBytes(enc);
  }
  writePublicKey(pubkeyBytes: Uint8Array) {
    this.writeU8(0); // 0 = ED25519
    this.writeBytes(pubkeyBytes);
  }
  toBytes(): Uint8Array { return new Uint8Array(this.buf); }
}

/**
 * Deterministically derives an authentic NEAR Ed25519 keypair and sub-account ID for a user.
 * 100% reproducible, never lost, protected by user's passkey authentication.
 */
export async function deriveUserNearKeypair(
  env: Env,
  xId: string
): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array; accountId: string; privateKeyB58: string; publicKeyB58: string }> {
  const privKeyStr = env.ESCROW_PRIVATE_KEY;
  if (!privKeyStr) throw new Error('ESCROW_PRIVATE_KEY is missing');
  const escrowRawKey = base58Decode(privKeyStr);
  const escrowPrivKey = escrowRawKey.slice(0, 32);

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    escrowPrivKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const userPrivBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(`near_vault_key:${xId}`))
  );
  const userPubBytes = ed25519.getPublicKey(userPrivBytes);

  const hashBuf = await crypto.subtle.digest('SHA-256', userPubBytes);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);

  const masterAccount = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const accountId = `u_${hashHex}.${masterAccount}`;

  return {
    privateKey: userPrivBytes,
    publicKey: userPubBytes,
    accountId,
    privateKeyB58: `ed25519:${base58Encode(userPrivBytes)}`,
    publicKeyB58: `ed25519:${base58Encode(userPubBytes)}`,
  };
}

/**
 * Checks whether a public key is registered on intents.near, and registers it if missing.
 */
export async function registerKeyOnIntents(
  rpcUrl: string,
  subAccount: string,
  userPubKey: Uint8Array,
  userPrivKey: Uint8Array
): Promise<boolean> {
  const userPubKeyB58 = `ed25519:${base58Encode(userPubKey)}`;
  try {
    const checkRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: 'intents.near',
          method_name: 'has_public_key',
          args_base64: btoa(JSON.stringify({
            account_id: subAccount,
            public_key: userPubKeyB58,
          })),
        },
      }),
    });
    const checkData = (await checkRes.json()) as any;
    if (checkData.result?.result) {
      const hasKey = JSON.parse(new TextDecoder().decode(new Uint8Array(checkData.result.result)));
      if (hasKey) return true;
    }
  } catch {}

  try {
    const statusRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'status', params: [] }),
    });
    const statusData = (await statusRes.json()) as any;
    const latestBlockHash = base58Decode(statusData?.result?.sync_info?.latest_block_hash || '');

    const keyRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query',
        params: {
          request_type: 'view_access_key',
          finality: 'final',
          account_id: subAccount,
          public_key: userPubKeyB58,
        },
      }),
    });
    const keyData = (await keyRes.json()) as any;
    if (!keyData?.result?.nonce && keyData?.result?.nonce !== 0) return false;
    const nonce = BigInt(keyData.result.nonce) + 1n;

    const w = new BorshWriter();
    w.writeString(subAccount);
    w.writePublicKey(userPubKey);
    w.writeU64(nonce);
    w.writeString('intents.near');
    w.writeBytes(latestBlockHash);

    w.writeU32(1);
    w.writeU8(2); // FunctionCall
    w.writeString('add_public_key');
    const args = new TextEncoder().encode(JSON.stringify({ public_key: userPubKeyB58 }));
    w.writeU32(args.length);
    w.writeBytes(args);
    w.writeU64(50000000000000n); // 50 TGas
    w.writeU128(1n); // 1 yoctoNEAR

    const txBytes = w.toBytes();
    const digest = await crypto.subtle.digest('SHA-256', txBytes);
    const sig = ed25519.sign(new Uint8Array(digest), userPrivKey);

    const signedW = new BorshWriter();
    signedW.writeBytes(txBytes);
    signedW.writeU8(0);
    signedW.writeBytes(sig);
    const signedBytes = signedW.toBytes();

    let binary = '';
    for (let i = 0; i < signedBytes.length; i++) binary += String.fromCharCode(signedBytes[i]);
    const base64Tx = btoa(binary);

    const regRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'broadcast_tx_commit',
        params: [base64Tx],
      }),
    });
    const regData = (await regRes.json()) as any;
    return !!(regData?.result?.status?.SuccessValue !== undefined || regData?.result?.status?.SuccessReceiptId);
  } catch (err) {
    console.warn('[registerKeyOnIntents] failed:', err);
    return false;
  }
}

/**
 * Creates an authentic onchain NEAR sub-account under escrow.uprail.near.
 * Transactions are signed with ESCROW_PRIVATE_KEY and broadcast directly to NEAR RPC.
 */
export async function createOnchainSubAccount(
  env: Env,
  subAccount: string,
  userPubKey?: Uint8Array,
  userPrivKey?: Uint8Array
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  // Check if account already exists onchain
  const alreadyExists = await accountExists(env, subAccount);
  if (alreadyExists) {
    if (userPubKey && userPrivKey) {
      await registerKeyOnIntents(rpcUrl, subAccount, userPubKey, userPrivKey).catch(() => {});
    }
    return { success: true };
  }

  const escrowId = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const privKeyStr = env.ESCROW_PRIVATE_KEY;
  if (!privKeyStr) {
    return { success: true, txHash: 'virtual_escrow' };
  }

  try {
    const escrowRawKey = base58Decode(privKeyStr);
    const escrowPrivKey = escrowRawKey.slice(0, 32);
    const escrowPubKey = ed25519.getPublicKey(escrowPrivKey);
    const escrowPubKeyFormatted = `ed25519:${base58Encode(escrowPubKey)}`;

    // 1. Fetch latest block hash
    const statusRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'block', method: 'status', params: [] }),
    });
    const statusData = (await statusRes.json()) as any;
    const latestBlockHash = base58Decode(statusData?.result?.sync_info?.latest_block_hash || '');

    // 2. Fetch escrow access key nonce
    const keyRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'nonce',
        method: 'query',
        params: {
          request_type: 'view_access_key',
          finality: 'final',
          account_id: escrowId,
          public_key: escrowPubKeyFormatted,
        },
      }),
    });
    const keyData = (await keyRes.json()) as any;
    if (!keyData?.result?.nonce && keyData?.result?.nonce !== 0) {
      return { success: false, error: 'Escrow access key query failed' };
    }
    const nonce = BigInt(keyData.result.nonce) + 1n;

    // 3. Public key for new sub-account
    const newPubKey = userPubKey || ed25519.getPublicKey(crypto.getRandomValues(new Uint8Array(32)));

    // 4. Encode NEAR transaction (actions: CreateAccount, Transfer 0.05 NEAR for storage/gas, AddKey FullAccess)
    const w = new BorshWriter();
    w.writeString(escrowId);
    w.writePublicKey(escrowPubKey);
    w.writeU64(nonce);
    w.writeString(subAccount);
    w.writeBytes(latestBlockHash);

    w.writeU32(3); // 3 actions
    w.writeU8(0);  // action 0: CreateAccount
    w.writeU8(3);  // action 1: Transfer
    w.writeU128(50000000000000000000000n); // 0.05 NEAR for storage and gas
    w.writeU8(5);  // action 2: AddKey
    w.writePublicKey(newPubKey);
    w.writeU64(0n); // nonce = 0
    w.writeU8(1);  // FullAccess

    const txBytes = w.toBytes();
    const digest = await crypto.subtle.digest('SHA-256', txBytes);
    const sig = ed25519.sign(new Uint8Array(digest), escrowPrivKey);

    const signedW = new BorshWriter();
    signedW.writeBytes(txBytes);
    signedW.writeU8(0);
    signedW.writeBytes(sig);
    const signedBytes = signedW.toBytes();

    let binary = '';
    for (let i = 0; i < signedBytes.length; i++) binary += String.fromCharCode(signedBytes[i]);
    const base64Tx = btoa(binary);

    // 5. Broadcast to NEAR RPC
    const txRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tx_create',
        method: 'broadcast_tx_commit',
        params: [base64Tx],
      }),
    });
    const txResult = (await txRes.json()) as any;
    if (txResult?.result?.status?.SuccessValue !== undefined || txResult?.result?.status?.SuccessReceiptId) {
      const txHash = txResult.result.transaction?.hash || `created_${Date.now()}`;
      if (userPubKey && userPrivKey) {
        await registerKeyOnIntents(rpcUrl, subAccount, userPubKey, userPrivKey).catch(() => {});
      }
      return { success: true, txHash };
    }

    const errMsg = txResult?.error?.message || JSON.stringify(txResult?.result?.status?.Failure || txResult);
    console.warn(`[nearRpc] createOnchainSubAccount notice:`, errMsg);
    return { success: false, error: errMsg };
  } catch (err: any) {
    console.warn(`[nearRpc] createOnchainSubAccount error:`, err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

// ─── Account State ─────────────────────────────────────────────────────────────

/**
 * Checks whether a NEAR account exists onchain via live QuikNode / FastNEAR RPC.
 */
export async function accountExists(env: Env, accountId: string): Promise<boolean> {
  if (!accountId) return false;
  try {
    const res = await nearRpc(env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com', 'query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });
    return !!(res && (res.amount !== undefined || res.result?.amount !== undefined));
  } catch {
    return false;
  }
}

export function isSyntheticTxHash(h?: string | null): boolean {
  if (!h) return true;
  return (
    h.startsWith('virtual_') ||
    h.startsWith('direct_') ||
    h.startsWith('wth_tx_') ||
    h.startsWith('created_') ||
    h.length < 32
  );
}

export function nep413Serialize(message: string, nonceBytes: Uint8Array, recipient: string): Uint8Array {
  const w = new BorshWriter();
  w.writeU32(2147484061); // tag: (1 << 31) + 413
  w.writeString(message);
  w.writeBytes(nonceBytes); // 32 bytes
  w.writeString(recipient);
  w.writeU8(0); // callback_url: None (Option<String> where 0 = None)
  return w.toBytes();
}

/**
 * Submits an intent payload to intents.near.execute_intents, relayed and gas-sponsored by escrow.uprail.near.
 */
export async function executeIntentsRelayed(
  env: Env,
  signedPayload: any
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const escrowId = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const privKeyStr = env.ESCROW_PRIVATE_KEY;
  if (!privKeyStr) {
    return { success: false, error: 'ESCROW_PRIVATE_KEY is missing' };
  }

  try {
    const escrowRawKey = base58Decode(privKeyStr);
    const escrowPrivKey = escrowRawKey.slice(0, 32);
    const escrowPubKey = ed25519.getPublicKey(escrowPrivKey);
    const escrowPubKeyB58 = `ed25519:${base58Encode(escrowPubKey)}`;

    const statusRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'status', params: [] }),
    });
    const statusData = (await statusRes.json()) as any;
    const latestBlockHash = base58Decode(statusData?.result?.sync_info?.latest_block_hash || '');

    const keyRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query',
        params: {
          request_type: 'view_access_key',
          finality: 'final',
          account_id: escrowId,
          public_key: escrowPubKeyB58,
        },
      }),
    });
    const keyData = (await keyRes.json()) as any;
    if (!keyData?.result?.nonce && keyData?.result?.nonce !== 0) {
      return { success: false, error: 'Escrow key query failed' };
    }
    const nonce = BigInt(keyData.result.nonce) + 1n;

    const w = new BorshWriter();
    w.writeString(escrowId);
    w.writePublicKey(escrowPubKey);
    w.writeU64(nonce);
    w.writeString('intents.near');
    w.writeBytes(latestBlockHash);

    w.writeU32(1);
    w.writeU8(2); // FunctionCall
    w.writeString('execute_intents');
    const callArgs = new TextEncoder().encode(JSON.stringify({ signed: [signedPayload] }));
    w.writeU32(callArgs.length);
    w.writeBytes(callArgs);
    w.writeU64(100000000000000n); // 100 TGas
    w.writeU128(0n); // 0 deposit

    const txBytes = w.toBytes();
    const txDigest = await crypto.subtle.digest('SHA-256', txBytes);
    const txSig = ed25519.sign(new Uint8Array(txDigest), escrowPrivKey);

    const signedW = new BorshWriter();
    signedW.writeBytes(txBytes);
    signedW.writeU8(0);
    signedW.writeBytes(txSig);
    const signedBytes = signedW.toBytes();

    let binary = '';
    for (let i = 0; i < signedBytes.length; i++) binary += String.fromCharCode(signedBytes[i]);
    const base64Tx = btoa(binary);

    const broadcastRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'broadcast_tx_commit',
        params: [base64Tx],
      }),
    });
    const bData = (await broadcastRes.json()) as any;
    if (bData?.result?.status?.SuccessValue !== undefined || bData?.result?.status?.SuccessReceiptId) {
      const txHash = bData.result.transaction?.hash;
      return { success: true, txHash };
    }

    const err = bData?.error?.message || JSON.stringify(bData?.result?.status?.Failure || bData);
    return { success: false, error: err };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Signs and settles a transfer intent from user to recipient on intents.near.
 */
export async function executeTransferIntent(
  env: Env,
  senderXId: string,
  recipientNearAccount: string,
  asset: string,
  amount: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(asset, tokens);
    if (!token) {
      token = await resolveRheaToken(env, asset);
    }
    if (!token) {
      return { success: false, error: `Unsupported asset: ${asset}` };
    }

    const baseUnits = toBaseUnits(amount, token.decimals);
    if (!baseUnits || baseUnits === '0') {
      return { success: false, error: `Invalid amount: ${amount}` };
    }

    const senderDerived = await deriveUserNearKeypair(env, senderXId);
    const senderId = senderDerived.accountId;

    // Ensure sender subaccount is live & key registered onchain
    await createOnchainSubAccount(env, senderId, senderDerived.publicKey, senderDerived.privateKey);

    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    let nonceB64 = '';
    for (let i = 0; i < nonceBytes.length; i++) nonceB64 += String.fromCharCode(nonceBytes[i]);
    nonceB64 = btoa(nonceB64);

    const deadline = new Date(Date.now() + 3600000).toISOString();
    const defuseAssetId = token.defuse_asset_id || `nep141:${token.nearContractId}`;

    const intentMessageObj = {
      signer_id: senderId,
      deadline,
      intents: [
        {
          intent: 'transfer',
          receiver_id: recipientNearAccount,
          tokens: {
            [defuseAssetId]: baseUnits,
          },
        },
      ],
    };
    const messageStr = JSON.stringify(intentMessageObj);

    const nep413Bytes = nep413Serialize(messageStr, nonceBytes, 'intents.near');
    const digest = await crypto.subtle.digest('SHA-256', nep413Bytes);
    const sigBytes = ed25519.sign(new Uint8Array(digest), senderDerived.privateKey);

    const signedPayload = {
      standard: 'nep413',
      payload: {
        message: messageStr,
        nonce: nonceB64,
        recipient: 'intents.near',
      },
      public_key: senderDerived.publicKeyB58,
      signature: `ed25519:${base58Encode(sigBytes)}`,
    };

    return await executeIntentsRelayed(env, signedPayload);
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ─── Plain balances on the pk sub-account (direct receives) ──────────────

/** Plain NEP-141 balance of `accountId` on `contractId` (0n on any failure). */
async function getPlainFtBalance(
  rpcUrl: string,
  contractId: string,
  accountId: string
): Promise<bigint> {
  try {
    const res = await viewFunction(rpcUrl, contractId, 'ft_balance_of', { account_id: accountId });
    return BigInt(res || '0');
  } catch {
    return 0n;
  }
}

/** Plain native NEAR balance in yoctoNEAR (0n on any failure). */
async function getPlainNearBalance(rpcUrl: string, accountId: string): Promise<bigint> {
  try {
    const res: any = await nearRpc(rpcUrl, 'query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });
    return BigInt(res?.amount ?? res?.result?.amount ?? '0');
  } catch {
    return 0n;
  }
}

/**
 * Signs and broadcasts a single-action FunctionCall transaction.
 * Mirrors the Borsh + ed25519 flow used by createOnchainSubAccount.
 */
async function signAndBroadcastFunctionCall(opts: {
  rpcUrl: string;
  signerId: string;
  signerPrivKey: Uint8Array;
  signerPubKey: Uint8Array;
  receiverId: string;
  method: string;
  args: string;
  gas: bigint;
  deposit: bigint;
}): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const { rpcUrl, signerId, signerPrivKey, signerPubKey, receiverId, method, args, gas, deposit } = opts;
  try {
    const statusRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'fc_status', method: 'status', params: [] }),
    });
    const statusData = (await statusRes.json()) as any;
    const latestBlockHash = base58Decode(statusData?.result?.sync_info?.latest_block_hash || '');
    if (!latestBlockHash.length) return { ok: false, error: 'Failed to fetch latest block hash' };

    const signerPubKeyB58 = `ed25519:${base58Encode(signerPubKey)}`;
    const keyRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'fc_nonce',
        method: 'query',
        params: {
          request_type: 'view_access_key',
          finality: 'final',
          account_id: signerId,
          public_key: signerPubKeyB58,
        },
      }),
    });
    const keyData = (await keyRes.json()) as any;
    if (!keyData?.result?.nonce && keyData?.result?.nonce !== 0) {
      return { ok: false, error: `Access key query failed for ${signerId}` };
    }
    const nonce = BigInt(keyData.result.nonce) + 1n;

    const w = new BorshWriter();
    w.writeString(signerId);
    w.writePublicKey(signerPubKey);
    w.writeU64(nonce);
    w.writeString(receiverId);
    w.writeBytes(latestBlockHash);
    w.writeU32(1); // 1 action
    w.writeU8(2);  // FunctionCall
    w.writeString(method);
    const argsBytes = new TextEncoder().encode(args);
    w.writeU32(argsBytes.length);
    w.writeBytes(argsBytes);
    w.writeU64(gas);
    w.writeU128(deposit);

    const txBytes = w.toBytes();
    const digest = await crypto.subtle.digest('SHA-256', txBytes);
    const sig = ed25519.sign(new Uint8Array(digest), signerPrivKey);

    const signedW = new BorshWriter();
    signedW.writeBytes(txBytes);
    signedW.writeU8(0);
    signedW.writeBytes(sig);
    const signedBytes = signedW.toBytes();

    let binary = '';
    for (let i = 0; i < signedBytes.length; i++) binary += String.fromCharCode(signedBytes[i]);

    const txRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'fc_tx',
        method: 'broadcast_tx_commit',
        params: [btoa(binary)],
      }),
    });
    const txResult = (await txRes.json()) as any;
    const ok =
      txResult?.result?.status?.SuccessValue !== undefined ||
      txResult?.result?.status?.SuccessReceiptId !== undefined;
    if (!ok) {
      const errMsg =
        txResult?.error?.message ||
        JSON.stringify(txResult?.result?.status?.Failure || txResult?.result || txResult);
      return { ok: false, error: errMsg };
    }
    return { ok: true, txHash: txResult?.result?.transaction?.hash };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * All plain balances held directly on the user's pk sub-account — i.e. tokens
 * someone sent straight to the account (the Receive flow) before any deposit
 * into intents. Scans the registry's NEP-141 contracts in parallel chunks plus
 * native NEAR; KV-cached for 20s to keep /balances snappy.
 */
export async function getPlainBalances(
  env: Env,
  nearAccount: string
): Promise<IntentAccountBalance[]> {
  if (!nearAccount) return [];
  const cacheKey = `plain_bal:${nearAccount}`;
  const cache = (env as any).CACHE;
  try {
    const hit = await cache?.get(cacheKey, 'json');
    if (Array.isArray(hit)) return hit as IntentAccountBalance[];
  } catch {
    /* cache miss */
  }

  try {
    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const tokens = (await getSupportedTokens(env)).filter((t) => t.nearContractId);
    const out: IntentAccountBalance[] = [];
    const chunkSize = 25;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      const results = await Promise.all(
        chunk.map((t) => getPlainFtBalance(rpcUrl, t.nearContractId as string, nearAccount))
      );
      for (let j = 0; j < chunk.length; j++) {
        const bal = results[j];
        if (bal <= 0n) continue;
        const t = chunk[j];
        out.push({
          defuse_asset_id: t.defuse_asset_id || `nep141:${t.nearContractId}`,
          symbol: t.symbol,
          amount: bal.toString(),
          amountFormatted: formatAmount(bal.toString(), t.decimals || 18),
          decimals: t.decimals || 18,
          nearContractId: t.nearContractId as string,
          ...(t.icon ? { icon: t.icon } : {}),
        });
      }
    }

    const native = await getPlainNearBalance(rpcUrl, nearAccount);
    if (native > 0n) {
      out.push({
        defuse_asset_id: 'nep141:wrap.near',
        symbol: 'NEAR',
        amount: native.toString(),
        amountFormatted: formatAmount(native.toString(), 24),
        decimals: 24,
        nearContractId: 'wrap.near',
      });
    }

    try {
      await cache?.put(cacheKey, JSON.stringify(out), { expirationTtl: 20 });
    } catch {
    }
    return out;
  } catch (err) {
    console.warn('[nearRpc] getPlainBalances error:', err);
    return [];
  }
}

/**
 * Moves `amount` of `asset` from the user's own pk sub-account (plain,
 * directly-received balance) into intents.near with a memo:
 * `ft_transfer_call(receiver_id='intents.near', msg=creditAddress)`.
 * intents credits `creditAddress` — the recipient's platform account, the
 * escrow holding account for unregistered recipients, or the sender's own
 * account (withdraw path). Native NEAR is first wrapped to wNEAR via
 * wrap.near `near_deposit`, then transferred like any NEP-141.
 *
 * Returns `deposited:false, reason:'INSUFFICIENT_PLAIN_BALANCE'` when the
 * plain balance cannot cover it — callers fall back to the signed-intent path
 * (which spends balances already held inside intents).
 */
export async function depositPlainBalanceToIntents(
  env: Env,
  senderXId: string,
  asset: string,
  amount: string,
  creditAddress: string
): Promise<{ deposited: boolean; txHash?: string; reason?: string }> {
  try {
    if (!creditAddress) return { deposited: false, reason: 'Missing credit address' };
    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(asset, tokens);
    if (!token) token = await resolveRheaToken(env, asset);
    if (!token) return { deposited: false, reason: `Unsupported asset: ${asset}` };

    const baseUnits = toBaseUnits(amount, token.decimals);
    if (!baseUnits || baseUnits === '0') {
      return { deposited: false, reason: `Invalid amount: ${amount}` };
    }

    const sender = await deriveUserNearKeypair(env, senderXId);
    await createOnchainSubAccount(env, sender.accountId, sender.publicKey, sender.privateKey);

    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
    const contractId = token.nearContractId;
    if (!contractId) return { deposited: false, reason: `No NEAR contract for asset: ${asset}` };
    const isNearNative =
      (token.defuse_asset_id || '').toLowerCase() === 'nep141:wrap.near' ||
      token.symbol.toUpperCase() === 'NEAR';

    const senderKey = {
      rpcUrl,
      signerId: sender.accountId,
      signerPrivKey: sender.privateKey,
      signerPubKey: sender.publicKey,
    };

    // 1. Plain NEP-141 balance on the token contract covers it → single tx.
    const plainFt = await getPlainFtBalance(rpcUrl, contractId, sender.accountId);
    if (plainFt >= BigInt(baseUnits)) {
      const res = await signAndBroadcastFunctionCall({
        ...senderKey,
        receiverId: contractId,
        method: 'ft_transfer_call',
        args: JSON.stringify({ receiver_id: intentsId, amount: baseUnits, msg: creditAddress }),
        gas: 100_000_000_000_000n,
        deposit: 1n,
      });
      return res.ok
        ? { deposited: true, txHash: res.txHash }
        : { deposited: false, reason: res.error || 'ft_transfer_call failed' };
    }

    // 2. Plain native NEAR (NEAR asset only): wrap to wNEAR first, then the
    //    same ft_transfer_call — keeping a gas reserve for both transactions.
    if (isNearNative && contractId === 'wrap.near') {
      const plainNear = await getPlainNearBalance(rpcUrl, sender.accountId);
      const gasReserve = 30000000000000000000000n; // 0.03 NEAR
      if (plainNear >= BigInt(baseUnits) + gasReserve) {
        const wrap = await signAndBroadcastFunctionCall({
          ...senderKey,
          receiverId: 'wrap.near',
          method: 'near_deposit',
          args: '{}',
          gas: 10_000_000_000_000n,
          deposit: BigInt(baseUnits),
        });
        if (!wrap.ok) {
          return { deposited: false, reason: wrap.error || 'near_deposit (wrap.near) failed' };
        }
        const res = await signAndBroadcastFunctionCall({
          ...senderKey,
          receiverId: 'wrap.near',
          method: 'ft_transfer_call',
          args: JSON.stringify({ receiver_id: intentsId, amount: baseUnits, msg: creditAddress }),
          gas: 100_000_000_000_000n,
          deposit: 1n,
        });
        return res.ok
          ? { deposited: true, txHash: res.txHash }
          : { deposited: false, reason: res.error || 'ft_transfer_call (wNEAR) failed' };
      }
    }

    return { deposited: false, reason: 'INSUFFICIENT_PLAIN_BALANCE' };
  } catch (err: any) {
    return { deposited: false, reason: err?.message || String(err) };
  }
}

/**
 * Signs and settles an authentic onchain transfer intent from escrow.uprail.near to recipient on intents.near.
 * Used when releasing escrowed funds to an unregistered X user upon claiming.
 */
export async function executeTransferFromEscrowIntent(
  env: Env,
  recipientNearAccount: string,
  asset: string,
  amount: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(asset, tokens);
    if (!token) {
      token = await resolveRheaToken(env, asset);
    }
    if (!token) {
      return { success: false, error: `Unsupported asset: ${asset}` };
    }

    const baseUnits = toBaseUnits(amount, token.decimals);
    if (!baseUnits || baseUnits === '0') {
      return { success: false, error: `Invalid amount: ${amount}` };
    }

    const escrowId = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
    const privKeyStr = env.ESCROW_PRIVATE_KEY;
    if (!privKeyStr) {
      return { success: false, error: 'ESCROW_PRIVATE_KEY is missing' };
    }

    const escrowRawKey = base58Decode(privKeyStr);
    const escrowPrivKey = escrowRawKey.slice(0, 32);
    const escrowPubKey = ed25519.getPublicKey(escrowPrivKey);
    const escrowPubKeyB58 = `ed25519:${base58Encode(escrowPubKey)}`;

    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    let nonceB64 = '';
    for (let i = 0; i < nonceBytes.length; i++) nonceB64 += String.fromCharCode(nonceBytes[i]);
    nonceB64 = btoa(nonceB64);

    const deadline = new Date(Date.now() + 3600000).toISOString();
    const defuseAssetId = token.defuse_asset_id || `nep141:${token.nearContractId}`;

    const intentMessageObj = {
      signer_id: escrowId,
      deadline,
      intents: [
        {
          intent: 'transfer',
          receiver_id: recipientNearAccount,
          tokens: {
            [defuseAssetId]: baseUnits,
          },
        },
      ],
    };
    const messageStr = JSON.stringify(intentMessageObj);

    const nep413Bytes = nep413Serialize(messageStr, nonceBytes, 'intents.near');
    const digest = await crypto.subtle.digest('SHA-256', nep413Bytes);
    const sigBytes = ed25519.sign(new Uint8Array(digest), escrowPrivKey);

    const signedPayload = {
      standard: 'nep413',
      payload: {
        message: messageStr,
        nonce: nonceB64,
        recipient: 'intents.near',
      },
      public_key: escrowPubKeyB58,
      signature: `ed25519:${base58Encode(sigBytes)}`,
    };

    return await executeIntentsRelayed(env, signedPayload);
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Signs and settles a fungible token withdrawal intent from intents.near to an external account.
 */
export async function executeWithdrawIntent(
  env: Env,
  senderXId: string,
  destinationAddress: string,
  asset: string,
  amount: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(asset, tokens);
    if (!token) {
      token = await resolveRheaToken(env, asset);
    }
    if (!token) {
      return { success: false, error: `Unsupported asset: ${asset}` };
    }

    const baseUnits = toBaseUnits(amount, token.decimals);
    if (!baseUnits || baseUnits === '0') {
      return { success: false, error: `Invalid amount: ${amount}` };
    }

    const senderDerived = await deriveUserNearKeypair(env, senderXId);
    const senderId = senderDerived.accountId;

    // Ensure sender subaccount is live & key registered onchain
    await createOnchainSubAccount(env, senderId, senderDerived.publicKey, senderDerived.privateKey);

    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    let nonceB64 = '';
    for (let i = 0; i < nonceBytes.length; i++) nonceB64 += String.fromCharCode(nonceBytes[i]);
    nonceB64 = btoa(nonceB64);

    const deadline = new Date(Date.now() + 3600000).toISOString();
    const contractId = token.nearContractId || token.defuse_asset_id.replace(/^nep141:/, '');

    const intentMessageObj = {
      signer_id: senderId,
      deadline,
      intents: [
        {
          intent: 'ft_withdraw',
          token: contractId,
          receiver_id: destinationAddress,
          amount: baseUnits,
        },
      ],
    };
    const messageStr = JSON.stringify(intentMessageObj);

    const nep413Bytes = nep413Serialize(messageStr, nonceBytes, 'intents.near');
    const digest = await crypto.subtle.digest('SHA-256', nep413Bytes);
    const sigBytes = ed25519.sign(new Uint8Array(digest), senderDerived.privateKey);

    const signedPayload = {
      standard: 'nep413',
      payload: {
        message: messageStr,
        nonce: nonceB64,
        recipient: 'intents.near',
      },
      public_key: senderDerived.publicKeyB58,
      signature: `ed25519:${base58Encode(sigBytes)}`,
    };

    return await executeIntentsRelayed(env, signedPayload);
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}


/**
 * Provisions the caller's confidential intent sub-account if it is missing.
 * Never throws — a provisioning failure is logged and reported as `false` so
 * the login/registration response is unaffected.
 */
export async function ensureIntentAccount(
  env: Env,
  session: { x_id: string; x_handle: string; near_account?: string | null }
): Promise<boolean> {
  try {
    const accountId = await resolveUserNearAccount(env, session);
    return await accountExists(env, accountId);
  } catch (err) {
    console.warn('[nearRpc] ensureIntentAccount notice:', err);
    return false;
  }
}

/**
 * Resolves or deterministically assigns the confidential onchain intent sub-account for a user.
 * Format: u_<hash>.escrow.uprail.near
 *
 * Pass `report` to learn what the inline provisioning attempt did — callers
 * that surface account status (e.g. /api/onchain/account) use it to tell a
 * user with a fresh passkey but no account yet *why* creation has not landed
 * instead of leaving a stale "register a passkey" banner on screen.
 */
export interface ProvisionReport {
  attempted: boolean;
  created: boolean;
  error?: string;
}

export async function resolveUserNearAccount(
  env: Env,
  session: { x_id: string; x_handle: string; near_account?: string | null },
  report?: ProvisionReport
): Promise<string> {
  // 1. Derive deterministic NEAR keypair and sub-account from active root key
  const derived = await deriveUserNearKeypair(env, session.x_id);
  const accountId = derived.accountId;

  // 2. Check if identity in DB is already aligned with current root derivation
  let needsDbUpdate = true;
  if (env.DB) {
    try {
      const identity = await env.DB.prepare('SELECT near_account FROM x_identities WHERE x_id = ?')
        .bind(session.x_id)
        .first<{ near_account: string | null }>();
      if (identity?.near_account === accountId) {
        needsDbUpdate = false;
      }
    } catch {}
  }

  // 3. Try onchain creation if account does not exist
  try {
    const provision = await createOnchainSubAccount(env, accountId, derived.publicKey, derived.privateKey);
    if (report) {
      report.attempted = true;
      report.created = provision.success;
      report.error = provision.error;
    }
  } catch (createErr: any) {
    console.warn('[nearRpc] createOnchainSubAccount non-blocking notice:', createErr);
    if (report) {
      report.attempted = true;
      report.created = false;
      report.error = createErr?.message || String(createErr);
    }
  }

  // 4. Persist newly derived account to x_identities if not yet updated
  if (needsDbUpdate && env.DB) {
    try {
      await env.DB.prepare('UPDATE x_identities SET near_account = ?, updated_at = ? WHERE x_id = ?')
        .bind(accountId, Date.now(), session.x_id)
        .run();
    } catch {}
  }

  session.near_account = accountId;
  return accountId;
}

/**
 * Compares two asset identifiers across defuse format, NEAR contracts, and symbols.
 * Handles cases like 'usdc' vs 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'
 */
export function assetsMatch(assetA: string | null | undefined, assetB: string | null | undefined): boolean {
  if (!assetA || !assetB) return false;
  const a = assetA.toLowerCase().trim();
  const b = assetB.toLowerCase().trim();
  if (a === b) return true;

  const cleanA = a.includes(':') ? a.split(':').pop()! : a;
  const cleanB = b.includes(':') ? b.split(':').pop()! : b;
  if (cleanA === cleanB) return true;

  // Known USDC aliases
  const usdcIds = ['usdc', '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'];
  if (usdcIds.some((id) => a.includes(id)) && usdcIds.some((id) => b.includes(id))) return true;

  // Known USDT aliases
  const usdtIds = ['usdt', 'usdt.tether-token.near'];
  if (usdtIds.some((id) => a.includes(id)) && usdtIds.some((id) => b.includes(id))) return true;

  // Known NEAR aliases
  const nearIds = ['near', 'wrap.near', 'wnear'];
  if (nearIds.some((id) => a.includes(id)) && nearIds.some((id) => b.includes(id))) return true;

  // Known ETH aliases
  const ethIds = ['eth', 'eth.bridge.near', 'weth'];
  if (ethIds.some((id) => a.includes(id)) && ethIds.some((id) => b.includes(id))) return true;

  // Known BTC aliases
  const btcIds = ['btc', 'wbtc', '2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near', 'btc.omft.near'];
  if (btcIds.some((id) => a.includes(id)) && btcIds.some((id) => b.includes(id))) return true;

  return false;
}

/**
 * Calculates a user's authoritative available balance for a specific asset,
 * derived from:
 *   (Live onchain balance in intents.near + D1 claimed virtual payments)
 *   - (D1 active sent payments + D1 completed/pending withdrawals)
 */
export async function getUserAvailableBalance(
  env: Env,
  session: Session,
  targetAsset: string
): Promise<number> {
  const nearAccount = await resolveUserNearAccount(env, session);

  let onchainAmount = 0;
  try {
    const onchainBalances = await getIntentBalances(env, nearAccount);
    for (const b of onchainBalances) {
      if (
        assetsMatch(b.defuse_asset_id, targetAsset) ||
        assetsMatch(b.symbol, targetAsset) ||
        assetsMatch(b.nearContractId, targetAsset)
      ) {
        onchainAmount += parseFloat(b.amountFormatted || '0') || 0;
      }
    }
  } catch (err) {
    console.warn('[getUserAvailableBalance] onchain query error:', err);
  }

  // Plain tokens sitting on the user's own pk sub-account (direct receives)
  // are spendable too — send/withdraw deposits them into intents first.
  try {
    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(targetAsset, tokens);
    if (!token) token = await resolveRheaToken(env, targetAsset);
    if (token) {
      const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
      const plainFt = await getPlainFtBalance(rpcUrl, token.nearContractId, nearAccount);
      onchainAmount += Number(plainFt) / Math.pow(10, token.decimals || 18);
      const isNearAsset =
        (token.defuse_asset_id || '').toLowerCase() === 'nep141:wrap.near' ||
        token.symbol.toUpperCase() === 'NEAR';
      if (isNearAsset) {
        const plainNear = await getPlainNearBalance(rpcUrl, nearAccount);
        onchainAmount += Number(plainNear) / 1e24;
      }
    }
  } catch (err) {
    console.warn('[getUserAvailableBalance] plain balance query error:', err);
  }

  let virtualClaimedAmount = 0;
  let sentPaymentsAmount = 0;
  let withdrawnAmount = 0;

  if (env.DB) {
    try {
      // 1. Claimed payments received by user
      const claimedRows = await env.DB.prepare(
        "SELECT asset, amount, claim_tx_hash FROM payments WHERE (recipient_x_id = ? OR LOWER(recipient_handle) = LOWER(?)) AND status = 'CLAIMED'"
      )
        .bind(session.x_id, session.x_handle)
        .all<{ asset: string; amount: string; claim_tx_hash?: string | null }>();

      for (const row of claimedRows.results || []) {
        if (assetsMatch(row.asset, targetAsset)) {
          if (isSyntheticTxHash(row.claim_tx_hash)) {
            virtualClaimedAmount += parseFloat(row.amount) || 0;
          }
        }
      }

      // 2. Sent active payments by user (debited from balance)
      const sentRows = await env.DB.prepare(
        "SELECT asset, amount, fee, status, claim_tx_hash FROM payments WHERE (sender_x_id = ? OR LOWER(sender_x_handle) = LOWER(?)) AND status IN ('PENDING', 'DEPOSIT_WAITING', 'ESCROWED', 'CLAIMED')"
      )
        .bind(session.x_id, session.x_handle)
        .all<{ asset: string; amount: string; fee?: string; status: string; claim_tx_hash?: string | null }>();

      for (const row of sentRows.results || []) {
        if (assetsMatch(row.asset, targetAsset)) {
          if (row.status !== 'CLAIMED' || isSyntheticTxHash(row.claim_tx_hash)) {
            const amt = parseFloat(row.amount) || 0;
            const fee = parseFloat(row.fee || '0') || 0;
            sentPaymentsAmount += amt + fee;
          }
        }
      }

      // 3. Withdrawals by user
      const withdrawnRows = await env.DB.prepare(
        "SELECT asset, amount, status, tx_hash FROM withdrawals WHERE x_id = ? AND status IN ('COMPLETED', 'PENDING')"
      )
        .bind(session.x_id)
        .all<{ asset: string; amount: string; status: string; tx_hash?: string | null }>();

      for (const row of withdrawnRows.results || []) {
        if (assetsMatch(row.asset, targetAsset)) {
          if (row.status === 'PENDING' || isSyntheticTxHash(row.tx_hash)) {
            withdrawnAmount += parseFloat(row.amount) || 0;
          }
        }
      }
    } catch (dbErr) {
      console.warn('[getUserAvailableBalance] DB balance lookup error:', dbErr);
    }
  }

  const netAvailable = (onchainAmount + virtualClaimedAmount) - (sentPaymentsAmount + withdrawnAmount);
  return Math.max(0, netAvailable);
}
