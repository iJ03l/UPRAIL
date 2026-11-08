/**
 * Stabilize Service (`POST /api/onchain/stabilize/quote` & `/stabilize`).
 *
 * Converts any held token into USDC or USDT in the user's Intents balance:
 * - Native NEAR & NEP-141 tokens held on the user's vault sub-account (or tokens
 *   outside 1Click's solver routes) are swapped via Rhea Finance (`v2.ref-finance.near`
 *   SmartRouter or `dclv2.ref-labs.near` DCL pools) and deposited directly into the
 *   user's Intents balance.
 * - Cross-chain / Intents balances are swapped confidentially via 1Click
 *   (`CONFIDENTIAL_INTENTS` -> `CONFIDENTIAL_INTENTS`), with automatic fallback to
 *   Rhea Finance for native NEAR tokens when below 1Click's solver minimum.
 * - Exact BigInt base-unit 1% protocol fee calculation (no floating-point assumptions)
 * - Default 5% (500 bps) slippage tolerance
 * - 100% gas-sponsored execution
 */

import type { Env, Session } from '../types';
import * as nearRpc from './nearRpc';
import {
  generateSwapIntent,
  requestQuote,
  submitSwapIntent,
} from './oneclickClient';
import { getUserSession, signGeneratedIntent } from './oneclickAuth';
import {
  ensureConfidentialFunds,
  formatAtomic,
  getConfidentialAssetBalance,
  isConfidentialRailEnabled,
  submitPrivateTransfer,
  waitForSettlement,
} from './confidentialRail';

export interface OneClickToken {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  price?: number;
  contractAddress?: string;
}

const ONE_CLICK_TOKENS_CACHE_KEY = '1click_tokens_priced:v1';
const ONE_CLICK_TOKENS_TTL = 10 * 60;

function oneClickApiBase(env: Env): string {
  return (env.NEAR_API_BASE || 'https://1click.chaindefuser.com').replace(/\/+$/, '');
}

export async function getOneClickTokens(env: Env): Promise<OneClickToken[]> {
  try {
    const cached = await env.CACHE?.get(ONE_CLICK_TOKENS_CACHE_KEY, 'json');
    if (Array.isArray(cached) && cached.length > 0) {
      return cached as OneClickToken[];
    }
  } catch {}

  const resp = await fetch(`${oneClickApiBase(env)}/v0/tokens`, {
    headers: { Accept: 'application/json', 'User-Agent': 'UPRAIL/1.0' },
  });
  if (!resp.ok) {
    throw new StabilizeError(
      'TOKEN_LIST_UNAVAILABLE',
      `1Click token registry unavailable (${resp.status}).`,
      502
    );
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
      ...(typeof t?.price === 'number' && Number.isFinite(t.price) ? { price: t.price } : {}),
      ...(t?.contractAddress ? { contractAddress: String(t.contractAddress) } : {}),
    }))
    .filter((t) => t.assetId && t.blockchain && t.symbol);

  try {
    await env.CACHE?.put(ONE_CLICK_TOKENS_CACHE_KEY, JSON.stringify(tokens), {
      expirationTtl: ONE_CLICK_TOKENS_TTL,
    });
  } catch {}
  return tokens;
}

export type StabilizeTargetSymbol = 'USDC' | 'USDT';

export interface StabilizeTokenDescriptor {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain: string;
  nearContractId?: string;
  priceUsd?: number;
  supportsOneClick?: boolean;
}

export interface StabilizeQuoteInput {
  sourceAsset: string;
  targetAsset: StabilizeTargetSymbol | string;
  amount: string;
}

export interface StabilizeQuoteResult {
  sourceAsset: string;
  sourceSymbol: string;
  sourceDecimals: number;
  targetAsset: string;
  targetSymbol: StabilizeTargetSymbol;
  targetDecimals: number;
  grossAmount: string;
  grossAmountAtomic: string;
  protocolFee: string;
  protocolFeeAtomic: string;
  feePercent: number;
  netAmountIn: string;
  netAmountInAtomic: string;
  amountOut: string;
  amountOutAtomic: string;
  minAmountOut: string;
  minAmountOutAtomic: string;
  amountInUsd: string | null;
  amountOutUsd: string | null;
  protocolFeeUsd: string | null;
  exchangeRate: string;
  slippageBps: number;
  timeEstimateSeconds: number;
  confidential: boolean;
  gasSponsored: boolean;
}

export interface StabilizeExecuteResult extends StabilizeQuoteResult {
  id: string;
  status: string;
  depositAddress: string;
  intentHash: string;
  feeIntentHash?: string;
  shieldedAtomic: string;
}

export class StabilizeError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'StabilizeError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const TARGET_STABLECOINS: Record<StabilizeTargetSymbol, StabilizeTokenDescriptor> = {
  USDC: {
    assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    symbol: 'USDC',
    decimals: 6,
    blockchain: 'near',
    nearContractId: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    priceUsd: 1,
    supportsOneClick: true,
  },
  USDT: {
    assetId: 'nep141:usdt.tether-token.near',
    symbol: 'USDT',
    decimals: 6,
    blockchain: 'near',
    nearContractId: 'usdt.tether-token.near',
    priceUsd: 1,
    supportsOneClick: true,
  },
};

