/**
 * 1-to-1 Timelocked Earn Vault Gifting Service (`worker/src/services/gifts.ts`).
 *
 * Every gift is an Earn Vault position (e.g. TLO, gtUSDCp, kV-gtSOLb) addressed
 * strictly to an 𝕏 handle (`@handle`). Principal is routed into a dedicated
 * per-gift custody account on `intents.near`, where shares compound yield until
 * `timelock_until`.
 *
 * Security invariants:
 *   - Vault asset must be on the server-side Earn allowlist (`resolveEarnVault`).
 *   - 1% protocol fee carved out at funding; 99% net principal enters the vault.
 *   - No cancellation after funding (`status = 'LOCKED'`).
 *   - Strict anti-IDOR: private details (message, exact amount/yield unless opted in)
 *     are visible ONLY to the authenticated sender or recipient.
 *   - Claiming requires WebAuthn passkey assertion, recipient ownership match,
 *     server-side `Date.now() >= timelock_until`, and an atomic `LOCKED -> CLAIMING`
 *     CAS transition to prevent double-claims.
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
  transferFromEarnCustody,
  type EarnVaultDescriptor,
} from './earnVaults';

export class GiftError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'GiftError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const VALID_GIFT_OCCASIONS = [
  'BIRTHDAY',
  'CHRISTMAS',
  'HOLIDAY',
  'NEW_YEAR',
  'ANNIVERSARY',
  'GRADUATION',
  'WEDDING',
  'THANK_YOU',
  'CONGRATS',
  'JUST_BECAUSE',
  'CUSTOM',
] as const;

export type GiftOccasion = (typeof VALID_GIFT_OCCASIONS)[number];

export const OCCASION_LABELS: Record<GiftOccasion, string> = {
  BIRTHDAY: 'Birthday Gift',
  CHRISTMAS: 'Christmas Gift',
  HOLIDAY: 'Holiday Gift',
  NEW_YEAR: 'New Year Gift',
  ANNIVERSARY: 'Anniversary Gift',
  GRADUATION: 'Graduation Gift',
  WEDDING: 'Wedding Gift',
  THANK_YOU: 'Thank You Gift',
  CONGRATS: 'Congratulations',
  JUST_BECAUSE: 'Surprise Gift',
  CUSTOM: 'Custom Gift',
};

export const MIN_TIMELOCK_LEAD_MS = 60 * 60 * 1000; // 1 hour minimum lock
export const MAX_TIMELOCK_LEAD_MS = 5 * 365 * 24 * 60 * 60 * 1000; // 5 years max lock
const PENDING_GIFT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours for external deposit

export interface QuoteGiftInput {
  vaultAsset: string;
  sourceAsset: string;
  amount: string;
  zeroFee?: boolean;
}

export interface QuoteGiftResult {
  vault: EarnVaultDescriptor;
  vaultSymbol: string;
  vaultName: string;
  vaultAssetId: string;
  vaultProtocol: string;
  vaultDecimals: number;
  sourceAsset: string;
  sourceSymbol: string;
  sourceDecimals: number;
  grossAmount: string;
  grossAtomic: string;
  protocolFee: string;
  protocolFeeAtomic: string;
  feePercent: number;
  netAmountIn: string;
  netAmountInAtomic: string;
  estimatedSharesAtomic: string;
  estimatedSharesFormatted: string;
  estimatedSharesOut: string;
  principalUsdCents: number;
  estimatedApyPct: number;
}

export interface CreateGiftInput {
  recipientHandle: string;
  occasion: string;
  customOccasion?: string;
  message?: string;
  showAmount?: boolean;
  vaultAsset: string;
  sourceAsset: string;
  amount: string;
  timelockUntil: number;
  fundingMode?: 'BALANCE' | 'EXTERNAL_DEPOSIT';
}

export interface PublicGiftCardView {
  id: string;
  senderHandle: string;
  recipientHandle: string;
  occasion: GiftOccasion;
  occasionLabel: string;
  vaultSymbol: string;
  vaultName: string;
  vaultProtocol: string;
  vaultChainName: string;
  estimatedApyPct: number;
  timelockUntil: number;
  isUnlocked: boolean;
  status: string;
  showAmount: boolean;
  principalUsdCents?: number;
  currentValueUsdCents?: number;
  yieldUsdCents?: number;
  sharesFormatted?: string;
  shareUrl: string;
  ogImageUrl: string;
  createdAt: number;
  claimedAt?: number | null;
}

export interface AuthenticatedGiftView extends PublicGiftCardView {
  role: 'SENDER' | 'RECIPIENT';
  message: string | null;
  sourceSymbol: string;
  grossAmount: string;
  principalUsdCents: number;
  currentValueUsdCents: number;
  yieldUsdCents: number;
  yieldPct: number;
  sharesAtomic: string;
  sharesFormatted: string;
  custodyAccount: string;
  depositAddress?: string | null;
  depositMemo?: string | null;
  claimTxHash?: string | null;
  canClaim: boolean;
}

export function validateOccasion(raw: string): GiftOccasion {
  const upper = (raw || '').trim().toUpperCase();
  if ((VALID_GIFT_OCCASIONS as readonly string[]).includes(upper)) {
    return upper as GiftOccasion;
  }
  throw new GiftError(
    'INVALID_OCCASION',
    `Occasion must be one of: ${VALID_GIFT_OCCASIONS.join(', ')}.`,
    400
  );
}

export function resolveOccasionDisplay(rawOccasion: string): {
  occasion: GiftOccasion;
  occasionLabel: string;
} {
  const raw = String(rawOccasion || 'JUST_BECAUSE');
  if (raw.startsWith('CUSTOM:')) {
    const label = raw.slice(7).trim() || OCCASION_LABELS.CUSTOM;
    return { occasion: 'CUSTOM', occasionLabel: label };
  }
  if ((VALID_GIFT_OCCASIONS as readonly string[]).includes(raw)) {
    const occ = raw as GiftOccasion;
    return { occasion: occ, occasionLabel: OCCASION_LABELS[occ] };
  }
  if (raw.trim()) {
    return { occasion: 'CUSTOM', occasionLabel: raw.trim() };
  }
  return { occasion: 'JUST_BECAUSE', occasionLabel: OCCASION_LABELS.JUST_BECAUSE };
}

export function validateTimelockUntil(timelockUntil: number, now = Date.now()): number {
  const ts = Number(timelockUntil);
  if (!Number.isFinite(ts) || ts <= 0) {
    throw new GiftError('INVALID_TIMELOCK', 'Specify a valid unlock date and time.', 400);
  }
  if (ts < now + MIN_TIMELOCK_LEAD_MS) {
    throw new GiftError(
      'TIMELOCK_TOO_SOON',
      'Gift unlock time must be at least 1 hour in the future.',
      400
    );
  }
  if (ts > now + MAX_TIMELOCK_LEAD_MS) {
    throw new GiftError(
      'TIMELOCK_TOO_FAR',
      'Gift unlock time cannot exceed 5 years in the future.',
      400
    );
  }
  return Math.floor(ts);
}

/**
 * Dry-quotes an Earn Vault deposit for a Gift or Circle contribution.
 */
