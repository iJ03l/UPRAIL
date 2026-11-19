/**
 * Human labels for backend payment/transaction statuses.
 * Internal statuses stay unchanged; only the UI copy is normalized.
 */
export const historyStatusLabel = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'success':
    case 'completed':
      return 'Complete';
    case 'claimed':
      return 'Received';
    case 'pending':
    case 'escrowed':
      return 'Waiting';
    case 'ready':
      return 'Ready';
    case 'declined':
      return 'Declined';
    case 'failed':
      return 'Failed';
    case 'expired':
      return 'Expired';
    case 'refunded':
      return 'Refunded';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
};

export const activityStatusMeta = (params: {
  type: 'payment' | 'deposit' | 'withdrawal' | 'request' | 'gift';
  isSent: boolean;
  status: string;
}): { label: string; className: string } => {
  const s = (params.status || '').toLowerCase();

  const emerald =
    'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-300';
  const red =
    'text-red-700 bg-red-50 border-red-200 dark:bg-red-950/50 dark:border-red-800 dark:text-red-300';
  const amber =
    'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-300';
  const stone =
    'text-stone-600 bg-stone-100 border-stone-200 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-300';

  if (params.type === 'gift') {
    if (s === 'claimed') {
      return { label: params.isSent ? 'GIFT CLAIMED' : 'GIFT RECEIVED', className: emerald };
    }
    if (s === 'reclaimed') {
      return { label: 'RECLAIMED', className: amber };
    }
    return { label: historyStatusLabel(s).toUpperCase(), className: stone };
  }

  if (params.type === 'request') {
    if (s === 'completed' || s === 'settled' || s === 'success') {
      return { label: 'PAID', className: emerald };
    }
    if (s === 'declined') {
      return { label: 'DECLINED', className: red };
    }
    if (s === 'cancelled') {
      return { label: 'CANCELLED', className: amber };
    }
    if (s === 'expired') {
      return { label: 'EXPIRED', className: stone };
    }
    if (s === 'failed') {
      return { label: 'FAILED', className: red };
    }
    return { label: 'PENDING', className: amber };
  }

  if (params.isSent) {
    if (s === 'claimed' || s === 'success') {
      return { label: 'DELIVERED', className: emerald };
    }
    if (s === 'cancelled') {
      return { label: 'CANCELLED', className: amber };
    }
    if (s === 'failed') {
      return { label: 'FAILED', className: red };
    }
    if (s === 'declined') {
      return { label: 'DECLINED', className: red };
    }
    if (s === 'expired') {
      return { label: 'EXPIRED', className: stone };
    }
    if (s === 'refunded') {
      return { label: 'REFUNDED', className: stone };
    }
    return { label: 'WAITING FOR CLAIM', className: stone };
  }

  if (s === 'claimed' || s === 'success') {
    return { label: 'RECEIVED', className: emerald };
  }
  if (s === 'failed' || s === 'declined') {
    return { label: s === 'declined' ? 'DECLINED' : 'FAILED', className: red };
  }
  if (s === 'cancelled') {
    return { label: 'CANCELLED', className: amber };
  }
  return { label: historyStatusLabel(s).toUpperCase(), className: stone };
};

/**
 * User-facing explanation for a cancelled payment. New rows carry a sanitized
 * reason from the worker; older rows only have a status, so we fall back to a
 * neutral explanation rather than inventing a cause.
 */
export const cancellationReason = (
  reason?: string | null,
  code?: string | null
): string => {
  const clean = (reason || '').trim();
  // The worker's generic fallback adds no information beyond the status.
  const isGeneric =
    !clean ||
    /^(onchain settlement failed|settlement failed|escrow lock failed)\.?$/i.test(clean);

  if (!isGeneric) return clean;

  switch ((code || '').toUpperCase()) {
    case 'USER_CANCELLED':
      return 'Cancelled by you before the payment was sent.';
    case 'SETTLEMENT_FAILED':
      return 'The network did not confirm the transfer. The payment was cancelled so it cannot be claimed twice.';
    case 'ESCROW_LOCK_FAILED':
      return 'The payment could not be locked in escrow. The network did not confirm the transfer.';
    default:
      return 'The payment was cancelled before settlement. No reason was recorded.';
  }
};
