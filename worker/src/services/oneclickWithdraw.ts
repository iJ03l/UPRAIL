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

export function isValidDestinationAddress(address: string): boolean {
  const clean = address.trim();
  if (!clean || clean.length > 100) return false;
  if (EVM_ADDRESS_REGEX.test(clean)) return true;
  if (BITCOIN_ADDRESS_REGEX.test(clean)) return true;
  if (!clean.includes('.') && SOLANA_ADDRESS_REGEX.test(clean)) return true;
  if (clean.length <= 64 && NEAR_ACCOUNT_REGEX.test(clean)) return true;
  return false;
}

export function isNearAccountAddress(address: string): boolean {
  const clean = address.trim();
  // Solana addresses are base58 without dots, EVM starts with 0x, BTC starts with bc1/1/3
  if (EVM_ADDRESS_REGEX.test(clean)) return false;
  if (BITCOIN_ADDRESS_REGEX.test(clean)) return false;
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
 * NEAR-side (intents) source assets, keyed by canonical symbol. The withdraw
 * path receives a full defuse asset id, so these are the exact origin assets
 * 1Click must be told escrow is depositing — a mismatch strands the transfer.
 * Destination assets are resolved live from 1Click instead (below), so they
 * never drift the way a static map did.
 */
const ORIGIN_ASSETS: Record<string, { originAsset: string; decimals: number; destSymbol: string }> = {
  usdc: {
    originAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    decimals: 6,
    destSymbol: 'USDC',
  },
  usdt: { originAsset: 'nep141:usdt.tether-token.near', decimals: 6, destSymbol: 'USDT' },
  near: { originAsset: 'wrap.near', decimals: 24, destSymbol: 'NEAR' },
  btc: { originAsset: 'nep141:btc.omft.near', decimals: 8, destSymbol: 'BTC' },
  eth: { originAsset: 'nep141:eth.bridge.near', decimals: 18, destSymbol: 'ETH' },
  sol: { originAsset: 'nep141:sol.omft.near', decimals: 9, destSymbol: 'SOL' },
  doge: { originAsset: 'nep141:doge.omft.near', decimals: 8, destSymbol: 'DOGE' },
};

const ONE_CLICK_TOKENS_KEY = '1click_tokens:v1';
const ONE_CLICK_TOKENS_TTL = 6 * 60 * 60;

interface OneClickToken {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
}

function oneClickApiBase(env: Env): string {
  return (env.NEAR_API_BASE || 'https://1click.chaindefuser.com').replace(/\/$/, '');
}

/**
 * Live 1Click token catalogue, cached in KV for a few hours. This is the
 * single source of truth for what can be sent where — hardcoding it rotted
 * (stale Optimism/Avalanche ids, missing Sui/Robinhood) within one release.
 */
async function fetchOneClickTokens(env: Env, apiBase: string): Promise<OneClickToken[]> {
  try {
    const cached = await env.CACHE?.get(ONE_CLICK_TOKENS_KEY, 'json');
    if (Array.isArray(cached) && cached.length > 0) return cached as OneClickToken[];
  } catch {
    // fall through to a live fetch
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
  const symbol = canonicalAssetSymbol(sourceAsset);
  const origin = ORIGIN_ASSETS[symbol];
  if (!origin) return [];

  const tokens = await fetchOneClickTokens(env, oneClickApiBase(env));
  const seen = new Set<string>();
  const chains: WithdrawChainInfo[] = [];

  for (const token of tokens) {
    if (token.symbol.toUpperCase() !== origin.destSymbol) continue;
    if (seen.has(token.blockchain)) continue;
    seen.add(token.blockchain);
    chains.push({
      key: token.blockchain,
      name: CHAIN_NAMES[token.blockchain] || token.blockchain.toUpperCase(),
      family: CHAIN_FAMILY[token.blockchain] || null,
    });
  }

  // NEAR is the native rail (no 1Click quote); keep it first when relevant.
  if (symbol === 'near' && !seen.has('near')) {
    chains.unshift({ key: 'near', name: 'NEAR', family: 'near' });
  }
  return chains;
}

/** Normalizes a defuse asset id (or bare symbol) to a canonical symbol. */
function canonicalAssetSymbol(asset: string): string {
  const a = (asset || '').trim().toLowerCase();
  if (a.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')) return 'usdc';
  if (a.includes('usdt.tether-token.near')) return 'usdt';
  if (a.includes('wrap.near') || a === 'near' || a === 'native') return 'near';
  if (a.includes('btc.omft.near') || a.includes('2260fac5e5542a773aa44fbcfedf7c193bc2c599')) return 'btc';
  if (a.includes('eth.bridge.near') || a === 'eth') return 'eth';
  if (a.includes('sol.omft.near') || a === 'sol') return 'sol';
  if (a.includes('doge.omft.near')) return 'doge';
  return a;
}

/** Best-guess chain when the caller did not choose one. EVM defaults to Base. */
export function inferChainFromAddress(address: string): string {
  const clean = address.trim();
  if (EVM_ADDRESS_REGEX.test(clean)) return 'base';
  if (BITCOIN_ADDRESS_REGEX.test(clean)) return 'btc';
  if (!clean.includes('.') && SOLANA_ADDRESS_REGEX.test(clean)) return 'sol';
  return 'near';
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
}> {
  const symbol = canonicalAssetSymbol(asset);
  const origin = ORIGIN_ASSETS[symbol];
  if (!origin) {
    throw new Error(`Withdrawals are not supported for this asset yet`);
  }

  const chain =
    (destinationChain && destinationChain.trim().toLowerCase()) ||
    inferChainFromAddress(destinationAddress);

  let destinationAsset: string | undefined;
  if (chain === 'near') {
    // Native NEAR settlement uses the same intents asset; no 1Click quote.
    destinationAsset = origin.originAsset;
  } else {
    const tokens = await fetchOneClickTokens(env, oneClickApiBase(env));
    destinationAsset = tokens.find(
      (t) => t.blockchain === chain && t.symbol.toUpperCase() === origin.destSymbol
    )?.assetId;
  }

  if (!destinationAsset) {
    throw new Error(
      `Sending ${origin.destSymbol} to ${CHAIN_NAMES[chain] || chain} is not supported yet — choose another network`
    );
  }

  return {
    originAsset: origin.originAsset,
    destinationAsset,
    decimals: origin.decimals,
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

/**
 * Requests a live cross-chain withdrawal quote from 1Click.
 * Returns the intents deposit address on NEAR where escrow funds must be deposited.
 */
export async function get1ClickWithdrawalQuote(
  env: Env,
  params: CrossChainQuoteParams
): Promise<CrossChainQuoteResult> {
  const { originAsset, destinationAsset, decimals } = await resolveAssetPair(
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
    throw new Error(`1Click quote failed (${resp.status}): ${errText}`);
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
