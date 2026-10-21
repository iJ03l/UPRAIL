/**
 * Human labels for backend payment/transaction statuses.
 * Internal statuses stay unchanged; only the UI copy is normalized.
 */
export const historyStatusLabel = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'success':
      return 'Complete';
    case 'claimed':
      return 'Received';
    case 'pending':
    case 'escrowed':
      return 'Waiting';
    case 'ready':
      return 'Ready';
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
