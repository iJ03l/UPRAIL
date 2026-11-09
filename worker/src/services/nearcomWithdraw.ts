/**
 * near.com Internal Withdrawal Rail
 *
 * Dedicated, isolated rail for withdrawing Intents-supported assets directly to
 * a user's passkey-verified `near.com` internal account (e.g.
 * `nearcom:0xb137a2f1054b5de422a8df801613d6722701163c`).
 *
 * How it works:
 *   1. User sets (or edits) their `near.com` internal address, gated by WebAuthn passkey.
 *   2. We normalize `nearcom:<account>` -> canonical display `nearcom:<id>` and
 *      underlying `intents.near` AccountId `<id>` (lowercased, `nearcom:` stripped).
 *   3. On withdrawal (also passkey-gated), any public/plain shortfall is shielded
 *      into Confidential Intents first, and `submitPrivateTransfer` moves the exact
 *      amount `1:1` (`CONFIDENTIAL_INTENTS` -> `CONFIDENTIAL_INTENTS`) to the user's
 *      `near.com` internal account with zero cross-chain bridge fee.
 */

import type { Env, Session } from '../types';
import * as nearRpc from './nearRpc';
import {
  ensureConfidentialFunds,
  formatAtomic,
  getConfidentialAssetBalance,
  isConfidentialRailEnabled,
  submitPrivateTransfer,
  waitForSettlement,
} from './confidentialRail';
import { resolveOrigin } from './webauthnConfig';
import { publicErrorMessage } from '../utils/errors';

const ETH_IMPLICIT_RE = /^0x[0-9a-f]{40}$/;
const NEAR_IMPLICIT_RE = /^[0-9a-f]{64}$/;
const NEAR_NAMED_RE =
  /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)+$/;

const FORBIDDEN_INTERNAL_ACCOUNTS = new Set([
  'intents.near',
  'escrow.uprail.near',
  'uprail.near',
  'wrap.near',
]);

export interface NearcomDestination {
  nearcomAddress: string;
  intentsAccountId: string;
  createdAt: number;
  updatedAt: number;
}

export type ParseNearcomResult =
  | {
      ok: true;
      nearcomAddress: string;
      intentsAccountId: string;
    }
  | {
      ok: false;
      error: string;
      code: 'INVALID_NEARCOM_ADDRESS';
    };

/**
 * Validates and normalizes a `near.com` internal address.
 * Accepts:
 *   - `nearcom:0x<40 hex>` or `0x<40 hex>` (ECDSA / passkey / EVM-derived near.com account)
 *   - `nearcom:<64 hex>` or `<64 hex>` (Ed25519-derived near.com account)
 *   - `nearcom:<name.near>` or `<name.near>` (named NEAR account on near.com)
 */
export function parseNearcomAddress(raw: string): ParseNearcomResult {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Paste your near.com internal address (e.g. nearcom:0x…).',
      code: 'INVALID_NEARCOM_ADDRESS',
    };
  }

  // Strip optional leading `nearcom:` scheme (case-insensitive)
  const withoutScheme = trimmed.replace(/^nearcom:/i, '').trim();
  if (!withoutScheme || withoutScheme.includes(':')) {
    return {
      ok: false,
      error: 'Invalid near.com address format. Copy your address from near.com → My address.',
      code: 'INVALID_NEARCOM_ADDRESS',
    };
  }

  const lower = withoutScheme.toLowerCase();

  const isEthImplicit = ETH_IMPLICIT_RE.test(lower);
  const isNearImplicit = NEAR_IMPLICIT_RE.test(lower);
  const isNearNamed = lower.length >= 2 && lower.length <= 64 && NEAR_NAMED_RE.test(lower);

  if (!isEthImplicit && !isNearImplicit && !isNearNamed) {
    return {
      ok: false,
      error:
        'Invalid near.com internal address. Expected nearcom:0x… (42 chars), a 64-character hex address, or a .near account.',
      code: 'INVALID_NEARCOM_ADDRESS',
    };
  }

  if (
    FORBIDDEN_INTERNAL_ACCOUNTS.has(lower) ||
    lower.endsWith('.escrow.uprail.near') ||
    lower.endsWith('.uprail.near')
  ) {
    return {
      ok: false,
      error: 'That is an internal UPRAIL vault/contract address — paste your personal near.com address instead.',
      code: 'INVALID_NEARCOM_ADDRESS',
    };
  }

  return {
    ok: true,
    nearcomAddress: `nearcom:${lower}`,
    intentsAccountId: lower,
  };
}

let tableEnsured = false;

