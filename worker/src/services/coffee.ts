/**
 * Buy Me a Coffee Service (`uprail.world/<handle>`).
 *
 * Allows any UPRAIL user to toggle on a public tip/coffee link from their dashboard.
 * Contributors do NOT need an UPRAIL account or wallet connection:
 *   1. Pick prefilled USD amount ($2, $5, $10, $25, or custom)
 *   2. Pick token (USDC / USDT pinned on top, plus major assets)
 *   3. Pick origin chain (Base, Arbitrum, Solana, Ethereum, NEAR, Polygon, BTC, etc.)
 *   4. Confirm -> generates a one-time ephemeral deposit address via 1Click
 *      routing into `escrow.uprail.near`, removes UPRAIL's 1% protocol fee,
 *      and settles the net 99% straight into the creator's UPRAIL vault.
 */

import type { Env } from '../types';
import * as nearRpc from './nearRpc';
import {
  getOneClickTokens,
  resolveTargetStablecoin,
  computeStabilizeSplit,
  type OneClickToken,
  type StabilizeTargetSymbol,
} from './stabilize';
import {
  requestQuote,
  getExecutionStatus,
} from './oneclickClient';
import { getEscrowSession } from './oneclickAuth';
import {
  formatAtomic,
  isConfidentialRailEnabled,
  payEscrowPrivate,
} from './confidentialRail';

export class CoffeeError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'CoffeeError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface CoffeeChainOption {
  chain: string;
  chainName: string;
  assetId: string;
  decimals: number;
  priceUsd?: number;
}

export interface CoffeeTokenOption {
  symbol: string;
  name: string;
  isStable: boolean;
  chains: CoffeeChainOption[];
}

export interface CoffeeCreatorProfile {
  found: boolean;
  enabled: boolean;
  handle: string;
  name: string;
  avatarUrl: string | null;
}

export interface CreateCoffeeDonationInput {
  handle: string;
  amountUsd: number;
  originSymbol: string;
  originChain: string;
  originAsset?: string;
  targetSymbol?: StabilizeTargetSymbol;
}

export interface CoffeeDonationView {
  id: string;
  recipientHandle: string;
  originSymbol: string;
  originChain: string;
  originChainName: string;
  targetSymbol: string;
  grossAmount: string;
  amountToSend: string;
  estimatedNetOut: string;
  protocolFee: string;
  feePercent: number;
  depositAddress: string;
  depositMemo?: string;
  status: string;
  payoutTxHash?: string | null;
  intentHash?: string | null;
  expiresAt: number;
  createdAt: number;
}

const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  base: 'Base',
  arb: 'Arbitrum',
  arbitrum: 'Arbitrum',
  sol: 'Solana',
  solana: 'Solana',
  eth: 'Ethereum',
  ethereum: 'Ethereum',
  pol: 'Polygon',
  polygon: 'Polygon',
  op: 'Optimism',
  optimism: 'Optimism',
  near: 'NEAR',
  bsc: 'BNB Chain',
  avax: 'Avalanche',
  avalanche: 'Avalanche',
  btc: 'Bitcoin',
  bitcoin: 'Bitcoin',
  ton: 'TON',
  tron: 'Tron',
  trx: 'Tron',
  sui: 'Sui',
  aptos: 'Aptos',
  xrp: 'XRP Ledger',
  doge: 'Dogecoin',
  starknet: 'Starknet',
  scroll: 'Scroll',
  gnosis: 'Gnosis',
  bera: 'Berachain',
  monad: 'Monad',
};

const CHAIN_ALIASES: Record<string, string[]> = {
  base: ['base'],
  arbitrum: ['arb', 'arbitrum'],
  arb: ['arb', 'arbitrum'],
  sol: ['sol', 'solana'],
  solana: ['sol', 'solana'],
  eth: ['eth', 'ethereum'],
  ethereum: ['eth', 'ethereum'],
  pol: ['pol', 'polygon'],
  polygon: ['pol', 'polygon'],
  op: ['op', 'optimism'],
  optimism: ['op', 'optimism'],
  near: ['near'],
  bsc: ['bsc'],
  avax: ['avax', 'avalanche'],
  btc: ['btc', 'bitcoin'],
  bitcoin: ['btc', 'bitcoin'],
  tron: ['tron', 'trx'],
  trx: ['tron', 'trx'],
};

