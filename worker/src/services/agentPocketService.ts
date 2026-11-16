/**
 * Agent Allowance Pocket Service (Option 1 for Passkey Self-Custody + MCP/AI Agents).
 *
 * How it works:
 *   - Every user has a deterministic, domain-separated 64-hex implicit `intents.near`
 *     Agent Pocket account derived via `deriveUserAgentPocket(env, nearAccount)`.
 *   - Their main non-custodial UPRAIL account (`u_<hex>.escrow.uprail.near`) retains
 *     100% passkey self-custody (zero server keys on `intents.near` or L1).
 *   - Users can load USDC, USDT, or NEAR into their Agent Allowance Pocket with one
 *     passkey signature, and reclaim all pocket funds back to their main account
 *     anytime (auto-recalled on last key revoke/delete).
 *   - While funded inside their UPRAIL spend caps, MCP / AI chat tools (`pay_handle`,
 *     `withdraw_to_wallet`, `accept_request`) spend directly from the pocket with
 *     zero passkey interruption.
 *   - Balance endpoints merge pocket holdings into the user's normal UPRAIL balance
 *     and all normal UPRAIL actions pull shortfall back from the pocket automatically.
 */

import type { Context } from 'hono';
import type { AppContext, Env, Session } from '../types';
import { PaymentStatus } from '../types';
import * as nearRpc from './nearRpc';
import { resolveAccount } from './accountResolver';
import { createPaymentInvite } from './inviteService';
import { resolveOrigin } from './webauthnConfig';
import { publicErrorMessage } from '../utils/errors';
import { background } from '../utils/background';
import {
  CustodyActionError,
  consumeAndVerifyWebAuthnPendingAction,
  createPendingCustodyAction,
} from './custodyService';
import { prepareSweepPlainL1ToIntents, submitNativeL1Operation } from './nativeL1Auth';
import {
  getCurrentIntentsSalt,
  getUserSession,
  validateGeneratedIntentForAccount,
  type UserSigningKey,
} from './oneclickAuth';
import { generateSwapIntent, requestQuote, submitSwapIntent } from './oneclickClient';
import {
  get1ClickWithdrawalQuote,
  isNearAccountAddress,
  isValidDestinationAddress,
} from './oneclickWithdraw';
import { buildIntentsPayloadString } from './selfCustodyCrypto';
import {
  AGENT_POCKET_CORE_ASSETS,
  deriveUserAgentPocket,
  executeCustodyIntents,
  getAgentPocketBalances,
  getCustodyVaultBalance,
  transferFromEarnCustody,
} from './earnVaults';
import {
  QUOTE_TTL_MS as CONF_QUOTE_TTL_MS,
  formatAtomic,
  getConfidentialAssetBalance,
  getConfidentialBalances,
  isConfidentialRailEnabled,
  payEscrowPrivate,
  scrubSettledPaymentLinks,
  submitImplicitAccountPrivateSendFromPublic,
  waitForSettlement,
} from './confidentialRail';

const POCKET_ACTION_TTL_MS = 10 * 60 * 1000;

export type AgentPocketCoreAsset = (typeof AGENT_POCKET_CORE_ASSETS)[number];

export function resolveAgentPocketCoreAsset(assetInput: string): AgentPocketCoreAsset | null {
  const raw = (assetInput || '').trim().toLowerCase();
  if (!raw) return null;
  for (const a of AGENT_POCKET_CORE_ASSETS) {
    if (
      a.assetId.toLowerCase() === raw ||
      a.nearContractId.toLowerCase() === raw ||
      a.symbol.toLowerCase() === raw ||
      (raw === 'wnear' && a.symbol === 'NEAR')
    ) {
      return a;
    }
  }
  return null;
}

export async function getAgentPocketSummary(env: Env, session: Session) {
  const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
  const [pocket, tokens] = await Promise.all([
    getAgentPocketBalances(env, nearAccount),
    nearRpc.getSupportedTokens(env).catch(() => [] as nearRpc.OnchainToken[]),
  ]);

  let totalUsd = 0;
  const enriched = pocket.balances.map((b) => {
    const matched = nearRpc.resolveTokenForAsset(b.defuse_asset_id, tokens);
    const price = nearRpc.tokenUsdPrice(matched?.symbol || b.symbol, matched?.priceUsd);
    const num = parseFloat(b.amountFormatted || '0') || 0;
    const usd = typeof price === 'number' && Number.isFinite(price) ? num * price : null;
    if (usd !== null) totalUsd += usd;
    return {
      assetId: b.defuse_asset_id,
      symbol: b.symbol,
      name: b.name,
      decimals: b.decimals,
      amount: b.amount,
      amountFormatted: b.amountFormatted,
      priceUsd: price,
      amountUsd: usd,
    };
  });

  return {
    pocketAccount: pocket.pocketAccount,
    mainAccount: nearAccount,
    balances: enriched,
    totalUsd: Number(totalUsd.toFixed(2)),
    rpcOk: pocket.rpcOk,
  };
}

/**
 * Computes all spendable balances for MCP/agent tools in a single parallel batch across:
 *   1. Main `intents.near` public balances (all held tokens)
 *   2. Agent Allowance Pocket (`intents.near` isolated allowance)
 *   3. NEAR L1 plain sub-account balances
 *   4. Confidential Intents balances (minus pending confidential withdrawals)
 *   5. D1 virtual escrow/pending deltas
 */