const NATIVE_NEAR_DESCRIPTOR: StabilizeTokenDescriptor = {
  assetId: 'nep141:wrap.near',
  symbol: 'NEAR',
  decimals: 24,
  blockchain: 'near',
  nearContractId: 'wrap.near',
  supportsOneClick: true,
};

const QUOTE_TTL_MS = 20 * 60 * 1000;
const SLIPPAGE_BPS = 500; // 5.00% default slippage

export function resolveTargetStablecoin(
  rawTarget: string,
  oneClickTokens: OneClickToken[] = []
): StabilizeTokenDescriptor {
  const cleaned = (rawTarget || '').trim().toUpperCase();
  let key: StabilizeTargetSymbol | null = null;
  if (
    cleaned === 'USDC' ||
    cleaned.includes('17208628F84F5D6AD33F0DA3BBBEB27FFCB398EAC501A31BD6AD2011E36133A1')
  ) {
    key = 'USDC';
  } else if (cleaned === 'USDT' || cleaned.includes('USDT.TETHER-TOKEN.NEAR')) {
    key = 'USDT';
  }
  if (!key) {
    throw new StabilizeError(
      'INVALID_TARGET_ASSET',
      'Target stablecoin must be USDC or USDT.'
    );
  }
  const base = TARGET_STABLECOINS[key];
  const live = oneClickTokens.find(
    (t) => t.assetId.toLowerCase() === base.assetId.toLowerCase()
  );
  return {
    ...base,
    decimals: live?.decimals ?? base.decimals,
    priceUsd: typeof live?.price === 'number' && live.price > 0 ? live.price : base.priceUsd,
  };
}

export async function resolveOriginToken(
  env: Env,
  rawSource: string,
  oneClickTokens?: OneClickToken[]
): Promise<StabilizeTokenDescriptor> {
  const input = (rawSource || '').trim();
  if (!input) {
    throw new StabilizeError('MISSING_SOURCE_ASSET', 'Select a token to stabilize.');
  }

  const lower = input.toLowerCase();
  const tokens = oneClickTokens || (await getOneClickTokens(env).catch(() => [] as OneClickToken[]));

  // Canonicalize native NEAR / wNEAR
  if (
    lower === 'near' ||
    lower === 'wnear' ||
    lower === 'wrap.near' ||
    lower === 'nep141:wrap.near'
  ) {
    const liveNear = tokens.find((t) => t.assetId.toLowerCase() === 'nep141:wrap.near');
    return {
      ...NATIVE_NEAR_DESCRIPTOR,
      decimals: liveNear?.decimals ?? 24,
      priceUsd: typeof liveNear?.price === 'number' ? liveNear.price : undefined,
      supportsOneClick: true,
    };
  }

  // 1. Exact match by 1Click assetId (e.g. nep141:..., nep245:...)
  const byAssetId = tokens.find(
    (t) =>
      t.assetId.toLowerCase() === lower ||
      t.assetId.toLowerCase() === `nep141:${lower}` ||
      (t.contractAddress && t.contractAddress.toLowerCase() === lower)
  );
  if (byAssetId) {
    const isNearWrap = byAssetId.assetId.toLowerCase() === 'nep141:wrap.near';
    const contractId = byAssetId.assetId.toLowerCase().startsWith('nep141:')
      ? byAssetId.assetId.slice(7)
      : byAssetId.contractAddress;
    return {
      assetId: byAssetId.assetId,
      symbol: isNearWrap ? 'NEAR' : byAssetId.symbol.toUpperCase(),
      decimals: byAssetId.decimals,
      blockchain: byAssetId.blockchain,
      nearContractId: contractId,
      priceUsd: typeof byAssetId.price === 'number' ? byAssetId.price : undefined,
      supportsOneClick: true,
    };
  }

  // 2. Match via UPRAIL's supported token registry or Rhea Finance NEP-141 token registry
  const registryTokens = await nearRpc.getSupportedTokens(env).catch(() => [] as nearRpc.OnchainToken[]);
  let regMatch = nearRpc.resolveTokenForAsset(input, registryTokens);
  if (!regMatch) {
    regMatch = await nearRpc.resolveRheaToken(env, input).catch(() => null);
  }
  if (!regMatch) {
    const cleanedContract = lower.startsWith('nep141:') ? lower.slice(7) : lower;
    if (cleanedContract.includes('.')) {
      const meta = await nearRpc.getFtContractMetadata(env, cleanedContract).catch(() => null);
      if (meta && meta.symbol) {
        regMatch = {
          defuse_asset_id: `nep141:${meta.contractId}`,
          symbol: meta.symbol,
          name: meta.name || meta.symbol,
          decimals: meta.decimals,
          icon: '',
          nearContractId: meta.contractId,
          chain: 'near',
        };
      }
    }
  }
  if (regMatch) {
    const regAssetId = (
      regMatch.defuse_asset_id || `nep141:${regMatch.nearContractId}`
    ).toLowerCase();
    const liveMatch = tokens.find(
      (t) =>
        t.assetId.toLowerCase() === regAssetId ||
        (regMatch!.nearContractId &&
          t.assetId.toLowerCase() === `nep141:${regMatch!.nearContractId.toLowerCase()}`)
    );
    if (liveMatch) {
      const isNearWrap = liveMatch.assetId.toLowerCase() === 'nep141:wrap.near';
      return {
        assetId: liveMatch.assetId,
        symbol: isNearWrap ? 'NEAR' : regMatch.symbol.toUpperCase(),
        decimals: liveMatch.decimals,
        blockchain: liveMatch.blockchain,
        nearContractId: regMatch.nearContractId,
        priceUsd:
          typeof liveMatch.price === 'number' ? liveMatch.price : regMatch.priceUsd,
        supportsOneClick: true,
      };
    }

    // Native NEAR NEP-141 token routed via Rhea Finance
    if (regMatch.nearContractId) {
      return {
        assetId: regMatch.defuse_asset_id || `nep141:${regMatch.nearContractId}`,
        symbol: regMatch.symbol.toUpperCase(),
        decimals: regMatch.decimals,
        blockchain: 'near',
        nearContractId: regMatch.nearContractId,
        priceUsd: regMatch.priceUsd,
        supportsOneClick: false,
      };
    }
  }

  // 3. Match by symbol in 1Click tokens (prefer NEAR blockchain first, then canonical chain)
  const symbolMatches = tokens.filter((t) => t.symbol.toLowerCase() === lower);
  if (symbolMatches.length > 0) {
    const preferred =
      symbolMatches.find((t) => t.blockchain.toLowerCase() === 'near') ||
      symbolMatches[0];
    const contractId = preferred.assetId.toLowerCase().startsWith('nep141:')
      ? preferred.assetId.slice(7)
      : preferred.contractAddress;
    return {
      assetId: preferred.assetId,
      symbol:
        preferred.assetId.toLowerCase() === 'nep141:wrap.near'
          ? 'NEAR'
          : preferred.symbol.toUpperCase(),
      decimals: preferred.decimals,
      blockchain: preferred.blockchain,
      nearContractId: contractId,
      priceUsd: typeof preferred.price === 'number' ? preferred.price : undefined,
      supportsOneClick: true,
    };
  }

  throw new StabilizeError(
    'UNSUPPORTED_TOKEN',
    `No liquidity route found to stabilize "${input}" into USDC/USDT.`
  );
}

