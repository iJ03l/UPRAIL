/**
 * Interactive Two-Step Passkey Authorization for NEAR L1 Native Assets (`u_*.escrow.uprail.near`).
 *
 * Mirrors the security ceremony of Reveal Key (`/auth/export-key`):
 *   1. `prepare*`: issues a single-use WebAuthn challenge (`pending_custody_actions`)
 *      explicitly binding `{ account_id, operation, asset, amount, target, nonce }`.
 *   2. `submit*`: cryptographically verifies the browser WebAuthn assertion (challenge
 *      digest, P-256 signature, allowed origin, RP ID hash, user-present flag), mints
 *      an in-process short-lived `NativeL1KeyGrant` scoped strictly to that single
 *      operation + asset + target, executes the L1 transaction, and revokes the grant.
 *
 * Self-custody accounts never delegate Intents authority, and the backend NEVER uses
 * a self-custody user's L1 sub-account key without this explicit per-action signature.
 */

import type { Env, Session } from '../types';
import { PaymentStatus } from '../types';
import * as nearRpc from './nearRpc';
import {
  base64UrlToBytes,
  bytesToHex,
  sha256Utf8,
  type SignedWebAuthnPayload,
} from './selfCustodyCrypto';
import {
  CustodyActionError,
  consumeAndVerifyWebAuthnPendingAction,
  createPendingCustodyAction,
  sweepPlainBalancesBeforeUpgrade,
} from './custodyService';
import {
  type NativeL1KeyGrant,
  type NativeL1Operation,
  issueNativeL1Grant,
  revokeNativeL1Grant,
} from './nativeL1Grant';
import { allowedWebAuthnOrigins, allowedWebAuthnRpIds, resolveOrigin } from './webauthnConfig';
import { createPaymentInvite } from './inviteService';
import { publicErrorMessage } from '../utils/errors';

export const NATIVE_L1_AUTH_DOMAIN = 'uprail:near-native-auth:v1';
const NATIVE_L1_TTL_MS = 5 * 60 * 1000;

export interface NativeL1PendingMeta extends Record<string, unknown> {
  operation: NativeL1Operation;
  nextStep: string;
  nearAccount: string;
  asset: string;
  grantAsset: string;
  symbol: string;
  amount: string;
  target: string;
  feeTarget?: string;
  // Optional operation-specific fields for native_send / native_escrow_lock / native_withdraw
  cleanHandle?: string;
  isAddress?: boolean;
  recipientXId?: string | null;
  recipientNearAccount?: string | null;
  isRecipientRegistered?: boolean;
  recipientAmount?: string;
  protocolFee?: string;
  feeRecipient?: string;
  holdingAccount?: string;
  memo?: string | null;
  requestId?: string | null;
  destinationAddress?: string;
}

async function verifyWebAuthnOriginAndRpId(
  env: Env,
  signedWebAuthn: SignedWebAuthnPayload
): Promise<void> {
  let clientData: { origin?: unknown; type?: unknown };
  try {
    clientData = JSON.parse(signedWebAuthn.client_data_json);
  } catch {
    throw new CustodyActionError('Malformed WebAuthn clientDataJSON', 400, 'INVALID_WEBAUTHN_CLIENT_DATA');
  }

  const origin = typeof clientData.origin === 'string' ? clientData.origin.replace(/\/+$/, '') : '';
  const allowedOrigins = allowedWebAuthnOrigins(env).map((o) => o.replace(/\/+$/, ''));
  if (!origin || !allowedOrigins.includes(origin)) {
    throw new CustodyActionError(
      'Passkey signature origin is not authorized for NEAR L1 key use',
      403,
      'INVALID_WEBAUTHN_ORIGIN'
    );
  }

  const authData = base64UrlToBytes(signedWebAuthn.authenticator_data);
  if (authData.length < 37) {
    throw new CustodyActionError('Malformed WebAuthn authenticatorData', 400, 'INVALID_WEBAUTHN_AUTH_DATA');
  }
  const actualRpHashHex = bytesToHex(authData.slice(0, 32));
  const allowedRpIds = allowedWebAuthnRpIds(env);
  let rpMatches = false;
  for (const rpId of allowedRpIds) {
    const expectedHash = bytesToHex(await sha256Utf8(rpId));
    if (expectedHash === actualRpHashHex) {
      rpMatches = true;
      break;
    }
  }
  if (!rpMatches) {
    throw new CustodyActionError(
      'Passkey signature RP ID mismatch',
      403,
      'INVALID_WEBAUTHN_RPID'
    );
  }
}

