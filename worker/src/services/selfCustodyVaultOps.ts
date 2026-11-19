/**
 * Self-Custody Circle & Earn Vault Gift Operations (`custody_mode = 'self'`,
 * `circle.uprail.near`, AND `escrow` passthrough for existing/escrow vaults).
 *
 * Security & correctness guarantees:
 *   1. Cryptographic Signer Binding & Multi-Group Isolation:
 *      Every on-chain Circle member is bound by `(account_id, pubkey)` and `circle_id`.
 *      `circle.uprail.near` isolates state strictly per `circle_id`, supporting unlimited
 *      Circles across disjoint or overlapping groups with zero cross-contamination.
 *   2. Zero-Stranding Deposit Flow:
 *      If a user funds a Circle or Gift using a non-vault asset (e.g. USDC -> stNEAR),
 *      the 1Click swap ALWAYS delivers & refunds to the user's own `intents.near` account
 *      first (`refundTo: userNearAccount`), and ONLY then transfers the exact vault
 *      shares with `msg` (`contribute_circle` / `create_and_fund_gift`) in a second step.
 *   3. NEAR L1 Native Sweeps:
 *      If funds sit on NEAR L1 (`u_*.escrow.uprail.near`), prepare seamlessly returns
 *      `step: 'native_auth'` (Passkey-authorized L1 sweep) rather than failing opaquely.
 *   4. Dual-Mode Support for Gift Vaults:
 *      Supports both `contract_mode = 'escrow'` passthrough AND non-custodial
 *      `contract_mode = 'contract'` (`circle.uprail.near`) cleanly.
 *   5. No Circular Imports:
 *      Depends ONLY on lower-level services (`nearRpc`, `circleContract`, `earnVaults`,
 *      `custodyService`, `nativeL1Auth`, `stabilize`, `oneclickClient`, `selfCustodyCrypto`).
 */

import type { Env, Session } from '../types';
import * as nearRpc from './nearRpc';
import {
  buildContributeCircleMsg,
  buildCreateAndFundGiftMsg,
  canonicalCircleAgreePayload,
  canonicalCircleDissolvePayload,
  canonicalCircleSettlePayload,
  canonicalGiftClaimPayload,
  canonicalGiftRecipientPayload,
  canonicalGiftReclaimPayload,
  claimGiftOnchain,
  type ContractAuthProof,
  type ContractCircleMemberInput,
  createCircleOnchain,
  finalizeDissolveOnchain,
  getAttestorPublicKey,
  getCircleContractId,
  getCircleOnchain,
  getGiftOnchain,
  hashHandleHex,
  initiateDissolveOnchain,
  isCircleContractEnabled,
  reclaimGiftOnchain,
  retryCircleSettlementOnchain,
  settleCircleOnchain,
  signCircleTermsOnchain,
  signDissolveOnchain,
  signHandleAttestation,
  syncContractCircleFromOnchain,
  toIntentsContractAssetSpec,
  webAuthnToContractProof,
} from './circleContract';
import {
  CIRCLE_GIFT_USDC_ASSET_ID,
  deriveEarnCustodyKey,
  ensureAgentPocketTopUpForMainAccount,
  generateSecureId,
  getCustodyVaultBalance,
  isUsdcOriginAsset,
  normalizeAndValidateHandle,
  resolveEarnVault,
  sanitizeUserText,
  transferFromEarnCustody,
} from './earnVaults';
import {
  CustodyActionError,
  consumeAndVerifyWebAuthnPendingAction,
  createPendingCustodyAction,
  prepareOneClickWebAuthnSession,
} from './custodyService';
import { maybePrepareMatchingPlainL1Sweep, submitNativeL1Operation } from './nativeL1Auth';
import {
  buildIntentsPayloadString,
  parseNearPublicKey,
  type IntentsAction,
} from './selfCustodyCrypto';
import {
  generateSwapIntent,
  getExecutionStatus,
  requestQuote,
  submitSwapIntent,
} from './oneclickClient';
import {
  OneClickSelfCustodyAuthRequiredError,
  getUserSession,
  validateGeneratedIntentForAccount,
} from './oneclickAuth';
import {
  computeStabilizeSplit,
  getOneClickTokens,
  requestExactVaultToUsdcQuote,
  resolveOriginToken,
} from './stabilize';
import {
  formatAtomic,
  getAvailableConfidentialAtomicForAsset,
  isConfidentialRailEnabled,
  waitForSettlement,
} from './confidentialRail';
import { prepareSelfCustodyShieldTarget } from './selfCustodyActions';
import { allowedWebAuthnOrigins } from './webauthnConfig';
import { publicErrorMessage } from '../utils/errors';

const VAULT_ACTION_TTL_MS = 10 * 60 * 1000;
const SWAP_QUOTE_TTL_MS = 15 * 60 * 1000;
const GIFT_RECLAIM_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface MemberSignerBinding {
  handle: string;
  registered: boolean;
  xId: string | null;
  nearAccount: string | null;
  pubkey: string | null;
  custodyMode: 'server' | 'self' | null;
}

export async function resolveMemberSignerBinding(
  env: Env,
  rawHandle: string
): Promise<MemberSignerBinding> {
  const handle = normalizeAndValidateHandle(rawHandle, 'Member handle');
  if (!env.DB) {
    return { handle, registered: false, xId: null, nearAccount: null, pubkey: null, custodyMode: null };
  }

  const row = await env.DB.prepare(
    'SELECT x_id, x_handle, near_account, is_activated, custody_mode FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
  )
    .bind(handle)
    .first<{
      x_id: string;
      x_handle: string;
      near_account: string | null;
      is_activated: number | boolean;
      custody_mode: string | null;
    }>();

  if (!row || (!row.near_account && !row.is_activated)) {
    return { handle, registered: false, xId: null, nearAccount: null, pubkey: null, custodyMode: null };
  }

  const custodyMode = row.custody_mode === 'self' ? 'self' : 'server';
  const nearAccount = await nearRpc.resolveUserNearAccount(env, {
    x_id: row.x_id,
    x_handle: row.x_handle,
    near_account: row.near_account,
    custody_mode: custodyMode,
  });

  if (custodyMode === 'self') {
    const pkRow = await env.DB.prepare(
      `SELECT near_p256_pubkey FROM passkeys
       WHERE x_id = ? AND near_p256_pubkey IS NOT NULL AND onchain_added_at IS NOT NULL
       ORDER BY onchain_added_at ASC, created_at ASC LIMIT 1`
    )
      .bind(row.x_id)
      .first<{ near_p256_pubkey: string | null }>();

    const fallbackRow =
      pkRow?.near_p256_pubkey
        ? pkRow
        : await env.DB.prepare(
            `SELECT near_p256_pubkey FROM passkeys
             WHERE x_id = ? AND near_p256_pubkey IS NOT NULL
             ORDER BY created_at ASC LIMIT 1`
          )
            .bind(row.x_id)
            .first<{ near_p256_pubkey: string | null }>();

    if (!fallbackRow?.near_p256_pubkey) {
      return { handle, registered: true, xId: row.x_id, nearAccount, pubkey: null, custodyMode: 'self' };
    }
    return {
      handle,
      registered: true,
      xId: row.x_id,
      nearAccount,
      pubkey: fallbackRow.near_p256_pubkey,
      custodyMode: 'self',
    };
  }

  const kp = await nearRpc.deriveUserNearKeypair(env, row.x_id);
  return {
    handle,
    registered: true,
    xId: row.x_id,
    nearAccount,
    pubkey: kp.publicKeyB58,
    custodyMode: 'server',
  };
}

async function getCurrentSaltAndAccount(env: Env, session: Session) {
  const custody = await nearRpc.getUserCustodyRecord(env, session.x_id);
  if (custody.custodyMode !== 'self' || !custody.nearAccount) {
    throw new CustodyActionError(
      'This flow requires an active Self-Custody account.',
      400,
      'NOT_SELF_CUSTODY'
    );
  }
  const auth = await nearRpc.getAccountIntentsAuthState(env, custody.nearAccount);
  if (!auth.currentSalt) {
    throw new CustodyActionError(
      'Could not read current intents.near salt from NEAR RPC.',
      502,
      'INTENTS_SALT_UNAVAILABLE'
    );
  }
  return { nearAccount: custody.nearAccount, saltHex: auth.currentSalt };
}

function assertAllowedContractWebAuthnOrigin(env: Env, clientDataJson: string): void {
  let parsed: { origin?: unknown };
  try {
    parsed = JSON.parse(clientDataJson);
  } catch {
    throw new CustodyActionError('Malformed WebAuthn clientDataJSON', 400, 'INVALID_WEBAUTHN_CLIENT_DATA');
  }
  const origin = typeof parsed.origin === 'string' ? parsed.origin.replace(/\/+$/, '') : '';
  const allowed = allowedWebAuthnOrigins(env).map((o) => o.replace(/\/+$/, ''));
  if (!origin || !allowed.includes(origin)) {
    throw new CustodyActionError('Unauthorized WebAuthn origin', 403, 'INVALID_WEBAUTHN_ORIGIN');
  }
}

function validateGeneratedOneClickDepositIntent(
  rawPayload: string | undefined,
  messagePayload: string | undefined,
  expectedSignerId: string,
  expectedDepositAddress: string
): string {
  const payloadStr = rawPayload || messagePayload || '';
  if (!payloadStr) {
    throw new CustodyActionError('1Click returned an empty intent payload.', 502, 'ONECLICK_EMPTY_INTENT');
  }
  let parsed: { signer_id?: string; intents?: any[] };
  try {
    parsed = JSON.parse(payloadStr);
  } catch {
    throw new CustodyActionError('1Click returned non-JSON intent payload.', 502, 'ONECLICK_INVALID_INTENT');
  }
  if ((parsed.signer_id || '').toLowerCase() !== expectedSignerId.toLowerCase()) {
    throw new CustodyActionError('Intent signer mismatch from 1Click.', 502, 'INTENT_SIGNER_MISMATCH');
  }
  const t = Array.isArray(parsed.intents) ? parsed.intents : [];
  if (
    t.length !== 1 ||
    t[0]?.intent !== 'transfer' ||
    String(t[0]?.receiver_id || '').toLowerCase() !== expectedDepositAddress.toLowerCase()
  ) {
    throw new CustodyActionError('Intent receiver mismatch from 1Click.', 502, 'INTENT_RECEIVER_MISMATCH');
  }
  return payloadStr;
}

async function ensureSelfCustodyUsdcInPublicIntents(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  origin: { assetId: string; symbol: string; decimals: number; nearContractId?: string };
  grossAtomic: bigint;
  nextStep: 'circle_contribute' | 'gift_create';
}): Promise<
  | { ready: true; originAssetId: string }
  | { ready: false; prepareResponse: Record<string, any> }
> {
  const { env, session, nearAccount, origin, grossAtomic, nextStep } = params;

  const pubBal = await nearRpc.getIntentAssetBalance(env, origin.assetId, nearAccount).catch(() => null);
  let pubAmt = pubBal?.balance ?? 0n;
  if (pubAmt < grossAtomic) {
    pubAmt = await ensureAgentPocketTopUpForMainAccount(env, nearAccount, origin.assetId, grossAtomic, pubAmt);
  }
  if (pubAmt >= grossAtomic) {
    return { ready: true, originAssetId: origin.assetId };
  }

  // Check if user holds another bridged/native USDC variant directly in public intents.near
  const intentBals = await nearRpc.getIntentBalances(env, nearAccount).catch(() => []);
  const matchingAlt = intentBals.find(
    (b) =>
      b.defuse_asset_id &&
      (b.symbol || '').trim().toUpperCase() === origin.symbol.trim().toUpperCase() &&
      (b.decimals ?? origin.decimals) === origin.decimals &&
      BigInt(b.amount || '0') >= grossAtomic
  );
  if (matchingAlt?.defuse_asset_id) {
    return { ready: true, originAssetId: matchingAlt.defuse_asset_id };
  }

  // Check plain NEAR L1 balance on the user's sub-account
  const sweepPrepare = await maybePrepareMatchingPlainL1Sweep({
    env,
    session,
    nearAccount,
    assetId: origin.assetId,
    contractId: origin.nearContractId,
    symbol: origin.symbol,
    decimals: origin.decimals,
    publicBalanceAtomic: pubAmt,
    requiredAtomic: grossAtomic,
    nextStep,
  });
  if (sweepPrepare) {
    return { ready: false, prepareResponse: sweepPrepare };
  }

  // Check Confidential Intents balance and unshield exact shortfall into public intents.near
  let confAvailAtomic = 0n;
  if (isConfidentialRailEnabled(env)) {
    let ocSession: { accessToken: string; accountId: string };
    try {
      ocSession = await getUserSession(env, session.x_id);
    } catch (err) {
      if (err instanceof OneClickSelfCustodyAuthRequiredError) {
        const oneClickPrepare = await prepareOneClickWebAuthnSession(
          env,
          session.x_id,
          session.x_handle
        );
        throw new CustodyActionError(
          'Passkey signature needed to unlock your private balance.',
          401,
          'ONECLICK_AUTH_REQUIRED',
          { oneClickPrepare }
        );
      }
      throw err;
    }

    const conf = await getAvailableConfidentialAtomicForAsset(
      env,
      session.x_id,
      origin.assetId,
      origin.decimals,
      origin.symbol
    );
    confAvailAtomic = conf.availableAtomic;
    const shortfall = grossAtomic - pubAmt;

    if (confAvailAtomic >= shortfall && shortfall > 0n) {
      const unshieldQuote = await requestQuote(
        env,
        {
          dry: false,
          swapType: 'EXACT_INPUT',
          originAsset: conf.assetId,
          destinationAsset: origin.assetId,
          amount: shortfall.toString(),
          recipient: nearAccount,
          recipientType: 'INTENTS',
          refundTo: nearAccount,
          refundType: 'CONFIDENTIAL_INTENTS',
          depositType: 'CONFIDENTIAL_INTENTS',
          confidentiality: 'basic',
          slippageTolerance: 100,
          deadline: new Date(Date.now() + SWAP_QUOTE_TTL_MS).toISOString(),
        },
        { userSession: ocSession.accessToken }
      );
      const depAddr = unshieldQuote.quote.depositAddress;
      const generated = await generateSwapIntent(env, {
        depositAddress: depAddr,
        signerId: nearAccount,
        standard: 'webauthn',
      });
      const payloadStr = validateGeneratedOneClickDepositIntent(
        generated.rawPayload,
        generated.payload?.message,
        nearAccount,
        depAddr
      );
      const pending = await createPendingCustodyAction({
        env,
        xId: session.x_id,
        actionType: 'VAULT_UNSHIELD_USDC',
        payloadStr,
        meta: {
          nearAccount,
          depositAddress: depAddr,
          assetId: origin.assetId,
          symbol: origin.symbol,
          decimals: origin.decimals,
          shortfallAtomic: shortfall.toString(),
          balanceBeforeAtomic: pubAmt.toString(),
          nextStep,
        },
        requireOnchainPasskey: true,
        ttlMs: VAULT_ACTION_TTL_MS,
      });

      return {
        ready: false,
        prepareResponse: {
          step: 'unshield' as const,
          nextStep,
          assetId: origin.assetId,
          vaultAssetId: origin.assetId,
          symbol: origin.symbol,
          unshieldAmountFormatted: formatAtomic(shortfall.toString(), origin.decimals),
          depositAddress: depAddr,
          balanceBeforeAtomic: pubAmt.toString(),
          ...pending,
        },
      };
    }
  }

  const totalAvail = pubAmt + confAvailAtomic;
  const availFmt = formatAtomic(totalAvail.toString(), origin.decimals);
  const reqFmt = formatAtomic(grossAtomic.toString(), origin.decimals);
  throw new CustodyActionError(
    `Insufficient ${origin.symbol} balance (${availFmt} available, ${reqFmt} required).`,
    400,
    'INSUFFICIENT_FUNDS'
  );
}

