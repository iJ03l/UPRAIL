import { addDecimalStrings } from '../services/refunds';

export interface SendFeeBreakdown {
  /** Exact amount delivered to the recipient (100% of quoted/entered amount). */
  recipientAmount: string;
  /** Protocol fee charged on top from the sender's balance. */
  protocolFee: string;
  /** Exact total debited from the sender's balance (`recipientAmount + protocolFee`). */
  totalDebit: string;
  /** Parsed decimal fee rate used (`0.01` for 1%). */
  feePercent: number;
}

/**
 * Computes fee-on-top send math so the recipient always receives 100% of the
 * quoted/entered `rawAmount` while `FEE_PERCENT` (default 1%) is added on top
 * from the sender's balance.
 */
export function computeSendFeeBreakdown(
  rawAmount: string,
  feePercentRaw?: string,
  maxFractionDigits = 6
): SendFeeBreakdown {
  const parsedRate = parseFloat(feePercentRaw || '0.01');
  const feePercent =
    Number.isFinite(parsedRate) && parsedRate >= 0 ? Math.min(0.1, parsedRate) : 0.01;
  const trimmed = String(rawAmount ?? '').trim();
  const recipientNum = parseFloat(trimmed) || 0;
  const digits = Math.max(0, Math.min(18, maxFractionDigits));
  const protocolFee =
    recipientNum > 0 && feePercent > 0
      ? (recipientNum * feePercent).toFixed(digits).replace(/\.?0+$/, '') || '0'
      : '0';
  const recipientAmount = trimmed || '0';
  const totalDebit =
    parseFloat(protocolFee) > 0 ? addDecimalStrings(recipientAmount, protocolFee) : recipientAmount;

  return {
    recipientAmount,
    protocolFee,
    totalDebit,
    feePercent,
  };
}