export async function prepareNativeL1AuthAction(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  operation: NativeL1Operation;
  nextStep: string;
  asset: string;
  grantAsset: string;
  symbol: string;
  amount: string;
  target: string;
  feeTarget?: string;
  extraMeta?: Partial<NativeL1PendingMeta>;
  title?: string;
  note?: string;
}) {
  const custody = await nearRpc.getUserCustodyRecord(params.env, params.session.x_id);
  const nonce = crypto.randomUUID();
  const expiresAtIso = new Date(Date.now() + NATIVE_L1_TTL_MS).toISOString();
  const payloadStr = JSON.stringify({
    domain: NATIVE_L1_AUTH_DOMAIN,
    account_id: params.nearAccount,
    operation: params.operation,
    asset: params.asset,
    amount: params.amount,
    target: params.target,
    ...(params.feeTarget ? { fee_target: params.feeTarget } : {}),
    nonce,
    expires_at: expiresAtIso,
  });

  const meta: NativeL1PendingMeta = {
    operation: params.operation,
    nextStep: params.nextStep,
    nearAccount: params.nearAccount,
    asset: params.asset,
    grantAsset: params.grantAsset,
    symbol: params.symbol,
    amount: params.amount,
    target: params.target,
    ...(params.feeTarget ? { feeTarget: params.feeTarget } : {}),
    ...(params.extraMeta || {}),
  };

  const pending = await createPendingCustodyAction({
    env: params.env,
    xId: params.session.x_id,
    actionType: 'AUTHORIZE_NATIVE_L1_KEY',
    payloadStr,
    meta,
    requireOnchainPasskey: custody.custodyMode === 'self',
    ttlMs: NATIVE_L1_TTL_MS,
  });

  return {
    step: 'native_auth' as const,
    nextStep: params.nextStep,
    operation: params.operation,
    ...pending,
    summary: {
      title: params.title || 'Authorize NEAR L1 Account Key',
      accountId: params.nearAccount,
      operation: params.operation,
      asset: params.symbol,
      amount: params.amount,
      target: params.target,
      note:
        params.note ||
        'Sign with your passkey to authorize your NEAR L1 account key for this exact native asset action.',
    },
  };
}

export async function withAuthorizedNativeL1Key<T>(
  env: Env,
  xId: string,
  actionId: string,
  assertion: unknown,
  handler: (meta: NativeL1PendingMeta, grant: NativeL1KeyGrant) => Promise<T>
): Promise<T> {
  const custody = await nearRpc.getUserCustodyRecord(env, xId);
  const { signedWebAuthn, meta } = await consumeAndVerifyWebAuthnPendingAction<NativeL1PendingMeta>({
    env,
    xId,
    actionId,
    assertion,
    expectedActionType: 'AUTHORIZE_NATIVE_L1_KEY',
    requireOnchainPasskey: custody.custodyMode === 'self',
  });

  await verifyWebAuthnOriginAndRpId(env, signedWebAuthn);

  const grant = issueNativeL1Grant({
    xId,
    operation: meta.operation,
    asset: meta.grantAsset || meta.asset,
    target: meta.target,
    feeTarget: meta.feeTarget,
    maxAmount: meta.amount,
    ttlMs: 120_000,
  });

  try {
    return await handler(meta, grant);
  } finally {
    revokeNativeL1Grant(grant);
  }
}

