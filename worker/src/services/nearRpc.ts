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
import { generate1ClickSwapIntent } from './oneclickWithdraw';
import { requestQuote } from './oneclickClient';
import { cleanMemeSymbol } from '../utils/token';

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
  oneClickSupported?: boolean;
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

/**
 * True for a launchpad meme that is an ordinary NEP-141 on a NEAR account.
 *
 * These are native assets by construction: the tokens sit in the holder's own
 * account and are indexed by FastNEAR's FT index. Their token contracts have
 * simply never registered storage on `intents.near`, so they cannot be held as
 * an intents ledger entry in any durable way. Paying one out must therefore end
 * on the recipient's native balance — the same place a deposit lands — rather
 * than inside intents, where the balance panel's plain-balance scan would never
 * see it.
 */
export function isNearNativeMemeAsset(symbol: string, contractId?: string | null): boolean {
  const contract = (contractId || '').toLowerCase();
  // A meme on another chain is not a native NEAR balance.
  if (contract && !contract.endsWith('.near')) return false;
  return isMemeAsset(symbol, contract);
}

// ─── Intents-support probe ──────────────────────────────────────────────────
/**
 * Decides a token's settlement rail before any money moves, instead of the
 * old try-and-fail detection (attempt the intents deposit, fall over, notice
 * the failure reason).
 *
 * The authoritative signal: a token can live on the intents ledger only if its
 * contract has registered NEP-145 storage for `intents.near` itself — that is
 * exactly the registration whose absence makes a meme deposit panic "The
 * receiver is not registered". One view call answers it for both directions.
 *
 * Returns `null` when the check itself cannot be answered (RPC/KV outage), so
 * callers keep the empirical try-and-fail path rather than mis-routing an
 * intents asset to the native rail. `false` is a deliberate answer, not an
 * error: the contract is reachable and has no intents storage.
 */
const intentsSupportMem = new Map<string, { at: number; supported: boolean }>();
const INTENTS_SUPPORT_MEM_TTL_MS = 30 * 60 * 1000;
const INTENTS_SUPPORT_KV_POS_TTL_S = 24 * 60 * 60;
const INTENTS_SUPPORT_KV_NEG_TTL_S = 60 * 60;

export async function isIntentsSupportedAsset(
  env: Env,
  contractId: string
): Promise<boolean | null> {
  const contract = (contractId || '').trim().toLowerCase();
  if (!contract) return null;

  const memo = intentsSupportMem.get(contract);
  if (memo && Date.now() - memo.at < INTENTS_SUPPORT_MEM_TTL_MS) return memo.supported;

  const kvKey = `intents-support:v1:${contract}`;
  if (env.CACHE) {
    try {
      const raw = await env.CACHE.get(kvKey);
      if (raw === '1' || raw === '0') {
        const supported = raw === '1';
        intentsSupportMem.set(contract, { at: Date.now(), supported });
        return supported;
      }
    } catch (err) {
      console.warn('[intentsSupport] KV read failed:', err);
    }
  }

  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
  let supported: boolean;
  try {
    // A guarded read, not viewFunction: `storage_balance_of` legitimately
    // answers `null` (empty bytes) for an unregistered receiver, and
    // viewFunction JSON.parses the empty string, which throws — collapsing
    // "not registered" into a transport error.
    const result = await nearRpc(rpcUrl, 'query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contract,
      method_name: 'storage_balance_of',
      args_base64: btoa(JSON.stringify({ account_id: intentsId })),
    });
    const text = new TextDecoder().decode(new Uint8Array(result?.result ?? []));
    supported = text ? Boolean(JSON.parse(text)) : false;
  } catch (err) {
    console.warn('[intentsSupport] storage_balance_of failed:', err);
    return null;
  }

  intentsSupportMem.set(contract, { at: Date.now(), supported });
  if (env.CACHE) {
    try {
      await env.CACHE.put(kvKey, supported ? '1' : '0', {
        expirationTtl: supported ? INTENTS_SUPPORT_KV_POS_TTL_S : INTENTS_SUPPORT_KV_NEG_TTL_S,
      });
    } catch (err) {
      console.warn('[intentsSupport] KV write failed:', err);
    }
  }
  return supported;
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
    oneClickSupported: false,
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
    if (hit) return rheaToOnchainToken(hit);
  } catch {
    // fall through to live RPC ft_metadata
  }
  if (contract.endsWith('.near') && /^[a-z0-9][a-z0-9._-]{1,63}$/.test(contract)) {
    try {
      const meta = await getFtContractMetadata(env, contract);
      if (meta && meta.symbol) {
        return rheaToOnchainToken({
          contractId: meta.contractId,
          symbol: meta.symbol,
          name: meta.name || meta.symbol,
          decimals: meta.decimals,
          icon: '',
        });
      }
    } catch {
      // ignore non-FT contracts
    }
  }
  return null;
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
  /**
   * Unit of `amount_in` / `amount_out`.
   *
   * Upstream intent rows come straight from the 1Click API, which reports NEP-141
   * amounts in base units (yocto for NEAR, micro for USDC) and carries the human
   * figure in separate `*Formatted` fields we do not receive. Rows this worker
   * synthesizes from its own D1 records are already human-readable. Without this
   * tag a consumer cannot tell them apart, and multiplying a raw base amount by
   * a USD price produced totals like $476,901.98 for a handful of small sends.
   */
  amount_source?: 'human' | 'unknown';
  receiver_id?: string;
  sender_id?: string;
  block_height: number;
  block_timestamp: number;
  status: 'success' | 'pending' | 'failed';
  symbol?: string;
}


const FASTNEAR_RPC_URL = 'https://free.rpc.fastnear.com';
const READ_ONLY_RPC_METHODS = new Set([
  'query',
  'tx',
  'EXPERIMENTAL_tx_status',
  'block',
  'status',
  'gas_price',
  'validators',
  'health',
]);
const RPC_MAX_CONCURRENT = 6;
const rpcInflight = new Map<string, Promise<any>>();
const rpcWaiters: Array<() => void> = [];
let rpcActive = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireRpcSlot(): Promise<void> {
  if (rpcActive < RPC_MAX_CONCURRENT) {
    rpcActive++;
    return;
  }
  await new Promise<void>((resolve) => rpcWaiters.push(resolve));
  rpcActive++;
}

function releaseRpcSlot(): void {
  rpcActive--;
  rpcWaiters.shift()?.();
}

async function fetchRpc(targetUrl: string, body: string): Promise<Response> {
  await acquireRpcSlot();
  try {
    return await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'UPRAIL-Worker/1.0',
      },
      body,
      signal: AbortSignal.timeout(12_000),
    });
  } finally {
    releaseRpcSlot();
  }
}

function retryDelayMs(response: Response | null, attempt: number): number {
  if (attempt <= 0) return 0;
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(2000, Math.max(250, seconds * 1000));
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.min(2000, Math.max(250, at - Date.now()));
  }
  return 350 + Math.floor(Math.random() * 300);
}

function isRetryableRpcFailure(err: unknown): boolean {
  return err instanceof Error && /NEAR RPC HTTP error: 429/.test(err.message);
}

