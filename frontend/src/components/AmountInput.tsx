import React from 'react';
import { Token } from '../types';
import { AssetPicker } from './AssetPicker';

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
  const estimatedUsd = (numericAmount * selectedToken.priceUsd).toFixed(2);

  const handleQuickPercent = (pct: number) => {
    const totalBalance = parseFloat(selectedToken.balance || '100');
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
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Amount
        </label>
        {selectedToken.balance && (
          <div className="flex items-center space-x-1.5 text-xs text-slate-400">
            <span>Available:</span>
            <span className="font-semibold text-slate-200">
              {selectedToken.balance} {selectedToken.symbol}
            </span>
          </div>
        )}
      </div>

      {/* Input container */}
      <div className="rounded-2xl bg-dark-surface border border-dark-border p-3.5 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500/20 transition-all">
        <div className="flex items-center justify-between">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={handleInputChange}
            disabled={disabled}
            placeholder="0.00"
            className="w-full bg-transparent text-2xl sm:text-3xl font-extrabold text-white placeholder-slate-600 focus:outline-none"
          />

          <AssetPicker
            tokens={tokens}
            selectedToken={selectedToken}
            onSelectToken={onSelectToken}
            disabled={disabled}
          />
        </div>

        {/* Sub-row: USD value and Quick % buttons */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-dark-border/40">
          <span className="text-xs font-medium text-slate-400">
            ≈ ${Number(estimatedUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
          </span>

          <div className="flex items-center space-x-1.5">
            {[25, 50, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => handleQuickPercent(pct)}
                disabled={disabled}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-dark-card hover:bg-slate-700/80 text-slate-300 border border-dark-border transition-colors disabled:opacity-40"
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
