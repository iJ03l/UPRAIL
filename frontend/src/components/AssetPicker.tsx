import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, Check, Shield } from 'lucide-react';
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outer click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredTokens = tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(search.toLowerCase()) ||
      t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2.5 px-3 py-2 rounded-xl bg-dark-card hover:bg-dark-cardHover border border-dark-border text-left transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-brand-500/50 disabled:opacity-50"
      >
        <img
          src={selectedToken.iconUrl}
          alt={selectedToken.symbol}
          className="w-6 h-6 rounded-full bg-slate-800 object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              'https://raw.githubusercontent.com/feathericons/feather/master/icons/circle.svg';
          }}
        />
        <div className="flex flex-col">
          <span className="text-sm font-bold text-white tracking-wide">
            {selectedToken.symbol}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 ml-1 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Modal / Dropdown list */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-dark-card border border-dark-border shadow-2xl p-2.5 z-50 animate-fade-in">
          {/* Search */}
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets..."
              className="w-full bg-dark-surface rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 border border-dark-border focus:outline-none focus:border-brand-500"
              autoFocus
            />
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1">
            {filteredTokens.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No tokens found</p>
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
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-colors text-left ${
                      isSelected
                        ? 'bg-brand-500/10 border border-brand-500/30'
                        : 'hover:bg-slate-800/60 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <img
                        src={token.iconUrl}
                        alt={token.symbol}
                        className="w-7 h-7 rounded-full bg-slate-800 object-cover"
                      />
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <span className="text-sm font-bold text-white">
                            {token.symbol}
                          </span>
                          {token.badge && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/20 flex items-center">
                              <Shield className="w-2.5 h-2.5 mr-0.5 inline" />
                              {token.badge}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-400 block">
                          {token.name}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-semibold text-white block">
                        ${token.priceUsd.toLocaleString()}
                      </span>
                      {token.balance && (
                        <span className="text-[11px] text-slate-400">
                          {token.balance} {token.symbol}
                        </span>
                      )}
                    </div>

                    {isSelected && (
                      <Check className="w-4 h-4 text-brand-400 ml-1.5 flex-shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
