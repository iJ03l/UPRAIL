/**
 * Multi-Member Quota Circles Service (`worker/src/services/circles.ts`).
 *
 * Allows users to create collaborative Earn Vault circles with explicit member
 * percentage allocations (expressed in integer basis points summing to 10,000 = 100%),
 * a shared purpose (Contributions, Shared Goal, Rent, Trip, or Daily Goal Tip),
 * and any 1Click Earn Vault asset (`TLO`, `gtUSDCp`, `kV-gtSOLb`).
 *
 * Security invariants:
 *   - All critical actions (create, contribute, settle, dissolve) require WebAuthn
 *     passkey authorization (`requirePasskeyAuth()`).
 *   - Strict anti-IDOR: only the creator or invited members can view or interact
 *     with a Circle.
 *   - Member attribution on contribution is derived strictly from the authenticated
 *     `session.x_id` / `session.x_handle`, never from a client-supplied member ID.
 *   - Percentages are validated in integer basis points (`sum === 10000`).
 *   - Share balances are tracked in exact BigInt atomic units.
 */

import type { Env, Session } from '../types';
import * as nearRpc from './nearRpc';
import {
  computeStabilizeSplit,
  getOneClickTokens,
  resolveOriginToken,
  type OneClickToken,
} from './stabilize';
import { getExecutionStatus, requestQuote } from './oneclickClient';
import { formatAtomic } from './confidentialRail';
import {
  computeVaultPositionValuation,
  deriveEarnCustodyKey,
  EarnVaultError,
  generateSecureId,
  getCustodyVaultBalance,
  getEarnVaults,
  normalizeAndValidateHandle,
  resolveEarnVault,
  sanitizeUserText,
  transferBatchFromEarnCustody,
  transferFromEarnCustody,
  type EarnVaultDescriptor,
} from './earnVaults';

export class CircleError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'CircleError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const VALID_CIRCLE_PURPOSES = [
  'CONTRIBUTIONS',
  'SHARED_GOAL',
  'RENT',
  'TRIP',
  'DAILY_TIP',
] as const;

export type CirclePurpose = (typeof VALID_CIRCLE_PURPOSES)[number];

export const CIRCLE_PURPOSE_LABELS: Record<CirclePurpose, string> = {
  CONTRIBUTIONS: 'Group Contributions',
  SHARED_GOAL: 'Shared Goal',
  RENT: 'Rent & Housing',
  TRIP: 'Group Trip',
  DAILY_TIP: 'Daily Goal Tip',
};

const PENDING_CONTRIB_TTL_MS = 2 * 60 * 60 * 1000;

export interface CircleMemberInput {
  handle: string;
  /** Either percentageShare (e.g. 25 or 33.33) or shareBps (e.g. 2500 or 3333) */
  percentageShare?: number;
  shareBps?: number;
}

export interface CreateCircleInput {
  name: string;
  purpose: string;
  note?: string;
  targetAmountUsd: number;
  vaultAsset: string;
  payoutHandle?: string;
  members: CircleMemberInput[];
}

export interface ContributeCircleInput {
  sourceAsset: string;
  amount: string;
  fundingMode?: 'BALANCE' | 'EXTERNAL_DEPOSIT';
}

export interface CircleMemberView {
  id: string;
  handle: string;
  xId: string | null;
  shareBps: number;
  percentageShare: number;
  quotaUsdCents: number;
  contributedUsdCents: number;
  fulfillmentPct: number;
  hasMetQuota: boolean;
  sharesAtomic: string;
  sharesFormatted: string;
  isCurrentUser: boolean;
  refundedAt?: number | null;
  refundTxHash?: string | null;
}

export interface CircleContributionView {
  id: string;
  memberId: string;
  contributorXId: string;
  sourceSymbol: string;
  grossAmount: string;
  usdCents: number;
  sharesAtomic: string;
  sharesFormatted: string;
  status: string;
  depositAddress?: string | null;
  depositMemo?: string | null;
  intentHash?: string | null;
  createdAt: number;
  confirmedAt?: number | null;
}