const PINNED_TOKENS = ['USDC', 'USDT', 'SOL', 'ETH', 'NEAR', 'BTC', 'BNB', 'POL', 'AVAX', 'TON', 'SUI', 'XRP', 'DOGE'];
const TOKEN_NAMES: Record<string, string> = {
  USDC: 'USD Coin',
  USDT: 'Tether USD',
  SOL: 'Solana',
  ETH: 'Ethereum',
  NEAR: 'NEAR Protocol',
  BTC: 'Bitcoin',
  BNB: 'BNB',
  POL: 'Polygon',
  AVAX: 'Avalanche',
  TON: 'Toncoin',
  SUI: 'Sui',
  XRP: 'XRP',
  DOGE: 'Dogecoin',
};

const DONATION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function formatChainName(chain: string): string {
  const key = (chain || '').trim().toLowerCase();
  return CHAIN_DISPLAY_NAMES[key] || (chain ? chain.charAt(0).toUpperCase() + chain.slice(1) : 'Unknown');
}

function normalizeHandle(raw: string): string {
  return (raw || '').trim().replace(/^@+/, '').toLowerCase();
}

function matchesChain(tokenChain: string, requestedChain: string): boolean {
  const a = (tokenChain || '').trim().toLowerCase();
  const b = (requestedChain || '').trim().toLowerCase();
  if (a === b) return true;
  const aliases = CHAIN_ALIASES[b] || [b];
  return aliases.includes(a);
}

function canonicalCoffeeSymbol(t: OneClickToken): string {
  const sym = (t.symbol || '').trim().toUpperCase();
  const assetId = (t.assetId || '').trim().toLowerCase();
  const chain = (t.blockchain || '').trim().toLowerCase();
  // 1Click registers native NEAR (nep141:wrap.near) as symbol "wNEAR" on chain "near".
  if (assetId === 'nep141:wrap.near' || (sym === 'WNEAR' && chain === 'near')) {
    return 'NEAR';
  }
  return sym;
}

/**
 * Returns curated + live supported token and chain combinations from 1Click,
 * always pinning USDC and USDT at the very top.
 */
export async function getCoffeeOptions(env: Env): Promise<CoffeeTokenOption[]> {
  const tokens = await getOneClickTokens(env);
  const bySymbol = new Map<string, Map<string, CoffeeChainOption>>();

  for (const t of tokens) {
    const sym = canonicalCoffeeSymbol(t);
    const chain = (t.blockchain || '').trim().toLowerCase();
    if (!sym || !chain || !t.assetId) continue;

    // Prioritize our curated tokens so the dropdown stays clean and uncluttered
    if (!PINNED_TOKENS.includes(sym)) continue;

    if (!bySymbol.has(sym)) bySymbol.set(sym, new Map());
    const chainMap = bySymbol.get(sym)!;
    if (!chainMap.has(chain) || t.assetId.toLowerCase() === 'nep141:wrap.near') {
      chainMap.set(chain, {
        chain,
        chainName: formatChainName(chain),
        assetId: t.assetId,
        decimals: t.decimals,
        ...(typeof t.price === 'number' && t.price > 0 ? { priceUsd: t.price } : {}),
      });
    }
  }

  const preferredChainOrder = ['base', 'arb', 'arbitrum', 'sol', 'solana', 'eth', 'ethereum', 'pol', 'polygon', 'op', 'optimism', 'near', 'bsc', 'avax', 'tron', 'btc', 'ton', 'sui'];

  const result: CoffeeTokenOption[] = [];
  for (const sym of PINNED_TOKENS) {
    const chainMap = bySymbol.get(sym);
    if (!chainMap || chainMap.size === 0) continue;
    const chains = Array.from(chainMap.values()).sort((a, b) => {
      const ia = preferredChainOrder.indexOf(a.chain);
      const ib = preferredChainOrder.indexOf(b.chain);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.chainName.localeCompare(b.chainName);
    });
    result.push({
      symbol: sym,
      name: TOKEN_NAMES[sym] || sym,
      isStable: sym === 'USDC' || sym === 'USDT',
      chains,
    });
  }

  return result;
}

/**
 * Looks up a creator's public Buy Me a Coffee profile by X handle.
 */
