/**
 * Confidential Intents rail.
 *
 * All money movement in this module is authorized by a wallet-signed intent and
 * submitted through 1Click. There is deliberately no public-intents fallback:
 * callers must check `isConfidentialRailEnabled` and handle a privacy failure
 * as a hard error.
 */

import type { Env } from '../types';
import * as nearRpc from './nearRpc';
import {
  getAccountBalances,
  generateSwapIntent,
  getExecutionStatus,
  isTerminalStatus,
  requestQuote,
  submitSwapIntent,
  type OneClickBalance,
  type OneClickConfidentiality,
  type OneClickQuoteResponse,
} from './oneclickClient';
import {
  getEscrowSession,
  getUserSession,
  signGeneratedIntent,
  signGeneratedIntentForEscrow,
} from './oneclickAuth';
import { resolveWithdrawalAssetPair } from './oneclickWithdraw';

const QUOTE_TTL_MS = 30 * 60 * 1000;

export interface ConfidentialBalance {
  assetId: string;
  amountAtomic: string;
  amountFormatted: string;
  decimals: number;
  symbol: string;
  source?: string;
}

export interface PrivateWithdrawalResult {
  depositAddress: string;
  intentHash: string;
  quote: OneClickQuoteResponse;
  status: string;
}

export function isConfidentialRailEnabled(env: Env): boolean {
  const value = (env.CONFIDENTIAL_RAIL_ENABLED || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function resolveTokenForAsset(asset: string, tokens: nearRpc.OnchainToken[]) {
  const exact = nearRpc.resolveTokenForAsset(asset, tokens);
  if (exact) return exact;
  const lower = asset.trim().toLowerCase();
  const byId = tokens.find(
    (t) =>
      t.defuse_asset_id.toLowerCase() === lower ||
      t.nearContractId.toLowerCase() === lower ||
      `nep141:${t.nearContractId}`.toLowerCase() === lower
  );
  return byId || null;
}

async function resolveToken(env: Env, asset: string): Promise<nearRpc.OnchainToken> {
  const tokens = await nearRpc.getSupportedTokens(env);
  let token = resolveTokenForAsset(asset, tokens);
  if (!token) token = await nearRpc.resolveRheaToken(env, asset);
  if (token) return token;

  const contractId = (asset.trim().toLowerCase().startsWith('nep141:')
    ? asset.trim().slice(7)
    : asset.trim()).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(contractId)) {
    throw new Error(`Unsupported asset: ${asset}`);
  }
  const meta = await nearRpc.getFtContractMetadata(env, contractId);
  if (!meta) throw new Error(`Unsupported asset: ${asset}`);
  return {
    defuse_asset_id: `nep141:${contractId}`,
    symbol: meta.symbol,
    name: meta.symbol,
    decimals: meta.decimals,
    nearContractId: contractId,
    chain: 'near',
  };
}

function findBalance(balances: OneClickBalance[], assetId: string): OneClickBalance | undefined {
  const lower = assetId.toLowerCase();
  return balances.find((b) => b.tokenId.toLowerCase() === lower);
}

/** Reads every confidential balance for the authenticated user. */
export async function getConfidentialBalances(
  env: Env,
  xId: string
): Promise<ConfidentialBalance[]> {
  const session = await getUserSession(env, xId);
  const [balances, tokens] = await Promise.all([
    getAccountBalances(env, session.accessToken),
    nearRpc.getSupportedTokens(env).catch(() => [] as nearRpc.OnchainToken[]),
  ]);

  const out: ConfidentialBalance[] = [];
  for (const balance of balances) {
    const token = resolveTokenForAsset(balance.tokenId, tokens);
    const decimals = token?.decimals ?? 0;
    out.push({
      assetId: balance.tokenId,
      amountAtomic: balance.available,
      amountFormatted: formatAtomic(balance.available, decimals),
      decimals,
      symbol: token?.symbol || balance.tokenId.split(':').pop()?.toUpperCase() || balance.tokenId,
      source: balance.source,
    });
  }
  return out;
}

/** Human-readable confidential balance for one asset, minus pending withdrawals. */
export async function getConfidentialAvailableBalance(
  env: Env,
  xId: string,
  asset: string
): Promise<number> {
  const balances = await getConfidentialBalances(env, xId);
  let pendingRows: Array<{ asset: string; amount: string }> = [];
  if (env.DB) {
    try {
      const pending = await env.DB.prepare(
        `SELECT asset, amount FROM withdrawals
          WHERE x_id = ? AND privacy_rail = 'confidential' AND status = 'PENDING'`
      )
        .bind(xId)
        .all<{ asset: string; amount: string }>();
      pendingRows = pending.results || [];
    } catch {}
  }

  let available = 0;
  for (const b of balances) {
    if (!nearRpc.assetsMatch(b.assetId, asset) && !nearRpc.assetsMatch(b.symbol, asset)) {
      continue;
    }
    let amount = parseFloat(b.amountFormatted) || 0;
    for (const row of pendingRows) {
      if (nearRpc.assetsMatch(row.asset, b.assetId) || nearRpc.assetsMatch(row.asset, b.symbol)) {
        amount -= parseFloat(row.amount) || 0;
      }
    }
    available += amount;
  }
  return Math.max(0, available);
}

/** Reads one confidential asset balance in atomic units. */
export async function getConfidentialAssetBalance(
  env: Env,
  xId: string,
  asset: string
): Promise<{
  assetId: string;
  contractId: string;
  amountAtomic: bigint;
  decimals: number;
  symbol: string;
}> {
  const token = await resolveToken(env, asset);
  const assetId = token.defuse_asset_id || `nep141:${token.nearContractId}`;
  const session = await getUserSession(env, xId);
  // 1Click's tokenIds filter currently returns an empty balance even when the
  // asset is held, so read every balance and filter locally.
  const balances = await getAccountBalances(env, session.accessToken);
  const match = findBalance(balances, assetId);
  return {
    assetId,
    contractId: token.nearContractId,
    amountAtomic: match ? BigInt(match.available) : 0n,
    decimals: token.decimals,
    symbol: token.symbol,
  };
}

export function formatAtomic(value: string, decimals: number): string {
  const digits = (value || '').replace(/^0+/, '') || '0';
  if (!/^\d+$/.test(digits)) return value;
  const d = Math.max(0, Math.min(Math.trunc(decimals), 30));
  if (d === 0) return digits;
  const padded = digits.padStart(d + 1, '0');
  const whole = padded.slice(0, -d);
  const frac = padded.slice(-d).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

type RailSigner = 'user' | 'escrow';

async function sessionFor(
  env: Env,
  xId: string,
  signer: RailSigner
): Promise<{ accessToken: string; accountId: string }> {
  return signer === 'escrow' ? getEscrowSession(env) : getUserSession(env, xId);
}

async function quoteForConfidentialIntents(
  env: Env,
  xId: string,
  params: {
    originAsset: string;
    destinationAsset: string;
    amountAtomic: string;
    recipient: string;
    recipientType: 'DESTINATION_CHAIN' | 'CONFIDENTIAL_INTENTS';
    depositType?: 'INTENTS' | 'CONFIDENTIAL_INTENTS';
    refundType?: 'INTENTS' | 'CONFIDENTIAL_INTENTS';
    confidentiality?: OneClickConfidentiality;
    signer?: RailSigner;
  }
): Promise<{ quote: OneClickQuoteResponse; userSession: string; accountId: string }> {
  const signer = params.signer || 'user';
  const session = await sessionFor(env, xId, signer);
  const confidentiality = params.confidentiality || 'basic';
  if (confidentiality === 'public') {
    throw new Error('Confidential rail refuses public confidentiality');
  }
  const quote = await requestQuote(
    env,
    {
      dry: false,
      swapType: 'EXACT_INPUT',
      originAsset: params.originAsset,
      destinationAsset: params.destinationAsset,
      amount: params.amountAtomic,
      recipient: params.recipient,
      recipientType: params.recipientType,
      refundTo: session.accountId,
      refundType: params.refundType || 'CONFIDENTIAL_INTENTS',
      depositType: params.depositType || 'CONFIDENTIAL_INTENTS',
      confidentiality,
      slippageTolerance: 100,
      deadline: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    },
    { userSession: session.accessToken }
  );
  return { quote, userSession: session.accessToken, accountId: session.accountId };
}

async function signAndSubmit(
  env: Env,
  xId: string,
  depositAddress: string,
  signer: RailSigner = 'user'
): Promise<{ intentHash: string; depositAddress: string }> {
  const session = await sessionFor(env, xId, signer);
  const generated = await generateSwapIntent(env, {
    depositAddress,
    signerId: session.accountId,
    standard: 'nep413',
  });
  const signedData =
    signer === 'escrow'
      ? await signGeneratedIntentForEscrow(env, generated)
      : await signGeneratedIntent(env, xId, generated);
  const submitted = await submitSwapIntent(env, signedData);
  return { intentHash: submitted.intentHash, depositAddress };
}

/**
 * Quotes and submits a private cross-chain withdrawal from the user's
 * Confidential Intents balance. The destination receives the swap output; the
 * refund path stays confidential.
 */
export async function submitPrivateWithdrawal(
  env: Env,
  xId: string,
  params: {
    asset: string;
    amount: string;
    destinationAddress: string;
    destinationChain?: string;
    confidentiality?: OneClickConfidentiality;
  }
): Promise<PrivateWithdrawalResult> {
  if (!isConfidentialRailEnabled(env)) {
    throw new Error('Confidential rail is disabled');
  }
  const pair = await resolveWithdrawalAssetPair(
    env,
    params.asset,
    params.destinationAddress,
    params.destinationChain
  );
  const amountAtomic = nearRpc.toBaseUnits(params.amount, pair.decimals);
  if (!amountAtomic || amountAtomic === '0') throw new Error(`Invalid amount: ${params.amount}`);

  const { quote } = await quoteForConfidentialIntents(env, xId, {
    originAsset: pair.originAsset,
    destinationAsset: pair.destinationAsset,
    amountAtomic,
    recipient: params.destinationAddress,
    recipientType: 'DESTINATION_CHAIN',
    confidentiality: params.confidentiality,
  });
  const submitted = await signAndSubmit(env, xId, quote.quote.depositAddress, 'user');
  return {
    depositAddress: submitted.depositAddress,
    intentHash: submitted.intentHash,
    quote,
    status: 'SUBMITTED',
  };
}

/**
 * Moves funds privately from one Confidential Intents account to another.
 * Used for escrow legs and claims once both sides hold confidential balances.
 */
export async function submitPrivateTransfer(
  env: Env,
  xId: string,
  params: {
    asset: string;
    amount: string;
    recipientAccount: string;
    confidentiality?: OneClickConfidentiality;
  }
): Promise<{ depositAddress: string; intentHash: string; quote: OneClickQuoteResponse }> {
  return await submitPrivateTransferWithSigner(env, xId, params, 'user');
}

/** Private transfer paid out of the pooled escrow confidential balance. */
export async function submitEscrowPrivateTransfer(
  env: Env,
  params: {
    asset: string;
    amount: string;
    recipientAccount: string;
    confidentiality?: OneClickConfidentiality;
  }
): Promise<{ depositAddress: string; intentHash: string; quote: OneClickQuoteResponse }> {
  return await submitPrivateTransferWithSigner(env, '', params, 'escrow');
}

/**
 * Moves funds from escrow's public Intents balance into a recipient's
 * confidential account. Used when creator fees arrive as plain NEP-141 and
 * have just been deposited into escrow's public Intents balance.
 */
export async function submitEscrowPrivateSendFromPublic(
  env: Env,
  params: {
    asset: string;
    amount: string;
    recipientAccount: string;
    confidentiality?: OneClickConfidentiality;
  }
): Promise<{ depositAddress: string; intentHash: string; quote: OneClickQuoteResponse }> {
  if (!isConfidentialRailEnabled(env)) throw new Error('Confidential rail is disabled');
  if (!params.recipientAccount.trim()) throw new Error('recipientAccount is required');
  const token = await resolveToken(env, params.asset);
  const assetId = token.defuse_asset_id || `nep141:${token.nearContractId}`;
  const amountAtomic = nearRpc.toBaseUnits(params.amount, token.decimals);
  if (!amountAtomic || amountAtomic === '0') throw new Error(`Invalid amount: ${params.amount}`);

  const { quote } = await quoteForConfidentialIntents(env, '', {
    originAsset: assetId,
    destinationAsset: assetId,
    amountAtomic,
    recipient: params.recipientAccount,
    recipientType: 'CONFIDENTIAL_INTENTS',
    depositType: 'INTENTS',
    refundType: 'INTENTS',
    confidentiality: params.confidentiality,
    signer: 'escrow',
  });
  const submitted = await signAndSubmit(env, '', quote.quote.depositAddress, 'escrow');
  return {
    depositAddress: submitted.depositAddress,
    intentHash: submitted.intentHash,
    quote,
  };
}

export interface EscrowPrivatePayout {
  status: string;
  depositAddress: string;
  intentHash: string;
  source: 'confidential' | 'public';
}

/**
 * Pays a recipient privately from escrow. Prefers escrow's existing
 * confidential balance; when the funds are still plain NEP-141 creator fees,
 * deposits the shortfall into escrow's public Intents balance first, then
 * shields it into the recipient's confidential account in one signed intent.
 *
 * Never falls back to a public payout. A quote/deposit failure throws before
 * funds move; an in-flight settlement is returned as a non-terminal status so
 * callers can reserve the row and let reconciliation finish it.
 */
export async function payEscrowPrivate(
  env: Env,
  params: {
    asset: string;
    amount: string;
    recipientAccount: string;
    confidentiality?: OneClickConfidentiality;
  }
): Promise<EscrowPrivatePayout> {
  if (!isConfidentialRailEnabled(env)) throw new Error('Confidential rail is disabled');
  if (!params.recipientAccount.trim()) throw new Error('recipientAccount is required');

  const token = await resolveToken(env, params.asset);
  const assetId = token.defuse_asset_id || `nep141:${token.nearContractId}`;
  const amountAtomic = nearRpc.toBaseUnits(params.amount, token.decimals);
  if (!amountAtomic || amountAtomic === '0') throw new Error(`Invalid amount: ${params.amount}`);

  const session = await getEscrowSession(env);
  const balances = await getAccountBalances(env, session.accessToken);
  const confidentialAtomic = BigInt(findBalance(balances, assetId)?.available || '0');
  const amountBig = BigInt(amountAtomic);

  let source: 'confidential' | 'public' = 'confidential';
  let transfer: { depositAddress: string; intentHash: string };

  if (confidentialAtomic >= amountBig) {
    transfer = await submitEscrowPrivateTransfer(env, params);
  } else {
    source = 'public';
    const publicBalance =
      (await nearRpc.getIntentAssetBalance(env, params.asset, session.accountId))?.balance ?? 0n;
    if (publicBalance < amountBig) {
      const shortfall = amountBig - publicBalance;
      const deposited = await nearRpc.depositEscrowPlainBalanceToIntents(
        env,
        params.asset,
        formatAtomic(shortfall.toString(), token.decimals)
      );
      if (!deposited.deposited) {
        throw new Error(
          `Could not move creator fees into Intents: ${deposited.reason || 'deposit failed'}`
        );
      }
      let ready = false;
      for (let i = 0; i < 15; i++) {
        const balance = await nearRpc.getIntentAssetBalance(env, params.asset, session.accountId);
        if (balance && balance.balance >= amountBig) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      if (!ready) throw new Error('Escrow Intents balance is not ready for a private payout');
    }
    transfer = await submitEscrowPrivateSendFromPublic(env, params);
  }

  const settlement = await waitForSettlement(env, '', transfer.depositAddress, {
    signer: 'escrow',
    timeoutMs: 60_000,
  }).catch(() => ({ status: 'UNKNOWN' }));
  return {
    status: String(settlement.status || 'UNKNOWN').toUpperCase(),
    depositAddress: transfer.depositAddress,
    intentHash: transfer.intentHash,
    source,
  };
}

async function submitPrivateTransferWithSigner(
  env: Env,
  xId: string,
  params: {
    asset: string;
    amount: string;
    recipientAccount: string;
    confidentiality?: OneClickConfidentiality;
  },
  signer: RailSigner
): Promise<{ depositAddress: string; intentHash: string; quote: OneClickQuoteResponse }> {
  if (!isConfidentialRailEnabled(env)) {
    throw new Error('Confidential rail is disabled');
  }
  if (!params.recipientAccount.trim()) throw new Error('recipientAccount is required');
  const token = await resolveToken(env, params.asset);
  const assetId = token.defuse_asset_id || `nep141:${token.nearContractId}`;
  const amountAtomic = nearRpc.toBaseUnits(params.amount, token.decimals);
  if (!amountAtomic || amountAtomic === '0') throw new Error(`Invalid amount: ${params.amount}`);

  const { quote } = await quoteForConfidentialIntents(env, xId, {
    originAsset: assetId,
    destinationAsset: assetId,
    amountAtomic,
    recipient: params.recipientAccount,
    recipientType: 'CONFIDENTIAL_INTENTS',
    confidentiality: params.confidentiality,
    signer,
  });
  const submitted = await signAndSubmit(env, xId, quote.quote.depositAddress, signer);
  return {
    depositAddress: submitted.depositAddress,
    intentHash: submitted.intentHash,
    quote,
  };
}

/**
 * Moves funds from the user's public Intents balance into a confidential
 * account (the recipient's, or pooled escrow for an unregistered handle).
 * This is the send leg: the public debit and the private credit are not
 * linkable by the destination.
 */
export async function submitPrivateSendFromPublic(
  env: Env,
  xId: string,
  params: {
    asset: string;
    amount: string;
    recipientAccount: string;
    confidentiality?: OneClickConfidentiality;
  }
): Promise<{ depositAddress: string; intentHash: string; quote: OneClickQuoteResponse }> {
  if (!isConfidentialRailEnabled(env)) {
    throw new Error('Confidential rail is disabled');
  }
  if (!params.recipientAccount.trim()) throw new Error('recipientAccount is required');
  const token = await resolveToken(env, params.asset);
  const assetId = token.defuse_asset_id || `nep141:${token.nearContractId}`;
  const amountAtomic = nearRpc.toBaseUnits(params.amount, token.decimals);
  if (!amountAtomic || amountAtomic === '0') throw new Error(`Invalid amount: ${params.amount}`);

  const { quote } = await quoteForConfidentialIntents(env, xId, {
    originAsset: assetId,
    destinationAsset: assetId,
    amountAtomic,
    recipient: params.recipientAccount,
    recipientType: 'CONFIDENTIAL_INTENTS',
    depositType: 'INTENTS',
    refundType: 'INTENTS',
    confidentiality: params.confidentiality,
    signer: 'user',
  });
  const submitted = await signAndSubmit(env, xId, quote.quote.depositAddress, 'user');
  return {
    depositAddress: submitted.depositAddress,
    intentHash: submitted.intentHash,
    quote,
  };
}

export interface SettlementPollResult {
  status: string;
  terminal: boolean;
  intentHash?: string;
  raw: Record<string, unknown>;
}

/** Polls 1Click until the quote reaches a terminal state or the budget expires. */
export async function waitForSettlement(
  env: Env,
  xId: string,
  depositAddress: string,
  opts: {
    depositMemo?: string;
    timeoutMs?: number;
    intervalMs?: number;
    signer?: RailSigner;
  } = {}
): Promise<SettlementPollResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const started = Date.now();
  let last: SettlementPollResult = { status: 'UNKNOWN', terminal: false, raw: {} };
  const session = await sessionFor(env, xId, opts.signer || 'user');

  while (Date.now() - started < timeoutMs) {
    const status = await getExecutionStatus(env, depositAddress, opts.depositMemo, session.accessToken);
    last = {
      status: status.status,
      terminal: isTerminalStatus(status.status),
      intentHash: status.intentHash,
      raw: status.raw,
    };
    if (last.terminal) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

/**
 * Ensures the user's confidential account holds at least `requiredAtomic`.
 * Existing balances live in public Intents (or directly on the user's pk
 * sub-account); move only the shortfall into Confidential Intents with a
 * signed private transfer. This is the withdrawal-side counterpart to the
 * send path's public→confidential shielding.
 */
export async function ensureConfidentialFunds(
  env: Env,
  xId: string,
  asset: string,
  requiredAtomic: bigint
): Promise<{
  balance: Awaited<ReturnType<typeof getConfidentialAssetBalance>>;
  shieldedAtomic: bigint;
}> {
  if (requiredAtomic <= 0n) {
    return { balance: await getConfidentialAssetBalance(env, xId, asset), shieldedAtomic: 0n };
  }

  const before = await getConfidentialAssetBalance(env, xId, asset);
  if (before.amountAtomic >= requiredAtomic) {
    return { balance: before, shieldedAtomic: 0n };
  }

  const shortfall = requiredAtomic - before.amountAtomic;
  const session = await getUserSession(env, xId);
  const accountId = session.accountId;
  if (!accountId) throw new Error('CONFIDENTIAL_ACCOUNT_UNAVAILABLE');

  const publicHolding = await nearRpc.getIntentAssetBalance(env, asset, accountId);
  if (publicHolding === null) {
    throw new Error('PUBLIC_BALANCE_UNAVAILABLE');
  }

  if (publicHolding.balance < shortfall) {
    const fromPlain = shortfall - publicHolding.balance;
    const deposit = await nearRpc.depositPlainBalanceToIntents(
      env,
      xId,
      asset,
      formatAtomic(fromPlain.toString(), before.decimals),
      accountId
    );
    if (!deposit.deposited) {
      throw new Error(`INSUFFICIENT_FUNDS: ${deposit.reason || 'could not move funds into Intents'}`);
    }
  }

  const shield = await submitPrivateSendFromPublic(env, xId, {
    asset,
    amount: formatAtomic(shortfall.toString(), before.decimals),
    recipientAccount: accountId,
  });
  const settlement = await waitForSettlement(env, xId, shield.depositAddress, {
    timeoutMs: 90_000,
  });
  const status = String(settlement.status || 'UNKNOWN').toUpperCase();
  if (status !== 'SUCCESS') {
    throw new Error(`SHIELD_${status}: confidential funding did not settle`);
  }

  const after = await getConfidentialAssetBalance(env, xId, asset);
  if (after.amountAtomic < requiredAtomic) {
    throw new Error('SHIELD_INCOMPLETE: confidential balance is still short');
  }
  return { balance: after, shieldedAtomic: shortfall };
}

/**
 * Reconciles confidential send/claim legs whose synchronous status poll timed
 * out. Claim legs are escrow-signed; direct sends and escrowed sends are
 * sender-signed. A failed direct send is cancelled, a failed claim returns to
 * ESCROWED so it can be retried after 1Click refunds the funds to escrow.
 */
export async function reconcileConfidentialPayments(
  env: Env,
  opts: { limit?: number; minAgeMs?: number } = {}
): Promise<{ checked: number; completed: number; failed: number }> {
  if (!isConfidentialRailEnabled(env)) return { checked: 0, completed: 0, failed: 0 };
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
  const minAgeMs = opts.minAgeMs ?? 15_000;
  let rows: Array<{
    id: string;
    sender_x_id: string | null;
    status: string;
    settlement_status: string | null;
    deposit_address: string | null;
    claim_deposit_address: string | null;
    intent_hash: string | null;
    claim_tx_hash: string | null;
  }> = [];
  try {
    const result = await env.DB.prepare(
      `SELECT id, sender_x_id, status, settlement_status, deposit_address,
              claim_deposit_address, intent_hash, claim_tx_hash
         FROM payments
        WHERE privacy_rail = 'confidential'
          AND status IN ('CLAIMED', 'ESCROWED')
          AND settlement_status IS NOT NULL
          AND UPPER(settlement_status) NOT IN ('SUCCESS', 'FAILED', 'REFUNDED')
          AND (claim_deposit_address IS NOT NULL OR deposit_address IS NOT NULL)
          AND updated_at < ?
        ORDER BY updated_at ASC
        LIMIT ?`
    )
      .bind(Date.now() - minAgeMs, limit)
      .all<{
        id: string;
        sender_x_id: string | null;
        status: string;
        settlement_status: string | null;
        deposit_address: string | null;
        claim_deposit_address: string | null;
        intent_hash: string | null;
        claim_tx_hash: string | null;
      }>();
    rows = result.results || [];
  } catch (err) {
    console.warn('[confidentialRail] payment reconciliation query failed:', err);
    return { checked: 0, completed: 0, failed: 0 };
  }

  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    // A claim leg is escrow-signed and carries the original escrow funding
    // hash in `intent_hash`. A direct confidential send is sender-signed and
    // has no `intent_hash`; its quote lives in `claim_deposit_address`, not
    // in the client-supplied `deposit_address`.
    const isClaim = Boolean(row.status === 'CLAIMED' && row.intent_hash && row.claim_deposit_address);
    const isDirectSend = Boolean(row.status === 'CLAIMED' && !row.intent_hash && row.claim_deposit_address);
    const depositAddress =
      isClaim || isDirectSend ? row.claim_deposit_address : row.deposit_address;
    if (!depositAddress || (!isClaim && !isDirectSend && !row.sender_x_id)) continue;
    try {
      const session = isClaim
        ? await getEscrowSession(env)
        : await getUserSession(env, row.sender_x_id || '');
      const status = await getExecutionStatus(env, depositAddress, undefined, session.accessToken);
      const normalized = status.status.toUpperCase();
      if (normalized === 'SUCCESS') {
        await env.DB.prepare(
          `UPDATE payments
              SET settlement_status = 'SUCCESS', confirmed_at = ?, updated_at = ?
            WHERE id = ? AND privacy_rail = 'confidential'`
        )
          .bind(Date.now(), Date.now(), row.id)
          .run();
        completed++;
      } else if (normalized === 'FAILED' || normalized === 'REFUNDED') {
        if (isClaim) {
          await env.DB.prepare(
            `UPDATE payments
                SET status = 'ESCROWED', claim_tx_hash = NULL, claim_deposit_address = NULL,
                    settlement_status = ?, updated_at = ?
              WHERE id = ? AND status = 'CLAIMED' AND privacy_rail = 'confidential'`
          )
            .bind(normalized, Date.now(), row.id)
            .run();
        } else {
          await env.DB.prepare(
            `UPDATE payments
                SET status = 'CANCELLED', cancel_reason = ?, cancel_code = 'SETTLEMENT_FAILED',
                    settlement_status = ?, updated_at = ?
              WHERE id = ? AND privacy_rail = 'confidential'`
          )
            .bind(`1Click ${normalized.toLowerCase()} the confidential send.`, normalized, Date.now(), row.id)
            .run();
        }
        failed++;
      } else if (normalized !== (row.settlement_status || '').toUpperCase()) {
        await env.DB.prepare(
          `UPDATE payments SET settlement_status = ?, updated_at = ? WHERE id = ?`
        )
          .bind(normalized, Date.now(), row.id)
          .run();
      }
    } catch (err) {
      console.warn(`[confidentialRail] payment status poll failed id=${row.id}:`, err);
    }
  }
  return { checked: rows.length, completed, failed };
}

/**
 * Reconciles submitted confidential withdrawals with 1Click. A row is only
 * marked COMPLETED on a terminal SUCCESS; FAILED/REFUNDED release the
 * reservation, and in-flight statuses are persisted for diagnostics.
 */
export async function reconcileConfidentialWithdrawals(
  env: Env,
  opts: { limit?: number; minAgeMs?: number } = {}
): Promise<{ checked: number; completed: number; failed: number }> {
  if (!isConfidentialRailEnabled(env)) return { checked: 0, completed: 0, failed: 0 };
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
  const minAgeMs = opts.minAgeMs ?? 15_000;
  let rows: Array<{
    id: string;
    x_id: string;
    deposit_address: string;
    settlement_status: string | null;
  }> = [];
  try {
    const result = await env.DB.prepare(
      `SELECT id, x_id, deposit_address, settlement_status
         FROM withdrawals
        WHERE privacy_rail = 'confidential'
          AND status = 'PENDING'
          AND deposit_address IS NOT NULL
          AND created_at < ?
        ORDER BY created_at ASC
        LIMIT ?`
    )
      .bind(Date.now() - minAgeMs, limit)
      .all<{ id: string; x_id: string; deposit_address: string; settlement_status: string | null }>();
    rows = result.results || [];
  } catch (err) {
    console.warn('[confidentialRail] reconciliation query failed:', err);
    return { checked: 0, completed: 0, failed: 0 };
  }

  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const session = await getUserSession(env, row.x_id);
      const status = await getExecutionStatus(env, row.deposit_address, undefined, session.accessToken);
      const normalized = status.status.toUpperCase();
      if (normalized === 'SUCCESS') {
        await env.DB.prepare(
          `UPDATE withdrawals
              SET status = 'COMPLETED', settlement_status = 'SUCCESS', confirmed_at = ?, updated_at = ?
            WHERE id = ? AND status = 'PENDING'`
        )
          .bind(Date.now(), Date.now(), row.id)
          .run();
        completed++;
      } else if (normalized === 'FAILED' || normalized === 'REFUNDED') {
        await env.DB.prepare(
          `UPDATE withdrawals
              SET status = 'FAILED', settlement_status = ?, error = ?, updated_at = ?
            WHERE id = ? AND status = 'PENDING'`
        )
          .bind(
            normalized,
            normalized === 'REFUNDED'
              ? '1Click refunded the swap to the confidential refund address.'
              : '1Click reported the swap as failed.',
            Date.now(),
            row.id
          )
          .run();
        failed++;
      } else if (normalized !== (row.settlement_status || '').toUpperCase()) {
        await env.DB.prepare(
          'UPDATE withdrawals SET settlement_status = ?, updated_at = ? WHERE id = ? AND status = \'PENDING\''
        )
          .bind(normalized, Date.now(), row.id)
          .run();
      }
    } catch (err: any) {
      console.warn(
        `[confidentialRail] status poll failed id=${row.id}:`,
        err?.message || err
      );
    }
  }
  return { checked: rows.length, completed, failed };
}
