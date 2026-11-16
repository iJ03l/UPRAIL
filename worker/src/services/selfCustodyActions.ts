/**
 * Self-Custody Interactive Signing Orchestration (`selfCustodyActions.ts`)
 *
 * Implements single-tap WebAuthn `prepare` -> `submit` execution for users who opted
 * into `custody_mode = 'self'` across:
 *   - Send (Confidential Intents via 1Click WebAuthn OR Public Intents atomic batch)
 *   - Withdraw (Confidential Intents, Public NEAR `ft_withdraw`, Public Cross-Chain Swap)
 *   - near.com Internal Withdraw (Confidential Intents 1:1)
 *   - Stabilize (Confidential Intents swap to USDC/USDT)
 *
 * Guarantee:
 *   - Never derives or invokes `deriveUserNearKeypair` / `deriveSigningKey`.
 *   - Every 1Click swap quote authored for a `'self'` user sets `refundTo` to the user's
 *     own NEAR account (`u_*.escrow.uprail.near`), never `escrow.uprail.near`.
 *   - Reuses `createPendingCustodyAction` / `consumeAndVerifyWebAuthnPendingAction` and
 *     `validateGeneratedIntentForAccount` so replay, origin, RP ID, and low-S rules apply uniformly.
 */

import type { Env, Payment, Session } from '../types';
import { PaymentStatus } from '../types';
import * as nearRpc from './nearRpc';
import { resolveOrigin } from './webauthnConfig';
import { publicErrorMessage } from '../utils/errors';
import { requireQuoteSecret } from '../utils/secrets';
import { verifyQuoteToken } from './quoteAuth';
import { createPaymentInvite } from './inviteService';
import { resolveAccount } from './accountResolver';
import { classifyRecipient } from '../routes/payments';
import {
  generateSwapIntent,
  requestQuote,
  submitSwapIntent,
} from './oneclickClient';
import {
  getCurrentIntentsSalt,
  getUserSession,
  hasCachedOneClickSession,
  OneClickSelfCustodyAuthRequiredError,
  validateGeneratedIntentForAccount,
} from './oneclickAuth';
import {
  QUOTE_TTL_MS as CONF_QUOTE_TTL_MS,
  formatAtomic,
  getConfidentialAssetBalance,
  isConfidentialRailEnabled,
  payEscrowPrivate,
  resolveToken,
  scrubSettledPaymentLinks,
  waitForSettlement,
} from './confidentialRail';
import {
  chainMatchesAddress,
  get1ClickWithdrawalQuote,
  hasKnownAddressFamily,
  isNearAccountAddress,
  isValidDestinationAddress,
  resolveWithdrawalAssetPair,
} from './oneclickWithdraw';
import { getNearcomDestination, parseNearcomAddress } from './nearcomWithdraw';
import {
  ensureAgentPocketTopUpForMainAccount,
  getAgentPocketBalances,
} from './earnVaults';
import {
  assertStabilizeMinimum,
  computeStabilizeSplit,
  getOneClickTokens,
  getTotalSpendableOriginAtomic,
  QUOTE_TTL_MS as STAB_QUOTE_TTL_MS,
  resolveOriginToken,
  resolveTargetStablecoin,
  SLIPPAGE_BPS as STAB_SLIPPAGE_BPS,
  StabilizeError,
  type OneClickToken,
} from './stabilize';
import {
  CustodyActionError,
  consumeAndVerifyWebAuthnPendingAction,
  createPendingCustodyAction,
  listAndBackfillUserPasskeys,
  prepareOneClickWebAuthnSession,
} from './custodyService';
import {
  prepareNativeL1Send,
  prepareNativeL1Withdraw,
  prepareSweepPlainL1ToIntents,
  submitNativeL1Operation,
} from './nativeL1Auth';
import {
  buildCreateUnclaimedSendMsg,
  getAttestorPublicKey,
  getCircleContractId,
  hashHandleHex,
  isCircleContractEnabled,
} from './circleContract';
import { buildIntentsPayloadString, type IntentsAction } from './selfCustodyCrypto';

const ACTION_TTL_MS = 10 * 60 * 1000;

async function requireSelfCustodyAccount(env: Env, session: Session): Promise<{
  nearAccount: string;
}> {
  const custody = await nearRpc.getUserCustodyRecord(env, session.x_id);
  if (custody.custodyMode !== 'self') {
    throw new CustodyActionError(
      'Account uses server-assisted signing; call the standard endpoint instead.',
      400,
      'NOT_SELF_CUSTODY'
    );
  }
  const nearAccount = await nearRpc.resolveUserNearAccount(env, {
    ...session,
    custody_mode: 'self',
    near_account: custody.nearAccount,
  });
  return { nearAccount };
}

async function getOneClickSessionOrThrowAuth(
  env: Env,
  session: Session
): Promise<{ accessToken: string; accountId: string }> {
  try {
    return await getUserSession(env, session.x_id);
  } catch (err) {
    if (err instanceof OneClickSelfCustodyAuthRequiredError) {
      const oneClickPrepare = await prepareOneClickWebAuthnSession(
        env,
        session.x_id,
        session.x_handle
      );
      throw new CustodyActionError(
        'Passkey signature needed to unlock your 1Click Confidential session.',
        401,
        'ONECLICK_AUTH_REQUIRED',
        { oneClickPrepare }
      );
    }
    throw err;
  }
}

/**
 * Shared helper across Send, Withdraw, near.com Withdraw, and Stabilize:
 * Checks whether Confidential Intents covers `requiredAtomic`. If short, either:
 *   - prepares a single-tap WebAuthn `INTENTS -> CONFIDENTIAL_INTENTS` self-shielding
 *     action (returned as `{ ready: false, shieldPrepare }`), OR
 *   - instructs the user to sweep plain L1 balances into their own `intents.near` account, OR
 *   - throws `INSUFFICIENT_FUNDS`.
 */
async function ensureOrPrepareSelfCustodyConfidentialFunds(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  asset: string;
  requiredAtomic: bigint;
  nextStep: 'send' | 'withdraw' | 'nearcom_withdraw' | 'stabilize';
}): Promise<
  | { ready: true; accessToken: string; assetId: string; decimals: number; symbol: string }
  | {
      ready: false;
      shieldPrepare: Record<string, unknown>;
    }
> {
  const { env, session, nearAccount, asset, requiredAtomic, nextStep } = params;
  const { accessToken, accountId } = await getOneClickSessionOrThrowAuth(env, session);
  const bal = await getConfidentialAssetBalance(env, session.x_id, asset);

  if (bal.amountAtomic >= requiredAtomic) {
    return {
      ready: true,
      accessToken,
      assetId: bal.assetId,
      decimals: bal.decimals,
      symbol: bal.symbol,
    };
  }

  const shortfall = requiredAtomic - bal.amountAtomic;
  let pubBal = await nearRpc.getIntentAssetBalance(env, asset, nearAccount).catch(() => null);
  if (!pubBal) pubBal = { balance: 0n, decimals: bal.decimals };

  if (pubBal.balance < shortfall) {
    const refreshed = await ensureAgentPocketTopUpForMainAccount(
      env,
      nearAccount,
      bal.assetId,
      shortfall,
      pubBal.balance
    );
    if (refreshed > pubBal.balance) {
      pubBal = { ...pubBal, balance: refreshed };
    }
  }

  if (pubBal.balance < shortfall) {
    // Check if user holds un-swept plain L1 tokens in their sub-account
    const plain = await nearRpc.getPlainBalances(env, nearAccount).catch(() => []);
    const matchingPlain = plain.find(
      (b) =>
        nearRpc.assetsMatch(b.defuse_asset_id, bal.assetId) ||
        nearRpc.assetsMatch(b.nearContractId, bal.contractId)
    );
    const plainAmt = BigInt(matchingPlain?.amount || '0');
    if (plainAmt + pubBal.balance >= shortfall && plainAmt > 0n) {
      return {
        ready: false as const,
        shieldPrepare: await prepareSweepPlainL1ToIntents({
          env,
          session,
          nearAccount,
          asset: bal.assetId,
          symbol: bal.symbol,
          amount: matchingPlain?.amountFormatted || formatAtomic(plainAmt.toString(), bal.decimals),
          nextStep,
        }),
      };
    }
    throw new CustodyActionError(
      `Insufficient ${bal.symbol} balance.`,
      400,
      'INSUFFICIENT_FUNDS'
    );
  }

  const shieldQuote = await requestQuote(
    env,
    {
      dry: false,
      swapType: 'EXACT_INPUT',
      originAsset: bal.assetId,
      destinationAsset: bal.assetId,
      amount: shortfall.toString(),
      recipient: accountId,
      recipientType: 'CONFIDENTIAL_INTENTS',
      refundTo: nearAccount,
      refundType: 'INTENTS',
      depositType: 'INTENTS',
      confidentiality: 'basic',
      slippageTolerance: 100,
      deadline: new Date(Date.now() + CONF_QUOTE_TTL_MS).toISOString(),
    },
    { userSession: accessToken }
  );

  const generated = await generateSwapIntent(env, {
    depositAddress: shieldQuote.quote.depositAddress,
    signerId: nearAccount,
    standard: 'webauthn',
  });
  validateGeneratedIntentForAccount(env, generated, nearAccount);
  const payloadStr = generated.rawPayload || generated.payload.message;

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'SHIELD_CONFIDENTIAL_INTENT',
    payloadStr,
    meta: {
      nearAccount,
      assetId: bal.assetId,
      symbol: bal.symbol,
      shortfallAtomic: shortfall.toString(),
      depositAddress: shieldQuote.quote.depositAddress,
      nextStep,
    },
    requireOnchainPasskey: true,
  });

  return {
    ready: false,
    shieldPrepare: {
      step: 'shield',
      nextStep,
      shieldAmountFormatted: formatAtomic(shortfall.toString(), bal.decimals),
      symbol: bal.symbol,
      depositAddress: shieldQuote.quote.depositAddress,
      ...pending,
    },
  };
}