export async function getCoffeeCreatorProfile(
  env: Env,
  rawHandle: string
): Promise<CoffeeCreatorProfile> {
  const handle = normalizeHandle(rawHandle);
  if (!handle || !/^[a-z0-9_]{1,15}$/.test(handle)) {
    return { found: false, enabled: false, handle, name: '', avatarUrl: null };
  }

  const row = await env.DB.prepare(
    'SELECT x_id, x_handle, x_name, avatar_url, coffee_enabled FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
  )
    .bind(handle)
    .first<{
      x_id: string;
      x_handle: string;
      x_name: string;
      avatar_url: string | null;
      coffee_enabled: number;
    }>();

  if (!row) {
    return { found: false, enabled: false, handle, name: '', avatarUrl: null };
  }

  return {
    found: true,
    enabled: Number(row.coffee_enabled) === 1,
    handle: row.x_handle,
    name: row.x_name || row.x_handle,
    avatarUrl: row.avatar_url || `https://unavatar.io/x/${encodeURIComponent(row.x_handle)}`,
  };
}

/**
 * Resolves the exact 1Click origin token matching symbol + chain.
 */
function findOriginToken(
  tokens: OneClickToken[],
  originSymbol: string,
  originChain: string,
  originAsset?: string
): OneClickToken {
  if (originAsset) {
    const exact = tokens.find(
      (t) => t.assetId.toLowerCase() === originAsset.trim().toLowerCase()
    );
    if (exact) return exact;
  }

  const sym = originSymbol.trim().toUpperCase();
  const matches = tokens.filter(
    (t) =>
      canonicalCoffeeSymbol(t) === sym &&
      matchesChain(t.blockchain, originChain)
  );
  const match =
    matches.find((t) => t.assetId.toLowerCase() === 'nep141:wrap.near') ||
    matches[0];
  if (!match) {
    throw new CoffeeError(
      'UNSUPPORTED_ROUTE',
      `Sending ${sym} on ${formatChainName(originChain)} is currently unavailable.`,
      400
    );
  }
  return match;
}

/**
 * Converts a USD amount into the base atomic amount for the origin token.
 */
function computeOriginAmount(
  amountUsd: number,
  origin: OneClickToken
): { formatted: string; atomic: string } {
  const sym = origin.symbol.trim().toUpperCase();
  const isStable = sym === 'USDC' || sym === 'USDT' || sym === 'DAI' || sym === 'USDG';

  let tokenAmt: number;
  if (isStable) {
    tokenAmt = amountUsd;
  } else {
    const price = typeof origin.price === 'number' && origin.price > 0 ? origin.price : 0;
    if (!price) {
      throw new CoffeeError(
        'PRICE_UNAVAILABLE',
        `Live USD price unavailable for ${sym}. Try USDC or USDT.`,
        400
      );
    }
    tokenAmt = amountUsd / price;
  }

  const precision = isStable ? 2 : Math.min(origin.decimals, 6);
  const formatted = tokenAmt.toFixed(precision).replace(/\.?0+$/, '') || '0';
  const atomic = nearRpc.toBaseUnits(formatted, origin.decimals);
  if (!atomic || atomic === '0' || BigInt(atomic) <= 0n) {
    throw new CoffeeError('INVALID_AMOUNT', 'Donation amount is too small.', 400);
  }
  return { formatted, atomic };
}

