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
}

export const AmountInput: React.FC<AmountInputProps> = ({
  amount,
  onChangeAmount,
  tokens,
  selectedToken,
  onSelectToken,
  disabled = false,
}) => {
  const numericAmount = parseFloat(amount) || 0;
  const price = tokenUsdPrice(selectedToken);
  const estimatedUsd = price === null ? null : numericAmount * price;

  const handleQuickPercent = (pct: number) => {
    const totalBalance = parseFloat(selectedToken.balance || '0');
    const calc = ((totalBalance * pct) / 100).toFixed(
      selectedToken.decimals > 6 ? 4 : 2
    );
    onChangeAmount(calc);
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
        <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
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
      <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4 focus-within:border-black focus-within:ring-1 focus-within:ring-black/10 focus-within:bg-white transition-all shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={handleInputChange}
            disabled={disabled}
            placeholder="0.00"
            className="w-full bg-transparent text-2xl sm:text-3xl font-extrabold text-stone-950 placeholder-stone-300 focus:outline-none"
          />

          <AssetPicker
            tokens={tokens}
            selectedToken={selectedToken}
            onSelectToken={onSelectToken}
            disabled={disabled}
          />
        </div>

        {/* Sub-row: USD value and Quick % buttons */}
        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-stone-200/80">
          <span className="text-xs font-mono text-stone-500">
            ≈ {formatUsd(estimatedUsd)} USD
          </span>

          <div className="flex items-center space-x-1.5">
            {[25, 50, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => handleQuickPercent(pct)}
                disabled={disabled}
                className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-lg bg-stone-200/70 hover:bg-stone-300 text-stone-700 transition-colors disabled:opacity-40"
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