export async function submitConfidentialShieldAction(params: {
  env: Env;
  session: Session;
  actionId: string;
  assertion: any;
}) {
  const { env, session, actionId, assertion } = params;
  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<{
    nearAccount: string;
    depositAddress: string;
    symbol: string;
    shortfallAtomic: string;
    nextStep: string;
  }>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'SHIELD_CONFIDENTIAL_INTENT',
    requireOnchainPasskey: true,
  });

  const submitted = await submitSwapIntent(env, signedWebAuthn);
  const settlement = await waitForSettlement(env, session.x_id, meta.depositAddress, {
    timeoutMs: 45_000,
  }).catch(() => ({ status: 'PENDING', terminal: false }));

  const upperStatus = String(settlement.status || 'PENDING').toUpperCase();
  if (upperStatus === 'FAILED' || upperStatus === 'REFUNDED') {
    throw new CustodyActionError(
      `Shielding to Confidential Intents ${upperStatus.toLowerCase()} — your funds stayed in public Intents.`,
      502,
      'SHIELD_FAILED'
    );
  }

  return {
    step: 'shield' as const,
    shielded: upperStatus === 'SUCCESS',
    status: upperStatus,
    intentHash: submitted.intentHash,
    depositAddress: meta.depositAddress,
    readyForNextStep: upperStatus === 'SUCCESS',
    nextStep: meta.nextStep,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SELF-CUSTODY SEND (/api/send/prepare + /api/send/submit)
// ═══════════════════════════════════════════════════════════════════════════════

export interface PrepareSendInput {
  recipientHandle: string;
  asset: string;
  amount: string;
  memo?: string;
  quoteSignature: string;
  depositAddress: string;
  requestId?: string;
}

export async function prepareSelfCustodySend(
  env: Env,
  session: Session,
  body: PrepareSendInput
) {
  const { nearAccount } = await requireSelfCustodyAccount(env, session);

  if (
    !body?.recipientHandle ||
    !body?.asset ||
    !body?.amount ||
    !body?.quoteSignature ||
    !body?.depositAddress
  ) {
    throw new CustodyActionError(
      'Missing required parameters: recipientHandle, asset, amount, quoteSignature, depositAddress',
      400,
      'INVALID_REQUEST'
    );
  }

  const recipient = classifyRecipient(body.recipientHandle);
  let cleanHandle = recipient.value;
  if (!recipient.isAddress) {
    const resolved = await resolveAccount(env, recipient.value);
    if (!resolved.ok) {
      throw new CustodyActionError(resolved.error, resolved.status, resolved.code);
    }
    cleanHandle = resolved.account.cleanHandle;
  }

  const amountStr = String(body.amount).trim().replace(/^["']|["']$/g, '');
  if (!/^\d{1,15}(\.\d{1,15})?$/.test(amountStr) || Number(amountStr) <= 0) {
    throw new CustodyActionError(
      'Invalid amount: expected a positive decimal number',
      400,
      'INVALID_AMOUNT'
    );
  }

  const quoteVerification = await verifyQuoteToken(requireQuoteSecret(env), body.quoteSignature, {
    asset: body.asset,
    amount: amountStr,
    recipientHandle: cleanHandle,
    depositAddress: body.depositAddress,
  });
  if (!quoteVerification.valid) {
    throw new CustodyActionError(
      `Quote verification failed: ${quoteVerification.reason || 'Invalid quote signature'}`,
      400,
      'INVALID_QUOTE_SIGNATURE'
    );
  }

  let recipientXId: string | null = null;
  let recipientNearAccount: string | null = null;
  let isRecipientRegistered = false;
  if (!recipient.isAddress && env.DB) {
    const row = await env.DB.prepare(
      'SELECT x_id, near_account, is_activated FROM x_identities WHERE LOWER(x_handle) = ?'
    )
      .bind(cleanHandle)
      .first<{ x_id: string; near_account: string | null; is_activated: number | boolean }>();
    if (row) {
      recipientXId = row.x_id;
      recipientNearAccount = row.near_account;
      isRecipientRegistered = Boolean(row.near_account || row.is_activated);
    }
  } else if (recipient.isAddress) {
    recipientNearAccount = cleanHandle;
    isRecipientRegistered = true;
  }

  const feePercent = parseFloat(env.FEE_PERCENT || '0.01');
  const holdingAccount = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const feeRecipient = env.FEE_ACCOUNT_ID || 'escrow.uprail.near';
  const grossAmount = parseFloat(amountStr) || 0;
  const protocolFee = (grossAmount * feePercent).toFixed(6).replace(/\.?0+$/, '') || '0';
  const recipientAmount =
    (grossAmount - parseFloat(protocolFee)).toFixed(6).replace(/\.?0+$/, '') || '0';
  if (parseFloat(recipientAmount) <= 0) {
    throw new CustodyActionError('Amount too small to cover the protocol fee', 400, 'INVALID_AMOUNT');
  }

  // Determine confidential vs public Intents rail
  const oneClickSupported = await nearRpc.isOneClickSupportedAsset(env, body.asset).catch(() => true);
  const useConfidential = isConfidentialRailEnabled(env) && oneClickSupported;

  if (useConfidential) {
    const token = await resolveToken(env, body.asset);
    const grossAtomic = BigInt(nearRpc.toBaseUnits(amountStr, token.decimals));
    const isNearAsset =
      token.symbol.toUpperCase() === 'NEAR' ||
      token.defuse_asset_id.toLowerCase() === 'nep141:wrap.near';
    if (isNearAsset && grossAtomic < 20000000000000000000000n) {
      throw new CustodyActionError('Minimum send amount is 0.02 NEAR', 400, 'AMOUNT_BELOW_MINIMUM');
    }

    const ensured = await ensureOrPrepareSelfCustodyConfidentialFunds({
      env,
      session,
      nearAccount,
      asset: body.asset,
      requiredAtomic: grossAtomic,
      nextStep: 'send',
    });
    if (!ensured.ready) {
      return ensured.shieldPrepare;
    }

    const swapQuote = await requestQuote(
      env,
      {
        dry: false,
        swapType: 'EXACT_INPUT',
        originAsset: ensured.assetId,
        destinationAsset: ensured.assetId,
        amount: grossAtomic.toString(),
        recipient: holdingAccount,
        recipientType: 'CONFIDENTIAL_INTENTS',
        refundTo: nearAccount,
        refundType: 'CONFIDENTIAL_INTENTS',
        depositType: 'CONFIDENTIAL_INTENTS',
        confidentiality: 'basic',
        slippageTolerance: 100,
        deadline: new Date(Date.now() + CONF_QUOTE_TTL_MS).toISOString(),
      },
      { userSession: ensured.accessToken }
    );

    const generated = await generateSwapIntent(env, {
      depositAddress: swapQuote.quote.depositAddress,
      signerId: nearAccount,
      standard: 'webauthn',
    });
    validateGeneratedIntentForAccount(env, generated, nearAccount);
    const payloadStr = generated.rawPayload || generated.payload.message;

    const pending = await createPendingCustodyAction({
      env,
      xId: session.x_id,
      actionType: 'SEND_CONFIDENTIAL_INTENT',
      payloadStr,
      meta: {
        rail: 'confidential',
        nearAccount,
        cleanHandle,
        isAddress: recipient.isAddress,
        recipientXId,
        recipientNearAccount,
        isRecipientRegistered,
        asset: body.asset,
        amount: amountStr,
        recipientAmount,
        protocolFee,
        feeRecipient,
        holdingAccount,
        memo: typeof body.memo === 'string' ? body.memo.trim().slice(0, 280) : null,
        depositAddress: swapQuote.quote.depositAddress,
        quoteDepositAddress: body.depositAddress,
        requestId: body.requestId || null,
      },
      requireOnchainPasskey: true,
    });

    return {
      step: 'send' as const,
      rail: 'confidential' as const,
      ...pending,
      summary: {
        recipientHandle: cleanHandle,
        amount: amountStr,
        asset: token.symbol,
        protocolFee,
        recipientAmount,
      },
    };
  }

  // Public / Native rail resolution
  const tokens = await nearRpc.getSupportedTokens(env);
  const resolvedTok =
    nearRpc.resolveTokenForAsset(body.asset, tokens) ||
    (await nearRpc.resolveRheaToken(env, body.asset));
  if (!resolvedTok) {
    throw new CustodyActionError(`Unsupported asset: ${body.asset}`, 400, 'UNSUPPORTED_ASSET');
  }
  const defuseAssetId = resolvedTok.defuse_asset_id || `nep141:${resolvedTok.nearContractId}`;
  const rawContractId = (resolvedTok.nearContractId || '').trim().toLowerCase();
  const grossAtomic = BigInt(nearRpc.toBaseUnits(amountStr, resolvedTok.decimals));
  const netAtomic = BigInt(nearRpc.toBaseUnits(recipientAmount, resolvedTok.decimals));
  const feeAtomic = grossAtomic > netAtomic ? grossAtomic - netAtomic : 0n;

  // Check if asset lives on `intents.near` or requires NEAR L1 native transfer (`public_native`)
  let assetOnIntents = rawContractId
    ? await nearRpc.isIntentsSupportedAsset(env, rawContractId).catch(() => true)
    : true;
  if (assetOnIntents === false && rawContractId) {
    const reg = await nearRpc.ensureIntentsStorageRegistered(env, rawContractId).catch(() => ({ registered: false }));
    if (reg.registered) assetOnIntents = true;
  }

  if (assetOnIntents === false) {
    const plainBal = await nearRpc.getPlainAssetBalance(env, body.asset, nearAccount);
    if ((plainBal ?? 0n) < grossAtomic) {
      throw new CustodyActionError(
        `Insufficient ${resolvedTok.symbol} NEAR L1 balance.`,
        400,
        'INSUFFICIENT_FUNDS'
      );
    }
    if (isRecipientRegistered && recipientNearAccount && rawContractId) {
      const storage = await nearRpc.ensureSponsoredReceiverStorage(env, rawContractId, recipientNearAccount);
      if (!storage.registered) {
        throw new CustodyActionError(
          storage.reason || `Recipient account cannot receive ${resolvedTok.symbol}`,
          400,
          'RECEIVER_STORAGE_FAILED'
        );
      }
    } else if (rawContractId) {
      await nearRpc.ensureEscrowStorageRegistered(env, rawContractId).catch(() => {});
    }

    return await prepareNativeL1Send({
      env,
      session,
      nearAccount,
      asset: body.asset,
      symbol: resolvedTok.symbol,
      amount: amountStr,
      recipientAmount,
      protocolFee,
      cleanHandle,
      isAddress: recipient.isAddress,
      recipientXId,
      recipientNearAccount,
      isRecipientRegistered,
      feeRecipient,
      holdingAccount,
      memo: typeof body.memo === 'string' ? body.memo.trim().slice(0, 280) : null,
      requestId: body.requestId || null,
    });
  }

  const publicBal = await nearRpc.getIntentAssetBalance(env, body.asset, nearAccount);
  let pubSendAmt = publicBal?.balance ?? 0n;
  if (pubSendAmt < grossAtomic) {
    pubSendAmt = await ensureAgentPocketTopUpForMainAccount(env, nearAccount, defuseAssetId, grossAtomic, pubSendAmt);
  }
  if (pubSendAmt < grossAtomic) {
    const plain = await nearRpc.getPlainBalances(env, nearAccount).catch(() => []);
    const matchingPlain = plain.find((b) =>
      nearRpc.assetsMatch(b.defuse_asset_id, defuseAssetId) ||
      nearRpc.assetsMatch(b.nearContractId, resolvedTok.nearContractId)
    );
    const plainAmt = BigInt(matchingPlain?.amount || '0');
    if (matchingPlain && plainAmt > 0n && plainAmt + pubSendAmt >= grossAtomic) {
      return await prepareSweepPlainL1ToIntents({
        env,
        session,
        nearAccount,
        asset: defuseAssetId,
        symbol: resolvedTok.symbol,
        amount: matchingPlain.amountFormatted || amountStr,
        nextStep: 'send',
      });
    }
    throw new CustodyActionError(
      `Insufficient ${resolvedTok.symbol} balance inside Intents.`,
      400,
      'INSUFFICIENT_FUNDS'
    );
  }

  const circleContractId =
    !isRecipientRegistered && isCircleContractEnabled(env) && getAttestorPublicKey(env)
      ? getCircleContractId(env)
      : null;

  let contractMode: 'escrow' | 'contract' = 'escrow';
  let escrowContractId: string | null = null;
  let escrowSendId: string | null = null;
  let senderPubkey: string | undefined;
  let intents: IntentsAction[];

  if (isRecipientRegistered && recipientNearAccount) {
    intents = [
      {
        intent: 'transfer',
        receiver_id: recipientNearAccount,
        tokens: { [defuseAssetId]: netAtomic.toString() },
      },
      ...(feeAtomic > 0n
        ? [
            {
              intent: 'transfer' as const,
              receiver_id: feeRecipient,
              tokens: { [defuseAssetId]: feeAtomic.toString() },
            },
          ]
        : []),
    ];
  } else if (circleContractId) {
    const passkeys = await listAndBackfillUserPasskeys(env, session.x_id);
    const primaryPk = passkeys.find(
      (p) => p.near_p256_pubkey && p.onchain_added_at !== null && p.onchain_added_at !== undefined
    );
    if (!primaryPk?.near_p256_pubkey) {
      throw new CustodyActionError(
        'No on-chain authorized P-256 passkey found for this self-custody account.',
        400,
        'NO_ELIGIBLE_PASSKEY'
      );
    }
    senderPubkey = primaryPk.near_p256_pubkey;
    escrowSendId = `snd_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const recipientHandleHash = await hashHandleHex(cleanHandle);
    const expiryDays = parseInt(env.PAYMENT_EXPIRY_DAYS || '30', 10);
    const refundAfterMs = Date.now() + expiryDays * 86400 * 1000;
    contractMode = 'contract';
    escrowContractId = circleContractId;

    intents = [
      {
        intent: 'transfer',
        receiver_id: circleContractId,
        tokens: { [defuseAssetId]: netAtomic.toString() },
        msg: buildCreateUnclaimedSendMsg({
          sendId: escrowSendId,
          senderPubkey,
          recipientHandleHash,
          refundAfterMs,
          allowEarlyCancel: true,
        }),
      },
      ...(feeAtomic > 0n
        ? [
            {
              intent: 'transfer' as const,
              receiver_id: feeRecipient,
              tokens: { [defuseAssetId]: feeAtomic.toString() },
            },
          ]
        : []),
    ];
  } else {
    intents = [
      {
        intent: 'transfer',
        receiver_id: holdingAccount,
        tokens: { [defuseAssetId]: grossAtomic.toString() },
      },
    ];
  }

  const saltHex = await getCurrentIntentsSalt(env);
  const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const { payloadStr } = buildIntentsPayloadString({
    signerId: nearAccount,
    verifyingContract: intentsId,
    saltHex,
    intents,
    ttlMs: ACTION_TTL_MS,
  });

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'SEND_PUBLIC_INTENT',
    payloadStr,
    meta: {
      rail: 'public',
      nearAccount,
      cleanHandle,
      isAddress: recipient.isAddress,
      recipientXId,
      recipientNearAccount,
      isRecipientRegistered,
      asset: body.asset,
      amount: amountStr,
      recipientAmount,
      protocolFee,
      feeRecipient,
      holdingAccount,
      contractMode,
      escrowContractId,
      escrowSendId,
      senderPubkey: senderPubkey || null,
      memo: typeof body.memo === 'string' ? body.memo.trim().slice(0, 280) : null,
      quoteDepositAddress: body.depositAddress,
      requestId: body.requestId || null,
    },
    requireOnchainPasskey: true,
    requiredPubkey: senderPubkey,
  });

  return {
    step: 'send' as const,
    rail: 'public' as const,
    ...pending,
    summary: {
      recipientHandle: cleanHandle,
      amount: amountStr,
      asset: resolvedTok.symbol,
      protocolFee,
      recipientAmount,
    },
  };
}

export async function submitSelfCustodySend(params: {
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

  // Peek action_type first if step wasn't explicitly specified
  const rowPeek = await env.DB.prepare('SELECT action_type FROM pending_custody_actions WHERE id = ? AND x_id = ?')
    .bind(actionId, session.x_id)
    .first<{ action_type: string }>();

  if (params.step === 'native_auth' || rowPeek?.action_type === 'AUTHORIZE_NATIVE_L1_KEY') {
    return await submitNativeL1Operation({ env, session, actionId, assertion });
  }
  if (params.step === 'shield' || rowPeek?.action_type === 'SHIELD_CONFIDENTIAL_INTENT') {
    return await submitConfidentialShieldAction({ env, session, actionId, assertion });
  }

  const expectedType =
    rowPeek?.action_type === 'SEND_PUBLIC_INTENT' ? 'SEND_PUBLIC_INTENT' : 'SEND_CONFIDENTIAL_INTENT';

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<{
    rail: 'confidential' | 'public';
    nearAccount: string;
    cleanHandle: string;
    isAddress: boolean;
    recipientXId: string | null;
    recipientNearAccount: string | null;
    isRecipientRegistered: boolean;
    asset: string;
    amount: string;
    recipientAmount: string;
    protocolFee: string;
    feeRecipient: string;
    holdingAccount: string;
    contractMode?: 'escrow' | 'contract';
    escrowContractId?: string | null;
    escrowSendId?: string | null;
    senderPubkey?: string | null;
    memo: string | null;
    depositAddress?: string;
    quoteDepositAddress: string;
    requestId: string | null;
  }>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: expectedType,
    requireOnchainPasskey: true,
  });

  const paymentId = crypto.randomUUID();
  const now = Date.now();
  const expiryDays = parseInt(env.PAYMENT_EXPIRY_DAYS || '30', 10);
  const expiresAt = now + expiryDays * 86400 * 1000;
  const inviteCode = meta.isRecipientRegistered
    ? null
    : await createPaymentInvite(env, paymentId, session.x_id, session.x_handle);

  await env.DB.prepare(
    `INSERT INTO payments (
      id, sender_x_id, sender_x_handle, recipient_handle, recipient_x_id,
      asset, amount, fee, fee_recipient, invite_code, memo,
      status, contract_mode, escrow_contract_id, escrow_send_id,
      deposit_address, intent_hash, claim_tx_hash, refund_tx_hash,
      created_at, expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`
  )
    .bind(
      paymentId,
      session.x_id,
      session.x_handle,
      meta.cleanHandle,
      meta.recipientXId,
      meta.asset,
      meta.recipientAmount,
      meta.protocolFee,
      meta.feeRecipient,
      inviteCode,
      meta.memo,
      PaymentStatus.PENDING,
      meta.contractMode === 'contract' ? 'contract' : 'escrow',
      meta.escrowContractId ?? null,
      meta.escrowSendId ?? null,
      meta.quoteDepositAddress,
      now,
      expiresAt,
      now
    )
    .run();

  const cancelPending = async (code: string, message: string) => {
    await env.DB!.prepare(
      `UPDATE payments SET status = ?, cancel_reason = ?, cancel_code = ?, updated_at = ?
       WHERE id = ? AND status = ?`
    )
      .bind(PaymentStatus.CANCELLED, message, code, Date.now(), paymentId, PaymentStatus.PENDING)
      .run()
      .catch(() => {});
  };

  let claimTxHash: string | null = null;
  let escrowDepositTxHash: string | null = null;
  let settlementStatus: string | null = null;
  let claimDepositAddress: string | null = null;
  let confirmedAt: number | null = null;
  let recipientPaidAtSend = false;

  if (meta.rail === 'confidential') {
    let submitted: { intentHash: string };
    try {
      submitted = await submitSwapIntent(env, signedWebAuthn);
    } catch (err) {
      const msg = publicErrorMessage(err, 'Confidential swap submission failed');
      await cancelPending('SETTLEMENT_FAILED', msg);
      throw new CustodyActionError(msg, 502, 'SETTLEMENT_FAILED');
    }

    const depAddr = meta.depositAddress!;
    const settlement = await waitForSettlement(env, session.x_id, depAddr, {
      timeoutMs: 25_000,
    }).catch(() => ({ status: 'UNKNOWN' }));
    settlementStatus = String(settlement.status || 'UNKNOWN').toUpperCase();
    if (settlementStatus === 'FAILED' || settlementStatus === 'REFUNDED') {
      const msg = `Confidential settlement ${settlementStatus.toLowerCase()} — no funds were delivered.`;
      await cancelPending('SETTLEMENT_FAILED', msg);
      throw new CustodyActionError(msg, 502, 'SETTLEMENT_FAILED');
    }

    escrowDepositTxHash = submitted.intentHash;
    confirmedAt = settlementStatus === 'SUCCESS' ? Date.now() : null;

    if (meta.isRecipientRegistered && meta.recipientNearAccount && settlementStatus === 'SUCCESS') {
      try {
        const payout = await payEscrowPrivate(env, {
          asset: meta.asset,
          amount: meta.recipientAmount,
          recipientAccount: meta.recipientNearAccount,
          timeoutMs: 15_000,
        });
        const payoutStatus = String(payout.status || 'UNKNOWN').toUpperCase();
        if (payoutStatus !== 'FAILED' && payoutStatus !== 'REFUNDED') {
          claimTxHash = payout.intentHash;
          claimDepositAddress = payout.depositAddress;
          settlementStatus = payoutStatus;
          confirmedAt = payoutStatus === 'SUCCESS' ? Date.now() : null;
          recipientPaidAtSend = true;
        }
      } catch (payoutErr) {
        console.warn('[selfCustody/send] immediate escrow payout deferred to claim:', payoutErr);
      }
    }

    const finalStatus = recipientPaidAtSend ? PaymentStatus.CLAIMED : PaymentStatus.ESCROWED;
    await env.DB.prepare(
      `UPDATE payments
       SET status = ?, deposit_address = ?, intent_hash = ?, claim_tx_hash = ?,
           privacy_rail = 'confidential', settlement_status = ?,
           claim_deposit_address = ?, confirmed_at = ?, updated_at = ?
       WHERE id = ? AND status = ?`
    )
      .bind(
        finalStatus,
        depAddr,
        escrowDepositTxHash,
        claimTxHash,
        settlementStatus,
        claimDepositAddress,
        confirmedAt,
        Date.now(),
        paymentId,
        PaymentStatus.PENDING
      )
      .run();

    await scrubSettledPaymentLinks(env, paymentId);
  } else {
    const sim = await nearRpc.simulateIntentsRelayed(env, [signedWebAuthn]);
    if (!sim.ok) {
      const msg = `On-chain simulation rejected transfer: ${sim.error || 'unknown error'}`;
      await cancelPending('SIMULATION_FAILED', msg);
      throw new CustodyActionError(msg, 400, 'SIMULATION_FAILED');
    }

    const relay =
      meta.contractMode === 'contract'
        ? await nearRpc.executeIntentsBatchRelayed(env, [signedWebAuthn], 160_000_000_000_000n)
        : await nearRpc.executeIntentsRelayed(env, signedWebAuthn);
    if (!relay.success || !relay.txHash) {
      const msg = relay.error || 'Transfer relay failed on intents.near';
      await cancelPending('SETTLEMENT_FAILED', msg);
      throw new CustodyActionError(msg, 502, 'SETTLEMENT_FAILED');
    }

    if (meta.isRecipientRegistered) {
      claimTxHash = relay.txHash;
      recipientPaidAtSend = true;
    } else {
      escrowDepositTxHash = relay.txHash;
    }

    const finalStatus = meta.isRecipientRegistered ? PaymentStatus.CLAIMED : PaymentStatus.ESCROWED;
    await env.DB.prepare(
      `UPDATE payments
       SET status = ?, intent_hash = ?, claim_tx_hash = ?,
           fee_dispatch_status = ?, updated_at = ?
       WHERE id = ? AND status = ?`
    )
      .bind(
        finalStatus,
        escrowDepositTxHash,
        claimTxHash,
        meta.isRecipientRegistered || meta.contractMode === 'contract' ? 'sent' : 'skipped',
        Date.now(),
        paymentId,
        PaymentStatus.PENDING
      )
      .run();
  }

  if (meta.requestId) {
    await env.DB.prepare(
      `UPDATE payment_requests SET status = 'COMPLETED', payment_id = ?, completed_at = ?
       WHERE id = ? AND status = 'PENDING'`
    )
      .bind(paymentId, Date.now(), meta.requestId)
      .run()
      .catch(() => {});
  }

  if (!meta.isAddress && meta.cleanHandle) {
    const contactId = `cnt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await env.DB.prepare(
      `INSERT INTO contacts (id, user_x_id, contact_handle, contact_x_id, preferred_asset, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(user_x_id, contact_handle) DO UPDATE SET updated_at = ?`
    )
      .bind(contactId, session.x_id, meta.cleanHandle, meta.recipientXId, meta.asset, now, now, now)
      .run()
      .catch(() => {});
  }

  const appOrigin = resolveOrigin(env);
  const shareLink = meta.isAddress
    ? ''
    : `${appOrigin}/claim/${paymentId}${inviteCode ? `?invite=${inviteCode}` : ''}`;
  const cleanDisplay = meta.cleanHandle.replace(/^@+/, '');
  const tweetText = `Hey @${cleanDisplay}, I sent you ${meta.amount} ${meta.asset} on UPRAIL: ${shareLink}`;
  const xShareUrl = shareLink ? `https://x.com/intent/post?text=${encodeURIComponent(tweetText)}` : undefined;
  const tweetIntentUrl = shareLink
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`
    : undefined;

  const paymentStatus = meta.rail === 'confidential'
    ? recipientPaidAtSend
      ? PaymentStatus.CLAIMED
      : PaymentStatus.ESCROWED
    : meta.isRecipientRegistered
    ? PaymentStatus.CLAIMED
    : PaymentStatus.ESCROWED;

  return {
    paymentId,
    shareLink,
    claimLink: meta.isRecipientRegistered ? undefined : shareLink || undefined,
    receiptLink: meta.isRecipientRegistered ? shareLink : undefined,
    xShareUrl,
    tweetIntentUrl,
    status: paymentStatus,
    depositAddress: meta.depositAddress || meta.quoteDepositAddress,
    fee: meta.protocolFee,
    recipientAmount: meta.recipientAmount,
    feeRecipient: meta.feeRecipient,
    inviteCode: inviteCode || undefined,
    isDirect: meta.isRecipientRegistered,
    contractMode: meta.contractMode || 'escrow',
    escrowSendId: meta.escrowSendId || undefined,
    txHash: claimTxHash || escrowDepositTxHash,
    payment: {
      id: paymentId,
      paymentId,
      recipientHandle: meta.cleanHandle,
      amount: meta.recipientAmount,
      asset: meta.asset,
      shareLink,
      claimLink: meta.isRecipientRegistered ? undefined : shareLink || undefined,
      xShareUrl,
      tweetIntentUrl,
      status: paymentStatus,
      contractMode: meta.contractMode || 'escrow',
      escrowSendId: meta.escrowSendId || undefined,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SELF-CUSTODY WITHDRAW (/api/claim/withdraw/prepare + /withdraw/submit)
// ═══════════════════════════════════════════════════════════════════════════════

export interface PrepareWithdrawInput {
  destinationAddress: string;
  asset?: string;
  amount?: string;
  destinationChain?: string;
}

export async function prepareSelfCustodyWithdraw(
  env: Env,
  session: Session,
  body: PrepareWithdrawInput
) {
  const { nearAccount } = await requireSelfCustodyAccount(env, session);

  const destinationAddress = (body?.destinationAddress || '').trim();
  if (!destinationAddress) {
    throw new CustodyActionError('destinationAddress is required', 400, 'INVALID_REQUEST');
  }
  const asset = (body?.asset || 'usdc').trim().toLowerCase();
  const destinationChain =
    typeof body?.destinationChain === 'string' && body.destinationChain.trim()
      ? body.destinationChain.trim().toLowerCase()
      : undefined;

  if (
    (!destinationChain || hasKnownAddressFamily(destinationChain)) &&
    !isValidDestinationAddress(destinationAddress)
  ) {
    throw new CustodyActionError(
      'destinationAddress is not a valid blockchain address',
      400,
      'INVALID_DESTINATION'
    );
  }
  if (destinationChain !== undefined && !chainMatchesAddress(destinationChain, destinationAddress)) {
    throw new CustodyActionError(
      'The destination address does not match the selected network',
      400,
      'INVALID_DESTINATION'
    );
  }

  const isNearAccount = destinationChain
    ? destinationChain === 'near'
    : isNearAccountAddress(destinationAddress);

  const available = await nearRpc.getUserAvailableBalance(env, session, asset);
  let amountStr: string;
  if (body.amount && body.amount !== 'all') {
    const raw = String(body.amount).trim().replace(/^["']|["']$/g, '');
    if (!/^\d{1,15}(\.\d{1,18})?$/.test(raw)) {
      throw new CustodyActionError('Invalid withdrawal amount', 400, 'INVALID_AMOUNT');
    }
    amountStr = raw;
  } else {
    amountStr = available > 0 ? available.toFixed(18).replace(/\.?0+$/, '') || '0' : '0';
  }
  const parsedAmount = parseFloat(amountStr);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new CustodyActionError('Invalid withdrawal amount', 400, 'INVALID_AMOUNT');
  }
  if (parsedAmount > available + 0.0001) {
    throw new CustodyActionError(
      `Insufficient balance. Available: ${available.toFixed(6)} ${asset.toUpperCase()}`,
      400,
      'INSUFFICIENT_FUNDS'
    );
  }

  const oneClickSupported = await nearRpc.isOneClickSupportedAsset(env, asset).catch(() => true);
  if (isConfidentialRailEnabled(env) && oneClickSupported) {
    const pair = await resolveWithdrawalAssetPair(env, asset, destinationAddress, destinationChain);
    const amountAtomic = BigInt(nearRpc.toBaseUnits(amountStr, pair.decimals));
    if (amountAtomic <= 0n) {
      throw new CustodyActionError('Invalid withdrawal amount', 400, 'INVALID_AMOUNT');
    }

    const ensured = await ensureOrPrepareSelfCustodyConfidentialFunds({
      env,
      session,
      nearAccount,
      asset,
      requiredAtomic: amountAtomic,
      nextStep: 'withdraw',
    });
    if (!ensured.ready) {
      return ensured.shieldPrepare;
    }

    const quote = await requestQuote(
      env,
      {
        dry: false,
        swapType: 'EXACT_INPUT',
        originAsset: pair.originAsset,
        destinationAsset: pair.destinationAsset,
        amount: amountAtomic.toString(),
        recipient: destinationAddress,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: nearAccount,
        refundType: 'CONFIDENTIAL_INTENTS',
        depositType: 'CONFIDENTIAL_INTENTS',
        confidentiality: 'basic',
        slippageTolerance: 100,
        deadline: new Date(Date.now() + CONF_QUOTE_TTL_MS).toISOString(),
      },
      { userSession: ensured.accessToken }
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
      actionType: 'WITHDRAW_CONFIDENTIAL_INTENT',
      payloadStr,
      meta: {
        mode: 'confidential',
        nearAccount,
        destinationAddress,
        destinationChain: destinationChain || null,
        asset,
        amount: amountStr,
        depositAddress: quote.quote.depositAddress,
        amountOut: quote.quote.amountOut,
      },
      requireOnchainPasskey: true,
    });

    return {
      step: 'withdraw' as const,
      rail: 'confidential' as const,
      ...pending,
      summary: {
        destinationAddress,
        destinationChain: destinationChain || 'auto',
        asset: ensured.symbol,
        amount: amountStr,
        estimatedOut: quote.quote.amountOut,
      },
    };
  }

  // Public / Native path (NEAR native L1, NEAR `ft_withdraw`, OR public 1Click cross-chain swap)
  const tokens = await nearRpc.getSupportedTokens(env);
  const tok =
    nearRpc.resolveTokenForAsset(asset, tokens) || (await nearRpc.resolveRheaToken(env, asset));
  if (!tok) {
    throw new CustodyActionError(`Unsupported asset: ${asset}`, 400, 'UNSUPPORTED_ASSET');
  }
  const defuseAssetId = tok.defuse_asset_id || `nep141:${tok.nearContractId}`;
  const rawContractId = (tok.nearContractId || '').trim().toLowerCase();
  const amountAtomic = BigInt(nearRpc.toBaseUnits(amountStr, tok.decimals));

  let assetOnIntents = rawContractId
    ? await nearRpc.isIntentsSupportedAsset(env, rawContractId).catch(() => true)
    : true;
  if (assetOnIntents === false && rawContractId) {
    const reg = await nearRpc.ensureIntentsStorageRegistered(env, rawContractId).catch(() => ({ registered: false }));
    if (reg.registered) assetOnIntents = true;
  }

  if (assetOnIntents === false) {
    if (!isNearAccount) {
      throw new CustodyActionError(
        `${tok.symbol} is a NEAR L1 native token and can only be withdrawn to a NEAR account.`,
        400,
        'NATIVE_NEAR_ONLY'
      );
    }
    const plainBal = await nearRpc.getPlainAssetBalance(env, asset, nearAccount);
    if ((plainBal ?? 0n) < amountAtomic) {
      throw new CustodyActionError(
        `Insufficient ${tok.symbol} NEAR L1 balance.`,
        400,
        'INSUFFICIENT_FUNDS'
      );
    }
    if (rawContractId) {
      const storage = await nearRpc.ensureSponsoredReceiverStorage(env, rawContractId, destinationAddress);
      if (!storage.registered) {
        throw new CustodyActionError(
          storage.reason || `Destination account cannot receive ${tok.symbol}`,
          400,
          'RECEIVER_STORAGE_FAILED'
        );
      }
    }
    return await prepareNativeL1Withdraw({
      env,
      session,
      nearAccount,
      asset,
      symbol: tok.symbol,
      amount: amountStr,
      destinationAddress,
    });
  }

  let pubBal = await nearRpc.getIntentAssetBalance(env, asset, nearAccount);
  let pubAmt = pubBal?.balance ?? 0n;
  if (pubAmt < amountAtomic) {
    pubAmt = await ensureAgentPocketTopUpForMainAccount(env, nearAccount, defuseAssetId, amountAtomic, pubAmt);
  }
  if (pubAmt < amountAtomic) {
    const plain = await nearRpc.getPlainBalances(env, nearAccount).catch(() => []);
    const matchingPlain = plain.find((b) =>
      nearRpc.assetsMatch(b.defuse_asset_id, defuseAssetId) ||
      nearRpc.assetsMatch(b.nearContractId, tok.nearContractId)
    );
    const plainAmt = BigInt(matchingPlain?.amount || '0');
    if (matchingPlain && plainAmt > 0n && plainAmt + pubAmt >= amountAtomic) {
      return await prepareSweepPlainL1ToIntents({
        env,
        session,
        nearAccount,
        asset: defuseAssetId,
        symbol: tok.symbol,
        amount: matchingPlain.amountFormatted || amountStr,
        nextStep: 'withdraw',
      });
    }
    throw new CustodyActionError(`Insufficient ${tok.symbol} balance inside Intents.`, 400, 'INSUFFICIENT_FUNDS');
  }

  if (isNearAccount) {
    const contractId = tok.nearContractId || defuseAssetId.replace(/^nep141:/, '');
    const storage = await nearRpc.ensureSponsoredReceiverStorage(env, contractId, destinationAddress);
    if (!storage.registered) {
      throw new CustodyActionError(
        storage.reason || `Destination account cannot receive ${tok.symbol}`,
        400,
        'RECEIVER_STORAGE_FAILED'
      );
    }

    const saltHex = await getCurrentIntentsSalt(env);
    const intentsId = env.INTENTS_CONTRACT_ID || 'intents.near';
    const { payloadStr } = buildIntentsPayloadString({
      signerId: nearAccount,
      verifyingContract: intentsId,
      saltHex,
      intents: [
        {
          intent: 'ft_withdraw',
          token: contractId,
          receiver_id: destinationAddress,
          amount: amountAtomic.toString(),
        },
      ],
      ttlMs: ACTION_TTL_MS,
    });

    const pending = await createPendingCustodyAction({
      env,
      xId: session.x_id,
      actionType: 'WITHDRAW_PUBLIC_FT',
      payloadStr,
      meta: {
        mode: 'near_ft_withdraw',
        nearAccount,
        destinationAddress,
        asset,
        amount: amountStr,
      },
      requireOnchainPasskey: true,
    });

    return {
      step: 'withdraw' as const,
      rail: 'intents' as const,
      ...pending,
      summary: { destinationAddress, destinationChain: 'near', asset: tok.symbol, amount: amountStr },
    };
  }

  // External chain public cross-chain swap — refund ALWAYS returns to user's `nearAccount`!
  const quote = await get1ClickWithdrawalQuote(env, {
    destinationAddress,
    asset,
    amount: parsedAmount,
    destinationChain,
    refundTo: nearAccount,
  });
  const generated = await generateSwapIntent(env, {
    depositAddress: quote.depositAddress,
    signerId: nearAccount,
    standard: 'webauthn',
  });
  validateGeneratedIntentForAccount(env, generated, nearAccount);
  const payloadStr = generated.rawPayload || generated.payload.message;

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'WITHDRAW_PUBLIC_SWAP',
    payloadStr,
    meta: {
      mode: 'public_swap',
      nearAccount,
      destinationAddress,
      destinationChain: destinationChain || null,
      asset,
      amount: amountStr,
      depositAddress: quote.depositAddress,
      amountOut: quote.amountOut,
    },
    requireOnchainPasskey: true,
  });

  return {
    step: 'withdraw' as const,
    rail: 'cross_chain' as const,
    ...pending,
    summary: {
      destinationAddress,
      destinationChain: destinationChain || 'auto',
      asset: tok.symbol,
      amount: amountStr,
      estimatedOut: quote.amountOut,
    },
  };
}

export async function submitSelfCustodyWithdraw(params: {
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

  const peek = await env.DB.prepare('SELECT action_type FROM pending_custody_actions WHERE id = ? AND x_id = ?')
    .bind(actionId, session.x_id)
    .first<{ action_type: string }>();

  if (params.step === 'native_auth' || peek?.action_type === 'AUTHORIZE_NATIVE_L1_KEY') {
    return await submitNativeL1Operation({ env, session, actionId, assertion });
  }
  if (params.step === 'shield' || peek?.action_type === 'SHIELD_CONFIDENTIAL_INTENT') {
    return await submitConfidentialShieldAction({ env, session, actionId, assertion });
  }

  const expectedType =
    peek?.action_type === 'WITHDRAW_PUBLIC_FT'
      ? 'WITHDRAW_PUBLIC_FT'
      : peek?.action_type === 'WITHDRAW_PUBLIC_SWAP'
      ? 'WITHDRAW_PUBLIC_SWAP'
      : 'WITHDRAW_CONFIDENTIAL_INTENT';

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<{
    mode: 'confidential' | 'near_ft_withdraw' | 'public_swap';
    nearAccount: string;
    destinationAddress: string;
    destinationChain: string | null;
    asset: string;
    amount: string;
    depositAddress?: string;
  }>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: expectedType,
    requireOnchainPasskey: true,
  });

  const withdrawalId = 'wth_' + crypto.randomUUID();
  const now = Date.now();
  const isConfidential = meta.mode === 'confidential';
  const reserve = await env.DB.prepare(
    `INSERT INTO withdrawals
       (id, x_id, x_handle, destination_address, asset, amount, tx_hash, status,
        privacy_rail, settlement_status, rail, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, 'PENDING', ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM withdrawals WHERE x_id = ? AND asset = ? AND status = 'PENDING'
     )`
  )
    .bind(
      withdrawalId,
      session.x_id,
      session.x_handle,
      meta.destinationAddress,
      meta.asset,
      meta.amount,
      isConfidential ? 'confidential' : 'public',
      isConfidential ? 'confidential' : meta.mode === 'near_ft_withdraw' ? 'intents' : 'cross_chain',
      now,
      now,
      session.x_id,
      meta.asset
    )
    .run();

  if ((reserve.meta?.changes ?? 0) === 0) {
    throw new CustodyActionError('A withdrawal for this asset is already in progress', 409, 'WITHDRAWAL_IN_PROGRESS');
  }

  const markFailed = async (msg: string, code = 'SETTLEMENT_FAILED') => {
    await env.DB!.prepare(
      "UPDATE withdrawals SET status = 'FAILED', error = ?, error_code = ?, settlement_status = 'FAILED', updated_at = ? WHERE id = ? AND status = 'PENDING'"
    )
      .bind(msg.slice(0, 500), code, Date.now(), withdrawalId)
      .run()
      .catch(() => {});
  };

  if (meta.mode === 'confidential' || meta.mode === 'public_swap') {
    try {
      const submitted = await submitSwapIntent(env, signedWebAuthn);
      await env.DB.prepare(
        `UPDATE withdrawals
         SET tx_hash = ?, intent_hash = ?, deposit_address = ?, settlement_status = 'SUBMITTED', updated_at = ?
         WHERE id = ?`
      )
        .bind(submitted.intentHash, submitted.intentHash, meta.depositAddress || null, Date.now(), withdrawalId)
        .run();

      return {
        httpStatus: 202 as const,
        withdrawalId,
        status: 'PENDING',
        txHash: submitted.intentHash,
        intentHash: submitted.intentHash,
        depositAddress: meta.depositAddress,
        privacy: meta.mode === 'confidential' ? 'confidential' : 'public',
      };
    } catch (err) {
      const msg = publicErrorMessage(err, 'Withdrawal swap submission failed');
      await markFailed(msg);
      throw new CustodyActionError(msg, 502, 'WITHDRAWAL_FAILED');
    }
  }

  // Public NEAR `ft_withdraw`
  const sim = await nearRpc.simulateIntentsRelayed(env, [signedWebAuthn]);
  if (!sim.ok) {
    const msg = `Withdrawal simulation failed: ${sim.error || 'unknown error'}`;
    await markFailed(msg, 'SIMULATION_FAILED');
    throw new CustodyActionError(msg, 400, 'SIMULATION_FAILED');
  }

  const relay = await nearRpc.executeIntentsRelayed(env, signedWebAuthn);
  if (!relay.success || !relay.txHash) {
    const msg = relay.error || 'NEAR withdrawal relay failed';
    if (relay.ambiguous) {
      await env.DB.prepare(
        "UPDATE withdrawals SET error = ?, error_code = 'AMBIGUOUS', updated_at = ? WHERE id = ?"
      )
        .bind(msg.slice(0, 500), Date.now(), withdrawalId)
        .run()
        .catch(() => {});
      throw new CustodyActionError(
        `Withdrawal status unknown — quote withdrawal id ${withdrawalId} to support`,
        500,
        'WITHDRAWAL_UNRECORDED',
        { withdrawalId }
      );
    }
    await markFailed(msg);
    throw new CustodyActionError(msg, 502, 'WITHDRAWAL_FAILED');
  }

  await env.DB.prepare(
    "UPDATE withdrawals SET tx_hash = ?, status = 'COMPLETED', settlement_status = 'SUCCESS', confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'"
  )
    .bind(relay.txHash, Date.now(), Date.now(), withdrawalId)
    .run();

  return {
    httpStatus: 200 as const,
    withdrawalId,
    status: 'COMPLETED',
    txHash: relay.txHash,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SELF-CUSTODY near.com INTERNAL WITHDRAW
// ═══════════════════════════════════════════════════════════════════════════════

export async function prepareSelfCustodyNearcomWithdraw(
  env: Env,
  session: Session,
  input: { asset?: string; amount?: string; expectedDestination?: string }
) {
  if (!isConfidentialRailEnabled(env)) {
    throw new CustodyActionError('Confidential Intents rail is currently disabled.', 503, 'RAIL_DISABLED');
  }
  const { nearAccount } = await requireSelfCustodyAccount(env, session);

  const destination = await getNearcomDestination(env, session.x_id);
  if (!destination) {
    throw new CustodyActionError(
      'Set up your near.com internal withdrawal address first.',
      400,
      'NEARCOM_NOT_CONFIGURED'
    );
  }
  if (input.expectedDestination?.trim()) {
    const parsedExp = parseNearcomAddress(input.expectedDestination);
    if (!parsedExp.ok || parsedExp.intentsAccountId !== destination.intentsAccountId) {
      throw new CustodyActionError(
        'Your saved near.com destination changed before confirmation. Please retry.',
        409,
        'DESTINATION_MISMATCH'
      );
    }
  }

  const asset = (input.asset || 'usdc').trim().toLowerCase();
  const { accessToken, accountId } = await getOneClickSessionOrThrowAuth(env, session);
  const balance = await getConfidentialAssetBalance(env, session.x_id, asset);
  const pubBal = await nearRpc.getIntentAssetBalance(env, asset, nearAccount).catch(() => null);
  const pocketInfo = await getAgentPocketBalances(env, nearAccount).catch(() => ({
    pocketAccount: null,
    balances: [],
    rpcOk: false,
  }));
  const pocketAtomic = pocketInfo.balances
    .filter(
      (b) =>
        nearRpc.assetsMatch(b.defuse_asset_id, balance.assetId) ||
        nearRpc.assetsMatch(b.nearContractId, balance.contractId) ||
        nearRpc.assetsMatch(b.symbol, balance.symbol)
    )
    .reduce((sum, b) => sum + b.amountAtomic, 0n);
  const totalAtomic = balance.amountAtomic + (pubBal?.balance ?? 0n) + pocketAtomic;

  let amountStr: string;
  if (input.amount && input.amount !== 'all') {
    const raw = String(input.amount).trim().replace(/^["']|["']$/g, '');
    if (!/^\d{1,15}(\.\d{1,18})?$/.test(raw)) {
      throw new CustodyActionError('Invalid withdrawal amount', 400, 'INVALID_AMOUNT');
    }
    amountStr = raw;
  } else {
    amountStr = formatAtomic(totalAtomic.toString(), balance.decimals);
  }
  const amountAtomic = BigInt(nearRpc.toBaseUnits(amountStr, balance.decimals));
  if (amountAtomic <= 0n) {
    throw new CustodyActionError('Invalid withdrawal amount', 400, 'INVALID_AMOUNT');
  }
  if (
    (balance.symbol.toUpperCase() === 'NEAR' || balance.assetId.toLowerCase() === 'nep141:wrap.near') &&
    amountAtomic < 20000000000000000000000n
  ) {
    throw new CustodyActionError('Minimum withdrawal amount is 0.02 NEAR', 400, 'AMOUNT_BELOW_MINIMUM');
  }
  if (amountAtomic > totalAtomic) {
    throw new CustodyActionError(
      `Insufficient balance. Available: ${formatAtomic(totalAtomic.toString(), balance.decimals)} ${balance.symbol}`,
      400,
      'INSUFFICIENT_FUNDS'
    );
  }

  const ensured = await ensureOrPrepareSelfCustodyConfidentialFunds({
    env,
    session,
    nearAccount,
    asset,
    requiredAtomic: amountAtomic,
    nextStep: 'nearcom_withdraw',
  });
  if (!ensured.ready) return ensured.shieldPrepare;

  const quote = await requestQuote(
    env,
    {
      dry: false,
      swapType: 'EXACT_INPUT',
      originAsset: balance.assetId,
      destinationAsset: balance.assetId,
      amount: amountAtomic.toString(),
      recipient: destination.intentsAccountId,
      recipientType: 'CONFIDENTIAL_INTENTS',
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
    actionType: 'NEARCOM_WITHDRAW_INTENT',
    payloadStr,
    meta: {
      nearAccount,
      nearcomAddress: destination.nearcomAddress,
      intentsAccountId: destination.intentsAccountId,
      asset,
      symbol: balance.symbol,
      amount: amountStr,
      depositAddress: quote.quote.depositAddress,
    },
    requireOnchainPasskey: true,
  });

  return {
    step: 'nearcom_withdraw' as const,
    ...pending,
    summary: {
      nearcomAddress: destination.nearcomAddress,
      asset: balance.symbol,
      amount: amountStr,
    },
  };
}

export async function submitSelfCustodyNearcomWithdraw(params: {
  env: Env;
  session: Session;
  actionId: string;
  assertion: any;
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
  if (params.step === 'shield' || peek?.action_type === 'SHIELD_CONFIDENTIAL_INTENT') {
    return await submitConfidentialShieldAction({ env, session, actionId, assertion });
  }

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<{
    nearcomAddress: string;
    intentsAccountId: string;
    asset: string;
    symbol: string;
    amount: string;
    depositAddress: string;
  }>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'NEARCOM_WITHDRAW_INTENT',
    requireOnchainPasskey: true,
  });

  const withdrawalId = 'wth_' + crypto.randomUUID();
  const now = Date.now();
  const reserve = await env.DB.prepare(
    `INSERT INTO withdrawals
       (id, x_id, x_handle, destination_address, asset, amount, tx_hash, status,
        privacy_rail, settlement_status, rail, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, NULL, 'PENDING', 'confidential', 'PENDING', 'nearcom_internal', ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM withdrawals WHERE x_id = ? AND asset = ? AND status = 'PENDING'
     )`
  )
    .bind(
      withdrawalId,
      session.x_id,
      session.x_handle,
      meta.nearcomAddress,
      meta.asset,
      meta.amount,
      now,
      now,
      session.x_id,
      meta.asset
    )
    .run();
  if ((reserve.meta?.changes ?? 0) === 0) {
    throw new CustodyActionError('A withdrawal for this asset is already in progress.', 409, 'WITHDRAWAL_IN_PROGRESS');
  }

  try {
    const submitted = await submitSwapIntent(env, signedWebAuthn);
    await env.DB.prepare(
      `UPDATE withdrawals SET tx_hash = ?, intent_hash = ?, deposit_address = ?, settlement_status = 'SUBMITTED', updated_at = ? WHERE id = ?`
    )
      .bind(submitted.intentHash, submitted.intentHash, meta.depositAddress, Date.now(), withdrawalId)
      .run();

    const settlement = await waitForSettlement(env, session.x_id, meta.depositAddress, {
      timeoutMs: 18_000,
      intervalMs: 1_500,
    }).catch(() => ({ status: 'SUBMITTED' }));
    const upper = String(settlement.status || 'SUBMITTED').toUpperCase();
    const shareLink = `${resolveOrigin(env)}/receipt/${withdrawalId}?v=2`;

    if (upper === 'SUCCESS') {
      await env.DB.prepare(
        `UPDATE withdrawals SET status = 'COMPLETED', settlement_status = 'SUCCESS', confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'`
      )
        .bind(Date.now(), Date.now(), withdrawalId)
        .run();
      return {
        httpStatus: 200 as const,
        body: {
          success: true,
          withdrawalId,
          status: 'COMPLETED',
          txHash: submitted.intentHash,
          intentHash: submitted.intentHash,
          depositAddress: meta.depositAddress,
          nearcomAddress: meta.nearcomAddress,
          destinationAddress: meta.nearcomAddress,
          intentsAccountId: meta.intentsAccountId,
          asset: meta.symbol,
          amount: meta.amount,
          shareLink,
          privacy: 'confidential',
        },
      };
    }
    if (upper === 'FAILED' || upper === 'REFUNDED') {
      await env.DB.prepare(
        `UPDATE withdrawals SET status = 'FAILED', settlement_status = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'`
      )
        .bind(upper, Date.now(), withdrawalId)
        .run();
      throw new CustodyActionError(`1Click reported ${upper.toLowerCase()}`, 502, 'WITHDRAWAL_FAILED');
    }

    return {
      httpStatus: 202 as const,
      body: {
        success: true,
        withdrawalId,
        status: 'PENDING',
        txHash: submitted.intentHash,
        intentHash: submitted.intentHash,
        depositAddress: meta.depositAddress,
        nearcomAddress: meta.nearcomAddress,
        destinationAddress: meta.nearcomAddress,
        intentsAccountId: meta.intentsAccountId,
        asset: meta.symbol,
        amount: meta.amount,
        shareLink,
        privacy: 'confidential',
      },
    };
  } catch (err) {
    if (err instanceof CustodyActionError) throw err;
    const msg = publicErrorMessage(err, 'near.com withdrawal failed');
    await env.DB.prepare(
      `UPDATE withdrawals SET status = 'FAILED', error = ?, settlement_status = 'FAILED', updated_at = ? WHERE id = ? AND status = 'PENDING'`
    )
      .bind(msg.slice(0, 500), Date.now(), withdrawalId)
      .run()
      .catch(() => {});
    throw new CustodyActionError(msg, 502, 'WITHDRAWAL_FAILED');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. SELF-CUSTODY STABILIZE (/api/onchain/stabilize/prepare + /stabilize/submit)
// ═══════════════════════════════════════════════════════════════════════════════

export async function prepareSelfCustodyStabilize(
  env: Env,
  session: Session,
  input: { sourceAsset: string; targetAsset: string; amount: string }
) {
  if (!isConfidentialRailEnabled(env)) {
    throw new CustodyActionError('Confidential Intents rail is required for stabilization.', 503, 'CONFIDENTIAL_RAIL_DISABLED');
  }
  const { nearAccount } = await requireSelfCustodyAccount(env, session);

  let oneClickTokens: OneClickToken[] = [];
  try {
    oneClickTokens = await getOneClickTokens(env);
  } catch {
    oneClickTokens = [];
  }

  let destination, origin;
  try {
    destination = resolveTargetStablecoin(input.targetAsset || 'USDC', oneClickTokens);
    origin = await resolveOriginToken(env, input.sourceAsset || '', oneClickTokens);
    if (origin.assetId.toLowerCase() === destination.assetId.toLowerCase()) {
      throw new StabilizeError('SAME_ASSET', `${origin.symbol} is already ${destination.symbol}.`);
    }
  } catch (err: any) {
    if (err instanceof StabilizeError) {
      throw new CustodyActionError(err.message, err.httpStatus, err.code);
    }
    throw err;
  }

  const spendable = await getTotalSpendableOriginAtomic(env, session, origin);
  if (spendable.totalAtomic <= 0n) {
    throw new CustodyActionError(`You do not have any ${origin.symbol} balance to stabilize.`, 400, 'INSUFFICIENT_BALANCE');
  }

  const rawAmount = (input.amount || '').trim();
  let grossAtomic: bigint;
  if (rawAmount.toLowerCase() === 'all' || rawAmount.toLowerCase() === 'max') {
    grossAtomic = spendable.totalAtomic;
  } else {
    try {
      grossAtomic = BigInt(nearRpc.toBaseUnits(rawAmount, origin.decimals) || '0');
    } catch {
      throw new CustodyActionError(`Invalid amount "${rawAmount}".`, 400, 'INVALID_AMOUNT');
    }
  }
  if (grossAtomic <= 0n || grossAtomic > spendable.totalAtomic) {
    throw new CustodyActionError('Invalid or insufficient balance to stabilize.', 400, 'INSUFFICIENT_BALANCE');
  }

  const formattedGross = formatAtomic(grossAtomic.toString(), origin.decimals);
  try {
    assertStabilizeMinimum(origin, grossAtomic, formattedGross);
  } catch (err: any) {
    if (err instanceof StabilizeError) {
      throw new CustodyActionError(err.message, err.httpStatus, err.code);
    }
    throw err;
  }

  const split = computeStabilizeSplit(grossAtomic, origin.decimals, env.FEE_PERCENT);
  const ensured = await ensureOrPrepareSelfCustodyConfidentialFunds({
    env,
    session,
    nearAccount,
    asset: origin.assetId,
    requiredAtomic: split.netInputAtomic,
    nextStep: 'stabilize',
  });
  if (!ensured.ready) return ensured.shieldPrepare;

  const liveQuote = await requestQuote(
    env,
    {
      dry: false,
      swapType: 'EXACT_INPUT',
      originAsset: origin.assetId,
      destinationAsset: destination.assetId,
      amount: split.netInputAtomic.toString(),
      recipient: nearAccount,
      recipientType: 'CONFIDENTIAL_INTENTS',
      refundTo: nearAccount,
      refundType: 'CONFIDENTIAL_INTENTS',
      depositType: 'CONFIDENTIAL_INTENTS',
      confidentiality: 'basic',
      slippageTolerance: STAB_SLIPPAGE_BPS,
      deadline: new Date(Date.now() + STAB_QUOTE_TTL_MS).toISOString(),
    },
    { userSession: ensured.accessToken }
  );

  const depositAddress = liveQuote.quote?.depositAddress;
  if (!depositAddress) {
    throw new CustodyActionError('1Click did not return a swap deposit address.', 502, 'MISSING_DEPOSIT_ADDRESS');
  }

  const generated = await generateSwapIntent(env, {
    depositAddress,
    signerId: nearAccount,
    standard: 'webauthn',
  });
  validateGeneratedIntentForAccount(env, generated, nearAccount);
  const payloadStr = generated.rawPayload || generated.payload.message;

  const amountOutAtomic = BigInt(liveQuote.quote.amountOut || '0');
  const minAmountOutAtomic = BigInt(liveQuote.quote.minAmountOut || liveQuote.quote.amountOut || '0');
  const rawQuoteObj = ((liveQuote.raw as any)?.quote || {}) as Record<string, unknown>;

  const pending = await createPendingCustodyAction({
    env,
    xId: session.x_id,
    actionType: 'STABILIZE_SWAP_INTENT',
    payloadStr,
    meta: {
      nearAccount,
      depositAddress,
      sourceAsset: origin.assetId,
      sourceSymbol: origin.symbol,
      sourceDecimals: origin.decimals,
      targetAsset: destination.assetId,
      targetSymbol: destination.symbol,
      targetDecimals: destination.decimals,
      grossAmount: split.grossAmountFormatted,
      grossAmountAtomic: split.grossAtomic.toString(),
      protocolFee: split.feeAmountFormatted,
      protocolFeeAtomic: split.feeAtomic.toString(),
      feePercent: split.feePercent,
      netAmountIn: split.netInputFormatted,
      netAmountInAtomic: split.netInputAtomic.toString(),
      amountOut: formatAtomic(amountOutAtomic.toString(), destination.decimals),
      amountOutAtomic: amountOutAtomic.toString(),
      minAmountOut: formatAtomic(minAmountOutAtomic.toString(), destination.decimals),
      minAmountOutAtomic: minAmountOutAtomic.toString(),
      amountInUsd: typeof rawQuoteObj.amountInUsd === 'string' ? rawQuoteObj.amountInUsd : null,
      amountOutUsd: typeof rawQuoteObj.amountOutUsd === 'string' ? rawQuoteObj.amountOutUsd : null,
      timeEstimateSeconds: Number(liveQuote.quote.timeEstimate) || 10,
    },
    requireOnchainPasskey: true,
  });

  return {
    step: 'stabilize' as const,
    ...pending,
    summary: {
      sourceSymbol: origin.symbol,
      targetSymbol: destination.symbol,
      netAmountIn: split.netInputFormatted,
      amountOut: formatAtomic(amountOutAtomic.toString(), destination.decimals),
    },
  };
}

export async function submitSelfCustodyStabilize(params: {
  env: Env;
  session: Session;
  actionId: string;
  assertion: any;
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
  if (params.step === 'shield' || peek?.action_type === 'SHIELD_CONFIDENTIAL_INTENT') {
    return await submitConfidentialShieldAction({ env, session, actionId, assertion });
  }

  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<any>({
    env,
    xId: session.x_id,
    actionId,
    assertion,
    expectedActionType: 'STABILIZE_SWAP_INTENT',
    requireOnchainPasskey: true,
  });

  const submitted = await submitSwapIntent(env, signedWebAuthn);
  const settlement = await waitForSettlement(env, session.x_id, meta.depositAddress, {
    timeoutMs: 2_500,
    intervalMs: 800,
  }).catch(() => ({ status: 'PENDING' }));

  const settlementStatus = String(settlement.status || 'PENDING').toUpperCase();
  if (settlementStatus === 'FAILED' || settlementStatus === 'REFUNDED') {
    throw new CustodyActionError(
      `1Click reported stabilization as ${settlementStatus.toLowerCase()}. Your funds remain safely in your wallet.`,
      502,
      'SWAP_SETTLEMENT_FAILED'
    );
  }

  const recordId = `stab_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const isCompleted = settlementStatus === 'SUCCESS';
  await env.DB.prepare(
    `INSERT INTO withdrawals (
      id, x_id, x_handle, asset, amount, destination_address, destination_chain,
      status, tx_hash, deposit_address, privacy_rail, settlement_status,
      created_at, updated_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'near', ?, ?, ?, 'confidential', ?, ?, ?, ?)`
  )
    .bind(
      recordId,
      session.x_id,
      session.x_handle,
      meta.sourceAsset,
      meta.netAmountIn,
      `stabilize:${meta.targetSymbol}:${meta.amountOut}`,
      isCompleted ? 'COMPLETED' : 'PENDING',
      submitted.intentHash || meta.depositAddress,
      meta.depositAddress,
      settlementStatus,
      Date.now(),
      Date.now(),
      isCompleted ? Date.now() : null
    )
    .run()
    .catch(() => {});

  return {
    step: 'stabilize' as const,
    result: {
      id: recordId,
      status: isCompleted ? 'SUCCESS' : settlementStatus,
      depositAddress: meta.depositAddress,
      intentHash: submitted.intentHash,
      shieldedAtomic: '0',
      sourceAsset: meta.sourceAsset,
      sourceSymbol: meta.sourceSymbol,
      sourceDecimals: meta.sourceDecimals,
      targetAsset: meta.targetAsset,
      targetSymbol: meta.targetSymbol,
      targetDecimals: meta.targetDecimals,
      grossAmount: meta.netAmountIn,
      grossAmountAtomic: meta.netAmountInAtomic,
      protocolFee: '0',
      protocolFeeAtomic: '0',
      feePercent: 0,
      netAmountIn: meta.netAmountIn,
      netAmountInAtomic: meta.netAmountInAtomic,
      amountOut: meta.amountOut,
      amountOutAtomic: meta.amountOutAtomic,
      minAmountOut: meta.minAmountOut,
      minAmountOutAtomic: meta.minAmountOutAtomic,
      amountInUsd: meta.amountInUsd,
      amountOutUsd: meta.amountOutUsd,
      protocolFeeUsd: null,
      exchangeRate: '0',
      slippageBps: STAB_SLIPPAGE_BPS,
      timeEstimateSeconds: meta.timeEstimateSeconds,
      confidential: true,
      gasSponsored: true,
    },
  };
}

export async function isOneClickSessionReady(env: Env, xId: string): Promise<boolean> {
  return await hasCachedOneClickSession(env, xId);
}
