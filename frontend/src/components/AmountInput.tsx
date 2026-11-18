'use client';

import React from 'react';
import { Token } from '../types';
import { AssetPicker } from './AssetPicker';
import { tokenUsdPrice, formatUsd } from '../lib/api';

interface AmountInputProps {
  amount: string;
  onChangeAmount: (val: string) => void;
  tokens: Token[];
  selectedToken: Token;
  onSelectToken: (token: Token) => void;
  disabled?: boolean;
  /** Optional fee rate added on top (e.g. 0.01) so quick % / MAX leaves room for fees. */
  feeRate?: number;
}

export const AmountInput: React.FC<AmountInputProps> = ({
  amount,
  onChangeAmount,
  tokens,
  selectedToken,
  onSelectToken,
  disabled = false,
  feeRate = 0,
}) => {
  const numericAmount = parseFloat(amount) || 0;
  const price = tokenUsdPrice(selectedToken);
  const estimatedUsd = price === null ? null : numericAmount * price;

  const handleQuickPercent = (pct: number) => {
    const precision = Math.min(selectedToken.decimals ?? 6, 6);
    if (pct === 100 && feeRate <= 0) {
      // Fee-free flows (e.g. wallet withdrawal) send the exact balance.
      onChangeAmount(selectedToken.balance || '0');
      return;
    }
    const totalBalance = parseFloat(selectedToken.balance || '0') || 0;
    const rawTarget = (totalBalance * pct) / 100;
    const adjusted = feeRate > 0 ? rawTarget / (1 + feeRate) : rawTarget;
    const scale = 10 ** precision;
    let units = Math.floor((adjusted + 1e-12) * scale);
    if (feeRate > 0) {
      while (units > 0) {
        const candidate = units / scale;
        const fee = Number((candidate * feeRate).toFixed(precision));
        if (candidate + fee <= rawTarget + 1e-12) break;
        units -= 1;
      }
    }
    const fixed = (units / scale).toFixed(precision);
    const calc = fixed.includes('.')
      ? fixed.replace(/0+$/, '').replace(/\.$/, '')
      : fixed;
    onChangeAmount(calc || '0');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    // Allow empty or positive numeric with at most one decimal
    if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
      if (val.startsWith('.')) val = '0' + val;
      onChangeAmount(val);
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
          Amount
        </label>
        {selectedToken.balance && (
          <div className="flex items-center space-x-1.5 text-xs text-stone-500">
            <span>Available:</span>
            <span className="font-bold text-stone-900 font-mono">
              {selectedToken.balance} {selectedToken.symbol}
            </span>
          </div>
        )}
      </div>

      {/* Input container */}
      <div className="rounded-2xl bg-stone-50 border border-stone-200 focus-within:border-[var(--fg)] focus-within:ring-1 focus-within:ring-[var(--fg)] p-4 transition-all shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={handleInputChange}
            disabled={disabled}
            placeholder="0.00"
            className="w-full min-w-0 border-0 bg-transparent p-0 text-2xl sm:text-3xl font-extrabold text-stone-950 placeholder-stone-300 focus:outline-none focus-visible:outline-none focus:ring-0"
          />

          <AssetPicker
            tokens={tokens}
            selectedToken={selectedToken}
            onSelectToken={onSelectToken}
            disabled={disabled}
          />
        </div>

        {/* Sub-row: USD value and Quick % buttons */}
        <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-stone-200/80">
          <span className="text-xs font-mono text-stone-500">
            ≈ {formatUsd(estimatedUsd)} USD
          </span>

          <div className="flex items-center gap-1.5">
            {[25, 50, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => handleQuickPercent(pct)}
                disabled={disabled}
                className="min-h-8 min-w-12 px-2.5 py-2 -my-1.5 rounded-[10px] text-xs font-mono font-bold bg-stone-200/70 hover:bg-stone-300 text-stone-800 transition-colors cursor-pointer disabled:opacity-40"
              >
                {pct === 100 ? 'MAX' : `${pct}%`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