async function nearRpcRaw(
  targetUrl: string,
  method: string,
  params: Record<string, unknown>
): Promise<any> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 'uprail',
    method,
    params,
  });

  let lastError: unknown;
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs(lastResponse, attempt));

    let resp: Response;
    try {
      resp = await fetchRpc(targetUrl, body);
    } catch (netErr) {
      lastError = netErr;
      continue;
    }

    if (resp.status === 429 || resp.status >= 500) {
      lastError = new Error(`NEAR RPC HTTP error: ${resp.status}`);
      lastResponse = resp;
      if (resp.status === 429) {
        console.warn(`[nearRpc] 429 ${method} attempt ${attempt + 1}`);
      }
      continue;
    }

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.warn(`[nearRpc] ${resp.status} ${method}`);
      throw new Error(`NEAR RPC HTTP error: ${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    const json = await resp.json() as any;
    if (json.error) {
      // The node hides the real reason in `cause.name` / `data` (e.g. a missing
      // account is HANDLER_ERROR/"Server error" with cause UNKNOWN_ACCOUNT).
      // Surfacing only code+message made every rejection look identical, so
      // callers could not tell "does not exist" from "RPC is down".
      const causeName = json.error?.cause?.name ? ` (${json.error.cause.name})` : '';
      const detail =
        typeof json.error.data === 'string' && json.error.data ? `: ${json.error.data}` : '';
      throw new Error(`NEAR RPC error [${json.error.code}]: ${json.error.message}${causeName}${detail}`);
    }
    return json.result;
  }

  throw lastError instanceof Error ? lastError : new Error('NEAR RPC request failed');
}

async function nearRpc(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>
): Promise<any> {
  const targetUrl = rpcUrl || FASTNEAR_RPC_URL;
  const readOnly = READ_ONLY_RPC_METHODS.has(method);
  const key = readOnly ? `${targetUrl}\n${method}\n${JSON.stringify(params)}` : '';
  if (key) {
    const pending = rpcInflight.get(key);
    if (pending) return pending;
  }

  const request = nearRpcRaw(targetUrl, method, params).catch((err) => {
    if (readOnly && targetUrl !== FASTNEAR_RPC_URL && isRetryableRpcFailure(err)) {
      return nearRpcRaw(FASTNEAR_RPC_URL, method, params);
    }
    throw err;
  });

  if (key) {
    rpcInflight.set(key, request);
    const cleanup = () => {
      if (rpcInflight.get(key) === request) rpcInflight.delete(key);
    };
    request.then(cleanup, cleanup);
  }
  return request;
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

export async function viewContractMethod(
  env: Env,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  return viewFunction(rpcUrl, contractId.toLowerCase(), method, args);
}

export function isAccessKeyPermission(permission: unknown): boolean {
  if (permission === 'FullAccess') return true;
  return Boolean(permission && typeof permission === 'object' && 'FunctionCall' in permission);
}

export async function hasAccessKey(
  env: Env,
  accountId: string,
  publicKey: string
): Promise<boolean> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  try {
    const result = await nearRpc(rpcUrl, 'query', {
      request_type: 'view_access_key',
      finality: 'final',
      account_id: accountId,
      public_key: publicKey,
    });
    return isAccessKeyPermission(result?.permission);
  } catch {
    return false;
  }
}

export async function executeEscrowContractCall(
  env: Env,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
  gas = 100_000_000_000_000n
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const signing = escrowSigningKey(env, rpcUrl);
    if ('error' in signing) return { success: false, error: signing.error };
    const res = await signAndBroadcastFunctionCall({
      ...signing,
      receiverId: contractId.toLowerCase(),
      method,
      args: JSON.stringify(args),
      gas,
      deposit: 0n,
    });
    return res.ok
      ? { success: true, txHash: res.txHash }
      : { success: false, error: res.error || `${method} failed` };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
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

export function toBaseUnits(amountStr: string | number, decimals: number): string {
  const parts = String(amountStr ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .split('.');
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
let oneClickAssetSetMem: Set<string> | null = null;
const SUPPORTED_TOKENS_MEM_TTL_MS = 30_000;

/**
 * Returns true if the asset is listed in 1Click's `/v0/tokens` registry and can
 * be quoted via `POST /v0/quote` (Confidential Intents / cross-chain swaps).
 * Native NEAR launchpad tokens merged from Rhea/Ref (`uptober.nearlytrade.near`,
 * `robin-3.nearlytrade.near`, etc.) are NOT in 1Click's registry and fail with
 * `400 tokenIn is not valid` on `/v0/quote`, so they must settle on the
 * on-chain Intents / native NEP-141 rail.
 */
export async function isOneClickSupportedAsset(env: Env, asset: string): Promise<boolean> {
  const raw = (asset || '').trim().toLowerCase();
  if (!raw) return false;
  const clean = raw.startsWith('nep141:') ? raw.slice(7) : raw;

  // Populates `oneClickAssetSetMem` from the live 1Click registry on a miss.
  await getSupportedTokens(env);
  // Registry unreachable: nothing can be quoted on 1Click right now either,
  // so the on-chain rail is the only one that can settle.
  if (!oneClickAssetSetMem) return false;

  if (
    oneClickAssetSetMem.has(raw) ||
    oneClickAssetSetMem.has(clean) ||
    oneClickAssetSetMem.has(`nep141:${clean}`)
  ) {
    return true;
  }

  // Symbol-style input (e.g. "USDC"): resolve via the live merged registry and
  // re-check the resolved asset id against the 1Click set.
  const matched = resolveTokenForAsset(asset, supportedTokensMem?.tokens || []);
  if (!matched) return false;
  const id = (matched.defuse_asset_id || '').toLowerCase();
  const contract = (matched.nearContractId || '').toLowerCase();
  return (
    (!!id && oneClickAssetSetMem.has(id)) ||
    (!!contract && oneClickAssetSetMem.has(contract))
  );
}

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
        const rawOneClickSet = new Set<string>();

        for (const t of list) {
          const assetId = t.assetId || t.defuse_asset_id || '';
          if (!assetId) continue;
          if (typeof t.coingeckoId === 'string' && t.coingeckoId) cgIdByAsset[assetId] = t.coingeckoId;

          const { chain: parsedChain, contractId: parsedContractId } = parseDefuseAssetId(assetId);
          const contractAddress = t.contractAddress || parsedContractId;
          const rawSymbol = (t.symbol || '').trim();

          rawOneClickSet.add(String(assetId).toLowerCase());
          if (parsedContractId) {
            rawOneClickSet.add(String(parsedContractId).toLowerCase());
            rawOneClickSet.add(`nep141:${String(parsedContractId).toLowerCase()}`);
          }
          if (contractAddress) {
            rawOneClickSet.add(String(contractAddress).toLowerCase());
          }

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
            oneClickSupported: true,
          });
        }
        oneClickAssetSetMem = rawOneClickSet;

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

  // No hardcoded fallback: every asset must come from a live registry. An
  // empty result is not memoised by getSupportedTokens, so the next call retries.
  return [];
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

    let batchSucceeded = false;
    await Promise.allSettled(
      chunks.map(async (chunk) => {
      try {
        const rawAmounts = await viewFunction(rpcUrl, contractId, 'mt_batch_balance_of', {
          account_id: nearAccount,
          token_ids: chunk,
        });

        if (Array.isArray(rawAmounts)) {
          batchSucceeded = true;
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

    if (batchSucceeded || balances.length > 0) {
      // Registry-backed prices only cover what the registry lists; launchpad
      // rows arrive here unpriced and get their price from their DCL pool.
      if (balances.length > 0) {
        await attachMissingPrices(env, balances);
      }
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
  env: Env,
  nearAccount: string,
  cfg: ChainDepositConfig,
  opts: { confidential?: boolean; userSession?: string } = {}
): Promise<DepositAddress | null> {
  const apiBase = env.NEAR_API_BASE || 'https://1click.chaindefuser.com';
  const deadline = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

  if (opts.confidential) {
    if (!opts.userSession) {
      console.warn('[nearRpc] confidential deposit quote needs a User-Session');
      return null;
    }
    try {
      const quote = await requestQuote(
        env,
        {
          originAsset: cfg.originAsset,
          destinationAsset: cfg.destinationAsset,
          amount: cfg.amount,
          recipient: nearAccount,
          recipientType: 'CONFIDENTIAL_INTENTS',
          refundTo: nearAccount,
          refundType: 'CONFIDENTIAL_INTENTS',
          depositType: 'ORIGIN_CHAIN',
          confidentiality: 'advanced',
          deadline,
        },
        { userSession: opts.userSession }
      );
      return {
        chain: cfg.chain,
        chainName: cfg.chainName,
        address: quote.quote.depositAddress,
        memo: quote.quote.depositMemo || undefined,
        expiresAt: quote.quote.deadline ? new Date(quote.quote.deadline).getTime() : undefined,
        token: cfg.token,
        minAmount: cfg.amount,
        minAmountFormatted: cfg.minAmountFormatted,
        minAmountUsd: cfg.minAmountUsd,
        isOneTime: true,
      };
    } catch (err: any) {
      console.warn(
        `[nearRpc] confidential deposit quote failed (${cfg.chain}/${cfg.token}):`,
        err?.message || err
      );
      return null;
    }
  }

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
      // Private rows are keyed `private_base_usdc`; strip the rail prefix
      // before resolving the network so cached quotes don't come back with
      // chain="private".
      const key = chainKey.startsWith('private_')
        ? chainKey.slice('private_'.length)
        : chainKey;
      const cfg = CHAIN_DEPOSIT_CONFIGS[key] || CHAIN_DEPOSIT_CONFIGS[row.chain];
      // The stored key is token-specific (`near_shitzu`), while `chain` must be
      // the network (`near`). Dynamic tokens have no curated config to read it
      // from, so take the prefix of the key.
      const chainFromKey = key.split('_')[0] || row.chain;
      return {
        chain: cfg?.chain || chainFromKey,
        chainName: cfg?.chainName || row.chain_name || key,
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
  contractId?: string,
  opts: { xId?: string } = {}
): Promise<DepositAddress | null> {
  const railOn = ['true', '1', 'yes'].includes(
    (env.CONFIDENTIAL_RAIL_ENABLED || '').trim().toLowerCase()
  );
  const confidential = Boolean(railOn && opts.xId);
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

  // Keep private and public deposit addresses in separate cache rows so a
  // user who switches rails never receives a previously issued public address.
  if (confidential) cfg = { ...cfg, key: `private_${cfg.key}` };

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
  // 1. Check D1 cache if not bypassing
  if (!bypassCache) {
    const cached = await getCachedDepositAddress(env.DB, nearAccount, cfg.key);
    if (cached) {
      // The D1 key is token-specific, so the address belongs to this cfg even
      // when the config is a dynamic (non-curated) token. Re-attach the
      // requested token metadata so callers never see an untyped address.
      cached.token = cfg.token;
      cached.minAmount = cfg.amount;
      cached.minAmountFormatted = cached.minAmountFormatted || cfg.minAmountFormatted;
      cached.minAmountUsd = cached.minAmountUsd || cfg.minAmountUsd;
      // Re-verify NEP-145 registration on reuse — the original registration tx
      // may have failed, and an unregistered receiver breaks wallet sends.
      await ensureNearFtDepositRegistered(env, cfg, cached.address);
      return cached;
    }
  }

  // 2. Fetch fresh address via 1Click quote
  let userSession: string | undefined;
  if (confidential) {
    try {
      const { getUserSession } = await import('./oneclickAuth');
      userSession = (await getUserSession(env, opts.xId!)).accessToken;
    } catch (err: any) {
      console.warn('[nearRpc] could not mint User-Session for confidential deposit:', err?.message || err);
      return null;
    }
  }
  const fresh = await fetch1ClickDepositAddress(env, nearAccount, cfg, {
    confidential,
    userSession,
  });
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
        .prepare('SELECT chain, chain_name, address, memo, expires_at FROM deposit_addresses WHERE account_id = ? AND chain = ?')
        .bind(nearAccount, cfg.key)
        .first<any>();
      if (stale?.address) {
        return {
          chain: cfg.chain,
          chainName: stale.chain_name || cfg.chainName,
          address: stale.address,
          memo: stale.memo || undefined,
          expiresAt: stale.expires_at || undefined,
          token: cfg.token,
          minAmount: cfg.amount,
          minAmountFormatted: cfg.minAmountFormatted,
          minAmountUsd: cfg.minAmountUsd,
          isOneTime: true,
        };
      }
    } catch {}
  }

  // Never fall back to an unshielded address on foreign chains when the confidential rail
  // is on; fail closed so cross-chain privacy is strictly preserved.
  // For NEAR-native and launchpad meme assets that 1Click cannot quote, permit direct ingress
  // to the user's dedicated NEAR vault (u_<hex>.escrow.uprail.near).
  if (confidential && cfg.chain !== 'near') return null;

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
  let symbol = cleanMemeSymbol(tokenSymbol || '');
  let icon: string | undefined;
  let defuseAssetId = `nep141:${cleanContract}`;
  try {
    const meta = await getHeldTokenMeta(env, cleanContract);
    if (meta) {
      decimals = meta.decimals;
      symbol = cleanMemeSymbol(meta.symbol || meta.name || symbol);
      icon = meta.icon || undefined;
      defuseAssetId = `nep141:${meta.contractId}`;
    }
  } catch {}
  if (!symbol) {
    symbol = cleanMemeSymbol(cleanContract);
  }

  const isNearNative = cleanContract === 'wrap.near' || symbol === 'NEAR';
  if (isNearNative) {
    decimals = 24;
    symbol = 'NEAR';
  }

  let raw = 0n;
  try {
    raw = await getPlainFtBalance(rpcUrl, cleanContract, nearAccount);
  } catch (err) {
    console.warn('[nearRpc] probeNativeFtDeposit balance check failed:', err);
  }

  if (isNearNative && raw === 0n) {
    try {
      const plainNear = await getPlainNearBalanceStrict(rpcUrl, nearAccount);
      if (plainNear !== null) {
        // Vault accounts hold ~0.01 NEAR for account storage + gas.
        // If native balance exceeds 0.01 NEAR, count the net deposited native NEAR.
        const seedReserve = 10000000000000000000000n; // 0.01 NEAR
        if (plainNear > seedReserve) {
          raw = plainNear - seedReserve;
        } else if (plainNear > 5000000000000000000000n) {
          raw = plainNear - 5000000000000000000000n;
        }
      }
    } catch (err) {
      console.warn('[nearRpc] probeNativeFtDeposit plain near check failed:', err);
    }
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

export interface NearTxTransfer {
  kind: 'native' | 'ft';
  /** Destination account credited by the transfer. */
  to: string;
  amountAtomic: string;
  /** For `ft`: the token contract (the transaction's executor). */
  contract?: string;
  memo?: string;
}

export interface NearFtEvent {
  contract: string;
  from: string | null;
  to: string | null;
  amountAtomic: string;
}

export interface NearTxProbe {
  found: boolean;
  success: boolean;
  signer: string | null;
  executor: string | null;
  transfers: NearTxTransfer[];
  events: NearFtEvent[];
  error?: string;
}

/**
 * Extracts NEP-141 `ft_transfer` events from a final transaction result. Claim
 * flows use this to read the exact amount a contract moved into escrow, instead
 * of trusting a pre-claim snapshot that fees may have outgrown.
 */
/**
 * Fungible transfers inside a finalized transaction, including cross-contract
 * receipts. Launchpad adapters pay escrow with `ft_transfer` and put the X
 * handle in `memo`. `ft_transfer_call` is ignored: escrow is a plain account
 * and that call refunds.
 */
export function collectFtTransfers(result: any): NearTxTransfer[] {
  const out: NearTxTransfer[] = [];
  const covered = new Set<string>();
  const receipts = Array.isArray(result?.receipts) ? result.receipts : [];
  for (const receipt of receipts) {
    const id = String(receipt?.receipt_id || '');
    const contract = String(receipt?.receiver_id || '').toLowerCase();
    const actions =
      receipt?.receipt?.Action?.actions ||
      receipt?.receipt?.action?.actions ||
      [];
    for (const action of actions) {
      const call = action?.FunctionCall;
      if (!call || call.method_name !== 'ft_transfer') continue;
      try {
        const args = JSON.parse(decodeB64Utf8(call.args || ''));
        if (!args?.receiver_id || args.amount === undefined) continue;
        out.push({
          kind: 'ft',
          to: String(args.receiver_id),
          amountAtomic: String(args.amount),
          contract: contract || undefined,
          memo: args.memo == null ? undefined : String(args.memo),
        });
        if (id) covered.add(id);
      } catch {
        // unreadable args: fall through to logs for this receipt
      }
    }
  }

  const outcomes = Array.isArray(result?.receipts_outcome) ? result.receipts_outcome : [];
  for (const outcome of outcomes) {
    const id = String(outcome?.id || '');
    if (id && covered.has(id)) continue;
    const contract = String(outcome?.outcome?.executor_id || '').toLowerCase();
    const logs = Array.isArray(outcome?.outcome?.logs) ? outcome.outcome.logs : [];
    let sawEvent = false;
    for (const log of logs) {
      if (typeof log !== 'string' || !log.startsWith('EVENT_JSON:')) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(log.slice('EVENT_JSON:'.length));
      } catch {
        continue;
      }
      if (parsed?.standard !== 'nep141' || parsed?.event !== 'ft_transfer') continue;
      const data = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
      for (const item of data) {
        if (!item || item.amount === undefined) continue;
        const to = item.new_owner_id || item.receiver_id;
        if (!to) continue;
        sawEvent = true;
        out.push({
          kind: 'ft',
          to: String(to),
          amountAtomic: String(item.amount),
          contract: contract || undefined,
          memo: item.memo == null ? undefined : String(item.memo),
        });
      }
    }
    if (sawEvent) continue;
    let pending: NearTxTransfer | null = null;
    for (const log of logs) {
      if (typeof log !== 'string') continue;
      const transfer = /^Transfer (\d+) from \S+ to (\S+)$/.exec(log);
      if (transfer) {
        if (pending) out.push(pending);
        pending = {
          kind: 'ft',
          to: transfer[2],
          amountAtomic: transfer[1],
          contract: contract || undefined,
        };
        continue;
      }
      const memo = /^Memo: (.*)$/.exec(log);
      if (memo && pending) {
        pending.memo = memo[1];
        out.push(pending);
        pending = null;
      }
    }
    if (pending) out.push(pending);
  }
  return out;
}

export function parseNearFtEvents(result: any): NearFtEvent[] {
  const events: NearFtEvent[] = [];
  const receivers = new Map<string, string>();
  for (const receipt of result?.receipts || []) {
    if (receipt?.receipt_id && receipt?.receiver_id) {
      receivers.set(String(receipt.receipt_id), String(receipt.receiver_id));
    }
  }
  for (const outcome of result?.receipts_outcome || []) {
    const contract = String(
      outcome?.outcome?.executor_id || receivers.get(String(outcome?.id)) || ''
    ).toLowerCase();
    if (!contract) continue;
    for (const log of outcome?.outcome?.logs || []) {
      if (typeof log !== 'string' || !log.startsWith('EVENT_JSON:')) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(log.slice('EVENT_JSON:'.length));
      } catch {
        continue;
      }
      if (parsed?.standard !== 'nep141' || parsed?.event !== 'ft_transfer') continue;
      const data = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
      for (const item of data) {
        if (!item || item.amount === undefined) continue;
        events.push({
          contract,
          from: item.old_owner_id ? String(item.old_owner_id) : null,
          to: item.new_owner_id
            ? String(item.new_owner_id)
            : item.receiver_id
              ? String(item.receiver_id)
              : null,
          amountAtomic: String(item.amount),
        });
      }
    }
  }
  return events;
}

/** Decodes a base64 UTF-8 string (NEAR FunctionCall args). */
function decodeB64Utf8(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Fetches a single transaction by hash and normalizes its value-moving actions
 * so a caller can confirm "this tx paid `to` at least `amount`". No indexer is
 * required — the RPC `tx` method is authoritative for one known hash.
 *
 * Used by the local-escrow x402 fallback, where deposits land on the pooled
 * escrow account and must be attributed to a specific (echoed) transaction.
 */
export async function probeNearTransaction(
  env: Env,
  txHash: string,
  senderAccountId?: string
): Promise<NearTxProbe> {
  const empty = (error?: string): NearTxProbe => ({
    found: false,
    success: false,
    signer: null,
    executor: null,
    transfers: [],
    events: [],
    error,
  });
  if (!txHash) return empty('missing tx hash');
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const params: Record<string, unknown> = { tx_hash: txHash, wait_until: 'FINAL' };
  if (senderAccountId) params.sender_account_id = senderAccountId;

  let result: any;
  try {
    result = await nearRpc(rpcUrl, 'tx', params);
  } catch (err: any) {
    return empty(err?.message || 'tx lookup failed');
  }
  const tx = result?.transaction;
  if (!tx) return empty('transaction not found');

  const executor: string | null = tx.receiver_id || null;
  const signer: string | null = tx.signer_id || null;
  const status = result?.status;
  const success = Boolean(status) && !('Failure' in status);

  const transfers: NearTxTransfer[] = [];
  for (const action of tx.actions || []) {
    if (action?.Transfer?.deposit !== undefined) {
      transfers.push({ kind: 'native', to: executor || '', amountAtomic: String(action.Transfer.deposit) });
    } else if (action?.FunctionCall?.method_name === 'ft_transfer') {
      try {
        const a = JSON.parse(decodeB64Utf8(action.FunctionCall.args || ''));
        if (a?.receiver_id && a?.amount !== undefined) {
          transfers.push({
            kind: 'ft',
            to: String(a.receiver_id),
            amountAtomic: String(a.amount),
            contract: executor || undefined,
            memo: a.memo == null ? undefined : String(a.memo),
          });
        }
      } catch {}
    }
  }
  const inner = collectFtTransfers(result);
  const ft = inner.length > 0 ? inner : transfers.filter((t) => t.kind === 'ft');
  const native = transfers.filter((t) => t.kind === 'native');
  return {
    found: true,
    success,
    signer,
    executor,
    transfers: [...native, ...ft],
    events: parseNearFtEvents(result),
  };
}

/**
 * Fetches deposit addresses for ALL supported chains for a user.
 * Concurrently generates/retrieves valid addresses across all chains.
 */
export async function getAllDepositAddresses(
  env: Env,
  nearAccount: string,
  bypassCache = false,
  opts: { xId?: string } = {}
): Promise<DepositAddress[]> {
  const railOn = ['true', '1', 'yes'].includes(
    (env.CONFIDENTIAL_RAIL_ENABLED || '').trim().toLowerCase()
  );
  const confidential = Boolean(railOn && opts.xId);
  const uniqueChains = ['eth', 'btc', 'sol', 'base', 'arbitrum', 'near', 'robinhood'];
  const chainMap = new Map<string, DepositAddress>();

  // 1. Load cached addresses from D1 first
  if (!bypassCache && env.DB) {
    try {
      const { results } = await env.DB
        .prepare(
          `SELECT chain, chain_name, address, memo, expires_at FROM deposit_addresses
            WHERE account_id = ? AND (expires_at IS NULL OR expires_at > ?)
              AND chain ${confidential ? "LIKE 'private_%'" : "NOT LIKE 'private_%'"}`
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
          // The D1 `chain` column stores the cache key (`base_usdc`,
          // `private_base_usdc`), not the bare network. Normalize it so cached
          // rows are actually reused instead of re-quoting every chain.
          const key = row.chain.startsWith('private_')
            ? row.chain.slice('private_'.length)
            : row.chain;
          const chain = key.split('_')[0] || key;
          chainMap.set(chain, {
            chain,
            chainName: row.chain_name || chain,
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
    .filter(Boolean)
    .map((cfg) => (confidential ? { ...cfg, key: `private_${cfg.key}` } : cfg));

  let userSession: string | undefined;
  if (confidential && missingConfigs.length > 0) {
    try {
      const { getUserSession } = await import('./oneclickAuth');
      userSession = (await getUserSession(env, opts.xId!)).accessToken;
    } catch (err: any) {
      console.warn('[nearRpc] could not mint User-Session for confidential deposits:', err?.message || err);
      return [];
    }
  }

  if (missingConfigs.length > 0) {
    const fetchPromises = missingConfigs.map(async (cfg) => {
      const fresh = await fetch1ClickDepositAddress(env, nearAccount, cfg, {
        confidential,
        userSession,
      });
      if (fresh) {
        chainMap.set(cfg.chain, fresh);
        await saveDepositAddress(env.DB, nearAccount, fresh, cfg.key);
      } else if (cfg.chain === 'near' && !confidential) {
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
        address: confidential ? '' : sc.chain === 'near' ? nearAccount : '',
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
          // Raw upstream units — see IntentTx.amount_source.
          amount_source: 'unknown',
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
          symbol: cleanMemeSymbol(tx.symbol || tx.asset_in || tx.defuse_asset_id_in || tx.asset_out || tx.defuse_asset_id_out || ''),
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
 * View-call check for whether `publicKey` is authorized to sign intents for
 * `accountId` on the verifier contract. Returns the contract's own
 * `has_public_key` answer; any RPC failure throws so callers can tell "not
 * registered" apart from "could not tell".
 */
async function intentsHasPublicKey(
  rpcUrl: string,
  accountId: string,
  publicKey: string
): Promise<boolean> {
  const res = await viewFunction(rpcUrl, 'intents.near', 'has_public_key', {
    account_id: accountId,
    public_key: publicKey,
  });
  return res === true;
}

/**
 * Guarantees the account's signing key is authorized on the verifier contract
 * (`intents.near`) before an intent is signed with it.
 *
 * Funds can be credited to a vault account without this registration, but every
 * `execute_intents` the user signs is rejected — panicking with a public-key
 * error — until the key is added. Because the first `add_public_key` is issued
 * moments after the account itself is created, it routinely loses a race where
 * the freshly added access key is not yet visible to the `finality: final` view
 * query; that silent miss is what stranded balances. This retries the
 * registration and, crucially, re-reads `has_public_key` to confirm it landed.
 *
 * Callers MUST refuse to submit a signed intent when this returns
 * `{ registered: false }` — submitting anyway strands the balance in intents.
 */
const verifiedIntentsKeyMem = new Map<string, number>();
const verifiedSubAccountMem = new Map<string, number>();
const VERIFIED_ACCOUNT_MEM_TTL_MS = 10 * 60 * 1000;

export async function ensureKeyOnIntents(
  env: Env,
  accountId: string,
  publicKey: Uint8Array,
  privateKey: Uint8Array
): Promise<{ registered: boolean; reason?: string }> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const publicKeyB58 = `ed25519:${base58Encode(publicKey)}`;
  const memoKey = `${rpcUrl}:${accountId}:${publicKeyB58}`;
  const memoAt = verifiedIntentsKeyMem.get(memoKey);
  if (memoAt && Date.now() - memoAt < VERIFIED_ACCOUNT_MEM_TTL_MS) {
    return { registered: true };
  }

  // Already registered? One view call keeps the hot path free for the common
  // case (repeat requests, and a key registered on a previous call).
  try {
    if (await intentsHasPublicKey(rpcUrl, accountId, publicKeyB58)) {
      verifiedIntentsKeyMem.set(memoKey, Date.now());
      return { registered: true };
    }
  } catch {
    // A dead/behind RPC must not be read as "not registered"; fall through and
    // let the registration attempt act as the source of truth.
  }

  // Sponsor the registration gas from escrow so the tx never depends on the
  // user's own account balance — the registration is a platform cost, exactly
  // like the intents storage registration.
  await ensureRegistrationGas(env, accountId);

  let lastError = '';
  // 2 attempts (1 retry), see nearRpc(): keep the subrequest budget in check.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    const ok = await registerKeyOnIntents(rpcUrl, accountId, publicKey, privateKey);
    if (ok) {
      verifiedIntentsKeyMem.set(memoKey, Date.now());
      return { registered: true };
    }
    // registerKeyOnIntents returns false both when the broadcast was rejected
    // pre-inclusion (visibility race) and when the tx landed as a failure;
    // either way, re-read to see whether a concurrent/prior attempt won.
    try {
      if (await intentsHasPublicKey(rpcUrl, accountId, publicKeyB58)) {
        verifiedIntentsKeyMem.set(memoKey, Date.now());
        return { registered: true };
      }
    } catch {}
    lastError = `add_public_key did not land for ${accountId}`;
  }

  console.warn(
    `[ensureKeyOnIntents] ${publicKeyB58} still unregistered for ${accountId}: ${lastError}`
  );
  return { registered: false, reason: lastError };
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
  // Retry transient RPC throttles (429) locally: this path broadcasts a signed
  // tx, so a throttled status/view read would otherwise build a tx from a stale
  // or empty block hash and surface as a bogus "Expired"/invalid tx.
  const rpcPost = async (payload: unknown): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status !== 429 || attempt >= 1) return res;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  };

  try {
    const checkRes = await rpcPost({
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
    });
    const checkData = (await checkRes.json()) as any;
    if (checkData.result?.result) {
      const hasKey = JSON.parse(new TextDecoder().decode(new Uint8Array(checkData.result.result)));
      if (hasKey) return true;
    }
  } catch {}

  try {
    const statusRes = await rpcPost({ jsonrpc: '2.0', id: 1, method: 'status', params: [] });
    const statusData = (await statusRes.json()) as any;
    const latestBlockHash = base58Decode(statusData?.result?.sync_info?.latest_block_hash || '');

    const keyRes = await rpcPost({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: {
        request_type: 'view_access_key',
        finality: 'final',
        account_id: subAccount,
        public_key: userPubKeyB58,
      },
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
    // 5 TGas: add_public_key burns ~2.5 TGas; at 10^9 yocto/gas (0.001 NEAR/TGas),
    // 5 TGas + 0.92 TGas action fee requires ~0.0059 NEAR upfront, fitting inside
    // the 0.01 NEAR initial sub-account balance after the 0.00182 NEAR storage lock
    // (whereas 40 TGas required 0.0409 NEAR and was rejected with NotEnoughBalance).
    w.writeU64(5000000000000n); // 5 TGas
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

    const regRes = await rpcPost({
      jsonrpc: '2.0',
      id: 1,
      method: 'broadcast_tx_commit',
      params: [base64Tx],
    });
    const regData = (await regRes.json()) as any;
    const ok = !!(regData?.result?.status?.SuccessValue !== undefined || regData?.result?.status?.SuccessReceiptId);
    if (!ok) {
      console.warn(
        `[registerKeyOnIntents] broadcast rejected (http ${regRes.status}) for ${subAccount}:`,
        JSON.stringify(regData).slice(0, 600)
      );
    }
    return ok;
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
  const pubKeyB58 = userPubKey ? `ed25519:${base58Encode(userPubKey)}` : '';
  const subMemoKey = `${rpcUrl}:${subAccount}:${pubKeyB58}`;
  const subMemoAt = verifiedSubAccountMem.get(subMemoKey);
  if (subMemoAt && Date.now() - subMemoAt < VERIFIED_ACCOUNT_MEM_TTL_MS) {
    return { success: true };
  }

  // Check if account already exists onchain. A failed RPC read is NOT evidence
  // the account is missing — creating it again would burn a sponsored tx and
  // leave the caller believing provisioning happened. Treat "unknown" as
  // "assume it exists" and let the real registration path confirm.
  let alreadyExists = false;
  try {
    alreadyExists = await accountExists(env, subAccount);
  } catch (existsErr) {
    console.warn('[nearRpc] accountExists unavailable during provisioning:', existsErr);
    alreadyExists = true;
  }
  if (alreadyExists) {
    if (userPubKey && userPrivKey) {
      // Verify the intent signing key is actually registered, not merely attempt
      // it: the account can exist while the key registration that followed its
      // creation quietly failed (an RPC throttle or a finality-visibility race).
      // Left unrepaired, a later signed intent panics on intents.near and strands
      // the balance. This runs on every authenticated app load, so stuck users
      // heal passively.
      const ensure = await ensureKeyOnIntents(env, subAccount, userPubKey, userPrivKey);
      if (!ensure.registered) {
        console.warn(
          `[nearRpc] intents key unregistered for ${subAccount} after ensure: ${ensure.reason}`
        );
      } else {
        verifiedSubAccountMem.set(subMemoKey, Date.now());
      }
    } else {
      verifiedSubAccountMem.set(subMemoKey, Date.now());
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

    // 4. Encode NEAR transaction (actions: CreateAccount, Transfer 0.01 NEAR for storage/gas, AddKey FullAccess)
    const w = new BorshWriter();
    w.writeString(escrowId);
    w.writePublicKey(escrowPubKey);
    w.writeU64(nonce);
    w.writeString(subAccount);
    w.writeBytes(latestBlockHash);

    w.writeU32(3); // 3 actions
    w.writeU8(0);  // action 0: CreateAccount
    w.writeU8(3);  // action 1: Transfer
    w.writeU128(10000000000000000000000n); // 0.01 NEAR (ample for 0.00264 NEAR storage + 0.004 NEAR gas limit + 50% buffer)
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
        const reg = await ensureKeyOnIntents(env, subAccount, userPubKey, userPrivKey).catch((regErr) => {
          console.warn('[nearRpc] ensureKeyOnIntents (provision) failed:', regErr);
          return { registered: false };
        });
        if (reg.registered) {
          verifiedIntentsKeyMem.set(`${rpcUrl}:${subAccount}:${pubKeyB58}`, Date.now());
          verifiedSubAccountMem.set(subMemoKey, Date.now());
        }
      } else {
        verifiedSubAccountMem.set(subMemoKey, Date.now());
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
  } catch (err: any) {
    // Only a definitive "no such account" answers false. Every other failure —
    // RPC outage, rate limit, timeout — is an unknown, and answering false for
    // those made /api/onchain/account report "no intent account", which is what
    // silently withholds a recipient's real balance. Propagate it so the route
    // can fail loudly instead of inventing an empty wallet.
    if (isUnknownAccountError(err)) return false;
    throw err;
  }
}

/**
 * True when an RPC error definitively means "this account does not exist".
 * The NEAR node reports that as HANDLER_ERROR / UNKNOWN_ACCOUNT; anything else
 * (HTTP 5xx, rate limiting, JSON decode) says nothing about existence.
 */
function isUnknownAccountError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('UNKNOWN_ACCOUNT') || /does not exist while viewing/.test(msg);
}

/**
 * Prefix for a settlement recorded when the broadcast timed out AFTER the
 * funds had already moved (verified by comparing the plain balance before and
 * after). The transfer landed but its tx hash was lost with the connection.
 *
 * Unlike the other synthetic prefixes, a settled-unknown row is treated as
 * SETTLED by the balance accounting (the onchain balance already reflects the
 * movement, so subtracting it again would double-count the debit). It is the
 * one synthetic form that `isSyntheticTxHash` deliberately answers `false` for.
 */
export const SETTLED_UNKNOWN_PREFIX = 'settled_unknown_';

export function settledUnknownHash(id: string): string {
  return `${SETTLED_UNKNOWN_PREFIX}${id}`;
}

export function isSyntheticTxHash(h?: string | null): boolean {
  if (!h) return true;
  // Settled-unknown means the movement already happened — it must be counted
  // as settled, not as an unsettled synthetic placeholder. Checked first so
  // it can never be misclassified by the heuristics below.
  if (h.startsWith(SETTLED_UNKNOWN_PREFIX)) return false;
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
  const fallbackRpcUrl = 'https://free.rpc.fastnear.com';
  const escrowId = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const privKeyStr = env.ESCROW_PRIVATE_KEY;
  if (!privKeyStr) {
    return { success: false, error: 'ESCROW_PRIVATE_KEY is missing' };
  }

  let activeRpcUrl = rpcUrl;
  const readRpc = async (method: string, params: Record<string, unknown>) => {
    try {
      const result = await nearRpc(rpcUrl, method, params);
      activeRpcUrl = rpcUrl;
      return result;
    } catch (primaryErr: any) {
      if (rpcUrl === fallbackRpcUrl) throw primaryErr;
      console.warn(
        `[intents] ${method} via primary RPC failed, retrying on FastNEAR:`,
        primaryErr?.message || primaryErr
      );
      const result = await nearRpc(fallbackRpcUrl, method, params);
      activeRpcUrl = fallbackRpcUrl;
      return result;
    }
  };

  let broadcastAttempted = false;
  try {
    const escrowRawKey = base58Decode(privKeyStr);
    const escrowPrivKey = escrowRawKey.slice(0, 32);
    const escrowPubKey = ed25519.getPublicKey(escrowPrivKey);
    const escrowPubKeyB58 = `ed25519:${base58Encode(escrowPubKey)}`;

    let statusData: any;
    try {
      statusData = await readRpc('status', {});
    } catch (statusErr: any) {
      console.warn('[intents] status RPC failed:', statusErr?.message || statusErr);
      return {
        success: false,
        error: `NEAR RPC unavailable: ${statusErr?.message || String(statusErr)}`,
      };
    }
    const latestBlockHash = base58Decode(statusData?.sync_info?.latest_block_hash || '');
    if (latestBlockHash.length === 0) {
      return { success: false, error: 'NEAR RPC status returned no latest block hash' };
    }

    let keyData: any;
    try {
      keyData = await readRpc('query', {
        request_type: 'view_access_key',
        finality: 'final',
        account_id: escrowId,
        public_key: escrowPubKeyB58,
      });
    } catch (keyErr: any) {
      const detail = keyErr?.message || String(keyErr);
      console.warn(`[intents] escrow key query failed for ${escrowPubKeyB58}:`, detail);
      return { success: false, error: `Escrow key query failed: ${detail}` };
    }
    if (keyData?.nonce === undefined || keyData?.nonce === null) {
      console.warn(
        `[intents] escrow key ${escrowPubKeyB58} is not registered on ${escrowId}`
      );
      return {
        success: false,
        error: `Escrow key query failed: ${escrowPubKeyB58} is not registered on ${escrowId}`,
      };
    }
    const nonce = BigInt(keyData.nonce) + 1n;

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
    const broadcastRes = await fetch(activeRpcUrl, {
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
    // The real reason lives in error.data / status.Failure — the bare message
    // is always the useless "Server error".
    const failure = bData?.result?.status?.Failure;
    const err =
      `${bData?.error?.message || 'broadcast rejected'}` +
      `${formatRpcErrorData(bData?.error?.data)}` +
      `${failure ? ` | ${JSON.stringify(failure)}` : ''}`;
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

    // A signed intent is only accepted if intents.near already knows this key.
    // Prove it — and register it now if the provisioning step lost the
    // post-creation visibility race — before signing, so a new account's first
    // transfer does not panic inside the contract.
    const keyReady = await ensureKeyOnIntents(
      env,
      senderId,
      senderDerived.publicKey,
      senderDerived.privateKey
    );
    if (!keyReady.registered) {
      return {
        success: false,
        error: 'Your signing key is not set up on NEAR Intents yet — please try again in a moment.',
      };
    }

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
 * Strict plain-balance reads for rail/decision logic: they return `null` when
 * the RPC read failed instead of a fabricated `0n`. A transport failure must
 * never be mistaken for "this account holds nothing", which misclassifies a
 * funded deposit as INSUFFICIENT_PLAIN_BALANCE and routes the caller down the
 * wrong rail (or refuses a withdrawal it should complete).
 */
export async function getPlainFtBalanceStrict(
  rpcUrl: string,
  contractId: string,
  accountId: string
): Promise<bigint | null> {
  try {
    const res = await viewFunction(rpcUrl, contractId, 'ft_balance_of', { account_id: accountId });
    return BigInt(res || '0');
  } catch {
    return null;
  }
}

async function getPlainNearBalanceStrict(
  rpcUrl: string,
  accountId: string
): Promise<bigint | null> {
  try {
    const res: any = await nearRpc(rpcUrl, 'query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });
    return BigInt(res?.amount ?? res?.result?.amount ?? '0');
  } catch {
    return null;
  }
}

/**
 * Resolves a token from the curated/Rhea registries, falling back to live
 * `ft_metadata` for a brand-new launchpad token that neither registry has
 * indexed yet. Creator-fee payouts must not depend on registry lag.
 */
async function resolveTokenWithMetadata(env: Env, asset: string): Promise<OnchainToken | null> {
  const tokens = await getSupportedTokens(env);
  const known = resolveTokenForAsset(asset, tokens) || (await resolveRheaToken(env, asset));
  if (known) return known;

  const contractId = (asset.trim().toLowerCase().startsWith('nep141:')
    ? asset.trim().slice(7)
    : asset.trim()).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(contractId)) return null;
  const meta = await getFtContractMetadata(env, contractId);
  if (!meta) return null;
  return {
    defuse_asset_id: `nep141:${contractId}`,
    symbol: meta.symbol,
    name: meta.symbol,
    decimals: meta.decimals,
    nearContractId: contractId,
    chain: 'near',
  };
}

/**
 * Onchain intents balance for one asset, in base units. Returns `null` when the
 * balance cannot be read, so callers never mistake an RPC failure for "the
 * intents ledger is empty" and burn gas depositing a duplicate amount.
 */
export async function getIntentAssetBalance(
  env: Env,
  asset: string,
  nearAccount: string
): Promise<{ balance: bigint; decimals: number } | null> {
  try {
    if (!nearAccount) return null;
    const token = await resolveTokenWithMetadata(env, asset);
    if (!token?.defuse_asset_id) return null;
    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';
    const raw = await viewFunction(rpcUrl, contractId, 'mt_balance_of', {
      account_id: nearAccount,
      token_id: token.defuse_asset_id,
    });
    return {
      balance: BigInt(String(raw ?? '0')),
      decimals: token.decimals ?? 18,
    };
  } catch {
    return null;
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
    return await getPlainFtBalanceStrict(rpcUrl, token.nearContractId, nearAccount);
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
 * Flattens the nested `error.data` an NEAR RPC attaches to a rejected
 * transaction into a single readable reason. Both failure shapes matter: the
 * tx-level rejections, which are one flat string, and contract panics, which
 * nest several layers deep and must stay intact so the original panic text
 * survives into the API response.
 */
function formatRpcErrorData(data: unknown): string {
  if (data === undefined || data === null || data === '') return '';
  if (typeof data === 'string') return `: ${data}`;
  try {
    const anyData = data as Record<string, unknown>;
    const txErr = anyData.TxExecutionError;
    if (typeof txErr === 'string') return `: ${txErr}`;
    if (txErr && typeof txErr === 'object') {
      const inner = txErr as Record<string, unknown>;
      if (typeof inner.InvalidTxError === 'string') return `: ${inner.InvalidTxError}`;
      return `: ${JSON.stringify(txErr)}`;
    }
    return `: ${JSON.stringify(data)}`;
  } catch {
    return `: ${String(data)}`;
  }
}

/**
 * Signs and broadcasts a single-action FunctionCall transaction.
 * Mirrors the Borsh + ed25519 flow used by createOnchainSubAccount.
 *
 * Retries a rejection that happened before inclusion, up to three times with a
 * short backoff. The common case is back-to-back broadcasts — a token
 * registration immediately followed by the transfer it exists to enable —
 * where the second read of the access-key nonce has not caught up with the
 * first transaction yet, so it signs a nonce that is no longer strictly
 * greater and is refused with no history entry, which surfaces as a
 * mysterious "Server error". A timeout is never retried: there the
 * transaction may already be on chain.
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
  if (opts.method === 'ft_transfer_call') {
    let receiver = '';
    try {
      const parsed = JSON.parse(opts.args) as { receiver_id?: unknown };
      receiver = typeof parsed?.receiver_id === 'string' ? parsed.receiver_id.trim().toLowerCase() : '';
    } catch {
      receiver = '';
    }
    // escrow.uprail.near and the user vaults are plain accounts. A transfer-call
    // to them fails and refunds. The only allowed receiver is intents.near.
    if (receiver !== 'intents.near') {
      return {
        ok: false,
        error: 'ft_transfer_call receiver must be intents.near. Plain accounts take ft_transfer.',
      };
    }
  }
  let last: BroadcastAttempt = { ok: false, error: 'not attempted' };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
    last = await broadcastFunctionCallOnce(opts);
    // `rejected` is set only when the node answered with a JSON-RPC error
    // instead of a transaction: it refused the transaction before including
    // it, so broadcasting again cannot double-spend. `result.status.Failure`
    // is the opposite case — the transaction landed and failed — and is
    // returned to the caller immediately.
    if (last.ok || !last.rejected) return last;
    console.warn(
      `[nearRpc] ${opts.signerId} broadcast rejected before inclusion (attempt ${attempt + 1}): ${last.error}`
    );
  }
  return last;
}

interface BroadcastAttempt {
  ok: boolean;
  txHash?: string;
  error?: string;
  /** True when the node refused the transaction before including it. */
  rejected?: boolean;
}

async function broadcastFunctionCallOnce(opts: {
  rpcUrl: string;
  signerId: string;
  signerPrivKey: Uint8Array;
  signerPubKey: Uint8Array;
  receiverId: string;
  method: string;
  args: string;
  gas: bigint;
  deposit: bigint;
}): Promise<BroadcastAttempt> {
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
      const rpcErr = txResult?.error;
      const errMsg =
        rpcErr?.message ||
        JSON.stringify(txResult?.result?.status?.Failure || txResult?.result || txResult);
      // NEAR RPCs answer every rejected transaction with the same bare
      // "Server error"; the actionable cause — InvalidNonce, Expired,
      // NotEnoughBalance, or the contract's own panic — lives only in
      // `error.data`, so dropping it makes every failure undiagnosable.
      return {
        ok: false,
        rejected: true,
        error: `${errMsg}${formatRpcErrorData(rpcErr?.data)}`,
      };
    }
    return { ok: true, txHash: txResult?.result?.transaction?.hash };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Signs and broadcasts a plain NEAR transfer from `signerId` to `receiverId`.
 * Used to sponsor a platform cost (e.g. gas for registering a user's intents
 * key) out of the escrow wallet instead of the user's own account.
 */
async function signAndBroadcastNearTransfer(opts: {
  rpcUrl: string;
  signerId: string;
  signerPrivKey: Uint8Array;
  signerPubKey: Uint8Array;
  receiverId: string;
  amount: bigint;
}): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const { rpcUrl, signerId, signerPrivKey, signerPubKey, receiverId, amount } = opts;
  try {
    const statusRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'tr_status', method: 'status', params: [] }),
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
        id: 'tr_nonce',
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
    w.writeU8(3);  // Transfer
    w.writeU128(amount);

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
        id: 'tr_tx',
        method: 'broadcast_tx_commit',
        params: [btoa(binary)],
      }),
    });
    const txResult = (await txRes.json()) as any;
    const ok =
      txResult?.result?.status?.SuccessValue !== undefined ||
      txResult?.result?.status?.SuccessReceiptId !== undefined;
    if (!ok) {
      const rpcErr = txResult?.error;
      const errMsg =
        rpcErr?.message ||
        JSON.stringify(txResult?.result?.status?.Failure || txResult?.result || txResult);
      return { ok: false, error: `${errMsg}${formatRpcErrorData(rpcErr?.data)}` };
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
      amount_source: 'human',
      symbol: cleanMemeSymbol(meta.symbol || meta.name || h.contractId),
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

// ─── 1Click deposit-address deposit events ───────────────────────────────────
/**
 * Deposits made through a 1Click deposit address are reconstructed from the
 * per-address status API — but that API only ever reports the address's
 * *latest* deposit. Two deposits to the same (reused) address therefore looked
 * like the second replaced the first, both in the transaction list and in the
 * "Received this week" total. We persist each distinct deposit (keyed by its
 * origin tx) so history accumulates instead of overwriting.
 */
const ONECLICK_DEPOSIT_EVENTS_KEY = (account: string) => `onclick_deposits:v1:${account}`;
const ONECLICK_DEPOSIT_TTL_S = 30 * 24 * 3600;
const ONECLICK_DEPOSIT_EVENT_LIMIT = 50;

async function readOneClickDepositEvents(env: Env, nearAccount: string): Promise<IntentTx[]> {
  const cache = (env as any).CACHE;
  if (!cache) return [];
  try {
    const raw = await cache.get(ONECLICK_DEPOSIT_EVENTS_KEY(nearAccount));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IntentTx[]) : [];
  } catch {
    return [];
  }
}

/** Persist newly detected deposits and return the accumulated (deduped) list. */
export async function recordOneClickDepositEvents(
  env: Env,
  nearAccount: string,
  detected: IntentTx[]
): Promise<IntentTx[]> {
  if (!nearAccount) return detected;
  const prev = await readOneClickDepositEvents(env, nearAccount);
  const merged = [...detected, ...prev]
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .slice(0, ONECLICK_DEPOSIT_EVENT_LIMIT);

  const cache = (env as any).CACHE;
  if (cache && detected.length > 0) {
    try {
      await cache.put(ONECLICK_DEPOSIT_EVENTS_KEY(nearAccount), JSON.stringify(merged), {
        expirationTtl: ONECLICK_DEPOSIT_TTL_S,
      });
    } catch (err) {
      console.warn('[nearRpc] 1Click deposit event write failed:', err);
    }
  }
  return merged;
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
      const unknownHeld = held
        .filter((h) => {
          const cl = h.contractId.toLowerCase();
          return (
            cl !== 'wrap.near' &&
            cl.endsWith('.near') &&
            !rheaByContract.has(cl) &&
            !regByContract.has(cl)
          );
        })
        .slice(0, 4);
      if (unknownHeld.length > 0) {
        const metas = await Promise.all(
          unknownHeld.map((h) => getFtContractMetadata(env, h.contractId))
        );
        for (const m of metas) {
          if (m && m.symbol) {
            rheaByContract.set(m.contractId.toLowerCase(), {
              contractId: m.contractId,
              symbol: m.symbol,
              name: m.name || m.symbol,
              decimals: m.decimals,
              icon: '',
            });
          }
        }
      }
      for (const h of held) pushHeld(h.contractId, h.balance);

      const isNearFtToken = (t: OnchainToken): boolean => {
        const c = (t.nearContractId || '').trim().toLowerCase();
        if (!c || c.startsWith('0x')) return false;
        if (!(t.defuse_asset_id || '').toLowerCase().startsWith('nep141:')) return false;
        return c.includes('.') || /^[0-9a-f]{64}$/.test(c);
      };

      // Index lag guard: verify a handful of high-value registry assets that
      // FastNEAR has not reported yet, so a just-arrived wNEAR/USDC transfer
      // is not missing for an index cycle. Capped to stay inside the budget.
      const missing = registry
        .filter((t) => isNearFtToken(t) && !coveredContracts.has(t.nearContractId.toLowerCase()))
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
      const tokens = registry
        .filter((t) => {
          const c = (t.nearContractId || '').trim().toLowerCase();
          if (!c || c.startsWith('0x')) return false;
          if (!(t.defuse_asset_id || '').toLowerCase().startsWith('nep141:')) return false;
          return c.includes('.') || /^[0-9a-f]{64}$/.test(c);
        })
        .slice(0, PLAIN_SCAN_FALLBACK_MAX);
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

  // The deposit is included by the time the broadcast returns, but a
  // `finality: 'final'` read immediately after can still land on the block
  // before it and answer `null`. That reads as "the contract refused to
  // register" and wrongly aborts a perfectly good withdrawal, so re-read a
  // few times before believing it.
  for (let attempt = 0; attempt < 4; attempt++) {
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
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  return {
    ok: false,
    registered: false,
    reason: `Token contract did not register storage for ${receiverId} — this asset cannot be moved to it`,
  };
}

/**
 * Policy: register-then-transfer. Ensures `intents.near` holds NEP-145 storage
 * on `contractId` so an asset whose token contract never registered intents can
 * still be delivered through the intents rail instead of being permanently
 * pinned to the native rail. NEP-145 `storage_deposit` is permissionless and
 * the integration cost is sponsored from escrow, exactly like the per-deposit
 * registration in `depositPlainBalanceToIntents`. Callers fall back to the
 * native rail only when this returns `{ registered: false }`.
 */
export async function ensureIntentsStorageRegistered(
  env: Env,
  contractId: string
): Promise<{ registered: boolean; reason?: string }> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const sponsor = escrowSigningKey(env, rpcUrl);
  if ('error' in sponsor) return { registered: false, reason: sponsor.error };
  const res = await ensureReceiverStorageRegistered(rpcUrl, contractId, intentsId, sponsor);
  return { registered: res.registered, reason: res.reason };
}

/**
 * Registers the platform escrow holding account on a NEP-141 contract so a
 * launchpad's fee push is accepted. Registration is permissionless and
 * sponsored from escrow itself; the memo cache makes it one transaction per
 * token at most, so subsequent route/sync calls are free.
 */
export async function ensureEscrowStorageRegistered(
  env: Env,
  contractId: string
): Promise<{ registered: boolean; reason?: string }> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  const escrowId = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const sponsor = escrowSigningKey(env, rpcUrl);
  if ('error' in sponsor) return { registered: false, reason: sponsor.error };
  const res = await ensureReceiverStorageRegistered(rpcUrl, contractId, escrowId, sponsor);
  return { registered: res.registered, reason: res.reason };
}

export interface FtContractMetadata {
  contractId: string;
  symbol: string;
  name: string;
  decimals: number;
  /** NEP-141 `description`, when the contract exposes one. Used to resolve a
   *  creator-fee recipient from the token itself ("Fees to @handle via UPRAIL"). */
  description?: string;
}

/**
 * Reads NEP-141 `ft_metadata` straight from the contract. Used for launchpad
 * paired tokens that a launchpad names by contract id but that the curated /
 * Rhea registries do not (yet) list. Returns null when the contract does not
 * answer, so callers can reject an unknown or non-FT contract.
 */
const ftMetaMemCache = new Map<string, { at: number; meta: FtContractMetadata | null }>();
const FT_META_MEM_TTL_MS = 10 * 60 * 1000;
const FT_META_KV_TTL_S = 6 * 3600;

export async function getFtContractMetadata(
  env: Env,
  contractId: string
): Promise<FtContractMetadata | null> {
  const cl = (contractId || '').trim().toLowerCase();
  if (!cl) return null;

  const memo = ftMetaMemCache.get(cl);
  if (memo && Date.now() - memo.at < FT_META_MEM_TTL_MS) return memo.meta;

  const kvKey = `ft_meta:v1:${cl}`;
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(kvKey, 'json');
      if (cached && typeof cached === 'object' && 'symbol' in (cached as any)) {
        const meta = cached as FtContractMetadata;
        ftMetaMemCache.set(cl, { at: Date.now(), meta });
        return meta;
      }
    } catch {}
  }

  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  try {
    const meta = await viewFunction(rpcUrl, cl, 'ft_metadata', {});
    if (!meta || typeof meta !== 'object') {
      ftMetaMemCache.set(cl, { at: Date.now(), meta: null });
      return null;
    }
    const decimals = Number(meta.decimals);
    const out: FtContractMetadata = {
      contractId: cl,
      symbol: typeof meta.symbol === 'string' ? meta.symbol : '',
      name: typeof meta.name === 'string' ? meta.name : '',
      decimals: Number.isFinite(decimals) ? decimals : 18,
      description: typeof meta.description === 'string' ? meta.description : undefined,
    };
    ftMetaMemCache.set(cl, { at: Date.now(), meta: out });
    if (env.CACHE) {
      await env.CACHE.put(kvKey, JSON.stringify(out), { expirationTtl: FT_META_KV_TTL_S }).catch(() => {});
    }
    return out;
  } catch {
    return null;
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
    // The registration is a platform integration cost, so it is sponsored from
    // the escrow balance instead of being charged to the user's own account.
    const sponsor = escrowSigningKey(env, rpcUrl);
    if ('error' in sponsor) {
      return { deposited: false, reason: sponsor.error };
    }
    const storage = await ensureReceiverStorageRegistered(rpcUrl, contractId, intentsId, sponsor);
    if (!storage.registered) {
      return { deposited: false, reason: storage.reason || 'intents is not registered on this token' };
    }

    // 1. Plain NEP-141 balance on the token contract covers it → single tx.
    const plainFt = await getPlainFtBalanceStrict(rpcUrl, contractId, senderAccountId);
    if (plainFt === null) {
      return { deposited: false, reason: 'PLAIN_BALANCE_UNAVAILABLE' };
    }
    if (plainFt >= BigInt(baseUnits)) {
      // 45 TGas at 10^9 yocto/gas requires ~0.046 NEAR upfront plus ~0.002 NEAR storage;
      // top up the user's sub-account from escrow if it only holds the initial 0.01 NEAR.
      await ensureRegistrationGas(env, senderAccountId, 52000000000000000000000n);
      const res = await signAndBroadcastFunctionCall({
        ...senderKey,
        receiverId: contractId,
        method: 'ft_transfer_call',
        args: JSON.stringify({ receiver_id: intentsId, amount: baseUnits, msg: creditAddress }),
        gas: 45_000_000_000_000n,
        deposit: 1n,
      });
      return res.ok
        ? { deposited: true, txHash: res.txHash }
        : { deposited: false, reason: res.error || 'ft_transfer_call failed' };
    }

    // 2. Plain native NEAR (NEAR asset only): wrap to wNEAR first, then the
    //    same ft_transfer_call — keeping a gas reserve for both transactions.
    if (isNearNative && contractId === 'wrap.near') {
      const plainNear = await getPlainNearBalanceStrict(rpcUrl, senderAccountId);
      if (plainNear === null) {
        return { deposited: false, reason: 'PLAIN_BALANCE_UNAVAILABLE' };
      }
      const gasReserve = 10000000000000000000000n; // 0.01 NEAR
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
        await ensureRegistrationGas(env, senderAccountId, 52000000000000000000000n);
        const res = await signAndBroadcastFunctionCall({
          ...senderKey,
          receiverId: 'wrap.near',
          method: 'ft_transfer_call',
          args: JSON.stringify({ receiver_id: intentsId, amount: baseUnits, msg: creditAddress }),
          gas: 45_000_000_000_000n,
          deposit: 1n,
        });
        return res.ok
          ? { deposited: true, txHash: res.txHash }
          : { deposited: false, reason: res.error || 'ft_transfer_call (wNEAR) failed' };
      }
      if (plainNear > 0n) {
        // Native NEAR is held but withdrawing this amount would leave less than
        // the gas reserve needed to wrap + transfer. Return the exact shortfall
        // so the caller can explain it, instead of failing later on an empty
        // intents balance with a cryptic error.
        const shortfall = BigInt(baseUnits) + gasReserve - plainNear;
        return {
          deposited: false,
          reason: `NEAR_GAS_RESERVE_SHORTFALL:${shortfall.toString()}`,
        };
      }
    }

    return { deposited: false, reason: 'INSUFFICIENT_PLAIN_BALANCE' };
  } catch (err: any) {
    return { deposited: false, reason: err?.message || String(err) };
  }
}

/**
 * Moves plain NEP-141 creator fees held directly by `escrow.uprail.near` into
 * the escrow account's public Intents balance. This is the first leg for a
 * private creator-fee payout: launchpads push fees as ordinary NEP-141, while
 * Confidential Intents can only spend a public Intents balance.
 */
export async function depositEscrowPlainBalanceToIntents(
  env: Env,
  asset: string,
  amount: string
): Promise<{ deposited: boolean; txHash?: string; reason?: string }> {
  try {
    const token = await resolveTokenWithMetadata(env, asset);
    if (!token?.nearContractId) return { deposited: false, reason: `Unsupported asset: ${asset}` };

    const baseUnits = toBaseUnits(amount, token.decimals);
    if (!baseUnits || baseUnits === '0') {
      return { deposited: false, reason: `Invalid amount: ${amount}` };
    }

    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const signing = escrowSigningKey(env, rpcUrl);
    if ('error' in signing) return { deposited: false, reason: signing.error };

    const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
    const contractId = token.nearContractId;
    const storage = await ensureReceiverStorageRegistered(rpcUrl, contractId, intentsId, signing);
    if (!storage.registered) {
      return { deposited: false, reason: storage.reason || `intents is not registered on ${contractId}` };
    }

    const plain = await getPlainFtBalanceStrict(rpcUrl, contractId, signing.signerId);
    if (plain === null) return { deposited: false, reason: 'PLAIN_BALANCE_UNAVAILABLE' };
    if (plain < BigInt(baseUnits)) return { deposited: false, reason: 'INSUFFICIENT_PLAIN_BALANCE' };

    const res = await signAndBroadcastFunctionCall({
      ...signing,
      receiverId: contractId,
      method: 'ft_transfer_call',
      args: JSON.stringify({ receiver_id: intentsId, amount: baseUnits, msg: signing.signerId }),
      gas: 100_000_000_000_000n,
      deposit: 1n,
    });
    return res.ok
      ? { deposited: true, txHash: res.txHash }
      : { deposited: false, reason: res.error || 'ft_transfer_call from escrow failed' };
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

// Gas the user's own account must hold to broadcast its add_public_key tx.
// 5 TGas + 0.92 TGas action fee costs ~0.0059 NEAR at 10^9 yocto/Gas on mainnet;
// 0.01 NEAR leaves ample headroom for account storage (0.00182 NEAR) and gas.
const INTENTS_KEY_REGISTRATION_GAS = 10000000000000000000000n; // 0.01 NEAR

/**
 * Guarantees the user's own account can pay for its `intents.near.add_public_key`
 * (or plain FT transfer) transaction. The gas is a platform integration cost, so
 * any shortfall is transferred in from the escrow wallet rather than being
 * charged against the user's balance. No-op once the account is already funded.
 */
export async function ensureRegistrationGas(
  env: Env,
  accountId: string,
  requiredNear: bigint = INTENTS_KEY_REGISTRATION_GAS
): Promise<boolean> {
  const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
  try {
    const balance = await getPlainNearBalanceStrict(rpcUrl, accountId);
    if (balance === null) return false;
    if (balance >= requiredNear) return true;

    const sponsor = escrowSigningKey(env, rpcUrl);
    if ('error' in sponsor) {
      console.warn('[ensureRegistrationGas]', sponsor.error);
      return false;
    }
    const res = await signAndBroadcastNearTransfer({
      ...sponsor,
      receiverId: accountId,
      amount: requiredNear - balance,
    });
    if (!res.ok) {
      console.warn(`[ensureRegistrationGas] top-up failed for ${accountId}:`, res.error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[ensureRegistrationGas] failed:', err);
    return false;
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
    // Sponsored from escrow's own balance — registering itself, so the user's
    // account never funds a platform cost just to send their own funds.
    const sponsor = escrowSigningKey(env, rpcUrl);
    if ('error' in sponsor) {
      return { deposited: false, reason: sponsor.error };
    }
    const storage = await ensureReceiverStorageRegistered(rpcUrl, contractId, escrowId, sponsor);
    if (!storage.registered) {
      return { deposited: false, reason: storage.reason || `escrow is not registered on ${contractId}` };
    }

    await ensureRegistrationGas(env, senderAccountId, 20000000000000000000000n);
    const res = await signAndBroadcastFunctionCall({
      ...senderKey,
      receiverId: contractId,
      method: 'ft_transfer',
      args: JSON.stringify({ receiver_id: escrowId, amount: baseUnits }),
      gas: 15_000_000_000_000n,
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
 * Plain `ft_transfer` from the platform escrow account to a destination,
 * addressed by NEP-141 contract id rather than a registry asset. Used by
 * launchpad creator-fee routing, where the paired token may not be in the
 * curated/Rhea registries. Registers the destination on the token first
 * (sponsored from escrow) so the transfer cannot panic with "receiver is not
 * registered".
 */
export async function executeEscrowFtTransferByContract(
  env: Env,
  contractId: string,
  destinationAddress: string,
  baseUnits: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    if (!contractId || !baseUnits || baseUnits === '0') {
      return { success: false, error: 'Invalid contract or amount' };
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
 * Direct NEP-141 payout from the sender's own pk sub-account to an external
 * NEAR account — the withdrawal leg for NEAR-only assets that can never enter
 * intents.
 *
 * A launchpad meme is an ordinary NEP-141 on the holder's own account, but its
 * token contract has never registered storage on `intents.near`, so no intents
 * intent can ever spend it. The previous settlement locked the balance into
 * the escrow holding account and had escrow pay the destination out again — a
 * pure custody hop that cost two transactions and left the funds commingled in
 * escrow for the duration. This sends the balance straight from the sender to
 * the destination in one transfer instead. No fee is taken: the destination
 * receives exactly the requested amount.
 *
 * The destination is registered on the token first (sponsored from escrow, the
 * same platform-borne cost the escrow rail paid) because a plain `ft_transfer`
 * cannot auto-register a receiver and would otherwise panic with "The receiver
 * is not registered".
 */
export async function executeDirectFtWithdraw(
  env: Env,
  senderXId: string,
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

    // The signer must ALWAYS be the sender — the funds leave their own
    // account, so no other key can move them.
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

    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';

    // Pre-check the plain balance rather than signing a transfer the token
    // contract will reject. The withdrawable-balance preview counts intents
    // and plain together, so a balance that is stranded inside intents passes
    // the route-level check but can never be spent by a plain ft_transfer —
    // that must surface as a clean refusal, not an onchain panic.
    const plain = await getPlainFtBalanceStrict(rpcUrl, contractId, senderAccountId);
    if (plain === null) {
      return { success: false, error: 'PLAIN_BALANCE_UNAVAILABLE' };
    }
    if (plain < BigInt(baseUnits)) {
      return {
        success: false,
        error: 'INSUFFICIENT_PLAIN_BALANCE',
      };
    }

    // The sender pays for their own transfer's gas; the destination's storage
    // registration is a platform cost, sponsored from escrow exactly as the
    // escrow rail did.
    const sponsor = escrowSigningKey(env, rpcUrl);
    if ('error' in sponsor) return { success: false, error: sponsor.error };
    const storage = await ensureReceiverStorageRegistered(
      rpcUrl,
      contractId,
      destinationAddress,
      sponsor
    );
    if (!storage.registered) {
      return {
        success: false,
        error: storage.reason || `destination is not registered on ${contractId}`,
      };
    }

    await ensureRegistrationGas(env, senderAccountId, 20000000000000000000000n);
    const res = await signAndBroadcastFunctionCall({
      rpcUrl,
      signerId: senderAccountId,
      signerPrivKey: sender.privateKey,
      signerPubKey: sender.publicKey,
      receiverId: contractId,
      method: 'ft_transfer',
      args: JSON.stringify({ receiver_id: destinationAddress, amount: baseUnits }),
      gas: 15_000_000_000_000n,
      deposit: 1n,
    });
    return res.ok
      ? { success: true, txHash: res.txHash }
      : { success: false, error: res.error || 'ft_transfer to destination failed' };
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

    // Every ft_withdraw intent is signed with the user's key, and intents.near
    // rejects any signature from a key it never authorized. Prove the key is
    // registered — registering it now if a prior attempt lost the race — before
    // signing, so a new account's first withdrawal does not panic and strand
    // the balance inside intents.
    const keyReady = await ensureKeyOnIntents(
      env,
      senderId,
      senderDerived.publicKey,
      senderDerived.privateKey
    );
    if (!keyReady.registered) {
      return {
        success: false,
        error: 'Your signing key is not set up on NEAR Intents yet — please try again in a moment.',
      };
    }

    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    let nonceB64 = '';
    for (let i = 0; i < nonceBytes.length; i++) nonceB64 += String.fromCharCode(nonceBytes[i]);
    nonceB64 = btoa(nonceB64);

    const deadline = new Date(Date.now() + 3600000).toISOString();
    const contractId = token.nearContractId || token.defuse_asset_id.replace(/^nep141:/, '');

    // The destination must hold storage on the token contract before an
    // ft_withdraw intent can credit it. intents.near accepts the intent,
    // burns the balance, and when the token refuses the receipt it refunds
    // the whole withdraw — so a destination that has never held this token
    // would loop forever with a no-op. Register it first, sponsored from
    // escrow, exactly as the native and escrow payout rails do.
    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const sponsor = escrowSigningKey(env, rpcUrl);
    if ('error' in sponsor) {
      return { success: false, error: sponsor.error };
    }
    const storage = await ensureReceiverStorageRegistered(rpcUrl, contractId, destinationAddress, sponsor);
    if (!storage.registered) {
      return {
        success: false,
        error: storage.reason || `destination is not registered on ${contractId}`,
      };
    }

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


function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Settles a cross-chain withdrawal by moving the user's intents balance to the
 * 1Click quote's deposit address *inside* Intents — the deposit method 1Click
 * requires for a `depositType: INTENTS` quote.
 *
 * The quote's deposit address is an account within the Intents ledger (the
 * verifier contract), so the funds must arrive on that ledger. Sending a native
 * NEP-141 transfer to the address instead (`ft_withdraw`, as the native rail
 * does) credits its on-chain balance, which 1Click never observes for an
 * INTENTS quote: the swap stays PENDING_DEPOSIT forever and, because the NEAR
 * tx itself succeeds, the withdrawal is recorded COMPLETED while the
 * destination wallet receives nothing.
 *
 * 1Click hands back the exact NEP-413 intent to sign via `generate-intent`, so
 * the asset id, amount and receiver come straight from the quote and can never
 * drift here. We sign it with the user's derived key and relay it from escrow,
 * exactly like every other intents execution in this module.
 */
export async function executeCrossChainSwapTransfer(
  env: Env,
  senderXId: string,
  depositAddress: string
): Promise<{ success: boolean; txHash?: string; error?: string; ambiguous?: boolean }> {
  try {
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

    // Ensure the sender subaccount is live & its key is registered onchain
    // before it signs anything 1Click may present for execution.
    await createOnchainSubAccount(env, senderId, senderDerived.publicKey, senderDerived.privateKey);

    const keyReady = await ensureKeyOnIntents(
      env,
      senderId,
      senderDerived.publicKey,
      senderDerived.privateKey
    );
    if (!keyReady.registered) {
      return {
        success: false,
        error: 'Your signing key is not set up on NEAR Intents yet — please try again in a moment.',
      };
    }

    const intent = await generate1ClickSwapIntent(env, depositAddress, senderId);

    const nonceBytes = base64ToBytes(intent.payload.nonce);
    const nep413Bytes = nep413Serialize(intent.payload.message, nonceBytes, intent.payload.recipient);
    const digest = await crypto.subtle.digest('SHA-256', nep413Bytes);
    const sigBytes = ed25519.sign(new Uint8Array(digest), senderDerived.privateKey);

    const signedPayload = {
      standard: 'nep413',
      payload: {
        message: intent.payload.message,
        nonce: intent.payload.nonce,
        recipient: intent.payload.recipient,
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
 * Moves a just-credited NEAR-native meme off the intents ledger and onto the
 * recipient's own native balance.
 *
 * A meme payout is first credited into intents like any other asset, because
 * that is where the escrow holds it. But a meme is an ordinary NEP-141 on the
 * holder's account — its token contract has never registered storage on
 * `intents.near`, so it cannot stay there as a durable balance. Leaving it
 * inside intents hid it from FastNEAR's FT index, which is what
 * `getPlainBalances` reads, so the recipient appeared to hold nothing and
 * could not spend it.
 *
 * Warning-only by design: the recipient has already been paid at this point.
 * A failure to drop the balance to native must never roll back a settled
 * claim, so callers log the reason and continue.
 */
export async function dropNearNativeMemeToNative(
  env: Env,
  recipientXId: string,
  recipientNearAccount: string,
  asset: string,
  amount: string
): Promise<{ dropped: boolean; txHash?: string; reason?: string }> {
  try {
    if (!recipientXId || !recipientNearAccount) {
      return { dropped: false, reason: 'Missing recipient' };
    }

    const tokens = await getSupportedTokens(env);
    let token = resolveTokenForAsset(asset, tokens);
    if (!token) token = await resolveRheaToken(env, asset);
    if (!token) return { dropped: false, reason: `Unsupported asset: ${asset}` };

    const contractId =
      token.nearContractId || (token.defuse_asset_id || '').replace(/^nep141:/, '');
    if (!isNearNativeMemeAsset(token.symbol, contractId)) {
      return { dropped: false, reason: 'NOT_A_NEAR_NATIVE_MEME' };
    }

    // Nothing to drop if the payout did not actually land in intents. Read it
    // rather than assume it, so a payout that was settled natively in the
    // first place is not mistaken for a failed drop.
    let intentsBalance = 0n;
    try {
      const raw = await viewFunction(
        env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com',
        env.INTENTS_CONTRACT_ID || 'intents.near',
        'mt_balance_of',
        {
          account_id: recipientNearAccount,
          token_id: token.defuse_asset_id || `nep141:${contractId}`,
        }
      );
      intentsBalance = BigInt(String(raw ?? '0'));
    } catch (balErr) {
      console.warn('[dropNearNativeMemeToNative] intents balance read failed:', balErr);
      return { dropped: false, reason: 'Could not read the intents balance' };
    }

    const wantedStr = toBaseUnits(amount, token.decimals);
    let wanted = 0n;
    try {
      wanted = BigInt(wantedStr || '0');
    } catch {
      return { dropped: false, reason: `Invalid amount: ${amount}` };
    }
    if (wanted === 0n) return { dropped: false, reason: `Invalid amount: ${amount}` };
    if (intentsBalance < wanted) {
      return { dropped: false, reason: 'INTENTS_BALANCE_NOT_PRESENT' };
    }

    // The withdraw is a NEP-141 receipt into the recipient's own account, and
    // the token contract refuses a receiver it has never registered:
    // "The receiver is not registered". intents.near is strict about this and
    // rolls the whole withdraw back — burning the intents balance and refunding
    // it — so a recipient who has never held this meme natively would loop
    // forever with a no-op withdraw. Register them first, sponsored from
    // escrow so the registration cost is never charged to the recipient.
    const rpcUrl = env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com';
    const sponsor = escrowSigningKey(env, rpcUrl);
    if ('error' in sponsor) {
      return { dropped: false, reason: sponsor.error };
    }
    const storage = await ensureReceiverStorageRegistered(
      rpcUrl,
      contractId,
      recipientNearAccount,
      sponsor
    );
    if (!storage.registered) {
      return {
        dropped: false,
        reason: storage.reason || `${recipientNearAccount} is not registered on ${contractId}`,
      };
    }

    const res = await executeWithdrawIntent(env, recipientXId, recipientNearAccount, asset, amount);
    if (!res?.success || !res.txHash) {
      return { dropped: false, reason: res?.error || 'Withdraw intent failed' };
    }

    // A successful broadcast is NOT proof the balance moved. intents.near
    // accepts the ft_withdraw, burns the balance, and — when the token
    // contract refuses the receipt — refunds it with an `mt_mint` marked
    // "refund", all inside a transaction that reports SuccessValue. Verify the
    // balance actually left intents rather than trusting the relay.
    try {
      const afterRaw = await viewFunction(
        env.NEAR_RPC_URL || 'https://free.rpc.fastnear.com',
        env.INTENTS_CONTRACT_ID || 'intents.near',
        'mt_balance_of',
        {
          account_id: recipientNearAccount,
          token_id: token.defuse_asset_id || `nep141:${contractId}`,
        }
      );
      const after = BigInt(String(afterRaw ?? '0'));
      if (after >= wanted) {
        return {
          dropped: false,
          txHash: res.txHash,
          reason: 'WITHDRAW_ROLLED_BACK: token contract refused the receipt and intents refunded it',
        };
      }
    } catch (verifyErr) {
      console.warn('[dropNearNativeMemeToNative] post-withdraw verify failed:', verifyErr);
    }

    return { dropped: true, txHash: res.txHash };
  } catch (err: any) {
    return { dropped: false, reason: err?.message || String(err) };
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
  if (!session.near_account && env.DB) {
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

  // Alias groups, matched by EXACT equality against the part after the chain
  // prefix. Substring tests are unusable here: "near" is a substring of every
  // ".near" account id, so an `includes` alias made UPTOBER, USDT and ETH all
  // match NEAR. That merged a meme's virtual balance into the NEAR row of
  // /api/onchain/balances and inflated getUserAvailableBalance(NEAR) with it,
  // so a token send showed up — and could be withdrawn — as NEAR.
  const aliasGroups: string[][] = [
    ['usdc', 'usdc.token.near', '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'],
    ['usdt', 'usdt.tether-token.near'],
    ['near', 'wrap.near', 'wnear'],
    ['eth', 'eth.bridge.near', 'weth'],
    ['btc', 'wbtc', '2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near', 'btc.omft.near'],
  ];
  for (const group of aliasGroups) {
    if (group.includes(cleanA) && group.includes(cleanB)) return true;
  }

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
      "SELECT asset, amount, claim_tx_hash, privacy_rail FROM payments WHERE (recipient_x_id = ? OR (recipient_x_id IS NULL AND LOWER(recipient_handle) = LOWER(?))) AND status = 'CLAIMED'"
    )
      .bind(session.x_id, session.x_handle)
      .all<{ asset: string; amount: string; claim_tx_hash?: string | null; privacy_rail?: string | null }>();

    for (const row of claimedRows.results || []) {
      // Confidential claims settle in Confidential Intents (already reflected in
      // getConfidentialBalances) and have claim_tx_hash scrubbed to NULL.
      if (row.privacy_rail === 'confidential') continue;
      if (isSyntheticTxHash(row.claim_tx_hash)) {
        add(row.asset, parseFloat(row.amount) || 0);
      }
    }

    // 2. Sent active payments by user (debited from balance)
    const sentRows = await env.DB.prepare(
      "SELECT asset, amount, fee, status, claim_tx_hash, intent_hash, privacy_rail FROM payments WHERE (sender_x_id = ? OR (sender_x_id IS NULL AND LOWER(sender_x_handle) = LOWER(?))) AND status IN ('PENDING', 'DEPOSIT_WAITING', 'ESCROWED', 'CLAIMED')"
    )
      .bind(session.x_id, session.x_handle)
      .all<{
        asset: string;
        amount: string;
        fee?: string;
        status: string;
        claim_tx_hash?: string | null;
        intent_hash?: string | null;
        privacy_rail?: string | null;
      }>();

    for (const row of sentRows.results || []) {
      // Confidential sends that reached ESCROWED or CLAIMED have already debited
      // the sender's Confidential Intents balance (and scrubSettledPaymentLinks
      // zeroes out claim_tx_hash / intent_hash).
      if (
        row.privacy_rail === 'confidential' &&
        (row.status === 'ESCROWED' || row.status === 'CLAIMED')
      ) {
        continue;
      }
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
      "SELECT asset, amount, status, tx_hash, privacy_rail FROM withdrawals WHERE x_id = ? AND status IN ('COMPLETED', 'PENDING')"
    )
      .bind(session.x_id)
      .all<{
        asset: string;
        amount: string;
        status: string;
        tx_hash?: string | null;
        privacy_rail?: string | null;
      }>();

    for (const row of withdrawnRows.results || []) {
      // Confidential withdrawals never touch the public Intents balance read
      // above; their pending amount is subtracted from the confidential
      // balance merge instead.
      if (row.privacy_rail === 'confidential') continue;
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
 *   (Live onchain balance in intents.near + Confidential Intents balance + D1 claimed virtual payments)
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

  // Confidential Intents balances are spendable on the private rail and never
  // appear in the public intents or plain FT reads above.
  const railEnabled = ['true', '1', 'yes'].includes(
    (env.CONFIDENTIAL_RAIL_ENABLED || '').trim().toLowerCase()
  );
  if (railEnabled) {
    try {
      const { getConfidentialAvailableBalance } = await import('./confidentialRail');
      const confidentialAmt = await getConfidentialAvailableBalance(env, session.x_id, targetAsset);
      if (confidentialAmt > 0) {
        onchainAmount += confidentialAmt;
      }
    } catch (confErr) {
      console.warn('[getUserAvailableBalance] confidential balance query error:', confErr);
    }
  }

  const deltas = await getVirtualBalanceDeltas(env, session, targetAsset);
  const netAvailable = onchainAmount + (deltas[targetAsset] || 0);
  return Math.max(0, netAvailable);
}