export async function getAllAgentReadableBalances(
  env: Env,
  session: Session
): Promise<{
  balances: Array<{ asset: string; balance: number; available: number }>;
  agentAllowance: {
    totalUsd: number;
    balances: Array<{ asset: string; balance: number; amountFormatted: string }>;
  };
}> {
  const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
  const confEnabled = isConfidentialRailEnabled(env);

  const [intentBals, plainBals, pocketRes, confBals, virtualDeltas, tokens] = await Promise.all([
    nearRpc.getIntentBalances(env, nearAccount).catch(() => [] as nearRpc.IntentAccountBalance[]),
    nearRpc.getPlainBalances(env, nearAccount).catch(() => [] as nearRpc.IntentAccountBalance[]),
    getAgentPocketBalances(env, nearAccount).catch(() => ({
      pocketAccount: null,
      balances: [] as any[],
      rpcOk: false,
    })),
    confEnabled
      ? getConfidentialBalances(env, session.x_id).catch(() => [] as any[])
      : Promise.resolve([] as any[]),
    env.DB
      ? nearRpc.getVirtualBalanceDeltas(env, session).catch(() => ({} as Record<string, number>))
      : Promise.resolve({} as Record<string, number>),
    nearRpc.getSupportedTokens(env).catch(() => [] as nearRpc.OnchainToken[]),
  ]);

  let pendingConfidential: Array<{ asset: string; amount: string }> = [];
  if (confEnabled && env.DB && confBals.length > 0) {
    try {
      const pending = await env.DB.prepare(
        `SELECT asset, amount FROM withdrawals
          WHERE x_id = ? AND privacy_rail = 'confidential' AND status = 'PENDING'`
      )
        .bind(session.x_id)
        .all<{ asset: string; amount: string }>();
      pendingConfidential = pending.results || [];
    } catch {}
  }

  const canonicalKey = (asset: string): { key: string; symbol: string } => {
    const matched = nearRpc.resolveTokenForAsset(asset, tokens);
    const key = (matched?.defuse_asset_id || asset || '').toLowerCase();
    const fallbackSym = (asset.split(':').pop() || asset).toUpperCase();
    const symbol = (matched?.symbol || (fallbackSym.includes('.') ? fallbackSym.split('.')[0] : fallbackSym)).toUpperCase();
    return { key, symbol };
  };

  const totals = new Map<string, { symbol: string; amount: number }>();
  const add = (asset: string, delta: number, preferredSymbol?: string) => {
    if (!Number.isFinite(delta) || delta === 0) return;
    const { key, symbol } = canonicalKey(asset);
    if (!key) return;
    const prev = totals.get(key);
    const displaySym = (preferredSymbol || symbol).toUpperCase();
    if (prev) {
      prev.amount += delta;
    } else {
      totals.set(key, { symbol: displaySym, amount: delta });
    }
  };

  for (const b of intentBals) {
    add(b.defuse_asset_id || b.symbol, parseFloat(b.amountFormatted || '0') || 0, b.symbol);
  }
  for (const pb of plainBals) {
    add(pb.defuse_asset_id || pb.symbol, parseFloat(pb.amountFormatted || '0') || 0, pb.symbol);
  }
  for (const ap of pocketRes.balances) {
    add(ap.defuse_asset_id || ap.symbol, parseFloat(ap.amountFormatted || '0') || 0, ap.symbol);
  }
  for (const cb of confBals) {
    let amt = parseFloat(cb.amountFormatted || '0') || 0;
    for (const row of pendingConfidential) {
      if (nearRpc.assetsMatch(row.asset, cb.assetId) || nearRpc.assetsMatch(row.asset, cb.symbol)) {
        amt -= parseFloat(row.amount) || 0;
      }
    }
    if (amt > 0) add(cb.assetId || cb.symbol, amt, cb.symbol);
  }
  for (const [assetKey, delta] of Object.entries(virtualDeltas)) {
    add(assetKey, delta);
  }

  // Group duplicate entries sharing the same uppercase ticker (keeping higher-precision sum)
  const byTicker = new Map<string, number>();
  for (const entry of totals.values()) {
    const net = Math.max(0, entry.amount);
    if (net <= 0) continue;
    byTicker.set(entry.symbol, (byTicker.get(entry.symbol) || 0) + net);
  }

  for (const core of ['USDC', 'NEAR', 'USDT']) {
    if (!byTicker.has(core)) byTicker.set(core, 0);
  }

  const ordered: Array<{ asset: string; balance: number; available: number }> = [];
  for (const core of ['USDC', 'NEAR', 'USDT']) {
    const v = Number((byTicker.get(core) || 0).toFixed(6));
    ordered.push({ asset: core, balance: v, available: v });
  }
  for (const [asset, raw] of byTicker.entries()) {
    if (asset === 'USDC' || asset === 'NEAR' || asset === 'USDT') continue;
    const v = Number(raw.toFixed(6));
    if (v > 0) ordered.push({ asset, balance: v, available: v });
  }

  let pocketUsd = 0;
  const pocketList = pocketRes.balances.map((b: any) => {
    const matched = nearRpc.resolveTokenForAsset(b.defuse_asset_id, tokens);
    const price = nearRpc.tokenUsdPrice(matched?.symbol || b.symbol, matched?.priceUsd);
    const balNum = Number((parseFloat(b.amountFormatted || '0') || 0).toFixed(6));
    if (typeof price === 'number' && Number.isFinite(price)) {
      pocketUsd += balNum * price;
    }
    return {
      asset: b.symbol,
      balance: balNum,
      amountFormatted: b.amountFormatted,
    };
  });

  return {
    balances: ordered,
    agentAllowance: {
      totalUsd: Number(pocketUsd.toFixed(2)),
      balances: pocketList,
    },
  };
}

