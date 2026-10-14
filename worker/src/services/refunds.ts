/**
 * Escrow refund service.
 *
 * escrow.uprail.near holds the pooled gross (amount + fee) of every unclaimed
 * payment. A refund returns that gross to the original sender — used by the
 * hourly expiry cron and by the sender-facing cancel endpoint.
 *
 * Concurrency: the row is flipped ESCROWED → REFUNDED with an atomic guarded
 * UPDATE before any fund movement, so a recipient claim (which requires
 * ESCROWED) and a refund can never both win. A failed transfer reverts the
 * row to ESCROWED so the cron can retry later.
 */

import type { Env, Payment, PaymentStatus } from '../types';
import { PaymentStatus as Status } from '../types';
import * as nearRpc from './nearRpc';

export interface RefundResult {
  /** True when the onchain transfer landed and the row is REFUNDED. */
  refunded: boolean;
  txHash?: string;
  /** Why no refund happened (row moved on, missing data, or transfer error). */
  error?: string;
  /** True when the row was already REFUNDED (nothing to do). */
  alreadyRefunded?: boolean;
}

/**
 * Decimal-string addition without float error: amounts are human-readable
 * decimals with up to ~15 fractional digits; splitting on '.' keeps the sum
 * exact for any precision the fee math can produce.
 */