async function ensureNearcomTable(env: Env): Promise<void> {
  if (tableEnsured || !env.DB) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS nearcom_withdraw_destinations (
        x_id TEXT PRIMARY KEY,
        x_handle TEXT NOT NULL,
        nearcom_address TEXT NOT NULL,
        intents_account_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ).run();
    tableEnsured = true;
  } catch (err) {
    console.warn('[nearcomWithdraw] table ensure notice:', err);
  }
}

export async function getNearcomDestination(
  env: Env,
  xId: string
): Promise<NearcomDestination | null> {
  if (!env.DB) return null;
  await ensureNearcomTable(env);
  const row = await env.DB.prepare(
    `SELECT nearcom_address, intents_account_id, created_at, updated_at
       FROM nearcom_withdraw_destinations
      WHERE x_id = ?`
  )
    .bind(xId)
    .first<{
      nearcom_address: string;
      intents_account_id: string;
      created_at: number;
      updated_at: number;
    }>();

  if (!row) return null;
  return {
    nearcomAddress: row.nearcom_address,
    intentsAccountId: row.intents_account_id,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function saveNearcomDestination(
  env: Env,
  params: { xId: string; xHandle: string; rawAddress: string }
): Promise<
  | { ok: true; destination: NearcomDestination }
  | { ok: false; status: 400 | 500; error: string; code: string }
> {
  const parsed = parseNearcomAddress(params.rawAddress);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      error: parsed.error,
      code: parsed.code,
    };
  }

  await ensureNearcomTable(env);
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO nearcom_withdraw_destinations (
         x_id, x_handle, nearcom_address, intents_account_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(x_id) DO UPDATE SET
         x_handle = excluded.x_handle,
         nearcom_address = excluded.nearcom_address,
         intents_account_id = excluded.intents_account_id,
         updated_at = excluded.updated_at`
    )
      .bind(
        params.xId,
        params.xHandle.toLowerCase(),
        parsed.nearcomAddress,
        parsed.intentsAccountId,
        now,
        now
      )
      .run();

    const saved = await getNearcomDestination(env, params.xId);
    return {
      ok: true,
      destination: saved || {
        nearcomAddress: parsed.nearcomAddress,
        intentsAccountId: parsed.intentsAccountId,
        createdAt: now,
        updatedAt: now,
      },
    };
  } catch (err: any) {
    console.error('[nearcomWithdraw] failed to save destination:', err);
    return {
      ok: false,
      status: 500,
      error: 'Could not save your near.com withdrawal address. Please try again.',
      code: 'SAVE_DESTINATION_FAILED',
    };
  }
}

export interface NearcomWithdrawInput {
  asset: string;
  amount?: string;
  expectedDestination?: string;
}

export interface NearcomWithdrawResult {
  httpStatus: 200 | 202 | 400 | 409 | 502 | 503;
  body: Record<string, unknown>;
}

/**
 * Executes a passkey-authorized internal withdrawal from the user's UPRAIL
 * Confidential Intents balance directly to their saved `near.com` internal
 * account (`CONFIDENTIAL_INTENTS` -> `CONFIDENTIAL_INTENTS`).
 */
export async function executeNearcomWithdrawal(
  env: Env,
  session: Session,
  input: NearcomWithdrawInput
): Promise<NearcomWithdrawResult> {
  if (!isConfidentialRailEnabled(env)) {
    return {
      httpStatus: 503,
      body: {
        error: 'Confidential Intents rail is currently disabled.',
        code: 'RAIL_DISABLED',
      },
    };
  }

  const destination = await getNearcomDestination(env, session.x_id);
  if (!destination) {
    return {
      httpStatus: 400,
      body: {
        error: 'Set up your near.com internal withdrawal address first.',
        code: 'NEARCOM_NOT_CONFIGURED',
      },
    };
  }

  if (input.expectedDestination && input.expectedDestination.trim()) {
    const expParsed = parseNearcomAddress(input.expectedDestination);
    if (
      !expParsed.ok ||
      expParsed.intentsAccountId !== destination.intentsAccountId
    ) {
      return {
        httpStatus: 409,
        body: {
          error:
            'Your saved near.com destination changed before this withdrawal was confirmed. Please review and confirm again.',
          code: 'DESTINATION_MISMATCH',
        },
      };
    }
  }

  const asset = (input.asset || 'usdc').trim().toLowerCase();

  const oneClickSupported = await nearRpc
    .isOneClickSupportedAsset(env, asset)
    .catch(() => true);
  if (!oneClickSupported) {
    return {
      httpStatus: 400,
      body: {
        error: 'This asset is not supported on NEAR Intents for near.com internal withdrawal.',
        code: 'INTENTS_UNSUPPORTED_ASSET',
      },
    };
  }

  let balance: Awaited<ReturnType<typeof getConfidentialAssetBalance>>;
  try {
    balance = await getConfidentialAssetBalance(env, session.x_id, asset);
  } catch (err: any) {
    return {
      httpStatus: 400,
      body: {
        error: publicErrorMessage(err, 'Unsupported asset for near.com withdrawal'),
        code: 'INVALID_ASSET',
      },
    };
  }

  const support = await nearRpc.isIntentsSupportedAsset(env, balance.contractId);
  if (support === false) {
    return {
      httpStatus: 400,
      body: {
        error: `${balance.symbol} is not supported on NEAR Intents and cannot be withdrawn via the near.com internal rail.`,
        code: 'INTENTS_UNSUPPORTED_ASSET',
      },
    };
  }
  if (support === null) {
    return {
      httpStatus: 503,
      body: {
        error: 'Could not verify NEAR Intents support for this asset — please try again.',
        code: 'RAIL_UNAVAILABLE',
      },
    };
  }

  // Read total spendable balance across Confidential Intents + Public Intents + Plain Vault
  const nearAccount = await nearRpc.resolveUserNearAccount(env, session);
  const publicHolding = await nearRpc
    .getIntentAssetBalance(env, asset, nearAccount)
    .catch(() => null);
  const plainBalances = await nearRpc.getPlainBalances(env, nearAccount).catch(() => []);
  const plainAtomic = plainBalances
    .filter(
      (b) =>
        nearRpc.assetsMatch(b.defuse_asset_id, balance.assetId) ||
        nearRpc.assetsMatch(b.nearContractId, balance.contractId)
    )
    .reduce((sum, b) => sum + BigInt(b.amount || '0'), 0n);
  const totalAtomic = balance.amountAtomic + (publicHolding?.balance ?? 0n) + plainAtomic;

  let amountStr: string;
  if (input.amount && input.amount !== 'all') {
    const raw = String(input.amount).trim().replace(/^["']|["']$/g, '');
    if (!/^\d{1,15}(\.\d{1,18})?$/.test(raw)) {
      return {
        httpStatus: 400,
        body: { error: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' },
      };
    }
    amountStr = raw;
  } else {
    if (publicHolding === null) {
      return {
        httpStatus: 503,
        body: {
          error: 'Could not read your full balance — please try again.',
          code: 'RAIL_UNAVAILABLE',
        },
      };
    }
    amountStr = formatAtomic(totalAtomic.toString(), balance.decimals);
  }

  let amountAtomic: bigint;
  try {
    amountAtomic = BigInt(nearRpc.toBaseUnits(amountStr, balance.decimals));
  } catch {
    return {
      httpStatus: 400,
      body: { error: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' },
    };
  }

  if (amountAtomic <= 0n) {
    return {
      httpStatus: 400,
      body: { error: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' },
    };
  }

  const isNearAsset =
    balance.symbol.toUpperCase() === 'NEAR' ||
    (balance.assetId || '').toLowerCase() === 'nep141:wrap.near';
  const MIN_NEAR_WITHDRAW_ATOMIC = 20000000000000000000000n; // 0.02 NEAR minimum
  if (isNearAsset && amountAtomic < MIN_NEAR_WITHDRAW_ATOMIC) {
    return {
      httpStatus: 400,
      body: { error: 'Minimum withdrawal amount is 0.02 NEAR', code: 'AMOUNT_BELOW_MINIMUM' },
    };
  }

  if (publicHolding !== null && amountAtomic > totalAtomic) {
    return {
      httpStatus: 400,
      body: {
        error: `Insufficient balance. Available: ${formatAtomic(totalAtomic.toString(), balance.decimals)} ${balance.symbol}`,
        code: 'INSUFFICIENT_FUNDS',
      },
    };
  }

  // Ensure the full requested amount sits in Confidential Intents before transferring
  try {
    await ensureConfidentialFunds(env, session.x_id, asset, amountAtomic);
  } catch (fundErr: any) {
    const message = String(fundErr?.message || fundErr);
    if (message.startsWith('INSUFFICIENT_FUNDS')) {
      return {
        httpStatus: 400,
        body: {
          error: `Insufficient balance. Available: ${formatAtomic(totalAtomic.toString(), balance.decimals)} ${balance.symbol}`,
          code: 'INSUFFICIENT_FUNDS',
        },
      };
    }
    return {
      httpStatus: 503,
      body: {
        error: 'Could not prepare your confidential balance for withdrawal — please try again.',
        code: 'CONFIDENTIAL_UNAVAILABLE',
      },
    };
  }

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
      destination.nearcomAddress,
      asset,
      amountStr,
      now,
      now,
      session.x_id,
      asset
    )
    .run();

  if ((reserve.meta?.changes ?? 0) === 0) {
    return {
      httpStatus: 409,
      body: {
        error: 'A withdrawal for this asset is already in progress.',
        code: 'WITHDRAWAL_IN_PROGRESS',
      },
    };
  }

  try {
    const transfer = await submitPrivateTransfer(env, session.x_id, {
      asset,
      amount: amountStr,
      recipientAccount: destination.intentsAccountId,
    });

    await env.DB.prepare(
      `UPDATE withdrawals
          SET tx_hash = ?, intent_hash = ?, deposit_address = ?, settlement_status = 'SUBMITTED', updated_at = ?
        WHERE id = ?`
    )
      .bind(
        transfer.intentHash,
        transfer.intentHash,
        transfer.depositAddress,
        Date.now(),
        withdrawalId
      )
      .run();

    // Poll briefly so fast internal near.com transfers (~5-10s) return COMPLETED immediately
    const settlement = await waitForSettlement(env, session.x_id, transfer.depositAddress, {
      timeoutMs: 20_000,
      intervalMs: 1_500,
    }).catch(() => ({ status: 'SUBMITTED', terminal: false, raw: {} }));

    const normalizedStatus = String(settlement.status || 'SUBMITTED').toUpperCase();
    const shareLink = `${resolveOrigin(env)}/receipt/${withdrawalId}?v=2`;

    if (normalizedStatus === 'SUCCESS') {
      await env.DB.prepare(
        `UPDATE withdrawals
            SET status = 'COMPLETED', settlement_status = 'SUCCESS', confirmed_at = ?, updated_at = ?
          WHERE id = ? AND status = 'PENDING'`
      )
        .bind(Date.now(), Date.now(), withdrawalId)
        .run();

      return {
        httpStatus: 200,
        body: {
          success: true,
          withdrawalId,
          status: 'COMPLETED',
          txHash: transfer.intentHash,
          intentHash: transfer.intentHash,
          destinationAddress: destination.nearcomAddress,
          intentsAccountId: destination.intentsAccountId,
          asset: balance.symbol,
          amount: amountStr,
          privacy: 'confidential',
          rail: 'nearcom_internal',
          shareLink,
          message: `Withdrew ${amountStr} ${balance.symbol} to ${destination.nearcomAddress}`,
        },
      };
    }

    if (normalizedStatus === 'FAILED' || normalizedStatus === 'REFUNDED') {
      const reason =
        normalizedStatus === 'REFUNDED'
          ? '1Click refunded the transfer back to your confidential balance.'
          : '1Click reported the internal transfer as failed.';
      await env.DB.prepare(
        `UPDATE withdrawals
            SET status = 'FAILED', settlement_status = ?, error = ?, error_code = 'SETTLEMENT_FAILED', updated_at = ?
          WHERE id = ? AND status = 'PENDING'`
      )
        .bind(normalizedStatus, reason, Date.now(), withdrawalId)
        .run();

      return {
        httpStatus: 502,
        body: {
          error: reason,
          code: 'SETTLEMENT_FAILED',
          withdrawalId,
        },
      };
    }

    // Still processing; background reconciliation will mark COMPLETED on SUCCESS
    return {
      httpStatus: 202,
      body: {
        success: true,
        withdrawalId,
        status: 'PENDING',
        txHash: transfer.intentHash,
        intentHash: transfer.intentHash,
        destinationAddress: destination.nearcomAddress,
        intentsAccountId: destination.intentsAccountId,
        asset: balance.symbol,
        amount: amountStr,
        privacy: 'confidential',
        rail: 'nearcom_internal',
        shareLink,
        message: `Submitted ${amountStr} ${balance.symbol} withdrawal to ${destination.nearcomAddress}`,
      },
    };
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 500);
    console.error(
      `[nearcomWithdraw] failed id=${withdrawalId} x=${session.x_handle} asset=${asset} dest=${destination.nearcomAddress} reason=${message.slice(0, 200)}`
    );
    await env.DB.prepare(
      `UPDATE withdrawals
          SET status = 'FAILED', error = ?, error_code = 'SETTLEMENT_FAILED', settlement_status = 'FAILED', updated_at = ?
        WHERE id = ? AND status = 'PENDING'`
    )
      .bind(message, Date.now(), withdrawalId)
      .run()
      .catch(() => {});

    return {
      httpStatus: 502,
      body: {
        error: `near.com withdrawal failed: ${publicErrorMessage(err, 'settlement failed')}`,
        code: 'SETTLEMENT_FAILED',
        withdrawalId,
      },
    };
  }
}