function formatDonationRow(row: any): CoffeeDonationView {
  return {
    id: row.id,
    recipientHandle: row.recipient_handle,
    originSymbol: row.origin_symbol,
    originChain: row.origin_chain,
    originChainName: formatChainName(row.origin_chain),
    targetSymbol: row.target_symbol,
    grossAmount: row.gross_amount,
    amountToSend: row.gross_amount,
    estimatedNetOut: row.net_amount,
    protocolFee: row.protocol_fee,
    feePercent: 1,
    depositAddress: row.deposit_address,
    ...(row.deposit_memo ? { depositMemo: row.deposit_memo } : {}),
    status: row.status,
    payoutTxHash: row.payout_tx_hash || null,
    intentHash: row.intent_hash || null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Creates a one-time ephemeral deposit quote into escrow.uprail.near for a creator's
 * Buy Me a Coffee link.
 */
export async function createCoffeeDonation(
  env: Env,
  input: CreateCoffeeDonationInput
): Promise<CoffeeDonationView> {
  const handle = normalizeHandle(input.handle);
  if (!handle) {
    throw new CoffeeError('INVALID_HANDLE', 'Creator handle is required.', 400);
  }

  const amountUsd = Number(input.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 10000) {
    throw new CoffeeError(
      'INVALID_AMOUNT',
      'Donation amount must be between $1 and $10,000.',
      400
    );
  }

  const creator = await env.DB.prepare(
    'SELECT x_id, x_handle, near_account, coffee_enabled FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
  )
    .bind(handle)
    .first<{
      x_id: string;
      x_handle: string;
      near_account: string | null;
      coffee_enabled: number;
    }>();

  if (!creator) {
    throw new CoffeeError('CREATOR_NOT_FOUND', `@${handle} is not registered on UPRAIL.`, 404);
  }
  if (Number(creator.coffee_enabled) !== 1) {
    throw new CoffeeError(
      'COFFEE_DISABLED',
      `@${creator.x_handle} has not enabled their Buy Me a Coffee link yet.`,
      403
    );
  }

  const recipientNearAccount =
    creator.near_account ||
    (await nearRpc.resolveUserNearAccount(env, {
      x_id: creator.x_id,
      x_handle: creator.x_handle,
      near_account: creator.near_account,
    }));

  const tokens = await getOneClickTokens(env);
  const originToken = findOriginToken(
    tokens,
    input.originSymbol,
    input.originChain,
    input.originAsset
  );
  const { formatted: amountToSend, atomic: originAtomic } = computeOriginAmount(
    amountUsd,
    originToken
  );

  // If the donor picked USDT as their token, default settlement to USDT; otherwise USDC (unless overridden)
  const desiredTarget: StabilizeTargetSymbol =
    input.targetSymbol === 'USDC' || input.targetSymbol === 'USDT'
      ? input.targetSymbol
      : originToken.symbol.trim().toUpperCase() === 'USDT'
      ? 'USDT'
      : 'USDC';
  const targetDesc = resolveTargetStablecoin(desiredTarget, tokens);

  const escrowAccount = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const confidential = isConfidentialRailEnabled(env);
  const now = Date.now();
  const expiresAt = now + DONATION_TTL_MS;
  const deadline = new Date(expiresAt).toISOString();

  let quoteResp;
  if (confidential) {
    const escrowSession = await getEscrowSession(env);
    quoteResp = await requestQuote(
      env,
      {
        originAsset: originToken.assetId,
        destinationAsset: targetDesc.assetId,
        amount: originAtomic,
        recipient: escrowAccount,
        recipientType: 'CONFIDENTIAL_INTENTS',
        refundTo: escrowAccount,
        refundType: 'CONFIDENTIAL_INTENTS',
        depositType: 'ORIGIN_CHAIN',
        confidentiality: 'advanced',
        slippageTolerance: 300,
        deadline,
      },
      { userSession: escrowSession.accessToken }
    );
  } else {
    quoteResp = await requestQuote(env, {
      originAsset: originToken.assetId,
      destinationAsset: targetDesc.assetId,
      amount: originAtomic,
      recipient: escrowAccount,
      recipientType: 'INTENTS',
      refundTo: escrowAccount,
      refundType: 'INTENTS',
      depositType: 'ORIGIN_CHAIN',
      slippageTolerance: 300,
      deadline,
    });
  }

  const quotedOutAtomicStr = quoteResp.quote.amountOut || quoteResp.quote.minAmountOut || '0';
  const quotedOutAtomic = BigInt(quotedOutAtomicStr);
  if (quotedOutAtomic <= 0n) {
    throw new CoffeeError('QUOTE_UNAVAILABLE', 'Could not obtain a valid swap quote for this amount.', 502);
  }

  const split = computeStabilizeSplit(quotedOutAtomic, targetDesc.decimals, env.FEE_PERCENT);
  const donationId = `cof_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  await env.DB.prepare(
    `INSERT INTO coffee_donations (
      id, recipient_x_id, recipient_handle, recipient_near_account,
      origin_asset, origin_chain, origin_symbol,
      target_symbol, target_asset,
      gross_amount, gross_atomic, quoted_out_atomic,
      net_amount, net_atomic, protocol_fee, fee_atomic,
      deposit_address, deposit_memo, status, rail,
      expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING_DEPOSIT', ?, ?, ?, ?)`
  )
    .bind(
      donationId,
      creator.x_id,
      creator.x_handle,
      recipientNearAccount,
      originToken.assetId,
      originToken.blockchain,
      canonicalCoffeeSymbol(originToken),
      targetDesc.symbol,
      targetDesc.assetId,
      amountToSend,
      originAtomic,
      quotedOutAtomic.toString(),
      split.netInputFormatted,
      split.netInputAtomic.toString(),
      split.feeAmountFormatted,
      split.feeAtomic.toString(),
      quoteResp.quote.depositAddress,
      quoteResp.quote.depositMemo || null,
      confidential ? 'confidential' : 'public',
      expiresAt,
      now,
      now
    )
    .run();

  return {
    id: donationId,
    recipientHandle: creator.x_handle,
    originSymbol: originToken.symbol.toUpperCase(),
    originChain: originToken.blockchain,
    originChainName: formatChainName(originToken.blockchain),
    targetSymbol: targetDesc.symbol,
    grossAmount: amountToSend,
    amountToSend,
    estimatedNetOut: split.netInputFormatted,
    protocolFee: split.feeAmountFormatted,
    feePercent: split.feePercent,
    depositAddress: quoteResp.quote.depositAddress,
    ...(quoteResp.quote.depositMemo ? { depositMemo: quoteResp.quote.depositMemo } : {}),
    status: 'WAITING_DEPOSIT',
    payoutTxHash: null,
    intentHash: null,
    expiresAt,
    createdAt: now,
  };
}

/**
 * Checks 1Click execution status for a donation and atomically settles the net 99%
 * from escrow.uprail.near to the creator's UPRAIL vault once 1Click reports SUCCESS.
 */
export async function checkAndSettleCoffeeDonation(
  env: Env,
  donationId: string
): Promise<CoffeeDonationView> {
  const row = await env.DB.prepare('SELECT * FROM coffee_donations WHERE id = ? LIMIT 1')
    .bind(donationId)
    .first<any>();

  if (!row) {
    throw new CoffeeError('NOT_FOUND', 'Coffee donation not found.', 404);
  }

  if (row.status === 'COMPLETED' || row.status === 'FAILED' || row.status === 'EXPIRED') {
    return formatDonationRow(row);
  }

  const now = Date.now();
  if (row.status === 'WAITING_DEPOSIT' && row.expires_at < now) {
    await env.DB.prepare(
      "UPDATE coffee_donations SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status = 'WAITING_DEPOSIT'"
    )
      .bind(now, donationId)
      .run();
    return formatDonationRow({ ...row, status: 'EXPIRED' });
  }

  let execStatus;
  try {
    if (row.rail === 'confidential' && isConfidentialRailEnabled(env)) {
      const escrowSession = await getEscrowSession(env);
      execStatus = await getExecutionStatus(
        env,
        row.deposit_address,
        row.deposit_memo || undefined,
        escrowSession.accessToken
      );
    } else {
      execStatus = await getExecutionStatus(
        env,
        row.deposit_address,
        row.deposit_memo || undefined
      );
    }
  } catch (err: any) {
    // Transient 1Click status poll error — leave row waiting so caller can keep polling
    console.warn(`[coffee] status poll skipped for ${donationId}:`, err?.message || err);
    return formatDonationRow(row);
  }

  const remoteStatus = String(execStatus.status || '').toUpperCase();

  if (remoteStatus === 'FAILED' || remoteStatus === 'REFUNDED') {
    await env.DB.prepare(
      "UPDATE coffee_donations SET status = 'FAILED', updated_at = ? WHERE id = ? AND status IN ('WAITING_DEPOSIT', 'PROCESSING')"
    )
      .bind(Date.now(), donationId)
      .run();
    return formatDonationRow({ ...row, status: 'FAILED' });
  }

  if (remoteStatus === 'PROCESSING' || remoteStatus === 'KNOWN_DEPOSIT_TX') {
    if (row.status === 'WAITING_DEPOSIT') {
      await env.DB.prepare(
        "UPDATE coffee_donations SET status = 'PROCESSING', updated_at = ? WHERE id = ? AND status = 'WAITING_DEPOSIT'"
      )
        .bind(Date.now(), donationId)
        .run();
      return formatDonationRow({ ...row, status: 'PROCESSING' });
    }
    return formatDonationRow(row);
  }

  if (remoteStatus !== 'SUCCESS') {
    return formatDonationRow(row);
  }

  // Atomic lock: only one caller can transition WAITING_DEPOSIT/PROCESSING -> SETTLING
  const lockRes = await env.DB.prepare(
    "UPDATE coffee_donations SET status = 'SETTLING', updated_at = ? WHERE id = ? AND status IN ('WAITING_DEPOSIT', 'PROCESSING')"
  )
    .bind(Date.now(), donationId)
    .run();

  if (!lockRes.meta?.changes) {
    const fresh = await env.DB.prepare('SELECT * FROM coffee_donations WHERE id = ? LIMIT 1')
      .bind(donationId)
      .first<any>();
    return formatDonationRow(fresh || row);
  }

  try {
    const rawOut =
      (execStatus.swapDetails as any)?.amountOut ||
      (execStatus.raw as any)?.quoteResponse?.quote?.amountOut ||
      row.quoted_out_atomic;

    const settledAtomic = BigInt(String(rawOut || row.quoted_out_atomic));
    const tokens = await getOneClickTokens(env).catch(() => [] as OneClickToken[]);
    const targetDesc = resolveTargetStablecoin(row.target_symbol, tokens);

    // Carve out exact 1% protocol fee (kept in escrow.uprail.near), send 99% net to creator
    const split = computeStabilizeSplit(settledAtomic, targetDesc.decimals, env.FEE_PERCENT);

    let payoutTxHash: string | null = null;
    if (row.rail === 'confidential' && isConfidentialRailEnabled(env)) {
      const payout = await payEscrowPrivate(env, {
        asset: row.target_asset,
        amount: split.netInputFormatted,
        recipientAccount: row.recipient_near_account,
        timeoutMs: 25_000,
      });
      payoutTxHash = payout.intentHash || payout.depositAddress || null;
    } else {
      const payout = await nearRpc.executeTransferFromEscrowIntent(
        env,
        row.recipient_near_account,
        row.target_asset,
        split.netInputFormatted
      );
      if (!payout.success) {
        throw new Error(payout.error || 'Escrow payout intent failed');
      }
      payoutTxHash = payout.txHash || null;
    }

    const doneAt = Date.now();
    await env.DB.prepare(
      `UPDATE coffee_donations
       SET status = 'COMPLETED',
           settled_amount_atomic = ?,
           net_amount = ?,
           net_atomic = ?,
           protocol_fee = ?,
           fee_atomic = ?,
           intent_hash = ?,
           payout_tx_hash = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        settledAtomic.toString(),
        split.netInputFormatted,
        split.netInputAtomic.toString(),
        split.feeAmountFormatted,
        split.feeAtomic.toString(),
        execStatus.intentHash || null,
        payoutTxHash,
        doneAt,
        donationId
      )
      .run();

    const updated = await env.DB.prepare('SELECT * FROM coffee_donations WHERE id = ? LIMIT 1')
      .bind(donationId)
      .first<any>();
    return formatDonationRow(updated || row);
  } catch (err: any) {
    console.error(`[coffee] settlement error for ${donationId}:`, err?.message || err);
    // Revert lock back to PROCESSING so cron or next poll can safely retry
    await env.DB.prepare(
      "UPDATE coffee_donations SET status = 'PROCESSING', updated_at = ? WHERE id = ? AND status = 'SETTLING'"
    )
      .bind(Date.now(), donationId)
      .run()
      .catch(() => {});
    return formatDonationRow({ ...row, status: 'PROCESSING' });
  }
}

/**
 * Cron safety-net: reconciles pending/processing coffee donations in case the donor
 * closed their browser immediately after sending funds.
 */
export async function reconcilePendingCoffeeDonations(
  env: Env,
  opts: { limit?: number } = {}
): Promise<{ checked: number; completed: number }> {
  const limit = opts.limit ?? 20;
  const rows = await env.DB.prepare(
    "SELECT id FROM coffee_donations WHERE status IN ('WAITING_DEPOSIT', 'PROCESSING') ORDER BY created_at DESC LIMIT ?"
  )
    .bind(limit)
    .all<{ id: string }>();

  let checked = 0;
  let completed = 0;
  for (const r of rows.results || []) {
    checked++;
    try {
      const res = await checkAndSettleCoffeeDonation(env, r.id);
      if (res.status === 'COMPLETED') completed++;
    } catch {}
  }
  return { checked, completed };
}