/**
 * Pure, exact BigInt base-unit calculation for the 1% protocol fee split.
 * Never uses floating-point arithmetic on token amounts.
 */
export function computeStabilizeSplit(
  grossAtomic: bigint,
  decimals: number,
  rawFeePercent?: string
): {
  grossAtomic: bigint;
  feeAtomic: bigint;
  netInputAtomic: bigint;
  feeBps: bigint;
  feePercent: number;
  grossAmountFormatted: string;
  feeAmountFormatted: string;
  netInputFormatted: string;
} {
  if (grossAtomic <= 0n) {
    throw new StabilizeError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }
  const parsedPct = parseFloat(rawFeePercent || '0.01');
  const safePct = Number.isFinite(parsedPct) && parsedPct >= 0 && parsedPct < 1 ? parsedPct : 0.01;
  const feeBps = BigInt(Math.round(safePct * 10_000)); // 0.01 -> 100 bps (1.00%)
  const feeAtomic = (grossAtomic * feeBps) / 10_000n;
  const netInputAtomic = grossAtomic - feeAtomic;

  if (netInputAtomic <= 0n) {
    throw new StabilizeError(
      'AMOUNT_TOO_SMALL',
      'Amount is too small to cover the 1% protocol fee.'
    );
  }

  return {
    grossAtomic,
    feeAtomic,
    netInputAtomic,
    feeBps,
    feePercent: Number(feeBps) / 100,
    grossAmountFormatted: formatAtomic(grossAtomic.toString(), decimals),
    feeAmountFormatted: formatAtomic(feeAtomic.toString(), decimals),
    netInputFormatted: formatAtomic(netInputAtomic.toString(), decimals),
  };
}

/**
 * Computes the user's total spendable balance of `origin` across:
 * 1. Confidential Intents (`getConfidentialAssetBalance`)
 * 2. Public Intents (`getIntentAssetBalance`)
 * 3. Plain Vault sub-account (`getPlainBalances`)
 */
export async function getTotalSpendableOriginAtomic(
  env: Env,
  session: Session,
  origin: StabilizeTokenDescriptor
): Promise<{
  totalAtomic: bigint;
  confidentialAtomic: bigint;
  publicIntentsAtomic: bigint;
  plainAtomic: bigint;
  nearAccount: string;
}> {
  const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
  const [confBal, pubBal, plainBals] = await Promise.all([
    isConfidentialRailEnabled(env)
      ? getConfidentialAssetBalance(env, session.x_id, origin.assetId).catch(() => null)
      : Promise.resolve(null),
    nearRpc.getIntentAssetBalance(env, origin.assetId, nearAccount).catch(() => null),
    nearRpc.getPlainBalances(env, nearAccount).catch(() => [] as nearRpc.IntentAccountBalance[]),
  ]);

  const confidentialAtomic = confBal?.amountAtomic ?? 0n;
  const publicIntentsAtomic = pubBal?.balance ?? 0n;

  let plainAtomic = 0n;
  for (const b of plainBals) {
    const bId = (b.defuse_asset_id || '').toLowerCase();
    const bContract = (b.nearContractId || '').toLowerCase();
    const oId = origin.assetId.toLowerCase();
    const oContract = (origin.nearContractId || '').toLowerCase();
    if (
      bId === oId ||
      (oContract && (bContract === oContract || bId === `nep141:${oContract}`)) ||
      (oId === 'nep141:wrap.near' && b.symbol.toUpperCase() === 'NEAR')
    ) {
      try {
        plainAtomic += BigInt(b.amount || '0');
      } catch {}
    }
  }

  return {
    totalAtomic: confidentialAtomic + publicIntentsAtomic + plainAtomic,
    confidentialAtomic,
    publicIntentsAtomic,
    plainAtomic,
    nearAccount,
  };
}

