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
import { formatAtomic, topUpPublicIntentsFromConfidentialIfShort } from './confidentialRail';
import {
  CIRCLE_GIFT_USDC_ASSET_ID,
  computeVaultPositionValuation,
  deriveEarnCustodyKey,
  EarnVaultError,
  ensureAgentPocketTopUpForMainAccount,
  generateSecureId,
  getCustodyVaultBalance,
  getEarnVaults,
  isUsdcOriginAsset,
  normalizeAndValidateHandle,
  resolveEarnVault,
  sanitizeUserText,
  transferBatchFromEarnCustody,
  transferFromEarnCustody,
  type EarnVaultDescriptor,
} from './earnVaults';
import {
  buildContributeCircleMsg,
  canonicalCircleAgreePayload,
  canonicalCircleDissolvePayload,
  canonicalCircleSettlePayload,
  createCircleOnchain,
  finalizeDissolveOnchain,
  getCircleContractId,
  getCircleOnchain,
  hashHandleHex,
  initiateDissolveOnchain,
  retryCircleSettlementOnchain,
  settleCircleOnchain,
  signCircleTermsOnchain,
  signContractPayloadWithServerUserKey,
  signDissolveOnchain,
  syncContractCircleFromOnchain,
  toIntentsContractAssetSpec,
} from './circleContract';
import { resolveMemberSignerBinding } from './selfCustodyVaultOps';

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
  'SAVINGS_CLUB',
  'CUSTOM',
] as const;

export type CirclePurpose = (typeof VALID_CIRCLE_PURPOSES)[number];

