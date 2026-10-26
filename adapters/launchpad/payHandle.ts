/**
 * Payout adapter for a launchpad keeper or contract.
 *
 * The launchpad keeps its own fee receiver. When a payout should reach an
 * X handle, send ft_transfer — never ft_transfer_call — to escrow, with the
 * memo from `uprailFeeMemo`. Native NEAR cannot carry a memo, so pay wNEAR.
 * After the transaction is final, POST the hash to /api/fees/adapter.
 */

export const UPRAIL_ESCROW_ACCOUNT = 'escrow.uprail.near';
export const UPRAIL_ADAPTER_PATH = '/api/fees/adapter';

const HANDLE_RE = /^[a-z0-9_]{1,15}$/;

export function uprailFeeMemo(handle: string): string {
  const normalized = handle.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(normalized)) {
    throw new Error('X handle must be 1-15 letters, numbers, or underscores.');
  }
  return `Fees to @${normalized} via UPRAIL`;
}

/** Arguments for NEP-141 ft_transfer. Attach exactly 1 yoctoNEAR. */
export function uprailFeeTransfer(handle: string, amountAtomic: string): {
  receiver_id: string;
  amount: string;
  memo: string;
} {
  if (!/^[1-9]\d*$/.test(amountAtomic)) {
    throw new Error('amountAtomic must be a positive integer string.');
  }
  return {
    receiver_id: UPRAIL_ESCROW_ACCOUNT,
    amount: amountAtomic,
    memo: uprailFeeMemo(handle),
  };
}