export async function quoteGift(
  env: Env,
  input: QuoteGiftInput
): Promise<QuoteGiftResult> {
  const oneClickTokens = await getOneClickTokens(env).catch(() => [] as OneClickToken[]);
  let vault: EarnVaultDescriptor;
  try {
    vault = await resolveEarnVault(env, input.vaultAsset, oneClickTokens);
  } catch (err: any) {
    if (err instanceof EarnVaultError) {
      throw new GiftError(err.code, err.message, err.httpStatus);
    }
    throw err;
  }

  const origin = await resolveOriginToken(env, input.sourceAsset, oneClickTokens).catch((err) => {
    throw new GiftError('UNSUPPORTED_SOURCE_ASSET', err?.message || 'Unsupported payment token.', 400);
  });

  const rawAmt = (input.amount || '').trim();
  if (!rawAmt || !/^\d+(\.\d+)?$/.test(rawAmt) || Number(rawAmt) <= 0) {
    throw new GiftError('INVALID_AMOUNT', 'Enter a valid positive token amount.', 400);
  }

  const grossAtomicStr = nearRpc.toBaseUnits(rawAmt, origin.decimals);
  const grossAtomic = BigInt(grossAtomicStr || '0');
  if (grossAtomic <= 0n) {
    throw new GiftError('INVALID_AMOUNT', 'Amount must be greater than zero.', 400);
  }

  const originPrice =
    typeof origin.priceUsd === 'number' && origin.priceUsd > 0
      ? origin.priceUsd
      : origin.symbol === 'USDC' || origin.symbol === 'USDT'
      ? 1
      : 0;
  const estUsd = originPrice > 0 ? Number(rawAmt) * originPrice : 0;
  if (estUsd > 0 && estUsd + 0.05 < vault.minDepositUsd) {
    throw new GiftError(
      'BELOW_VAULT_MINIMUM',
      `Minimum deposit for ${vault.name} (${vault.symbol}) is $${vault.minDepositUsd} USD.`,
      400
    );
  }

  const split = input.zeroFee
    ? {
        grossAtomic,
        feeAtomic: 0n,
        netInputAtomic: grossAtomic,
        feePercent: 0,
        grossAmountFormatted: formatAtomic(grossAtomic.toString(), origin.decimals),
        feeAmountFormatted: '0',
        netInputFormatted: formatAtomic(grossAtomic.toString(), origin.decimals),
      }
    : computeStabilizeSplit(grossAtomic, origin.decimals, env.FEE_PERCENT);
  const dummyCustody = '4ced75a94459bfd82b48a3d3116b2d2d76261f134f1efb5140f974e9443b0560';
  const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  let quotedSharesAtomic = 0n;
  let quotedUsdCents = Math.max(
    100,
    Math.round(estUsd * (input.zeroFee ? 1 : 0.99) * 100)
  );

  try {
    const q = await requestQuote(env, {
      dry: true,
      swapType: 'EXACT_INPUT',
      originAsset: origin.assetId,
      destinationAsset: vault.assetId,
      amount: split.netInputAtomic.toString(),
      recipient: dummyCustody,
      recipientType: 'INTENTS',
      refundTo: dummyCustody,
      refundType: 'INTENTS',
      depositType: 'INTENTS',
      slippageTolerance: 150,
      deadline,
    });
    quotedSharesAtomic = BigInt(q.quote.amountOut || q.quote.minAmountOut || '0');
    const rawQ = ((q.raw as any)?.quote || {}) as Record<string, unknown>;
    const inUsd = Number(rawQ.amountInUsd || 0);
    if (Number.isFinite(inUsd) && inUsd > 0) {
      quotedUsdCents = Math.round(inUsd * 100);
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/no liquidity/i.test(msg)) {
      throw new GiftError(
        'NO_VAULT_LIQUIDITY',
        `1Click reported no liquidity for ${origin.symbol} → ${vault.symbol} at this size. Try at least $${vault.minDepositUsd} USD.`,
        400
      );
    }
    throw new GiftError('QUOTE_FAILED', `Could not quote ${vault.symbol} vault deposit: ${msg}`, 502);
  }

  if (quotedSharesAtomic <= 0n) {
    throw new GiftError('QUOTE_FAILED', `1Click returned 0 ${vault.symbol} vault shares.`, 502);
  }

  const formattedShares = formatAtomic(quotedSharesAtomic.toString(), vault.decimals);
  return {
    vault,
    vaultSymbol: vault.symbol,
    vaultName: vault.name,
    vaultAssetId: vault.assetId,
    vaultProtocol: vault.protocol,
    vaultDecimals: vault.decimals,
    sourceAsset: origin.assetId,
    sourceSymbol: origin.symbol,
    sourceDecimals: origin.decimals,
    grossAmount: split.grossAmountFormatted,
    grossAtomic: split.grossAtomic.toString(),
    protocolFee: split.feeAmountFormatted,
    protocolFeeAtomic: split.feeAtomic.toString(),
    feePercent: split.feePercent,
    netAmountIn: split.netInputFormatted,
    netAmountInAtomic: split.netInputAtomic.toString(),
    estimatedSharesAtomic: quotedSharesAtomic.toString(),
    estimatedSharesFormatted: formattedShares,
    estimatedSharesOut: formattedShares,
    principalUsdCents: quotedUsdCents,
    estimatedApyPct: vault.estimatedApyPct,
  };
}