export const CIRCLE_PURPOSE_LABELS: Record<CirclePurpose, string> = {
  CONTRIBUTIONS: 'Group Contributions',
  SHARED_GOAL: 'Shared Goal',
  RENT: 'Rent & Housing',
  TRIP: 'Group Trip',
  DAILY_TIP: 'Daily Goal Tip',
  SAVINGS_CLUB: 'Savings Circle',
  CUSTOM: 'Custom Circle',
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
  customPurpose?: string;
  note?: string;
  targetAmountUsd: number;
  vaultAsset: string;
  payoutHandle?: string;
  mode?: 'contract' | 'escrow';
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
  isRegistered: boolean;
  p256Pubkey?: string | null;
  hasSigned: boolean;
  hasApprovedDissolve: boolean;
  joinedAt: number | null;
  shareBps: number;
  percentageShare: number;
  quotaUsdCents: number;
  contributedUsdCents: number;
  fulfillmentPct: number;
  progressPct: number;
  hasMetQuota: boolean;
  sharesAtomic: string;
  sharesFormatted: string;
  currentValueUsdCents: number;
  yieldUsdCents: number;
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
  isMember: boolean;
  hasSigned: boolean;
  hasApprovedDissolve: boolean;
  dissolveApprovalsCount: number;
  dissolveRequiredCount: number;
  myMemberId: string | null;
  name: string;
  purpose: CirclePurpose;
  purposeLabel: string;
  note: string | null;
  targetUsdCents: number;
  totalContributedUsdCents: number;
  contributedUsdCents: number;
  completionPct: number;
  progressPct: number;
  allQuotasMet: boolean;
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
  contractMode: 'escrow' | 'contract';
  escrowContractId?: string | null;
  onchainCircleId?: string | null;
  dissolveInitiatedAt?: number | null;
  dissolveDeadlineAt?: number | null;
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
  let storedPurpose: string = purpose;
  if (purpose === 'CUSTOM') {
    const customLabel = sanitizeUserText(input.customPurpose, 48);
    if (!customLabel || customLabel.length < 2) {
      throw new CircleError('INVALID_PURPOSE', 'Enter a custom reason (2–48 characters).', 400);
    }
    storedPurpose = `CUSTOM:${customLabel}`;
  }

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

  const custody = await nearRpc.getUserCustodyRecord(env, session.x_id);
  if (custody.custodyMode === 'self') {
    throw new CircleError(
      'SELF_CUSTODY_SIGNATURE_REQUIRED',
      'Use /api/circles/create/prepare to create a Circle with your passkey.',
      409
    );
  }

  const allocations = normalizeMemberAllocations(input.members, targetUsdCents);
  const circleId = generateSecureId('circ');
  const now = Date.now();
  const circleContractId = input.mode === 'escrow' ? null : getCircleContractId(env);

  if (circleContractId) {
    const bindings = await Promise.all(allocations.map((a) => resolveMemberSignerBinding(env, a.handle)));
    const payoutBinding =
      bindings.find((b) => b.handle === payoutHandle) ||
      (await resolveMemberSignerBinding(env, payoutHandle));

    const missingMember = bindings.find((b) => !b.registered || !b.nearAccount || !b.pubkey);
    const payoutMissing = !payoutBinding.registered || !payoutBinding.nearAccount;

    if ((missingMember || payoutMissing) && input.mode === 'contract') {
      const who = missingMember ? `@${missingMember.handle}` : `@${payoutHandle}`;
      throw new CircleError(
        'MEMBER_NOT_REGISTERED',
        `${who} must sign in to Uprail (and activate passkey if self-custody) before joining a contract Circle.`,
        400
      );
    }

    if (!missingMember && !payoutMissing) {
      const seenPubkeys = new Set<string>();
      const seenAccounts = new Set<string>();
      const contractMembers: Array<{ account_id: string; pubkey: string; share_bps: number }> = [];
      let creatorIndex = -1;
      let duplicateErr = false;

      for (let i = 0; i < bindings.length; i++) {
        const b = bindings[i];
        if (seenPubkeys.has(b.pubkey!) || seenAccounts.has(b.nearAccount!)) {
          duplicateErr = true;
          break;
        }
        seenPubkeys.add(b.pubkey!);
        seenAccounts.add(b.nearAccount!);
        if (b.xId === session.x_id) creatorIndex = i;
        contractMembers.push({
          account_id: b.nearAccount!,
          pubkey: b.pubkey!,
          share_bps: allocations[i].shareBps,
        });
      }

      if (!duplicateErr && creatorIndex >= 0) {
        const creatorAccount = contractMembers[creatorIndex].account_id;
        const targetSharesAtomic =
          vault.priceUsd && vault.priceUsd > 0
            ? BigInt(
                nearRpc.toBaseUnits(
                  Math.max(0.000001, targetUsdCents / 100 / vault.priceUsd).toFixed(Math.min(vault.decimals, 8)),
                  vault.decimals
                ) || '1'
              )
            : BigInt(nearRpc.toBaseUnits('1', vault.decimals) || '1');
        const targetAtomicStr = (targetSharesAtomic > 0n ? targetSharesAtomic : 1n).toString();

        const payloadStr = canonicalCircleAgreePayload({
          contractId: circleContractId,
          circleId,
          creatorAccountId: creatorAccount,
          payoutAccountId: payoutBinding.nearAccount!,
          asset: toIntentsContractAssetSpec(vault.assetId),
          targetAmountAtomic: targetAtomicStr,
          members: contractMembers,
        });
        const creatorProof = await signContractPayloadWithServerUserKey(env, session.x_id, payloadStr);
        const createRes = await createCircleOnchain(
          env,
          {
            circle_id: circleId,
            asset: toIntentsContractAssetSpec(vault.assetId),
            members: contractMembers,
            creator_index: creatorIndex,
            payout_account_id: payoutBinding.nearAccount!,
            payout_handle_hash: await hashHandleHex(payoutHandle),
            target_amount: targetAtomicStr,
            creator_proof: creatorProof,
          },
          circleContractId
        );
        if (!createRes.success) {
          throw new CircleError(
            'CONTRACT_CREATE_FAILED',
            createRes.error || 'Failed to create Circle on circle.uprail.near.',
            502
          );
        }

        const onchain = await getCircleOnchain(env, circleId, circleContractId).catch(() => null);
        const initialStatus = onchain?.status || (contractMembers.length === 1 ? 'ACTIVE' : 'PENDING_SIGNATURES');

        await env.DB.prepare(
          `INSERT INTO circles (
            id, creator_x_id, creator_handle, name, purpose, note, target_usd_cents,
            vault_asset_id, vault_symbol, vault_decimals, payout_handle, custody_account,
            contract_mode, escrow_contract_id, onchain_circle_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'contract', ?, ?, ?, ?, ?)`
        )
          .bind(
            circleId,
            session.x_id,
            creatorHandle,
            name,
            storedPurpose,
            note,
            targetUsdCents,
            vault.assetId,
            vault.symbol,
            vault.decimals,
            payoutHandle,
            circleContractId,
            circleContractId,
            circleId,
            initialStatus,
            now,
            now
          )
          .run();

        for (let i = 0; i < bindings.length; i++) {
          const b = bindings[i];
          const memId = generateSecureId('cmem');
          const agreedOnchain = Boolean(onchain?.members?.[i]?.agreed ?? i === creatorIndex);
          await env.DB.prepare(
            `INSERT INTO circle_members (
              id, circle_id, x_handle, x_id, share_bps, quota_usd_cents,
              contributed_usd_cents, shares_atomic, p256_pubkey, terms_signed_at, joined_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, '0', ?, ?, ?, ?)`
          )
            .bind(
              memId,
              circleId,
              b.handle,
              b.xId,
              allocations[i].shareBps,
              allocations[i].quotaUsdCents,
              b.pubkey,
              agreedOnchain ? now : null,
              agreedOnchain ? now : null,
              now
            )
            .run();
        }

        return getCircleDetail(env, session, circleId);
      }
    }
  }

  // Only derive the Intents custody account & activate immediately if all members are already signed (e.g. Solo Circle)
  const allSignedAtCreate = allocations.every((a) => a.handle === creatorHandle);
  const custodyAccount = allSignedAtCreate
    ? (await deriveEarnCustodyKey(env, circleId)).accountId
    : '';
  const initialStatus = allSignedAtCreate ? 'ACTIVE' : 'PENDING_SIGNATURES';

  await env.DB.prepare(
    `INSERT INTO circles (
      id, creator_x_id, creator_handle, name, purpose, note,
      target_usd_cents, vault_asset_id, vault_symbol, vault_decimals,
      payout_handle, custody_account, contract_mode, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'escrow', ?, ?, ?)`
  )
    .bind(
      circleId,
      session.x_id,
      creatorHandle,
      name,
      storedPurpose,
      note,
      targetUsdCents,
      vault.assetId,
      vault.symbol,
      vault.decimals,
      payoutHandle,
      custodyAccount,
      initialStatus,
      now,
      now
    )
    .run();

  for (const alloc of allocations) {
    const memberId = generateSecureId('cmem');
    let memberXId: string | null = null;
    const isCreatorMember = alloc.handle === creatorHandle;
    if (isCreatorMember) {
      memberXId = session.x_id;
    } else {
      const existing = await env.DB.prepare(
        'SELECT x_id FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
      )
        .bind(alloc.handle)
        .first<{ x_id: string }>();
      if (existing) memberXId = existing.x_id;
    }

    // Only the creator has signed at creation time; invited participants sign with their passkey
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
        isCreatorMember ? now : null,
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

  const [memberRowsRes, contribRows] = await Promise.all([
    env.DB.prepare('SELECT * FROM circle_members WHERE circle_id = ? ORDER BY share_bps DESC, created_at ASC')
      .bind(circleRow.id)
      .all<any>(),
    env.DB.prepare('SELECT * FROM circle_contributions WHERE circle_id = ? ORDER BY created_at DESC LIMIT 30')
      .bind(circleRow.id)
      .all<any>(),
  ]);

  const memberRowsList = memberRowsRes.results || [];
  if (
    circleRow.contract_mode === 'contract' &&
    circleRow.onchain_circle_id &&
    (circleRow.status === 'PENDING_SIGNATURES' || circleRow.status === 'DISSOLVING')
  ) {
    await syncContractCircleFromOnchain({
      env,
      circleRow,
      memberRows: memberRowsList,
    }).catch(() => {});
  }

  const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
  const vaultDecimals = Number(circleRow.vault_decimals || vault?.decimals || 18);

  let totalSharesAtomic = 0n;
  let totalContributedUsdCents = 0;

  const members: CircleMemberView[] = memberRowsList.map((m) => {
    const shares = BigInt(String(m.shares_atomic || '0'));
    totalSharesAtomic += shares;
    const contributed = Number(m.contributed_usd_cents || 0);
    totalContributedUsdCents += contributed;
    const quota = Math.max(1, Number(m.quota_usd_cents || 1));
    const rawPct = Number(((contributed / quota) * 100).toFixed(1));
    const fulfillmentPct = Math.min(100, rawPct);
    const hasMetQuota = contributed >= quota;
    const isCurrentUser =
      (m.x_id && m.x_id === session.x_id) ||
      Boolean(callerHandle && String(m.x_handle || '').toLowerCase() === callerHandle);

    const memberVal = computeVaultPositionValuation({
      sharesAtomic: shares,
      vaultDecimals,
      sharePriceUsd: vault?.priceUsd || 0,
      principalUsdCents: contributed,
    });

    const rawRefundMarker = String(m.refund_tx_hash || '');
    const hasApprovedDissolve =
      Boolean(m.dissolve_signed_at) || Boolean(m.refunded_at) || rawRefundMarker.startsWith('DISSOLVE_APPROVED');

    return {
      id: m.id,
      handle: m.x_handle,
      xId: m.x_id || null,
      isRegistered: Boolean(m.x_id),
      p256Pubkey: m.p256_pubkey || null,
      hasSigned:
        circleRow.contract_mode === 'contract'
          ? Boolean(m.terms_signed_at || m.joined_at)
          : Boolean(m.joined_at),
      hasApprovedDissolve,
      joinedAt: m.joined_at ? Number(m.joined_at) : null,
      shareBps: Number(m.share_bps),
      percentageShare: Number((Number(m.share_bps) / 100).toFixed(2)),
      quotaUsdCents: quota,
      contributedUsdCents: contributed,
      fulfillmentPct,
      progressPct: rawPct,
      hasMetQuota,
      sharesAtomic: shares.toString(),
      sharesFormatted: formatAtomic(shares.toString(), vaultDecimals),
      currentValueUsdCents: memberVal.currentValueUsdCents,
      yieldUsdCents: memberVal.yieldUsdCents,
      isCurrentUser,
      refundedAt: m.refunded_at ? Number(m.refunded_at) : null,
      refundTxHash: rawRefundMarker.startsWith('DISSOLVE_APPROVED')
        ? null
        : m.refund_tx_hash || null,
    };
  });

  const valuation = computeVaultPositionValuation({
    sharesAtomic: totalSharesAtomic,
    vaultDecimals,
    sharePriceUsd: vault?.priceUsd || 0,
    principalUsdCents: totalContributedUsdCents,
  });

  const targetUsdCents = Math.max(1, Number(circleRow.target_usd_cents || 1));
  const rawCompletionPct = Number(((totalContributedUsdCents / targetUsdCents) * 100).toFixed(1));
  const completionPct = Math.min(100, rawCompletionPct);
  const allQuotasMet = members.length > 0 && members.every((m) => m.hasMetQuota);
  const myMember = members.find((m) => m.isCurrentUser) || null;
  const contributingMembers = members.filter((m) => BigInt(m.sharesAtomic || '0') > 0n);
  const dissolveRequiredCount = contributingMembers.length;
  const dissolveApprovalsCount = contributingMembers.filter((m) => m.hasApprovedDissolve).length;

  const rawPurposeStr = String(circleRow.purpose || 'SHARED_GOAL');
  let purpose: CirclePurpose = 'SHARED_GOAL';
  let purposeLabel: string = CIRCLE_PURPOSE_LABELS.SHARED_GOAL;
  if (rawPurposeStr.startsWith('CUSTOM:')) {
    purpose = 'CUSTOM';
    purposeLabel = rawPurposeStr.slice(7).trim() || CIRCLE_PURPOSE_LABELS.CUSTOM;
  } else if ((VALID_CIRCLE_PURPOSES as readonly string[]).includes(rawPurposeStr)) {
    purpose = rawPurposeStr as CirclePurpose;
    purposeLabel = CIRCLE_PURPOSE_LABELS[purpose];
  } else if (rawPurposeStr.trim()) {
    purpose = 'CUSTOM';
    purposeLabel = rawPurposeStr.trim();
  }

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

  const isCreator = circleRow.creator_x_id === session.x_id;

  return {
    id: circleRow.id,
    creatorXId: circleRow.creator_x_id,
    creatorHandle: circleRow.creator_handle,
    isCreator,
    isMember: Boolean(myMember),
    hasSigned: myMember ? myMember.hasSigned : isCreator,
    hasApprovedDissolve: myMember ? myMember.hasApprovedDissolve : false,
    dissolveApprovalsCount,
    dissolveRequiredCount,
    myMemberId: myMember ? myMember.id : null,
    name: circleRow.name,
    purpose,
    purposeLabel,
    note: circleRow.note || null,
    targetUsdCents,
    totalContributedUsdCents,
    contributedUsdCents: totalContributedUsdCents,
    completionPct,
    progressPct: rawCompletionPct,
    allQuotasMet,
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
    contractMode: circleRow.contract_mode === 'contract' ? 'contract' : 'escrow',
    escrowContractId: circleRow.escrow_contract_id || null,
    onchainCircleId: circleRow.onchain_circle_id || null,
    dissolveInitiatedAt: circleRow.dissolve_initiated_at ? Number(circleRow.dissolve_initiated_at) : null,
    dissolveDeadlineAt: circleRow.dissolve_deadline_at ? Number(circleRow.dissolve_deadline_at) : null,
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
      'UPDATE circle_members SET x_id = ? WHERE id = ? AND x_id IS NULL'
    )
      .bind(session.x_id, memberMatch.id)
      .run()
      .catch(() => {});
  }

  return buildCircleView(env, session, circleRow);
}