/**
 * Returns an accurate live quote (via Rhea Finance for native NEAR / NEP-141 tokens
 * or 1Click for Intents assets) for stabilizing `amount` of `sourceAsset` into
 * `targetAsset` (`USDC` or `USDT`), including the exact 1% protocol fee split and
 * 5% default slippage tolerance.
 */
export async function getStabilizeQuote(
  env: Env,
  session: Session,
  input: StabilizeQuoteInput
): Promise<StabilizeQuoteResult> {
  const oneClickTokens = await getOneClickTokens(env).catch(() => [] as OneClickToken[]);
  const destination = resolveTargetStablecoin(input.targetAsset, oneClickTokens);
  const origin = await resolveOriginToken(env, input.sourceAsset, oneClickTokens);

  if (origin.assetId.toLowerCase() === destination.assetId.toLowerCase()) {
    throw new StabilizeError(
      'SAME_ASSET',
      `${origin.symbol} is already ${destination.symbol}. Select a different token to stabilize.`
    );
  }

  const rawAmount = (input.amount || '').trim();
  if (!rawAmount || Number(rawAmount) <= 0) {
    throw new StabilizeError('INVALID_AMOUNT', 'Enter a valid amount to stabilize.');
  }

  let grossAtomic: bigint;
  try {
    const baseStr = nearRpc.toBaseUnits(rawAmount, origin.decimals);
    grossAtomic = BigInt(baseStr || '0');
  } catch {
    throw new StabilizeError('INVALID_AMOUNT', `Invalid amount "${rawAmount}".`);
  }

  const split = computeStabilizeSplit(grossAtomic, origin.decimals, env.FEE_PERCENT);
  const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
  const deadline = new Date(Date.now() + QUOTE_TTL_MS).toISOString();

  // Enforce 0.1 NEAR minimum on the native NEAR balance (not on Intents)
  const MIN_NATIVE_NEAR_ATOMIC = 100_000_000_000_000_000_000_000n; // 0.1 NEAR
  if (
    origin.assetId.toLowerCase() === 'nep141:wrap.near' &&
    grossAtomic < MIN_NATIVE_NEAR_ATOMIC
  ) {
    const spendable = await getTotalSpendableOriginAtomic(env, session, origin);
    const intentsNearAtomic = spendable.confidentialAtomic + spendable.publicIntentsAtomic;
    if (grossAtomic > intentsNearAtomic) {
      throw new StabilizeError(
        'MIN_NATIVE_NEAR',
        'Minimum amount to stabilize on native NEAR balance is 0.1 NEAR.'
      );
    }
  }

  let amountOutAtomic = 0n;
  let minAmountOutAtomic = 0n;
  let amountInUsd: string | null = null;
  let amountOutUsd: string | null = null;
  let timeEstimateSeconds = 6;

  // 1. If token is supported by 1Click, try 1Click quote first; if 1Click fails or token is
  //    a native NEAR NEP-141, fall back to Rhea Finance (`getRheaStabilizeQuote`).
  let oneClickError: string | null = null;
  if (origin.supportsOneClick !== false) {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'UPRAIL/1.0',
      };
      const partnerKey = (env.ONE_CLICK_API_KEY || env.ONE_CLICK_JWT || '').trim();
      if (partnerKey) headers['X-API-Key'] = partnerKey;

      const resp = await fetch(`${oneClickApiBase(env)}/v0/quote`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          dry: true,
          swapType: 'EXACT_INPUT',
          originAsset: origin.assetId,
          destinationAsset: destination.assetId,
          amount: split.netInputAtomic.toString(),
          recipient: nearAccount,
          recipientType: 'INTENTS',
          refundTo: nearAccount,
          refundType: 'INTENTS',
          depositType: 'INTENTS',
          slippageTolerance: SLIPPAGE_BPS,
          deadline,
        }),
      });
      const raw = (await resp.json().catch(() => null)) as any;
      if (!resp.ok || !raw?.quote) {
        const errMsg = raw?.message || raw?.error || `HTTP ${resp.status}`;
        throw new Error(String(errMsg));
      }
      const q = raw.quote;
      amountOutAtomic = BigInt(q.amountOut || '0');
      minAmountOutAtomic = BigInt(q.minAmountOut || q.amountOut || '0');
      amountInUsd = q.amountInUsd || null;
      amountOutUsd = q.amountOutUsd || null;
      timeEstimateSeconds = Number(q.timeEstimate) || 10;
    } catch (err: any) {
      oneClickError = err?.message || String(err);
    }
  }

  // 2. Fallback or primary route via Rhea Finance for native NEAR NEP-141 tokens
  if (amountOutAtomic <= 0n && origin.nearContractId && destination.nearContractId) {
    try {
      const rheaQuote = await nearRpc.getRheaStabilizeQuote(
        env,
        origin.nearContractId,
        destination.nearContractId,
        split.netInputAtomic,
        SLIPPAGE_BPS
      );
      amountOutAtomic = rheaQuote.amountOutAtomic;
      minAmountOutAtomic = rheaQuote.minAmountOutAtomic;
      const outFormatted = formatAtomic(amountOutAtomic.toString(), destination.decimals);
      amountOutUsd = (Number(outFormatted) * (destination.priceUsd ?? 1)).toFixed(2);
      if (typeof origin.priceUsd === 'number' && origin.priceUsd > 0) {
        amountInUsd = (Number(split.netInputFormatted) * origin.priceUsd).toFixed(2);
      } else {
        amountInUsd = amountOutUsd;
      }
      timeEstimateSeconds = 5;
    } catch (rheaErr: any) {
      if (!oneClickError) {
        oneClickError = rheaErr?.message || String(rheaErr);
      }
    }
  }

  if (amountOutAtomic <= 0n) {
    const msg = oneClickError || 'No liquidity route available for this amount.';
    if (/too low|minimum|insufficient|small/i.test(msg)) {
      throw new StabilizeError(
        'AMOUNT_TOO_LOW_FOR_ROUTE',
        `Amount is below the minimum route size for ${origin.symbol} → ${destination.symbol}.`
      );
    }
    throw new StabilizeError(
      'QUOTE_FAILED',
      `Could not calculate route for ${origin.symbol} → ${destination.symbol}: ${msg}`,
      502
    );
  }

  const amountOutFormatted = formatAtomic(amountOutAtomic.toString(), destination.decimals);
  const minAmountOutFormatted = formatAtomic(
    minAmountOutAtomic.toString(),
    destination.decimals
  );

  const netInNum = Number(split.netInputFormatted);
  const outNum = Number(amountOutFormatted);
  const rateNum = netInNum > 0 && outNum > 0 ? outNum / netInNum : 0;
  const exchangeRate =
    rateNum >= 1
      ? rateNum.toFixed(4).replace(/\.?0+$/, '')
      : rateNum > 0
      ? rateNum.toPrecision(4)
      : '0';

  let protocolFeeUsd: string | null = null;
  if (amountInUsd && Number(amountInUsd) > 0 && split.netInputAtomic > 0n) {
    const feeUsdVal =
      (Number(amountInUsd) * Number(split.feeAtomic)) / Number(split.netInputAtomic);
    if (Number.isFinite(feeUsdVal) && feeUsdVal >= 0) {
      protocolFeeUsd = feeUsdVal.toFixed(4);
    }
  } else if (typeof origin.priceUsd === 'number' && origin.priceUsd > 0) {
    const feeUsdVal = Number(split.feeAmountFormatted) * origin.priceUsd;
    if (Number.isFinite(feeUsdVal) && feeUsdVal >= 0) {
      protocolFeeUsd = feeUsdVal.toFixed(4);
    }
  }

  return {
    sourceAsset: origin.assetId,
    sourceSymbol: origin.symbol,
    sourceDecimals: origin.decimals,
    targetAsset: destination.assetId,
    targetSymbol: destination.symbol as StabilizeTargetSymbol,
    targetDecimals: destination.decimals,
    grossAmount: split.grossAmountFormatted,
    grossAmountAtomic: split.grossAtomic.toString(),
    protocolFee: split.feeAmountFormatted,
    protocolFeeAtomic: split.feeAtomic.toString(),
    feePercent: split.feePercent,
    netAmountIn: split.netInputFormatted,
    netAmountInAtomic: split.netInputAtomic.toString(),
    amountOut: amountOutFormatted,
    amountOutAtomic: amountOutAtomic.toString(),
    minAmountOut: minAmountOutFormatted,
    minAmountOutAtomic: minAmountOutAtomic.toString(),
    amountInUsd,
    amountOutUsd,
    protocolFeeUsd,
    exchangeRate,
    slippageBps: SLIPPAGE_BPS,
    timeEstimateSeconds,
    confidential: true,
    gasSponsored: true,
  };
}