export function addDecimalStrings(a: string, b: string): string {
  const norm = (s: string) => {
    const t = (s || '0').trim();
    return /^[+]?\d+(\.\d+)?$/.test(t) ? t : null;
  };
  const sa = norm(a);
  const sb = norm(b);
  if (!sa || !sb) return sa || sb || '0';
  const [ai, af = ''] = sa.split('.');
  const [bi, bf = ''] = sb.split('.');
  const scale = Math.max(af.length, bf.length);
  const aInt = BigInt(ai + af.padEnd(scale, '0'));
  const bInt = BigInt(bi + bf.padEnd(scale, '0'));
  const total = (aInt + bInt).toString().padStart(scale + 1, '0');
  if (scale === 0) return total;
  const intPart = total.slice(0, total.length - scale) || '0';
  const fracPart = total.slice(total.length - scale).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/**
 * Resolves the sender's onchain vault account for a payment.
 */
async function resolveSenderAccount(env: Env, payment: Payment): Promise<string | null> {
  const xId = payment.sender_x_id;
  if (!xId) return null;
  try {
    const row = await env.DB.prepare('SELECT near_account FROM x_identities WHERE x_id = ?')
      .bind(xId)
      .first<{ near_account: string | null }>();
    if (row?.near_account) return row.near_account;
  } catch (err) {
    console.warn('[refund] sender account lookup failed:', err);
  }
  try {
    const derived = await nearRpc.deriveUserNearKeypair(env, xId);
    return derived.accountId;
  } catch (err) {
    console.warn('[refund] sender account derivation failed:', err);
    return null;
  }
}

/**
 * Refunds an escrowed payment's gross (amount + fee) to the sender.
 * Safe to call concurrently: only one caller can win the ESCROWED flip.
 */
export async function refundEscrowedPayment(env: Env, payment: Payment): Promise<RefundResult> {
  if (payment.status === Status.REFUNDED) {
    if (payment.refund_tx_hash) {
      return { refunded: false, alreadyRefunded: true };
    }
    // Crash-recovered row: REFUNDED was recorded but the transfer never
    // landed — fall through to the transfer step below.
  } else {
    if (payment.status !== Status.ESCROWED) {
      return { refunded: false, error: `payment is ${payment.status}, not escrowed` };
    }
    if (!payment.intent_hash) {
      // No recorded escrow deposit: the funds never entered the pooled escrow
      // (settlement failed before finalize). Nothing to return.
      return { refunded: false, error: 'no escrow deposit recorded for this payment' };
    }
    const senderAccount = await resolveSenderAccount(env, payment);
    if (!senderAccount) {
      return { refunded: false, error: 'sender account could not be resolved' };
    }

    // Atomic reserve: flip ESCROWED → REFUNDED so a concurrent claim loses.
    try {
      const reserve = await env.DB.prepare(
        `UPDATE payments SET status = ?, updated_at = ? WHERE id = ? AND status = ?`
      )
        .bind(Status.REFUNDED, Date.now(), payment.id, Status.ESCROWED)
        .run();
      if ((reserve.meta?.changes ?? 0) === 0) {
        const current = await env.DB.prepare('SELECT status, refund_tx_hash FROM payments WHERE id = ?')
          .bind(payment.id)
          .first<{ status: string; refund_tx_hash: string | null }>();
        if (current?.status === Status.REFUNDED && current.refund_tx_hash) {
          return { refunded: false, alreadyRefunded: true };
        }
        return { refunded: false, error: 'payment is no longer escrowed' };
      }
    } catch (err) {
      console.error(`[refund] reserve failed for ${payment.id}:`, err);
      return { refunded: false, error: 'refund reservation failed' };
    }
  }

  // Transfer gross = amount + fee back to the sender's vault.
  const gross = addDecimalStrings(payment.amount || '0', payment.fee || '0');
  const senderAccount = await resolveSenderAccount(env, payment);
  if (!senderAccount) {
    await revertToEscrowed(env, payment.id);
    return { refunded: false, error: 'sender account could not be resolved' };
  }

  let result = await nearRpc.executeTransferFromEscrowIntent(env, senderAccount, payment.asset, gross);
  if (!result.success && !result.ambiguous) {
    // A NEAR-native asset (launchpad meme) was locked into escrow as a plain
    // NEP-141 — escrow holds no intents ledger entry for it, so the intents
    // transfer can never succeed. The claim payout already settles these with
    // a plain ft_transfer; the refund must too, or expired and cancelled meme
    // payments retry every hour forever with the gross stuck in escrow.
    const plain = await nearRpc.executeEscrowFtWithdraw(env, senderAccount, payment.asset, gross);
    if (plain.success && plain.txHash) {
      result = { success: true, txHash: plain.txHash };
    } else {
      result = { success: false, error: plain.error || result.error };
    }
  }
  if (!result.success || !result.txHash) {
    console.error(`[refund] onchain refund failed for ${payment.id}:`, result.error);
    if (result.ambiguous) {
      // Broadcast may have landed — reverting to ESCROWED would let the next
      // retry double-refund from the pooled escrow. Leave the row REFUNDED
      // (hash NULL) for the crash-recovery path; the double-risk is logged.
      console.error(
        `[refund] CRITICAL: ambiguous refund transfer for ${payment.id} — manual reconciliation may be required`
      );
      return { refunded: false, error: result.error || 'refund transfer status unknown' };
    }
    await revertToEscrowed(env, payment.id);
    return { refunded: false, error: result.error || 'refund transfer failed' };
  }

  try {
    await env.DB.prepare(
      'UPDATE payments SET refund_tx_hash = ?, updated_at = ? WHERE id = ? AND status = ?'
    )
      .bind(result.txHash, Date.now(), payment.id, Status.REFUNDED)
      .run();
  } catch (err) {
    // The money moved; the row is already REFUNDED, only the hash is missing.
    console.error(`[refund] CRITICAL: refund ${result.txHash} landed but hash write failed for ${payment.id}:`, err);
  }

  return { refunded: true, txHash: result.txHash };
}

async function revertToEscrowed(env: Env, paymentId: string): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE payments SET status = ?, updated_at = ? WHERE id = ? AND status = ?`
    )
      .bind(Status.ESCROWED, Date.now(), paymentId, Status.REFUNDED)
      .run();
  } catch (err) {
    console.error(`[refund] CRITICAL: revert to ESCROWED failed for ${paymentId}:`, err);
  }
}