/**
 * Passkey-gated participant signature to join a Circle (`POST /api/circles/:id/join`).
 * Records the participant's passkey-signed commitment (`joined_at`) so all participants
 * explicitly sign into the Circle and can add funds repeatedly at any point.
 */
export async function joinCircle(
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

  const custody = await nearRpc.getUserCustodyRecord(env, session.x_id);
  if (custody.custodyMode === 'self') {
    throw new CircleError(
      'SELF_CUSTODY_SIGNATURE_REQUIRED',
      'Sign Circle terms with your passkey via /api/circles/:id/join/prepare.',
      409
    );
  }

  if (
    circleRow.status !== 'PENDING_SIGNATURES' &&
    circleRow.status !== 'ACTIVE' &&
    circleRow.status !== 'GOAL_MET'
  ) {
    throw new CircleError(
      'CIRCLE_CLOSED',
      `Cannot sign into a Circle in status ${circleRow.status}.`,
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
      'Only invited participants of this Circle can sign & join.',
      403
    );
  }

  const now = Date.now();
  if (circleRow.contract_mode === 'contract' && circleRow.onchain_circle_id) {
    const contractId = String(circleRow.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
    const onchain = await getCircleOnchain(env, circleRow.onchain_circle_id, contractId);
    if (!onchain) {
      throw new CircleError('RPC_UNAVAILABLE', 'On-chain Circle state not found right now.', 503);
    }
    const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
    const memberIndex = onchain.members.findIndex(
      (m) => m.account_id.toLowerCase() === nearAccount.toLowerCase()
    );
    if (memberIndex < 0) {
      throw new CircleError('FORBIDDEN', 'Your account does not match a bound signer slot in this Circle.', 403);
    }

    if (!onchain.members[memberIndex].agreed) {
      const payloadStr = canonicalCircleAgreePayload({
        contractId,
        circleId: circleRow.onchain_circle_id,
        creatorAccountId: onchain.creator_account_id,
        payoutAccountId: onchain.payout_account_id,
        asset: onchain.asset,
        targetAmountAtomic: onchain.target_amount,
        members: onchain.members.map((m) => ({
          account_id: m.account_id,
          pubkey: m.pubkey,
          share_bps: m.share_bps,
        })),
      });
      const proof = await signContractPayloadWithServerUserKey(env, session.x_id, payloadStr);
      const signRes = await signCircleTermsOnchain(
        env,
        {
          circle_id: circleRow.onchain_circle_id,
          member_index: memberIndex,
          proof,
        },
        contractId
      );
      if (!signRes.success) {
        throw new CircleError('CONTRACT_SIGN_FAILED', signRes.error || 'Failed to record terms signature on-chain.', 502);
      }
    }

    await env.DB.prepare(
      `UPDATE circle_members
       SET x_id = ?,
           p256_pubkey = COALESCE(p256_pubkey, ?),
           terms_signed_at = COALESCE(terms_signed_at, ?),
           joined_at = COALESCE(joined_at, ?)
       WHERE id = ?`
    )
      .bind(session.x_id, onchain.members[memberIndex].pubkey, now, now, memberRow.id)
      .run();

    await syncContractCircleFromOnchain({
      env,
      circleRow,
      maxRetries: 3,
    }).catch(() => {});

    return getCircleDetail(env, session, cleanId);
  }

  await env.DB.prepare(
    'UPDATE circle_members SET x_id = ?, joined_at = COALESCE(joined_at, ?) WHERE id = ?'
  )
    .bind(session.x_id, now, memberRow.id)
    .run();

  const unsignedRow = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM circle_members WHERE circle_id = ? AND joined_at IS NULL'
  )
    .bind(cleanId)
    .first<{ cnt: number }>();
  const allSigned = Number(unsignedRow?.cnt || 0) === 0;

  if (allSigned && (circleRow.status === 'PENDING_SIGNATURES' || !circleRow.custody_account)) {
    const custodyKey = await deriveEarnCustodyKey(env, cleanId);
    await env.DB.prepare(
      "UPDATE circles SET custody_account = ?, status = 'ACTIVE', updated_at = ? WHERE id = ? AND (status = 'PENDING_SIGNATURES' OR custody_account = '')"
    )
      .bind(custodyKey.accountId, now, cleanId)
      .run();
  } else {
    await env.DB.prepare('UPDATE circles SET updated_at = ? WHERE id = ?')
      .bind(now, cleanId)
      .run();
  }

  return getCircleDetail(env, session, cleanId);
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
      'UPDATE circle_members SET x_id = ? WHERE LOWER(x_handle) = ? AND x_id IS NULL'
    )
      .bind(session.x_id, callerHandle)
      .run()
      .catch(() => {});
  }

  const circleRows = await env.DB.prepare(
    `SELECT DISTINCT c.*
     FROM circles c
     LEFT JOIN circle_members m ON m.circle_id = c.id
     WHERE c.creator_x_id = ? OR m.x_id = ? OR LOWER(m.x_handle) = ?
     ORDER BY c.created_at DESC
     LIMIT 250`
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
): Promise<{
  circle: CircleView;
  contribution: CircleContributionView;
  contributionId: string;
  status: string;
  depositAddress: string | null;
  depositMemo: string | null;
  sharesAddedFormatted: string;
}> {
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

  const custody = await nearRpc.getUserCustodyRecord(env, session.x_id);
  if (custody.custodyMode === 'self') {
    throw new CircleError(
      'SELF_CUSTODY_SIGNATURE_REQUIRED',
      'Sign Circle contribution with your passkey via /api/circles/:id/contribute/prepare.',
      409
    );
  }

  if (circleRow.status === 'PENDING_SIGNATURES' || !circleRow.custody_account) {
    throw new CircleError(
      'CIRCLE_PENDING_SIGNATURES',
      'All invited participants must sign with their passkey before the Circle Intents account is created and funding can start.',
      400
    );
  }

  if (circleRow.status !== 'ACTIVE' && circleRow.status !== 'GOAL_MET') {
    throw new CircleError(
      'CIRCLE_CLOSED',
      `Cannot contribute to a Circle in status ${circleRow.status}.`,
      400
    );
  }

  const isContract = circleRow.contract_mode === 'contract' && Boolean(circleRow.onchain_circle_id);
  if (!isContract) {
    const unsignedRow = await env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM circle_members WHERE circle_id = ? AND joined_at IS NULL'
    )
      .bind(cleanId)
      .first<{ cnt: number }>();
    if (Number(unsignedRow?.cnt || 0) > 0) {
      throw new CircleError(
        'CIRCLE_PENDING_SIGNATURES',
        'All invited participants must sign with their passkey before funding can start.',
        400
      );
    }
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
  const origin = await resolveOriginToken(env, input.sourceAsset || CIRCLE_GIFT_USDC_ASSET_ID, oneClickTokens).catch((err) => {
    throw new CircleError('UNSUPPORTED_SOURCE_ASSET', err?.message || 'Unsupported token.', 400);
  });
  if (!isUsdcOriginAsset(origin)) {
    throw new CircleError('USDC_ONLY', 'Circles only accept USDC deposits.', 400);
  }

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

  const grossAmountFormatted = formatAtomic(grossAtomic.toString(), origin.decimals);
  const contribId = generateSecureId('ccon');
  const now = Date.now();
  const expiresAt = now + PENDING_CONTRIB_TTL_MS;
  const deadline = new Date(expiresAt).toISOString();
  const senderNearAccount = await nearRpc.resolveUserNearAccount(env, session);
  const fundingMode = input.fundingMode === 'EXTERNAL_DEPOSIT' ? 'EXTERNAL_DEPOSIT' : 'BALANCE';

  if (isContract) {
    if (fundingMode === 'EXTERNAL_DEPOSIT') {
      throw new CircleError(
        'USE_BALANCE_FOR_CONTRACT_CIRCLE',
        'Non-custodial contract Circles require contributing from your Uprail balance so deposits bind directly on-chain.',
        400
      );
    }
    const contractId = String(circleRow.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
    const onchain = await getCircleOnchain(env, circleRow.onchain_circle_id, contractId);
    if (!onchain) {
      throw new CircleError('RPC_UNAVAILABLE', 'Could not verify on-chain Circle state.', 503);
    }
    if (onchain.status !== 'ACTIVE') {
      throw new CircleError(
        onchain.status === 'PENDING_SIGNATURES' ? 'CIRCLE_PENDING_SIGNATURES' : 'CIRCLE_CLOSED',
        onchain.status === 'PENDING_SIGNATURES'
          ? 'All members must sign terms before contributing.'
          : `Circle is ${onchain.status} and no longer accepting contributions.`,
        409
      );
    }
    const slot = onchain.members.find((m) => m.account_id.toLowerCase() === senderNearAccount.toLowerCase());
    if (!slot || !slot.agreed) {
      throw new CircleError('CIRCLE_PENDING_SIGNATURES', 'You must agree to Circle terms first.', 403);
    }

    try {
      await nearRpc.depositPlainBalanceToIntents(env, session.x_id, origin.assetId, grossAmountFormatted, senderNearAccount);
    } catch {}

    let avail = await nearRpc.getUserAvailableBalance(env, session, origin.assetId);
    if (avail + 1e-6 < Number(grossAmountFormatted)) {
      await ensureAgentPocketTopUpForMainAccount(env, senderNearAccount, origin.assetId, grossAtomic);
      avail = await nearRpc.getUserAvailableBalance(env, session, origin.assetId);
    }
    if (avail + 1e-6 < Number(grossAmountFormatted)) {
      throw new CircleError(
        'INSUFFICIENT_BALANCE',
        `Insufficient ${origin.symbol} balance (${avail.toFixed(4)} available, ${grossAmountFormatted} required).`,
        400
      );
    }

    const curPubAmt =
      (await nearRpc.getIntentAssetBalance(env, origin.assetId, senderNearAccount).catch(() => null))
        ?.balance ?? 0n;
    if (curPubAmt < grossAtomic) {
      await topUpPublicIntentsFromConfidentialIfShort({
        env,
        xId: session.x_id,
        originAssetId: origin.assetId,
        originDecimals: origin.decimals,
        originSymbol: origin.symbol,
        requiredAtomic: grossAtomic,
        nearAccount: senderNearAccount,
        currentPublicAtomic: curPubAmt,
      });
    }

    let depositSharesAtomic = grossAtomic;
    let usdCents = Math.max(100, Math.round((estUsd > 0 ? estUsd : 1) * 100));
    let swapIntentHash: string | null = null;
    const sameAsset = origin.assetId.toLowerCase() === vault.assetId.toLowerCase();

    if (!sameAsset) {
      const beforeSwapBal =
        (await nearRpc.getIntentAssetBalance(env, vault.assetId, senderNearAccount).catch(() => null))?.balance ?? 0n;
      let swapQuote;
      try {
        swapQuote = await requestQuote(env, {
          dry: false,
          swapType: 'EXACT_INPUT',
          originAsset: origin.assetId,
          destinationAsset: vault.assetId,
          amount: grossAtomic.toString(),
          recipient: senderNearAccount,
          recipientType: 'INTENTS',
          refundTo: senderNearAccount,
          refundType: 'INTENTS',
          depositType: 'INTENTS',
          slippageTolerance: 300,
          deadline,
        });
      } catch (err: any) {
        throw new CircleError('QUOTE_FAILED', `1Click could not quote ${origin.symbol} → ${vault.symbol}: ${err?.message || String(err)}`, 502);
      }
      const rawQ = ((swapQuote.raw as any)?.quote || {}) as Record<string, unknown>;
      const inUsd = Number(rawQ.amountInUsd || estUsd);
      usdCents = Math.max(100, Math.round((Number.isFinite(inUsd) && inUsd > 0 ? inUsd : estUsd) * 100));

      const swapRes = await nearRpc.executeCrossChainSwapTransfer(env, session.x_id, swapQuote.quote.depositAddress);
      if (!swapRes.success) {
        throw new CircleError('CONTRIBUTION_FAILED', swapRes.error || 'Swap transfer rejected.', 502);
      }
      swapIntentHash = swapRes.txHash || null;

      let settledShares = 0n;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const curBal =
          (await nearRpc.getIntentAssetBalance(env, vault.assetId, senderNearAccount).catch(() => null))?.balance ?? 0n;
        if (curBal > beforeSwapBal) {
          settledShares = curBal - beforeSwapBal;
          break;
        }
        const st = await getExecutionStatus(env, swapQuote.quote.depositAddress, swapQuote.quote.depositMemo || undefined)
          .then((s) => String(s?.status || '').toUpperCase())
          .catch(() => '');
        if (st === 'REFUNDED' || st === 'FAILED') {
          throw new CircleError('CONTRIBUTION_FAILED', '1Click swap was refunded back to your Intents balance.', 502);
        }
      }
      if (settledShares <= 0n) {
        throw new CircleError(
          'SWAP_SETTLING_ONCHAIN',
          `Your ${origin.symbol} -> ${vault.symbol} swap is still settling into your balance (~10s). Retry with ${vault.symbol} once it lands.`,
          409
        );
      }
      depositSharesAtomic = settledShares;
    }

    const beforeSlotContributed = BigInt(slot.contributed || '0');
    const depRes = await nearRpc.executeIntentsActionListForServerUser(
      env,
      session.x_id,
      [
        {
          intent: 'transfer',
          receiver_id: contractId,
          tokens: { [vault.assetId]: depositSharesAtomic.toString() },
          msg: buildContributeCircleMsg(circleRow.onchain_circle_id),
        },
      ],
      160_000_000_000_000n
    );
    if (!depRes.success) {
      throw new CircleError('CONTRIBUTION_FAILED', depRes.error || 'Contract contribution transfer failed.', 502);
    }

    let afterSlotContributed = beforeSlotContributed;
    for (let retry = 0; retry < 4; retry++) {
      const afterOnchain = await getCircleOnchain(env, circleRow.onchain_circle_id, contractId).catch(() => null);
      const afterSlot = afterOnchain?.members.find((m) => m.account_id.toLowerCase() === senderNearAccount.toLowerCase());
      afterSlotContributed = BigInt(afterSlot?.contributed || '0');
      if (afterSlotContributed > beforeSlotContributed) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    if (afterSlotContributed <= beforeSlotContributed) {
      throw new CircleError(
        'CONTRIBUTION_NOT_CREDITED',
        'On-chain Circle contribution did not increase your contributed balance.',
        502
      );
    }
    const actualDelta = afterSlotContributed - beforeSlotContributed;
    const prevMemberShares = BigInt(String(memberRow.shares_atomic || '0'));
    const nextMemberShares = prevMemberShares + actualDelta;
    const nextMemberUsdCents = Number(memberRow.contributed_usd_cents || 0) + usdCents;
    const confTime = Date.now();

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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, '0', 'NONE', NULL, 'CONFIRMED', ?, ?, ?, ?, ?)`
    )
      .bind(
        contribId,
        cleanId,
        memberRow.id,
        session.x_id,
        origin.assetId,
        origin.symbol,
        origin.decimals,
        grossAtomic.toString(),
        usdCents,
        depositSharesAtomic.toString(),
        beforeSlotContributed.toString(),
        actualDelta.toString(),
        depRes.txHash || swapIntentHash || null,
        expiresAt,
        confTime,
        confTime,
        confTime
      )
      .run();

    await env.DB.prepare(
      `UPDATE circle_members
       SET x_id = COALESCE(x_id, ?),
           joined_at = COALESCE(joined_at, ?),
           contributed_usd_cents = ?,
           shares_atomic = ?,
           refund_tx_hash = NULL
       WHERE id = ?`
    )
      .bind(session.x_id, confTime, nextMemberUsdCents, nextMemberShares.toString(), memberRow.id)
      .run();

    await env.DB.prepare('UPDATE circles SET updated_at = ? WHERE id = ?').bind(confTime, cleanId).run();
    const updatedCircle = await getCircleDetail(env, session, cleanId);
    const contribView = updatedCircle.recentContributions.find((c) => c.id === contribId) || {
      id: contribId,
      memberId: memberRow.id,
      contributorXId: session.x_id,
      sourceSymbol: origin.symbol,
      grossAmount: grossAmountFormatted,
      usdCents,
      sharesAtomic: actualDelta.toString(),
      sharesFormatted: formatAtomic(actualDelta.toString(), vault.decimals),
      status: 'CONFIRMED',
      depositAddress: null,
      depositMemo: null,
      intentHash: depRes.txHash || null,
      createdAt: confTime,
      confirmedAt: confTime,
    };

    return {
      circle: updatedCircle,
      contribution: contribView,
      contributionId: contribView.id,
      status: contribView.status,
      depositAddress: null,
      depositMemo: null,
      sharesAddedFormatted: contribView.sharesFormatted,
    };
  }

  if (fundingMode === 'BALANCE') {
    try {
      await nearRpc.depositPlainBalanceToIntents(
        env,
        session.x_id,
        origin.assetId,
        grossAmountFormatted,
        senderNearAccount
      );
    } catch {}

    let avail = await nearRpc.getUserAvailableBalance(env, session, origin.assetId);
    const reqNum = Number(grossAmountFormatted);
    if (avail + 1e-6 < reqNum) {
      await ensureAgentPocketTopUpForMainAccount(env, senderNearAccount, origin.assetId, grossAtomic);
      avail = await nearRpc.getUserAvailableBalance(env, session, origin.assetId);
    }
    if (avail + 1e-6 < reqNum) {
      throw new CircleError(
        'INSUFFICIENT_BALANCE',
        `Insufficient ${origin.symbol} balance (${avail.toFixed(4)} available, ${grossAmountFormatted} required).`,
        400
      );
    }

    const curPubAmt =
      (await nearRpc.getIntentAssetBalance(env, origin.assetId, senderNearAccount).catch(() => null))
        ?.balance ?? 0n;
    if (curPubAmt < grossAtomic) {
      await topUpPublicIntentsFromConfidentialIfShort({
        env,
        xId: session.x_id,
        originAssetId: origin.assetId,
        originDecimals: origin.decimals,
        originSymbol: origin.symbol,
        requiredAtomic: grossAtomic,
        nearAccount: senderNearAccount,
        currentPublicAtomic: curPubAmt,
      });
    }

    // 100% of member contribution enters the Earn Vault; the 1% fee is charged on Circle payout
    let liveQuote;
    try {
      liveQuote = await requestQuote(env, {
        dry: false,
        swapType: 'EXACT_INPUT',
        originAsset: origin.assetId,
        destinationAsset: vault.assetId,
        amount: grossAtomic.toString(),
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
    const inUsd = Number(rawQ.amountInUsd || estUsd);
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', ?, '0', 'NONE', NULL, 'CONFIRMED', ?, ?, ?, ?, ?)`
    )
      .bind(
        contribId,
        cleanId,
        memberRow.id,
        session.x_id,
        origin.assetId,
        origin.symbol,
        origin.decimals,
        grossAtomic.toString(),
        usdCents,
        liveQuote.quote.depositAddress,
        liveQuote.quote.depositMemo || null,
        quotedSharesAtomic.toString(),
        quotedSharesAtomic.toString(),
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
           shares_atomic = ?,
           refund_tx_hash = NULL
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

    // Clear any prior dissolve approvals on the Circle since new funds were added
    await env.DB.prepare(
      "UPDATE circle_members SET refund_tx_hash = NULL WHERE circle_id = ? AND refund_tx_hash LIKE 'DISSOLVE_APPROVED%'"
    )
      .bind(cleanId)
      .run()
      .catch(() => {});

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
      grossAmount: grossAmountFormatted,
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

    return {
      circle: updatedCircle,
      contribution: contribView,
      contributionId: contribView.id,
      status: contribView.status,
      depositAddress: contribView.depositAddress || null,
      depositMemo: contribView.depositMemo || null,
      sharesAddedFormatted: contribView.sharesFormatted,
    };
  }

  // EXTERNAL_DEPOSIT mode — 100% enters the Earn Vault; 1% fee is charged on Circle payout
  let extQuote;
  try {
    extQuote = await requestQuote(env, {
      dry: false,
      swapType: 'FLEX_INPUT',
      originAsset: origin.assetId,
      destinationAsset: vault.assetId,
      amount: grossAtomic.toString(),
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
  const rawQ = ((extQuote.raw as any)?.quote || {}) as Record<string, unknown>;
  const inUsd = Number(rawQ.amountInUsd || estUsd);
  const usdCents = Math.max(
    100,
    Math.round((Number.isFinite(inUsd) && inUsd > 0 ? inUsd : estUsd) * 100)
  );

  await env.DB.prepare(
    'UPDATE circle_members SET x_id = COALESCE(x_id, ?), joined_at = COALESCE(joined_at, ?) WHERE id = ?'
  )
    .bind(session.x_id, now, memberRow.id)
    .run();

  await env.DB.prepare(
    `INSERT INTO circle_contributions (
      id, circle_id, member_id, contributor_x_id,
      source_asset, source_symbol, source_decimals,
      gross_atomic, usd_cents,
      deposit_address, deposit_memo,
      quoted_shares_atomic, balance_before_atomic, shares_atomic,
      fee_shares_atomic, fee_status,
      status, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', NULL, '0', 'NONE', 'PENDING_FUNDING', ?, ?, ?)`
  )
    .bind(
      contribId,
      cleanId,
      memberRow.id,
      session.x_id,
      origin.assetId,
      origin.symbol,
      origin.decimals,
      grossAtomic.toString(),
      usdCents,
      extQuote.quote.depositAddress,
      extQuote.quote.depositMemo || null,
      grossShares.toString(),
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
    grossAmount: grossAmountFormatted,
    usdCents,
    sharesAtomic: grossShares.toString(),
    sharesFormatted: formatAtomic(grossShares.toString(), vault.decimals),
    status: 'PENDING_FUNDING',
    depositAddress: extQuote.quote.depositAddress,
    depositMemo: extQuote.quote.depositMemo || null,
    intentHash: null,
    createdAt: now,
    confirmedAt: null,
  };

  return {
    circle: updatedCircle,
    contribution: contribView,
    contributionId: contribView.id,
    status: contribView.status,
    depositAddress: contribView.depositAddress || null,
    depositMemo: contribView.depositMemo || null,
    sharesAddedFormatted: contribView.sharesFormatted,
  };
}

/**
 * Creator-only, passkey-gated Circle payout (`POST /api/circles/:id/settle`).
 * Carves out the 1% protocol fee on payout and disburses 99% of the Circle's
 * Earn Vault shares (principal + compounded yield) to `payout_handle`.
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

  const custody = await nearRpc.getUserCustodyRecord(env, session.x_id);
  if (custody.custodyMode === 'self') {
    throw new CircleError(
      'SELF_CUSTODY_SIGNATURE_REQUIRED',
      'Sign Circle settlement with your passkey via /api/circles/:id/settle/prepare.',
      409
    );
  }

  if (circleRow.status === 'SETTLED') {
    throw new CircleError('ALREADY_SETTLED', 'This Circle has already been settled.', 409);
  }

  if (circleRow.contract_mode === 'contract' && circleRow.onchain_circle_id) {
    const contractId = String(circleRow.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
    const onchain = await getCircleOnchain(env, circleRow.onchain_circle_id, contractId);
    if (!onchain) {
      throw new CircleError('RPC_UNAVAILABLE', 'On-chain Circle state not found right now.', 503);
    }
    if (onchain.status === 'SETTLING') {
      const retryRes = await retryCircleSettlementOnchain(env, circleRow.onchain_circle_id, contractId);
      if (!retryRes.success) {
        throw new CircleError('SETTLE_TRANSFER_FAILED', retryRes.error || 'Settlement retry failed.', 502);
      }
      const post = await getCircleOnchain(env, circleRow.onchain_circle_id, contractId).catch(() => null);
      const nowTs = Date.now();
      const nextStatus = post?.status || 'SETTLING';
      await env.DB.prepare(
        `UPDATE circles SET status = ?, payout_tx_hash = COALESCE(payout_tx_hash, ?), closed_at = CASE WHEN ? = 'SETTLED' THEN COALESCE(closed_at, ?) ELSE closed_at END, updated_at = ? WHERE id = ?`
      )
        .bind(nextStatus, retryRes.txHash || null, nextStatus, nowTs, nowTs, cleanId)
        .run();
      return getCircleDetail(env, session, cleanId);
    }
    if (onchain.status !== 'ACTIVE') {
      throw new CircleError(
        'INVALID_CIRCLE_STATE',
        `Circle cannot be settled while in status ${onchain.status}.`,
        409
      );
    }
    if (BigInt(onchain.total_contributed || '0') <= 0n) {
      throw new CircleError('EMPTY_CIRCLE_VAULT', 'This Circle holds 0 settled vault shares on-chain to disburse.', 400);
    }

    const nowTs = Date.now();
    const lockRes = await env.DB.prepare(
      "UPDATE circles SET status = 'SETTLING', updated_at = ? WHERE id = ? AND status IN ('ACTIVE', 'GOAL_MET')"
    )
      .bind(nowTs, cleanId)
      .run();
    if (!lockRes.meta?.changes) {
      throw new CircleError('SETTLE_IN_PROGRESS', 'Circle settlement is already in progress.', 409);
    }

    try {
      const payloadStr = canonicalCircleSettlePayload({
        contractId,
        circleId: circleRow.onchain_circle_id,
        payoutAccountId: onchain.payout_account_id,
        totalContributedAtomic: onchain.total_contributed,
      });
      const proof = await signContractPayloadWithServerUserKey(env, session.x_id, payloadStr);
      const settleRes = await settleCircleOnchain(
        env,
        { circle_id: circleRow.onchain_circle_id, creator_proof: proof },
        contractId
      );
      if (!settleRes.success) {
        await env.DB.prepare(
          "UPDATE circles SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND status = 'SETTLING'"
        )
          .bind(Date.now(), cleanId)
          .run();
        throw new CircleError('SETTLE_TRANSFER_FAILED', settleRes.error || 'On-chain settlement failed.', 502);
      }

      const post = await getCircleOnchain(env, circleRow.onchain_circle_id, contractId).catch(() => null);
      const closedAt = Date.now();
      const nextStatus = post?.status || 'SETTLED';
      await env.DB.prepare(
        "UPDATE circles SET status = ?, payout_tx_hash = ?, closed_at = CASE WHEN ? = 'SETTLED' THEN ? ELSE NULL END, updated_at = ? WHERE id = ?"
      )
        .bind(nextStatus, settleRes.txHash || null, nextStatus, closedAt, closedAt, cleanId)
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
      throw new CircleError('SETTLE_FAILED', err?.message || 'Failed to settle Circle.', 502);
    }
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

  // Verify no recent contribution is still settling via 1Click solver
  const recentContribs = await env.DB.prepare(
    'SELECT id, deposit_address, deposit_memo, created_at FROM circle_contributions WHERE circle_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 5'
  )
    .bind(cleanId, Date.now() - 10 * 60_000)
    .all<{ id: string; deposit_address: string | null; deposit_memo: string | null; created_at: number }>();

  const liveBalance = await getCustodyVaultBalance(
    env,
    circleRow.custody_account,
    circleRow.vault_asset_id
  );
  if (liveBalance === null) {
    throw new CircleError(
      'RPC_UNAVAILABLE',
      'Could not verify on-chain Circle vault balance right now. Please try again in a moment.',
      503
    );
  }

  // If on-chain custody balance is significantly below recorded shares, check if a recent swap is still in flight
  if (liveBalance === 0n || (recordedShares > 0n && liveBalance < (recordedShares * 95n) / 100n)) {
    for (const c of recentContribs.results || []) {
      if (!c.deposit_address) continue;
      try {
        const execStatus = await getExecutionStatus(
          env,
          c.deposit_address,
          c.deposit_memo || undefined
        );
        const st = String(execStatus.status || '').toUpperCase();
        if (st === 'PENDING_DEPOSIT' || st === 'PROCESSING' || st === 'KNOWN_DEPOSIT_TX') {
          throw new CircleError(
            'SWAP_SETTLING_ONCHAIN',
            'A recent contribution is still settling into the vault on NEAR Intents (usually 5–15 seconds). Please wait a moment and try again.',
            409
          );
        }
      } catch (e) {
        if (e instanceof CircleError) throw e;
      }
    }
  }

  const sharesToDisburse = liveBalance;

  if (sharesToDisburse <= 0n) {
    throw new CircleError('EMPTY_CIRCLE_VAULT', 'This Circle holds 0 settled vault shares on-chain to disburse.', 400);
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
    const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
    const payoutHandle = String(circleRow.payout_handle || circleRow.creator_handle).toLowerCase();
    let payoutNearAccount: string;

    if (payoutHandle === callerHandle) {
      payoutNearAccount = await nearRpc.resolveUserNearAccount(env, session);
    } else {
      const payoutUser = await env.DB.prepare(
        'SELECT x_id, x_handle, near_account FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
      )
        .bind(payoutHandle)
        .first<{ x_id: string; x_handle: string; near_account: string | null }>();

      if (!payoutUser) {
        await env.DB.prepare(
          "UPDATE circles SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND status = 'SETTLING'"
        )
          .bind(Date.now(), cleanId)
          .run();
        throw new CircleError(
          'PAYOUT_RECIPIENT_UNREGISTERED',
          `Payout recipient @${payoutHandle} has not signed in to UPRAIL yet. Ask @${payoutHandle} to sign in once before disbursing the Circle vault.`,
          400
        );
      }
      payoutNearAccount = await nearRpc.resolveUserNearAccount(env, payoutUser);
    }

    // Carve out the 1% protocol fee on Circle payout (principal + yield)
    const payoutSplit = computeStabilizeSplit(
      sharesToDisburse,
      Number(circleRow.vault_decimals || 18),
      env.FEE_PERCENT
    );
    const feeRecipient = env.FEE_ACCOUNT_ID || env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
    const payoutTransfers: Array<{ recipientAccount: string; assetId: string; amountAtomic: bigint }> = [
      {
        recipientAccount: payoutNearAccount,
        assetId: circleRow.vault_asset_id,
        amountAtomic: payoutSplit.netInputAtomic,
      },
    ];
    if (
      payoutSplit.feeAtomic > 0n &&
      feeRecipient.toLowerCase() !== payoutNearAccount.toLowerCase()
    ) {
      payoutTransfers.push({
        recipientAccount: feeRecipient,
        assetId: circleRow.vault_asset_id,
        amountAtomic: payoutSplit.feeAtomic,
      });
    }

    const transferRes = await transferBatchFromEarnCustody(
      env,
      cleanId,
      payoutTransfers,
      circleRow.custody_account
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
 * Unanimous contributor passkey-gated Circle dissolution (`POST /api/circles/:id/dissolve`).
 * Every contributor who has funded the Circle must sign with their passkey to activate
 * dissolution. Once all contributors have activated dissolve (or after a 7-day timeout
 * if a co-contributor is unresponsive), the Circle refunds 100% of contributed Earn Vault
 * shares (plus pro-rata accrued yield) back to each contributing member's UPRAIL account.
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

  const custody = await nearRpc.getUserCustodyRecord(env, session.x_id);
  if (custody.custodyMode === 'self') {
    throw new CircleError(
      'SELF_CUSTODY_SIGNATURE_REQUIRED',
      'Sign Circle dissolve with your passkey via /api/circles/:id/dissolve/prepare.',
      409
    );
  }

  if (circleRow.status === 'DISSOLVED' || circleRow.status === 'SETTLED') {
    throw new CircleError(
      'ALREADY_CLOSED',
      `Circle is already ${circleRow.status.toLowerCase()}.`,
      409
    );
  }

  const isContract = circleRow.contract_mode === 'contract' && Boolean(circleRow.onchain_circle_id);
  if (
    circleRow.status !== 'PENDING_SIGNATURES' &&
    circleRow.status !== 'ACTIVE' &&
    circleRow.status !== 'GOAL_MET' &&
    !(isContract && circleRow.status === 'DISSOLVING')
  ) {
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

  const allMembers = memberRows.results || [];
  const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
  const callerMember =
    allMembers.find(
      (m) =>
        (m.x_id && m.x_id === session.x_id) ||
        (callerHandle && String(m.x_handle || '').toLowerCase() === callerHandle)
    ) || null;

  const now = Date.now();

  if (isContract) {
    if (!callerMember) {
      throw new CircleError('FORBIDDEN', 'Only Circle members may dissolve.', 403);
    }
    const contractId = String(circleRow.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
    const onchain = await getCircleOnchain(env, circleRow.onchain_circle_id, contractId);
    if (!onchain) {
      throw new CircleError('RPC_UNAVAILABLE', 'On-chain Circle state not found.', 503);
    }
    const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
    const memberIndex = onchain.members.findIndex(
      (m) => m.account_id.toLowerCase() === nearAccount.toLowerCase()
    );
    if (memberIndex < 0) {
      throw new CircleError('FORBIDDEN', 'Your account is not bound as a signer in this Circle.', 403);
    }

    let lastTxHash: string | undefined;
    if (
      onchain.status === 'DISSOLVING' &&
      typeof onchain.dissolve_safeguard_at_ms === 'number' &&
      now >= onchain.dissolve_safeguard_at_ms
    ) {
      const fin = await finalizeDissolveOnchain(env, { circle_id: circleRow.onchain_circle_id, sigs: null }, contractId);
      if (!fin.success) {
        throw new CircleError('DISSOLVE_FAILED', fin.error || 'Safeguard finalize dissolve failed.', 502);
      }
      lastTxHash = fin.txHash;
    } else if (onchain.status === 'PENDING_SIGNATURES' || onchain.status === 'ACTIVE') {
      const payload = canonicalCircleDissolvePayload({
        contractId,
        circleId: circleRow.onchain_circle_id,
      });
      const proof = await signContractPayloadWithServerUserKey(env, session.x_id, payload);
      const init = await initiateDissolveOnchain(
        env,
        { circle_id: circleRow.onchain_circle_id, member_index: memberIndex, proof },
        contractId
      );
      if (!init.success) {
        throw new CircleError('DISSOLVE_FAILED', init.error || 'Initiate dissolve failed.', 502);
      }
      lastTxHash = init.txHash;
    } else if (onchain.status === 'DISSOLVING') {
      const payload = canonicalCircleDissolvePayload({
        contractId,
        circleId: circleRow.onchain_circle_id,
      });
      const proof = await signContractPayloadWithServerUserKey(env, session.x_id, payload);
      const sig = await signDissolveOnchain(
        env,
        { circle_id: circleRow.onchain_circle_id, member_index: memberIndex, proof },
        contractId
      );
      if (!sig.success) {
        throw new CircleError('DISSOLVE_FAILED', sig.error || 'Sign dissolve failed.', 502);
      }
      lastTxHash = sig.txHash;
    } else {
      throw new CircleError('INVALID_CIRCLE_STATE', `Circle cannot dissolve in status ${onchain.status}.`, 409);
    }

    let refreshed = await getCircleOnchain(env, circleRow.onchain_circle_id, contractId).catch(() => null);
    if (
      refreshed &&
      refreshed.status === 'DISSOLVING' &&
      refreshed.members.every((m) => BigInt(m.contributed || '0') === 0n || m.dissolve_signed)
    ) {
      const fin = await finalizeDissolveOnchain(env, { circle_id: circleRow.onchain_circle_id, sigs: null }, contractId);
      if (fin.success) {
        lastTxHash = fin.txHash || lastTxHash;
        refreshed = await getCircleOnchain(env, circleRow.onchain_circle_id, contractId).catch(() => refreshed);
      }
    }

    const finalStatus = refreshed?.status || 'DISSOLVING';
    const marker = `DISSOLVE_APPROVED:${now}`;
    await env.DB.prepare(
      `UPDATE circle_members
       SET x_id = COALESCE(x_id, ?),
           joined_at = COALESCE(joined_at, ?),
           dissolve_signed_at = COALESCE(dissolve_signed_at, ?),
           refund_tx_hash = CASE WHEN refunded_at IS NULL THEN COALESCE(refund_tx_hash, ?) ELSE refund_tx_hash END
       WHERE id = ?`
    )
      .bind(session.x_id, now, now, marker, callerMember.id)
      .run();

    if (finalStatus === 'DISSOLVED') {
      await env.DB.prepare(
        `UPDATE circle_members
         SET refunded_at = COALESCE(refunded_at, ?),
             refund_tx_hash = COALESCE(?, refund_tx_hash)
         WHERE circle_id = ? AND CAST(COALESCE(shares_atomic, '0') AS TEXT) != '0'`
      )
        .bind(now, lastTxHash || null, cleanId)
        .run();
    }

    await env.DB.prepare(
      `UPDATE circles
       SET status = ?,
           dissolve_initiated_at = COALESCE(dissolve_initiated_at, ?),
           dissolve_deadline_at = COALESCE(dissolve_deadline_at, ?),
           payout_tx_hash = COALESCE(payout_tx_hash, ?),
           closed_at = CASE WHEN ? = 'DISSOLVED' THEN COALESCE(closed_at, ?) ELSE closed_at END,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        finalStatus,
        refreshed?.dissolve_started_at_ms || now,
        refreshed?.dissolve_safeguard_at_ms || now + 7 * 86400_000,
        finalStatus === 'DISSOLVED' ? lastTxHash || null : null,
        finalStatus,
        now,
        now,
        cleanId
      )
      .run();

    return getCircleDetail(env, session, cleanId);
  }

  const contributors = allMembers.filter(
    (m) => BigInt(String(m.shares_atomic || '0')) > 0n
  );

  const unusedTimePlaceholder = now;
  void unusedTimePlaceholder;

  if (contributors.length === 0) {
    if (circleRow.creator_x_id !== session.x_id) {
      throw new CircleError(
        'FORBIDDEN',
        'Only the Circle creator can dissolve an unfunded Circle.',
        403
      );
    }
    await env.DB.prepare(
      "UPDATE circles SET status = 'DISSOLVED', closed_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(now, now, cleanId)
      .run();
    return getCircleDetail(env, session, cleanId);
  }

  // Funded Circle: caller must be an active contributor (shares_atomic > 0)
  const callerContributor = contributors.find(
    (m) => callerMember && m.id === callerMember.id
  );
  if (!callerContributor) {
    throw new CircleError(
      'FORBIDDEN',
      'Only contributors who have added funds to this Circle can activate a dissolve.',
      403
    );
  }

  // Preserve original approval timestamp if caller already signed earlier (enables 7-day deadlock escape hatch)
  const existingMarker = String(callerContributor.refund_tx_hash || '');
  const approvalMarker = existingMarker.startsWith('DISSOLVE_APPROVED:')
    ? existingMarker
    : `DISSOLVE_APPROVED:${now}`;
  callerContributor.refund_tx_hash = approvalMarker;
  await env.DB.prepare(
    `UPDATE circle_members
     SET x_id = COALESCE(x_id, ?),
         joined_at = COALESCE(joined_at, ?),
         refund_tx_hash = ?
     WHERE id = ?`
  )
    .bind(session.x_id, now, approvalMarker, callerContributor.id)
    .run();

  const allContributorsApproved = contributors.every((m) =>
    String(m.refund_tx_hash || '').startsWith('DISSOLVE_APPROVED')
  );

  // Deadlock escape hatch: if a dissolve request has been pending for > 7 days and another contributor is unresponsive
  let deadlockTimeoutExpired = false;
  if (!allContributorsApproved) {
    const earliestTs = contributors.reduce((minTs, m) => {
      const marker = String(m.refund_tx_hash || '');
      if (marker.startsWith('DISSOLVE_APPROVED:')) {
        const ts = Number(marker.split(':')[1] || 0);
        if (ts > 0 && ts < minTs) return ts;
      }
      return minTs;
    }, Infinity);
    if (Number.isFinite(earliestTs) && now - earliestTs >= 7 * 86400_000) {
      deadlockTimeoutExpired = true;
    }
  }

  // If other contributors still need to sign to dissolve, persist approval and return updated view
  if (!allContributorsApproved && !deadlockTimeoutExpired) {
    await env.DB.prepare('UPDATE circles SET updated_at = ? WHERE id = ?')
      .bind(now, cleanId)
      .run();
    return getCircleDetail(env, session, cleanId);
  }

  let totalRecordedShares = 0n;
  for (const m of contributors) {
    totalRecordedShares += BigInt(String(m.shares_atomic || '0'));
  }

  const recentContribs = await env.DB.prepare(
    'SELECT id, deposit_address, deposit_memo, created_at FROM circle_contributions WHERE circle_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 5'
  )
    .bind(cleanId, Date.now() - 10 * 60_000)
    .all<{ id: string; deposit_address: string | null; deposit_memo: string | null; created_at: number }>();

  const liveBalance = await getCustodyVaultBalance(
    env,
    circleRow.custody_account,
    circleRow.vault_asset_id
  );
  if (liveBalance === null) {
    throw new CircleError(
      'RPC_UNAVAILABLE',
      'Could not verify on-chain Circle vault balance right now. Please try again in a moment.',
      503
    );
  }

  if (liveBalance === 0n || (totalRecordedShares > 0n && liveBalance < (totalRecordedShares * 95n) / 100n)) {
    for (const c of recentContribs.results || []) {
      if (!c.deposit_address) continue;
      try {
        const execStatus = await getExecutionStatus(
          env,
          c.deposit_address,
          c.deposit_memo || undefined
        );
        const st = String(execStatus.status || '').toUpperCase();
        if (st === 'PENDING_DEPOSIT' || st === 'PROCESSING' || st === 'KNOWN_DEPOSIT_TX') {
          throw new CircleError(
            'SWAP_SETTLING_ONCHAIN',
            'A recent contribution is still settling into the vault on NEAR Intents (usually 5–15 seconds). Please wait a moment before dissolving.',
            409
          );
        }
      } catch (e) {
        if (e instanceof CircleError) throw e;
      }
    }
  }

  if (liveBalance <= 0n) {
    throw new CircleError(
      'EMPTY_CIRCLE_VAULT',
      'Circle custody account currently holds 0 settled vault shares on-chain.',
      400
    );
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
    const distributable = liveBalance;
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
        const memberIdentity = await env.DB.prepare(
          'SELECT x_id, x_handle, near_account FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
        )
          .bind(String(m.x_handle || '').toLowerCase())
          .first<{ x_id: string; x_handle: string; near_account: string | null }>();
        if (!memberIdentity) {
          throw new CircleError(
            'CONTRIBUTOR_UNREGISTERED',
            `Contributor @${m.x_handle} has no registered UPRAIL account to refund.`,
            400
          );
        }
        recipientNearAccount = await nearRpc.resolveUserNearAccount(env, memberIdentity);
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

    const batchRes = await transferBatchFromEarnCustody(
      env,
      cleanId,
      transfers,
      circleRow.custody_account
    );
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
 * Cron reconciliation for Circle contributions and stuck Circle settlement/dissolution states:
 *   1. Confirms `PENDING_FUNDING` external deposits once 1Click reports `SUCCESS`.
 *   2. Reverses recently `CONFIRMED` balance contributions if 1Click refunded the swap (`REFUNDED` / `FAILED`).
 *   3. Recovers Circles stuck in `SETTLING` or `DISSOLVING` after an ambiguous RPC timeout.
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

      const lockRes = await env.DB.prepare(
        `UPDATE circle_contributions
         SET status = 'CONFIRMED',
             shares_atomic = ?,
             fee_shares_atomic = '0',
             fee_status = 'NONE',
             intent_hash = COALESCE(intent_hash, ?),
             confirmed_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'PENDING_FUNDING'`
      )
        .bind(
          totalSettled.toString(),
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
            BigInt(String(mRow.shares_atomic || '0')) + totalSettled;
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

  // 2. Verify recently confirmed BALANCE contributions and reverse if 1Click refunded the swap
  const recentConfirmed = await env.DB.prepare(
    "SELECT * FROM circle_contributions WHERE status = 'CONFIRMED' AND created_at > ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(Date.now() - 45 * 60_000, limit)
    .all<any>();

  for (const row of recentConfirmed.results || []) {
    if (!row.deposit_address) continue;
    try {
      const execStatus = await getExecutionStatus(
        env,
        row.deposit_address,
        row.deposit_memo || undefined
      );
      const remote = String(execStatus.status || '').toUpperCase();
      if (remote === 'REFUNDED' || remote === 'FAILED') {
        const revRes = await env.DB.prepare(
          "UPDATE circle_contributions SET status = 'REFUNDED', updated_at = ? WHERE id = ? AND status = 'CONFIRMED'"
        )
          .bind(Date.now(), row.id)
          .run();
        if (revRes.meta?.changes) {
          const mRow = await env.DB.prepare('SELECT * FROM circle_members WHERE id = ? LIMIT 1')
            .bind(row.member_id)
            .first<any>();
          if (mRow) {
            const curShares = BigInt(String(mRow.shares_atomic || '0'));
            const revShares = BigInt(String(row.shares_atomic || row.quoted_shares_atomic || '0'));
            const nextShares = curShares > revShares ? curShares - revShares : 0n;
            const nextUsd = Math.max(
              0,
              Number(mRow.contributed_usd_cents || 0) - Number(row.usd_cents || 0)
            );
            await env.DB.prepare(
              'UPDATE circle_members SET contributed_usd_cents = ?, shares_atomic = ? WHERE id = ?'
            )
              .bind(nextUsd, nextShares.toString(), mRow.id)
              .run();
          }
        }
      }
    } catch {}
  }

  // 3. Recover any Circles stuck in SETTLING or DISSOLVING for > 60 seconds
  const stuckCircles = await env.DB.prepare(
    "SELECT * FROM circles WHERE status IN ('SETTLING', 'DISSOLVING') AND updated_at < ? LIMIT ?"
  )
    .bind(Date.now() - 60_000, limit)
    .all<any>();

  for (const c of stuckCircles.results || []) {
    checked++;
    try {
      if (c.contract_mode === 'contract' && c.onchain_circle_id) {
        const onchain = await getCircleOnchain(
          env,
          c.onchain_circle_id,
          c.escrow_contract_id || undefined
        ).catch(() => null);
        if (!onchain) continue;
        if (onchain.status === 'SETTLED' || onchain.status === 'DISSOLVED' || (c.status === 'SETTLING' && onchain.status === 'ACTIVE')) {
          const nowTs = Date.now();
          await env.DB.prepare(
            `UPDATE circles
             SET status = ?,
                 closed_at = CASE WHEN ? IN ('SETTLED', 'DISSOLVED') THEN COALESCE(closed_at, ?) ELSE closed_at END,
                 updated_at = ?
             WHERE id = ? AND status = ?`
          )
            .bind(onchain.status, onchain.status, nowTs, nowTs, c.id, c.status)
            .run();
        }
        continue;
      }

      const liveBal = await getCustodyVaultBalance(env, c.custody_account, c.vault_asset_id);
      if (liveBal === 0n) {
        const finalStatus = c.status === 'SETTLING' ? 'SETTLED' : 'DISSOLVED';
        await env.DB.prepare(
          'UPDATE circles SET status = ?, closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE id = ? AND status = ?'
        )
          .bind(finalStatus, Date.now(), Date.now(), c.id, c.status)
          .run();
      } else if (liveBal !== null && liveBal > 0n) {
        await env.DB.prepare(
          "UPDATE circles SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND status = ?"
        )
          .bind(Date.now(), c.id, c.status)
          .run();
      }
    } catch {}
  }

  return { checked, confirmed };
}
