'use client';

import React, { useState, useEffect } from 'react';
import { CaretDown, MagnifyingGlass, Check } from '@phosphor-icons/react';
import { Token } from '../types';
import { TokenIcon } from './TokenIcon';
import { ModalSheet } from './ModalSheet';
import { api, formatUsd } from '../lib/api';

interface AssetPickerProps {
  tokens: Token[];
  selectedToken: Token;
  onSelectToken: (token: Token) => void;
  disabled?: boolean;
  /**
   * Locks the picker to a single rail (the tab strip is hidden and search
   * results are filtered by it too). Omit for the default multi-tab picker.
   */
  tab?: 'popular' | 'stables' | 'l1' | 'memes' | 'all';
}

const MEME_SYMBOLS_SET = new Set([
  'PEPE', 'WIF', '$WIF', 'BOME', 'DOGE', 'TRUMP', 'MELANIA', 'SHITZU',
  'BLACKDRAGON', 'MOCHI', 'NEIRO', 'BOBO', 'DEGEN', 'POPCAT', 'POP CAT',
  'FARTCOIN', 'BONK', 'MYRO', 'SLERF', 'BODEN', 'GNEAR', 'NOEAR', 'ABG',
  'JAMBO', 'PURGE', 'LONK', 'PURR', 'NEKO', 'SLUSH', 'NEARLY', 'BABY',
  'FLOKI', 'SHIB', 'MOG', 'SPX', 'BRETT', 'GIGA', 'CHILLGUY', 'PENGU',
  'PNUT', 'GOAT', 'MARCO', 'WOOF', 'BENDOG', 'WEN', 'TURBO', 'MOON',
  'CHUCK', 'HODL', 'ACT', 'PUPPIES', 'BULL', 'BEAR', 'APE', 'APECOIN',
]);

const MEME_CONTRACT_HINTS = [
  'meme-cooking', '0xshitzu', 'blackdragon', 'lonk', 'shitzu', 'neko',
  'purr', 'slush', 'tkn.near', 'nearlytrade', 'nearlytrader', 'nearlypad',
  'cookinglabs', 'launchpad', 'pump', 'meme', 'lonkingnearbackto2024',
];

function isMemeToken(symbol: string, contractId?: string): boolean {
  const sym = (symbol || '').toUpperCase();
  const c = (contractId || '').toLowerCase();
  if (MEME_SYMBOLS_SET.has(sym)) return true;
  if (sym.includes('MEME') || c.includes('meme')) return true;
  return MEME_CONTRACT_HINTS.some((h) => c.includes(h));
}