export async function prepareAgentPocketFund(params: {
  env: Env;
  session: Session;
  asset: string;
  amount: string;
}) {
  const { env, session } = params;
  const core = resolveAgentPocketCoreAsset(params.asset || 'USDC');
  if (!core) {
    throw new CustodyActionError(
      'Agent Allowance Pocket currently supports USDC, USDT, and NEAR.',
      400,
      'UNSUPPORTED_POCKET_ASSET'
    );
  }

  const rawAmt = String(params.amount || '').trim().replace(/^["']|["']$/g, '');
  if (!rawAmt || !/^\d{1,15}(\.\d{1,18})?$/.test(rawAmt) || Number(rawAmt) <= 0) {
    throw new CustodyActionError('Enter a valid positive amount.', 400, 'INVALID_AMOUNT');
  }

  const amountAtomic = BigInt(nearRpc.toBaseUnits(rawAmt, core.decimals) || '0');
  if (amountAtomic <= 0n) {
    throw new CustodyActionError('Amount must be greater than zero.', 400, 'INVALID_AMOUNT');
  }

  const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
  const custody = await nearRpc.getUserCustodyRecord(env, session.x_id);
  const pocket = await deriveUserAgentPocket(env, nearAccount);

  if (custody.custodyMode !== 'self') {
    throw new CustodyActionError(
      'Managed custody accounts do not need a separate Agent Allowance Pocket — AI chats spend directly within your spend limits.',
      400,
      'NOT_REQUIRED_FOR_MANAGED_CUSTODY'
    );
  }

  // 1. Check Public Intents balance on main self-custody account
  const pubBal = await nearRpc.getIntentAssetBalance(env, core.assetId, nearAccount).catch(() => null);
  const pubAmt = pubBal?.balance ?? 0n;

  if (pubAmt >= amountAtomic) {
    const saltHex = await getCurrentIntentsSalt(env);
    const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
    const { payloadStr } = buildIntentsPayloadString({
      signerId: nearAccount,
      verifyingContract: intentsId,
      saltHex,
      intents: [
        {
          intent: 'transfer',
          receiver_id: pocket.accountId,
          tokens: { [core.assetId]: amountAtomic.toString() },
        },
      ],
      ttlMs: POCKET_ACTION_TTL_MS,
    });

    const pending = await createPendingCustodyAction({
      env,
      xId: session.x_id,
      actionType: 'AGENT_POCKET_FUND',
      payloadStr,
      meta: {
        mode: 'public_transfer',
        nearAccount,
        pocketAccount: pocket.accountId,
        assetId: core.assetId,
        symbol: core.symbol,
        amount: rawAmt,
        amountAtomic: amountAtomic.toString(),
      },
      requireOnchainPasskey: true,
    });

    return {
      step: 'fund_pocket' as const,
      mode: 'public_transfer' as const,
      ...pending,
      summary: {
        asset: core.symbol,
        amount: rawAmt,
        pocketAccount: pocket.accountId,
      },
    };
  }

  // 2. Check NEAR L1 plain balance — trigger two-step L1 sweep into Intents first
  const plain = await nearRpc.getPlainBalances(env, nearAccount).catch(() => []);
  const matchingPlain = plain.find(
    (b) =>
      nearRpc.assetsMatch(b.defuse_asset_id, core.assetId) ||
      nearRpc.assetsMatch(b.nearContractId, core.nearContractId)
  );
  const plainAmt = BigInt(matchingPlain?.amount || '0');
  if (matchingPlain && plainAmt > 0n && plainAmt + pubAmt >= amountAtomic) {
    return await prepareSweepPlainL1ToIntents({
      env,
      session,
      nearAccount,
      asset: core.assetId,
      symbol: core.symbol,
      amount:
        matchingPlain.amountFormatted ||
        formatAtomic((amountAtomic - pubAmt).toString(), core.decimals),
      nextStep: 'agent_pocket_fund',
    });
  }

  // 3. Check Confidential Intents balance — unshield 1:1 directly into pocket
  if (isConfidentialRailEnabled(env)) {
    const confBal = await getConfidentialAssetBalance(env, session.x_id, core.assetId).catch(
      () => null
    );
    const shortfall = amountAtomic - pubAmt;
    const unshieldAmountAtomic =
      confBal && confBal.amountAtomic >= amountAtomic
        ? amountAtomic
        : confBal && confBal.amountAtomic >= shortfall
        ? shortfall
        : 0n;

    if (unshieldAmountAtomic > 0n) {
      const { accessToken } = await getUserSession(env, session.x_id);
      const deliveryRecipient =
        unshieldAmountAtomic === amountAtomic ? pocket.accountId : nearAccount;
      const quote = await requestQuote(
        env,
        {
          dry: false,
          swapType: 'EXACT_INPUT',
          originAsset: core.assetId,
          destinationAsset: core.assetId,
          amount: unshieldAmountAtomic.toString(),
          recipient: deliveryRecipient,
          recipientType: 'INTENTS',
          refundTo: nearAccount,
          refundType: 'CONFIDENTIAL_INTENTS',
          depositType: 'CONFIDENTIAL_INTENTS',
          confidentiality: 'basic',
          slippageTolerance: 100,
          deadline: new Date(Date.now() + CONF_QUOTE_TTL_MS).toISOString(),
        },
        { userSession: accessToken }
      );
      const generated = await generateSwapIntent(env, {
        depositAddress: quote.quote.depositAddress,
        signerId: nearAccount,
        standard: 'webauthn',
      });
      validateGeneratedIntentForAccount(env, generated, nearAccount);
      const payloadStr = generated.rawPayload || generated.payload.message;

      const pending = await createPendingCustodyAction({
        env,
        xId: session.x_id,
        actionType: 'AGENT_POCKET_FUND_SWAP',
        payloadStr,
        meta: {
          mode: deliveryRecipient === pocket.accountId ? 'confidential_direct' : 'confidential_topup',
          nearAccount,
          pocketAccount: pocket.accountId,
          assetId: core.assetId,
          symbol: core.symbol,
          amount: formatAtomic(unshieldAmountAtomic.toString(), core.decimals),
          depositAddress: quote.quote.depositAddress,
        },
        requireOnchainPasskey: true,
      });

      return {
        step: deliveryRecipient === pocket.accountId ? ('fund_pocket' as const) : ('unshield' as const),
        nextStep: deliveryRecipient === pocket.accountId ? undefined : ('agent_pocket_fund' as const),
        ...pending,
        summary: {
          asset: core.symbol,
          amount: rawAmt,
          pocketAccount: pocket.accountId,
        },
      };
    }
  }

  throw new CustodyActionError(
    `Insufficient ${core.symbol} balance in your UPRAIL wallet to load ${rawAmt} ${core.symbol}.`,
    400,
    'INSUFFICIENT_FUNDS'
  );
}

export async function submitAgentPocketFund(params: {
  env: Env;
  session: Session;
  actionId: string;
  assertion: any;
  step?: string;
}) {
  const { env, session, actionId, assertion } = params;
  if (!env.DB) {
    throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');
  }

  const rowPeek = await env.DB.prepare(
    'SELECT action_type FROM pending_custody_actions WHERE id = ? AND x_id = ?'
  )
    .bind(actionId, session.x_id)
    .first<{ action_type: string }>();

  if (params.step === 'native_auth' || rowPeek?.action_type === 'AUTHORIZE_NATIVE_L1_KEY') {
    return await submitNativeL1Operation({ env, session, actionId, assertion });
  }

  if (rowPeek?.action_type === 'AGENT_POCKET_FUND_SWAP') {
    const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<{
      mode: string;
      nearAccount: string;
      pocketAccount: string;
      assetId: string;
      symbol: string;
      amount: string;
      depositAddress: string;
    }>({
      env,
      xId: session.x_id,
      actionId,
      assertion,
      expectedActionType: 'AGENT_POCKET_FUND_SWAP',
      requireOnchainPasskey: true,
    });

    const submitted = await submitSwapIntent(env, signedWebAuthn);
    const settlement = await waitForSettlement(env, session.x_id, meta.depositAddress, {
      timeoutMs: 25_000,
    }).catch(() => null);
    const settled = String(settlement?.status || '').toUpperCase() === 'SUCCESS';

    return {
      funded: meta.mode === 'confidential_direct',
      completed: meta.mode === 'confidential_direct',
      unshielded: meta.mode === 'confidential_topup',
      settled,
      txHash: submitted.intentHash,
      pocketAccount: meta.pocketAccount,
      asset: meta.symbol,
      amount: meta.amount,
    };
  }

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<{
    nearAccount: string;
    pocketAccount: string;
    assetId: string;
    symbol: string;
    amount: string;
  }>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'AGENT_POCKET_FUND',
    requireOnchainPasskey: true,
  });

  const sim = await nearRpc.simulateIntentsRelayed(env, [signedWebAuthn]);
  if (!sim.ok) {
    throw new CustodyActionError(
      `Transfer simulation rejected: ${sim.error || 'unknown error'}`,
      400,
      'SIMULATION_FAILED'
    );
  }

  const relay = await nearRpc.executeIntentsRelayed(env, signedWebAuthn);
  if (!relay.success || !relay.txHash) {
    throw new CustodyActionError(
      relay.error || 'Agent Allowance transfer failed on intents.near',
      502,
      'FUND_TRANSFER_FAILED'
    );
  }

  return {
    funded: true,
    completed: true,
    txHash: relay.txHash,
    pocketAccount: meta.pocketAccount,
    asset: meta.symbol,
    amount: meta.amount,
  };
}

