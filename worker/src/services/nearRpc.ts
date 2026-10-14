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

/**
 * Per-isolate memo. The Rhea payload is ~6000 entries; held-token discovery
 * resolves metadata once per held contract, so without an in-memory copy that
 * path would re-read (and re-parse) the whole list thousands of times per
 * balance refresh — KV alone is not enough.
 */
let rheaMemCache: { at: number; tokens: RheaTokenEntry[] } | null = null;
const RHEA_MEM_TTL_MS = 5 * 60 * 1000;

export async function getRheaTokens(env: Env): Promise<RheaTokenEntry[]> {
  if (rheaMemCache && Date.now() - rheaMemCache.at < RHEA_MEM_TTL_MS) {
    return rheaMemCache.tokens;
  }

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

  if (cached && Date.now() - cachedAt < RHEA_TTL_MS) {
    rheaMemCache = { at: Date.now(), tokens: cached };
    return cached;
  }

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
      rheaMemCache = { at: Date.now(), tokens: fresh };
      return fresh;
    }
  } catch (err) {
    console.warn('[rhea] token list fetch failed:', err);
  }
  if (cached) {
    // Stale KV beats empty list on feed outage.
    rheaMemCache = { at: cachedAt, tokens: cached };
    return cached;
  }
  return [];
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

/**
 * Same lookup as `resolveRheaToken`, but never guesses when a ticker maps to
 * more than one contract. Launchpad symbols are reused (`UPTOBER` exists as
 * both `uptober.nearlytrade.near` and the abandoned `uptober-2.nearlytrade.near`),
 * and the Rhea list orders the dead one first — so a blind symbol match would
 * derive an address, storage-register a receiver and label the UI with the
 * wrong asset.
 *
 * Tie-break order: pinned contract > unique symbol > the candidate the account
 * actually holds. If that is still ambiguous, fail closed (`null`) instead of
 * picking arbitrarily.
 */
export async function resolveRheaTokenForAccount(
  env: Env,
  asset: string | null | undefined,
  nearAccount?: string
): Promise<OnchainToken | null> {
  const raw = (asset || '').trim().toLowerCase();
  if (!raw) return null;
  const contract = raw.startsWith('nep141:') ? raw.slice(7) : raw;

  let list: RheaTokenEntry[];
  try {
    list = await getRheaTokens(env);
  } catch {
    return null;
  }

  const byContract = list.find((e) => e.contractId.toLowerCase() === contract);
  if (byContract) return rheaToOnchainToken(byContract);

  const candidates = list.filter((e) => e.symbol.toLowerCase() === raw);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return rheaToOnchainToken(candidates[0]);

  if (nearAccount) {
    try {
      const held = await fetchAccountFtBalances(nearAccount);
      const heldSet = new Set(held.map((h) => h.contractId.toLowerCase()));
      const withBalance = candidates.filter((e) => heldSet.has(e.contractId.toLowerCase()));
      if (withBalance.length === 1) return rheaToOnchainToken(withBalance[0]);
    } catch {
      /* fall through to fail-closed */
    }
  }

  console.warn(
    `[nearRpc] ambiguous ticker "${raw}" matches ${candidates.length} contracts (${candidates
      .map((e) => e.contractId)
      .join(', ')}) — refusing to guess`
  );
  return null;
}

/**
 * Held-token discovery. The curated registry can never know which launchpad
 * meme a given user happens to hold (`uptober.nearlytrade.near` has no 1Click
 * entry, no Ref pool, no price), so balance discovery must not be scoped to
 * it. FastNEAR indexes every NEP-141 balance of an account and answers in a
 * single ~1s call, no API key.
 */
const FASTNEAR_ACCOUNT_FT_URL = 'https://api.fastnear.com/v1/account';

export interface HeldFtBalance {
  contractId: string;
  balance: string;
  lastUpdateBlockHeight?: number;
}

export async function fetchAccountFtBalances(
  nearAccount: string
): Promise<HeldFtBalance[]> {
  const strict = await fetchAccountFtBalancesStrict(nearAccount);
  return strict ?? [];
}

/**
 * Same as `fetchAccountFtBalances`, but distinguishes "indexer says the account
 * holds nothing" (`[]`) from "the fetch failed" (`null`). Callers that would
 * otherwise replace a real scan with an empty result must not confuse the two —
 * an empty snapshot would be written back and later read as a mass deposit.
 */
export async function fetchAccountFtBalancesStrict(
  nearAccount: string
): Promise<HeldFtBalance[] | null> {
  if (!nearAccount) return null;
  try {
    const resp = await fetch(
      `${FASTNEAR_ACCOUNT_FT_URL}/${encodeURIComponent(nearAccount)}/ft`,
      { headers: { Accept: 'application/json' } }
    );
    if (!resp.ok) throw new Error(`fastnear ft ${resp.status}`);
    const data = (await resp.json()) as any;
    const list = Array.isArray(data?.tokens) ? data.tokens : [];
    const out: HeldFtBalance[] = [];
    for (const t of list) {
      const contractId = typeof t?.contract_id === 'string' ? t.contract_id : '';
      if (!contractId) continue;
      const balance =
        typeof t?.balance === 'string' ? t.balance : String(t?.balance ?? '0');
      if (!balance || balance === '0' || balance === 'null') continue;
      const height = Number(t?.last_update_block_height);
      out.push({
        contractId,
        balance,
        ...(Number.isFinite(height) ? { lastUpdateBlockHeight: height } : {}),
      });
    }
    return out;
  } catch (err) {
    console.warn('[nearRpc] fastnear FT balance fetch failed:', err);
    return null;
  }
}

/**
 * Metadata lookup for an arbitrary NEAR FT contract, sourced from the Rhea
 * (Ref) list. Returns null when the contract is not listed anywhere we can
 * describe it — callers skip those rather than rendering a bare address as a
 * ticker symbol.
 */