export async function prepareSweepPlainL1ToIntents(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  asset?: string;
  symbol?: string;
  amount?: string;
  nextStep?: string;
}) {
  if (!(await nearRpc.canServerSignAccountL1(params.env, params.session.x_id, params.nearAccount))) {
    throw new CustodyActionError(
      'Your server NEAR L1 key was removed when you upgraded to Self-Custody. Sweep plain L1 balances using your offline Recovery Key instead.',
      400,
      'SELF_CUSTODY_L1_KEY_ROTATED'
    );
  }
  const asset = (params.asset || '*').trim() || '*';
  const symbol = (params.symbol || (asset === '*' ? 'NEAR L1 Assets' : asset)).trim();
  const amount = (params.amount || 'all').trim();
  const nextStep = params.nextStep || 'settings';
  return await prepareNativeL1AuthAction({
    env: params.env,
    session: params.session,
    nearAccount: params.nearAccount,
    operation: 'sweep_to_intents',
    nextStep,
    asset,
    grantAsset: asset,
    symbol,
    amount,
    target: params.nearAccount,
    title: 'Authorize NEAR L1 Sweep into Intents',
    note:
      asset === '*'
        ? `Confirm with your passkey to use your L1 key (${params.nearAccount}) once to move your plain NEAR / NEP-141 balances into your passkey-controlled Intents wallet.`
        : `Confirm with your passkey to use your L1 key (${params.nearAccount}) once to move ${amount} ${symbol} from NEAR L1 into your passkey-controlled Intents wallet.`,
  });
}

/**
 * Checks if plain NEAR L1 balance on `nearAccount` covers an Intents shortfall
 * and prepares an interactive two-step L1 sweep when the server L1 key is still
 * authorized; throws `SELF_CUSTODY_L1_KEY_ROTATED` if rotated to an offline backup key.
 */
export async function maybePrepareMatchingPlainL1Sweep(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  assetId: string;
  contractId?: string | null;
  symbol: string;
  decimals: number;
  publicBalanceAtomic: bigint;
  requiredAtomic: bigint;
  nextStep: string;
}) {
  const plain = await nearRpc.getPlainBalances(params.env, params.nearAccount).catch(() => []);
  const matchingPlain = plain.find(
    (b) =>
      nearRpc.assetsMatch(b.defuse_asset_id, params.assetId) ||
      nearRpc.assetsMatch(b.nearContractId, params.contractId)
  );
  const plainAmt = BigInt(matchingPlain?.amount || '0');
  if (plainAmt <= 0n || plainAmt + params.publicBalanceAtomic < params.requiredAtomic) {
    return null;
  }
  const shortfall = params.requiredAtomic - params.publicBalanceAtomic;
  const fallbackFormatted = nearRpc.formatAmount(
    (shortfall > 0n ? shortfall : plainAmt).toString(),
    params.decimals
  );
  return await prepareSweepPlainL1ToIntents({
    env: params.env,
    session: params.session,
    nearAccount: params.nearAccount,
    asset: params.assetId,
    symbol: params.symbol,
    amount: matchingPlain?.amountFormatted || fallbackFormatted,
    nextStep: params.nextStep,
  });
}

