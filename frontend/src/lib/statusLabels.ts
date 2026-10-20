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
