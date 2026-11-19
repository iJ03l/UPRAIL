/**
 * Classifies how a transaction impacts the user's available balance.
 * - 'debit': balance decreased (red, '-' sign)
 * - 'incoming': balance increased (green, '+' sign)
 * - 'none': no balance action occurred (colorless/neutral, no sign prefix)
 */
export type BalanceEffect = 'debit' | 'incoming' | 'none';

export interface BalanceActionParams {
  type?: 'payment' | 'deposit' | 'withdrawal' | 'request' | 'gift';
  isSent: boolean;
  status: string;
  isRequest?: boolean;
}

export function getTransactionBalanceEffect(params: BalanceActionParams): BalanceEffect {
  const status = (params.status || '').toLowerCase();

  // 0. Timelocked Gifts
  if (params.type === 'gift') {
    if (status === 'reclaimed') {
      return 'incoming';
    }
    if (status === 'claimed') {
      return params.isSent ? 'debit' : 'incoming';
    }
    return 'none';
  }

  // 1. Payment Requests
  // Only completed/settled requests have an impact on balance.
  // Pending, declined, cancelled, or expired requests do NOT impact balance.
  if (params.isRequest || params.type === 'request') {
    if (status === 'completed' || status === 'settled' || status === 'success') {
      return params.isSent ? 'incoming' : 'debit';
    }
    return 'none';
  }

  // 2. Failed, Cancelled, Declined, Expired, Refunded transactions have NO impact on balance
  if (
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'declined' ||
    status === 'expired' ||
    status === 'refunded'
  ) {
    return 'none';
  }

  // 3. Deposits
  if (params.type === 'deposit') {
    if (status === 'success' || status === 'completed') {
      return 'incoming';
    }
    return 'none';
  }

  // 4. Withdrawals
  if (params.type === 'withdrawal') {
    if (status === 'success' || status === 'completed') {
      return 'debit';
    }
    return 'none';
  }

  // 5. Payments
  // Sent payment: when escrowed, delivered, claimed, or success -> money left user's balance (debit)
  if (params.isSent) {
    if (
      status === 'claimed' ||
      status === 'delivered' ||
      status === 'escrowed' ||
      status === 'success'
    ) {
      return 'debit';
    }
    return 'none';
  }

  // Received payment: only when claimed, delivered or success -> money added to user's balance (incoming)
  if (!params.isSent) {
    if (status === 'claimed' || status === 'delivered' || status === 'success') {
      return 'incoming';
    }
    return 'none';
  }

  return 'none';
}

/**
 * Returns the formatted amount representation:
 * - Debit: prefix '-', text-red-600 dark:text-red-400
 * - Incoming: prefix '+', text-emerald-600 dark:text-emerald-400
 * - None (no action on balance): no prefix, text-stone-600 dark:text-stone-300
 */
export function formatBalanceAmount(
  formattedAmount: string,
  effect: BalanceEffect
): {
  prefix: string;
  amount: string;
  colorClass: string;
} {
  const clean = formattedAmount.replace(/^[+-]/, '').trim();

  if (effect === 'debit') {
    return {
      prefix: '-',
      amount: clean,
      colorClass: 'text-red-600 dark:text-red-400',
    };
  }

  if (effect === 'incoming') {
    return {
      prefix: '+',
      amount: clean,
      colorClass: 'text-emerald-600 dark:text-emerald-400',
    };
  }

  return {
    prefix: '',
    amount: clean,
    colorClass: 'text-stone-600 dark:text-stone-300',
  };
}