export async function submitSweepPlainL1ToIntents(params: {
  env: Env;
  session: Session;
  actionId: string;
  assertion: unknown;
}) {
  return await withAuthorizedNativeL1Key(
    params.env,
    params.session.x_id,
    params.actionId,
    params.assertion,
    async (meta, grant) => {
      if (meta.operation !== 'sweep_to_intents') {
        throw new CustodyActionError(
          `Expected sweep_to_intents authorization, got ${meta.operation}`,
          400,
          'ACTION_TYPE_MISMATCH'
        );
      }

      if (meta.asset === '*') {
        const res = await sweepPlainBalancesBeforeUpgrade(
          params.env,
          params.session.x_id,
          params.session.x_handle,
          { nativeL1Grant: grant }
        );
        return {
          step: 'native_auth' as const,
          operation: 'sweep_to_intents' as const,
          swept: true,
          readyForNextStep: true,
          nextStep: meta.nextStep,
          nearAccount: res.nearAccount,
          sweptItems: res.swept,
        };
      }

      const dep = await nearRpc.depositPlainBalanceToIntents(
        params.env,
        params.session.x_id,
        meta.asset,
        meta.amount,
        meta.nearAccount,
        { nativeL1Grant: grant }
      );
      if (!dep.deposited) {
        throw new CustodyActionError(
          dep.reason || `Could not move L1 ${meta.symbol} balance into Intents`,
          502,
          'NATIVE_L1_SWEEP_FAILED'
        );
      }

      return {
        step: 'native_auth' as const,
        operation: 'sweep_to_intents' as const,
        swept: true,
        readyForNextStep: true,
        nextStep: meta.nextStep,
        nearAccount: meta.nearAccount,
        txHash: dep.txHash,
        sweptItems: [{ symbol: meta.symbol, amount: meta.amount, txHash: dep.txHash }],
      };
    }
  );
}

export async function prepareNativeL1Send(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  asset: string;
  symbol: string;
  amount: string;
  recipientAmount: string;
  protocolFee: string;
  cleanHandle: string;
  isAddress: boolean;
  recipientXId: string | null;
  recipientNearAccount: string | null;
  isRecipientRegistered: boolean;
  feeRecipient: string;
  holdingAccount: string;
  memo: string | null;
  requestId: string | null;
}) {
  const isDirect = Boolean(params.isRecipientRegistered && params.recipientNearAccount);
  const operation: NativeL1Operation = isDirect ? 'native_send' : 'native_escrow_lock';
  const target = isDirect ? params.recipientNearAccount! : params.holdingAccount;

  return await prepareNativeL1AuthAction({
    env: params.env,
    session: params.session,
    nearAccount: params.nearAccount,
    operation,
    nextStep: 'send',
    asset: params.asset,
    grantAsset: params.asset,
    symbol: params.symbol,
    amount: params.amount,
    target,
    ...(isDirect && parseFloat(params.protocolFee) > 0 ? { feeTarget: params.feeRecipient } : {}),
    extraMeta: {
      cleanHandle: params.cleanHandle,
      isAddress: params.isAddress,
      recipientXId: params.recipientXId,
      recipientNearAccount: params.recipientNearAccount,
      isRecipientRegistered: params.isRecipientRegistered,
      recipientAmount: params.recipientAmount,
      protocolFee: params.protocolFee,
      feeRecipient: params.feeRecipient,
      holdingAccount: params.holdingAccount,
      memo: params.memo,
      requestId: params.requestId,
    },
    title: 'Authorize NEAR L1 Native Send',
    note: isDirect
      ? `${params.symbol} settles on NEAR L1. Sign with your passkey to authorize your L1 key once for sending ${params.amount} ${params.symbol} to ${params.isAddress ? params.cleanHandle : `@${params.cleanHandle}`}.`
      : `${params.symbol} settles on NEAR L1. Sign with your passkey to authorize your L1 key once for locking ${params.amount} ${params.symbol} in escrow for @${params.cleanHandle}.`,
  });
}

export async function prepareNativeL1Withdraw(params: {
  env: Env;
  session: Session;
  nearAccount: string;
  asset: string;
  symbol: string;
  amount: string;
  destinationAddress: string;
}) {
  return await prepareNativeL1AuthAction({
    env: params.env,
    session: params.session,
    nearAccount: params.nearAccount,
    operation: 'native_withdraw',
    nextStep: 'withdraw',
    asset: params.asset,
    grantAsset: params.asset,
    symbol: params.symbol,
    amount: params.amount,
    target: params.destinationAddress,
    extraMeta: {
      destinationAddress: params.destinationAddress,
    },
    title: 'Authorize NEAR L1 Native Withdrawal',
    note: `${params.symbol} settles on NEAR L1. Sign with your passkey to authorize your L1 key once to transfer ${params.amount} ${params.symbol} to ${params.destinationAddress}.`,
  });
}