async function handleVaultUnshieldSubmit(params: {
  env: Env;
  session: Session;
  actionId: string;
  assertion: unknown;
}) {
  const { env, session, actionId, assertion } = params;
  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'VAULT_UNSHIELD_USDC',
    requireOnchainPasskey: true,
  });

  await submitSwapIntent(env, signedWebAuthn);
  const settlement = await waitForSettlement(env, session.x_id, meta.depositAddress, {
    timeoutMs: 25_000,
  }).catch(() => null);
  const upperStatus = String(settlement?.status || '').toUpperCase();
  if (upperStatus === 'FAILED' || upperStatus === 'REFUNDED') {
    throw new CustodyActionError(
      `Moving private ${meta.symbol || 'USDC'} ${upperStatus.toLowerCase()} — your funds stayed safely in your private balance.`,
      502,
      'UNSHIELD_FAILED'
    );
  }
  const curBal =
    (await nearRpc.getIntentAssetBalance(env, meta.assetId, meta.nearAccount).catch(() => null))
      ?.balance ?? 0n;
  const settled =
    upperStatus === 'SUCCESS' || curBal > BigInt(meta.balanceBeforeAtomic || '0');

  return {
    step: 'unshield' as const,
    depositAddress: meta.depositAddress,
    vaultAssetId: meta.assetId,
    balanceBeforeAtomic: meta.balanceBeforeAtomic || '0',
    settled,
  };
}

function estimateVaultPrincipalUsdCents(
  sharesAtomic: bigint,
  vaultDecimals: number,
  vaultPriceUsd: number | undefined,
  fallbackUsdAmount: string
): number {
  const formattedShares = Number(formatAtomic(sharesAtomic.toString(), vaultDecimals));
  if (vaultPriceUsd && vaultPriceUsd > 0 && Number.isFinite(formattedShares) && formattedShares > 0) {
    return Math.max(100, Math.round(formattedShares * vaultPriceUsd * 100));
  }
  const usdFallback = Number(fallbackUsdAmount);
  if (Number.isFinite(usdFallback) && usdFallback > 0) {
    return Math.max(100, Math.round(usdFallback * 100));
  }
  return 100;
}

async function markVaultSwapDeposited(
  env: Env,
  xId: string,
  swapActionId?: string | null
): Promise<void> {
  if (!env.DB || !swapActionId) return;
  try {
    const row = await env.DB.prepare(
      'SELECT meta_json FROM pending_custody_actions WHERE id = ? AND x_id = ? LIMIT 1'
    )
      .bind(swapActionId, xId)
      .first<{ meta_json: string | null }>();
    if (!row) return;
    let parsed: Record<string, any> = {};
    try {
      parsed = row.meta_json ? JSON.parse(row.meta_json) : {};
    } catch {
      parsed = {};
    }
    parsed.deposited = true;
    parsed.depositedAt = Date.now();
    await env.DB.prepare(
      'UPDATE pending_custody_actions SET meta_json = ? WHERE id = ? AND x_id = ?'
    )
      .bind(JSON.stringify(parsed), swapActionId, xId)
      .run();
  } catch (err) {
    console.warn(`[selfCustodyVaultOps] failed to mark swap ${swapActionId} deposited:`, err);
  }
}

async function fetchSwapStatusWithOptionalAuth(
  env: Env,
  xId: string,
  depositAddress: string
) {
  let execStatus = await getExecutionStatus(env, depositAddress).catch(() => null);
  if ((!execStatus || execStatus.status === 'UNKNOWN') && isConfidentialRailEnabled(env)) {
    const ocSession = await getUserSession(env, xId).catch(() => null);
    if (ocSession?.accessToken) {
      execStatus = await getExecutionStatus(
        env,
        depositAddress,
        undefined,
        ocSession.accessToken
      ).catch(() => null);
    }
  }
  return execStatus;
}

async function readPublicVaultBalanceWithRetry(
  env: Env,
  vaultAssetId: string,
  nearAccount: string
): Promise<bigint> {
  let bal =
    (await nearRpc.getIntentAssetBalance(env, vaultAssetId, nearAccount).catch(() => null))
      ?.balance ?? 0n;
  if (bal <= 0n) {
    await new Promise((r) => setTimeout(r, 500));
    bal =
      (await nearRpc.getIntentAssetBalance(env, vaultAssetId, nearAccount).catch(() => null))
        ?.balance ?? 0n;
  }
  return bal;
}

async function userHasSufficientUsdcAnywhere(
  env: Env,
  session: Session,
  nearAccount: string,
  origin: { assetId: string; symbol: string; decimals: number; nearContractId?: string },
  grossAtomic: bigint
): Promise<boolean> {
  const pubBal = await nearRpc.getIntentAssetBalance(env, origin.assetId, nearAccount).catch(() => null);
  let total = pubBal?.balance ?? 0n;
  if (total >= grossAtomic) return true;

  const custody = await nearRpc.getUserCustodyRecord(env, session.x_id).catch(() => null);
  const canSignL1 =
    !custody ||
    custody.custodyMode !== 'self' ||
    (await nearRpc.canServerSignAccountL1(env, session.x_id, nearAccount));
  if (canSignL1) {
    const plain = await nearRpc.getPlainBalances(env, nearAccount).catch(() => []);
    const matchingPlain = plain.find(
      (b) =>
        nearRpc.assetsMatch(b.defuse_asset_id, origin.assetId) ||
        nearRpc.assetsMatch(b.nearContractId, origin.nearContractId)
    );
    total += BigInt(matchingPlain?.amount || '0');
    if (total >= grossAtomic) return true;
  }

  if (isConfidentialRailEnabled(env)) {
    const conf = await getAvailableConfidentialAtomicForAsset(
      env,
      session.x_id,
      origin.assetId,
      origin.decimals,
      origin.symbol
    ).catch(() => ({ availableAtomic: 0n }));
    total += conf.availableAtomic;
  }
  return total >= grossAtomic;
}

/**
 * Shared vault-deposit share resolver for self-custody Circles and Earn Gifts.
 *
 * Ensures USDC unshield -> USDC->vault swap (`swap_to_vault`) hands off cleanly
 * into the final contract/escrow deposit using exact vault-token base units (`vault.decimals`),
 * and automatically recovers un-deposited shares from a recent interrupted swap
 * (so a user who signed swap_to_vault cleanly never gets stranded holding stNEAR/etc.).
 */
async function resolvePreparedVaultSharesForDeposit(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  vault: { assetId: string; symbol: string; decimals: number; priceUsd?: number };
  origin: { assetId: string; symbol: string; decimals: number; nearContractId?: string };
  grossAtomic: bigint;
  amountStr: string;
  nextStep: 'circle_contribute' | 'gift_create';
  completedSwapDepositAddress?: string;
  circleId?: string;
  memberId?: string;
}): Promise<
  | {
      ready: true;
      depositSharesAtomic: bigint;
      swapActionId?: string;
      sourceAsset: string;
      sourceSymbol: string;
      sourceDecimals: number;
      sourceGrossAtomic: string;
      principalUsdCents: number;
    }
  | {
      ready: false;
      prepareResponse: Record<string, any>;
    }
> {
  const {
    env,
    session,
    nearAccount,
    vault,
    origin,
    grossAtomic,
    amountStr,
    nextStep,
    completedSwapDepositAddress,
    circleId,
    memberId,
  } = params;

  const sameAsset = origin.assetId.toLowerCase() === vault.assetId.toLowerCase();
  if (sameAsset) {
    const fundsCheck = await ensureSelfCustodyUsdcInPublicIntents({
      env,
      session,
      nearAccount,
      origin,
      grossAtomic,
      nextStep,
    });
    if (!fundsCheck.ready) {
      return { ready: false, prepareResponse: fundsCheck.prepareResponse };
    }
    return {
      ready: true,
      depositSharesAtomic: grossAtomic,
      sourceAsset: fundsCheck.originAssetId,
      sourceSymbol: origin.symbol,
      sourceDecimals: origin.decimals,
      sourceGrossAtomic: grossAtomic.toString(),
      principalUsdCents: estimateVaultPrincipalUsdCents(
        grossAtomic,
        vault.decimals,
        vault.priceUsd,
        amountStr
      ),
    };
  }

  const swapActionType =
    nextStep === 'circle_contribute' ? 'CIRCLE_CONTRIBUTE_SWAP' : 'GIFT_CREATE_SWAP';
  const completedDepAddr = (completedSwapDepositAddress || '').trim().toLowerCase();
  const swapLookbackCutoff = Date.now() - 24 * 60 * 60 * 1000;

  if (env.DB) {
    const swapRows = await env.DB.prepare(
      `SELECT id, used_at, meta_json
         FROM pending_custody_actions
        WHERE x_id = ? AND action_type = ? AND used_at IS NOT NULL AND used_at >= ?
        ORDER BY used_at DESC
        LIMIT 10`
    )
      .bind(session.x_id, swapActionType, swapLookbackCutoff)
      .all<{ id: string; used_at: number; meta_json: string | null }>();

    const candidates: Array<{ id: string; meta: Record<string, any> }> = [];
    for (const row of swapRows.results || []) {
      let parsed: Record<string, any> | null = null;
      try {
        parsed = row.meta_json ? JSON.parse(row.meta_json) : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.deposited === true || parsed.deposited === 1) continue;
      if (String(parsed.vaultAssetId || '').toLowerCase() !== vault.assetId.toLowerCase()) continue;
      if (String(parsed.nearAccount || '').toLowerCase() !== nearAccount.toLowerCase()) continue;
      if (circleId && parsed.circleId && String(parsed.circleId) !== circleId) continue;
      if (!parsed.depositAddress) continue;
      candidates.push({ id: row.id, meta: parsed });
    }

    if (candidates.length > 0) {
      let hasUsdcChecked: boolean | null = null;
      const checkUsdcOnce = async () => {
        if (hasUsdcChecked === null) {
          hasUsdcChecked = await userHasSufficientUsdcAnywhere(
            env,
            session,
            nearAccount,
            origin,
            grossAtomic
          );
        }
        return hasUsdcChecked;
      };

      for (const cand of candidates) {
        const depAddr = String(cand.meta.depositAddress);
        const isExplicitMatch = Boolean(completedDepAddr && depAddr.toLowerCase() === completedDepAddr);
        if (completedDepAddr && !isExplicitMatch) continue;

        let swappedGrossAtomic = 0n;
        try {
          swappedGrossAtomic = BigInt(cand.meta.grossAtomic || '0');
        } catch {
          swappedGrossAtomic = 0n;
        }

        if (!isExplicitMatch) {
          if (swappedGrossAtomic <= 0n) continue;
          const matchesWithin5Pct =
            grossAtomic * 100n >= swappedGrossAtomic * 95n &&
            grossAtomic * 100n <= swappedGrossAtomic * 105n;
          if (!matchesWithin5Pct) {
            const sufficientUsdc = await checkUsdcOnce();
            if (sufficientUsdc || grossAtomic * 100n > swappedGrossAtomic * 105n) {
              continue;
            }
          }
        }

        const execStatus = await fetchSwapStatusWithOptionalAuth(env, session.x_id, depAddr);
        const remoteStatus = String(execStatus?.status || '').toUpperCase();
        if (remoteStatus !== 'SUCCESS') continue;

        const reportedOut = BigInt((execStatus?.swapDetails as any)?.amountOut || '0');
        const estimatedOut = BigInt(cand.meta.estimatedSharesOutAtomic || '0');
        const swappedOutAtomic = reportedOut > 0n ? reportedOut : estimatedOut;

        const liveVaultBal = await readPublicVaultBalanceWithRetry(env, vault.assetId, nearAccount);
        if (liveVaultBal <= 0n) continue;

        if (!isExplicitMatch && swappedOutAtomic > 0n && liveVaultBal < (swappedOutAtomic * 90n) / 100n) {
          continue;
        }

        const usableOut =
          swappedOutAtomic > 0n
            ? swappedOutAtomic < liveVaultBal
              ? swappedOutAtomic
              : liveVaultBal
            : liveVaultBal;

        let depositSharesAtomic = usableOut;
        let sourceGrossAtomic = swappedGrossAtomic > 0n ? swappedGrossAtomic.toString() : grossAtomic.toString();
        if (!isExplicitMatch && swappedGrossAtomic > 0n && grossAtomic * 100n < swappedGrossAtomic * 95n) {
          depositSharesAtomic = (usableOut * grossAtomic) / swappedGrossAtomic;
          if (depositSharesAtomic > liveVaultBal) depositSharesAtomic = liveVaultBal;
          sourceGrossAtomic = grossAtomic.toString();
        }
        if (depositSharesAtomic <= 0n) continue;

        return {
          ready: true,
          depositSharesAtomic,
          swapActionId: cand.id,
          sourceAsset: String(cand.meta.originAsset || origin.assetId),
          sourceSymbol: String(cand.meta.originSymbol || origin.symbol),
          sourceDecimals: Number(cand.meta.originDecimals ?? origin.decimals),
          sourceGrossAtomic,
          principalUsdCents: estimateVaultPrincipalUsdCents(
            depositSharesAtomic,
            vault.decimals,
            vault.priceUsd,
            amountStr
          ),
        };
      }
    }
  }

  let swapQuote: any = null;
  let usedOriginAsset = origin.assetId;
  let isConfidentialSwap = false;

  const initPubBal =
    (await nearRpc.getIntentAssetBalance(env, origin.assetId, nearAccount).catch(() => null))
      ?.balance ?? 0n;
  if (initPubBal < grossAtomic && isConfidentialRailEnabled(env)) {
    let ocSession: { accessToken: string; accountId: string } | null = null;
    try {
      ocSession = await getUserSession(env, session.x_id);
    } catch (err) {
      if (err instanceof OneClickSelfCustodyAuthRequiredError) {
        const oneClickPrepare = await prepareOneClickWebAuthnSession(
          env,
          session.x_id,
          session.x_handle
        );
        throw new CustodyActionError(
          'Passkey signature needed to unlock your private balance.',
          401,
          'ONECLICK_AUTH_REQUIRED',
          { oneClickPrepare }
        );
      }
      throw err;
    }

    const conf = await getAvailableConfidentialAtomicForAsset(
      env,
      session.x_id,
      origin.assetId,
      origin.decimals,
      origin.symbol
    );
    if (ocSession && conf.availableAtomic >= grossAtomic) {
      try {
        swapQuote = await requestQuote(
          env,
          {
            dry: false,
            swapType: 'EXACT_INPUT',
            originAsset: conf.assetId,
            destinationAsset: vault.assetId,
            amount: grossAtomic.toString(),
            recipient: nearAccount,
            recipientType: 'INTENTS',
            refundTo: nearAccount,
            refundType: 'CONFIDENTIAL_INTENTS',
            depositType: 'CONFIDENTIAL_INTENTS',
            confidentiality: 'basic',
            slippageTolerance: 300,
            deadline: new Date(Date.now() + SWAP_QUOTE_TTL_MS).toISOString(),
          },
          { userSession: ocSession.accessToken }
        );
        usedOriginAsset = conf.assetId;
        isConfidentialSwap = true;
      } catch {
        swapQuote = null;
      }
    }
  }

  if (!swapQuote) {
    const fundsCheck = await ensureSelfCustodyUsdcInPublicIntents({
      env,
      session,
      nearAccount,
      origin,
      grossAtomic,
      nextStep,
    });
    if (!fundsCheck.ready) {
      return { ready: false, prepareResponse: fundsCheck.prepareResponse };
    }
    usedOriginAsset = fundsCheck.originAssetId;

    swapQuote = await requestQuote(env, {
      dry: false,
      swapType: 'EXACT_INPUT',
      originAsset: usedOriginAsset,
      destinationAsset: vault.assetId,
      amount: grossAtomic.toString(),
      recipient: nearAccount,
      recipientType: 'INTENTS',
      refundTo: nearAccount,
      refundType: 'INTENTS',
      depositType: 'INTENTS',
      slippageTolerance: 300,
      deadline: new Date(Date.now() + SWAP_QUOTE_TTL_MS).toISOString(),
    });
  }

  const depAddr = swapQuote.quote.depositAddress;
  const generated = await generateSwapIntent(env, {
    depositAddress: depAddr,
    signerId: nearAccount,
    standard: 'webauthn',
  });
  const payloadStr = validateGeneratedOneClickDepositIntent(
    generated.rawPayload,
    generated.payload?.message,
    nearAccount,
    depAddr
  );
  const estimatedSharesOutAtomic =
    swapQuote.quote.amountOut || swapQuote.quote.minAmountOut || '0';
  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: swapActionType,
    payloadStr,
    meta: {
      ...(circleId ? { circleId } : {}),
      ...(memberId ? { memberId } : {}),
      nearAccount,
      depositAddress: depAddr,
      originAsset: usedOriginAsset,
      originSymbol: origin.symbol,
      originDecimals: origin.decimals,
      grossAtomic: grossAtomic.toString(),
      vaultAssetId: vault.assetId,
      vaultSymbol: vault.symbol,
      vaultDecimals: vault.decimals,
      estimatedSharesOutAtomic,
      isConfidentialSwap,
    },
    requireOnchainPasskey: true,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return {
    ready: false,
    prepareResponse: {
      step: 'swap_to_vault' as const,
      ...(circleId ? { circleId } : {}),
      depositAddress: depAddr,
      vaultAssetId: vault.assetId,
      vaultSymbol: vault.symbol,
      estimatedSharesOut: formatAtomic(swapQuote.quote.amountOut || '0', vault.decimals),
      ...pending,
    },
  };
}