export interface CircleView {
  id: string;
  creatorXId: string;
  creatorHandle: string;
  isCreator: boolean;
  name: string;
  purpose: CirclePurpose;
  purposeLabel: string;
  note: string | null;
  targetUsdCents: number;
  totalContributedUsdCents: number;
  completionPct: number;
  vaultSymbol: string;
  vaultName: string;
  vaultProtocol: string;
  vaultChainName: string;
  vaultAssetId: string;
  vaultDecimals: number;
  estimatedApyPct: number;
  totalSharesAtomic: string;
  totalSharesFormatted: string;
  currentValueUsdCents: number;
  yieldUsdCents: number;
  yieldPct: number;
  payoutHandle: string;
  custodyAccount: string;
  status: string;
  payoutTxHash?: string | null;
  members: CircleMemberView[];
  recentContributions: CircleContributionView[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number | null;
}

export function validateCirclePurpose(raw: string): CirclePurpose {
  const upper = (raw || '').trim().toUpperCase();
  if ((VALID_CIRCLE_PURPOSES as readonly string[]).includes(upper)) {
    return upper as CirclePurpose;
  }
  throw new CircleError(
    'INVALID_PURPOSE',
    `Purpose must be one of: ${VALID_CIRCLE_PURPOSES.join(', ')}.`,
    400
  );
}

/**
 * Validates and normalizes member allocations, ensuring basis points sum to
 * exactly 10,000 (100.00%) with no duplicate handles.
 */
export function normalizeMemberAllocations(
  members: CircleMemberInput[],
  targetUsdCents: number
): Array<{
  handle: string;
  shareBps: number;
  quotaUsdCents: number;
}> {
  if (!Array.isArray(members) || members.length < 1) {
    throw new CircleError('INVALID_MEMBERS', 'Add at least 1 member to the Circle.', 400);
  }
  if (members.length > 25) {
    throw new CircleError('TOO_MANY_MEMBERS', 'A Circle can have at most 25 members.', 400);
  }

  const seenHandles = new Set<string>();
  const normalized: Array<{ handle: string; shareBps: number; quotaUsdCents: number }> = [];
  let sumBps = 0;

  for (const m of members) {
    let handle: string;
    try {
      handle = normalizeAndValidateHandle(m?.handle, 'Member handle');
    } catch (err: any) {
      throw new CircleError(err.code || 'INVALID_MEMBER_HANDLE', err.message, 400);
    }
    if (seenHandles.has(handle)) {
      throw new CircleError(
        'DUPLICATE_MEMBER',
        `@${handle} is listed more than once in this Circle.`,
        400
      );
    }
    seenHandles.add(handle);

    let bps = 0;
    if (typeof m.shareBps === 'number' && Number.isFinite(m.shareBps)) {
      bps = Math.round(m.shareBps);
    } else if (typeof m.percentageShare === 'number' && Number.isFinite(m.percentageShare)) {
      bps = Math.round(m.percentageShare * 100);
    }
    if (bps < 100 || bps > 10000) {
      throw new CircleError(
        'INVALID_MEMBER_SHARE',
        `Each member must have a share between 1% and 100% (@${handle} has ${(bps / 100).toFixed(2)}%).`,
        400
      );
    }
    sumBps += bps;
    normalized.push({ handle, shareBps: bps, quotaUsdCents: 0 });
  }

  if (sumBps !== 10000) {
    throw new CircleError(
      'PERCENTAGE_SUM_MISMATCH',
      `Member percentage shares must sum to exactly 100% (currently ${(sumBps / 100).toFixed(2)}%).`,
      400
    );
  }

  // Allocate exact USD cents per member, with final member absorbing rounding remainder
  let allocatedCents = 0;
  for (let i = 0; i < normalized.length; i++) {
    if (i === normalized.length - 1) {
      normalized[i].quotaUsdCents = Math.max(1, targetUsdCents - allocatedCents);
    } else {
      const slice = Math.max(1, Math.round((targetUsdCents * normalized[i].shareBps) / 10000));
      normalized[i].quotaUsdCents = slice;
      allocatedCents += slice;
    }
  }

  return normalized;
}

/**
 * Creates a new multi-member Earn Vault Circle.
 */
export async function createCircle(
  env: Env,
  session: Session,
  input: CreateCircleInput
): Promise<CircleView> {
  const name = sanitizeUserText(input.name, 80);
  if (!name || name.length < 2) {
    throw new CircleError('INVALID_NAME', 'Enter a Circle name (2–80 characters).', 400);
  }

  const purpose = validateCirclePurpose(input.purpose);
  const note = sanitizeUserText(input.note, 280) || null;

  const targetUsd = Number(input.targetAmountUsd);
  if (!Number.isFinite(targetUsd) || targetUsd < 10 || targetUsd > 1_000_000) {
    throw new CircleError(
      'INVALID_TARGET_AMOUNT',
      'Circle target amount must be between $10 and $1,000,000 USD.',
      400
    );
  }
  const targetUsdCents = Math.round(targetUsd * 100);

  let vault: EarnVaultDescriptor;
  try {
    vault = await resolveEarnVault(env, input.vaultAsset);
  } catch (err: any) {
    if (err instanceof EarnVaultError) {
      throw new CircleError(err.code, err.message, err.httpStatus);
    }
    throw err;
  }

  const creatorHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
  const payoutHandle = input.payoutHandle
    ? normalizeAndValidateHandle(input.payoutHandle, 'Payout handle')
    : creatorHandle;

  const allocations = normalizeMemberAllocations(input.members, targetUsdCents);

  // Ensure creator is either a member or the creator is recorded so they can manage
  const circleId = generateSecureId('circ');
  const custody = await deriveEarnCustodyKey(env, circleId);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO circles (
      id, creator_x_id, creator_handle, name, purpose, note,
      target_usd_cents, vault_asset_id, vault_symbol, vault_decimals,
      payout_handle, custody_account, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
  )
    .bind(
      circleId,
      session.x_id,
      creatorHandle,
      name,
      purpose,
      note,
      targetUsdCents,
      vault.assetId,
      vault.symbol,
      vault.decimals,
      payoutHandle,
      custody.accountId,
      now,
      now
    )
    .run();

  for (const alloc of allocations) {
    const memberId = generateSecureId('cmem');
    let memberXId: string | null = null;
    if (alloc.handle === creatorHandle) {
      memberXId = session.x_id;
    } else {
      const existing = await env.DB.prepare(
        'SELECT x_id FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
      )
        .bind(alloc.handle)
        .first<{ x_id: string }>();
      if (existing) memberXId = existing.x_id;
    }

    await env.DB.prepare(
      `INSERT INTO circle_members (
        id, circle_id, x_handle, x_id, share_bps, quota_usd_cents,
        contributed_usd_cents, shares_atomic, joined_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, '0', ?, ?)`
    )
      .bind(
        memberId,
        circleId,
        alloc.handle,
        memberXId,
        alloc.shareBps,
        alloc.quotaUsdCents,
        memberXId ? now : null,
        now
      )
      .run();
  }

  return getCircleDetail(env, session, circleId);
}

async function buildCircleView(
  env: Env,
  session: Session,
  circleRow: any,
  preloadedVault?: EarnVaultDescriptor
): Promise<CircleView> {
  const vaults = preloadedVault ? [preloadedVault] : await getEarnVaults(env);
  const vault =
    vaults.find((v) => v.assetId.toLowerCase() === String(circleRow.vault_asset_id).toLowerCase()) ||
    vaults[0];

  const [memberRows, contribRows] = await Promise.all([
    env.DB.prepare('SELECT * FROM circle_members WHERE circle_id = ? ORDER BY share_bps DESC, created_at ASC')
      .bind(circleRow.id)
      .all<any>(),
    env.DB.prepare('SELECT * FROM circle_contributions WHERE circle_id = ? ORDER BY created_at DESC LIMIT 30')
      .bind(circleRow.id)
      .all<any>(),
  ]);

  const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
  const vaultDecimals = Number(circleRow.vault_decimals || vault?.decimals || 18);

  let totalSharesAtomic = 0n;
  let totalContributedUsdCents = 0;

  const members: CircleMemberView[] = (memberRows.results || []).map((m) => {
    const shares = BigInt(String(m.shares_atomic || '0'));
    totalSharesAtomic += shares;
    const contributed = Number(m.contributed_usd_cents || 0);
    totalContributedUsdCents += contributed;
    const quota = Math.max(1, Number(m.quota_usd_cents || 1));
    const fulfillmentPct = Math.min(100, Number(((contributed / quota) * 100).toFixed(1)));
    const hasMetQuota = contributed >= quota;
    const isCurrentUser =
      (m.x_id && m.x_id === session.x_id) ||
      Boolean(callerHandle && String(m.x_handle || '').toLowerCase() === callerHandle);

    return {
      id: m.id,
      handle: m.x_handle,
      xId: m.x_id || null,
      shareBps: Number(m.share_bps),
      percentageShare: Number((Number(m.share_bps) / 100).toFixed(2)),
      quotaUsdCents: quota,
      contributedUsdCents: contributed,
      fulfillmentPct,
      hasMetQuota,
      sharesAtomic: shares.toString(),
      sharesFormatted: formatAtomic(shares.toString(), vaultDecimals),
      isCurrentUser,
      refundedAt: m.refunded_at ? Number(m.refunded_at) : null,
      refundTxHash: m.refund_tx_hash || null,
    };
  });

  const valuation = computeVaultPositionValuation({
    sharesAtomic: totalSharesAtomic,
    vaultDecimals,
    sharePriceUsd: vault?.priceUsd || 0,
    principalUsdCents: totalContributedUsdCents,
  });

  const targetUsdCents = Math.max(1, Number(circleRow.target_usd_cents || 1));
  const completionPct = Math.min(
    100,
    Number(((totalContributedUsdCents / targetUsdCents) * 100).toFixed(1))
  );

  const purpose = (VALID_CIRCLE_PURPOSES as readonly string[]).includes(circleRow.purpose)
    ? (circleRow.purpose as CirclePurpose)
    : 'SHARED_GOAL';

  const recentContributions: CircleContributionView[] = (contribRows.results || []).map((c) => {
    const cShares = String(c.shares_atomic || c.quoted_shares_atomic || '0');
    return {
      id: c.id,
      memberId: c.member_id,
      contributorXId: c.contributor_x_id,
      sourceSymbol: c.source_symbol,
      grossAmount: formatAtomic(String(c.gross_atomic || '0'), Number(c.source_decimals || 6)),
      usdCents: Number(c.usd_cents || 0),
      sharesAtomic: cShares,
      sharesFormatted: formatAtomic(cShares, vaultDecimals),
      status: c.status,
      depositAddress: c.deposit_address || null,
      depositMemo: c.deposit_memo || null,
      intentHash: c.intent_hash || null,
      createdAt: Number(c.created_at),
      confirmedAt: c.confirmed_at ? Number(c.confirmed_at) : null,
    };
  });

  return {
    id: circleRow.id,
    creatorXId: circleRow.creator_x_id,
    creatorHandle: circleRow.creator_handle,
    isCreator: circleRow.creator_x_id === session.x_id,
    name: circleRow.name,
    purpose,
    purposeLabel: CIRCLE_PURPOSE_LABELS[purpose],
    note: circleRow.note || null,
    targetUsdCents,
    totalContributedUsdCents,
    completionPct,
    vaultSymbol: circleRow.vault_symbol,
    vaultName: vault?.name || circleRow.vault_symbol,
    vaultProtocol: vault?.protocol || 'NEAR Intents Earn',
    vaultChainName: vault?.chainName || 'Multichain',
    vaultAssetId: circleRow.vault_asset_id,
    vaultDecimals,
    estimatedApyPct: vault?.estimatedApyPct ?? 6.5,
    totalSharesAtomic: totalSharesAtomic.toString(),
    totalSharesFormatted: valuation.sharesFormatted,
    currentValueUsdCents: valuation.currentValueUsdCents,
    yieldUsdCents: valuation.yieldUsdCents,
    yieldPct: valuation.yieldPct,
    payoutHandle: circleRow.payout_handle,
    custodyAccount: circleRow.custody_account,
    status: circleRow.status,
    payoutTxHash: circleRow.payout_tx_hash || null,
    members,
    recentContributions,
    createdAt: Number(circleRow.created_at),
    updatedAt: Number(circleRow.updated_at),
    closedAt: circleRow.closed_at ? Number(circleRow.closed_at) : null,
  };
}

/**
 * Returns full details of a Circle (`GET /api/circles/:id`).
 * Enforces anti-IDOR: caller must be the creator or an invited member.
 */
export async function getCircleDetail(
  env: Env,
  session: Session,
  circleId: string
): Promise<CircleView> {
  const cleanId = (circleId || '').trim();
  if (!/^circ_[a-f0-9]{16,64}$/.test(cleanId)) {
    throw new CircleError('NOT_FOUND', 'Circle not found.', 404);
  }

  const circleRow = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(cleanId)
    .first<any>();
  if (!circleRow) {
    throw new CircleError('NOT_FOUND', 'Circle not found.', 404);
  }

  const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
  const isCreator = circleRow.creator_x_id === session.x_id;

  const memberMatch = await env.DB.prepare(
    'SELECT id, x_id FROM circle_members WHERE circle_id = ? AND (x_id = ? OR LOWER(x_handle) = ?) LIMIT 1'
  )
    .bind(cleanId, session.x_id, callerHandle)
    .first<{ id: string; x_id: string | null }>();

  if (!isCreator && !memberMatch) {
    throw new CircleError(
      'FORBIDDEN',
      'You are not a member of this Circle.',
      403
    );
  }

  if (memberMatch && !memberMatch.x_id) {
    await env.DB.prepare(
      'UPDATE circle_members SET x_id = ?, joined_at = COALESCE(joined_at, ?) WHERE id = ? AND x_id IS NULL'
    )
      .bind(session.x_id, Date.now(), memberMatch.id)
      .run()
      .catch(() => {});
  }

  return buildCircleView(env, session, circleRow);
}

/**
 * Lists all Circles where the authenticated user is the creator or a member.
 */
export async function listUserCircles(
  env: Env,
  session: Session
): Promise<CircleView[]> {
  const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();

  if (callerHandle) {
    await env.DB.prepare(
      'UPDATE circle_members SET x_id = ?, joined_at = COALESCE(joined_at, ?) WHERE LOWER(x_handle) = ? AND x_id IS NULL'
    )
      .bind(session.x_id, Date.now(), callerHandle)
      .run()
      .catch(() => {});
  }

  const circleRows = await env.DB.prepare(
    `SELECT DISTINCT c.*
     FROM circles c
     LEFT JOIN circle_members m ON m.circle_id = c.id
     WHERE c.creator_x_id = ? OR m.x_id = ? OR LOWER(m.x_handle) = ?
     ORDER BY c.created_at DESC
     LIMIT 50`
  )
    .bind(session.x_id, session.x_id, callerHandle)
    .all<any>();

  const vaults = await getEarnVaults(env);
  const byAsset = new Map<string, EarnVaultDescriptor>();
  for (const v of vaults) byAsset.set(v.assetId.toLowerCase(), v);

  return Promise.all(
    (circleRows.results || []).map((row) =>
      buildCircleView(
        env,
        session,
        row,
        byAsset.get(String(row.vault_asset_id).toLowerCase())
      )
    )
  );
}

/**
 * Passkey-gated member contribution into a Circle's Earn Vault (`POST /api/circles/:id/contribute`).
 * Derives the contributing member strictly from `session.x_id` / `session.x_handle` (anti-IDOR).
 */
export async function contributeToCircle(
  env: Env,
  session: Session,
  circleId: string,
  input: ContributeCircleInput
): Promise<{ circle: CircleView; contribution: CircleContributionView }> {
  const cleanId = (circleId || '').trim();
  if (!/^circ_[a-f0-9]{16,64}$/.test(cleanId)) {
    throw new CircleError('NOT_FOUND', 'Circle not found.', 404);
  }

  const circleRow = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(cleanId)
    .first<any>();
  if (!circleRow) {
    throw new CircleError('NOT_FOUND', 'Circle not found.', 404);
  }

  if (circleRow.status !== 'ACTIVE' && circleRow.status !== 'GOAL_MET') {
    throw new CircleError(
      'CIRCLE_CLOSED',
      `Cannot contribute to a Circle in status ${circleRow.status}.`,
      400
    );
  }

  const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
  const memberRow = await env.DB.prepare(
    'SELECT * FROM circle_members WHERE circle_id = ? AND (x_id = ? OR LOWER(x_handle) = ?) LIMIT 1'
  )
    .bind(cleanId, session.x_id, callerHandle)
    .first<any>();

  if (!memberRow) {
    throw new CircleError(
      'NOT_A_MEMBER',
      'Only invited members of this Circle can contribute towards a quota.',
      403
    );
  }

  const oneClickTokens = await getOneClickTokens(env).catch(() => [] as OneClickToken[]);
  const vault = await resolveEarnVault(env, circleRow.vault_asset_id, oneClickTokens);
  const origin = await resolveOriginToken(env, input.sourceAsset, oneClickTokens).catch((err) => {
    throw new CircleError('UNSUPPORTED_SOURCE_ASSET', err?.message || 'Unsupported token.', 400);
  });

  const rawAmt = (input.amount || '').trim();
  if (!rawAmt || !/^\d+(\.\d+)?$/.test(rawAmt) || Number(rawAmt) <= 0) {
    throw new CircleError('INVALID_AMOUNT', 'Enter a valid positive token amount.', 400);
  }

  const grossAtomicStr = nearRpc.toBaseUnits(rawAmt, origin.decimals);
  const grossAtomic = BigInt(grossAtomicStr || '0');
  if (grossAtomic <= 0n) {
    throw new CircleError('INVALID_AMOUNT', 'Amount must be greater than zero.', 400);
  }

  const originPrice =
    typeof origin.priceUsd === 'number' && origin.priceUsd > 0
      ? origin.priceUsd
      : origin.symbol === 'USDC' || origin.symbol === 'USDT'
      ? 1
      : 0;
  const estUsd = originPrice > 0 ? Number(rawAmt) * originPrice : 0;
  if (estUsd > 0 && estUsd + 0.05 < vault.minDepositUsd) {
    throw new CircleError(
      'BELOW_VAULT_MINIMUM',
      `Minimum contribution for ${vault.name} (${vault.symbol}) is $${vault.minDepositUsd} USD.`,
      400
    );
  }

  const split = computeStabilizeSplit(grossAtomic, origin.decimals, env.FEE_PERCENT);
  const contribId = generateSecureId('ccon');
  const now = Date.now();
  const expiresAt = now + PENDING_CONTRIB_TTL_MS;
  const deadline = new Date(expiresAt).toISOString();
  const senderNearAccount = await nearRpc.resolveUserNearAccount(env, session);
  const fundingMode = input.fundingMode === 'EXTERNAL_DEPOSIT' ? 'EXTERNAL_DEPOSIT' : 'BALANCE';

  if (fundingMode === 'BALANCE') {
    try {
      await nearRpc.depositPlainBalanceToIntents(
        env,
        session.x_id,
        origin.assetId,
        split.grossAmountFormatted,
        senderNearAccount
      );
    } catch {}

    const avail = await nearRpc.getUserAvailableBalance(env, session, origin.assetId);
    const reqNum = Number(split.grossAmountFormatted);
    if (avail + 1e-6 < reqNum) {
      throw new CircleError(
        'INSUFFICIENT_BALANCE',
        `Insufficient ${origin.symbol} balance (${avail.toFixed(4)} available, ${split.grossAmountFormatted} required).`,
        400
      );
    }

    let liveQuote;
    try {
      liveQuote = await requestQuote(env, {
        dry: false,
        swapType: 'EXACT_INPUT',
        originAsset: origin.assetId,
        destinationAsset: vault.assetId,
        amount: split.netInputAtomic.toString(),
        recipient: circleRow.custody_account,
        recipientType: 'INTENTS',
        refundTo: senderNearAccount,
        refundType: 'INTENTS',
        depositType: 'INTENTS',
        slippageTolerance: 200,
        deadline,
      });
    } catch (err: any) {
      throw new CircleError(
        'QUOTE_FAILED',
        `1Click could not quote ${origin.symbol} → ${vault.symbol}: ${err?.message || String(err)}`,
        502
      );
    }

    const quotedSharesAtomic = BigInt(
      liveQuote.quote.amountOut || liveQuote.quote.minAmountOut || '0'
    );
    if (quotedSharesAtomic <= 0n) {
      throw new CircleError('QUOTE_FAILED', '1Click returned 0 vault shares.', 502);
    }

    const rawQ = ((liveQuote.raw as any)?.quote || {}) as Record<string, unknown>;
    const inUsd = Number(rawQ.amountInUsd || estUsd * 0.99);
    const usdCents = Math.max(100, Math.round((Number.isFinite(inUsd) && inUsd > 0 ? inUsd : estUsd) * 100));

    const swapRes = await nearRpc.executeCrossChainSwapTransfer(
      env,
      session.x_id,
      liveQuote.quote.depositAddress
    );
    if (!swapRes.success) {
      throw new CircleError(
        'CONTRIBUTION_FAILED',
        `Failed to fund Circle contribution: ${swapRes.error || 'Swap transfer rejected'}`,
        502
      );
    }

    let feeTxHash: string | null = null;
    let feeStatus = 'NONE';
    if (split.feeAtomic > 0n && split.feeAmountFormatted !== '0') {
      const feeRecipient = env.FEE_ACCOUNT_ID || env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
      const feeRes = await nearRpc
        .executeTransferIntent(
          env,
          session.x_id,
          feeRecipient,
          origin.assetId,
          split.feeAmountFormatted
        )
        .catch(() => ({ success: false, txHash: undefined }));
      if (feeRes.success) {
        feeStatus = 'PAID';
        feeTxHash = feeRes.txHash || null;
      }
    }

    const prevMemberShares = BigInt(String(memberRow.shares_atomic || '0'));
    const nextMemberShares = prevMemberShares + quotedSharesAtomic;
    const nextMemberUsdCents = Number(memberRow.contributed_usd_cents || 0) + usdCents;

    await env.DB.prepare(
      `INSERT INTO circle_contributions (
        id, circle_id, member_id, contributor_x_id,
        source_asset, source_symbol, source_decimals,
        gross_atomic, usd_cents,
        deposit_address, deposit_memo,
        quoted_shares_atomic, balance_before_atomic, shares_atomic,
        fee_shares_atomic, fee_status, fee_tx_hash,
        status, intent_hash,
        expires_at, created_at, updated_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', ?, '0', ?, ?, 'CONFIRMED', ?, ?, ?, ?, ?)`
    )
      .bind(
        contribId,
        cleanId,
        memberRow.id,
        session.x_id,
        origin.assetId,
        origin.symbol,
        origin.decimals,
        split.grossAtomic.toString(),
        usdCents,
        liveQuote.quote.depositAddress,
        liveQuote.quote.depositMemo || null,
        quotedSharesAtomic.toString(),
        quotedSharesAtomic.toString(),
        feeStatus,
        feeTxHash,
        swapRes.txHash || null,
        expiresAt,
        now,
        now,
        now
      )
      .run();

    await env.DB.prepare(
      `UPDATE circle_members
       SET x_id = COALESCE(x_id, ?),
           joined_at = COALESCE(joined_at, ?),
           contributed_usd_cents = ?,
           shares_atomic = ?
       WHERE id = ?`
    )
      .bind(
        session.x_id,
        now,
        nextMemberUsdCents,
        nextMemberShares.toString(),
        memberRow.id
      )
      .run();

    // Check if all members have now met their quota
    const allMembers = await env.DB.prepare(
      'SELECT quota_usd_cents, contributed_usd_cents FROM circle_members WHERE circle_id = ?'
    )
      .bind(cleanId)
      .all<{ quota_usd_cents: number; contributed_usd_cents: number }>();

    const allMet = (allMembers.results || []).every(
      (m) => Number(m.contributed_usd_cents) >= Number(m.quota_usd_cents)
    );
    if (allMet && circleRow.status === 'ACTIVE') {
      await env.DB.prepare(
        "UPDATE circles SET status = 'GOAL_MET', updated_at = ? WHERE id = ? AND status = 'ACTIVE'"
      )
        .bind(now, cleanId)
        .run();
    } else {
      await env.DB.prepare('UPDATE circles SET updated_at = ? WHERE id = ?')
        .bind(now, cleanId)
        .run();
    }

    const updatedCircle = await getCircleDetail(env, session, cleanId);
    const contribView = updatedCircle.recentContributions.find((c) => c.id === contribId) || {
      id: contribId,
      memberId: memberRow.id,
      contributorXId: session.x_id,
      sourceSymbol: origin.symbol,
      grossAmount: split.grossAmountFormatted,
      usdCents,
      sharesAtomic: quotedSharesAtomic.toString(),
      sharesFormatted: formatAtomic(quotedSharesAtomic.toString(), vault.decimals),
      status: 'CONFIRMED',
      depositAddress: liveQuote.quote.depositAddress,
      depositMemo: liveQuote.quote.depositMemo || null,
      intentHash: swapRes.txHash || null,
      createdAt: now,
      confirmedAt: now,
    };

    return { circle: updatedCircle, contribution: contribView };
  }

  // EXTERNAL_DEPOSIT mode
  let extQuote;
  try {
    extQuote = await requestQuote(env, {
      dry: false,
      swapType: 'FLEX_INPUT',
      originAsset: origin.assetId,
      destinationAsset: vault.assetId,
      amount: split.grossAtomic.toString(),
      recipient: circleRow.custody_account,
      recipientType: 'INTENTS',
      refundTo: senderNearAccount,
      refundType: 'INTENTS',
      depositType: 'ORIGIN_CHAIN',
      slippageTolerance: 300,
      deadline,
    });
  } catch (err: any) {
    throw new CircleError(
      'QUOTE_FAILED',
      `1Click could not create deposit quote: ${err?.message || String(err)}`,
      502
    );
  }

  const grossShares = BigInt(extQuote.quote.amountOut || extQuote.quote.minAmountOut || '0');
  const shareSplit = computeStabilizeSplit(grossShares, vault.decimals, env.FEE_PERCENT);
  const rawQ = ((extQuote.raw as any)?.quote || {}) as Record<string, unknown>;
  const inUsd = Number(rawQ.amountInUsd || estUsd);
  const usdCents = Math.max(
    100,
    Math.round((Number.isFinite(inUsd) && inUsd > 0 ? inUsd * 0.99 : estUsd * 0.99) * 100)
  );

  await env.DB.prepare(
    `INSERT INTO circle_contributions (
      id, circle_id, member_id, contributor_x_id,
      source_asset, source_symbol, source_decimals,
      gross_atomic, usd_cents,
      deposit_address, deposit_memo,
      quoted_shares_atomic, balance_before_atomic, shares_atomic,
      fee_shares_atomic, fee_status,
      status, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', NULL, ?, 'PENDING', 'PENDING_FUNDING', ?, ?, ?)`
  )
    .bind(
      contribId,
      cleanId,
      memberRow.id,
      session.x_id,
      origin.assetId,
      origin.symbol,
      origin.decimals,
      split.grossAtomic.toString(),
      usdCents,
      extQuote.quote.depositAddress,
      extQuote.quote.depositMemo || null,
      shareSplit.netInputAtomic.toString(),
      shareSplit.feeAtomic.toString(),
      expiresAt,
      now,
      now
    )
    .run();

  const updatedCircle = await getCircleDetail(env, session, cleanId);
  const contribView: CircleContributionView = {
    id: contribId,
    memberId: memberRow.id,
    contributorXId: session.x_id,
    sourceSymbol: origin.symbol,
    grossAmount: split.grossAmountFormatted,
    usdCents,
    sharesAtomic: shareSplit.netInputAtomic.toString(),
    sharesFormatted: formatAtomic(shareSplit.netInputAtomic.toString(), vault.decimals),
    status: 'PENDING_FUNDING',
    depositAddress: extQuote.quote.depositAddress,
    depositMemo: extQuote.quote.depositMemo || null,
    intentHash: null,
    createdAt: now,
    confirmedAt: null,
  };

  return { circle: updatedCircle, contribution: contribView };
}

/**
 * Creator-only, passkey-gated Circle payout (`POST /api/circles/:id/settle`).
 * Transfers 100% of the Circle's Earn Vault shares (principal + yield) to the
 * Circle's designated `payout_handle`.
 */
export async function settleCircle(
  env: Env,
  session: Session,
  circleId: string
): Promise<CircleView> {
  const cleanId = (circleId || '').trim();
  if (!/^circ_[a-f0-9]{16,64}$/.test(cleanId)) {
    throw new CircleError('NOT_FOUND', 'Circle not found.', 404);
  }

  const circleRow = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(cleanId)
    .first<any>();
  if (!circleRow) {
    throw new CircleError('NOT_FOUND', 'Circle not found.', 404);
  }

  if (circleRow.creator_x_id !== session.x_id) {
    throw new CircleError(
      'FORBIDDEN',
      'Only the Circle creator can settle and disburse the Circle vault.',
      403
    );
  }

  if (circleRow.status === 'SETTLED') {
    throw new CircleError('ALREADY_SETTLED', 'This Circle has already been settled.', 409);
  }
  if (circleRow.status !== 'ACTIVE' && circleRow.status !== 'GOAL_MET') {
    throw new CircleError(
      'INVALID_CIRCLE_STATE',
      `Circle cannot be settled while in status ${circleRow.status}.`,
      400
    );
  }

  const memberRows = await env.DB.prepare(
    'SELECT shares_atomic FROM circle_members WHERE circle_id = ?'
  )
    .bind(cleanId)
    .all<{ shares_atomic: string }>();

  let recordedShares = 0n;
  for (const m of memberRows.results || []) {
    recordedShares += BigInt(String(m.shares_atomic || '0'));
  }

  const liveBalance = await getCustodyVaultBalance(
    env,
    circleRow.custody_account,
    circleRow.vault_asset_id
  );
  const sharesToDisburse =
    liveBalance !== null && liveBalance > 0n ? liveBalance : recordedShares;

  if (sharesToDisburse <= 0n) {
    throw new CircleError('EMPTY_CIRCLE_VAULT', 'This Circle holds 0 vault shares to disburse.', 400);
  }

  const now = Date.now();
  const lockRes = await env.DB.prepare(
    "UPDATE circles SET status = 'SETTLING', updated_at = ? WHERE id = ? AND status IN ('ACTIVE', 'GOAL_MET')"
  )
    .bind(now, cleanId)
    .run();

  if (!lockRes.meta?.changes) {
    throw new CircleError('SETTLE_IN_PROGRESS', 'Circle settlement is already in progress.', 409);
  }

  try {
    let payoutNearAccount: string;
    const payoutHandle = String(circleRow.payout_handle || circleRow.creator_handle).toLowerCase();
    const payoutUser = await env.DB.prepare(
      'SELECT x_id, x_handle, near_account FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
    )
      .bind(payoutHandle)
      .first<{ x_id: string; x_handle: string; near_account: string | null }>();

    if (payoutUser) {
      payoutNearAccount = await nearRpc.resolveUserNearAccount(env, payoutUser);
    } else {
      payoutNearAccount = await nearRpc.resolveUserNearAccount(env, session);
    }

    const transferRes = await transferFromEarnCustody(
      env,
      cleanId,
      payoutNearAccount,
      circleRow.vault_asset_id,
      sharesToDisburse
    );

    if (!transferRes.success) {
      if (!transferRes.ambiguous) {
        await env.DB.prepare(
          "UPDATE circles SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND status = 'SETTLING'"
        )
          .bind(Date.now(), cleanId)
          .run();
      }
      throw new CircleError(
        'SETTLE_TRANSFER_FAILED',
        `Could not disburse Circle vault shares: ${transferRes.error || 'Transfer failed'}`,
        502
      );
    }

    const closedAt = Date.now();
    await env.DB.prepare(
      "UPDATE circles SET status = 'SETTLED', payout_tx_hash = ?, closed_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(transferRes.txHash || null, closedAt, closedAt, cleanId)
      .run();

    return getCircleDetail(env, session, cleanId);
  } catch (err: any) {
    if (err instanceof CircleError) throw err;
    await env.DB.prepare(
      "UPDATE circles SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND status = 'SETTLING'"
    )
      .bind(Date.now(), cleanId)
      .run()
      .catch(() => {});
    throw new CircleError('SETTLE_FAILED', err?.message || 'Circle settlement failed.', 502);
  }
}

/**
 * Creator-only, passkey-gated Circle dissolution (`POST /api/circles/:id/dissolve`).
 * Refunds all contributed Earn Vault shares (plus pro-rata accrued yield) back to
 * each contributing member's UPRAIL account.
 */
export async function dissolveCircle(
  env: Env,
  session: Session,
  circleId: string
): Promise<CircleView> {
  const cleanId = (circleId || '').trim();
  if (!/^circ_[a-f0-9]{16,64}$/.test(cleanId)) {
    throw new CircleError('NOT_FOUND', 'Circle not found.', 404);
  }

  const circleRow = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(cleanId)
    .first<any>();
  if (!circleRow) {
    throw new CircleError('NOT_FOUND', 'Circle not found.', 404);
  }

  if (circleRow.creator_x_id !== session.x_id) {
    throw new CircleError(
      'FORBIDDEN',
      'Only the Circle creator can dissolve this Circle.',
      403
    );
  }

  if (circleRow.status === 'DISSOLVED' || circleRow.status === 'SETTLED') {
    throw new CircleError(
      'ALREADY_CLOSED',
      `Circle is already ${circleRow.status.toLowerCase()}.`,
      409
    );
  }
  if (circleRow.status !== 'ACTIVE' && circleRow.status !== 'GOAL_MET') {
    throw new CircleError(
      'INVALID_CIRCLE_STATE',
      `Circle cannot be dissolved while in status ${circleRow.status}.`,
      400
    );
  }

  const memberRows = await env.DB.prepare(
    'SELECT * FROM circle_members WHERE circle_id = ? ORDER BY created_at ASC'
  )
    .bind(cleanId)
    .all<any>();

  const contributors = (memberRows.results || []).filter(
    (m) => BigInt(String(m.shares_atomic || '0')) > 0n
  );

  const now = Date.now();

  if (contributors.length === 0) {
    await env.DB.prepare(
      "UPDATE circles SET status = 'DISSOLVED', closed_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(now, now, cleanId)
      .run();
    return getCircleDetail(env, session, cleanId);
  }

  const lockRes = await env.DB.prepare(
    "UPDATE circles SET status = 'DISSOLVING', updated_at = ? WHERE id = ? AND status IN ('ACTIVE', 'GOAL_MET')"
  )
    .bind(now, cleanId)
    .run();

  if (!lockRes.meta?.changes) {
    throw new CircleError('DISSOLVE_IN_PROGRESS', 'Circle dissolution is already in progress.', 409);
  }

  try {
    let totalRecordedShares = 0n;
    for (const m of contributors) {
      totalRecordedShares += BigInt(String(m.shares_atomic || '0'));
    }

    const liveBalance = await getCustodyVaultBalance(
      env,
      circleRow.custody_account,
      circleRow.vault_asset_id
    );
    const distributable =
      liveBalance !== null && liveBalance > 0n ? liveBalance : totalRecordedShares;

    const transfers: Array<{ recipientAccount: string; assetId: string; amountAtomic: bigint; memberId: string }> = [];
    let allocated = 0n;

    for (let i = 0; i < contributors.length; i++) {
      const m = contributors[i];
      const memberShares = BigInt(String(m.shares_atomic || '0'));
      const slice =
        i === contributors.length - 1
          ? distributable - allocated
          : (distributable * memberShares) / totalRecordedShares;
      allocated += slice;

      let recipientNearAccount: string;
      if (m.x_id) {
        recipientNearAccount = await nearRpc.resolveUserNearAccount(env, {
          x_id: m.x_id,
          x_handle: m.x_handle,
        });
      } else {
        recipientNearAccount = await nearRpc.resolveUserNearAccount(env, session);
      }

      if (slice > 0n) {
        transfers.push({
          recipientAccount: recipientNearAccount,
          assetId: circleRow.vault_asset_id,
          amountAtomic: slice,
          memberId: m.id,
        });
      }
    }

    const batchRes = await transferBatchFromEarnCustody(env, cleanId, transfers);
    if (!batchRes.success) {
      if (!batchRes.ambiguous) {
        await env.DB.prepare(
          "UPDATE circles SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND status = 'DISSOLVING'"
        )
          .bind(Date.now(), cleanId)
          .run();
      }
      throw new CircleError(
        'DISSOLVE_REFUND_FAILED',
        `Could not refund Circle vault shares to members: ${batchRes.error || 'Transfer failed'}`,
        502
      );
    }

    const closedAt = Date.now();
    for (const t of transfers) {
      await env.DB.prepare(
        'UPDATE circle_members SET refunded_at = ?, refund_tx_hash = ? WHERE id = ?'
      )
        .bind(closedAt, batchRes.txHash || null, t.memberId)
        .run();
    }

    await env.DB.prepare(
      "UPDATE circles SET status = 'DISSOLVED', payout_tx_hash = ?, closed_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(batchRes.txHash || null, closedAt, closedAt, cleanId)
      .run();

    return getCircleDetail(env, session, cleanId);
  } catch (err: any) {
    if (err instanceof CircleError) throw err;
    await env.DB.prepare(
      "UPDATE circles SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND status = 'DISSOLVING'"
    )
      .bind(Date.now(), cleanId)
      .run()
      .catch(() => {});
    throw new CircleError('DISSOLVE_FAILED', err?.message || 'Failed to dissolve Circle.', 502);
  }
}

/**
 * Cron reconciliation for pending external Circle contributions.
 */
export async function reconcilePendingCircleContributions(
  env: Env,
  opts: { limit?: number } = {}
): Promise<{ checked: number; confirmed: number }> {
  const limit = opts.limit ?? 20;
  let checked = 0;
  let confirmed = 0;

  const pending = await env.DB.prepare(
    "SELECT * FROM circle_contributions WHERE status = 'PENDING_FUNDING' ORDER BY created_at ASC LIMIT ?"
  )
    .bind(limit)
    .all<any>();

  for (const row of pending.results || []) {
    checked++;
    const now = Date.now();
    if (row.expires_at < now) {
      await env.DB.prepare(
        "UPDATE circle_contributions SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status = 'PENDING_FUNDING'"
      )
        .bind(now, row.id)
        .run();
      continue;
    }
    if (!row.deposit_address) continue;

    try {
      const execStatus = await getExecutionStatus(
        env,
        row.deposit_address,
        row.deposit_memo || undefined
      );
      const remote = String(execStatus.status || '').toUpperCase();
      if (remote !== 'SUCCESS') continue;

      const circleRow = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
        .bind(row.circle_id)
        .first<any>();
      if (!circleRow) continue;

      const rawOut =
        (execStatus.swapDetails as any)?.amountOut ||
        (execStatus.raw as any)?.quoteResponse?.quote?.amountOut ||
        row.quoted_shares_atomic;
      const totalSettled = BigInt(String(rawOut || row.quoted_shares_atomic));
      const shareSplit = computeStabilizeSplit(
        totalSettled,
        Number(circleRow.vault_decimals || 18),
        env.FEE_PERCENT
      );

      let feeTxHash: string | null = null;
      let feeStatus = 'NONE';
      if (shareSplit.feeAtomic > 0n) {
        const feeRecipient = env.FEE_ACCOUNT_ID || env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
        const feeRes = await transferFromEarnCustody(
          env,
          circleRow.id,
          feeRecipient,
          circleRow.vault_asset_id,
          shareSplit.feeAtomic
        ).catch(() => ({ success: false, txHash: undefined }));
        if (feeRes.success) {
          feeStatus = 'PAID';
          feeTxHash = feeRes.txHash || null;
        }
      }

      const lockRes = await env.DB.prepare(
        `UPDATE circle_contributions
         SET status = 'CONFIRMED',
             shares_atomic = ?,
             fee_shares_atomic = ?,
             fee_status = ?,
             fee_tx_hash = ?,
             intent_hash = COALESCE(intent_hash, ?),
             confirmed_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'PENDING_FUNDING'`
      )
        .bind(
          shareSplit.netInputAtomic.toString(),
          shareSplit.feeAtomic.toString(),
          feeStatus,
          feeTxHash,
          execStatus.intentHash || null,
          now,
          now,
          row.id
        )
        .run();

      if (lockRes.meta?.changes) {
        const mRow = await env.DB.prepare('SELECT * FROM circle_members WHERE id = ? LIMIT 1')
          .bind(row.member_id)
          .first<any>();
        if (mRow) {
          const nextShares =
            BigInt(String(mRow.shares_atomic || '0')) + shareSplit.netInputAtomic;
          const nextUsd = Number(mRow.contributed_usd_cents || 0) + Number(row.usd_cents || 0);
          await env.DB.prepare(
            'UPDATE circle_members SET contributed_usd_cents = ?, shares_atomic = ? WHERE id = ?'
          )
            .bind(nextUsd, nextShares.toString(), mRow.id)
            .run();
        }
        confirmed++;
      }
    } catch {}
  }

  return { checked, confirmed };
}
