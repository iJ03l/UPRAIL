'use client';

import React, { useState } from 'react';
import { ArrowLeftRight, Sparkles } from 'lucide-react';
import { Token } from '../types';
import { AssetPicker } from './AssetPicker';
import { StabilizeModal } from './StabilizeModal';
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
  const [isStabilizeOpen, setIsStabilizeOpen] = useState(false);
  const numericAmount = parseFloat(amount) || 0;
  const price = tokenUsdPrice(selectedToken);
  const estimatedUsd = price === null ? null : numericAmount * price;

  const handleQuickPercent = (pct: number) => {
    if (pct === 100) {
      // MAX must send the exact balance, not a display-rounded copy.
      onChangeAmount(selectedToken.balance || '0');
      return;
    }
    const totalBalance = parseFloat(selectedToken.balance || '0') || 0;
    const fixed = ((totalBalance * pct) / 100).toFixed(
      Math.min(selectedToken.decimals ?? 18, 18)
    );
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

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => setIsStabilizeOpen(true)}
              disabled={disabled}
              title="Stabilize any token to USDC or USDT via 1Click Confidential Intents"
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-stone-950 hover:bg-black text-white border border-stone-900 text-[11px] font-display font-extrabold uppercase tracking-wider shadow-xs hover:shadow-sm transition-all cursor-pointer disabled:opacity-40 group"
            >
              <Sparkles className="w-3 h-3 text-orange-400 group-hover:rotate-12 transition-transform" />
              <span>Stabilize</span>
              <ArrowLeftRight className="w-3 h-3 text-stone-400 group-hover:text-white transition-colors" />
            </button>

            <AssetPicker
              tokens={tokens}
              selectedToken={selectedToken}
              onSelectToken={onSelectToken}
              disabled={disabled}
            />
          </div>
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

      <StabilizeModal
        isOpen={isStabilizeOpen}
        onClose={() => setIsStabilizeOpen(false)}
        tokens={tokens}
        initialToken={selectedToken}
        initialAmount={amount}
        onSuccess={(res) => {
          const target = tokens.find(
            (t) => t.symbol.toUpperCase() === res.targetSymbol.toUpperCase()
          );
          if (target) {
            onSelectToken(target);
            onChangeAmount(res.amountOut);
          }
        }}
      />
    </div>
  );
};