export const AssetPicker: React.FC<AssetPickerProps> = ({
  tokens,
  selectedToken,
  onSelectToken,
  disabled = false,
  tab,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'popular' | 'stables' | 'l1' | 'memes' | 'all'>(
    tab ?? 'popular'
  );
  // Rhea long tail: the curated list cannot hold 6k launchpad tokens, so a
  // typed query also searches the server list and merges matches in.
  const [remoteTokens, setRemoteTokens] = useState<Token[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const latestQuery = React.useRef('');

  useEffect(() => {
    const q = search.trim();
    latestQuery.current = q;
    if (q.length < 2) {
      setRemoteTokens([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const id = window.setTimeout(() => {
      api
        .searchTokens(q)
        .then((found) => {
          // Ignore responses for a query the user has already moved past.
          if (latestQuery.current === q) setRemoteTokens(found);
        })
        .catch(() => {})
        .finally(() => {
          if (latestQuery.current === q) setIsSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const mergedTokens = React.useMemo(() => {
    if (remoteTokens.length === 0) return tokens;
    const seen = new Set(tokens.map((t) => (t.id || '').toLowerCase()));
    return [...tokens, ...remoteTokens.filter((t) => !seen.has((t.id || '').toLowerCase()))];
  }, [tokens, remoteTokens]);

  const filteredTokens = React.useMemo(() => {
    const list = mergedTokens.filter((t) => {
      const symLower = t.symbol.toLowerCase();
      const nameLower = t.name.toLowerCase();
      const chainLower = (t.chain || '').toLowerCase();
      const sLower = search.toLowerCase().trim();

      // If searching, check symbol, name, chain, or contract id (so a pasted
      // `*.nearlytrade.near` contract resolves even with a generic symbol).
      // A locked rail still applies its own filter to search hits — otherwise
      // typing "usdc" on the Memes rail would surface a stablecoin.
      if (sLower) {
        const matchesQuery =
          symLower.includes(sLower) ||
          nameLower.includes(sLower) ||
          chainLower.includes(sLower) ||
          (t.nearContractId && t.nearContractId.toLowerCase().includes(sLower)) ||
          (t.badge && t.badge.toLowerCase().includes(sLower));
        if (!matchesQuery) return false;
        if (!tab) return true;
      }

      // Tab-based filtering when no active search text
      if (activeTab === 'popular') {
        const hasBalance = (parseFloat(t.balance || '0') || 0) > 0;
        return (
          hasBalance ||
          t.category === 'popular' ||
          ((t.chain === 'near' || !t.chain) && ['near', 'usdc', 'usdt', 'eth', 'btc', 'sol'].includes(symLower))
        );
      }
      if (activeTab === 'stables') {
        return ['usdc', 'usdt', 'dai', 'frax', 'usdg'].some((s) => symLower.includes(s));
      }
      if (activeTab === 'l1') {
        return (
          (t.chain === 'near' || t.chain === symLower) &&
          ['near', 'eth', 'btc', 'sol', 'avax', 'bnb', 'aurora'].some((s) => symLower.includes(s))
        );
      }
      if (activeTab === 'memes') {
        // The NEAR & Memes rail only holds NEAR-native assets: native NEAR
        // plus every meme-classified asset that actually lives on NEAR.
        // A meme classified on Solana or Ethereum (DOGE, SHIB, WIF) is a
        // cross-chain asset and belongs on the cross-chain tab — matching on
        // category or ticker alone listed them here with no NEAR contract to
        // receive to.
        if (chainLower && chainLower !== 'near') return false;
        return (
          t.category === 'memes' ||
          isMemeToken(t.symbol, t.nearContractId || t.id) ||
          symLower === 'near' ||
          symLower === 'wnear'
        );
      }
      return true;
    });

    // In Popular tab without search, deduplicate so each primary symbol appears once
    if (activeTab === 'popular' && !search) {
      const seen = new Set<string>();
      return list.filter((t) => {
        const sym = t.symbol.toUpperCase();
        if (seen.has(sym)) return false;
        seen.add(sym);
        return true;
      });
    }

    return list;
  }, [mergedTokens, search, activeTab]);

  // Launchpad tokens share tickers across contracts (SINGULARTY-2 vs -3):
  // disambiguate those rows with the contract id.
  const dupSymbols = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of filteredTokens) {
      const k = (t.symbol || '').toUpperCase();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [filteredTokens]);

  const shortContract = (c?: string) => {
    if (!c) return '';
    return c.length > 26 ? `${c.slice(0, 12)}…${c.slice(-8)}` : c;
  };

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
        <TokenIcon
          symbol={selectedToken.symbol}
          iconUrl={selectedToken.iconUrl}
          size="md"
        />
        <div className="flex flex-col">
          <span className="text-xs sm:text-sm font-bold text-stone-950 font-mono tracking-tight leading-none">
            {selectedToken.symbol}
          </span>
          {selectedToken.chain && (
            <span className="text-[9px] font-mono text-stone-400 uppercase">
              {selectedToken.chain}
            </span>
          )}
        </div>
        <CaretDown weight="fill" className="w-3.5 h-3.5 text-stone-400 ml-0.5 flex-shrink-0" />
      </button>

      {/* Token Selection Sheet / Modal */}
      <ModalSheet
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        zIndexClass="z-[100]"
        maxWidthClass="sm:max-w-sm"
        panelClassName="p-5 pt-2 sm:p-5 space-y-3.5 font-sans selection:bg-black selection:text-white"
        showCloseButton
        closeLabel="Close asset selector"
        ariaLabel="Select Asset"
      >
        {/* Header */}
        <div className="pb-2.5 pr-11 border-b border-stone-100">
          <h3 className="font-display font-extrabold text-base text-stone-950">
            Select Asset
          </h3>
          <p className="text-[11px] font-mono text-stone-500">
            Confidential &amp; cross-chain solver liquidity
          </p>
        </div>

        {/* Filter Tabs — hidden when the picker is locked to one rail */}
        {!tab && (
          <div className="flex p-0.5 rounded-xl bg-stone-100 border border-stone-200 text-[11px] font-mono font-bold overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => { setActiveTab('popular'); setSearch(''); }}
              className={`flex-1 min-w-[52px] py-2 px-2 rounded-lg transition-all text-center whitespace-nowrap cursor-pointer ${
                activeTab === 'popular' && !search
                  ? 'bg-white text-stone-950 shadow-2xs font-bold'
                  : 'text-stone-600 hover:text-black'
              }`}
            >
              Popular
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('stables'); setSearch(''); }}
              className={`flex-1 min-w-[52px] py-2 px-2 rounded-lg transition-all text-center whitespace-nowrap cursor-pointer ${
                activeTab === 'stables' && !search
                  ? 'bg-white text-stone-950 shadow-2xs font-bold'
                  : 'text-stone-600 hover:text-black'
              }`}
            >
              Stables
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('l1'); setSearch(''); }}
              className={`flex-1 min-w-[42px] py-2 px-2 rounded-lg transition-all text-center whitespace-nowrap cursor-pointer ${
                activeTab === 'l1' && !search
                  ? 'bg-white text-stone-950 shadow-2xs font-bold'
                  : 'text-stone-600 hover:text-black'
              }`}
            >
              L1s
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('memes'); setSearch(''); }}
              className={`flex-1 min-w-[50px] py-2 px-2 rounded-lg transition-all text-center whitespace-nowrap cursor-pointer ${
                activeTab === 'memes' && !search
                  ? 'bg-white text-stone-950 shadow-2xs font-bold'
                  : 'text-stone-600 hover:text-black'
              }`}
            >
              Memes
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('all'); setSearch(''); }}
              className={`flex-1 min-w-[38px] py-2 px-2 rounded-lg transition-all text-center whitespace-nowrap cursor-pointer ${
                activeTab === 'all' && !search
                  ? 'bg-white text-stone-950 shadow-2xs font-bold'
                  : 'text-stone-600 hover:text-black'
              }`}
            >
              All
            </button>
          </div>
        )}

        {/* Search Input */}
        <div className="relative">
          <MagnifyingGlass weight="bold" className="w-3.5 h-3.5 absolute left-3 top-3 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol, network, name..."
            autoFocus
            className="w-full bg-stone-50 rounded-xl pl-9 pr-3 py-2 text-base sm:text-xs text-stone-900 placeholder-stone-400 border border-stone-200 focus:outline-none focus:border-black font-mono transition-colors"
          />
        </div>

        {/* Full Token List */}
        <div className="max-h-72 overflow-y-auto space-y-1.5 pr-0.5">
          {filteredTokens.length === 0 ? (
            <p className="text-xs text-stone-500 text-center py-6 font-mono">
              No assets match &ldquo;{search}&rdquo;
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
                  className={`w-full flex items-center justify-between p-3 rounded-2xl transition-colors text-left cursor-pointer min-h-11 ${
                    isSelected
                      ? 'bg-stone-100 border border-stone-300'
                      : 'hover:bg-stone-50 text-stone-800 border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <TokenIcon
                      symbol={token.symbol}
                      iconUrl={token.iconUrl}
                      size="xl"
                    />
                    <div>
                      <div className="text-xs font-bold text-stone-950 flex items-center space-x-1.5 font-mono">
                        <span>{token.symbol}</span>
                        {token.chain && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200 text-stone-700 font-mono font-bold uppercase">
                            {token.chain}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-stone-500 font-sans" title={token.nearContractId || undefined}>
                        {token.name}
                        {dupSymbols.has((token.symbol || '').toUpperCase()) && token.nearContractId ? (
                          <span className="text-stone-400"> · {shortContract(token.nearContractId)}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 text-right font-mono">
                    <div>
                      <div className="text-xs font-bold text-stone-950">
                        {formatUsd(token.priceUsd ?? null)}
                      </div>
                      {token.balance && (
                        <div className="text-[11px] text-stone-500">
                          Bal: {token.balance}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <Check weight="bold" className="w-4 h-4 text-stone-900 flex-shrink-0 ml-1" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer summary */}
        <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] font-mono text-stone-500">
          <span>
            {search.trim()
              ? `${filteredTokens.length} match${filteredTokens.length === 1 ? '' : 'es'}${isSearching ? '…' : ''}`
              : `${tokens.length} Assets Available`}
          </span>
          <span>NEAR Intents + Rhea</span>
        </div>
      </ModalSheet>
    </>
  );
};