function normalizeMembersWithQuotas(
  creatorHandleRaw: string,
  membersRaw: Array<{ handle: string; shareBps?: number; percentageShare?: number; quotaUsdCents?: number }>,
  targetUsdCents: number
): Array<{ handle: string; shareBps: number; quotaUsdCents: number }> {
  const creatorHandle = normalizeAndValidateHandle(creatorHandleRaw, 'Creator handle');
  const seen = new Set<string>();
  const list: Array<{ handle: string; shareBps: number; quotaUsdCents: number }> = [];
  for (const m of membersRaw) {
    const h = normalizeAndValidateHandle(m.handle, 'Member handle');
    if (seen.has(h)) {
      throw new CustodyActionError(`Duplicate Circle member handle: @${h}`, 400, 'DUPLICATE_MEMBER');
    }
    seen.add(h);
    const bps =
      typeof m.shareBps === 'number' && Number.isFinite(m.shareBps) && m.shareBps > 0
        ? Math.round(m.shareBps)
        : typeof m.percentageShare === 'number' && Number.isFinite(m.percentageShare) && m.percentageShare > 0
        ? Math.round(m.percentageShare * 100)
        : 0;
    list.push({
      handle: h,
      shareBps: bps,
      quotaUsdCents: Number(m.quotaUsdCents || 0),
    });
  }
  if (!seen.has(creatorHandle)) {
    list.unshift({ handle: creatorHandle, shareBps: 0, quotaUsdCents: 0 });
  }
  if (list.length === 0 || list.length > 25) {
    throw new CustodyActionError('Circles require between 1 and 25 members.', 400, 'INVALID_MEMBERS');
  }

  const totalBps = list.reduce((s, m) => s + (Number.isFinite(m.shareBps) ? m.shareBps : 0), 0);
  if (totalBps === 10_000 && list.every((m) => Number.isInteger(m.shareBps) && m.shareBps > 0)) {
    let allocated = 0;
    return list.map((m, idx) => {
      if (idx === list.length - 1) {
        return { ...m, quotaUsdCents: Math.max(100, targetUsdCents - allocated) };
      }
      const slice = Math.max(100, Math.round((targetUsdCents * m.shareBps) / 10_000));
      allocated += slice;
      return { ...m, quotaUsdCents: slice };
    });
  }

  const evenBps = Math.floor(10_000 / list.length);
  const remBps = 10_000 - evenBps * list.length;
  let allocated = 0;
  return list.map((m, idx) => {
    const bps = idx === 0 ? evenBps + remBps : evenBps;
    if (idx === list.length - 1) {
      return { handle: m.handle, shareBps: bps, quotaUsdCents: Math.max(100, targetUsdCents - allocated) };
    }
    const slice = Math.max(100, Math.round((targetUsdCents * bps) / 10_000));
    allocated += slice;
    return {
      handle: m.handle,
      shareBps: bps,
      quotaUsdCents: slice,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIRCLES: CREATE / JOIN-AGREE / CONTRIBUTE / SETTLE / DISSOLVE
// ═══════════════════════════════════════════════════════════════════════════════

export async function prepareSelfCustodyCircleCreate(params: {
  env: Env;
  session: Session;
  input: {
    name: string;
    purpose?: string;
    note?: string;
    targetUsdCents?: number;
    targetAmountUsd?: number;
    vaultAsset?: string;
    payoutHandle?: string;
    mode?: 'contract' | 'escrow';
    members: Array<{ handle: string; shareBps?: number; percentageShare?: number; quotaUsdCents?: number }>;
  };
}) {
  const { env, session, input } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');
  const { nearAccount: creatorAccount } = await getCurrentSaltAndAccount(env, session);

  const name = sanitizeUserText(input.name, 64);
  if (!name || name.length < 2) {
    throw new CustodyActionError('Circle name must be at least 2 characters.', 400, 'INVALID_NAME');
  }
  const purpose = sanitizeUserText(input.purpose || 'group', 32) || 'group';
  const note = sanitizeUserText(input.note, 200) || null;
  const rawCents =
    input.targetUsdCents !== undefined && Number.isFinite(Number(input.targetUsdCents))
      ? Number(input.targetUsdCents)
      : Number(input.targetAmountUsd || 0) * 100;
  const targetUsdCents = Math.round(rawCents);
  if (!Number.isFinite(targetUsdCents) || targetUsdCents < 100 || targetUsdCents > 100_000_000) {
    throw new CustodyActionError('Target amount must be between $1 and $1,000,000.', 400, 'INVALID_TARGET');
  }

  const vault = await resolveEarnVault(env, input.vaultAsset || 'TLO').catch(() => null);
  if (!vault) {
    throw new CustodyActionError('Unsupported USDC Circle Earn vault.', 400, 'UNSUPPORTED_VAULT');
  }

  const payoutHandle = normalizeAndValidateHandle(input.payoutHandle || session.x_handle, 'Payout handle');
  const normalizedMembers = normalizeMembersWithQuotas(session.x_handle, input.members || [], targetUsdCents);

  const circleContractId = input.mode === 'escrow' ? null : getCircleContractId(env);
  if (input.mode === 'contract' && !circleContractId) {
    throw new CustodyActionError(
      'On-chain Circle contract is unavailable in this environment.',
      503,
      'CONTRACT_UNAVAILABLE'
    );
  }
  if (!circleContractId) {
    // Escrow fallback when CIRCLE_CONTRACT_ID is unset in an environment
    const circleId = generateSecureId('circ');
    const custody = await deriveEarnCustodyKey(env, circleId);
    const bindings = await Promise.all(normalizedMembers.map((m) => resolveMemberSignerBinding(env, m.handle)));
    const payloadStr = JSON.stringify({
      domain: 'uprail:circle-escrow-create:v1',
      circle_id: circleId,
      creator: creatorAccount,
      vault_asset_id: vault.assetId,
      payout_handle: payoutHandle,
      target_usd_cents: targetUsdCents,
      members: bindings.map((b, i) => ({
        handle: b.handle,
        account_id: b.nearAccount,
        share_bps: normalizedMembers[i].shareBps,
      })),
    });

    const pending = await createPendingCustodyAction({
      env,
      xId: session.x_id,
      actionType: 'CIRCLE_CREATE_AND_AGREE',
      payloadStr,
      meta: {
        contractMode: 'escrow',
        circleId,
        custodyAccount: custody.accountId,
        name,
        purpose,
        note,
        targetUsdCents,
        vaultAssetId: vault.assetId,
        vaultSymbol: vault.symbol,
        vaultDecimals: vault.decimals,
        payoutHandle,
        members: bindings.map((b, i) => ({
          handle: b.handle,
          xId: b.xId,
          pubkey: b.pubkey,
          shareBps: normalizedMembers[i].shareBps,
          quotaUsdCents: normalizedMembers[i].quotaUsdCents,
        })),
      },
      requireOnchainPasskey: true,
      ttlMs: VAULT_ACTION_TTL_MS,
    });
    return { step: 'circle_create' as const, contractMode: 'escrow' as const, circleId, ...pending };
  }

  // On-chain non-custodial Circle on circle.uprail.near: every member + payout account MUST bind cleanly
  const bindings = await Promise.all(normalizedMembers.map((m) => resolveMemberSignerBinding(env, m.handle)));
  const seenPubkeys = new Set<string>();
  const seenAccounts = new Set<string>();
  const contractMembers: ContractCircleMemberInput[] = [];
  let creatorIndex = -1;

  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i];
    if (!b.registered || !b.nearAccount) {
      throw new CustodyActionError(
        `@${b.handle} must sign in to Uprail before joining a non-custodial Circle on ${circleContractId}.`,
        400,
        'MEMBER_NOT_REGISTERED',
        { handle: b.handle }
      );
    }
    if (!b.pubkey) {
      throw new CustodyActionError(
        `@${b.handle} must activate their passkey before joining a non-custodial Circle on ${circleContractId}.`,
        400,
        'MEMBER_PASSKEY_MISSING',
        { handle: b.handle }
      );
    }
    if (seenPubkeys.has(b.pubkey) || seenAccounts.has(b.nearAccount)) {
      throw new CustodyActionError(
        `Member @${b.handle} conflicts with another member account or signing key.`,
        400,
        'DUPLICATE_SIGNER'
      );
    }
    seenPubkeys.add(b.pubkey);
    seenAccounts.add(b.nearAccount);
    if (b.xId === session.x_id) creatorIndex = i;
    contractMembers.push({
      account_id: b.nearAccount,
      pubkey: b.pubkey,
      share_bps: normalizedMembers[i].shareBps,
    });
  }

  if (creatorIndex < 0) {
    throw new CustodyActionError('Creator must belong to Circle members.', 400, 'CREATOR_NOT_IN_MEMBERS');
  }

  const payoutBinding =
    bindings.find((b) => b.handle === payoutHandle) ||
    (await resolveMemberSignerBinding(env, payoutHandle));
  if (!payoutBinding.registered || !payoutBinding.nearAccount) {
    throw new CustodyActionError(
      `Payout recipient @${payoutHandle} must be a registered Uprail user.`,
      400,
      'PAYOUT_RECIPIENT_NOT_REGISTERED'
    );
  }

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

  const circleId = generateSecureId('circ');
  const assetSpec = toIntentsContractAssetSpec(vault.assetId);
  const payoutHandleHash = await hashHandleHex(payoutHandle);

  const payloadStr = canonicalCircleAgreePayload({
    contractId: circleContractId,
    circleId,
    creatorAccountId: creatorAccount,
    payoutAccountId: payoutBinding.nearAccount,
    asset: assetSpec,
    targetAmountAtomic: targetAtomicStr,
    members: contractMembers,
  });

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'CIRCLE_CREATE_AND_AGREE',
    payloadStr,
    meta: {
      contractMode: 'contract',
      circleContractId,
      circleId,
      creatorAccountId: creatorAccount,
      creatorIndex,
      expectedCreatorPubkey: contractMembers[creatorIndex].pubkey,
      payoutHandle,
      payoutAccountId: payoutBinding.nearAccount,
      payoutHandleHash,
      assetSpec,
      targetAmountAtomic: targetAtomicStr,
      targetUsdCents,
      name,
      purpose,
      note,
      vaultAssetId: vault.assetId,
      vaultSymbol: vault.symbol,
      vaultDecimals: vault.decimals,
      contractMembers,
      members: bindings.map((b, i) => ({
        handle: b.handle,
        xId: b.xId,
        pubkey: b.pubkey,
        shareBps: normalizedMembers[i].shareBps,
        quotaUsdCents: normalizedMembers[i].quotaUsdCents,
      })),
    },
    requireOnchainPasskey: true,
    requiredPubkey: contractMembers[creatorIndex].pubkey,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return {
    step: 'circle_create' as const,
    contractMode: 'contract' as const,
    circleId,
    escrowContractId: circleContractId,
    ...pending,
  };
}

export async function submitSelfCustodyCircleCreate(params: {
  env: Env;
  session: Session;
  actionId: string;
  assertion: unknown;
}) {
  const { env, session, actionId, assertion } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const peek = await env.DB.prepare('SELECT meta_json FROM pending_custody_actions WHERE id = ? AND x_id = ?')
    .bind(actionId, session.x_id)
    .first<{ meta_json: string | null }>();
  let requiredPubkey: string | undefined;
  try {
    const parsedMeta = peek?.meta_json ? JSON.parse(peek.meta_json) : null;
    if (parsedMeta?.expectedCreatorPubkey) requiredPubkey = String(parsedMeta.expectedCreatorPubkey);
  } catch { /* ignore */ }

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'CIRCLE_CREATE_AND_AGREE',
    requireOnchainPasskey: true,
    requiredPubkey,
  });
  assertAllowedContractWebAuthnOrigin(env, signedWebAuthn.client_data_json);
  if (
    meta.contractMode === 'contract' &&
    meta.expectedCreatorPubkey &&
    signedWebAuthn.public_key !== meta.expectedCreatorPubkey
  ) {
    throw new CustodyActionError(
      'Creator passkey does not match the signer bound in the Circle contract.',
      403,
      'CREATOR_PUBKEY_MISMATCH'
    );
  }

  const now = Date.now();
  if (meta.contractMode === 'escrow') {
    await env.DB.prepare(
      `INSERT INTO circles (
        id, creator_x_id, creator_handle, name, purpose, note, target_usd_cents,
        vault_asset_id, vault_symbol, vault_decimals, payout_handle, custody_account,
        contract_mode, escrow_contract_id, onchain_circle_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'escrow', NULL, NULL, 'ACTIVE', ?, ?)`
    )
      .bind(
        meta.circleId,
        session.x_id,
        session.x_handle.toLowerCase(),
        meta.name,
        meta.purpose,
        meta.note,
        meta.targetUsdCents,
        meta.vaultAssetId,
        meta.vaultSymbol,
        meta.vaultDecimals,
        meta.payoutHandle,
        meta.custodyAccount,
        now,
        now
      )
      .run();

    for (const m of meta.members) {
      const memId = generateSecureId('cmem');
      const isCreator = m.xId === session.x_id;
      await env.DB.prepare(
        `INSERT INTO circle_members (
          id, circle_id, x_handle, x_id, share_bps, quota_usd_cents,
          p256_pubkey, terms_signed_at, joined_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          memId,
          meta.circleId,
          m.handle,
          m.xId,
          m.shareBps,
          m.quotaUsdCents,
          m.pubkey,
          isCreator ? now : null,
          isCreator ? now : null,
          now
        )
        .run();
    }

    return {
      circleId: meta.circleId,
      status: 'ACTIVE',
      contractMode: 'escrow',
      custodyAccount: meta.custodyAccount,
    };
  }

  const creatorProof = webAuthnToContractProof(signedWebAuthn);
  const res = await createCircleOnchain(env, {
    circle_id: meta.circleId,
    asset: meta.assetSpec,
    members: meta.contractMembers,
    creator_index: meta.creatorIndex,
    payout_account_id: meta.payoutAccountId,
    payout_handle_hash: meta.payoutHandleHash,
    target_amount: meta.targetAmountAtomic,
    creator_proof: creatorProof,
  });

  if (!res.success) {
    throw new CustodyActionError(
      res.error || 'Failed to create Circle on circle.uprail.near',
      502,
      'CONTRACT_CREATE_FAILED'
    );
  }

  const onchain = await getCircleOnchain(env, meta.circleId, meta.circleContractId).catch(() => null);
  const initialStatus = onchain?.status || (meta.contractMembers.length === 1 ? 'ACTIVE' : 'PENDING_SIGNATURES');

  await env.DB.prepare(
    `INSERT INTO circles (
      id, creator_x_id, creator_handle, name, purpose, note, target_usd_cents,
      vault_asset_id, vault_symbol, vault_decimals, payout_handle, custody_account,
      contract_mode, escrow_contract_id, onchain_circle_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'contract', ?, ?, ?, ?, ?)`
  )
    .bind(
      meta.circleId,
      session.x_id,
      session.x_handle.toLowerCase(),
      meta.name,
      meta.purpose,
      meta.note,
      meta.targetUsdCents,
      meta.vaultAssetId,
      meta.vaultSymbol,
      meta.vaultDecimals,
      meta.payoutHandle,
      meta.circleContractId,
      meta.circleContractId,
      meta.circleId,
      initialStatus,
      now,
      now
    )
    .run();

  for (let i = 0; i < meta.members.length; i++) {
    const m = meta.members[i];
    const memId = generateSecureId('cmem');
    const agreedOnchain = Boolean(onchain?.members?.[i]?.agreed ?? i === meta.creatorIndex);
    await env.DB.prepare(
      `INSERT INTO circle_members (
        id, circle_id, x_handle, x_id, share_bps, quota_usd_cents,
        p256_pubkey, terms_signed_at, joined_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        memId,
        meta.circleId,
        m.handle,
        m.xId,
        m.shareBps,
        m.quotaUsdCents,
        m.pubkey,
        agreedOnchain ? now : null,
        agreedOnchain ? now : null,
        now
      )
      .run();
  }

  return {
    circleId: meta.circleId,
    onchainCircleId: meta.circleId,
    escrowContractId: meta.circleContractId,
    contractMode: 'contract',
    status: initialStatus,
    txHash: res.txHash,
  };
}

export async function prepareSelfCustodyCircleJoin(params: {
  env: Env;
  session: Session;
  circleId: string;
}) {
  const { env, session, circleId } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const circle = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(circleId)
    .first<any>();
  if (!circle) throw new CustodyActionError('Circle not found.', 404, 'NOT_FOUND');

  const member = await env.DB.prepare(
    'SELECT * FROM circle_members WHERE circle_id = ? AND (x_id = ? OR LOWER(x_handle) = ?) LIMIT 1'
  )
    .bind(circleId, session.x_id, session.x_handle.toLowerCase())
    .first<any>();
  if (!member) {
    throw new CustodyActionError('You are not an invited member of this Circle.', 403, 'NOT_MEMBER');
  }

  if (circle.contract_mode !== 'contract' || !circle.onchain_circle_id) {
    await env.DB.prepare(
      'UPDATE circle_members SET x_id = COALESCE(x_id, ?), joined_at = COALESCE(joined_at, ?) WHERE id = ?'
    )
      .bind(session.x_id, Date.now(), member.id)
      .run();
    return { alreadyActive: true, contractMode: 'escrow', circleId };
  }

  const contractId = String(circle.escrow_contract_id || getCircleContractId(env) || '').toLowerCase();
  const onchain = await getCircleOnchain(env, circle.onchain_circle_id, contractId);
  if (!onchain) {
    throw new CustodyActionError('On-chain Circle state not found.', 404, 'ONCHAIN_NOT_FOUND');
  }

  const { nearAccount } = await getCurrentSaltAndAccount(env, session);
  const memberIndex = onchain.members.findIndex(
    (m) => m.account_id.toLowerCase() === nearAccount.toLowerCase()
  );
  if (memberIndex < 0) {
    throw new CustodyActionError(
      'Your NEAR account does not match a bound signer slot in this Circle.',
      403,
      'SIGNER_NOT_BOUND'
    );
  }
  if (onchain.members[memberIndex].agreed) {
    await env.DB.prepare(
      'UPDATE circle_members SET x_id = COALESCE(x_id, ?), terms_signed_at = COALESCE(terms_signed_at, ?), joined_at = COALESCE(joined_at, ?) WHERE id = ?'
    )
      .bind(session.x_id, Date.now(), Date.now(), member.id)
      .run();
    await syncContractCircleFromOnchain({
      env,
      circleRow: circle,
      preloadedOnchain: onchain,
    }).catch(() => {});
    return { alreadySigned: true, status: circle.status || onchain.status, circleId };
  }

  const payloadStr = canonicalCircleAgreePayload({
    contractId,
    circleId: circle.onchain_circle_id,
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

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'CIRCLE_JOIN_AND_AGREE',
    payloadStr,
    meta: {
      circleId,
      memberId: member.id,
      contractId,
      onchainCircleId: circle.onchain_circle_id,
      memberIndex,
      expectedPubkey: onchain.members[memberIndex].pubkey,
    },
    requireOnchainPasskey: true,
    requiredPubkey: onchain.members[memberIndex].pubkey,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return {
    step: 'circle_join' as const,
    circleId,
    contractMode: 'contract' as const,
    ...pending,
  };
}

export async function submitSelfCustodyCircleJoin(params: {
  env: Env;
  session: Session;
  circleId: string;
  actionId: string;
  assertion: unknown;
}) {
  const { env, session, circleId, actionId, assertion } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const circle = await env.DB.prepare('SELECT onchain_circle_id, escrow_contract_id FROM circles WHERE id = ? LIMIT 1')
    .bind(circleId)
    .first<any>();
  let expectedPubkey: string | undefined;
  if (circle?.onchain_circle_id) {
    const { nearAccount } = await getCurrentSaltAndAccount(env, session);
    const contractId = String(circle.escrow_contract_id || getCircleContractId(env) || '').toLowerCase();
    const preOnchain = await getCircleOnchain(env, circle.onchain_circle_id, contractId).catch(() => null);
    expectedPubkey = preOnchain?.members.find(
      (m) => m.account_id.toLowerCase() === nearAccount.toLowerCase()
    )?.pubkey;
  }

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<{
    circleId: string;
    memberId: string;
    contractId: string;
    onchainCircleId: string;
    memberIndex: number;
    expectedPubkey: string;
  }>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'CIRCLE_JOIN_AND_AGREE',
    requireOnchainPasskey: true,
    requiredPubkey: expectedPubkey,
  });

  if (meta.circleId !== circleId) {
    throw new CustodyActionError('Circle mismatch on prepared signature', 403, 'CIRCLE_MISMATCH');
  }
  assertAllowedContractWebAuthnOrigin(env, signedWebAuthn.client_data_json);
  if (signedWebAuthn.public_key !== meta.expectedPubkey) {
    throw new CustodyActionError(
      'Signed passkey does not match the bound member key for this Circle.',
      403,
      'MEMBER_PUBKEY_MISMATCH'
    );
  }

  const proof: ContractAuthProof = webAuthnToContractProof(signedWebAuthn);
  const res = await signCircleTermsOnchain(
    env,
    {
      circle_id: meta.onchainCircleId,
      member_index: meta.memberIndex,
      proof,
    },
    meta.contractId
  );
  if (!res.success) {
    throw new CustodyActionError(res.error || 'Failed to record terms signature on-chain', 502, 'CONTRACT_SIGN_FAILED');
  }

  const now = Date.now();
  await env.DB.prepare(
    'UPDATE circle_members SET x_id = COALESCE(x_id, ?), terms_signed_at = ?, joined_at = COALESCE(joined_at, ?) WHERE id = ?'
  )
    .bind(session.x_id, now, now, meta.memberId)
    .run();

  const syncRow: any = {
    id: circleId,
    contract_mode: 'contract',
    onchain_circle_id: meta.onchainCircleId,
    escrow_contract_id: meta.contractId,
    status: 'PENDING_SIGNATURES',
  };
  const onchain = await syncContractCircleFromOnchain({
    env,
    circleRow: syncRow,
    maxRetries: 3,
  }).catch(() => null);

  return {
    circleId,
    agreed: true,
    status: syncRow.status || onchain?.status || 'ACTIVE',
    txHash: res.txHash,
  };
}

export async function prepareSelfCustodyCircleContribute(params: {
  env: Env;
  session: Session;
  circleId: string;
  sourceAsset: string;
  amount: string;
  completedSwapDepositAddress?: string;
}) {
  const { env, session, circleId } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const circle = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(circleId)
    .first<any>();
  if (!circle) throw new CustodyActionError('Circle not found.', 404, 'NOT_FOUND');

  const member = await env.DB.prepare(
    'SELECT * FROM circle_members WHERE circle_id = ? AND (x_id = ? OR LOWER(x_handle) = ?) LIMIT 1'
  )
    .bind(circleId, session.x_id, session.x_handle.toLowerCase())
    .first<any>();
  if (!member) throw new CustodyActionError('You are not a member of this Circle.', 403, 'NOT_MEMBER');

  const { nearAccount, saltHex } = await getCurrentSaltAndAccount(env, session);
  const isContract = circle.contract_mode === 'contract' && Boolean(circle.onchain_circle_id);
  if (isContract) {
    const onchain = await getCircleOnchain(
      env,
      circle.onchain_circle_id,
      circle.escrow_contract_id || getCircleContractId(env) || undefined
    );
    if (!onchain) throw new CustodyActionError('On-chain Circle state missing.', 404, 'ONCHAIN_NOT_FOUND');
    if (onchain.status !== 'ACTIVE') {
      throw new CustodyActionError(
        onchain.status === 'PENDING_SIGNATURES'
          ? 'All Circle members must sign terms before contributing.'
          : `Circle is ${onchain.status} and no longer accepting contributions.`,
        409,
        'CIRCLE_NOT_ACTIVE'
      );
    }
    const slot = onchain.members.find((m) => m.account_id.toLowerCase() === nearAccount.toLowerCase());
    if (!slot || !slot.agreed) {
      throw new CustodyActionError(
        'Your account must agree to Circle terms first.',
        403,
        'TERMS_NOT_AGREED'
      );
    }
  } else if (circle.status !== 'ACTIVE') {
    throw new CustodyActionError(`Circle is ${circle.status}.`, 409, 'CIRCLE_NOT_ACTIVE');
  }

  const vault = await resolveEarnVault(env, circle.vault_asset_id).catch(() => null);
  if (!vault) throw new CustodyActionError('Unsupported Circle vault.', 400, 'UNSUPPORTED_VAULT');

  const oneClickTokens = await getOneClickTokens(env).catch(() => []);
  const origin = await resolveOriginToken(
    env,
    params.sourceAsset || CIRCLE_GIFT_USDC_ASSET_ID,
    oneClickTokens
  );
  if (!isUsdcOriginAsset(origin)) {
    throw new CustodyActionError('Circles only accept USDC deposits.', 400, 'USDC_ONLY');
  }
  const amountStr = String(params.amount || '').trim();
  if (!/^\d{1,15}(\.\d{1,18})?$/.test(amountStr) || Number(amountStr) <= 0) {
    throw new CustodyActionError('Invalid contribution amount.', 400, 'INVALID_AMOUNT');
  }
  const grossAtomic = BigInt(nearRpc.toBaseUnits(amountStr, origin.decimals) || '0');
  if (grossAtomic <= 0n) throw new CustodyActionError('Amount must be greater than zero.', 400, 'INVALID_AMOUNT');

  const resolved = await resolvePreparedVaultSharesForDeposit({
    env,
    session,
    nearAccount,
    vault,
    origin,
    grossAtomic,
    amountStr,
    nextStep: 'circle_contribute',
    completedSwapDepositAddress: params.completedSwapDepositAddress,
    circleId,
    memberId: member.id,
  });
  if (!resolved.ready) {
    return resolved.prepareResponse;
  }

  const depositSharesAtomic = resolved.depositSharesAtomic;
  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const targetReceiver = isContract
    ? String(circle.escrow_contract_id || getCircleContractId(env)!).toLowerCase()
    : String(circle.custody_account);

  const actions: IntentsAction[] = [
    isContract
      ? {
          intent: 'transfer',
          receiver_id: targetReceiver,
          tokens: { [vault.assetId]: depositSharesAtomic.toString() },
          msg: buildContributeCircleMsg(circle.onchain_circle_id),
        }
      : {
          intent: 'transfer',
          receiver_id: targetReceiver,
          tokens: { [vault.assetId]: depositSharesAtomic.toString() },
        },
  ];

  const { payloadStr } = buildIntentsPayloadString({
    signerId: nearAccount,
    verifyingContract: intentsId,
    saltHex,
    intents: actions,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'CIRCLE_CONTRIBUTE_DEPOSIT',
    payloadStr,
    meta: {
      circleId,
      memberId: member.id,
      nearAccount,
      contractMode: isContract ? 'contract' : 'escrow',
      contractId: isContract ? targetReceiver : null,
      onchainCircleId: circle.onchain_circle_id || null,
      vaultAssetId: vault.assetId,
      vaultSymbol: vault.symbol,
      vaultDecimals: vault.decimals,
      sharesAtomic: depositSharesAtomic.toString(),
      usdCents: resolved.principalUsdCents,
      swapActionId: resolved.swapActionId || null,
      sourceAsset: resolved.sourceAsset,
      sourceSymbol: resolved.sourceSymbol,
      sourceDecimals: resolved.sourceDecimals,
      sourceGrossAtomic: resolved.sourceGrossAtomic,
    },
    requireOnchainPasskey: true,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return {
    step: 'circle_contribute' as const,
    circleId,
    contractMode: isContract ? 'contract' : 'escrow',
    sharesFormatted: formatAtomic(depositSharesAtomic.toString(), vault.decimals),
    ...pending,
  };
}

export async function submitSelfCustodyCircleContribute(params: {
  env: Env;
  session: Session;
  circleId: string;
  actionId: string;
  assertion: unknown;
  step?: string;
}) {
  const { env, session, circleId, actionId, assertion } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const peek = await env.DB.prepare('SELECT action_type FROM pending_custody_actions WHERE id = ? AND x_id = ?')
    .bind(actionId, session.x_id)
    .first<{ action_type: string }>();

  if (params.step === 'native_auth' || peek?.action_type === 'AUTHORIZE_NATIVE_L1_KEY') {
    return await submitNativeL1Operation({ env, session, actionId, assertion });
  }

  if (params.step === 'unshield' || peek?.action_type === 'VAULT_UNSHIELD_USDC') {
    return await handleVaultUnshieldSubmit({ env, session, actionId, assertion });
  }

  if (params.step === 'swap_to_vault' || peek?.action_type === 'CIRCLE_CONTRIBUTE_SWAP') {
    const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
      env,
      xId: session.x_id,
      actionId,
      assertion,
      expectedActionType: 'CIRCLE_CONTRIBUTE_SWAP',
      requireOnchainPasskey: true,
    });
    if (meta.circleId !== circleId) {
      throw new CustodyActionError('Circle ID mismatch on swap intent', 403, 'CIRCLE_MISMATCH');
    }
    const balBefore =
      (await nearRpc.getIntentAssetBalance(env, meta.vaultAssetId, meta.nearAccount).catch(() => null))
        ?.balance ?? 0n;
    const submitted = await submitSwapIntent(env, signedWebAuthn);
    return {
      step: 'swap_to_vault' as const,
      circleId,
      depositAddress: meta.depositAddress,
      intentHash: submitted.intentHash,
      vaultAssetId: meta.vaultAssetId,
      vaultSymbol: meta.vaultSymbol,
      vaultDecimals: meta.vaultDecimals,
      balanceBeforeAtomic: balBefore.toString(),
    };
  }

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'CIRCLE_CONTRIBUTE_DEPOSIT',
    requireOnchainPasskey: true,
  });
  if (meta.circleId !== circleId) {
    throw new CustodyActionError('Circle ID mismatch on deposit intent', 403, 'CIRCLE_MISMATCH');
  }

  let beforeCustodyBal = 0n;
  if (meta.contractMode === 'contract') {
    const beforeOnchain = await getCircleOnchain(env, meta.onchainCircleId, meta.contractId).catch(() => null);
    const slot = beforeOnchain?.members.find(
      (m) => m.account_id.toLowerCase() === String(meta.nearAccount).toLowerCase()
    );
    beforeCustodyBal = BigInt(slot?.contributed || '0');
  } else {
    const circleRow = await env.DB.prepare('SELECT custody_account FROM circles WHERE id = ?')
      .bind(circleId)
      .first<{ custody_account: string }>();
    beforeCustodyBal =
      (await getCustodyVaultBalance(env, circleRow?.custody_account || '', meta.vaultAssetId)) ?? 0n;
  }

  const relayed = await nearRpc.executeIntentsBatchRelayed(
    env,
    [signedWebAuthn],
    meta.contractMode === 'contract' ? 160_000_000_000_000n : 100_000_000_000_000n
  );
  if (!relayed.success) {
    throw new CustodyActionError(
      relayed.error || 'Failed to deposit Circle contribution on-chain',
      502,
      'DEPOSIT_FAILED'
    );
  }

  // Reconcile actual delivered amount on-chain (fail closed if mt_on_transfer refunded!)
  let actualDelta = 0n;
  if (meta.contractMode === 'contract') {
    let afterVal = beforeCustodyBal;
    for (let retry = 0; retry < 4; retry++) {
      const afterOnchain = await getCircleOnchain(env, meta.onchainCircleId, meta.contractId).catch(() => null);
      const slot = afterOnchain?.members.find(
        (m) => m.account_id.toLowerCase() === String(meta.nearAccount).toLowerCase()
      );
      afterVal = BigInt(slot?.contributed || '0');
      if (afterVal > beforeCustodyBal) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    if (afterVal <= beforeCustodyBal) {
      throw new CustodyActionError(
        'On-chain Circle contribution was refunded or did not increase your contributed balance.',
        502,
        'CONTRIBUTION_NOT_CREDITED'
      );
    }
    actualDelta = afterVal - beforeCustodyBal;
  } else {
    const circleRow = await env.DB.prepare('SELECT custody_account FROM circles WHERE id = ?')
      .bind(circleId)
      .first<{ custody_account: string }>();
    let afterVal: bigint | null = null;
    for (let retry = 0; retry < 4; retry++) {
      afterVal = await getCustodyVaultBalance(env, circleRow?.custody_account || '', meta.vaultAssetId);
      if (afterVal !== null && afterVal > beforeCustodyBal) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    if (afterVal === null || afterVal <= beforeCustodyBal) {
      throw new CustodyActionError(
        'Escrow Circle contribution did not increase the custody vault balance.',
        502,
        'CONTRIBUTION_NOT_CREDITED'
      );
    }
    actualDelta = afterVal - beforeCustodyBal;
  }

  await markVaultSwapDeposited(env, session.x_id, meta.swapActionId);

  const contribId = generateSecureId('ccon');
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO circle_contributions (
      id, circle_id, member_id, contributor_x_id, source_asset, source_symbol,
      source_decimals, gross_atomic, usd_cents, deposit_address, quoted_shares_atomic,
      balance_before_atomic, shares_atomic, status, intent_hash, expires_at, created_at, updated_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'CONFIRMED', ?, ?, ?, ?, ?)`
  )
    .bind(
      contribId,
      circleId,
      meta.memberId,
      session.x_id,
      meta.sourceAsset || meta.vaultAssetId,
      meta.sourceSymbol || meta.vaultSymbol,
      meta.sourceDecimals ?? meta.vaultDecimals,
      meta.sourceGrossAtomic || actualDelta.toString(),
      meta.usdCents,
      meta.sharesAtomic,
      beforeCustodyBal.toString(),
      actualDelta.toString(),
      relayed.txHash || contribId,
      now + SWAP_QUOTE_TTL_MS,
      now,
      now,
      now
    )
    .run();

  const existingMember = await env.DB.prepare(
    'SELECT shares_atomic, contributed_usd_cents FROM circle_members WHERE id = ?'
  )
    .bind(meta.memberId)
    .first<{ shares_atomic: string; contributed_usd_cents: number }>();

  const nextShares = (BigInt(existingMember?.shares_atomic || '0') + actualDelta).toString();
  const nextUsd = Number(existingMember?.contributed_usd_cents || 0) + Number(meta.usdCents || 0);

  await env.DB.prepare(
    'UPDATE circle_members SET x_id = COALESCE(x_id, ?), shares_atomic = ?, contributed_usd_cents = ?, joined_at = COALESCE(joined_at, ?) WHERE id = ?'
  )
    .bind(session.x_id, nextShares, nextUsd, now, meta.memberId)
    .run();

  await env.DB.prepare('UPDATE circles SET updated_at = ? WHERE id = ?').bind(now, circleId).run();

  return {
    step: 'circle_contribute' as const,
    completed: true,
    circleId,
    contributionId: contribId,
    sharesAtomic: actualDelta.toString(),
    txHash: relayed.txHash,
  };
}

export async function checkCircleContributeSwapStatus(params: {
  env: Env;
  session: Session;
  depositAddress: string;
  vaultAssetId: string;
  balanceBeforeAtomic: string;
}) {
  const { env, session, depositAddress, vaultAssetId, balanceBeforeAtomic } = params;
  const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
  let execStatus = await getExecutionStatus(env, depositAddress).catch(() => null);
  if ((!execStatus || execStatus.status === 'UNKNOWN') && isConfidentialRailEnabled(env)) {
    const ocSession = await getUserSession(env, session.x_id).catch(() => null);
    if (ocSession?.accessToken) {
      execStatus = await getExecutionStatus(
        env,
        depositAddress,
        undefined,
        ocSession.accessToken
      ).catch(() => null);
    }
  }
  const safeExec = execStatus || { status: 'PENDING', swapDetails: undefined, raw: undefined };
  const remote = String(safeExec.status || 'PENDING').toUpperCase();
  if (remote !== 'SUCCESS') {
    return { status: remote, readyToDeposit: false };
  }
  const current =
    (await nearRpc.getIntentAssetBalance(env, vaultAssetId, nearAccount).catch(() => null))?.balance ?? 0n;
  const before = BigInt(balanceBeforeAtomic || '0');
  const delta = current > before ? current - before : BigInt((safeExec.swapDetails as any)?.amountOut || '0');
  const vault = await resolveEarnVault(env, vaultAssetId).catch(() => null);
  return {
    status: 'SUCCESS',
    readyToDeposit: delta > 0n,
    vaultSharesAtomic: delta.toString(),
    vaultSharesFormatted: formatAtomic(delta.toString(), vault?.decimals ?? 18),
  };
}

export async function prepareSelfCustodyCircleSettle(params: {
  env: Env;
  session: Session;
  circleId: string;
}) {
  const { env, session, circleId } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const circle = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(circleId)
    .first<any>();
  if (!circle) throw new CustodyActionError('Circle not found.', 404, 'NOT_FOUND');
  if (circle.creator_x_id !== session.x_id) {
    throw new CustodyActionError('Only the Circle creator can settle and release funds.', 403, 'NOT_CREATOR');
  }
  if (circle.contract_mode !== 'contract' || !circle.onchain_circle_id) {
    throw new CustodyActionError('Non-contract Circles settle via /api/circles/:id/settle.', 400, 'NOT_CONTRACT_CIRCLE');
  }

  const contractId = String(circle.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
  const onchain = await getCircleOnchain(env, circle.onchain_circle_id, contractId);
  if (!onchain) throw new CustodyActionError('On-chain Circle not found.', 404, 'ONCHAIN_NOT_FOUND');

  if (onchain.status === 'SETTLING') {
    // Allow idempotent permissionless settlement retry without re-signing
    return { retryOnly: true, circleId, status: onchain.status };
  }
  if (onchain.status !== 'ACTIVE') {
    throw new CustodyActionError(`Circle cannot be settled while status is ${onchain.status}.`, 409, 'INVALID_STATUS');
  }

  const payloadStr = canonicalCircleSettlePayload({
    contractId,
    circleId: circle.onchain_circle_id,
    payoutAccountId: onchain.payout_account_id,
    totalContributedAtomic: onchain.total_contributed,
  });

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'CIRCLE_SETTLE',
    payloadStr,
    meta: {
      circleId,
      contractId,
      onchainCircleId: circle.onchain_circle_id,
      expectedCreatorPubkey: onchain.members[onchain.creator_index]?.pubkey,
    },
    requireOnchainPasskey: true,
    requiredPubkey: onchain.members[onchain.creator_index]?.pubkey,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return { step: 'circle_settle' as const, circleId, ...pending };
}

export async function submitSelfCustodyCircleSettle(params: {
  env: Env;
  session: Session;
  circleId: string;
  actionId?: string;
  assertion?: unknown;
  retry?: boolean;
}) {
  const { env, session, circleId } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const circle = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(circleId)
    .first<any>();
  if (!circle) throw new CustodyActionError('Circle not found.', 404, 'NOT_FOUND');
  if (circle.creator_x_id !== session.x_id) {
    throw new CustodyActionError('Only the Circle creator can settle.', 403, 'NOT_CREATOR');
  }

  if (params.retry) {
    const contractId = String(circle.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
    const res = await retryCircleSettlementOnchain(env, circle.onchain_circle_id, contractId);
    if (!res.success) throw new CustodyActionError(res.error || 'Settlement retry failed', 502, 'RETRY_FAILED');
    const after = await getCircleOnchain(env, circle.onchain_circle_id, contractId).catch(() => null);
    if (after?.status === 'SETTLED') {
      await env.DB.prepare(
        "UPDATE circles SET status = 'SETTLED', payout_tx_hash = COALESCE(payout_tx_hash, ?), closed_at = ?, updated_at = ? WHERE id = ?"
      )
        .bind(res.txHash || null, Date.now(), Date.now(), circleId)
        .run();
    }
    return { circleId, status: after?.status || 'SETTLING', txHash: res.txHash };
  }

  if (!params.actionId || !params.assertion) {
    throw new CustodyActionError('Missing actionId or WebAuthn assertion.', 400, 'INVALID_REQUEST');
  }

  const contractId = String(circle.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
  const preOnchain = await getCircleOnchain(env, circle.onchain_circle_id, contractId).catch(() => null);
  const expectedCreatorPubkey = preOnchain?.members[preOnchain.creator_index]?.pubkey;

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId: params.actionId,
    assertion: params.assertion,
    expectedActionType: 'CIRCLE_SETTLE',
    requireOnchainPasskey: true,
    requiredPubkey: expectedCreatorPubkey,
  });
  if (meta.circleId !== circleId) {
    throw new CustodyActionError('Circle mismatch on settle action', 403, 'CIRCLE_MISMATCH');
  }
  assertAllowedContractWebAuthnOrigin(env, signedWebAuthn.client_data_json);
  if (meta.expectedCreatorPubkey && signedWebAuthn.public_key !== meta.expectedCreatorPubkey) {
    throw new CustodyActionError('Creator passkey mismatch.', 403, 'CREATOR_PUBKEY_MISMATCH');
  }

  const res = await settleCircleOnchain(
    env,
    {
      circle_id: meta.onchainCircleId,
      creator_proof: webAuthnToContractProof(signedWebAuthn),
    },
    meta.contractId
  );
  if (!res.success) {
    throw new CustodyActionError(res.error || 'Failed to settle Circle on-chain', 502, 'SETTLE_FAILED');
  }

  const onchain = await getCircleOnchain(env, meta.onchainCircleId, meta.contractId).catch(() => null);
  const now = Date.now();
  const nextStatus = onchain?.status || 'SETTLED';
  await env.DB.prepare(
    'UPDATE circles SET status = ?, payout_tx_hash = ?, closed_at = ?, updated_at = ? WHERE id = ?'
  )
    .bind(nextStatus, res.txHash || null, nextStatus === 'SETTLED' ? now : null, now, circleId)
    .run();

  return { circleId, status: nextStatus, txHash: res.txHash };
}

export async function prepareSelfCustodyCircleDissolve(params: {
  env: Env;
  session: Session;
  circleId: string;
}) {
  const { env, session, circleId } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const circle = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(circleId)
    .first<any>();
  if (!circle) throw new CustodyActionError('Circle not found.', 404, 'NOT_FOUND');

  const member = await env.DB.prepare(
    'SELECT * FROM circle_members WHERE circle_id = ? AND (x_id = ? OR LOWER(x_handle) = ?) LIMIT 1'
  )
    .bind(circleId, session.x_id, session.x_handle.toLowerCase())
    .first<any>();
  if (!member) throw new CustodyActionError('Only Circle members may approve dissolve.', 403, 'NOT_MEMBER');
  if (circle.contract_mode !== 'contract' || !circle.onchain_circle_id) {
    throw new CustodyActionError('Escrow Circles dissolve via /api/circles/:id/dissolve.', 400, 'NOT_CONTRACT_CIRCLE');
  }

  const contractId = String(circle.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
  const onchain = await getCircleOnchain(env, circle.onchain_circle_id, contractId);
  if (!onchain) throw new CustodyActionError('On-chain Circle not found.', 404, 'ONCHAIN_NOT_FOUND');

  if (
    onchain.status === 'DISSOLVING' &&
    typeof onchain.dissolve_safeguard_at_ms === 'number' &&
    Date.now() >= onchain.dissolve_safeguard_at_ms
  ) {
    return { canFinalizeSafeguardNow: true, circleId, status: onchain.status };
  }

  const { nearAccount } = await getCurrentSaltAndAccount(env, session);
  const memberIndex = onchain.members.findIndex(
    (m) => m.account_id.toLowerCase() === nearAccount.toLowerCase()
  );
  if (memberIndex < 0) {
    throw new CustodyActionError('Member signer slot not found on-chain.', 403, 'SIGNER_NOT_BOUND');
  }

  const payloadStr = canonicalCircleDissolvePayload({
    contractId,
    circleId: circle.onchain_circle_id,
  });

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'CIRCLE_DISSOLVE',
    payloadStr,
    meta: {
      circleId,
      memberId: member.id,
      contractId,
      onchainCircleId: circle.onchain_circle_id,
      memberIndex,
      expectedPubkey: onchain.members[memberIndex].pubkey,
      currentStatus: onchain.status,
    },
    requireOnchainPasskey: true,
    requiredPubkey: onchain.members[memberIndex].pubkey,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return { step: 'circle_dissolve' as const, circleId, ...pending };
}

export async function submitSelfCustodyCircleDissolve(params: {
  env: Env;
  session: Session;
  circleId: string;
  actionId?: string;
  assertion?: unknown;
  finalizeSafeguard?: boolean;
}) {
  const { env, session, circleId } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const circle = await env.DB.prepare('SELECT * FROM circles WHERE id = ? LIMIT 1')
    .bind(circleId)
    .first<any>();
  if (!circle) throw new CustodyActionError('Circle not found.', 404, 'NOT_FOUND');

  const contractId = String(circle.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
  if (params.finalizeSafeguard) {
    const fin = await finalizeDissolveOnchain(env, { circle_id: circle.onchain_circle_id, sigs: null }, contractId);
    if (!fin.success) {
      throw new CustodyActionError(fin.error || 'Safeguard finalize failed', 502, 'DISSOLVE_FINALIZE_FAILED');
    }
    const after = await getCircleOnchain(env, circle.onchain_circle_id, contractId).catch(() => null);
    const now = Date.now();
    await env.DB.prepare('UPDATE circles SET status = ?, closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE id = ?')
      .bind(after?.status || 'DISSOLVED', after?.status === 'DISSOLVED' ? now : null, now, circleId)
      .run();
    return { circleId, status: after?.status || 'DISSOLVED', txHash: fin.txHash };
  }

  if (!params.actionId || !params.assertion) {
    throw new CustodyActionError('Missing actionId or WebAuthn assertion.', 400, 'INVALID_REQUEST');
  }

  const { nearAccount } = await getCurrentSaltAndAccount(env, session);
  const preOnchain = await getCircleOnchain(env, circle.onchain_circle_id, contractId).catch(() => null);
  const expectedPubkey = preOnchain?.members.find(
    (m) => m.account_id.toLowerCase() === nearAccount.toLowerCase()
  )?.pubkey;

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId: params.actionId,
    assertion: params.assertion,
    expectedActionType: 'CIRCLE_DISSOLVE',
    requireOnchainPasskey: true,
    requiredPubkey: expectedPubkey,
  });
  if (meta.circleId !== circleId) {
    throw new CustodyActionError('Circle mismatch on dissolve action', 403, 'CIRCLE_MISMATCH');
  }
  assertAllowedContractWebAuthnOrigin(env, signedWebAuthn.client_data_json);
  if (signedWebAuthn.public_key !== meta.expectedPubkey) {
    throw new CustodyActionError('Member passkey mismatch.', 403, 'MEMBER_PUBKEY_MISMATCH');
  }

  const proof = webAuthnToContractProof(signedWebAuthn);
  const currentOnchain = await getCircleOnchain(env, meta.onchainCircleId, contractId);
  if (!currentOnchain) throw new CustodyActionError('On-chain Circle missing.', 404, 'ONCHAIN_NOT_FOUND');

  let lastTxHash: string | undefined;
  if (currentOnchain.status === 'ACTIVE' || currentOnchain.status === 'PENDING_SIGNATURES') {
    const init = await initiateDissolveOnchain(
      env,
      { circle_id: meta.onchainCircleId, member_index: meta.memberIndex, proof },
      contractId
    );
    if (!init.success) throw new CustodyActionError(init.error || 'Initiate dissolve failed', 502, 'DISSOLVE_FAILED');
    lastTxHash = init.txHash;
  } else if (currentOnchain.status === 'DISSOLVING') {
    const sig = await signDissolveOnchain(
      env,
      { circle_id: meta.onchainCircleId, member_index: meta.memberIndex, proof },
      contractId
    );
    if (!sig.success) throw new CustodyActionError(sig.error || 'Sign dissolve failed', 502, 'DISSOLVE_SIGN_FAILED');
    lastTxHash = sig.txHash;
  }

  const refreshed = await getCircleOnchain(env, meta.onchainCircleId, contractId).catch(() => null);
  const now = Date.now();
  await env.DB.prepare('UPDATE circle_members SET dissolve_signed_at = COALESCE(dissolve_signed_at, ?) WHERE id = ?')
    .bind(now, meta.memberId)
    .run();

  let finalStatus = refreshed?.status || 'DISSOLVING';
  const allContributorsSigned =
    refreshed &&
    refreshed.status === 'DISSOLVING' &&
    refreshed.members.every((m) => BigInt(m.contributed || '0') === 0n || m.dissolve_signed);

  if (allContributorsSigned) {
    const fin = await finalizeDissolveOnchain(
      env,
      { circle_id: meta.onchainCircleId, sigs: null },
      contractId
    );
    if (fin.success) {
      lastTxHash = fin.txHash || lastTxHash;
      const post = await getCircleOnchain(env, meta.onchainCircleId, contractId).catch(() => null);
      finalStatus = post?.status || 'DISSOLVED';
    }
  }

  await env.DB.prepare(
    `UPDATE circles
     SET status = ?,
         dissolve_initiated_at = COALESCE(dissolve_initiated_at, ?),
         dissolve_deadline_at = COALESCE(dissolve_deadline_at, ?),
         closed_at = CASE WHEN ? = 'DISSOLVED' THEN COALESCE(closed_at, ?) ELSE closed_at END,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(
      finalStatus,
      refreshed?.dissolve_started_at_ms || now,
      refreshed?.dissolve_safeguard_at_ms || now + 7 * 86400 * 1000,
      finalStatus,
      now,
      now,
      circleId
    )
    .run();

  return { circleId, status: finalStatus, txHash: lastTxHash };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GIFTS: CREATE / CLAIM / RECLAIM (Dual-Mode: `contract` AND `escrow` passthrough)
// ═══════════════════════════════════════════════════════════════════════════════

export async function prepareSelfCustodyGiftCreate(params: {
  env: Env;
  session: Session;
  input: {
    recipientHandle: string;
    vaultAsset?: string;
    sourceAsset: string;
    amount: string;
    timelockUntil: number;
    occasion?: string;
    message?: string;
    showAmount?: boolean;
    mode?: 'contract' | 'escrow';
    completedSwapDepositAddress?: string;
  };
}) {
  const { env, session, input } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const { nearAccount, saltHex } = await getCurrentSaltAndAccount(env, session);
  const recipientHandle = normalizeAndValidateHandle(input.recipientHandle, 'Recipient handle');
  const vault = await resolveEarnVault(env, input.vaultAsset || 'TLO').catch(() => null);
  if (!vault) throw new CustodyActionError('Unsupported Earn vault.', 400, 'UNSUPPORTED_VAULT');

  const timelockUntil = Math.round(Number(input.timelockUntil));
  if (!Number.isFinite(timelockUntil) || timelockUntil <= Date.now()) {
    throw new CustodyActionError('Gift unlock time must be in the future.', 400, 'INVALID_TIMELOCK');
  }

  const oneClickTokens = await getOneClickTokens(env).catch(() => []);
  const origin = await resolveOriginToken(env, input.sourceAsset || CIRCLE_GIFT_USDC_ASSET_ID, oneClickTokens);
  if (!isUsdcOriginAsset(origin)) {
    throw new CustodyActionError('Vault Gifts only accept USDC deposits.', 400, 'USDC_ONLY');
  }
  const amountStr = String(input.amount || '').trim();
  if (!/^\d{1,15}(\.\d{1,18})?$/.test(amountStr) || Number(amountStr) <= 0) {
    throw new CustodyActionError('Invalid gift amount.', 400, 'INVALID_AMOUNT');
  }
  const grossAtomic = BigInt(nearRpc.toBaseUnits(amountStr, origin.decimals) || '0');
  if (grossAtomic <= 0n) throw new CustodyActionError('Amount must be greater than zero.', 400, 'INVALID_AMOUNT');

  const resolved = await resolvePreparedVaultSharesForDeposit({
    env,
    session,
    nearAccount,
    vault,
    origin,
    grossAtomic,
    amountStr,
    nextStep: 'gift_create',
    completedSwapDepositAddress: input.completedSwapDepositAddress,
  });
  if (!resolved.ready) {
    return resolved.prepareResponse;
  }

  const contractEnabled = isCircleContractEnabled(env) && Boolean(getAttestorPublicKey(env));
  if (input.mode === 'contract' && !contractEnabled) {
    throw new CustodyActionError(
      'On-chain Gift contract is unavailable in this environment.',
      503,
      'CONTRACT_UNAVAILABLE'
    );
  }
  const useContract = input.mode !== 'escrow' && contractEnabled;
  const giftId = generateSecureId('gft');
  const shareSplit = computeStabilizeSplit(resolved.depositSharesAtomic, vault.decimals, env.FEE_PERCENT);
  const feeRecipient = env.FEE_ACCOUNT_ID || env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const occasion = sanitizeUserText(input.occasion || 'just_because', 32) || 'just_because';
  const message = sanitizeUserText(input.message, 280) || null;
  const showAmount = Boolean(input.showAmount);
  const principalUsdCents = estimateVaultPrincipalUsdCents(
    shareSplit.netInputAtomic,
    vault.decimals,
    vault.priceUsd,
    amountStr
  );

  let recipientXId: string | null = null;
  const recRow = await env.DB.prepare('SELECT x_id FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1')
    .bind(recipientHandle)
    .first<{ x_id: string }>();
  if (recRow?.x_id) recipientXId = recRow.x_id;

  const pkRow = await env.DB.prepare(
    `SELECT near_p256_pubkey FROM passkeys
     WHERE x_id = ? AND near_p256_pubkey IS NOT NULL AND onchain_added_at IS NOT NULL
     ORDER BY onchain_added_at ASC LIMIT 1`
  )
    .bind(session.x_id)
    .first<{ near_p256_pubkey: string }>();
  if (!pkRow?.near_p256_pubkey) {
    throw new CustodyActionError('On-chain P-256 passkey required to fund Gift.', 400, 'PASSKEY_REQUIRED');
  }

  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
  let actions: IntentsAction[];
  let custodyAccount: string;
  let escrowContractId: string | null = null;
  const reclaimAfterMs = timelockUntil + GIFT_RECLAIM_GRACE_MS;

  if (useContract) {
    escrowContractId = getCircleContractId(env)!;
    custodyAccount = escrowContractId;
    const recipientHandleHash = await hashHandleHex(recipientHandle);
    // Keep recipient_pubkey null so recipient retains handle-attestation recoverability across long timelocks
    const msg = buildCreateAndFundGiftMsg({
      giftId,
      senderPubkey: pkRow.near_p256_pubkey,
      recipientHandleHash,
      recipientPubkey: null,
      unlockAtMs: timelockUntil,
      reclaimAfterMs,
    });
    actions = [
      {
        intent: 'transfer',
        receiver_id: escrowContractId,
        tokens: { [vault.assetId]: shareSplit.netInputAtomic.toString() },
        msg,
      },
      ...(shareSplit.feeAtomic > 0n
        ? [
            {
              intent: 'transfer' as const,
              receiver_id: feeRecipient,
              tokens: { [vault.assetId]: shareSplit.feeAtomic.toString() },
            },
          ]
        : []),
    ];
  } else {
    // Escrow passthrough mode: per-gift implicit custody account controlled for escrow release
    const giftCustody = await deriveEarnCustodyKey(env, giftId);
    custodyAccount = giftCustody.accountId;
    actions = [
      {
        intent: 'transfer',
        receiver_id: custodyAccount,
        tokens: { [vault.assetId]: shareSplit.netInputAtomic.toString() },
      },
      ...(shareSplit.feeAtomic > 0n
        ? [
            {
              intent: 'transfer' as const,
              receiver_id: feeRecipient,
              tokens: { [vault.assetId]: shareSplit.feeAtomic.toString() },
            },
          ]
        : []),
    ];
  }

  const { payloadStr } = buildIntentsPayloadString({
    signerId: nearAccount,
    verifyingContract: intentsId,
    saltHex,
    intents: actions,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'GIFT_CREATE_DEPOSIT',
    payloadStr,
    meta: {
      giftId,
      contractMode: useContract ? 'contract' : 'escrow',
      escrowContractId,
      custodyAccount,
      nearAccount,
      senderPubkey: pkRow.near_p256_pubkey,
      recipientHandle,
      recipientXId,
      occasion,
      message,
      showAmount,
      vaultAssetId: vault.assetId,
      vaultSymbol: vault.symbol,
      vaultDecimals: vault.decimals,
      grossAtomic: resolved.sourceGrossAtomic,
      sourceAsset: resolved.sourceAsset,
      sourceSymbol: resolved.sourceSymbol,
      sourceDecimals: resolved.sourceDecimals,
      swapActionId: resolved.swapActionId || null,
      netSharesAtomic: shareSplit.netInputAtomic.toString(),
      feeSharesAtomic: shareSplit.feeAtomic.toString(),
      principalUsdCents,
      timelockUntil,
      reclaimAfterMs,
    },
    requireOnchainPasskey: true,
    requiredPubkey: useContract ? pkRow.near_p256_pubkey : undefined,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return {
    step: 'gift_create' as const,
    giftId,
    contractMode: useContract ? ('contract' as const) : ('escrow' as const),
    escrowContractId,
    ...pending,
  };
}

export async function submitSelfCustodyGiftCreate(params: {
  env: Env;
  session: Session;
  actionId: string;
  assertion: unknown;
  step?: string;
}) {
  const { env, session, actionId, assertion } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const peek = await env.DB.prepare('SELECT action_type FROM pending_custody_actions WHERE id = ? AND x_id = ?')
    .bind(actionId, session.x_id)
    .first<{ action_type: string }>();

  if (params.step === 'native_auth' || peek?.action_type === 'AUTHORIZE_NATIVE_L1_KEY') {
    return await submitNativeL1Operation({ env, session, actionId, assertion });
  }

  if (params.step === 'unshield' || peek?.action_type === 'VAULT_UNSHIELD_USDC') {
    return await handleVaultUnshieldSubmit({ env, session, actionId, assertion });
  }

  if (params.step === 'swap_to_vault' || peek?.action_type === 'GIFT_CREATE_SWAP') {
    const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
      env,
      xId: session.x_id,
      actionId,
      assertion,
      expectedActionType: 'GIFT_CREATE_SWAP',
      requireOnchainPasskey: true,
    });
    const beforeBal =
      (await nearRpc.getIntentAssetBalance(env, meta.vaultAssetId, meta.nearAccount).catch(() => null))
        ?.balance ?? 0n;
    const submitted = await submitSwapIntent(env, signedWebAuthn);
    return {
      step: 'swap_to_vault' as const,
      depositAddress: meta.depositAddress,
      intentHash: submitted.intentHash,
      vaultAssetId: meta.vaultAssetId,
      vaultSymbol: meta.vaultSymbol,
      vaultDecimals: meta.vaultDecimals,
      balanceBeforeAtomic: beforeBal.toString(),
    };
  }

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'GIFT_CREATE_DEPOSIT',
    requireOnchainPasskey: true,
  });
  if (meta.contractMode === 'contract' && meta.senderPubkey && signedWebAuthn.public_key !== meta.senderPubkey) {
    throw new CustodyActionError(
      'Gift creation must be signed with the passkey bound as sender key.',
      403,
      'SENDER_PUBKEY_MISMATCH'
    );
  }

  const beforeEscrowBal =
    meta.contractMode === 'escrow'
      ? (await getCustodyVaultBalance(env, meta.custodyAccount, meta.vaultAssetId)) ?? 0n
      : 0n;

  const relayed = await nearRpc.executeIntentsBatchRelayed(
    env,
    [signedWebAuthn],
    meta.contractMode === 'contract' ? 160_000_000_000_000n : 100_000_000_000_000n
  );
  if (!relayed.success) {
    throw new CustodyActionError(relayed.error || 'Failed to fund Gift on-chain', 502, 'GIFT_FUND_FAILED');
  }

  let actualNetShares = BigInt(meta.netSharesAtomic);
  if (meta.contractMode === 'contract') {
    let onchainGift = await getGiftOnchain(env, meta.giftId, meta.escrowContractId).catch(() => null);
    for (let retry = 0; (!onchainGift || onchainGift.status !== 'LOCKED') && retry < 3; retry++) {
      await new Promise((r) => setTimeout(r, 400));
      onchainGift = await getGiftOnchain(env, meta.giftId, meta.escrowContractId).catch(() => null);
    }
    if (!onchainGift || onchainGift.status !== 'LOCKED') {
      throw new CustodyActionError(
        'On-chain Gift deposit was refunded or did not lock cleanly.',
        502,
        'GIFT_LOCK_UNCONFIRMED'
      );
    }
    actualNetShares = BigInt(onchainGift.amount || meta.netSharesAtomic);
  } else {
    let afterEscrowBal = await getCustodyVaultBalance(env, meta.custodyAccount, meta.vaultAssetId);
    for (let retry = 0; (afterEscrowBal === null || afterEscrowBal <= beforeEscrowBal) && retry < 3; retry++) {
      await new Promise((r) => setTimeout(r, 400));
      afterEscrowBal = await getCustodyVaultBalance(env, meta.custodyAccount, meta.vaultAssetId);
    }
    if (afterEscrowBal === null || afterEscrowBal <= beforeEscrowBal) {
      throw new CustodyActionError(
        'Gift escrow deposit was refunded or did not arrive in custody.',
        502,
        'GIFT_ESCROW_UNCONFIRMED'
      );
    }
    actualNetShares = afterEscrowBal - beforeEscrowBal;
  }

  await markVaultSwapDeposited(env, session.x_id, meta.swapActionId);

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO gifts (
      id, sender_x_id, sender_handle, recipient_handle, recipient_x_id,
      occasion, message, show_amount, vault_asset_id, vault_symbol, vault_decimals,
      source_asset, source_symbol, source_decimals, gross_atomic, principal_usd_cents,
      custody_account, contract_mode, escrow_contract_id, onchain_gift_id,
      deposit_address, deposit_memo, quoted_shares_atomic, balance_before_atomic,
      shares_atomic, fee_shares_atomic, fee_status, fee_tx_hash,
      timelock_until, status, intent_hash, claim_tx_hash,
      expires_at, created_at, updated_at, funded_at, claimed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'LOCKED', ?, NULL, ?, ?, ?, ?, NULL)`
  )
    .bind(
      meta.giftId,
      session.x_id,
      session.x_handle.toLowerCase(),
      meta.recipientHandle,
      meta.recipientXId,
      meta.occasion,
      meta.message,
      meta.showAmount ? 1 : 0,
      meta.vaultAssetId,
      meta.vaultSymbol,
      meta.vaultDecimals,
      meta.sourceAsset || meta.vaultAssetId,
      meta.sourceSymbol || meta.vaultSymbol,
      meta.sourceDecimals ?? meta.vaultDecimals,
      meta.grossAtomic,
      meta.principalUsdCents,
      meta.custodyAccount,
      meta.contractMode,
      meta.escrowContractId,
      meta.contractMode === 'contract' ? meta.giftId : null,
      actualNetShares.toString(),
      beforeEscrowBal.toString(),
      actualNetShares.toString(),
      meta.feeSharesAtomic,
      BigInt(meta.feeSharesAtomic) > 0n ? 'PAID' : 'NONE',
      relayed.txHash || null,
      meta.timelockUntil,
      relayed.txHash || meta.giftId,
      meta.reclaimAfterMs,
      now,
      now,
      now
    )
    .run();

  return {
    step: 'gift_create' as const,
    completed: true,
    giftId: meta.giftId,
    contractMode: meta.contractMode,
    escrowContractId: meta.escrowContractId,
    status: 'LOCKED',
    txHash: relayed.txHash,
  };
}

export async function checkGiftCreateSwapStatus(params: {
  env: Env;
  session: Session;
  depositAddress: string;
  vaultAssetId: string;
  balanceBeforeAtomic: string;
}) {
  return await checkCircleContributeSwapStatus(params);
}

export async function prepareSelfCustodyGiftClaim(params: {
  env: Env;
  session: Session;
  giftId: string;
}) {
  const { env, session, giftId } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const row = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
    .bind(giftId)
    .first<any>();
  if (!row) throw new CustodyActionError('Gift not found.', 404, 'NOT_FOUND');

  if (row.recipient_x_id && row.recipient_x_id !== session.x_id) {
    throw new CustodyActionError('This Gift belongs to a different recipient.', 403, 'FORBIDDEN');
  }
  if (!row.recipient_x_id && String(row.recipient_handle || '').toLowerCase() !== session.x_handle.toLowerCase()) {
    throw new CustodyActionError(`This Gift is for @${row.recipient_handle}.`, 403, 'FORBIDDEN');
  }
  if (row.status !== 'LOCKED') {
    throw new CustodyActionError(`Gift is already ${row.status}.`, 409, 'INVALID_STATUS');
  }
  if (Date.now() < Number(row.timelock_until)) {
    throw new CustodyActionError('This Gift is still timelocked.', 409, 'TIMELOCK_ACTIVE');
  }

  const { nearAccount } = await getCurrentSaltAndAccount(env, session);
  let requiredPubkey: string | undefined;
  if (row.contract_mode === 'contract' && row.onchain_gift_id) {
    const onchain = await getGiftOnchain(
      env,
      row.onchain_gift_id,
      String(row.escrow_contract_id || getCircleContractId(env)!).toLowerCase()
    );
    if (!onchain || onchain.status !== 'LOCKED') {
      throw new CustodyActionError('On-chain Gift is no longer claimable.', 409, 'ONCHAIN_NOT_LOCKED');
    }
    if (onchain.recipient_pubkey) requiredPubkey = onchain.recipient_pubkey;
  }

  const payloadStr =
    row.contract_mode === 'contract' && row.onchain_gift_id
      ? canonicalGiftRecipientPayload({
          contractId: String(row.escrow_contract_id || getCircleContractId(env)!).toLowerCase(),
          giftId: row.onchain_gift_id,
          recipientAccountId: nearAccount,
        })
      : JSON.stringify({
          domain: 'uprail:gift-escrow-claim:v1',
          gift_id: giftId,
          recipient_account_id: nearAccount,
          nonce: crypto.randomUUID(),
        });

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'GIFT_CLAIM_SELF',
    payloadStr,
    meta: {
      giftId,
      contractMode: row.contract_mode === 'contract' ? 'contract' : 'escrow',
      escrowContractId: row.escrow_contract_id || null,
      onchainGiftId: row.onchain_gift_id || null,
      recipientHandle: row.recipient_handle,
      recipientNearAccount: nearAccount,
      vaultAssetId: row.vault_asset_id,
      sharesAtomic: row.shares_atomic || row.quoted_shares_atomic || '0',
    },
    requireOnchainPasskey: true,
    requiredPubkey,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return {
    step: 'gift_claim' as const,
    giftId,
    contractMode: row.contract_mode === 'contract' ? 'contract' : 'escrow',
    ...pending,
  };
}

async function prepareClaimedGiftUsdcSwap(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  giftId: string;
  vaultAssetId: string;
  claimedAtomic: bigint;
  userAccessToken?: string | null;
}) {
  const { env, session, nearAccount, giftId, vaultAssetId, claimedAtomic, userAccessToken } = params;
  const quote = await requestExactVaultToUsdcQuote({
    env,
    xId: session.x_id,
    nearAccount,
    vaultAssetId,
    amountAtomic: claimedAtomic,
    userAccessToken,
  });
  if (!quote.ok) return null;

  const depositAddress = quote.liveQuote.quote.depositAddress;
  const generated = await generateSwapIntent(env, {
    depositAddress,
    signerId: nearAccount,
    standard: 'webauthn',
  });
  validateGeneratedIntentForAccount(env, generated, nearAccount);
  const payloadStr = generated.rawPayload || generated.payload.message;

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'GIFT_CLAIM_SWAP_USDC',
    payloadStr,
    meta: {
      giftId,
      nearAccount,
      depositAddress,
      isConfidentialSwap: quote.isConfidentialSwap,
      needsPostSwapShield: quote.needsPostSwapShield,
      sourceAsset: vaultAssetId,
      amountInAtomic: claimedAtomic.toString(),
      targetAsset: quote.targetAssetId,
      amountOut: quote.amountOutFormatted,
      amountOutAtomic: quote.amountOutAtomic,
      timeEstimateSeconds: quote.timeEstimateSeconds,
    },
    requireOnchainPasskey: true,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return {
    step: 'gift_claim_swap' as const,
    giftId,
    depositAddress,
    expectedUsdcOut: quote.amountOutFormatted,
    isConfidentialSwap: quote.isConfidentialSwap,
    needsPostSwapShield: quote.needsPostSwapShield,
    timeEstimateSeconds: quote.timeEstimateSeconds,
    ...pending,
  };
}

export async function prepareSelfCustodyGiftClaimSwap(params: {
  env: Env;
  session: Session;
  giftId: string;
}) {
  const { env, session, giftId } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');
  if (!isConfidentialRailEnabled(env)) {
    throw new CustodyActionError('Confidential Intents rail is required.', 503, 'CONFIDENTIAL_RAIL_DISABLED');
  }
  const row = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
    .bind(giftId)
    .first<any>();
  if (!row || row.status !== 'CLAIMED' || row.recipient_x_id !== session.x_id) {
    throw new CustodyActionError('Claimed gift not found for USDC swap.', 404, 'GIFT_NOT_FOUND');
  }
  const { nearAccount } = await getCurrentSaltAndAccount(env, session);
  let ocSession;
  try {
    ocSession = await getUserSession(env, session.x_id);
  } catch (err) {
    if (err instanceof OneClickSelfCustodyAuthRequiredError) {
      const oneClickPrepare = await prepareOneClickWebAuthnSession(env, session.x_id, session.x_handle);
      throw new CustodyActionError(
        'Passkey signature needed to unlock your 1Click Confidential session.',
        401,
        'ONECLICK_AUTH_REQUIRED',
        { oneClickPrepare }
      );
    }
    throw err;
  }
  const claimedAtomic = BigInt(row.shares_atomic || row.quoted_shares_atomic || '0');
  const prep = await prepareClaimedGiftUsdcSwap({
    env,
    session,
    nearAccount,
    giftId,
    vaultAssetId: row.vault_asset_id,
    claimedAtomic,
    userAccessToken: ocSession.accessToken,
  });
  return prep || { skipped: true };
}

export async function submitSelfCustodyGiftClaim(params: {
  env: Env;
  session: Session;
  giftId: string;
  actionId: string;
  assertion: unknown;
}) {
  const { env, session, giftId, actionId, assertion } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'GIFT_CLAIM_SELF',
    requireOnchainPasskey: true,
  });
  if (meta.giftId !== giftId) {
    throw new CustodyActionError('Gift mismatch on claim confirmation', 403, 'GIFT_MISMATCH');
  }
  assertAllowedContractWebAuthnOrigin(env, signedWebAuthn.client_data_json);

  // Atomic claim lock preventing concurrent double-claim races
  const now = Date.now();
  const lock = await env.DB.prepare(
    "UPDATE gifts SET status = 'CLAIMING', updated_at = ? WHERE id = ? AND status = 'LOCKED'"
  )
    .bind(now, giftId)
    .run();
  if ((lock.meta?.changes ?? 0) === 0) {
    throw new CustodyActionError('Gift is already being claimed or already claimed.', 409, 'CONFLICT');
  }

  const releaseLock = async () => {
    await env.DB!.prepare(
      "UPDATE gifts SET status = 'LOCKED', updated_at = ? WHERE id = ? AND status = 'CLAIMING'"
    )
      .bind(Date.now(), giftId)
      .run()
      .catch(() => {});
  };

  try {
    let txHash: string | undefined;
    let claimedAtomic = BigInt(meta.sharesAtomic || '0');
    if (meta.contractMode === 'contract' && meta.onchainGiftId) {
      const contractId = String(meta.escrowContractId || getCircleContractId(env)!).toLowerCase();
      const onchain = await getGiftOnchain(env, meta.onchainGiftId, contractId);
      if (!onchain || onchain.status !== 'LOCKED') {
        throw new CustodyActionError('On-chain Gift is no longer claimable.', 409, 'ONCHAIN_NOT_LOCKED');
      }
      claimedAtomic = BigInt(onchain.amount || meta.sharesAtomic || '0');
      const deadlineMs = Date.now() + 5 * 60 * 1000;
      const attestPayload = canonicalGiftClaimPayload({
        contractId,
        giftId: meta.onchainGiftId,
        recipientHandleHash: await hashHandleHex(meta.recipientHandle),
        recipientAccountId: meta.recipientNearAccount,
        deadlineMs,
      });
      const attestSig = signHandleAttestation(env, attestPayload);
      const res = await claimGiftOnchain(
        env,
        {
          gift_id: meta.onchainGiftId,
          recipient_account_id: meta.recipientNearAccount,
          attestor_deadline_ms: deadlineMs,
          attestor_sig: attestSig,
          recipient_proof: onchain.recipient_pubkey ? webAuthnToContractProof(signedWebAuthn) : null,
        },
        contractId
      );
      if (!res.success || !res.txHash) {
        throw new CustodyActionError(res.error || 'Contract gift claim failed', 502, 'CLAIM_FAILED');
      }
      txHash = res.txHash;
    } else {
      // Escrow passthrough: transfer live custody shares directly into recipient's Intents wallet
      const giftRow = await env.DB.prepare('SELECT custody_account FROM gifts WHERE id = ?')
        .bind(giftId)
        .first<{ custody_account: string }>();
      const custodyAcct = giftRow?.custody_account || '';
      const liveBal = await getCustodyVaultBalance(env, custodyAcct, meta.vaultAssetId);
      const sendAtomic =
        liveBal !== null && liveBal > 0n ? liveBal : BigInt(meta.sharesAtomic || '0');
      if (sendAtomic <= 0n) {
        throw new CustodyActionError('Gift escrow custody balance is empty.', 409, 'EMPTY_CUSTODY');
      }
      claimedAtomic = sendAtomic;
      const res = await transferFromEarnCustody(
        env,
        giftId,
        meta.recipientNearAccount,
        meta.vaultAssetId,
        sendAtomic
      );
      if (!res.success || !res.txHash) {
        throw new CustodyActionError(res.error || 'Escrow gift transfer failed', 502, 'CLAIM_FAILED');
      }
      txHash = res.txHash;
    }

    const finTime = Date.now();
    await env.DB.prepare(
      "UPDATE gifts SET status = 'CLAIMED', recipient_x_id = COALESCE(recipient_x_id, ?), shares_atomic = ?, claim_tx_hash = ?, claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'CLAIMING'"
    )
      .bind(session.x_id, claimedAtomic.toString(), txHash || null, finTime, finTime, giftId)
      .run();

    // Never swap into public balance silently: ensure Confidential Intents session first,
    // then prepare the 0%-fee conversion into Confidential USDC (with post-swap shield if intermediate).
    let usdcSwapPrepare: any = null;
    let oneClickPrepare: any = null;
    let needsOneClickAuthForUsdc = false;
    if (claimedAtomic > 0n && isConfidentialRailEnabled(env)) {
      const ocSession = await getUserSession(env, session.x_id).catch(() => null);
      if (ocSession?.accessToken) {
        usdcSwapPrepare = await prepareClaimedGiftUsdcSwap({
          env,
          session,
          nearAccount: meta.recipientNearAccount,
          giftId,
          vaultAssetId: meta.vaultAssetId,
          claimedAtomic,
          userAccessToken: ocSession.accessToken,
        }).catch(() => null);
      } else {
        oneClickPrepare = await prepareOneClickWebAuthnSession(
          env,
          session.x_id,
          session.x_handle
        ).catch(() => null);
        if (oneClickPrepare) needsOneClickAuthForUsdc = true;
      }
    }

    return {
      giftId,
      status: 'CLAIMED',
      txHash,
      sharesClaimedAtomic: claimedAtomic.toString(),
      ...(usdcSwapPrepare ? { usdcSwapPrepare } : {}),
      ...(needsOneClickAuthForUsdc ? { needsOneClickAuthForUsdc, oneClickPrepare } : {}),
    };
  } catch (err) {
    await releaseLock();
    if (err instanceof CustodyActionError) throw err;
    throw new CustodyActionError(publicErrorMessage(err, 'Failed to claim Gift'), 502, 'CLAIM_FAILED');
  }
}

export async function submitSelfCustodyGiftClaimSwap(params: {
  env: Env;
  session: Session;
  giftId: string;
  actionId: string;
  assertion: unknown;
}) {
  const { env, session, giftId, actionId, assertion } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'GIFT_CLAIM_SWAP_USDC',
    requireOnchainPasskey: true,
  });
  if (meta.giftId !== giftId) {
    throw new CustodyActionError('Gift mismatch on USDC swap confirmation', 403, 'GIFT_MISMATCH');
  }

  const isConfidentialSwap = meta.isConfidentialSwap === true;
  const needsPostSwapShield = meta.needsPostSwapShield === true || !isConfidentialSwap;
  const submitted = await submitSwapIntent(env, signedWebAuthn);
  const settlement = await waitForSettlement(env, session.x_id, meta.depositAddress, {
    timeoutMs: needsPostSwapShield ? 12_000 : 4_000,
    intervalMs: 1_000,
    allowPublic: !isConfidentialSwap,
  }).catch(() => ({ status: 'PENDING' }));

  const swapStatus = String(settlement.status || 'PENDING').toUpperCase();
  if (swapStatus === 'FAILED' || swapStatus === 'REFUNDED') {
    throw new CustodyActionError(
      `1Click reported USDC conversion as ${swapStatus.toLowerCase()}. Your claimed vault shares stay safely in your wallet.`,
      502,
      'SWAP_SETTLEMENT_FAILED'
    );
  }

  const nowMs = Date.now();
  const isCompleted = swapStatus === 'SUCCESS';
  await env.DB.prepare(
    `INSERT INTO withdrawals (
      id, x_id, x_handle, asset, amount, destination_address, destination_chain,
      status, tx_hash, deposit_address, privacy_rail, settlement_status,
      created_at, updated_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'near', ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      `gstab_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
      session.x_id,
      session.x_handle,
      meta.sourceAsset,
      String(meta.amountInAtomic || '0'),
      `gift_claim:USDC:${meta.amountOut}`,
      isCompleted ? 'COMPLETED' : 'PENDING',
      submitted.intentHash || meta.depositAddress,
      meta.depositAddress,
      isConfidentialSwap ? 'confidential' : 'public',
      swapStatus,
      nowMs,
      nowMs,
      isCompleted ? nowMs : null
    )
    .run()
    .catch(() => {});

  const shieldPrepare =
    needsPostSwapShield && isCompleted && isConfidentialRailEnabled(env)
      ? await prepareSelfCustodyShieldTarget({
          env,
          session,
          assetId: meta.targetAsset,
          expectedAmountAtomic: BigInt(meta.amountOutAtomic || '0'),
          sourceSwapDepositAddress: meta.depositAddress,
          nextStep: 'stabilize',
        }).catch(() => null)
      : null;

  return {
    giftId,
    status: isCompleted ? 'SUCCESS' : swapStatus,
    payoutAsset: 'USDC' as const,
    targetAsset: meta.targetAsset,
    usdcAmount: meta.amountOut,
    usdcAmountAtomic: meta.amountOutAtomic,
    usdcSwapStatus: swapStatus,
    depositAddress: meta.depositAddress,
    intentHash: submitted.intentHash,
    confidential: isConfidentialSwap,
    needsPostSwapShield: needsPostSwapShield && isConfidentialRailEnabled(env),
    ...(shieldPrepare ? { shieldPrepare } : {}),
  };
}

export async function prepareSelfCustodyGiftReclaim(params: {
  env: Env;
  session: Session;
  giftId: string;
}) {
  const { env, session, giftId } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const row = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
    .bind(giftId)
    .first<any>();
  if (!row) throw new CustodyActionError('Gift not found.', 404, 'NOT_FOUND');
  if (row.sender_x_id !== session.x_id) {
    throw new CustodyActionError('Only the sender may reclaim an unclaimed Gift.', 403, 'FORBIDDEN');
  }
  if (row.status !== 'LOCKED') {
    throw new CustodyActionError(`Gift status is ${row.status}.`, 409, 'INVALID_STATUS');
  }

  const reclaimAt = Number(row.timelock_until) + GIFT_RECLAIM_GRACE_MS;
  if (Date.now() < reclaimAt) {
    throw new CustodyActionError(
      'Unclaimed gifts can only be reclaimed 30 days after unlock time.',
      409,
      'RECLAIM_TOO_EARLY'
    );
  }

  const { nearAccount } = await getCurrentSaltAndAccount(env, session);
  let requiredPubkey: string | undefined;
  if (row.contract_mode === 'contract' && row.onchain_gift_id) {
    const contractId = String(row.escrow_contract_id || getCircleContractId(env)!).toLowerCase();
    const onchain = await getGiftOnchain(env, row.onchain_gift_id, contractId);
    if (!onchain || onchain.status !== 'LOCKED') {
      throw new CustodyActionError('On-chain Gift is no longer reclaimable.', 409, 'ONCHAIN_NOT_LOCKED');
    }
    if (onchain.sender_account_id.toLowerCase() !== nearAccount.toLowerCase()) {
      throw new CustodyActionError('Sender account mismatch on-chain.', 403, 'FORBIDDEN');
    }
    requiredPubkey = onchain.sender_pubkey;
  }

  const payloadStr =
    row.contract_mode === 'contract' && row.onchain_gift_id
      ? canonicalGiftReclaimPayload({
          contractId: String(row.escrow_contract_id || getCircleContractId(env)!).toLowerCase(),
          giftId: row.onchain_gift_id,
          senderAccountId: nearAccount,
        })
      : JSON.stringify({
          domain: 'uprail:gift-escrow-reclaim:v1',
          gift_id: giftId,
          sender_account_id: nearAccount,
          nonce: crypto.randomUUID(),
        });

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'GIFT_RECLAIM_SELF',
    payloadStr,
    meta: {
      giftId,
      contractMode: row.contract_mode === 'contract' ? 'contract' : 'escrow',
      escrowContractId: row.escrow_contract_id || null,
      onchainGiftId: row.onchain_gift_id || null,
      senderNearAccount: nearAccount,
      expectedSenderPubkey: requiredPubkey || null,
      vaultAssetId: row.vault_asset_id,
      sharesAtomic: row.shares_atomic || row.quoted_shares_atomic || '0',
    },
    requireOnchainPasskey: true,
    requiredPubkey,
    ttlMs: VAULT_ACTION_TTL_MS,
  });

  return { step: 'gift_reclaim' as const, giftId, ...pending };
}

export async function submitSelfCustodyGiftReclaim(params: {
  env: Env;
  session: Session;
  giftId: string;
  actionId: string;
  assertion: unknown;
}) {
  const { env, session, giftId, actionId, assertion } = params;
  if (!env.DB) throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');

  const row = await env.DB.prepare('SELECT id, contract_mode, onchain_gift_id, escrow_contract_id FROM gifts WHERE id = ? LIMIT 1')
    .bind(giftId)
    .first<any>();
  let requiredPubkey: string | undefined;
  if (row?.contract_mode === 'contract' && row.onchain_gift_id) {
    const onchain = await getGiftOnchain(
      env,
      row.onchain_gift_id,
      String(row.escrow_contract_id || getCircleContractId(env)!).toLowerCase()
    ).catch(() => null);
    requiredPubkey = onchain?.sender_pubkey;
  }

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'GIFT_RECLAIM_SELF',
    requireOnchainPasskey: true,
    requiredPubkey,
  });
  if (meta.giftId !== giftId) {
    throw new CustodyActionError('Gift mismatch on reclaim', 403, 'GIFT_MISMATCH');
  }
  if (meta.expectedSenderPubkey && signedWebAuthn.public_key !== meta.expectedSenderPubkey) {
    throw new CustodyActionError('Reclaim passkey does not match bound sender key.', 403, 'SENDER_PUBKEY_MISMATCH');
  }
  assertAllowedContractWebAuthnOrigin(env, signedWebAuthn.client_data_json);

  const now = Date.now();
  const lock = await env.DB.prepare(
    "UPDATE gifts SET status = 'RECLAIMING', updated_at = ? WHERE id = ? AND sender_x_id = ? AND status = 'LOCKED'"
  )
    .bind(now, giftId, session.x_id)
    .run();
  if ((lock.meta?.changes ?? 0) === 0) {
    throw new CustodyActionError('Gift is not reclaimable.', 409, 'CONFLICT');
  }

  const releaseLock = async () => {
    await env.DB!.prepare(
      "UPDATE gifts SET status = 'LOCKED', updated_at = ? WHERE id = ? AND status = 'RECLAIMING'"
    )
      .bind(Date.now(), giftId)
      .run()
      .catch(() => {});
  };

  try {
    let txHash: string | undefined;
    if (meta.contractMode === 'contract' && meta.onchainGiftId) {
      const contractId = String(meta.escrowContractId || getCircleContractId(env)!).toLowerCase();
      const res = await reclaimGiftOnchain(
        env,
        {
          gift_id: meta.onchainGiftId,
          sender_proof: webAuthnToContractProof(signedWebAuthn),
        },
        contractId
      );
      if (!res.success || !res.txHash) {
        throw new CustodyActionError(res.error || 'Contract reclaim failed', 502, 'RECLAIM_FAILED');
      }
      txHash = res.txHash;
    } else {
      const row = await env.DB.prepare('SELECT custody_account FROM gifts WHERE id = ?')
        .bind(giftId)
        .first<{ custody_account: string }>();
      const custodyAcct = row?.custody_account || '';
      const liveBal = await getCustodyVaultBalance(env, custodyAcct, meta.vaultAssetId);
      const sendAtomic =
        liveBal !== null && liveBal > 0n ? liveBal : BigInt(meta.sharesAtomic || '0');
      if (sendAtomic <= 0n) {
        throw new CustodyActionError('Gift custody balance is empty.', 409, 'EMPTY_CUSTODY');
      }
      const res = await transferFromEarnCustody(
        env,
        giftId,
        meta.senderNearAccount,
        meta.vaultAssetId,
        sendAtomic
      );
      if (!res.success || !res.txHash) {
        throw new CustodyActionError(res.error || 'Escrow reclaim failed', 502, 'RECLAIM_FAILED');
      }
      txHash = res.txHash;
    }

    const finTime = Date.now();
    await env.DB.prepare(
      "UPDATE gifts SET status = 'RECLAIMED', claim_tx_hash = ?, claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'RECLAIMING'"
    )
      .bind(txHash || null, finTime, finTime, giftId)
      .run();

    return { giftId, status: 'RECLAIMED', txHash };
  } catch (err) {
    await releaseLock();
    if (err instanceof CustodyActionError) throw err;
    throw new CustodyActionError(publicErrorMessage(err, 'Failed to reclaim Gift'), 502, 'RECLAIM_FAILED');
  }
}