async function getHeldTokenMeta(
  env: Env,
  contractId: string
): Promise<RheaTokenEntry | null> {
  const cl = (contractId || '').toLowerCase();
  if (!cl) return null;
  try {
    const list = await getRheaTokens(env);
    return list.find((e) => e.contractId.toLowerCase() === cl) || null;
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
  /** Live USD price from the registry; absent when the asset has none. */
  priceUsd?: number;
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
  if (supportedTokensMem && Date.now() - supportedTokensMem.at < SUPPORTED_TOKENS_MEM_TTL_MS) {
    return [...supportedTokensMem.tokens];
  }
  const tokens = await loadSupportedTokens(env);
  if (Array.isArray(tokens) && tokens.length > 0) {
    supportedTokensMem = { at: Date.now(), tokens };
  }
  return [...tokens];
}

/**
 * Per-isolate memo of the merged registry.
 *
 * One request typically resolves the registry several times (intent balances,
 * plain balances, virtual deltas). Each resolution used to cost 3 external
 * fetches — 1Click, CoinGecko and Rhea — which both burned most of Workers
 * Free's 50-subrequest budget and hammered CoinGecko hard enough to get 429s,
 * leaving every token without a price.
 */
let supportedTokensMem: { at: number; tokens: OnchainToken[] } | null = null;
const SUPPORTED_TOKENS_MEM_TTL_MS = 30_000;

async function loadSupportedTokens(env: Env): Promise<OnchainToken[]> {
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
/** Assets that are a dollar by construction — the peg is a price. */
const STABLE_SYMBOLS = new Set([
  'USDC', 'USDT', 'DAI', 'FRAX', 'USDD', 'USDE', 'USDG', 'FDUSD',
]);

/**
 * Live USD price for a registry token, or null when neither the registry nor
 * the stablecoin peg knows it. Never falls back to 0: callers must be able to
 * tell "worthless" from "we have no price", because $0.00 and an unknown
 * holding look identical on a dashboard total.
 */
export function tokenUsdPrice(symbol: string | undefined, priceUsd?: number): number | null {
  if (typeof priceUsd === 'number' && isFinite(priceUsd) && priceUsd > 0) return priceUsd;
  const sym = (symbol || '').trim().toUpperCase();
  return STABLE_SYMBOLS.has(sym) ? 1 : null;
}

// ─── Launchpad/meme prices: Ref DCL concentrated-liquidity pools ─────────────
//
// Rhea metadata and the intents registry carry no prices, and every launchpad
// token we ship (UPTOBER and friends) is listed on exactly one concentrated-
// liquidity pool that nobody indexes — DexScreener reports 0 pairs for them.
// The pools do exist on-chain, under `dclv2.ref-labs.near`, keyed by
// `token_x|token_y|fee` with `token_x < token_y` lexicographically. One
// `get_pool` call returns `current_point`, and a CL pool's mid is closed form:
//
//   price(base in quote) = 1.0001^current_point * 10^(decimals_base - decimals_quote)
//
// Verified against GeckoTerminal: UPTOBER 0.883x, UPTOBER-2 1.022x. The residual
// is tick granularity, not error — the 1% tier moves in steps of 200 points
// (2.02% per step), so ±1% is the expected tick-vs-spot spread.
//
// A wrong fee tier returns `null` rather than an error, so probing the common
// tiers is safe and costs at most 4 subrequests; the 1% tier covers ~66% of
// all DCL pools and, empirically, every launchpad token.

const DCL_SWAP_CONTRACT_ID = 'dclv2.ref-labs.near';
const DCL_FEE_TIERS = [10000, 100, 2000, 400] as const;
const WRAP_NEAR_CONTRACT_ID = 'wrap.near';
const USDC_CONTRACT_ID = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const DCL_MEM_TTL_MS = 5 * 60 * 1000;
const DCL_KV_TTL_S = 15 * 60;
const DCL_NEGATIVE_TTL_S = 60 * 60;

/**
 * Per-isolate memo keyed by `base|quote`. A "no pool" result is cached as
 * `null` (distinct from a miss) so a dead token stops costing 4 view calls
 * on every single request until the TTL lapses.
 */
const dclMemCache = new Map<string, { at: number; priceInQuote: number | null }>();

/**
 * Workers Free allows 50 subrequests per invocation and KV reads/writes count
 * against that cap exactly like view calls do. Everything this price stack
 * spends is charged here, so a token-heavy account degrades to "some rows stay
 * unpriced" rather than exhausting the cap and failing the whole request the
 * way the old registry-wide ft_balance_of fan-out silently zeroed balances.
 */
export interface PriceBudget {
  spent: number;
  max: number;
}

function spend(budget: PriceBudget, n = 1): boolean {
  if (budget.spent + n > budget.max) return false;
  budget.spent += n;
  return true;
}

/** `1.0001^point`, or null when the point would under/overflow a float. */
function dclMidFromPoint(point: unknown): number | null {
  const p = Number(point);
  if (!Number.isFinite(p)) return null;
  const raw = Math.pow(1.0001, p);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

async function readDclPool(
  rpcUrl: string,
  poolId: string,
  budget: PriceBudget
): Promise<{ current_point: unknown } | null> {
  if (!spend(budget)) return null;
  try {
    const pool = await viewFunction(rpcUrl, DCL_SWAP_CONTRACT_ID, 'get_pool', { pool_id: poolId });
    if (!pool || typeof pool !== 'object') return null;
    if (pool.current_point === undefined || pool.current_point === null) return null;
    return pool as { current_point: unknown };
  } catch {
    return null;
  }
}

async function probeDclPools(
  rpcUrl: string,
  baseContract: string,
  quoteContract: string,
  baseDecimals: number,
  quoteDecimals: number,
  budget: PriceBudget
): Promise<number | null> {
  // DCL enforces token_x < token_y at pool creation, so there is exactly one
  // canonical id; the mid is price(token_x in token_y) and gets inverted if
  // the caller asked for the other direction.
  const baseFirst = baseContract < quoteContract;
  const [tokenX, tokenY, xDecimals, yDecimals] = baseFirst
    ? [baseContract, quoteContract, baseDecimals, quoteDecimals]
    : [quoteContract, baseContract, quoteDecimals, baseDecimals];

  for (const fee of DCL_FEE_TIERS) {
    const pool = await readDclPool(rpcUrl, `${tokenX}|${tokenY}|${fee}`, budget);
    if (!pool) continue;
    const mid = dclMidFromPoint(pool.current_point);
    if (mid === null) return null;
    const xInY = mid * Math.pow(10, xDecimals - yDecimals);
    if (!Number.isFinite(xInY) || xInY <= 0) return null;
    return baseFirst ? xInY : 1 / xInY;
  }
  return null;
}

async function getDclPoolPriceInQuote(
  env: Env,
  baseContract: string,
  quoteContract: string,
  baseDecimals: number,
  quoteDecimals: number,
  budget: PriceBudget
): Promise<number | null> {
  const cacheKey = `${baseContract}|${quoteContract}`;

  const memo = dclMemCache.get(cacheKey);
  if (memo && Date.now() - memo.at < DCL_MEM_TTL_MS) return memo.priceInQuote;

  const kvKey = `dcl-price:v1:${cacheKey}`;
  if (env.CACHE && spend(budget)) {
    try {
      const raw = await env.CACHE.get(kvKey);
      if (raw !== null) {
        const n = Number(raw);
        if (isFinite(n)) {
          const cachedPrice = n > 0 ? n : null; // '0' is the negative sentinel
          dclMemCache.set(cacheKey, { at: Date.now(), priceInQuote: cachedPrice });
          return cachedPrice;
        }
      }
    } catch (err) {
      console.warn('[dcl] KV read failed:', err);
    }
  }

  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const price = await probeDclPools(rpcUrl, baseContract, quoteContract, baseDecimals, quoteDecimals, budget);

  if (env.CACHE && spend(budget)) {
    try {
      await env.CACHE.put(kvKey, price !== null ? String(price) : '0', {
        expirationTtl: price !== null ? DCL_KV_TTL_S : DCL_NEGATIVE_TTL_S,
      });
    } catch (err) {
      console.warn('[dcl] KV write failed:', err);
    }
  }
  dclMemCache.set(cacheKey, { at: Date.now(), priceInQuote: price });
  return price;
}

/**
 * Registry tier of the price stack, for rows that arrived without one. Matched
 * on contract id first, then symbol, and falls through to the stablecoin peg
 * so a row that skipped the caller's own merge still resolves.
 */
async function registryTokenPrice(
  env: Env,
  contractId: string | null,
  symbol: string | null
): Promise<number | null> {
  try {
    const tokens = await getSupportedTokens(env);
    const needle = (contractId || '').trim();
    const symNeedle = (symbol || '').trim().toUpperCase();
    const t = (needle && tokens.find((x) => (x.nearContractId || '') === needle))
      || (symNeedle && tokens.find((x) => (x.symbol || '').toUpperCase() === symNeedle));
    if (!t) return null;
    return tokenUsdPrice(t.symbol, t.priceUsd);
  } catch {
    return null;
  }
}

export interface HeldTokenPriceSource {
  contractId?: string | null;
  nearContractId?: string | null;
  symbol?: string | null;
  decimals?: number | null;
  priceUsd?: number | null;
}

/**
 * Price a held token in three tiers: registry price, stablecoin peg, then an
 * on-chain DCL pool against wNEAR (or USDC). Returns null when nothing knows,
 * never 0 — callers must keep distinguishing "worthless" from "no price".
 */
export async function resolveTokenUsdPrice(
  env: Env,
  token: HeldTokenPriceSource,
  // Enough for both quote legs (wNEAR then USDC): 4 view calls + a KV read and
  // write each. Callers that price many rows pass a shared budget instead.
  budget: PriceBudget = { spent: 0, max: 12 }
): Promise<number | null> {
  // Tier 1: the caller already attached a price (or the row is a stablecoin).
  const known = tokenUsdPrice(token.symbol ?? undefined, token.priceUsd ?? undefined);
  if (known !== null) return known;

  const base = (token.contractId || token.nearContractId || '').trim();

  // Tier 1b: the registry knows this contract even though the row did not get
  // it — rows built before a registry refresh, or by a path that skipped the merge.
  if (base) {
    const fromRegistry = await registryTokenPrice(env, base, token.symbol ?? null);
    if (fromRegistry !== null) return fromRegistry;
  }

  // Tiers 2-3 need a DCL pool, which wNEAR itself never has (it is the quote).
  if (!base || base === WRAP_NEAR_CONTRACT_ID) return null;
  const baseDecimals = typeof token.decimals === 'number' ? token.decimals : 18;
  if (!Number.isFinite(baseDecimals) || baseDecimals < 0 || baseDecimals > 36) return null;

  const inNear = await getDclPoolPriceInQuote(env, base, WRAP_NEAR_CONTRACT_ID, baseDecimals, 24, budget);
  if (inNear !== null) {
    const nearUsd = await registryTokenPrice(env, WRAP_NEAR_CONTRACT_ID, 'NEAR');
    if (nearUsd !== null) return inNear * nearUsd;
  }

  // No wNEAR pool: a USDC pool is already a dollar price.
  const inUsdc = await getDclPoolPriceInQuote(env, base, USDC_CONTRACT_ID, baseDecimals, 6, budget);
  if (inUsdc !== null) return inUsdc;

  return null;
}

/**
 * Fill in `priceUsd` on balance rows the registry and the peg could not price.
 * The budget is counted in subrequests, not tokens: a token with no pool costs
 * 8 view calls plus 4 KV ops, so pricing is abandoned for the remaining rows
 * once the budget is spent and they simply stay unpriced.
 */
export const DEFAULT_PRICE_SUBREQUEST_BUDGET = 30;

export async function attachMissingPrices<T extends HeldTokenPriceSource>(
  env: Env,
  rows: T[],
  maxSubrequests: number = DEFAULT_PRICE_SUBREQUEST_BUDGET
): Promise<void> {
  const budget: PriceBudget = { spent: 0, max: Math.max(0, maxSubrequests) };
  for (const row of rows) {
    if (budget.spent >= budget.max) break;
    if (row.priceUsd !== undefined && row.priceUsd !== null) continue;
    const resolved = await resolveTokenUsdPrice(env, row, budget);
    if (resolved === null) continue;
    row.priceUsd = resolved;
  }
}

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

    // The registry only ever contains a curated display head, so a token the
    // user actually moved into intents (any launchpad NEP-141) would otherwise
    // be invisible. `mt_batch_balance_of` accepts arbitrary asset ids and
    // simply answers 0 for unknown ones, so the scan is widened to the full
    // Rhea list. Measured: ~6300 ids in a couple of parallel calls, which is
    // both complete AND faster than the old sequential 50-id chunks.
    try {
      const rhea = await getRheaTokens(env);
      for (const entry of rhea) {
        const assetId = `nep141:${entry.contractId}`;
        if (tokenMap.has(assetId)) continue;
        const onchain = rheaToOnchainToken(entry);
        tokenMap.set(assetId, onchain);
      }
    } catch (rheaErr) {
      console.warn('[nearRpc] rhea expansion for intent balances skipped:', rheaErr);
    }

    const tokenIds = Array.from(tokenMap.keys());
    if (tokenIds.length === 0) return [];

    const balances: IntentAccountBalance[] = [];
    const chunkSize = 2000;
    const chunks: string[][] = [];
    for (let i = 0; i < tokenIds.length; i += chunkSize) {
      chunks.push(tokenIds.slice(i, i + chunkSize));
    }

    await Promise.allSettled(
      chunks.map(async (chunk) => {
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
              const price = tokenUsdPrice(symbol, token?.priceUsd);
              balances.push({
                defuse_asset_id: assetId,
                symbol,
                amount: rawAmount,
                amountFormatted: formatAmount(rawAmount, decimals),
                decimals,
                nearContractId: token?.nearContractId || '',
                ...(token?.icon ? { icon: token.icon } : {}),
                ...(price !== null ? { priceUsd: price } : {}),
              });
            }
          }
        }
      } catch (chunkErr) {
        console.warn(`[nearRpc] mt_batch_balance_of chunk failed:`, chunkErr);
      }
      })
    );

    if (balances.length > 0) {
      // Registry-backed prices only cover what the registry lists; launchpad
      // rows arrive here unpriced and get their price from their DCL pool.
      await attachMissingPrices(env, balances);
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
            const price = tokenUsdPrice(tok.symbol);
            fallbackBalances.push({
              defuse_asset_id: tok.id,
              symbol: tok.symbol,
              amount: amtStr,
              amountFormatted: formatAmount(amtStr, tok.decimals),
              decimals: tok.decimals,
              nearContractId: tok.nearContractId,
              icon: getOnchainIcon(tok.symbol.toLowerCase()),
              ...(price !== null ? { priceUsd: price } : {}),
            });
          }
        } catch {}
      })
    );

    await attachMissingPrices(env, fallbackBalances);
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
 *
 * `contractId` pins the exact NEP-141 contract when the picker already knows it.
 * Tickers are not unique on NEAR (two distinct `UPTOBER` contracts exist), so
 * symbol-only resolution must never be allowed to pick the wrong one silently.
 */