/**
 * Checks whether the self-custody user's Agent Pocket covers the requested transfer batch.
 */
export async function probeAgentPocketForPayment(params: {
  env: Env;
  nearAccount: string;
  asset: string;
  recipients: ReadonlyArray<{ handle: string; amount: string; amountNum: number }>;
}): Promise<{
  covered: boolean;
  reason?: string;
  coreAsset?: AgentPocketCoreAsset;
  pocketAccount?: string;
  pocketBalanceAtomic?: bigint;
  totalGrossAtomic?: bigint;
}> {
  const coreAsset = resolveAgentPocketCoreAsset(params.asset);
  if (!coreAsset) {
    return { covered: false, reason: 'asset_not_supported_in_pocket' };
  }

  let totalGrossAtomic = 0n;
  for (const r of params.recipients) {
    try {
      const atomic = BigInt(nearRpc.toBaseUnits(r.amount, coreAsset.decimals) || '0');
      if (atomic <= 0n) return { covered: false, reason: 'invalid_amount', coreAsset };
      totalGrossAtomic += atomic;
    } catch {
      return { covered: false, reason: 'invalid_amount', coreAsset };
    }
  }

  const pocket = await deriveUserAgentPocket(params.env, params.nearAccount);
  const pocketBal = await getCustodyVaultBalance(params.env, pocket.accountId, coreAsset.assetId);
  if (pocketBal === null || pocketBal < totalGrossAtomic) {
    return {
      covered: false,
      reason: 'insufficient_pocket_balance',
      coreAsset,
      pocketAccount: pocket.accountId,
      pocketBalanceAtomic: pocketBal ?? 0n,
      totalGrossAtomic,
    };
  }

  return {
    covered: true,
    coreAsset,
    pocketAccount: pocket.accountId,
    pocketBalanceAtomic: pocketBal,
    totalGrossAtomic,
  };
}