/**
 * Creates and funds a 1-to-1 Timelocked Earn Vault Gift.
 */
export async function createGift(
  env: Env,
  session: Session,
  input: CreateGiftInput
): Promise<AuthenticatedGiftView> {
  let recipientHandle: string;
  try {
    recipientHandle = normalizeAndValidateHandle(input.recipientHandle, 'Recipient handle');
  } catch (err: any) {
    throw new GiftError(err.code || 'INVALID_HANDLE', err.message, 400);
  }

  const senderHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
  if (recipientHandle === senderHandle) {
    throw new GiftError('SELF_GIFT_FORBIDDEN', 'You cannot send a timelocked gift to yourself.', 400);
  }

  const occasion = validateOccasion(input.occasion);
  let storedOccasion: string = occasion;
  if (occasion === 'CUSTOM') {
    const customLabel = sanitizeUserText(input.customOccasion, 48);
    if (!customLabel || customLabel.length < 2) {
      throw new GiftError('INVALID_OCCASION', 'Enter a custom occasion (2–48 characters).', 400);
    }
    storedOccasion = `CUSTOM:${customLabel}`;
  }
  const now = Date.now();
  const timelockUntil = validateTimelockUntil(input.timelockUntil, now);
  const message = sanitizeUserText(input.message, 280) || null;
  const showAmount = input.showAmount ? 1 : 0;
  const fundingMode = input.fundingMode === 'EXTERNAL_DEPOSIT' ? 'EXTERNAL_DEPOSIT' : 'BALANCE';

  // Resolve recipient X identity if already registered on UPRAIL
  let recipientXId: string | null = null;
  const recipientRow = await env.DB.prepare(
    'SELECT x_id, x_handle FROM x_identities WHERE LOWER(x_handle) = ? LIMIT 1'
  )
    .bind(recipientHandle)
    .first<{ x_id: string; x_handle: string }>();

  if (recipientRow) {
    if (recipientRow.x_id === session.x_id) {
      throw new GiftError('SELF_GIFT_FORBIDDEN', 'You cannot send a timelocked gift to yourself.', 400);
    }
    recipientXId = recipientRow.x_id;
  }

  const oneClickTokens = await getOneClickTokens(env).catch(() => [] as OneClickToken[]);
  let vault: EarnVaultDescriptor;
  try {
    vault = await resolveEarnVault(env, input.vaultAsset, oneClickTokens);
  } catch (err: any) {
    throw new GiftError(err.code || 'UNSUPPORTED_EARN_VAULT', err.message, 400);
  }

  const origin = await resolveOriginToken(env, input.sourceAsset, oneClickTokens).catch((err) => {
    throw new GiftError('UNSUPPORTED_SOURCE_ASSET', err?.message || 'Unsupported payment token.', 400);
  });

  const rawAmt = (input.amount || '').trim();
  if (!rawAmt || !/^\d+(\.\d+)?$/.test(rawAmt) || Number(rawAmt) <= 0) {
    throw new GiftError('INVALID_AMOUNT', 'Enter a valid positive token amount.', 400);
  }

  const grossAtomicStr = nearRpc.toBaseUnits(rawAmt, origin.decimals);
  const grossAtomic = BigInt(grossAtomicStr || '0');
  if (grossAtomic <= 0n) {
    throw new GiftError('INVALID_AMOUNT', 'Amount must be greater than zero.', 400);
  }

  const originPrice =
    typeof origin.priceUsd === 'number' && origin.priceUsd > 0
      ? origin.priceUsd
      : origin.symbol === 'USDC' || origin.symbol === 'USDT'
      ? 1
      : 0;
  const estUsd = originPrice > 0 ? Number(rawAmt) * originPrice : 0;
  if (estUsd > 0 && estUsd + 0.05 < vault.minDepositUsd) {
    throw new GiftError(
      'BELOW_VAULT_MINIMUM',
      `Minimum deposit for ${vault.name} (${vault.symbol}) is $${vault.minDepositUsd} USD.`,
      400
    );
  }

  const split = computeStabilizeSplit(grossAtomic, origin.decimals, env.FEE_PERCENT);
  const giftId = generateSecureId('gft');
  const custody = await deriveEarnCustodyKey(env, giftId);
  const senderNearAccount = await nearRpc.resolveUserNearAccount(env, session);
  const expiresAt = now + PENDING_GIFT_TTL_MS;
  const deadline = new Date(expiresAt).toISOString();

  if (fundingMode === 'BALANCE') {
    // 1. Ensure any plain balance is moved into Intents first
    try {
      await nearRpc.depositPlainBalanceToIntents(
        env,
        session.x_id,
        origin.assetId,
        split.grossAmountFormatted,
        senderNearAccount
      );
    } catch {}

    // 2. Check user available balance
    const avail = await nearRpc.getUserAvailableBalance(env, session, origin.assetId);
    const reqNum = Number(split.grossAmountFormatted);
    if (avail + 1e-6 < reqNum) {
      throw new GiftError(
        'INSUFFICIENT_BALANCE',
        `Insufficient ${origin.symbol} balance (${avail.toFixed(4)} available, ${split.grossAmountFormatted} required).`,
        400
      );
    }

    // 3. Request live 1Click quote from sender's Intents balance -> custody account's Earn Vault shares
    let liveQuote;
    try {
      liveQuote = await requestQuote(env, {
        dry: false,
        swapType: 'EXACT_INPUT',
        originAsset: origin.assetId,
        destinationAsset: vault.assetId,
        amount: split.netInputAtomic.toString(),
        recipient: custody.accountId,
        recipientType: 'INTENTS',
        refundTo: senderNearAccount,
        refundType: 'INTENTS',
        depositType: 'INTENTS',
        slippageTolerance: 200,
        deadline,
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      throw new GiftError(
        'QUOTE_FAILED',
        `1Click could not quote ${origin.symbol} → ${vault.symbol}: ${msg}`,
        502
      );
    }

    const quotedSharesAtomic = BigInt(
      liveQuote.quote.amountOut || liveQuote.quote.minAmountOut || '0'
    );
    if (quotedSharesAtomic <= 0n) {
      throw new GiftError('QUOTE_FAILED', '1Click returned 0 vault shares.', 502);
    }

    const rawQ = ((liveQuote.raw as any)?.quote || {}) as Record<string, unknown>;
    const inUsd = Number(rawQ.amountInUsd || estUsd * 0.99);
    const principalUsdCents = Math.max(100, Math.round((Number.isFinite(inUsd) && inUsd > 0 ? inUsd : estUsd) * 100));

    // 4. Execute swap transfer from sender's Intents balance to 1Click depositAddress
    const swapRes = await nearRpc.executeCrossChainSwapTransfer(
      env,
      session.x_id,
      liveQuote.quote.depositAddress
    );
    if (!swapRes.success) {
      throw new GiftError(
        'FUNDING_FAILED',
        `Failed to fund Earn vault gift: ${swapRes.error || 'Swap transfer rejected'}`,
        502
      );
    }

    // 5. Transfer 1% protocol fee to fee/escrow account (best-effort after swap funding)
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

    await env.DB.prepare(
      `INSERT INTO gifts (
        id, sender_x_id, sender_handle, recipient_handle, recipient_x_id,
        occasion, message, show_amount,
        vault_asset_id, vault_symbol, vault_decimals,
        source_asset, source_symbol, source_decimals,
        gross_atomic, principal_usd_cents,
        custody_account, deposit_address, deposit_memo,
        quoted_shares_atomic, balance_before_atomic, shares_atomic,
        fee_shares_atomic, fee_status, fee_tx_hash,
        timelock_until, status, intent_hash,
        expires_at, created_at, updated_at, funded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', ?, '0', ?, ?, ?, 'LOCKED', ?, ?, ?, ?, ?)`
    )
      .bind(
        giftId,
        session.x_id,
        senderHandle,
        recipientHandle,
        recipientXId,
        storedOccasion,
        message,
        showAmount,
        vault.assetId,
        vault.symbol,
        vault.decimals,
        origin.assetId,
        origin.symbol,
        origin.decimals,
        split.grossAtomic.toString(),
        principalUsdCents,
        custody.accountId,
        liveQuote.quote.depositAddress,
        liveQuote.quote.depositMemo || null,
        quotedSharesAtomic.toString(),
        quotedSharesAtomic.toString(),
        feeStatus,
        feeTxHash,
        timelockUntil,
        swapRes.txHash || null,
        expiresAt,
        now,
        now,
        now
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
      .bind(giftId)
      .first<any>();
    return formatAuthenticatedGiftView(env, row, 'SENDER', vault);
  }

  // EXTERNAL_DEPOSIT mode: generate a 1Click FLEX_INPUT deposit address into custody.accountId
  let extQuote;
  try {
    extQuote = await requestQuote(env, {
      dry: false,
      swapType: 'FLEX_INPUT',
      originAsset: origin.assetId,
      destinationAsset: vault.assetId,
      amount: split.grossAtomic.toString(),
      recipient: custody.accountId,
      recipientType: 'INTENTS',
      refundTo: senderNearAccount,
      refundType: 'INTENTS',
      depositType: 'ORIGIN_CHAIN',
      slippageTolerance: 300,
      deadline,
    });
  } catch (err: any) {
    throw new GiftError(
      'QUOTE_FAILED',
      `1Click could not create deposit quote for ${vault.symbol}: ${err?.message || String(err)}`,
      502
    );
  }

  const grossShares = BigInt(extQuote.quote.amountOut || extQuote.quote.minAmountOut || '0');
  if (grossShares <= 0n) {
    throw new GiftError('QUOTE_FAILED', '1Click returned 0 vault shares.', 502);
  }
  const shareSplit = computeStabilizeSplit(grossShares, vault.decimals, env.FEE_PERCENT);
  const rawQ = ((extQuote.raw as any)?.quote || {}) as Record<string, unknown>;
  const inUsd = Number(rawQ.amountInUsd || estUsd);
  const principalUsdCents = Math.max(
    100,
    Math.round((Number.isFinite(inUsd) && inUsd > 0 ? inUsd * 0.99 : estUsd * 0.99) * 100)
  );

  await env.DB.prepare(
    `INSERT INTO gifts (
      id, sender_x_id, sender_handle, recipient_handle, recipient_x_id,
      occasion, message, show_amount,
      vault_asset_id, vault_symbol, vault_decimals,
      source_asset, source_symbol, source_decimals,
      gross_atomic, principal_usd_cents,
      custody_account, deposit_address, deposit_memo,
      quoted_shares_atomic, balance_before_atomic, shares_atomic,
      fee_shares_atomic, fee_status,
      timelock_until, status,
      expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', NULL, ?, 'PENDING', ?, 'PENDING_FUNDING', ?, ?, ?)`
  )
    .bind(
      giftId,
      session.x_id,
      senderHandle,
      recipientHandle,
      recipientXId,
      storedOccasion,
      message,
      showAmount,
      vault.assetId,
      vault.symbol,
      vault.decimals,
      origin.assetId,
      origin.symbol,
      origin.decimals,
      split.grossAtomic.toString(),
      principalUsdCents,
      custody.accountId,
      extQuote.quote.depositAddress,
      extQuote.quote.depositMemo || null,
      shareSplit.netInputAtomic.toString(),
      shareSplit.feeAtomic.toString(),
      timelockUntil,
      expiresAt,
      now,
      now
    )
    .run();

  const row = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
    .bind(giftId)
    .first<any>();
  return formatAuthenticatedGiftView(env, row, 'SENDER', vault);
}

/**
 * Polls 1Click status for a `PENDING_FUNDING` gift and transitions it to `LOCKED`
 * once the deposit settles into the per-gift custody account, carving out the 1%
 * protocol fee to `FEE_ACCOUNT_ID || ESCROW_ACCOUNT_ID`.
 */
export async function checkAndSettleGiftFunding(
  env: Env,
  giftId: string
): Promise<any> {
  const row = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
    .bind(giftId)
    .first<any>();
  if (!row) {
    throw new GiftError('NOT_FOUND', 'Gift not found.', 404);
  }
  if (row.status !== 'PENDING_FUNDING') {
    return row;
  }

  const now = Date.now();
  if (row.expires_at < now) {
    await env.DB.prepare(
      "UPDATE gifts SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status = 'PENDING_FUNDING'"
    )
      .bind(now, giftId)
      .run();
    return { ...row, status: 'EXPIRED' };
  }

  if (!row.deposit_address) return row;

  try {
    const execStatus = await getExecutionStatus(
      env,
      row.deposit_address,
      row.deposit_memo || undefined
    );
    const remote = String(execStatus.status || '').toUpperCase();
    if (remote === 'FAILED' || remote === 'REFUNDED') {
      await env.DB.prepare(
        "UPDATE gifts SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status = 'PENDING_FUNDING'"
      )
        .bind(now, giftId)
        .run();
      return { ...row, status: 'EXPIRED' };
    }
    if (remote !== 'SUCCESS') {
      return row;
    }

    const rawOut =
      (execStatus.swapDetails as any)?.amountOut ||
      (execStatus.raw as any)?.quoteResponse?.quote?.amountOut ||
      row.quoted_shares_atomic;
    const totalSettled = BigInt(String(rawOut || row.quoted_shares_atomic));
    const shareSplit = computeStabilizeSplit(totalSettled, Number(row.vault_decimals || 18), env.FEE_PERCENT);

    let feeTxHash: string | null = null;
    let feeStatus = 'NONE';
    if (shareSplit.feeAtomic > 0n) {
      const feeRecipient = env.FEE_ACCOUNT_ID || env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
      const feeRes = await transferFromEarnCustody(
        env,
        giftId,
        feeRecipient,
        row.vault_asset_id,
        shareSplit.feeAtomic
      ).catch(() => ({ success: false, txHash: undefined }));
      if (feeRes.success) {
        feeStatus = 'PAID';
        feeTxHash = feeRes.txHash || null;
      }
    }

    await env.DB.prepare(
      `UPDATE gifts
       SET status = 'LOCKED',
           shares_atomic = ?,
           fee_shares_atomic = ?,
           fee_status = ?,
           fee_tx_hash = ?,
           intent_hash = COALESCE(intent_hash, ?),
           funded_at = ?,
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
        giftId
      )
      .run();

    return (
      (await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
        .bind(giftId)
        .first<any>()) || row
    );
  } catch {
    return row;
  }
}

/**
 * Public SEO / Share card view (`GET /api/gifts/public/:id`).
 * Never exposes private message, custody account, or amounts unless `show_amount = 1`.
 */
export async function getPublicGiftCardView(
  env: Env,
  giftId: string
): Promise<PublicGiftCardView> {
  const cleanId = (giftId || '').trim();
  if (!/^gft_[a-f0-9]{16,64}$/.test(cleanId)) {
    throw new GiftError('NOT_FOUND', 'Gift not found.', 404);
  }

  let row = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
    .bind(cleanId)
    .first<any>();
  if (!row) {
    throw new GiftError('NOT_FOUND', 'Gift not found.', 404);
  }
  if (row.status === 'PENDING_FUNDING') {
    row = await checkAndSettleGiftFunding(env, cleanId);
  }

  const vaults = await getEarnVaults(env);
  const vault =
    vaults.find((v) => v.assetId.toLowerCase() === String(row.vault_asset_id).toLowerCase()) ||
    vaults[0];

  const now = Date.now();
  const timelockUntil = Number(row.timelock_until);
  const isUnlocked = now >= timelockUntil;
  const { occasion, occasionLabel } = resolveOccasionDisplay(row.occasion);
  const showAmount = Number(row.show_amount) === 1;

  const baseView: PublicGiftCardView = {
    id: row.id,
    senderHandle: row.sender_handle,
    recipientHandle: row.recipient_handle,
    occasion,
    occasionLabel,
    vaultSymbol: row.vault_symbol,
    vaultName: vault?.name || row.vault_symbol,
    vaultProtocol: vault?.protocol || 'NEAR Intents Earn',
    vaultChainName: vault?.chainName || 'Multichain',
    estimatedApyPct: vault?.estimatedApyPct ?? 6.5,
    timelockUntil,
    isUnlocked,
    status: row.status,
    showAmount,
    shareUrl: `https://uprail.world/gift/${encodeURIComponent(row.id)}`,
    ogImageUrl: `https://app.uprail.world/og/gift/${encodeURIComponent(row.id)}.png`,
    createdAt: Number(row.created_at),
    claimedAt: row.claimed_at ? Number(row.claimed_at) : null,
  };

  if (showAmount) {
    const valuation = computeVaultPositionValuation({
      sharesAtomic: row.shares_atomic || row.quoted_shares_atomic,
      vaultDecimals: Number(row.vault_decimals || vault?.decimals || 18),
      sharePriceUsd: vault?.priceUsd || 0,
      principalUsdCents: Number(row.principal_usd_cents || 0),
    });
    baseView.principalUsdCents = valuation.principalUsdCents;
    baseView.currentValueUsdCents = valuation.currentValueUsdCents;
    baseView.yieldUsdCents = valuation.yieldUsdCents;
    baseView.sharesFormatted = valuation.sharesFormatted;
  }

  return baseView;
}

async function formatAuthenticatedGiftView(
  env: Env,
  row: any,
  role: 'SENDER' | 'RECIPIENT',
  preloadedVault?: EarnVaultDescriptor
): Promise<AuthenticatedGiftView> {
  const vaults = preloadedVault ? [preloadedVault] : await getEarnVaults(env);
  const vault =
    vaults.find((v) => v.assetId.toLowerCase() === String(row.vault_asset_id).toLowerCase()) ||
    vaults[0];

  const sharesAtomicStr = String(row.shares_atomic || row.quoted_shares_atomic || '0');
  const valuation = computeVaultPositionValuation({
    sharesAtomic: sharesAtomicStr,
    vaultDecimals: Number(row.vault_decimals || vault?.decimals || 18),
    sharePriceUsd: vault?.priceUsd || 0,
    principalUsdCents: Number(row.principal_usd_cents || 0),
  });

  const now = Date.now();
  const timelockUntil = Number(row.timelock_until);
  const isUnlocked = now >= timelockUntil;
  const { occasion, occasionLabel } = resolveOccasionDisplay(row.occasion);

  return {
    id: row.id,
    role,
    senderHandle: row.sender_handle,
    recipientHandle: row.recipient_handle,
    occasion,
    occasionLabel,
    message: row.message || null,
    vaultSymbol: row.vault_symbol,
    vaultName: vault?.name || row.vault_symbol,
    vaultProtocol: vault?.protocol || 'NEAR Intents Earn',
    vaultChainName: vault?.chainName || 'Multichain',
    estimatedApyPct: vault?.estimatedApyPct ?? 6.5,
    sourceSymbol: row.source_symbol,
    grossAmount: formatAtomic(String(row.gross_atomic || '0'), Number(row.source_decimals || 6)),
    principalUsdCents: valuation.principalUsdCents,
    currentValueUsdCents: valuation.currentValueUsdCents,
    yieldUsdCents: valuation.yieldUsdCents,
    yieldPct: valuation.yieldPct,
    sharesAtomic: valuation.sharesAtomic,
    sharesFormatted: valuation.sharesFormatted,
    custodyAccount: row.custody_account,
    depositAddress: row.deposit_address || null,
    depositMemo: row.deposit_memo || null,
    timelockUntil,
    isUnlocked,
    status: row.status,
    showAmount: Number(row.show_amount) === 1,
    claimTxHash: row.claim_tx_hash || null,
    canClaim: role === 'RECIPIENT' && row.status === 'LOCKED' && isUnlocked,
    shareUrl: `https://uprail.world/gift/${encodeURIComponent(row.id)}`,
    ogImageUrl: `https://app.uprail.world/og/gift/${encodeURIComponent(row.id)}.png`,
    createdAt: Number(row.created_at),
    claimedAt: row.claimed_at ? Number(row.claimed_at) : null,
  };
}

/**
 * Authenticated single-gift read (`GET /api/gifts/:id`).
 * Enforces strict anti-IDOR: only the sender or recipient may access.
 */
export async function getAuthenticatedGift(
  env: Env,
  session: Session,
  giftId: string
): Promise<AuthenticatedGiftView> {
  const cleanId = (giftId || '').trim();
  if (!/^gft_[a-f0-9]{16,64}$/.test(cleanId)) {
    throw new GiftError('NOT_FOUND', 'Gift not found.', 404);
  }

  let row = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
    .bind(cleanId)
    .first<any>();
  if (!row) {
    throw new GiftError('NOT_FOUND', 'Gift not found.', 404);
  }

  const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
  const isSender = row.sender_x_id === session.x_id;
  const isRecipientById = Boolean(row.recipient_x_id && row.recipient_x_id === session.x_id);
  const isRecipientByHandle =
    !row.recipient_x_id &&
    Boolean(callerHandle && String(row.recipient_handle || '').toLowerCase() === callerHandle);

  if (!isSender && !isRecipientById && !isRecipientByHandle) {
    throw new GiftError(
      'FORBIDDEN',
      'You do not have permission to view this gift.',
      403
    );
  }

  // Bind recipient_x_id lazily once the recipient signs in
  if (isRecipientByHandle && !row.recipient_x_id) {
    await env.DB.prepare(
      'UPDATE gifts SET recipient_x_id = ?, updated_at = ? WHERE id = ? AND recipient_x_id IS NULL'
    )
      .bind(session.x_id, Date.now(), cleanId)
      .run()
      .catch(() => {});
    row.recipient_x_id = session.x_id;
  }

  if (row.status === 'PENDING_FUNDING') {
    row = await checkAndSettleGiftFunding(env, cleanId);
  }

  const role: 'SENDER' | 'RECIPIENT' = isSender ? 'SENDER' : 'RECIPIENT';
  return formatAuthenticatedGiftView(env, row, role);
}

/**
 * Lists all gifts sent by or received by the authenticated user.
 * Automatically binds any unclaimed gifts addressed to `session.x_handle` where `recipient_x_id IS NULL`.
 */
export async function listUserGifts(
  env: Env,
  session: Session
): Promise<{ sent: AuthenticatedGiftView[]; received: AuthenticatedGiftView[] }> {
  const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();

  if (callerHandle) {
    await env.DB.prepare(
      'UPDATE gifts SET recipient_x_id = ?, updated_at = ? WHERE LOWER(recipient_handle) = ? AND recipient_x_id IS NULL'
    )
      .bind(session.x_id, Date.now(), callerHandle)
      .run()
      .catch(() => {});
  }

  const vaults = await getEarnVaults(env);
  const byAsset = new Map<string, EarnVaultDescriptor>();
  for (const v of vaults) byAsset.set(v.assetId.toLowerCase(), v);

  const [sentRows, receivedRows] = await Promise.all([
    env.DB.prepare('SELECT * FROM gifts WHERE sender_x_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(session.x_id)
      .all<any>(),
    env.DB.prepare(
      'SELECT * FROM gifts WHERE (recipient_x_id = ? OR (recipient_x_id IS NULL AND LOWER(recipient_handle) = ?)) AND status != ? ORDER BY created_at DESC LIMIT 50'
    )
      .bind(session.x_id, callerHandle, 'EXPIRED')
      .all<any>(),
  ]);

  const sent = await Promise.all(
    (sentRows.results || []).map((r) =>
      formatAuthenticatedGiftView(
        env,
        r,
        'SENDER',
        byAsset.get(String(r.vault_asset_id).toLowerCase())
      )
    )
  );
  const received = await Promise.all(
    (receivedRows.results || []).map((r) =>
      formatAuthenticatedGiftView(
        env,
        r,
        'RECIPIENT',
        byAsset.get(String(r.vault_asset_id).toLowerCase())
      )
    )
  );

  return { sent, received };
}

/**
 * Passkey-gated, IDOR-proof, timelock-enforced Gift Claim (`POST /api/gifts/:id/claim`).
 * Transfers 100% of the Earn vault shares (principal + accrued yield) from the
 * gift's custody account to the recipient's UPRAIL Intents account.
 */
export async function claimGift(
  env: Env,
  session: Session,
  giftId: string
): Promise<AuthenticatedGiftView> {
  const cleanId = (giftId || '').trim();
  if (!/^gft_[a-f0-9]{16,64}$/.test(cleanId)) {
    throw new GiftError('NOT_FOUND', 'Gift not found.', 404);
  }

  const row = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
    .bind(cleanId)
    .first<any>();
  if (!row) {
    throw new GiftError('NOT_FOUND', 'Gift not found.', 404);
  }

  const callerHandle = (session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
  const recipientHandle = String(row.recipient_handle || '').trim().toLowerCase();

  // Strict anti-IDOR ownership verification
  if (row.recipient_x_id) {
    if (row.recipient_x_id !== session.x_id) {
      throw new GiftError(
        'FORBIDDEN',
        'Only the designated recipient of this gift can unwrap and claim it.',
        403
      );
    }
  } else {
    if (!callerHandle || callerHandle !== recipientHandle) {
      throw new GiftError(
        'FORBIDDEN',
        'Only the designated recipient of this gift can unwrap and claim it.',
        403
      );
    }
  }

  if (row.status === 'CLAIMED') {
    throw new GiftError('ALREADY_CLAIMED', 'This gift has already been unwrapped and claimed.', 409);
  }
  if (row.status === 'CLAIMING') {
    throw new GiftError('CLAIM_IN_PROGRESS', 'Gift claim is currently settling on-chain.', 409);
  }
  if (row.status !== 'LOCKED') {
    throw new GiftError(
      'INVALID_GIFT_STATE',
      `Gift cannot be claimed while in status ${row.status}.`,
      400
    );
  }

  // Server-enforced timelock boundary check
  const now = Date.now();
  const timelockUntil = Number(row.timelock_until);
  if (now < timelockUntil) {
    throw new GiftError(
      'GIFT_LOCKED',
      `This gift is timelocked until ${new Date(timelockUntil).toISOString()}.`,
      403
    );
  }

  // Atomic CAS transition: LOCKED -> CLAIMING (prevents concurrent double-claim races)
  const lockRes = await env.DB.prepare(
    `UPDATE gifts
     SET status = 'CLAIMING',
         recipient_x_id = COALESCE(recipient_x_id, ?),
         updated_at = ?
     WHERE id = ?
       AND status = 'LOCKED'
       AND timelock_until <= ?
       AND (recipient_x_id IS NULL OR recipient_x_id = ?)`
  )
    .bind(session.x_id, now, cleanId, now, session.x_id)
    .run();

  if (!lockRes.meta?.changes) {
    throw new GiftError('CLAIM_RACE_CONFLICT', 'Gift claim is already in progress or completed.', 409);
  }

  try {
    const recipientNearAccount = await nearRpc.resolveUserNearAccount(env, session);
    const liveBalance = await getCustodyVaultBalance(env, row.custody_account, row.vault_asset_id);
    const fallbackShares = BigInt(String(row.shares_atomic || row.quoted_shares_atomic || '0'));
    const sharesToTransfer =
      liveBalance !== null && liveBalance > 0n ? liveBalance : fallbackShares;

    if (sharesToTransfer <= 0n) {
      throw new Error('Custody account holds 0 vault shares.');
    }

    const transferRes = await transferFromEarnCustody(
      env,
      cleanId,
      recipientNearAccount,
      row.vault_asset_id,
      sharesToTransfer
    );

    if (!transferRes.success) {
      if (transferRes.ambiguous) {
        // Leave in CLAIMING so cron can reconcile safely without double-spending
        throw new GiftError(
          'CLAIM_SETTLEMENT_PENDING',
          'Your gift unwrap was broadcast and is confirming on NEAR Intents.',
          202
        );
      }
      // Definite failure before inclusion — revert status to LOCKED so recipient can retry
      await env.DB.prepare(
        "UPDATE gifts SET status = 'LOCKED', updated_at = ? WHERE id = ? AND status = 'CLAIMING'"
      )
        .bind(Date.now(), cleanId)
        .run();
      throw new GiftError(
        'CLAIM_TRANSFER_FAILED',
        `Could not transfer Earn vault shares: ${transferRes.error || 'Unknown error'}`,
        502
      );
    }

    const claimedAt = Date.now();
    await env.DB.prepare(
      `UPDATE gifts
       SET status = 'CLAIMED',
           shares_atomic = ?,
           claim_tx_hash = ?,
           claimed_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        sharesToTransfer.toString(),
        transferRes.txHash || null,
        claimedAt,
        claimedAt,
        cleanId
      )
      .run();

    const updated = await env.DB.prepare('SELECT * FROM gifts WHERE id = ? LIMIT 1')
      .bind(cleanId)
      .first<any>();
    return formatAuthenticatedGiftView(env, updated || row, 'RECIPIENT');
  } catch (err: any) {
    if (err instanceof GiftError) throw err;
    await env.DB.prepare(
      "UPDATE gifts SET status = 'LOCKED', updated_at = ? WHERE id = ? AND status = 'CLAIMING'"
    )
      .bind(Date.now(), cleanId)
      .run()
      .catch(() => {});
    throw new GiftError(
      'CLAIM_FAILED',
      err?.message || 'Failed to unwrap and claim gift.',
      502
    );
  }
}

/**
 * Cron reconciliation for gifts:
 *   1. Settles any `PENDING_FUNDING` external deposits or expires them after TTL.
 *   2. Retries any interrupted `CLAIMING` gifts idempotently.
 */
export async function reconcilePendingGifts(
  env: Env,
  opts: { limit?: number } = {}
): Promise<{ checked: number; settled: number; claimed: number }> {
  const limit = opts.limit ?? 20;
  let checked = 0;
  let settled = 0;
  let claimed = 0;

  const pending = await env.DB.prepare(
    "SELECT id FROM gifts WHERE status = 'PENDING_FUNDING' ORDER BY created_at ASC LIMIT ?"
  )
    .bind(limit)
    .all<{ id: string }>();

  for (const item of pending.results || []) {
    checked++;
    try {
      const updated = await checkAndSettleGiftFunding(env, item.id);
      if (updated?.status === 'LOCKED') settled++;
    } catch {}
  }

  const stuckClaims = await env.DB.prepare(
    "SELECT * FROM gifts WHERE status = 'CLAIMING' AND updated_at < ? LIMIT ?"
  )
    .bind(Date.now() - 60_000, limit)
    .all<any>();

  for (const row of stuckClaims.results || []) {
    checked++;
    try {
      const liveBal = await getCustodyVaultBalance(env, row.custody_account, row.vault_asset_id);
      if (liveBal === 0n) {
        // Transfer already succeeded on-chain
        await env.DB.prepare(
          "UPDATE gifts SET status = 'CLAIMED', claimed_at = COALESCE(claimed_at, ?), updated_at = ? WHERE id = ? AND status = 'CLAIMING'"
        )
          .bind(Date.now(), Date.now(), row.id)
          .run();
        claimed++;
      } else if (liveBal !== null && liveBal > 0n && row.recipient_x_id) {
        const recipientNear = await nearRpc.resolveUserNearAccount(env, {
          x_id: row.recipient_x_id,
          x_handle: row.recipient_handle,
        });
        const retry = await transferFromEarnCustody(
          env,
          row.id,
          recipientNear,
          row.vault_asset_id,
          liveBal
        );
        if (retry.success) {
          await env.DB.prepare(
            "UPDATE gifts SET status = 'CLAIMED', claim_tx_hash = ?, claimed_at = ?, updated_at = ? WHERE id = ?"
          )
            .bind(retry.txHash || null, Date.now(), Date.now(), row.id)
            .run();
          claimed++;
        }
      }
    } catch {}
  }

  return { checked, settled, claimed };
}