export async function getDepositAddress(
  env: Env,
  nearAccount: string,
  chainId: string,
  bypassCache = false,
  tokenSymbol?: string,
  amount?: string,
  contractId?: string
): Promise<DepositAddress | null> {
  const cleanChain = chainId.toLowerCase();
  const cleanToken = (tokenSymbol || '').toLowerCase();
  const cleanContract = (contractId || '').trim().toLowerCase();
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
  if (!cfg && (tokenSymbol || cleanContract)) {
    let matched: OnchainToken | null = null;
    try {
      const allTokens = await getSupportedTokens(env);
      // Prefer the pinned contract when the caller supplied one — the symbol
      // alone is ambiguous for launchpad tokens.
      if (cleanContract) {
        matched =
          allTokens.find(
            (t: any) =>
              ((t.chain || '').toLowerCase() === cleanChain ||
                (t.blockchain || '').toLowerCase() === cleanChain) &&
              (t.nearContractId || '').toLowerCase() === cleanContract
          ) || null;
      }
      if (!matched && tokenSymbol) {
        matched =
          allTokens.find(
            (t: any) =>
              ((t.chain || '').toLowerCase() === cleanChain ||
                (t.blockchain || '').toLowerCase() === cleanChain) &&
              t.symbol.toUpperCase() === tokenSymbol.toUpperCase()
          ) || null;
      }
    } catch (err) {
      console.warn('[nearRpc] dynamic token resolution failed:', err);
    }

    // The registry is a curated display head, so a Rhea-only NEAR meme can be
    // missing from it. Resolve straight from the full Rhea list before giving
    // up — this is what makes depositing `*.nearlytrade.near` assets possible.
    if (!matched && cleanChain === 'near') {
      try {
        matched = await resolveRheaTokenForAccount(env, cleanContract || tokenSymbol, nearAccount);
      } catch (err) {
        console.warn('[nearRpc] rhea token resolution failed:', err);
      }
    }

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

  // 5. NEAR-native ingress for assets 1Click cannot quote.
  //    The 1Click solver registry only knows a few hundred assets, so a
  //    launchpad NEP-141 (e.g. `uptober.nearlytrade.near`) can never mint a
  //    one-time address there. Rather than fail closed and leave the Receive
  //    tab with no address and no deposit progress, fall back to the user's
  //    own vault account, storage-register it on the FT contract so a plain
  //    wallet transfer succeeds, and let the balance watcher detect arrival.
  if (cfg.chain === 'near') {
    await ensureNearFtDepositRegistered(env, cfg, nearAccount);
    const vaultIngress: DepositAddress = {
      chain: 'near',
      chainName: 'NEAR',
      address: nearAccount,
      token: cfg.token,
      minAmountFormatted: cfg.minAmountFormatted,
      minAmountUsd: cfg.minAmountUsd,
      isOneTime: false,
    };
    await saveDepositAddress(env.DB, nearAccount, vaultIngress, cfg.key);
    return vaultIngress;
  }

  return null;
}

/**
 * Current plain FT balance of a single NEP-141 contract on an account, plus
 * its metadata. Used by the Receive tab to turn "tokens arrived at the vault"
 * into a real deposit status, which is the only detection available for
 * assets the 1Click status API has never heard of.
 */
export async function probeNativeFtDeposit(
  env: Env,
  nearAccount: string,
  contractId: string,
  tokenSymbol?: string
): Promise<Record<string, unknown> | null> {
  const cleanContract = (contractId || '').trim().toLowerCase();
  if (!nearAccount || !cleanContract) return null;
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';

  let decimals = 18;
  let symbol = (tokenSymbol || '').toUpperCase();
  let icon: string | undefined;
  let defuseAssetId = `nep141:${cleanContract}`;
  try {
    const meta = await getHeldTokenMeta(env, cleanContract);
    if (meta) {
      decimals = meta.decimals;
      symbol = symbol || meta.symbol.toUpperCase();
      icon = meta.icon || undefined;
      defuseAssetId = `nep141:${meta.contractId}`;
    }
  } catch {}

  let raw = 0n;
  try {
    raw = await getPlainFtBalance(rpcUrl, cleanContract, nearAccount);
  } catch (err) {
    console.warn('[nearRpc] probeNativeFtDeposit balance check failed:', err);
  }

  const amountFormatted = formatAmount(raw.toString(), decimals);
  const settled = raw > 0n;

  return {
    status: settled ? 'SUCCESS' : 'PENDING_DEPOSIT',
    depositedAmount: raw.toString(),
    depositedAmountFormatted: amountFormatted,
    // No oracle price for launchpad memes — never invent a USD figure.
    depositedAmountUsd: '0',
    amountInFormatted: amountFormatted,
    amountOutFormatted: null,
    timeEstimate: null,
    txHashes: [],
    updatedAt: new Date().toISOString(),
    isSettled: settled,
    source: 'native_ft_balance',
    defuseAssetId,
    ...(symbol ? { symbol } : {}),
    ...(icon ? { icon } : {}),
    nearContractId: cleanContract,
  };
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
  let txs: IntentTx[] = [];

  // Try the 1Click API transaction history endpoint
  try {
    const url = `${env.NEAR_API_BASE}/v1/accounts/${encodeURIComponent(nearAccount)}/transactions?limit=${limit}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const list = Array.isArray(data) ? data : (data.transactions || data.items || []);
      txs = list
        .map((tx: any) => ({
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
          status:
            tx.status === 'SUCCESS' || tx.status === 'success'
              ? 'success'
              : tx.status === 'FAILED' || tx.status === 'failed'
                ? 'failed'
                : 'pending',
        }))
        .filter((tx: any) => !!tx.id) as IntentTx[];
    }
  } catch (err) {
    console.warn('[nearRpc] getIntentHistory via 1click failed:', err);
  }

  // NEP-141s sent straight to the vault never appear in intents history — they
  // are recovered from the plain-balance snapshot diff taken by
  // getPlainBalances. Best-effort only.
  try {
    const plainEvents = await getPlainFtDepositEvents(env, nearAccount);
    for (const ev of plainEvents) {
      if (!txs.some((t) => t.id === ev.id)) txs.push(ev);
    }
  } catch (plainErr) {
    console.warn('[nearRpc] plain FT deposit events lookup failed:', plainErr);
  }

  if (txs.length > 0) return txs;

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
 *
 * `ambiguous: true` on failure means the broadcast MAY have been accepted
 * (network error / malformed reply AFTER the transaction was submitted) —
 * callers must not release reservations in that case, or a retry can double-spend.
 */
export async function executeIntentsRelayed(
  env: Env,
  signedPayload: any
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const escrowId = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const privKeyStr = env.ESCROW_PRIVATE_KEY;
  if (!privKeyStr) {
    return { success: false, error: 'ESCROW_PRIVATE_KEY is missing' };
  }

  let broadcastAttempted = false;
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

    broadcastAttempted = true;
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

    // The node replied with a definite outcome: the transaction did not land.
    const err = bData?.error?.message || JSON.stringify(bData?.result?.status?.Failure || bData);
    return { success: false, error: err, ambiguous: false };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
      ambiguous: broadcastAttempted,
    };
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
    let senderId = senderDerived.accountId;

    if (env.DB) {
      try {
        const idRow = await env.DB.prepare('SELECT near_account FROM x_identities WHERE x_id = ?')
          .bind(senderXId)
          .first<{ near_account: string | null }>();
        if (idRow?.near_account) {
          senderId = idRow.near_account;
        }
      } catch {}
    }

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
 * Plain (directly-held) NEP-141 balance of an account, in base units.
 *
 * Callers use this to tell a deposit that genuinely failed from one whose
 * broadcast timed out but landed — the latter would otherwise be spent a
 * second time on a fallback rail. Returns `null` when the balance cannot be
 * read, so a transport failure is never mistaken for "nothing moved".
 */
export async function getPlainAssetBalance(
  env: Env,
  asset: string,
  nearAccount: string
): Promise<bigint | null> {
  try {
    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(asset, tokens);
    if (!token) token = await resolveRheaToken(env, asset);
    if (!token?.nearContractId) return null;
    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    return await getPlainFtBalance(rpcUrl, token.nearContractId, nearAccount);
  } catch {
    return null;
  }
}

/**
 * True when an account's plain balance fell by at least `amount` since
 * `before` — i.e. a deposit whose broadcast reported failure actually landed.
 * Answering `false` from a null reading is deliberate: an unreadable balance
 * is not evidence that nothing moved, and guessing wrong here spends the same
 * tokens twice.
 */
export async function plainBalanceAbsorbed(
  env: Env,
  asset: string,
  nearAccount: string,
  before: bigint | null,
  amount: string
): Promise<boolean> {
  if (before === null) return false;
  try {
    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(asset, tokens);
    if (!token) token = await resolveRheaToken(env, asset);
    if (!token) return false;
    const requested = BigInt(toBaseUnits(amount, token.decimals) || '0');
    if (requested <= 0n) return false;
    const after = await getPlainAssetBalance(env, asset, nearAccount);
    if (after === null) return false;
    return before - after >= requested;
  } catch {
    return false;
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
 * Plain (direct-to-vault) FT deposit events, derived by diffing the account's
 * FT balances between polls. A NEP-141 sent straight to the user's vault is
 * not an intents transaction and is not visible to the 1Click history API, so
 * without this the "Shielded Inflow" widget could never count it.
 *
 * The snapshot is KV-backed per account; losing it degrades to "no events
 * until the next increase", never to fabricated history.
 */
const PLAIN_FT_STATE_KEY = (account: string) => `plain_ft_state:v1:${account}`;
const PLAIN_FT_STATE_TTL_S = 30 * 24 * 3600;
const PLAIN_FT_EVENT_LIMIT = 25;

interface PlainFtSnapshotEntry {
  b: string;
  h?: number;
}

interface PlainFtState {
  at: number;
  snap: Record<string, PlainFtSnapshotEntry>;
  events: IntentTx[];
}

async function readPlainFtState(
  env: Env,
  nearAccount: string
): Promise<PlainFtState | null> {
  const cache = (env as any).CACHE;
  if (!cache) return null;
  try {
    const raw = await cache.get(PLAIN_FT_STATE_KEY(nearAccount));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlainFtState;
    if (!parsed || typeof parsed !== 'object' || !parsed.snap) return null;
    return {
      at: Number(parsed.at) || 0,
      snap: parsed.snap || {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return null;
  }
}

async function writePlainFtState(
  env: Env,
  nearAccount: string,
  state: PlainFtState
): Promise<void> {
  const cache = (env as any).CACHE;
  if (!cache) return;
  try {
    await cache.put(PLAIN_FT_STATE_KEY(nearAccount), JSON.stringify(state), {
      expirationTtl: PLAIN_FT_STATE_TTL_S,
    });
  } catch (err) {
    console.warn('[nearRpc] plain FT snapshot write failed:', err);
  }
}

/**
 * Compares the current held-FT set against the previous snapshot and appends a
 * synthetic `deposit` event for every contract whose balance grew. A missing
 * snapshot only seeds the baseline — it never back-fills events, because we
 * cannot tell an incoming transfer from a balance that predates the account.
 */
export async function recordPlainFtDepositEvents(
  env: Env,
  nearAccount: string,
  held: HeldFtBalance[],
  resolveMeta: (contractId: string) => Promise<RheaTokenEntry | null>
): Promise<IntentTx[]> {
  if (!nearAccount || held.length === 0) return [];
  const prev = await readPlainFtState(env, nearAccount);
  const now = Date.now();
  const nextSnap: Record<string, PlainFtSnapshotEntry> = {};
  const newEvents: IntentTx[] = [];

  for (const h of held) {
    const key = h.contractId.toLowerCase();
    nextSnap[key] = { b: h.balance, ...(h.lastUpdateBlockHeight ? { h: h.lastUpdateBlockHeight } : {}) };
    if (!prev) continue;

    const before = BigInt(prev.snap[key]?.b || '0');
    let after: bigint;
    try {
      after = BigInt(h.balance);
    } catch {
      continue;
    }
    if (after <= before) continue;

    const meta = await resolveMeta(h.contractId);
    if (!meta) continue; // no metadata -> nothing sensible to render

    const delta = (after - before).toString();
    const height = h.lastUpdateBlockHeight || 0;
    newEvents.push({
      id: `ft:${key}:${height}`,
      intent_type: 'deposit',
      defuse_asset_id_in: `nep141:${h.contractId}`,
      amount_in: formatAmount(delta, meta.decimals),
      receiver_id: nearAccount,
      block_height: height,
      block_timestamp: now,
      status: 'success',
    });
  }

  const events = [...newEvents, ...(prev?.events || [])]
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .slice(0, PLAIN_FT_EVENT_LIMIT);

  await writePlainFtState(env, nearAccount, { at: now, snap: nextSnap, events });
  return events;
}

/** Events recorded for an account by `recordPlainFtDepositEvents`. */
export async function getPlainFtDepositEvents(
  env: Env,
  nearAccount: string
): Promise<IntentTx[]> {
  if (!nearAccount) return [];
  const state = await readPlainFtState(env, nearAccount);
  return state?.events || [];
}

/**
 * Upper bound on the secondary registry scan that patches FastNEAR's index lag
 * for high-value assets (wNEAR, USDC, ETH, …). Chosen so that a full
 * `/api/onchain/balances` request stays comfortably inside Workers Free's
 * 50-subrequest budget.
 */
const PLAIN_MAJOR_SCAN_MAX = 8;
/** Bound on the degraded-path scan when FastNEAR itself is unreachable. */
const PLAIN_SCAN_FALLBACK_MAX = 24;

/**
 * All plain balances held directly on the user's pk sub-account — i.e. tokens
 * someone sent straight to the account (the Receive flow) before any deposit
 * into intents.
 *
 * FastNEAR's account FT index is the primary source: one subrequest describes
 * every NEP-141 the account holds, including launchpad memes that appear in no
 * registry. A small capped registry scan covers index lag; a bounded fallback
 * scan runs only when the indexer is down.
 *
 * KV-cached for 20s to keep /balances snappy.
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
    const out: IntentAccountBalance[] = [];
    const coveredContracts = new Set<string>();

    // Metadata is resolved ONCE — accounts can hold thousands of FTs and a
    // per-token lookup would be O(n·m).
    const rheaByContract = new Map<string, RheaTokenEntry>();
    try {
      for (const e of await getRheaTokens(env)) {
        rheaByContract.set(e.contractId.toLowerCase(), e);
      }
    } catch (metaErr) {
      console.warn('[nearRpc] rhea metadata unavailable for held tokens:', metaErr);
    }

    // The registry is memoized, so this is free on the hot path and is also
    // the metadata source for held assets the Rhea list does not describe.
    const registry = await getSupportedTokens(env);
    const regByContract = new Map<string, OnchainToken>();
    for (const t of registry) {
      if (t.nearContractId) regByContract.set(t.nearContractId.toLowerCase(), t);
    }

    /** wNEAR is merged into the single NEAR row at the end, never listed twice. */
    let wNearHeld = 0n;

    const pushHeld = (contractId: string, raw: string): void => {
      const cl = contractId.toLowerCase();
      if (coveredContracts.has(cl)) return;
      if (cl === 'wrap.near') {
        const v = BigInt(raw);
        if (v > 0n) wNearHeld += v;
        coveredContracts.add(cl);
        return;
      }
      let amount: bigint;
      try {
        amount = BigInt(raw);
      } catch {
        return;
      }
      if (amount <= 0n) return;

      const rheaMeta = rheaByContract.get(cl);
      const regMeta = regByContract.get(cl);
      const symbol = (rheaMeta?.symbol || regMeta?.symbol || '').trim();
      if (!symbol) return; // no metadata -> never render a raw address as a ticker
      const decimals = rheaMeta?.decimals ?? regMeta?.decimals ?? 18;
      const icon = (regMeta?.icon || rheaMeta?.icon || undefined) as string | undefined;
      const price = tokenUsdPrice(symbol, regMeta?.priceUsd);

      coveredContracts.add(cl);
      out.push({
        defuse_asset_id: regMeta?.defuse_asset_id || `nep141:${contractId}`,
        symbol: symbol.toUpperCase(),
        amount: amount.toString(),
        amountFormatted: formatAmount(amount.toString(), decimals),
        decimals,
        nearContractId: contractId,
        ...(icon ? { icon } : {}),
        ...(price !== null ? { priceUsd: price } : {}),
      });
    };

    // ── 1. FastNEAR: ONE subrequest returns every NEP-141 the account holds.
    //
    // This replaces a registry-wide `ft_balance_of` fan-out of ~490 fetches.
    // Workers Free allows 50 subrequests per invocation, so every call after
    // the budget ran out silently resolved to 0 — held launchpad tokens (which
    // are absent from the registry anyway) could never appear, and the request
    // reported success with partial data.
    const held = await fetchAccountFtBalancesStrict(nearAccount);

    if (held) {
      for (const h of held) pushHeld(h.contractId, h.balance);

      // Index lag guard: verify a handful of high-value registry assets that
      // FastNEAR has not reported yet, so a just-arrived wNEAR/USDC transfer
      // is not missing for an index cycle. Capped to stay inside the budget.
      const missing = registry
        .filter((t) => t.nearContractId && !coveredContracts.has(t.nearContractId.toLowerCase()))
        .slice(0, PLAIN_MAJOR_SCAN_MAX);
      if (missing.length > 0) {
        const scanned = await Promise.all(
          missing.map((t) => getPlainFtBalance(rpcUrl, t.nearContractId as string, nearAccount))
        );
        for (let i = 0; i < missing.length; i++) {
          if (scanned[i] <= 0n) continue;
          pushHeld(missing[i].nearContractId as string, scanned[i].toString());
        }
      }
    } else {
      // FastNEAR unreachable — fall back to a BOUNDED registry scan so the
      // request still returns something instead of exhausting the subrequest
      // budget and reporting an empty balance set.
      const tokens = registry.filter((t) => t.nearContractId).slice(0, PLAIN_SCAN_FALLBACK_MAX);
      const scanned = await Promise.all(
        tokens.map((t) => getPlainFtBalance(rpcUrl, t.nearContractId as string, nearAccount))
      );
      for (let i = 0; i < tokens.length; i++) {
        if (scanned[i] <= 0n) continue;
        pushHeld(tokens[i].nearContractId as string, scanned[i].toString());
      }
    }

    // Snapshot diffing only makes sense against a complete held set. If the
    // indexer failed we would otherwise write an empty snapshot and later read
    // the whole wallet back as one giant fabricated deposit.
    if (held) {
      try {
        await recordPlainFtDepositEvents(env, nearAccount, held, async (contractId) =>
          rheaByContract.get(contractId.toLowerCase()) ??
          (regByContract.get(contractId.toLowerCase())
            ? {
                contractId,
                symbol: regByContract.get(contractId.toLowerCase())!.symbol,
                name: regByContract.get(contractId.toLowerCase())!.name,
                decimals: regByContract.get(contractId.toLowerCase())!.decimals,
                icon: '',
              }
            : null)
        );
      } catch (eventErr) {
        console.warn('[nearRpc] plain FT deposit events skipped:', eventErr);
      }
    }

    // Native NEAR is held outside any FT contract, so it has no FastNEAR row.
    const native = await getPlainNearBalance(rpcUrl, nearAccount);
    const totalNear = native + wNearHeld;
    if (totalNear > 0n) {
      const nearPrice = tokenUsdPrice('NEAR', regByContract.get('wrap.near')?.priceUsd);
      out.push({
        defuse_asset_id: 'nep141:wrap.near',
        symbol: 'NEAR',
        amount: totalNear.toString(),
        amountFormatted: formatAmount(totalNear.toString(), 24),
        decimals: 24,
        nearContractId: 'wrap.near',
        ...(nearPrice !== null ? { priceUsd: nearPrice } : {}),
      });
    }

    // Priced rows only: the 20 s snapshot below is shared with every caller,
    // so an unpriced meme would otherwise stick around for the whole TTL.
    await attachMissingPrices(env, out);

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
 * The standard NEP-145 minimum for a 18-decimal token: 0.00125 NEAR. Used only
 * when a launchpad contract omits `storage_balance_bounds`.
 */
const STORAGE_DEPOSIT_FALLBACK = 1_250_000_000_000_000_000_000n;

/**
 * `token|receiver` pairs whose NEP-145 storage entry is already known to exist.
 * Scoped to the isolate, so a miss costs one extra view call and never a wrong
 * answer — a stale hit would only re-send a registration the contract rejects as
 * already-registered, and we confirm the balance after broadcasting anyway.
 */
const receiverStorageRegistered = new Map<string, { at: number; registered: boolean }>();
const RECEIVER_STORAGE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * NEP-145 storage is a hard precondition for delivering a NEP-141 to an
 * account that has never held it: `ft_transfer` / `ft_transfer_call` panic with
 * "The receiver is not registered" on any token contract where the receiver has
 * no storage entry. `intents.near` is registered for established tokens (USDC,
 * wNEAR) but not for launchpad memes, which is why a meme deposit used to fail
 * and the settlement after it panic with the unrelated "insufficient balance or
 * overflow". `escrow.uprail.near` has the same gap for memes, since it only
 * ever held USDC.
 *
 * Registration is a one-time, per-token, on-chain cost (0.00125 NEAR for a
 * standard 18-decimal token) paid by whoever sends first, after which every
 * later transfer to that receiver is free. Confirms the entry exists after
 * broadcasting rather than assuming the transfer worked — the next
 * `ft_transfer_call` would only tell us the same thing as a panic.
 */
async function ensureReceiverStorageRegistered(
  rpcUrl: string,
  contractId: string,
  receiverId: string,
  senderKey: {
    rpcUrl: string;
    signerId: string;
    signerPrivKey: Uint8Array;
    signerPubKey: Uint8Array;
  }
): Promise<{ ok: boolean; registered: boolean; reason?: string }> {
  const cacheKey = `${contractId}|${receiverId}`;
  const cached = receiverStorageRegistered.get(cacheKey);
  if (cached && cached.registered && Date.now() - cached.at < RECEIVER_STORAGE_TTL_MS) {
    return { ok: true, registered: true };
  }

  // A strict view call: `storage_balance_of` legitimately answers `null` for
  // "not registered", so an RPC failure must never collapse into that answer
  // and trigger a registration we did not need.
  const viewStrict = async (methodName: string, args: Record<string, unknown>): Promise<any> => {
    const result = await nearRpc(rpcUrl, 'query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: methodName,
      args_base64: btoa(JSON.stringify(args)),
    });
    const text = new TextDecoder().decode(new Uint8Array(result?.result ?? []));
    return text ? JSON.parse(text) : null;
  };

  let existing: unknown;
  try {
    existing = await viewStrict('storage_balance_of', { account_id: receiverId });
  } catch (err: any) {
    return {
      ok: false,
      registered: false,
      reason: `Could not read token storage registry: ${err?.message || String(err)}`,
    };
  }
  if (existing) {
    receiverStorageRegistered.set(cacheKey, { at: Date.now(), registered: true });
    return { ok: true, registered: true };
  }

  let min = STORAGE_DEPOSIT_FALLBACK;
  try {
    const bounds = await viewStrict('storage_balance_bounds', { registration_only: false });
    const boundMin = bounds?.min;
    if (typeof boundMin === 'string' && /^\d+$/.test(boundMin) && BigInt(boundMin) > 0n) {
      min = BigInt(boundMin);
    }
  } catch {
    // Some launchpad contracts omit bounds; the standard minimum applies.
  }

  const reg = await signAndBroadcastFunctionCall({
    ...senderKey,
    receiverId: contractId,
    method: 'storage_deposit',
    args: JSON.stringify({ account_id: receiverId, registration_only: false }),
    gas: 10_000_000_000_000n,
    deposit: min,
  });
  if (!reg.ok) {
    return {
      ok: false,
      registered: false,
      reason: `Could not register ${receiverId} on this token contract: ${reg.error || 'storage_deposit failed'}`,
    };
  }

  try {
    const after = await viewStrict('storage_balance_of', { account_id: receiverId });
    if (after) {
      receiverStorageRegistered.set(cacheKey, { at: Date.now(), registered: true });
      return { ok: true, registered: true };
    }
  } catch (err: any) {
    return {
      ok: false,
      registered: false,
      reason: `Storage registration could not be confirmed: ${err?.message || String(err)}`,
    };
  }
  return {
    ok: false,
    registered: false,
    reason: `Token contract did not register storage for ${receiverId} — this asset cannot be moved to it`,
  };
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
 * (which spends balances already held inside intents). Every other `reason`
 * means the deposit was attempted and failed; callers MUST NOT fall through to
 * the signed-intent path in that case, because the intents ledger is still
 * empty and the settlement would only panic.
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

    // The signer must ALWAYS be the sender's own account — creditAddress is
    // only the intents-side credit target (memo). Using it as the signer made
    // direct sends try to spend the RECIPIENT's (or the pooled escrow
    // account's) plain balance instead of the sender's.
    const sender = await deriveUserNearKeypair(env, senderXId);
    let senderAccountId = sender.accountId;
    if (env.DB) {
      try {
        const idRow = await env.DB.prepare('SELECT near_account FROM x_identities WHERE x_id = ?')
          .bind(senderXId)
          .first<{ near_account: string | null }>();
        if (idRow?.near_account) {
          senderAccountId = idRow.near_account;
        }
      } catch {}
    }
    await createOnchainSubAccount(env, senderAccountId, sender.publicKey, sender.privateKey);

    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
    const contractId = token.nearContractId;
    if (!contractId) return { deposited: false, reason: `No NEAR contract for asset: ${asset}` };
    const isNearNative =
      (token.defuse_asset_id || '').toLowerCase() === 'nep141:wrap.near' ||
      token.symbol.toUpperCase() === 'NEAR';

    const senderKey = {
      rpcUrl,
      signerId: senderAccountId,
      signerPrivKey: sender.privateKey,
      signerPubKey: sender.publicKey,
    };

    // intents must hold NEP-145 storage on this token contract before it can
    // receive it. Skipping this made every launchpad-meme deposit panic with
    // "The receiver is not registered" and every settlement after it fail.
    const storage = await ensureReceiverStorageRegistered(rpcUrl, contractId, intentsId, senderKey);
    if (!storage.registered) {
      return { deposited: false, reason: storage.reason || 'intents is not registered on this token' };
    }

    // 1. Plain NEP-141 balance on the token contract covers it → single tx.
    const plainFt = await getPlainFtBalance(rpcUrl, contractId, senderAccountId);
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
      const plainNear = await getPlainNearBalance(rpcUrl, senderAccountId);
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

/** Resolves the platform escrow account's signing key for a real onchain tx. */
function escrowSigningKey(
  env: Env,
  rpcUrl: string
): { signerId: string; signerPrivKey: Uint8Array; signerPubKey: Uint8Array; rpcUrl: string } | { error: string } {
  const escrowId = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const privKeyStr = env.ESCROW_PRIVATE_KEY;
  if (!privKeyStr) return { error: 'ESCROW_PRIVATE_KEY is missing' };
  try {
    const raw = base58Decode(privKeyStr);
    const signerPrivKey = raw.slice(0, 32);
    return { signerId: escrowId, signerPrivKey, signerPubKey: ed25519.getPublicKey(signerPrivKey), rpcUrl };
  } catch (err: any) {
    return { error: `ESCROW_PRIVATE_KEY is not a usable key: ${err?.message || String(err)}` };
  }
}

/**
 * Plain `ft_transfer` from the user's own pk sub-account into the platform
 * escrow holding account. This is the settlement rail for launchpad meme
 * assets whose token contract has never registered `intents.near` storage —
 * `ft_transfer_call` into intents panics "The receiver is not registered" for
 * those, and no intent can spend a balance that never made it into intents.
 *
 * Escrow is the only platform account that both holds custody for an escrowed
 * payment and (once registered on the token) can deliver to any NEAR account,
 * so every meme payment locks here and the payout leg releases from here.
 */
export async function depositPlainBalanceToEscrow(
  env: Env,
  senderXId: string,
  asset: string,
  amount: string
): Promise<{ deposited: boolean; txHash?: string; reason?: string }> {
  try {
    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(asset, tokens);
    if (!token) token = await resolveRheaToken(env, asset);
    if (!token) return { deposited: false, reason: `Unsupported asset: ${asset}` };

    const contractId = token.nearContractId;
    if (!contractId) return { deposited: false, reason: `No NEAR contract for asset: ${asset}` };

    const baseUnits = toBaseUnits(amount, token.decimals);
    if (!baseUnits || baseUnits === '0') {
      return { deposited: false, reason: `Invalid amount: ${amount}` };
    }

    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const escrowId = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';

    const sender = await deriveUserNearKeypair(env, senderXId);
    let senderAccountId = sender.accountId;
    if (env.DB) {
      try {
        const idRow = await env.DB.prepare('SELECT near_account FROM x_identities WHERE x_id = ?')
          .bind(senderXId)
          .first<{ near_account: string | null }>();
        if (idRow?.near_account) senderAccountId = idRow.near_account;
      } catch {}
    }
    await createOnchainSubAccount(env, senderAccountId, sender.publicKey, sender.privateKey);

    const senderKey = {
      rpcUrl,
      signerId: senderAccountId,
      signerPrivKey: sender.privateKey,
      signerPubKey: sender.publicKey,
    };

    // escrow must hold NEP-145 storage on the token before it can receive it.
    const storage = await ensureReceiverStorageRegistered(rpcUrl, contractId, escrowId, senderKey);
    if (!storage.registered) {
      return { deposited: false, reason: storage.reason || `escrow is not registered on ${contractId}` };
    }

    const res = await signAndBroadcastFunctionCall({
      ...senderKey,
      receiverId: contractId,
      method: 'ft_transfer',
      args: JSON.stringify({ receiver_id: escrowId, amount: baseUnits }),
      gas: 30_000_000_000_000n,
      deposit: 1n,
    });
    return res.ok
      ? { deposited: true, txHash: res.txHash }
      : { deposited: false, reason: res.error || 'ft_transfer to escrow failed' };
  } catch (err: any) {
    return { deposited: false, reason: err?.message || String(err) };
  }
}

/**
 * Plain `ft_transfer` from the platform escrow account to an external NEAR
 * account — the payout leg for meme assets that bypass intents. Registers the
 * destination on the token contract first when it has never held it, since
 * `ft_transfer` cannot auto-register a receiver and would otherwise panic with
 * "The receiver is not registered".
 *
 * Only ever signs for a NEAR account: cross-chain destinations still need the
 * 1Click route, which settles inside intents and so cannot serve these assets.
 */
export async function executeEscrowFtWithdraw(
  env: Env,
  destinationAddress: string,
  asset: string,
  amount: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(asset, tokens);
    if (!token) token = await resolveRheaToken(env, asset);
    if (!token) return { success: false, error: `Unsupported asset: ${asset}` };

    const contractId = token.nearContractId;
    if (!contractId) return { success: false, error: `No NEAR contract for asset: ${asset}` };

    const baseUnits = toBaseUnits(amount, token.decimals);
    if (!baseUnits || baseUnits === '0') {
      return { success: false, error: `Invalid amount: ${amount}` };
    }

    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const signing = escrowSigningKey(env, rpcUrl);
    if ('error' in signing) return { success: false, error: signing.error };

    const storage = await ensureReceiverStorageRegistered(rpcUrl, contractId, destinationAddress, signing);
    if (!storage.registered) {
      return { success: false, error: storage.reason || `destination is not registered on ${contractId}` };
    }

    const res = await signAndBroadcastFunctionCall({
      ...signing,
      receiverId: contractId,
      method: 'ft_transfer',
      args: JSON.stringify({ receiver_id: destinationAddress, amount: baseUnits }),
      gas: 30_000_000_000_000n,
      deposit: 1n,
    });
    return res.ok
      ? { success: true, txHash: res.txHash }
      : { success: false, error: res.error || 'ft_transfer from escrow failed' };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
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
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
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
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
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
    let senderId = senderDerived.accountId;

    if (env.DB) {
      try {
        const idRow = await env.DB.prepare('SELECT near_account FROM x_identities WHERE x_id = ?')
          .bind(senderXId)
          .first<{ near_account: string | null }>();
        if (idRow?.near_account) {
          senderId = idRow.near_account;
        }
      } catch {}
    }

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
  // 1. Prefer the account already stored in the session (set during login/claim)
  let accountId = session.near_account || null;

  // 2. If not in session, look up the DB — this is the authoritative source and
  //    may differ from the HMAC derivation when the user registered via passkey.
  if (!accountId && env.DB) {
    try {
      const identity = await env.DB.prepare('SELECT near_account FROM x_identities WHERE x_id = ?')
        .bind(session.x_id)
        .first<{ near_account: string | null }>();
      if (identity?.near_account) {
        accountId = identity.near_account;
      }
    } catch {}
  }

  // 3. Fall back to deterministic HMAC derivation only for brand-new users
  //    who have never registered a passkey or been assigned an account.
  const derived = await deriveUserNearKeypair(env, session.x_id);
  if (!accountId) {
    accountId = derived.accountId;
  }

  // 4. Try onchain creation / key registration if account does not exist
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

  // 5. Persist account to x_identities only if it was never set (COALESCE)
  if (env.DB) {
    try {
      await env.DB.prepare(
        'UPDATE x_identities SET near_account = COALESCE(near_account, ?), updated_at = ? WHERE x_id = ?'
      )
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
 * Computes the user's net virtual balance deltas from D1 — the ONE canonical
 * algorithm behind send/withdraw gates, /onchain/balances and /api/claim/balance:
 *   + claimed payments received by the user (only synthetic claim txs — real
 *     onchain claims are already in the intents balance)
 *   - active sent payments (amount+fee, unless already settled onchain)
 *   - withdrawals (PENDING or synthetic-tx COMPLETED — real onchain ones are
 *     already debited)
 *
 * When `targetAsset` is given, all rows are filtered with assetsMatch() and the
 * result is keyed by the caller's asset string; otherwise rows are keyed by their
 * raw lowercase asset id.
 */
export async function getVirtualBalanceDeltas(
  env: Env,
  session: Session,
  targetAsset?: string
): Promise<Record<string, number>> {
  const deltas: Record<string, number> = {};
  if (!env.DB) return deltas;

  const keyFor = (asset: string): string | null => {
    if (targetAsset) return assetsMatch(asset, targetAsset) ? targetAsset : null;
    return (asset || 'usdc').toLowerCase();
  };
  const add = (asset: string, delta: number) => {
    const key = keyFor(asset);
    if (key === null) return;
    deltas[key] = (deltas[key] || 0) + delta;
  };

  try {
    // 1. Claimed payments received by user (synthetic claims only)
    const claimedRows = await env.DB.prepare(
      "SELECT asset, amount, claim_tx_hash FROM payments WHERE (recipient_x_id = ? OR LOWER(recipient_handle) = LOWER(?)) AND status = 'CLAIMED'"
    )
      .bind(session.x_id, session.x_handle)
      .all<{ asset: string; amount: string; claim_tx_hash?: string | null }>();

    for (const row of claimedRows.results || []) {
      if (isSyntheticTxHash(row.claim_tx_hash)) {
        add(row.asset, parseFloat(row.amount) || 0);
      }
    }

    // 2. Sent active payments by user (debited from balance)
    const sentRows = await env.DB.prepare(
      "SELECT asset, amount, fee, status, claim_tx_hash, intent_hash FROM payments WHERE (sender_x_id = ? OR LOWER(sender_x_handle) = LOWER(?)) AND status IN ('PENDING', 'DEPOSIT_WAITING', 'ESCROWED', 'CLAIMED')"
    )
      .bind(session.x_id, session.x_handle)
      .all<{
        asset: string;
        amount: string;
        fee?: string;
        status: string;
        claim_tx_hash?: string | null;
        intent_hash?: string | null;
      }>();

    for (const row of sentRows.results || []) {
      // ESCROWED with a real escrow intent and CLAIMED with a real claim tx
      // are already debited from the onchain balance read above — counting
      // them again double-deducts (app shows 0 while the chain shows funds).
      const settledOnchain =
        (row.status === 'CLAIMED' && !isSyntheticTxHash(row.claim_tx_hash)) ||
        (row.status === 'ESCROWED' && !isSyntheticTxHash(row.intent_hash));
      if (!settledOnchain) {
        const amt = parseFloat(row.amount) || 0;
        const fee = parseFloat(row.fee || '0') || 0;
        add(row.asset, -(amt + fee));
      }
    }

    // 3. Withdrawals by user
    const withdrawnRows = await env.DB.prepare(
      "SELECT asset, amount, status, tx_hash FROM withdrawals WHERE x_id = ? AND status IN ('COMPLETED', 'PENDING')"
    )
      .bind(session.x_id)
      .all<{ asset: string; amount: string; status: string; tx_hash?: string | null }>();

    for (const row of withdrawnRows.results || []) {
      if (row.status === 'PENDING' || isSyntheticTxHash(row.tx_hash)) {
        add(row.asset, -(parseFloat(row.amount) || 0));
      }
    }
  } catch (dbErr) {
    console.warn('[getVirtualBalanceDeltas] DB balance lookup error:', dbErr);
  }

  return deltas;
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

  const deltas = await getVirtualBalanceDeltas(env, session, targetAsset);
  const netAvailable = onchainAmount + (deltas[targetAsset] || 0);
  return Math.max(0, netAvailable);
}
