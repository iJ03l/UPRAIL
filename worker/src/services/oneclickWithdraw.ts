/**
 * 1Click Cross-Chain Withdrawal Service
 *
 * Bridges funds held in confidential NEAR escrow out to destination chains
 * (EVM, Solana, Bitcoin) via 1Click Swap API (https://1click.chaindefuser.com).
 *
 * Fail-closed design:
 *   - Live quotes are requested from 1Click
 *   - The 1Click depositAddress (intents solver route on NEAR) is obtained
 *   - Escrow executes an intent transfer to the 1Click depositAddress
 *   - The deposit tx hash is reported to 1Click for solver settlement
 *   - No dummy transaction hashes or synthetic success states
 */

import type { Env } from '../types';

export interface CrossChainQuoteParams {
  destinationAddress: string;
  asset: string;
  amount: number;
  /**
   * Explicit destination network for an EVM address, which is otherwise
   * ambiguous (one 0x address lives on every EVM chain). When omitted, the
   * chain is inferred from the address shape exactly as before.
   */
  destinationChain?: string;
}

export interface CrossChainQuoteResult {
  depositAddress: string;
  quoteId?: string;
  amountIn: string;
  amountOut?: string;
  destinationAsset: string;
  originAsset: string;
}

// Regex patterns for supported address formats
export const NEAR_ACCOUNT_REGEX = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)*$/;
export const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const BITCOIN_ADDRESS_REGEX = /^(?:bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
// Classic XRP Ledger accounts and X-addresses. XRP classic addresses are
// case-sensitive base58 and can be shorter than Solana's 32-character floor,
// so they need their own check rather than piggy-backing on SOLANA_ADDRESS_REGEX.
export const XRP_ADDRESS_REGEX = /^(?:r[1-9A-HJ-NP-Za-km-z]{24,34}|X[1-9A-HJ-NP-Za-km-z]{45,49})$/;

export function isValidDestinationAddress(address: string): boolean {
  const clean = address.trim();
  if (!clean || clean.length > 100) return false;
  if (EVM_ADDRESS_REGEX.test(clean)) return true;
  if (BITCOIN_ADDRESS_REGEX.test(clean)) return true;
  if (XRP_ADDRESS_REGEX.test(clean)) return true;
  if (!clean.includes('.') && SOLANA_ADDRESS_REGEX.test(clean)) return true;
  if (clean.length <= 64 && NEAR_ACCOUNT_REGEX.test(clean)) return true;
  return false;
}

export function isNearAccountAddress(address: string): boolean {
  const clean = address.trim();
  // Solana addresses are base58 without dots, EVM starts with 0x, BTC starts with bc1/1/3
  if (EVM_ADDRESS_REGEX.test(clean)) return false;
  if (BITCOIN_ADDRESS_REGEX.test(clean)) return false;
  if (XRP_ADDRESS_REGEX.test(clean)) return false;
  if (!clean.includes('.') && SOLANA_ADDRESS_REGEX.test(clean)) {
    // If it contains uppercase letters or doesn't end in .near, it is Solana
    if (/[A-Z]/.test(clean) || clean.length !== 64) return false;
  }
  return clean.length <= 64 && NEAR_ACCOUNT_REGEX.test(clean);
}

/** Chain family used to sanity-check a chosen network against the address. */
export type ChainFamily = 'evm' | 'sol' | 'btc' | 'near';

/**
 * Families we can confidently check an address against. Chains that are not
 * listed (Sui, Aptos, TON, Tron, XRP, Stellar, …) are left to 1Click, which
 * validates the recipient and rejects an invalid one with "recipient is not
 * valid" — so the worker stays authoritative without mirroring 39 address
 * formats.
 */
const CHAIN_FAMILY: Record<string, ChainFamily> = {
  eth: 'evm',
  arb: 'evm',
  base: 'evm',
  op: 'evm',
  pol: 'evm',
  avax: 'evm',
  bsc: 'evm',
  gnosis: 'evm',
  scroll: 'evm',
  bera: 'evm',
  monad: 'evm',
  xlayer: 'evm',
  plasma: 'evm',
  abs: 'evm',
  hypercore: 'evm',
  sol: 'sol',
  btc: 'btc',
  near: 'near',
};

/** Human labels for the networks 1Click exposes (cosmetic only). */
export const CHAIN_NAMES: Record<string, string> = {
  near: 'NEAR',
  eth: 'Ethereum',
  arb: 'Arbitrum',
  base: 'Base',
  op: 'Optimism',
  pol: 'Polygon',
  avax: 'Avalanche',
  bsc: 'BNB Chain',
  gnosis: 'Gnosis',
  scroll: 'Scroll',
  bera: 'Berachain',
  monad: 'Monad',
  xlayer: 'X Layer',
  plasma: 'Plasma',
  abs: 'Abstract',
  hypercore: 'Hyperliquid',
  sol: 'Solana',
  btc: 'Bitcoin',
  doge: 'Dogecoin',
  sui: 'Sui',
  aptos: 'Aptos',
  ton: 'TON',
  tron: 'Tron',
  xrp: 'XRP Ledger',
  stellar: 'Stellar',
  cardano: 'Cardano',
  starknet: 'Starknet',
  movement: 'Movement',
  aleo: 'Aleo',
  adi: 'ADI',
  qtc: 'QTC',
  fogo: 'Fogo',
  litecoin: 'Litecoin',
  ltc: 'Litecoin',
  dash: 'Dash',
  zec: 'Zcash',
  bch: 'Bitcoin Cash',
};

/**
 * Resolved source asset for a withdrawal. The origin asset must be the EXACT
 * Intents asset the user holds — resolving by ticker alone used to send wBTC
 * as btc.omft.near, and would do the same for every duplicate ticker.
 */
interface ResolvedOrigin {
  assetId: string;
  symbol: string;
  decimals: number;
  chain: string;
}

/**
 * Native NEAR is the one asset the 1Click catalogue does not list as an
 * Intents origin. Keep that single special case; every other origin comes
 * from the live registry.
 */
const NATIVE_NEAR_ORIGIN: ResolvedOrigin = {
  assetId: 'wrap.near',
  symbol: 'NEAR',
  decimals: 24,
  chain: 'near',
};

const ONE_CLICK_TOKENS_KEY = '1click_tokens:v1';
// 30 minutes, not hours: new assets/chains are pulled on request, and a long
// cache made a freshly added 1Click route invisible for most of a day.
const ONE_CLICK_TOKENS_TTL = 30 * 60;

interface OneClickToken {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  contractAddress?: string;
}

function oneClickApiBase(env: Env): string {
  return (env.NEAR_API_BASE || 'https://1click.chaindefuser.com').replace(/\/$/, '');
}

/**
 * Live 1Click token catalogue, cached in KV for a short while. This is the
 * single source of truth for what can be sent where — hardcoding it rotted
 * (stale Optimism/Avalanche ids, missing Sui/Robinhood) within one release.
 */
async function fetchOneClickTokens(
  env: Env,
  apiBase: string,
  forceRefresh = false
): Promise<OneClickToken[]> {
  if (!forceRefresh) {
    try {
      const cached = await env.CACHE?.get(ONE_CLICK_TOKENS_KEY, 'json');
      if (Array.isArray(cached) && cached.length > 0) return cached as OneClickToken[];
    } catch {
      // fall through to a live fetch
    }
  }

  const resp = await fetch(`${apiBase}/v0/tokens`, {
    headers: { Accept: 'application/json', 'User-Agent': 'UPRAIL/1.0' },
  });
  if (!resp.ok) {
    throw new Error(`1Click token list failed (${resp.status})`);
  }
  const data = (await resp.json()) as unknown;
  const arr = Array.isArray(data)
    ? data
    : ((data as any)?.tokens || (data as any)?.data || []);
  const tokens: OneClickToken[] = (arr as any[])
    .map((t) => ({
      assetId: String(t?.assetId || ''),
      blockchain: String(t?.blockchain || ''),
      symbol: String(t?.symbol || ''),
      decimals: Number(t?.decimals ?? 0),
      contractAddress: t?.contractAddress ? String(t.contractAddress) : undefined,
    }))
    .filter((t) => t.assetId && t.blockchain && t.symbol);

  try {
    await env.CACHE?.put(ONE_CLICK_TOKENS_KEY, JSON.stringify(tokens), {
      expirationTtl: ONE_CLICK_TOKENS_TTL,
    });
  } catch {
    // a cache write failure must not fail the withdrawal
  }
  return tokens;
}

function toResolvedOrigin(token: OneClickToken): ResolvedOrigin {
  return {
    assetId: token.assetId,
    symbol: token.symbol.toUpperCase(),
    decimals: Number.isFinite(token.decimals) ? token.decimals : 0,
    chain: token.blockchain,
  };
}

function isNativeNear(asset: string): boolean {
  const a = (asset || '').trim().toLowerCase();
  return a === 'near' || a === 'native' || a === 'wrap.near' || a === 'nep141:wrap.near';
}

/**
 * Resolve the exact asset the user holds.
 *
 * Order matters:
 *  1. exact defuse id (what the UI sends)
 *  2. exact contract address (older/short forms)
 *  3. bare symbol compatibility, preferring the asset's native chain and then
 *     the canonical NEAR representation.
 *
 * The old implementation canonicalised wBTC to BTC and then deposited
 * btc.omft.near, which the escrow did not hold. Exact matching avoids that.
 */
function resolveOriginFromTokens(tokens: OneClickToken[], sourceAsset: string): ResolvedOrigin | null {
  const raw = (sourceAsset || '').trim();
  if (!raw) return null;
  if (isNativeNear(raw)) return NATIVE_NEAR_ORIGIN;

  const rawLc = raw.toLowerCase();
  const bareContract = rawLc.startsWith('nep141:') ? rawLc.slice('nep141:'.length) : rawLc;

  const exact =
    tokens.find((t) => t.assetId.toLowerCase() === rawLc) ||
    tokens.find((t) => t.assetId.toLowerCase() === `nep141:${rawLc}`) ||
    tokens.find((t) => t.contractAddress?.toLowerCase() === bareContract);
  if (exact) return toResolvedOrigin(exact);

  // Backwards compatibility for callers that still pass a ticker.
  const symbolMatches = tokens.filter((t) => t.symbol.toUpperCase() === raw.toUpperCase());
  if (symbolMatches.length === 0) return null;
  const preferred =
    symbolMatches.find((t) => t.blockchain.toLowerCase() === rawLc) ||
    symbolMatches.find((t) => t.blockchain === 'near') ||
    symbolMatches[0];
  return toResolvedOrigin(preferred);
}

async function loadOriginContext(
  env: Env,
  sourceAsset: string
): Promise<{ origin: ResolvedOrigin; tokens: OneClickToken[] } | null> {
  const apiBase = oneClickApiBase(env);
  let tokens = await fetchOneClickTokens(env, apiBase);
  let origin = resolveOriginFromTokens(tokens, sourceAsset);
  if (origin) return { origin, tokens };

  // The asset may have been listed after the cache was written. Retry once
  // against the live catalogue before declaring it unsupported.
  tokens = await fetchOneClickTokens(env, apiBase, true);
  origin = resolveOriginFromTokens(tokens, sourceAsset);
  return origin ? { origin, tokens } : null;
}

export interface WithdrawChainInfo {
  key: string;
  name: string;
  family: ChainFamily | null;
}

/**
 * Destination networks a given spendable asset can settle to, straight from
 * 1Click. `sourceAsset` may be a full defuse id or a bare symbol.
 */
export async function getWithdrawChains(env: Env, sourceAsset: string): Promise<WithdrawChainInfo[]> {
  const context = await loadOriginContext(env, sourceAsset);
  if (!context) return [];
  const { origin, tokens } = context;

  const seen = new Set<string>();
  const chains: WithdrawChainInfo[] = [];

  for (const token of tokens) {
    if (token.symbol.toUpperCase() !== origin.symbol) continue;
    if (seen.has(token.blockchain)) continue;
    seen.add(token.blockchain);
    chains.push({
      key: token.blockchain,
      name: CHAIN_NAMES[token.blockchain] || token.blockchain.toUpperCase(),
      family: CHAIN_FAMILY[token.blockchain] || null,
    });
  }

  // Keep the asset's native chain first; that is the least surprising default
  // for XRP and other newly listed assets.
  const nativeIndex = chains.findIndex((chain) => chain.key === origin.chain);
  if (nativeIndex > 0) {
    const [native] = chains.splice(nativeIndex, 1);
    chains.unshift(native);
  }

  // NEAR is the native rail (no 1Click quote); keep it first when relevant.
  if (origin.symbol === 'NEAR' && !seen.has('near')) {
    chains.unshift({ key: 'near', name: 'NEAR', family: 'near' });
  }
  return chains;
}

/** Best-guess chain when the caller did not choose one. EVM defaults to Base. */
export function inferChainFromAddress(address: string): string {
  const clean = address.trim();
  if (EVM_ADDRESS_REGEX.test(clean)) return 'base';
  if (BITCOIN_ADDRESS_REGEX.test(clean)) return 'btc';
  if (XRP_ADDRESS_REGEX.test(clean)) return 'xrp';
  if (!clean.includes('.') && SOLANA_ADDRESS_REGEX.test(clean)) return 'sol';
  return 'near';
}

/**
 * True when we know how to shape-check addresses for this chain. Unknown
 * families (XRP, Starknet, Aptos, …) are left to 1Click's own recipient
 * validation instead of being rejected by a NEAR/EVM/Solana-shaped regex.
 */
export function hasKnownAddressFamily(chain: string): boolean {
  return Boolean(CHAIN_FAMILY[chain]);
}

/**
 * True when `address` is valid for the requested chain's family. Unknown
 * families return true and are left to 1Click's own recipient validation.
 */
export function chainMatchesAddress(chain: string, address: string): boolean {
  const family = CHAIN_FAMILY[chain];
  if (!family) return true;
  const clean = address.trim();
  if (family === 'evm') return EVM_ADDRESS_REGEX.test(clean);
  if (family === 'btc') return BITCOIN_ADDRESS_REGEX.test(clean);
  if (family === 'sol') {
    return (
      !EVM_ADDRESS_REGEX.test(clean) &&
      !BITCOIN_ADDRESS_REGEX.test(clean) &&
      !clean.includes('.') &&
      SOLANA_ADDRESS_REGEX.test(clean)
    );
  }
  return isNearAccountAddress(clean);
}

async function resolveAssetPair(
  env: Env,
  asset: string,
  destinationAddress: string,
  destinationChain?: string
): Promise<{
  originAsset: string;
  destinationAsset: string;
  decimals: number;
  symbol: string;
}> {
  const context = await loadOriginContext(env, asset);
  if (!context) {
    throw new Error(`Withdrawals are not supported for this asset yet`);
  }
  const { origin, tokens } = context;

  const chain =
    (destinationChain && destinationChain.trim().toLowerCase()) ||
    inferChainFromAddress(destinationAddress);

  let destinationAsset: string | undefined;
  if (chain === 'near') {
    // Native NEAR settlement uses the same intents asset; no 1Click quote.
    destinationAsset = origin.assetId;
  } else {
    destinationAsset = tokens.find(
      (t) => t.blockchain === chain && t.symbol.toUpperCase() === origin.symbol
    )?.assetId;
  }

  if (!destinationAsset) {
    throw new Error(
      `Sending ${origin.symbol} to ${CHAIN_NAMES[chain] || chain} is not supported yet — choose another network`
    );
  }

  return {
    originAsset: origin.assetId,
    destinationAsset,
    decimals: origin.decimals,
    symbol: origin.symbol,
  };
}


function toBaseUnits(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  const d = Math.max(0, Math.min(Math.trunc(decimals), 30));
  // Never multiply a float by 10**decimals: that loses precision at large
  // magnitudes and for 8/24-decimal assets. `toFixed` emits a plain decimal
  // string, so shifting the point by string surgery is exact for the
  // precision the input number actually carries.
  const [whole, frac = ''] = amount.toFixed(d).split('.');
  const padded = (frac + '0'.repeat(d)).slice(0, d);
  return BigInt(whole + padded).toString();
}

/** Inverse of `toBaseUnits`, for turning 1Click's atomic minimum back into a token amount. */
function fromBaseUnits(value: string, decimals: number): string {
  const digits = (value || '').replace(/^0+/, '') || '0';
  if (!/^\d+$/.test(digits)) return value;
  const d = Math.max(0, Math.min(Math.trunc(decimals), 30));
  if (d === 0) return digits;
  const padded = digits.padStart(d + 1, '0');
  const whole = padded.slice(0, -d);
  const frac = padded.slice(-d).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function oneClickQuoteError(
  status: number,
  errText: string,
  decimals: number,
  symbol: string
): string {
  let message = (errText || '').trim();
  try {
    const parsed = JSON.parse(errText) as { message?: unknown; error?: unknown };
    const candidate = parsed?.message || parsed?.error;
    if (typeof candidate === 'string' && candidate.trim()) message = candidate.trim();
  } catch {
    // upstream did not return JSON; fall back to the raw text below
  }

  const minimum = message.match(/try at least (\d+)/i);
  if (minimum) {
    return `Amount is too low — the minimum is ${fromBaseUnits(minimum[1], decimals)} ${symbol}.`;
  }
  if (/internal server error/i.test(message)) {
    return '1Click could not quote this withdrawal right now. Please try again.';
  }
  return message.slice(0, 240) || `1Click quote failed (${status})`;
}

/**
 * Requests a live cross-chain withdrawal quote from 1Click.
 * Returns the intents deposit address on NEAR where escrow funds must be deposited.
 */
export async function get1ClickWithdrawalQuote(
  env: Env,
  params: CrossChainQuoteParams
): Promise<CrossChainQuoteResult> {
  const { originAsset, destinationAsset, decimals, symbol } = await resolveAssetPair(
    env,
    params.asset,
    params.destinationAddress,
    params.destinationChain
  );
  const amountInBaseUnits = toBaseUnits(params.amount, decimals);
  const apiBase = (env.NEAR_API_BASE || 'https://1click.chaindefuser.com').replace(/\/$/, '');
  const escrowAccount = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';

  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const body = {
    dry: false,
    swapType: 'EXACT_INPUT',
    originAsset,
    destinationAsset,
    amount: amountInBaseUnits,
    recipient: params.destinationAddress,
    recipientType: 'DESTINATION_CHAIN',
    refundTo: escrowAccount,
    refundType: 'INTENTS',
    depositType: 'INTENTS',
    slippageTolerance: 100, // 1%
    deadline,
  };

  const resp = await fetch(`${apiBase}/v0/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UPRAIL/1.0',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(oneClickQuoteError(resp.status, errText, decimals, symbol));
  }

  const data = (await resp.json()) as any;
  const depositAddress = data?.quote?.depositAddress;
  if (!depositAddress || typeof depositAddress !== 'string') {
    throw new Error('1Click quote returned no depositAddress for cross-chain settlement');
  }

  return {
    depositAddress,
    quoteId: data?.quote?.quoteId || data?.correlationId,
    amountIn: data?.quote?.amountIn || amountInBaseUnits,
    amountOut: data?.quote?.amountOut,
    destinationAsset,
    originAsset,
  };
}

export interface OneClickSwapIntent {
  standard: 'nep413';
  payload: { message: string; nonce: string; recipient: string };
}

/**
 * Asks 1Click to build the exact intent the user must sign to fund a quote
 * whose `depositType` is `INTENTS`.
 *
 * For an INTENTS quote the funds are already inside NEAR Intents, so the
 * deposit is NOT an on-chain transfer to the deposit address. The user
 * authorizes the swap by signing an intent that moves their intents balance to
 * the quote's deposit address (the deposit address is an account *within*
 * Intents). 1Click returns that intent verbatim, so the asset id, amount and
 * receiver are never re-derived here and cannot drift from the quote.
 *
 * A native NEP-141 transfer to the deposit address instead (what the old
 * `ft_withdraw` path did) lands on the account's *native* balance, which 1Click
 * never watches for an INTENTS quote — the swap then sits at PENDING_DEPOSIT
 * forever while the NEAR tx itself "succeeds".
 */
export async function generate1ClickSwapIntent(
  env: Env,
  depositAddress: string,
  signerId: string
): Promise<OneClickSwapIntent> {
  const apiBase = oneClickApiBase(env);
  const resp = await fetch(`${apiBase}/v0/generate-intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UPRAIL/1.0',
    },
    body: JSON.stringify({
      type: 'swap_transfer',
      standard: 'nep413',
      signerId,
      depositAddress,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`1Click generate-intent failed (${resp.status}): ${errText}`);
  }

  const data = (await resp.json()) as any;
  const payload = data?.intent?.payload;
  const message = payload?.message;
  const nonce = payload?.nonce;
  const recipient = payload?.recipient;
  if (
    typeof message !== 'string' ||
    typeof nonce !== 'string' ||
    typeof recipient !== 'string'
  ) {
    throw new Error('1Click generate-intent returned no signable payload');
  }

  return { standard: 'nep413', payload: { message, nonce, recipient } };
}