export async function submitNativeL1Operation(params: {
  env: Env;
  session: Session;
  actionId: string;
  assertion: unknown;
}) {
  return await withAuthorizedNativeL1Key(
    params.env,
    params.session.x_id,
    params.actionId,
    params.assertion,
    async (meta, grant) => {
      if (meta.operation === 'sweep_to_intents') {
        if (meta.asset === '*') {
          const res = await sweepPlainBalancesBeforeUpgrade(
            params.env,
            params.session.x_id,
            params.session.x_handle,
            { nativeL1Grant: grant }
          );
          return {
            step: 'native_auth' as const,
            operation: 'sweep_to_intents' as const,
            swept: true,
            readyForNextStep: true,
            nextStep: meta.nextStep,
            nearAccount: res.nearAccount,
            sweptItems: res.swept,
          };
        }
        const dep = await nearRpc.depositPlainBalanceToIntents(
          params.env,
          params.session.x_id,
          meta.asset,
          meta.amount,
          meta.nearAccount,
          { nativeL1Grant: grant }
        );
        if (!dep.deposited) {
          throw new CustodyActionError(
            dep.reason || `Could not move L1 ${meta.symbol} balance into Intents`,
            502,
            'NATIVE_L1_SWEEP_FAILED'
          );
        }
        return {
          step: 'native_auth' as const,
          operation: 'sweep_to_intents' as const,
          swept: true,
          readyForNextStep: true,
          nextStep: meta.nextStep,
          nearAccount: meta.nearAccount,
          txHash: dep.txHash,
        };
      }

      if (meta.operation === 'native_send' || meta.operation === 'native_escrow_lock') {
        if (!params.env.DB) {
          throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');
        }
        const paymentId = crypto.randomUUID();
        const now = Date.now();
        const expiryDays = parseInt(params.env.PAYMENT_EXPIRY_DAYS || '30', 10);
        const expiresAt = now + expiryDays * 86400 * 1000;
        const isRegistered = Boolean(meta.isRecipientRegistered && meta.recipientNearAccount);
        const inviteCode = isRegistered
          ? null
          : await createPaymentInvite(params.env, paymentId, params.session.x_id, params.session.x_handle);

        await params.env.DB.prepare(
          `INSERT INTO payments (
            id, sender_x_id, sender_x_handle, recipient_handle, recipient_x_id,
            asset, amount, fee, fee_recipient, invite_code, memo,
            status, privacy_rail, deposit_address, intent_hash, claim_tx_hash, refund_tx_hash,
            created_at, expires_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public_native', NULL, NULL, NULL, NULL, ?, ?, ?)`
        )
          .bind(
            paymentId,
            params.session.x_id,
            params.session.x_handle,
            meta.cleanHandle!,
            meta.recipientXId ?? null,
            meta.asset,
            meta.recipientAmount || meta.amount,
            meta.protocolFee || '0',
            meta.feeRecipient || params.env.FEE_ACCOUNT_ID || 'escrow.uprail.near',
            inviteCode,
            meta.memo ?? null,
            PaymentStatus.PENDING,
            now,
            expiresAt,
            now
          )
          .run();

        const failPending = async (code: string, message: string) => {
          await params.env.DB!.prepare(
            `UPDATE payments SET status = ?, cancel_reason = ?, cancel_code = ?, updated_at = ?
             WHERE id = ? AND status = ?`
          )
            .bind(PaymentStatus.CANCELLED, message, code, Date.now(), paymentId, PaymentStatus.PENDING)
            .run()
            .catch(() => {});
        };

        let claimTxHash: string | null = null;
        let escrowDepositTxHash: string | null = null;
        let feeDispatchStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
        let feeDispatchError: string | null = null;

        if (meta.operation === 'native_send' && meta.recipientNearAccount) {
          const direct = await nearRpc.executeDirectFtWithdraw(
            params.env,
            params.session.x_id,
            meta.recipientNearAccount,
            meta.asset,
            meta.recipientAmount || meta.amount,
            grant
          );
          if (!direct.success || !direct.txHash) {
            const msg = publicErrorMessage(new Error(direct.error || ''), 'Native NEAR L1 transfer failed');
            await failPending('SETTLEMENT_FAILED', msg);
            throw new CustodyActionError(msg, 502, 'SETTLEMENT_FAILED');
          }
          claimTxHash = direct.txHash;

          const feeVal = parseFloat(meta.protocolFee || '0');
          if (feeVal > 0 && meta.feeRecipient) {
            try {
              const feeTx = await nearRpc.executeDirectFtWithdraw(
                params.env,
                params.session.x_id,
                meta.feeRecipient,
                meta.asset,
                meta.protocolFee!,
                grant
              );
              feeDispatchStatus = feeTx.success ? 'sent' : 'failed';
              feeDispatchError = feeTx.success ? null : feeTx.error || 'fee transfer failed';
            } catch (feeErr: any) {
              feeDispatchStatus = 'failed';
              feeDispatchError = feeErr?.message || String(feeErr);
            }
          }
        } else {
          const lock = await nearRpc.depositPlainBalanceToEscrow(
            params.env,
            params.session.x_id,
            meta.asset,
            meta.amount,
            grant
          );
          if (!lock.deposited || !lock.txHash) {
            const msg = publicErrorMessage(new Error(lock.reason || ''), 'Native escrow lock failed');
            await failPending('ESCROW_LOCK_FAILED', msg);
            throw new CustodyActionError(msg, 502, 'ESCROW_LOCK_FAILED');
          }
          escrowDepositTxHash = lock.txHash;
        }

        const finalStatus = isRegistered ? PaymentStatus.CLAIMED : PaymentStatus.ESCROWED;
        await params.env.DB.prepare(
          `UPDATE payments
           SET status = ?, intent_hash = ?, claim_tx_hash = ?,
               fee_dispatch_status = ?, fee_dispatch_error = ?, updated_at = ?
           WHERE id = ? AND status = ?`
        )
          .bind(
            finalStatus,
            escrowDepositTxHash,
            claimTxHash,
            feeDispatchStatus,
            feeDispatchError,
            Date.now(),
            paymentId,
            PaymentStatus.PENDING
          )
          .run();

        if (meta.requestId && meta.isAddress !== true) {
          await params.env.DB.prepare(
            `UPDATE payment_requests SET status = 'COMPLETED', payment_id = ?, completed_at = ?
             WHERE id = ? AND status = 'PENDING' AND LOWER(requested_handle) = ?`
          )
            .bind(paymentId, Date.now(), meta.requestId, params.session.x_handle.toLowerCase())
            .run()
            .catch(() => {});
        }

        const shareBase = resolveOrigin(params.env).replace(/\/+$/, '');
        const shareLink = meta.isAddress
          ? ''
          : `${shareBase}/claim/${paymentId}${inviteCode ? `?invite=${encodeURIComponent(inviteCode)}` : ''}`;
        const cleanDisplay = (meta.cleanHandle || '').replace(/^@+/, '');
        const recipientAmt = meta.recipientAmount || meta.amount;
        const tweetText = `Hey @${cleanDisplay}, I sent you ${meta.amount} ${meta.asset} on UPRAIL: ${shareLink}`;
        const xShareUrl =
          !meta.isAddress && shareLink
            ? `https://x.com/intent/post?text=${encodeURIComponent(tweetText)}`
            : undefined;
        const tweetIntentUrl =
          !meta.isAddress && shareLink
            ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`
            : undefined;
        const feeRecipient = meta.feeRecipient || params.env.FEE_ACCOUNT_ID || 'escrow.uprail.near';

        return {
          step: 'send' as const,
          completed: true,
          paymentId,
          shareLink,
          claimLink: isRegistered ? undefined : shareLink || undefined,
          receiptLink: isRegistered ? shareLink || undefined : undefined,
          xShareUrl,
          tweetIntentUrl,
          status: finalStatus,
          fee: meta.protocolFee || '0',
          recipientAmount: recipientAmt,
          feeRecipient,
          inviteCode: inviteCode || undefined,
          isDirect: isRegistered,
          privacyRail: 'public_native' as const,
          txHash: claimTxHash || escrowDepositTxHash,
          payment: {
            id: paymentId,
            paymentId,
            status: finalStatus,
            recipientHandle: meta.cleanHandle,
            amount: recipientAmt,
            grossAmount: meta.amount,
            protocolFee: meta.protocolFee || '0',
            asset: meta.asset,
            privacyRail: 'public_native',
            claimTxHash,
            intentHash: escrowDepositTxHash,
            inviteCode,
            shareLink: isRegistered ? null : shareLink,
            claimLink: isRegistered ? undefined : shareLink || undefined,
            xShareUrl,
            tweetIntentUrl,
          },
        };
      }

      if (meta.operation === 'native_withdraw') {
        if (!params.env.DB) {
          throw new CustodyActionError('Database unavailable', 503, 'DB_UNAVAILABLE');
        }
        const dest = meta.destinationAddress || meta.target;
        const withdrawalId = 'wth_' + crypto.randomUUID();
        const now = Date.now();
        const reserve = await params.env.DB.prepare(
          `INSERT INTO withdrawals
             (id, x_id, x_handle, destination_address, asset, amount, tx_hash, status,
              privacy_rail, settlement_status, rail, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, NULL, 'PENDING', 'public_native', 'PENDING', 'native', ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM withdrawals WHERE x_id = ? AND asset = ? AND status = 'PENDING'
           )`
        )
          .bind(
            withdrawalId,
            params.session.x_id,
            params.session.x_handle,
            dest,
            meta.asset,
            meta.amount,
            now,
            now,
            params.session.x_id,
            meta.asset
          )
          .run();

        if ((reserve.meta?.changes ?? 0) === 0) {
          throw new CustodyActionError(
            'A withdrawal for this asset is already in progress',
            409,
            'WITHDRAWAL_IN_PROGRESS'
          );
        }

        const direct = await nearRpc.executeDirectFtWithdraw(
          params.env,
          params.session.x_id,
          dest,
          meta.asset,
          meta.amount,
          grant
        );

        if (!direct.success || !direct.txHash) {
          const msg = publicErrorMessage(new Error(direct.error || ''), 'Native NEAR withdrawal failed');
          await params.env.DB.prepare(
            "UPDATE withdrawals SET status = 'FAILED', error = ?, error_code = 'SETTLEMENT_FAILED', settlement_status = 'FAILED', updated_at = ? WHERE id = ? AND status = 'PENDING'"
          )
            .bind(msg.slice(0, 500), Date.now(), withdrawalId)
            .run()
            .catch(() => {});
          throw new CustodyActionError(msg, 502, 'WITHDRAWAL_FAILED');
        }

        await params.env.DB.prepare(
          "UPDATE withdrawals SET tx_hash = ?, status = 'COMPLETED', settlement_status = 'SUCCESS', confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'"
        )
          .bind(direct.txHash, Date.now(), Date.now(), withdrawalId)
          .run();

        return {
          httpStatus: 200 as const,
          step: 'withdraw' as const,
          completed: true,
          withdrawalId,
          status: 'COMPLETED',
          txHash: direct.txHash,
          asset: meta.asset,
          amount: meta.amount,
          destinationAddress: dest,
          rail: 'native',
          privacyRail: 'public_native' as const,
          withdrawal: {
            id: withdrawalId,
            status: 'COMPLETED',
            txHash: direct.txHash,
            asset: meta.asset,
            amount: meta.amount,
            destinationAddress: dest,
            rail: 'native',
            privacyRail: 'public_native',
          },
        };
      }

      throw new CustodyActionError(`Unsupported NEAR L1 operation: ${meta.operation}`, 400, 'INVALID_OPERATION');
    }
  );
}