/**
 * Executes a single @handle payment out of the user's Agent Allowance Pocket.
 */
export async function executeAgentPocketSingleSend(params: {
  env: Env;
  senderSession: Session;
  senderNearAccount: string;
  pocketAccount: string;
  coreAsset: AgentPocketCoreAsset;
  recipientHandle: string;
  rawAmount: string;
  memo?: string;
  requestId?: string | null;
  executionCtx?: unknown;
}): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, any>;
}> {
  const {
    env,
    senderSession,
    senderNearAccount,
    pocketAccount,
    coreAsset,
    recipientHandle,
    rawAmount,
    memo,
    requestId,
    executionCtx,
  } = params;

  if (!isConfidentialRailEnabled(env)) {
    return {
      ok: false,
      status: 503,
      body: {
        error: 'Confidential Intents rail must be enabled for Agent Pocket sends.',
        code: 'CONFIDENTIAL_RAIL_REQUIRED',
      },
    };
  }

  const cleanHandle = recipientHandle.trim().replace(/^@+/, '').toLowerCase();
  if (!cleanHandle || cleanHandle === (senderSession.x_handle || '').toLowerCase()) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Cannot send a payment to yourself.', code: 'SELF_SEND' },
    };
  }

  // Look up registered user row first; if absent, verify handle on X
  let recipientXId: string | null = null;
  let recipientNearAccount: string | null = null;
  let isRecipientRegistered = false;

  if (env.DB) {
    const row = await env.DB.prepare(
      'SELECT x_id, near_account, is_activated FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
    )
      .bind(cleanHandle)
      .first<{ x_id: string; near_account: string | null; is_activated: number | boolean }>();
    if (row) {
      recipientXId = row.x_id;
      recipientNearAccount =
        row.near_account ||
        (await nearRpc.resolveUserNearAccount(env, {
          x_id: row.x_id,
          x_handle: cleanHandle,
        }));
      isRecipientRegistered = Boolean(recipientNearAccount && (row.near_account || row.is_activated));
    }
  }

  if (!recipientXId) {
    const resolveRes = await resolveAccount(env, cleanHandle);
    if (!resolveRes.ok) {
      return {
        ok: false,
        status: resolveRes.status,
        body: { error: resolveRes.error, code: resolveRes.code },
      };
    }
  }

  const pocket = await deriveUserAgentPocket(env, senderNearAccount);
  if (pocket.accountId.toLowerCase() !== pocketAccount.toLowerCase()) {
    return {
      ok: false,
      status: 403,
      body: { error: 'Agent Pocket account mismatch.', code: 'POCKET_ACCOUNT_MISMATCH' },
    };
  }
  const pocketKey: UserSigningKey = {
    accountId: pocket.accountId,
    publicKey: pocket.publicKey,
    privateKey: pocket.privateKey,
    publicKeyB58: pocket.publicKeyB58,
  };

  const feePercent = Math.max(0, Math.min(0.1, parseFloat(env.FEE_PERCENT || '0.01') || 0.01));
  const grossNum = parseFloat(rawAmount) || 0;
  const protocolFee =
    (grossNum * feePercent).toFixed(Math.min(coreAsset.decimals, 6)).replace(/\.?0+$/, '') || '0';
  const recipientAmount =
    (grossNum - parseFloat(protocolFee))
      .toFixed(Math.min(coreAsset.decimals, 6))
      .replace(/\.?0+$/, '') || '0';

  const grossAtomic = BigInt(nearRpc.toBaseUnits(rawAmount, coreAsset.decimals) || '0');
  const feeAtomic = BigInt(nearRpc.toBaseUnits(protocolFee, coreAsset.decimals) || '0');
  const netAtomic = grossAtomic - feeAtomic;
  if (grossAtomic <= 0n || netAtomic <= 0n) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Amount too small to cover the protocol fee', code: 'INVALID_AMOUNT' },
    };
  }

  const feeRecipient = env.FEE_ACCOUNT_ID || 'escrow.uprail.near';
  const holdingAccount = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const paymentId = crypto.randomUUID();
  const now = Date.now();
  const expiryDays = parseInt(env.PAYMENT_EXPIRY_DAYS || '30', 10);
  const expiresAt = now + expiryDays * 86400 * 1000;
  const cleanMemo = typeof memo === 'string' && memo.trim() ? memo.trim().slice(0, 280) : null;

  const inviteCode = isRecipientRegistered
    ? null
    : await createPaymentInvite(env, paymentId, senderSession.x_id, senderSession.x_handle);

  // Record FIRST, move funds SECOND
  try {
    await env.DB!.prepare(
      `INSERT INTO payments (
        id, sender_x_id, sender_x_handle, recipient_handle, recipient_x_id,
        asset, amount, fee, fee_recipient, invite_code, memo,
        status, contract_mode, escrow_contract_id, escrow_send_id,
        deposit_address, intent_hash, claim_tx_hash, refund_tx_hash,
        created_at, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'escrow', NULL, NULL, ?, NULL, NULL, NULL, ?, ?, ?)`
    )
      .bind(
        paymentId,
        senderSession.x_id,
        senderSession.x_handle,
        cleanHandle,
        recipientXId,
        coreAsset.symbol,
        recipientAmount,
        protocolFee,
        feeRecipient,
        inviteCode,
        cleanMemo,
        PaymentStatus.PENDING,
        holdingAccount,
        now,
        expiresAt,
        now
      )
      .run();
  } catch (dbErr) {
    console.error('[agentPocket] failed to insert pending payment:', dbErr);
    return {
      ok: false,
      status: 500,
      body: { error: 'Could not record payment.', code: 'PAYMENT_RECORD_FAILED' },
    };
  }

  const cancelPending = async (reason: string) => {
    await env.DB!
      .prepare(
        `UPDATE payments
            SET status = ?, cancel_reason = ?, cancel_code = ?, privacy_rail = 'confidential', updated_at = ?
          WHERE id = ? AND status = ?`
      )
      .bind(
        PaymentStatus.CANCELLED,
        reason.slice(0, 500),
        'SETTLEMENT_FAILED',
        Date.now(),
        paymentId,
        PaymentStatus.PENDING
      )
      .run()
      .catch(() => {});
  };

  let transfer: Awaited<ReturnType<typeof submitImplicitAccountPrivateSendFromPublic>>;
  try {
    transfer = await submitImplicitAccountPrivateSendFromPublic(env, pocketKey, {
      asset: coreAsset.assetId,
      amount: rawAmount,
      recipientAccount: holdingAccount,
    });
  } catch (confErr: any) {
    const msg = publicErrorMessage(confErr, 'Confidential pocket transfer failed');
    await cancelPending(confErr?.message || msg);
    return {
      ok: false,
      status: 502,
      body: { error: msg, code: 'SETTLEMENT_FAILED' },
    };
  }

  const settlement = await waitForSettlement(env, '', transfer.depositAddress, {
    timeoutMs: 12_000,
    intervalMs: 1_500,
    accessToken: transfer.accessToken,
  }).catch(() => ({ status: 'UNKNOWN', terminal: false } as any));

  let settlementStatus = String(settlement?.status || 'UNKNOWN').toUpperCase();
  if (settlementStatus === 'FAILED' || settlementStatus === 'REFUNDED') {
    await cancelPending(`Confidential pocket send ${settlementStatus.toLowerCase()} — funds returned to pocket.`);
    return {
      ok: false,
      status: 502,
      body: {
        error: `Confidential pocket settlement ${settlementStatus.toLowerCase()} — funds stayed safely in your Agent Pocket.`,
        code: 'SETTLEMENT_FAILED',
      },
    };
  }

  let finalStatus: string = PaymentStatus.ESCROWED;
  let claimTxHash: string | null = null;
  let claimDepositAddress: string | null = null;
  let confirmedAt: number | null = settlementStatus === 'SUCCESS' ? Date.now() : null;
  let recipientPaidAtSend = false;

  if (isRecipientRegistered && recipientNearAccount) {
    if (settlementStatus === 'SUCCESS') {
      try {
        const payout = await payEscrowPrivate(env, {
          asset: coreAsset.assetId,
          amount: recipientAmount,
          recipientAccount: recipientNearAccount,
          timeoutMs: 10_000,
        });
        const payoutStatus = String(payout.status || 'UNKNOWN').toUpperCase();
        if (payoutStatus !== 'FAILED' && payoutStatus !== 'REFUNDED') {
          finalStatus = PaymentStatus.CLAIMED;
          claimTxHash = payout.intentHash;
          claimDepositAddress = payout.depositAddress;
          settlementStatus = payoutStatus;
          confirmedAt = payoutStatus === 'SUCCESS' ? Date.now() : null;
          recipientPaidAtSend = true;
        } else {
          console.warn(`[agentPocket] immediate confidential payout ${payoutStatus}; payment stays ESCROWED`);
        }
      } catch (payoutErr) {
        console.warn('[agentPocket] immediate confidential payout failed; payment stays ESCROWED:', payoutErr);
      }
    } else if (executionCtx) {
      const depAddr = transfer.depositAddress;
      const token = transfer.accessToken;
      background(
        executionCtx,
        (async () => {
          const bgSettlement = await waitForSettlement(env, '', depAddr, {
            timeoutMs: 45_000,
            intervalMs: 2_000,
            accessToken: token,
          }).catch(() => null);
          if (bgSettlement && String(bgSettlement.status || '').toUpperCase() === 'SUCCESS') {
            const bgPayout = await payEscrowPrivate(env, {
              asset: coreAsset.assetId,
              amount: recipientAmount,
              recipientAccount: recipientNearAccount,
              timeoutMs: 30_000,
            }).catch(() => null);
            if (bgPayout && bgPayout.status !== 'FAILED' && bgPayout.status !== 'REFUNDED') {
              await env.DB!.prepare(
                `UPDATE payments
                    SET status = 'CLAIMED', settlement_status = ?, claim_tx_hash = ?,
                        claim_deposit_address = ?, confirmed_at = ?, updated_at = ?
                  WHERE id = ? AND status = 'ESCROWED' AND privacy_rail = 'confidential'`
              )
                .bind(bgPayout.status, bgPayout.intentHash, bgPayout.depositAddress, Date.now(), Date.now(), paymentId)
                .run();
              await scrubSettledPaymentLinks(env, paymentId);
            }
          }
        })(),
        `agent-pocket-payout-${paymentId}`
      );
    }
  }

  const feeDispatchStatus = feeAtomic > 0n ? 'retained' : 'skipped';
  const feeDispatchError = feeAtomic > 0n ? null : 'no fee';

  await env.DB!
    .prepare(
      `UPDATE payments
          SET status = ?, deposit_address = ?, intent_hash = ?, claim_tx_hash = ?,
              privacy_rail = 'confidential', settlement_status = ?,
              claim_deposit_address = ?, confirmed_at = ?,
              fee_dispatch_status = ?, fee_dispatch_error = ?, updated_at = ?
        WHERE id = ? AND status = ?`
    )
    .bind(
      finalStatus,
      transfer.depositAddress,
      transfer.intentHash,
      claimTxHash,
      settlementStatus,
      claimDepositAddress,
      confirmedAt,
      feeDispatchStatus,
      feeDispatchError,
      Date.now(),
      paymentId,
      PaymentStatus.PENDING
    )
    .run();

  await scrubSettledPaymentLinks(env, paymentId);

  if (requestId) {
    await env.DB!
      .prepare(
        `UPDATE payment_requests SET status = 'COMPLETED', payment_id = ?, completed_at = ?
         WHERE id = ? AND status = 'PENDING'`
      )
      .bind(paymentId, Date.now(), requestId)
      .run()
      .catch(() => {});
  }

  await env.DB!
    .prepare(
      `INSERT INTO contacts (id, user_x_id, contact_handle, contact_x_id, preferred_asset, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(user_x_id, contact_handle) DO UPDATE SET updated_at = ?`
    )
    .bind(
      `cnt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      senderSession.x_id,
      cleanHandle,
      recipientXId,
      coreAsset.symbol,
      now,
      now,
      now
    )
    .run()
    .catch(() => {});

  const appOrigin = resolveOrigin(env);
  const shareLink = `${appOrigin}/claim/${paymentId}${inviteCode ? `?invite=${inviteCode}` : ''}`;
  const tweetText = `Hey @${cleanHandle}, I sent you ${rawAmount} ${coreAsset.symbol} on UPRAIL: ${shareLink}`;

  return {
    ok: true,
    status: 201,
    body: {
      paymentId,
      status: finalStatus,
      isDirect: recipientPaidAtSend,
      isRegistered: isRecipientRegistered,
      shareLink,
      claimLink: recipientPaidAtSend ? undefined : shareLink,
      receiptLink: recipientPaidAtSend ? shareLink : undefined,
      xShareUrl: `https://x.com/intent/post?text=${encodeURIComponent(tweetText)}`,
      tweetIntentUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`,
      txHash: recipientPaidAtSend && claimTxHash ? claimTxHash : transfer.intentHash,
      privacy: 'confidential',
      privacyRail: 'confidential',
      settlementStatus,
      source: 'agent_pocket',
      custodyMode: 'self',
    },
  };
}

/**
 * Attempts to execute an external or NEAR withdrawal directly from the self-custody
 * user's Agent Allowance Pocket. Returns `{ handled: false }` if unsupported or insufficient.
 */
export async function tryExecuteAgentPocketWithdraw(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  destinationAddress: string;
  destinationChain?: string;
  asset: string;
  amountStr: string;
  parsedAmount: number;
}): Promise<{
  handled: boolean;
  reason?: string;
  ambiguous?: boolean;
  withdrawalId?: string;
  responseStatus?: number;
  responseBody?: Record<string, any>;
}> {
  const {
    env,
    session,
    nearAccount,
    destinationAddress,
    destinationChain,
    asset,
    amountStr,
    parsedAmount,
  } = params;

  const core = resolveAgentPocketCoreAsset(asset);
  if (!core) {
    return { handled: false, reason: 'asset_not_supported_in_pocket' };
  }

  let amountAtomic: bigint;
  try {
    amountAtomic = BigInt(nearRpc.toBaseUnits(amountStr, core.decimals) || '0');
  } catch {
    return { handled: false, reason: 'invalid_amount' };
  }
  if (amountAtomic <= 0n) {
    return { handled: false, reason: 'invalid_amount' };
  }

  const pocket = await deriveUserAgentPocket(env, nearAccount);
  const pocketBal = await getCustodyVaultBalance(env, pocket.accountId, core.assetId);
  if (pocketBal === null || pocketBal < amountAtomic) {
    return { handled: false, reason: 'insufficient_pocket_balance' };
  }

  if (!isValidDestinationAddress(destinationAddress)) {
    return {
      handled: true,
      responseStatus: 400,
      responseBody: { error: 'Invalid destination address.', code: 'INVALID_DESTINATION' },
    };
  }

  const isNear =
    isNearAccountAddress(destinationAddress) && (!destinationChain || destinationChain === 'near');

  const withdrawalId = 'wth_' + crypto.randomUUID();
  const now = Date.now();
  const reserve = await env.DB!.prepare(
    `INSERT INTO withdrawals
       (id, x_id, x_handle, destination_address, asset, amount, tx_hash, status,
        privacy_rail, settlement_status, rail, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, NULL, 'PENDING', 'public', 'PENDING', ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM withdrawals WHERE x_id = ? AND asset = ? AND status = 'PENDING'
     )`
  )
    .bind(
      withdrawalId,
      session.x_id,
      session.x_handle,
      destinationAddress,
      core.symbol,
      amountStr,
      isNear ? 'intents' : 'cross_chain',
      now,
      now,
      session.x_id,
      core.symbol
    )
    .run();

  if ((reserve.meta?.changes ?? 0) === 0) {
    return {
      handled: true,
      responseStatus: 409,
      responseBody: {
        error: 'A withdrawal for this asset is already in progress.',
        code: 'WITHDRAWAL_IN_PROGRESS',
      },
    };
  }

  const markWithdrawFailed = async (msg: string, code = 'SETTLEMENT_FAILED') => {
    await env.DB!
      .prepare(
        "UPDATE withdrawals SET status = 'FAILED', error = ?, error_code = ?, settlement_status = 'FAILED', updated_at = ? WHERE id = ? AND status = 'PENDING'"
      )
      .bind(msg.slice(0, 500), code, Date.now(), withdrawalId)
      .run()
      .catch(() => {});
  };

  if (isNear) {
    const storage = await nearRpc.ensureSponsoredReceiverStorage(
      env,
      core.nearContractId,
      destinationAddress
    );
    if (!storage.registered) {
      const msg = storage.reason || `Destination account cannot receive ${core.symbol}`;
      await markWithdrawFailed(msg, 'RECEIVER_STORAGE_FAILED');
      return {
        handled: true,
        responseStatus: 400,
        responseBody: { error: msg, code: 'RECEIVER_STORAGE_FAILED' },
      };
    }

    const relay = await executeCustodyIntents(
      env,
      `agent_pocket:${nearAccount.toLowerCase()}`,
      [
        {
          intent: 'ft_withdraw',
          token: core.nearContractId,
          receiver_id: destinationAddress,
          amount: amountAtomic.toString(),
        },
      ],
      pocket.accountId
    );

    if (!relay.success || !relay.txHash) {
      const msg = relay.error || 'NEAR withdrawal relay failed';
      if (relay.ambiguous) {
        return {
          handled: true,
          ambiguous: true,
          withdrawalId,
          responseStatus: 504,
          responseBody: {
            error: `Withdrawal outcome ambiguous (id: ${withdrawalId}). Check balance before retrying.`,
            code: 'WITHDRAWAL_AMBIGUOUS',
            withdrawalId,
          },
        };
      }
      await markWithdrawFailed(msg);
      return {
        handled: true,
        responseStatus: 502,
        responseBody: { error: msg, code: 'WITHDRAWAL_FAILED' },
      };
    }

    await env.DB!
      .prepare(
        "UPDATE withdrawals SET tx_hash = ?, status = 'COMPLETED', settlement_status = 'SUCCESS', confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'"
      )
      .bind(relay.txHash, Date.now(), Date.now(), withdrawalId)
      .run();

    return {
      handled: true,
      withdrawalId,
      responseStatus: 200,
      responseBody: {
        withdrawalId,
        status: 'COMPLETED',
        txHash: relay.txHash,
        destinationAddress,
        destinationChain: 'near',
        asset: core.symbol,
        amount: amountStr,
        source: 'agent_pocket',
        custodyMode: 'self',
      },
    };
  }

  // External cross-chain 1Click quote (any refund safely returns to user's main non-custodial nearAccount)
  let quote;
  try {
    quote = await get1ClickWithdrawalQuote(env, {
      destinationAddress,
      asset: core.assetId,
      amount: parsedAmount,
      destinationChain,
      refundTo: nearAccount,
    });
  } catch (qErr: any) {
    const msg = publicErrorMessage(qErr, 'Could not get cross-chain withdrawal quote');
    await markWithdrawFailed(msg, 'QUOTE_FAILED');
    return {
      handled: true,
      responseStatus: 400,
      responseBody: { error: msg, code: 'QUOTE_FAILED' },
    };
  }

  const transferRes = await transferFromEarnCustody(
    env,
    `agent_pocket:${nearAccount.toLowerCase()}`,
    quote.depositAddress,
    core.assetId,
    amountAtomic,
    pocket.accountId
  );

  if (!transferRes.success || !transferRes.txHash) {
    const msg = transferRes.error || 'Cross-chain pocket withdrawal transfer failed';
    if (transferRes.ambiguous) {
      return {
        handled: true,
        ambiguous: true,
        withdrawalId,
        responseStatus: 504,
        responseBody: {
          error: `Withdrawal outcome ambiguous (id: ${withdrawalId}). Check balance before retrying.`,
          code: 'WITHDRAWAL_AMBIGUOUS',
          withdrawalId,
        },
      };
    }
    await markWithdrawFailed(msg);
    return {
      handled: true,
      responseStatus: 502,
      responseBody: { error: msg, code: 'WITHDRAWAL_FAILED' },
    };
  }

  await env.DB!
    .prepare(
      `UPDATE withdrawals
          SET tx_hash = ?, intent_hash = ?, deposit_address = ?, settlement_status = 'SUBMITTED', updated_at = ?
        WHERE id = ? AND status = 'PENDING'`
    )
    .bind(transferRes.txHash, transferRes.txHash, quote.depositAddress, Date.now(), withdrawalId)
    .run();

  return {
    handled: true,
    withdrawalId,
    responseStatus: 202,
    responseBody: {
      withdrawalId,
      status: 'PENDING',
      txHash: transferRes.txHash,
      depositAddress: quote.depositAddress,
      amountOut: quote.amountOut,
      destinationAddress,
      destinationChain: destinationChain || 'auto',
      asset: core.symbol,
      amount: amountStr,
      source: 'agent_pocket',
      custodyMode: 'self',
    },
  };
}
