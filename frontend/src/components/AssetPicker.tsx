'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { Token } from '../types';

interface AssetPickerProps {
  tokens: Token[];
  selectedToken: Token;
  onSelectToken: (token: Token) => void;
  disabled?: boolean;
}

export const AssetPicker: React.FC<AssetPickerProps> = ({
  tokens,
  selectedToken,
  onSelectToken,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const filteredTokens = tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(search.toLowerCase()) ||
      t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      {/* Trigger Button (Compact pill inside the amount row) */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-white hover:bg-stone-100 border border-stone-200 text-left transition-colors focus:outline-none focus:border-black disabled:opacity-50 shadow-xs cursor-pointer select-none"
        title="Change Token"
      >
        <img
          src={selectedToken.iconUrl}
          alt={selectedToken.symbol}
          className="w-5 h-5 rounded-full bg-stone-100 object-cover border border-stone-200 flex-shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              'https://raw.githubusercontent.com/feathericons/feather/master/icons/circle.svg';
          }}
        />
        <span className="text-xs sm:text-sm font-bold text-stone-950 font-mono tracking-tight">
          {selectedToken.symbol}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-stone-400 ml-0.5 flex-shrink-0" />
      </button>

      {/* 
        Token Selection Modal (Rendered outside the input box, fixed overlay)
        Displays full list cleanly without clipping or bounding box constraints
      */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 selection:bg-black selection:text-white">
          {/* Backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity cursor-pointer z-[100]"
            aria-hidden="true"
          />

          {/* Modal Panel (Completely outside the input container) */}
          <div className="relative w-full max-w-sm bg-white rounded-3xl border border-stone-200 shadow-2xl p-5 z-[101] animate-fade-in space-y-4 font-sans">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div>
                <h3 className="font-display font-extrabold text-base text-stone-950">
                  Select Asset
                </h3>
                <p className="text-[11px] font-mono text-stone-400">
                  Confidential & cross-chain tokens
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-xl text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-stone-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or symbol..."
                autoFocus
                className="w-full bg-stone-50 rounded-xl pl-9 pr-3 py-2.5 text-xs text-stone-900 placeholder-stone-400 border border-stone-200 focus:outline-none focus:border-black font-mono transition-colors"
              />
            </div>

            {/* Full Token List */}
            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-0.5">
              {filteredTokens.length === 0 ? (
                <p className="text-xs text-stone-400 text-center py-6 font-mono">
                  No assets match "{search}"
                </p>
              ) : (
                filteredTokens.map((token) => {
                  const isSelected = token.id === selectedToken.id;
                  return (
                    <button
                      key={token.id}
                      type="button"
                      onClick={() => {
                        onSelectToken(token);
                        setIsOpen(false);
                        setSearch('');
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-2xl transition-colors text-left cursor-pointer ${
                        isSelected
                          ? 'bg-stone-100 border border-stone-300'
                          : 'hover:bg-stone-50 text-stone-800 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <img
                          src={token.iconUrl}
                          alt={token.symbol}
                          className="w-8 h-8 rounded-full bg-stone-100 object-cover border border-stone-200 flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              'https://raw.githubusercontent.com/feathericons/feather/master/icons/circle.svg';
                          }}
                        />
                        <div>
                          <div className="text-xs font-bold text-stone-950 flex items-center space-x-1.5 font-mono">
                            <span>{token.symbol}</span>
                            {token.badge && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-stone-200/70 text-stone-700 font-mono font-medium">
                                {token.badge}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-stone-500 font-sans">
                            {token.name}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 text-right font-mono">
                        <div>
                          <div className="text-xs font-bold text-stone-950">
                            ${token.priceUsd.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                          {token.balance && (
                            <div className="text-[10px] text-stone-400">
                              Bal: {token.balance}
                            </div>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-stone-900 flex-shrink-0 ml-1" />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer summary */}
            <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-[10px] font-mono text-stone-400">
              <span>{tokens.length} Assets Available</span>
              <span>NEAR Intents Powered</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