/**
 * Executes a gas-sponsored stabilization swap into `USDC` or `USDT`:
 * - For native NEAR & NEP-141 tokens held on the user's sub-account (or native tokens
 *   routed via Rhea Finance): swaps via Rhea Finance (`v2.ref-finance.near` or
 *   `dclv2.ref-labs.near`), deposits the output `USDC`/`USDT` into the user's Intents
 *   balance (`intents.near`), and shields it into Confidential Intents.
 * - For Intents balances supported by 1Click: executes a confidential 1Click swap
 *   (`CONFIDENTIAL_INTENTS` -> `CONFIDENTIAL_INTENTS`) with 5% default slippage.
 */
export async function executeStabilize(
  env: Env,
  session: Session,
  input: StabilizeQuoteInput
): Promise<StabilizeExecuteResult> {
  if (!isConfidentialRailEnabled(env)) {
    throw new StabilizeError(
      'CONFIDENTIAL_RAIL_DISABLED',
      'Confidential Intents rail is required for private stabilization.',
      503
    );
  }

  const oneClickTokens = await getOneClickTokens(env).catch(() => [] as OneClickToken[]);
  const destination = resolveTargetStablecoin(input.targetAsset, oneClickTokens);
  const origin = await resolveOriginToken(env, input.sourceAsset, oneClickTokens);

  if (origin.assetId.toLowerCase() === destination.assetId.toLowerCase()) {
    throw new StabilizeError(
      'SAME_ASSET',
      `${origin.symbol} is already ${destination.symbol}.`
    );
  }

  const spendable = await getTotalSpendableOriginAtomic(env, session, origin);
  if (spendable.totalAtomic <= 0n) {
    throw new StabilizeError(
      'INSUFFICIENT_BALANCE',
      `You do not have any ${origin.symbol} balance to stabilize.`
    );
  }

  const rawAmount = (input.amount || '').trim();
  let grossAtomic: bigint;
  if (rawAmount.toLowerCase() === 'all' || rawAmount.toLowerCase() === 'max') {
    grossAtomic = spendable.totalAtomic;
  } else {
    try {
      const baseStr = nearRpc.toBaseUnits(rawAmount, origin.decimals);
      grossAtomic = BigInt(baseStr || '0');
    } catch {
      throw new StabilizeError('INVALID_AMOUNT', `Invalid amount "${rawAmount}".`);
    }
  }

  if (grossAtomic <= 0n) {
    throw new StabilizeError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }
  if (grossAtomic > spendable.totalAtomic) {
    const availFormatted = formatAtomic(spendable.totalAtomic.toString(), origin.decimals);
    throw new StabilizeError(
      'INSUFFICIENT_BALANCE',
      `Insufficient ${origin.symbol} balance: requested ${formatAtomic(
        grossAtomic.toString(),
        origin.decimals
      )} ${origin.symbol}, available ${availFormatted} ${origin.symbol}.`
    );
  }

  // Enforce 0.1 NEAR minimum on the native NEAR balance (not on Intents)
  const MIN_NATIVE_NEAR_ATOMIC = 100_000_000_000_000_000_000_000n; // 0.1 NEAR
  const intentsNearAtomic = spendable.confidentialAtomic + spendable.publicIntentsAtomic;
  if (
    origin.assetId.toLowerCase() === 'nep141:wrap.near' &&
    grossAtomic > intentsNearAtomic &&
    grossAtomic < MIN_NATIVE_NEAR_ATOMIC
  ) {
    throw new StabilizeError(
      'MIN_NATIVE_NEAR',
      'Minimum amount to stabilize on native NEAR balance is 0.1 NEAR.'
    );
  }

  const split = computeStabilizeSplit(grossAtomic, origin.decimals, env.FEE_PERCENT);

  // Branch A: Native NEAR / NEP-141 token held on the user's sub-account -> Swap on Rhea Finance
  // and deposit the resulting USDC/USDT directly into the user's Intents balance!
  const shouldUseRhea =
    Boolean(origin.nearContractId && destination.nearContractId) &&
    (origin.supportsOneClick === false || spendable.plainAtomic >= grossAtomic);

  if (shouldUseRhea && origin.nearContractId && destination.nearContractId) {
    let rheaResult;
    try {
      rheaResult = await nearRpc.executeRheaStabilizeSwap(
        env,
        session.x_id,
        origin.nearContractId,
        destination.nearContractId,
        split.grossAtomic,
        split.feeAtomic,
        split.netInputAtomic,
        SLIPPAGE_BPS
      );
    } catch (err: any) {
      throw new StabilizeError(
        'RHEA_SWAP_FAILED',
        `Rhea Finance stabilization swap failed for ${origin.symbol} → ${destination.symbol}: ${
          err?.message || String(err)
        }`,
        502
      );
    }

    // Shield the newly deposited USDC/USDT into the user's Confidential Intents balance
    let shieldedAtomic = 0n;
    try {
      const ensured = await ensureConfidentialFunds(
        env,
        session.x_id,
        destination.assetId,
        rheaResult.amountOutAtomic
      );
      shieldedAtomic = ensured.shieldedAtomic;
    } catch (shieldErr) {
      console.warn('[stabilize] non-fatal post-Rhea shield warning:', shieldErr);
    }

    const amountOutFormatted = formatAtomic(
      rheaResult.amountOutAtomic.toString(),
      destination.decimals
    );
    const minAmountOutFormatted = formatAtomic(
      rheaResult.minAmountOutAtomic.toString(),
      destination.decimals
    );
    const netInNum = Number(split.netInputFormatted);
    const outNum = Number(amountOutFormatted);
    const rateNum = netInNum > 0 && outNum > 0 ? outNum / netInNum : 0;
    const exchangeRate =
      rateNum >= 1
        ? rateNum.toFixed(4).replace(/\.?0+$/, '')
        : rateNum > 0
        ? rateNum.toPrecision(4)
        : '0';

    const recordId = `stab_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    if (env.DB) {
      try {
        await env.DB.prepare(
          `INSERT INTO withdrawals (
            id, x_id, asset, amount, destination_address, destination_chain,
            status, tx_hash, deposit_address, privacy_rail, settlement_status,
            created_at, updated_at, confirmed_at
          ) VALUES (?, ?, ?, ?, ?, 'near', 'COMPLETED', ?, ?, 'confidential', 'SUCCESS', ?, ?, ?)`
        )
          .bind(
            recordId,
            session.x_id,
            origin.assetId,
            split.grossAmountFormatted,
            `stabilize:${destination.symbol}:${amountOutFormatted}`,
            rheaResult.depositTxHash || rheaResult.swapTxHash,
            rheaResult.swapTxHash,
            Date.now(),
            Date.now(),
            Date.now()
          )
          .run();
      } catch (dbErr) {
        console.warn('[stabilize] non-fatal ledger insert warning:', dbErr);
      }
    }

    return {
      id: recordId,
      status: 'SUCCESS',
      depositAddress: rheaResult.swapTxHash,
      intentHash: rheaResult.depositTxHash || rheaResult.swapTxHash,
      ...(rheaResult.feeTxHash ? { feeIntentHash: rheaResult.feeTxHash } : {}),
      shieldedAtomic: shieldedAtomic.toString(),
      sourceAsset: origin.assetId,
      sourceSymbol: origin.symbol,
      sourceDecimals: origin.decimals,
      targetAsset: destination.assetId,
      targetSymbol: destination.symbol as StabilizeTargetSymbol,
      targetDecimals: destination.decimals,
      grossAmount: split.grossAmountFormatted,
      grossAmountAtomic: split.grossAtomic.toString(),
      protocolFee: split.feeAmountFormatted,
      protocolFeeAtomic: split.feeAtomic.toString(),
      feePercent: split.feePercent,
      netAmountIn: split.netInputFormatted,
      netAmountInAtomic: split.netInputAtomic.toString(),
      amountOut: amountOutFormatted,
      amountOutAtomic: rheaResult.amountOutAtomic.toString(),
      minAmountOut: minAmountOutFormatted,
      minAmountOutAtomic: rheaResult.minAmountOutAtomic.toString(),
      amountInUsd: amountOutFormatted,
      amountOutUsd: amountOutFormatted,
      protocolFeeUsd: null,
      exchangeRate,
      slippageBps: SLIPPAGE_BPS,
      timeEstimateSeconds: 5,
      confidential: true,
      gasSponsored: true,
    };
  }

  // Branch B: Confidential 1Click Swap (CONFIDENTIAL_INTENTS -> CONFIDENTIAL_INTENTS)
  let shieldedAtomic = 0n;
  try {
    const ensured = await ensureConfidentialFunds(
      env,
      session.x_id,
      origin.assetId,
      split.grossAtomic
    );
    shieldedAtomic = ensured.shieldedAtomic;
  } catch (err: any) {
    const msg = err?.message || String(err);
    throw new StabilizeError(
      'SHIELD_FAILED',
      `Could not shield ${origin.symbol} into Confidential Intents: ${msg}`,
      502
    );
  }

  const userSession = await getUserSession(env, session.x_id);
  const deadline = new Date(Date.now() + QUOTE_TTL_MS).toISOString();

  let liveQuote;
  try {
    liveQuote = await requestQuote(
      env,
      {
        dry: false,
        swapType: 'EXACT_INPUT',
        originAsset: origin.assetId,
        destinationAsset: destination.assetId,
        amount: split.netInputAtomic.toString(),
        recipient: userSession.accountId,
        recipientType: 'CONFIDENTIAL_INTENTS',
        refundTo: userSession.accountId,
        refundType: 'CONFIDENTIAL_INTENTS',
        depositType: 'CONFIDENTIAL_INTENTS',
        confidentiality: 'basic',
        slippageTolerance: SLIPPAGE_BPS,
        deadline,
      },
      { userSession: userSession.accessToken }
    );
  } catch (err: any) {
    throw new StabilizeError(
      'QUOTE_FAILED',
      `1Click quote failed for ${origin.symbol} → ${destination.symbol}: ${err?.message || String(err)}`,
      502
    );
  }

  const depositAddress = liveQuote.quote?.depositAddress;
  if (!depositAddress) {
    throw new StabilizeError(
      'MISSING_DEPOSIT_ADDRESS',
      '1Click did not return a confidential swap deposit address.',
      502
    );
  }

  let intentHash = '';
  try {
    const generated = await generateSwapIntent(env, {
      depositAddress,
      signerId: userSession.accountId,
      standard: 'nep413',
    });
    const signedData = await signGeneratedIntent(env, session.x_id, generated);
    const submitted = await submitSwapIntent(env, signedData);
    intentHash = submitted.intentHash;
  } catch (err: any) {
    throw new StabilizeError(
      'SWAP_SUBMISSION_FAILED',
      `Failed to submit confidential swap intent: ${err?.message || String(err)}`,
      502
    );
  }

  const settlement = await waitForSettlement(env, session.x_id, depositAddress, {
    timeoutMs: 30_000,
    intervalMs: 1_500,
  }).catch(() => ({ status: 'PENDING', terminal: false, intentHash }));

  const settlementStatus = String(settlement.status || 'PENDING').toUpperCase();
  if (settlementStatus === 'FAILED' || settlementStatus === 'REFUNDED') {
    throw new StabilizeError(
      'SWAP_SETTLEMENT_FAILED',
      `1Click reported the stabilization swap as ${settlementStatus.toLowerCase()}. Your funds remain safely in your vault.`,
      502
    );
  }

  let feeIntentHash: string | undefined;
  if (split.feeAtomic > 0n && split.feeAmountFormatted !== '0') {
    const feeRecipient = env.FEE_ACCOUNT_ID || env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
    try {
      const feeTransfer = await submitPrivateTransfer(env, session.x_id, {
        asset: origin.assetId,
        amount: split.feeAmountFormatted,
        recipientAccount: feeRecipient,
      });
      feeIntentHash = feeTransfer.intentHash;
    } catch (feeErr) {
      console.warn('[stabilize] 1% protocol fee transfer warning:', feeErr);
    }
  }

  await (env as any).CACHE?.delete(`plain_bal:${spendable.nearAccount}`).catch(() => {});

  const q = liveQuote.quote;
  const rawQuoteObj = ((liveQuote.raw as any)?.quote || {}) as Record<string, unknown>;
  const amountInUsdStr =
    typeof rawQuoteObj.amountInUsd === 'string' ? rawQuoteObj.amountInUsd : null;
  const amountOutUsdStr =
    typeof rawQuoteObj.amountOutUsd === 'string' ? rawQuoteObj.amountOutUsd : null;

  const amountOutAtomic = BigInt(q.amountOut || '0');
  const minAmountOutAtomic = BigInt(q.minAmountOut || q.amountOut || '0');
  const amountOutFormatted = formatAtomic(amountOutAtomic.toString(), destination.decimals);
  const minAmountOutFormatted = formatAtomic(
    minAmountOutAtomic.toString(),
    destination.decimals
  );

  const netInNum = Number(split.netInputFormatted);
  const outNum = Number(amountOutFormatted);
  const rateNum = netInNum > 0 && outNum > 0 ? outNum / netInNum : 0;
  const exchangeRate =
    rateNum >= 1
      ? rateNum.toFixed(4).replace(/\.?0+$/, '')
      : rateNum > 0
      ? rateNum.toPrecision(4)
      : '0';

  let protocolFeeUsd: string | null = null;
  if (amountInUsdStr && Number(amountInUsdStr) > 0 && split.netInputAtomic > 0n) {
    const feeUsdVal =
      (Number(amountInUsdStr) * Number(split.feeAtomic)) / Number(split.netInputAtomic);
    if (Number.isFinite(feeUsdVal) && feeUsdVal >= 0) {
      protocolFeeUsd = feeUsdVal.toFixed(4);
    }
  }

  const recordId = `stab_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const isCompleted = settlementStatus === 'SUCCESS';
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO withdrawals (
          id, x_id, asset, amount, destination_address, destination_chain,
          status, tx_hash, deposit_address, privacy_rail, settlement_status,
          created_at, updated_at, confirmed_at
        ) VALUES (?, ?, ?, ?, ?, 'near', ?, ?, ?, 'confidential', ?, ?, ?, ?)`
      )
        .bind(
          recordId,
          session.x_id,
          origin.assetId,
          split.grossAmountFormatted,
          `stabilize:${destination.symbol}:${amountOutFormatted}`,
          isCompleted ? 'COMPLETED' : 'PENDING',
          intentHash || depositAddress,
          depositAddress,
          settlementStatus,
          Date.now(),
          Date.now(),
          isCompleted ? Date.now() : null
        )
        .run();
    } catch (dbErr) {
      console.warn('[stabilize] non-fatal ledger insert warning:', dbErr);
    }
  }

  return {
    id: recordId,
    status: isCompleted ? 'SUCCESS' : settlementStatus,
    depositAddress,
    intentHash,
    ...(feeIntentHash ? { feeIntentHash } : {}),
    shieldedAtomic: shieldedAtomic.toString(),
    sourceAsset: origin.assetId,
    sourceSymbol: origin.symbol,
    sourceDecimals: origin.decimals,
    targetAsset: destination.assetId,
    targetSymbol: destination.symbol as StabilizeTargetSymbol,
    targetDecimals: destination.decimals,
    grossAmount: split.grossAmountFormatted,
    grossAmountAtomic: split.grossAtomic.toString(),
    protocolFee: split.feeAmountFormatted,
    protocolFeeAtomic: split.feeAtomic.toString(),
    feePercent: split.feePercent,
    netAmountIn: split.netInputFormatted,
    netAmountInAtomic: split.netInputAtomic.toString(),
    amountOut: amountOutFormatted,
    amountOutAtomic: amountOutAtomic.toString(),
    minAmountOut: minAmountOutFormatted,
    minAmountOutAtomic: minAmountOutAtomic.toString(),
    amountInUsd: amountInUsdStr,
    amountOutUsd: amountOutUsdStr,
    protocolFeeUsd,
    exchangeRate,
    slippageBps: SLIPPAGE_BPS,
    timeEstimateSeconds: Number(q.timeEstimate) || 10,
    confidential: true,
    gasSponsored: true,
  };
}
