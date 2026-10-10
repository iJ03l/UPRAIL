'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from '../lib/router';
import {
  ArrowLeft,
  Copy,
  Check,
  QrCode,
  Shield,
  Info,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Zap,
  CheckCircle2,
  ChevronDown,
  Search,
  Radio,
} from 'lucide-react';
import { useOnchainData } from '../hooks/useOnchainData';
import { fetchDepositAddress, fetchDepositStatus, DepositAddress, DepositStatusResponse } from '../lib/onchainApi';
import { api } from '../lib/api';
import { TokenIcon } from '../components/TokenIcon';

export interface TokenOption {
  symbol: string;
  name: string;
  badge: string;
  priceUsd: number;
  chains: string[];
}

export interface ChainOption {
  id: string;
  name: string;
  icon: string;
  badge: string;
  time: string;
  recommended?: boolean;
}

const TOKEN_OPTIONS: TokenOption[] = [
  { symbol: 'USDC', name: 'USD Coin', badge: 'Most Popular', priceUsd: 1.0, chains: ['base', 'arbitrum', 'sol', 'near', 'pol', 'bsc', 'op', 'avax', 'eth'] },
  { symbol: 'USDT', name: 'Tether USD', badge: 'Stablecoin', priceUsd: 1.0, chains: ['arbitrum', 'sol', 'near', 'pol', 'bsc', 'op', 'avax', 'eth', 'tron'] },
  { symbol: 'NEAR', name: 'NEAR Protocol', badge: 'Native Shield', priceUsd: 5.18, chains: ['near', 'bsc', 'sol', 'arbitrum'] },
  { symbol: 'ETH', name: 'Ethereum', badge: 'Cross-chain', priceUsd: 2500.0, chains: ['base', 'arbitrum', 'eth', 'op', 'scroll'] },
  { symbol: 'SOL', name: 'Solana', badge: 'Ultra-Fast', priceUsd: 145.0, chains: ['sol', 'near'] },
  { symbol: 'BTC', name: 'Bitcoin', badge: 'Native SegWit', priceUsd: 82000.0, chains: ['btc', 'near'] },
  { symbol: 'DOGE', name: 'Dogecoin', badge: 'Meme L1', priceUsd: 0.15, chains: ['doge', 'near'] },
  { symbol: 'DAI', name: 'Dai Stablecoin', badge: 'Decentralized', priceUsd: 1.0, chains: ['arbitrum', 'eth', 'near'] },
  { symbol: 'FRAX', name: 'Frax Stablecoin', badge: 'Stablecoin', priceUsd: 1.0, chains: ['near', 'eth'] },
  { symbol: 'AVAX', name: 'Avalanche', badge: 'EVM L1', priceUsd: 28.0, chains: ['avax', 'near'] },
  { symbol: 'BNB', name: 'BNB Chain', badge: 'EVM L1', priceUsd: 590.0, chains: ['bsc', 'near'] },
  { symbol: 'POL', name: 'Polygon', badge: 'PoS L2', priceUsd: 0.45, chains: ['pol', 'near'] },
];

const CHAIN_DEFINITIONS: Record<string, ChainOption> = {
  base: { id: 'base', name: 'Base', icon: '🔵', badge: 'L2 Sub-Cent', time: '~15s', recommended: true },
  arbitrum: { id: 'arbitrum', name: 'Arbitrum', icon: '🔷', badge: 'L2 Rollup', time: '~15s', recommended: true },
  sol: { id: 'sol', name: 'Solana', icon: '◎', badge: 'SPL Fast', time: '~15s', recommended: true },
  near: { id: 'near', name: 'NEAR', icon: 'Ⓝ', badge: 'Instant Finality', time: '~2s', recommended: true },
  pol: { id: 'pol', name: 'Polygon', icon: '🟣', badge: 'PoS Sub-Cent', time: '~20s', recommended: true },
  op: { id: 'op', name: 'Optimism', icon: '🔴', badge: 'OP Mainnet', time: '~15s' },
  bsc: { id: 'bsc', name: 'BNB Chain', icon: '🟡', badge: 'BEP-20', time: '~5s' },
  avax: { id: 'avax', name: 'Avalanche', icon: '🔺', badge: 'C-Chain', time: '~3s' },
  eth: { id: 'eth', name: 'Ethereum', icon: '⟠', badge: 'Mainnet L1', time: '~45s' },
  btc: { id: 'btc', name: 'Bitcoin', icon: '₿', badge: 'Native SegWit', time: '~1 conf' },
  tron: { id: 'tron', name: 'Tron', icon: '🔴', badge: 'TRC-20', time: '~60s' },
  doge: { id: 'doge', name: 'Dogecoin', icon: 'Ð', badge: 'Native Chain', time: '~1 conf' },
  scroll: { id: 'scroll', name: 'Scroll', icon: '📜', badge: 'zkEVM', time: '~30s' },
};

export const ReceivePage: React.FC = () => {
  const { hasIntentAccount, nearAccount, refreshBalances, refreshHistory } = useOnchainData();

  const [tokens, setTokens] = useState<TokenOption[]>(TOKEN_OPTIONS);
  // Start BLANK — do not derive until both token and chain are selected
  const [selectedToken, setSelectedToken] = useState<string>('');
  const [selectedChain, setSelectedChain] = useState<string>('');
  const [currentAddress, setCurrentAddress] = useState<DepositAddress | null>(null);
  const [isDeriving, setIsDeriving] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [showQr, setShowQr] = useState<boolean>(true);
  const [depositStatus, setDepositStatus] = useState<DepositStatusResponse | null>(null);
  const [settledSuccess, setSettledSuccess] = useState<boolean>(false);

  // Dropdown states
  const [isTokenDropdownOpen, setIsTokenDropdownOpen] = useState(false);
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [chainSearch, setChainSearch] = useState('');

  const tokenDropdownRef = useRef<HTMLDivElement>(null);
  const chainDropdownRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<any>(null);

  // Load any additional live tokens supported by NEAR Intents from backend
  useEffect(() => {
    let mounted = true;
    api.getTokens().then((toks) => {
      if (!mounted || !toks || toks.length === 0) return;
      const map = new Map<string, TokenOption>();
      // Seed with curated options
      for (const t of TOKEN_OPTIONS) {
        map.set(t.symbol.toUpperCase(), { ...t });
      }
      for (const t of toks) {
        const sym = t.symbol.toUpperCase();
        const chain = (t.chain || 'near').toLowerCase();
        if (map.has(sym)) {
          const existing = map.get(sym)!;
          if (!existing.chains.includes(chain)) {
            existing.chains.push(chain);
          }
          if (t.priceUsd) existing.priceUsd = t.priceUsd;
        } else {
          map.set(sym, {
            symbol: sym,
            name: t.name || sym,
            badge: t.badge || 'Cross-chain',
            priceUsd: t.priceUsd || 1.0,
            chains: [chain],
          });
        }
      }
      setTokens(Array.from(map.values()));
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Close dropdowns on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tokenDropdownRef.current && !tokenDropdownRef.current.contains(e.target as Node)) {
        setIsTokenDropdownOpen(false);
      }
      if (chainDropdownRef.current && !chainDropdownRef.current.contains(e.target as Node)) {
        setIsChainDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsTokenDropdownOpen(false);
        setIsChainDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Currently active token definition
  const activeTokenObj = useMemo(() => {
    if (!selectedToken) return null;
    return tokens.find((t) => t.symbol.toUpperCase() === selectedToken.toUpperCase()) || null;
  }, [tokens, selectedToken]);

  // Available chains for the active token
  const availableChains = useMemo(() => {
    if (!activeTokenObj) return [];
    const list = activeTokenObj.chains
      .map((c) => CHAIN_DEFINITIONS[c] || { id: c, name: c.toUpperCase(), icon: '⬡', badge: 'Route', time: '~15s' })
      .filter(Boolean);
    return list;
  }, [activeTokenObj]);

  // Active chain definition
  const activeChainDef = useMemo(() => {
    if (!selectedChain) return null;
    return (
      availableChains.find((c) => c.id === selectedChain) ||
      CHAIN_DEFINITIONS[selectedChain] ||
      null
    );
  }, [availableChains, selectedChain]);

  // When token is picked from dropdown
  const handleSelectToken = (tokenSym: string) => {
    setSelectedToken(tokenSym);
    setIsTokenDropdownOpen(false);
    setTokenSearch('');

    const tokenObj = tokens.find((t) => t.symbol.toUpperCase() === tokenSym.toUpperCase());
    // If selectedChain is not valid for this new token, clear it so user picks
    if (tokenObj && selectedChain && !tokenObj.chains.includes(selectedChain)) {
      setSelectedChain('');
    }
    setCurrentAddress(null);
    setDepositStatus(null);
    setSettledSuccess(false);
  };

  // When chain is picked from dropdown
  const handleSelectChain = (chainId: string) => {
    setSelectedChain(chainId);
    setIsChainDropdownOpen(false);
    setChainSearch('');
    setDepositStatus(null);
    setSettledSuccess(false);
  };

  // Derive deposit address from backend ONLY when both token and chain are selected
  const loadAddress = useCallback(
    async (refresh = false) => {
      if (!hasIntentAccount || !selectedToken || !selectedChain) return;
      setIsDeriving(true);
      try {
        const addr = await fetchDepositAddress(selectedChain, refresh, selectedToken);
        setCurrentAddress(addr);
        setDepositStatus(null);
        setSettledSuccess(false);
      } catch (err) {
        console.error('[ReceivePage] Failed to fetch deposit address:', err);
      } finally {
        setIsDeriving(false);
      }
    },
    [hasIntentAccount, selectedChain, selectedToken]
  );

  // Trigger address derivation ONLY when both token and chain are explicitly selected
  useEffect(() => {
    if (selectedToken && selectedChain) {
      loadAddress(false);
    } else {
      setCurrentAddress(null);
      setDepositStatus(null);
      setSettledSuccess(false);
    }
  }, [selectedToken, selectedChain, loadAddress]);

  // Real-time Polling for Deposit Status (every 2.5s)
  useEffect(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (!currentAddress?.address || settledSuccess) {
      return;
    }

    const checkStatus = async () => {
      try {
        const status = await fetchDepositStatus(currentAddress.address);
        setDepositStatus(status);

        const depAmt = parseFloat(status.depositedAmountFormatted || '0');
        if (status.status === 'SUCCESS' || depAmt > 0) {
          // Trigger balance and history updates in the app immediately
          refreshBalances();
          refreshHistory();

          if (status.status === 'SUCCESS' || status.isSettled) {
            setSettledSuccess(true);
          }
        }
      } catch (err) {
        // Silent poll error
      }
    };

    // Initial check immediately, then poll every 2.5 seconds
    checkStatus();
    pollIntervalRef.current = setInterval(checkStatus, 2500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [currentAddress?.address, settledSuccess, refreshBalances, refreshHistory]);

  const handleCopy = () => {
    if (!currentAddress?.address) return;
    navigator.clipboard.writeText(currentAddress.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateFresh = () => {
    loadAddress(true);
  };

  const depositAddressValue = currentAddress?.address || '';
  const minAmountDisplay =
    currentAddress?.minAmountFormatted ||
    (selectedToken === 'USDC' ? '0.10 USDC' : selectedToken === 'NEAR' ? '0.01 NEAR' : `0.10 ${selectedToken}`);
  const minUsdDisplay = currentAddress?.minAmountUsd || '$0.10';

  // Filtered lists for dropdown search
  const filteredTokens = useMemo(() => {
    if (!tokenSearch.trim()) return tokens;
    const q = tokenSearch.toLowerCase().trim();
    return tokens.filter(
      (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.badge.toLowerCase().includes(q)
    );
  }, [tokens, tokenSearch]);

  const filteredChains = useMemo(() => {
    if (!chainSearch.trim()) return availableChains;
    const q = chainSearch.toLowerCase().trim();
    return availableChains.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.badge.toLowerCase().includes(q)
    );
  }, [availableChains, chainSearch]);

  return (
    <div className="w-full space-y-6 max-w-2xl mx-auto">
      {/* Back Link */}
      <Link
        to="/app"
        className="inline-flex items-center space-x-1.5 text-xs font-mono text-stone-500 hover:text-black transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Dashboard</span>
      </Link>

      {/* Header — "Confidential Cross-Chain Ingress" removed as requested */}
      <div className="text-center space-y-2 mb-6">
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight">
          Receive to Private Vault
        </h1>
        <p className="text-sm text-stone-600 max-w-md mx-auto">
          Pick your token and source chain. A single-use confidential address is derived that automatically shields funds into your passkey vault upon receipt.
        </p>
      </div>

      {/* Main Container */}
      <div className="rounded-3xl p-6 sm:p-8 bg-white border border-stone-200 shadow-sm space-y-6 relative">

        {/* ── STEP 1: ASSET DROPDOWN ── */}
        <div className="space-y-2" ref={tokenDropdownRef}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">1</span>
              <span>Select Asset to Receive</span>
            </label>
            <span className="text-[11px] font-mono text-stone-400">
              {tokens.length} intent assets supported
            </span>
          </div>

          <div className="relative">
            {/* Trigger Button */}
            <button
              type="button"
              onClick={() => {
                setIsTokenDropdownOpen(!isTokenDropdownOpen);
                setIsChainDropdownOpen(false);
              }}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-stone-50 hover:bg-stone-100/80 border border-stone-200 transition-all text-left cursor-pointer focus:outline-none focus:border-black"
            >
              {activeTokenObj ? (
                <div className="flex items-center space-x-3">
                  <TokenIcon symbol={activeTokenObj.symbol} size="lg" />
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-sm font-extrabold text-stone-950">
                        {activeTokenObj.symbol}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-200/80 text-stone-800 font-mono font-bold">
                        {activeTokenObj.badge}
                      </span>
                    </div>
                    <div className="text-xs text-stone-500 font-sans">
                      {activeTokenObj.name} · {availableChains.length} networks
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center space-x-3 text-stone-400">
                  <div className="w-9 h-9 rounded-xl border border-dashed border-stone-300 flex items-center justify-center text-stone-400 font-mono text-base font-bold bg-white">
                    +
                  </div>
                  <div>
                    <span className="font-mono text-sm font-bold text-stone-900 block">
                      Select an Asset to Receive...
                    </span>
                    <span className="text-xs text-stone-400 font-sans">
                      {tokens.length} cross-chain intent assets supported
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-3 text-right">
                {activeTokenObj && (
                  <span className="font-mono text-xs font-bold text-stone-900">
                    ${activeTokenObj.priceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
                <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${isTokenDropdownOpen ? 'rotate-180 text-stone-900' : ''}`} />
              </div>
            </button>

            {/* Dropdown Popover */}
            {isTokenDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl border border-stone-200 shadow-xl z-50 p-2 space-y-2 animate-fade-in font-sans">
                {/* Search Bar */}
                <div className="relative px-1 pt-1">
                  <Search className="w-3.5 h-3.5 absolute left-3.5 top-3.5 text-stone-400" />
                  <input
                    type="text"
                    value={tokenSearch}
                    onChange={(e) => setTokenSearch(e.target.value)}
                    placeholder="Search asset symbol or name..."
                    autoFocus
                    className="w-full bg-stone-50 rounded-xl pl-9 pr-3 py-2 text-xs text-stone-900 placeholder-stone-400 border border-stone-200 focus:outline-none focus:border-black font-mono transition-colors"
                  />
                </div>

                {/* Tokens List */}
                <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                  {filteredTokens.length === 0 ? (
                    <p className="text-xs text-stone-400 text-center py-6 font-mono">
                      No assets match "{tokenSearch}"
                    </p>
                  ) : (
                    filteredTokens.map((token) => {
                      const isSelected = selectedToken.toUpperCase() === token.symbol.toUpperCase();
                      return (
                        <button
                          key={token.symbol}
                          type="button"
                          onClick={() => handleSelectToken(token.symbol)}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-colors text-left cursor-pointer ${
                            isSelected
                              ? 'bg-black text-white font-bold'
                              : 'hover:bg-stone-50 text-stone-800'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5">
                            <TokenIcon symbol={token.symbol} size="md" />
                            <div>
                              <div className="flex items-center space-x-1.5 font-mono text-xs">
                                <span className={isSelected ? 'text-white font-bold' : 'text-stone-950 font-bold'}>
                                  {token.symbol}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.2 rounded ${isSelected ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'}`}>
                                  {token.badge}
                                </span>
                              </div>
                              <div className={`text-[10px] ${isSelected ? 'text-stone-300' : 'text-stone-400'}`}>
                                {token.name} · {token.chains.length} routes
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 text-right font-mono">
                            <span className={`text-xs ${isSelected ? 'text-white' : 'text-stone-900'}`}>
                              ${token.priceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-white flex-shrink-0" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── STEP 2: BLOCKCHAIN DROPDOWN ── */}
        <div className="space-y-2 pt-2 border-t border-stone-100" ref={chainDropdownRef}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">2</span>
              <span>Select Source Blockchain</span>
            </label>
            <span className="text-[11px] font-mono text-stone-400">
              {activeTokenObj ? `${availableChains.length} route${availableChains.length > 1 ? 's' : ''} for ${activeTokenObj.symbol}` : 'Pick an asset first'}
            </span>
          </div>

          <div className="relative">
            {/* Trigger Button */}
            <button
              type="button"
              disabled={!selectedToken}
              onClick={() => {
                if (!selectedToken) {
                  setIsTokenDropdownOpen(true);
                  return;
                }
                setIsChainDropdownOpen(!isChainDropdownOpen);
                setIsTokenDropdownOpen(false);
              }}
              className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all text-left focus:outline-none focus:border-black ${
                !selectedToken
                  ? 'bg-stone-50/50 border-stone-200/70 text-stone-400 cursor-not-allowed opacity-75'
                  : 'bg-stone-50 hover:bg-stone-100/80 border-stone-200 cursor-pointer'
              }`}
            >
              {activeChainDef ? (
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{activeChainDef.icon}</span>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-sm font-extrabold text-stone-950">
                        {activeChainDef.name}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-200/80 text-stone-800 font-mono font-bold">
                        {activeChainDef.badge}
                      </span>
                    </div>
                    <div className="text-xs text-stone-500 font-sans">
                      Finality: <strong className="font-mono text-stone-700">{activeChainDef.time}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center space-x-3 text-stone-400">
                  <div className="w-9 h-9 rounded-xl border border-dashed border-stone-300 flex items-center justify-center text-stone-400 font-mono text-base font-bold bg-white">
                    ⬡
                  </div>
                  <div>
                    <span className="font-mono text-sm font-bold text-stone-800 block">
                      {selectedToken ? `Select source network for ${selectedToken}...` : 'Select an asset first in Step 1'}
                    </span>
                    <span className="text-xs text-stone-400 font-sans">
                      {selectedToken ? `${availableChains.length} supported networks` : 'Networks unlock once asset is selected'}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-3 text-right">
                {activeChainDef && (
                  <span className="font-mono text-xs font-bold text-stone-500">
                    {activeChainDef.time}
                  </span>
                )}
                <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${isChainDropdownOpen ? 'rotate-180 text-stone-900' : ''}`} />
              </div>
            </button>

            {/* Dropdown Popover */}
            {isChainDropdownOpen && selectedToken && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl border border-stone-200 shadow-xl z-50 p-2 space-y-2 animate-fade-in font-sans">
                {/* Search Bar */}
                <div className="relative px-1 pt-1">
                  <Search className="w-3.5 h-3.5 absolute left-3.5 top-3.5 text-stone-400" />
                  <input
                    type="text"
                    value={chainSearch}
                    onChange={(e) => setChainSearch(e.target.value)}
                    placeholder="Search blockchain network..."
                    autoFocus
                    className="w-full bg-stone-50 rounded-xl pl-9 pr-3 py-2 text-xs text-stone-900 placeholder-stone-400 border border-stone-200 focus:outline-none focus:border-black font-mono transition-colors"
                  />
                </div>

                {/* Chains List */}
                <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                  {filteredChains.length === 0 ? (
                    <p className="text-xs text-stone-400 text-center py-6 font-mono">
                      No chains match "{chainSearch}"
                    </p>
                  ) : (
                    filteredChains.map((chain) => {
                      const isSelected = selectedChain === chain.id;
                      return (
                        <button
                          key={chain.id}
                          type="button"
                          onClick={() => handleSelectChain(chain.id)}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-colors text-left cursor-pointer ${
                            isSelected
                              ? 'bg-black text-white font-bold'
                              : 'hover:bg-stone-50 text-stone-800'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5">
                            <span className="text-lg">{chain.icon}</span>
                            <div>
                              <div className="flex items-center space-x-1.5 font-mono text-xs">
                                <span className={isSelected ? 'text-white font-bold' : 'text-stone-950 font-bold'}>
                                  {chain.name}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.2 rounded ${isSelected ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'}`}>
                                  {chain.badge}
                                </span>
                              </div>
                              <div className={`text-[10px] ${isSelected ? 'text-stone-300' : 'text-stone-400'}`}>
                                Arrival: {chain.time}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 text-right font-mono">
                            <span className={`text-xs ${isSelected ? 'text-stone-300' : 'text-stone-500'}`}>
                              {chain.time}
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-white flex-shrink-0" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── STEP 3: CONFIDENTIAL 1-TIME ADDRESS CARD ── */}
        <div className="pt-2 border-t border-stone-100 space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">3</span>
              <span>Confidential Receive Gateway</span>
            </label>
            {selectedToken && selectedChain && (
              <button
                type="button"
                onClick={handleGenerateFresh}
                disabled={isDeriving}
                className="text-[11px] font-mono text-stone-600 hover:text-black flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                title="Derive a fresh 1-time address"
              >
                <RefreshCw className={`w-3 h-3 ${isDeriving ? 'animate-spin' : ''}`} />
                <span>Derive New Address</span>
              </button>
            )}
          </div>

          {!selectedToken || !selectedChain ? (
            /* Blank state awaiting user selection */
            <div className="p-8 sm:p-10 rounded-2xl bg-stone-50 border border-dashed border-stone-300 text-center space-y-3 animate-fade-in">
              <div className="w-12 h-12 rounded-2xl bg-white border border-stone-200 text-stone-700 flex items-center justify-center mx-auto shadow-2xs">
                <Radio className="w-6 h-6 text-stone-400" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-mono font-bold text-stone-900 uppercase tracking-wider">
                  Awaiting Selection
                </h4>
                <p className="text-xs text-stone-500 max-w-sm mx-auto font-sans leading-relaxed">
                  Choose your asset in <strong className="text-stone-800 font-semibold">Step 1</strong> and destination network in <strong className="text-stone-800 font-semibold">Step 2</strong> above to derive your single-use confidential receive address.
                </p>
              </div>
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-stone-100 text-[11px] font-mono text-stone-500">
                <Zap className="w-3.5 h-3.5 text-stone-600" />
                <span>Minimum deposit $0.10 · Single-use ephemeral gateway</span>
              </div>
            </div>
          ) : (
            /* Derived Address Content */
            <>
              {/* 1-Time Notice Banner */}
              <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-2xl flex items-start space-x-2.5 text-xs text-amber-950 animate-fade-in">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5 font-sans leading-relaxed">
                  <div className="font-bold flex items-center space-x-1.5">
                    <span>Single-Use Confidential Address</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-200 text-amber-900 font-mono uppercase">
                      1-Time Ingress
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-900">
                    This address is ephemeral and generated exclusively for receiving <strong className="font-semibold">{selectedToken}</strong> on <strong className="font-semibold">{activeChainDef?.name || selectedChain}</strong>. Funds are automatically bridged and shielded into your confidential passkey vault upon receipt. Please do not send to this address more than once.
                  </p>
                </div>
              </div>

              {/* Minimum Deposit Notice */}
              <div className="px-4 py-2.5 bg-stone-100/80 border border-stone-200 rounded-xl flex items-center justify-between text-xs font-mono">
                <span className="text-stone-500">Minimum Deposit:</span>
                <span className="font-bold text-stone-950 flex items-center space-x-1">
                  <span>{minAmountDisplay}</span>
                  <span className="text-stone-500 font-normal">({minUsdDisplay})</span>
                </span>
              </div>

              {/* Address Display Box */}
              <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200 space-y-4">
                {!hasIntentAccount ? (
                  <div className="p-4 bg-white rounded-xl border border-stone-200 text-center space-y-2">
                    <p className="text-xs font-mono text-stone-600">
                      You need an onchain intent account before generating deposit addresses.
                    </p>
                    <Link
                      to="/app/claim"
                      className="inline-block px-4 py-2 rounded-xl bg-black text-white text-xs font-bold font-mono"
                    >
                      Register Passkey Vault
                    </Link>
                  </div>
                ) : isDeriving && !depositAddressValue ? (
                  <div className="py-12 flex flex-col items-center justify-center space-y-2.5 text-stone-500 font-mono text-xs">
                    <Loader2 className="w-6 h-6 animate-spin text-stone-900" />
                    <span>Deriving live confidential address from solvers...</span>
                  </div>
                ) : (
                  <>
                    {/* Address Row */}
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          readOnly
                          value={depositAddressValue || 'Deriving address...'}
                          className="flex-1 bg-white rounded-xl px-3.5 py-3 text-xs sm:text-sm text-stone-900 font-mono border border-stone-200 focus:outline-none select-all shadow-2xs"
                        />
                        <button
                          type="button"
                          onClick={handleCopy}
                          disabled={!depositAddressValue}
                          className="px-4 py-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1.5 disabled:opacity-40"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono text-stone-400 pt-1">
                        <span>Network: {activeChainDef?.name || selectedChain}</span>
                        <span>Expected finality: {activeChainDef?.time || '~15s'}</span>
                      </div>
                    </div>

                    {/* Memo Notice if required */}
                    {currentAddress?.memo && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-mono text-amber-900 flex items-start space-x-2">
                        <Info className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Required Memo:</span>{' '}
                          <span className="font-bold underline">{currentAddress.memo}</span>
                          <p className="text-[11px] text-amber-800 mt-0.5">
                            You must include this memo with your transaction.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Deposit address card — rendered fully client-side. No
                        third-party QR service is used: those services receive
                        the value being encoded, which would leak the deposit
                        address. */}
                    {showQr && depositAddressValue && (
                      <div className="p-4 bg-white rounded-2xl border border-stone-200 flex flex-col animate-fade-in shadow-2xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">
                          Deposit Address
                        </span>
                        <p className="text-[11px] font-mono text-stone-700 break-all bg-stone-50 border border-stone-200 rounded-lg p-2 select-all">
                          {depositAddressValue}
                        </p>
                        <span className="text-[11px] text-stone-500 font-mono mt-2.5">
                          Deposit {selectedToken} on {activeChainDef?.name || selectedChain}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-stone-500 pt-1 border-t border-stone-200/60 font-mono">
                      <button
                        type="button"
                        onClick={() => setShowQr(!showQr)}
                        className="text-stone-900 hover:underline font-bold flex items-center space-x-1 cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>{showQr ? 'Hide Address' : 'Show Address'}</span>
                      </button>
                      <span className="text-[11px] text-stone-400">
                        Expires in ~3 days
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* ── STEP 4: REAL-TIME LIVE DEPOSIT TRACKER ── */}
              {depositAddressValue && (
                <div className="pt-2 border-t border-stone-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-1.5">
                      <Radio className="w-3.5 h-3.5 text-stone-900 animate-pulse" />
                      <span>Live Deposit Tracker</span>
                    </label>
                    <span className="text-[11px] font-mono text-stone-400 flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                      <span>Monitoring {activeChainDef?.name || selectedChain}</span>
                    </span>
                  </div>

                  {/* Status State Cards */}
                  {settledSuccess ? (
                    /* Success Card */
                    <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-3 animate-fade-in shadow-xs">
                      <div className="flex items-center space-x-2.5 font-bold text-emerald-900 text-sm">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                        <span>Deposit Received & Shielded!</span>
                      </div>
                      <p className="text-xs text-emerald-800 leading-relaxed font-sans">
                        Your funds have been swept by solvers and credited to your confidential passkey vault. Your updated balance is now available for private transfers.
                      </p>
                      {depositStatus?.depositedAmountFormatted && (
                        <div className="p-3 bg-white/80 rounded-xl border border-emerald-200 flex items-center justify-between font-mono text-xs">
                          <span className="text-stone-500">Credited Amount:</span>
                          <span className="font-bold text-emerald-900">
                            {depositStatus.depositedAmountFormatted} {selectedToken}
                            {depositStatus.depositedAmountUsd ? ` (~$${depositStatus.depositedAmountUsd})` : ''}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center space-x-3 pt-1">
                        <Link
                          to="/app"
                          className="px-4 py-2 rounded-xl bg-black text-white text-xs font-bold font-mono hover:bg-stone-800 transition-colors"
                        >
                          View in Dashboard
                        </Link>
                        <button
                          type="button"
                          onClick={handleGenerateFresh}
                          className="px-4 py-2 rounded-xl bg-white border border-stone-200 text-stone-900 text-xs font-bold font-mono hover:bg-stone-50 transition-colors cursor-pointer"
                        >
                          Receive Another
                        </button>
                      </div>
                    </div>
                  ) : depositStatus?.status === 'PROCESSING' || parseFloat(depositStatus?.depositedAmountFormatted || '0') > 0 ? (
                    /* Detected onchain / Routing */
                    <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-blue-950 space-y-2.5 animate-fade-in">
                      <div className="flex items-center space-x-2 text-xs font-bold text-blue-900">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span>Deposit Detected Onchain! Routing via Intents...</span>
                      </div>
                      <p className="text-[11px] text-blue-800 leading-relaxed font-sans">
                        Received <strong className="font-bold">{depositStatus?.depositedAmountFormatted} {selectedToken}</strong> on {activeChainDef?.name || selectedChain}. Solver network is executing settlement into your vault.
                      </p>
                      {depositStatus?.txHashes && depositStatus.txHashes.length > 0 && (
                        <div className="text-[11px] font-mono text-blue-700 truncate flex items-center space-x-1">
                          <span>Tx Hash:</span>
                          <span className="underline font-bold">{depositStatus.txHashes[0].slice(0, 16)}...</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Waiting state */
                    <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 flex items-center space-x-3 text-xs text-stone-600">
                      <div className="w-3 h-3 rounded-full bg-stone-400 animate-ping flex-shrink-0" />
                      <div className="font-sans">
                        <span>Waiting for incoming transaction on </span>
                        <strong className="text-stone-900 font-semibold">{activeChainDef?.name || selectedChain}</strong>.
                        <span className="text-stone-400 block text-[11px] font-mono mt-0.5">
                          Send at least {minAmountDisplay} to the address above.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Explainer */}
        <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-700 space-y-1.5 leading-relaxed">
          <div className="flex items-center space-x-1.5 font-bold text-stone-900">
            <Info className="w-3.5 h-3.5 text-stone-900" />
            <span>How Confidential Intents Custody Works</span>
          </div>
          <p>
            When you transfer to the ephemeral gateway, the NEAR Intents solver network detects the transaction on your selected chain, confirms economic finality, and credits the balance to your hardware passkey vault (<span className="font-mono text-stone-900 font-semibold">{nearAccount || 'u_...uprail.near'}</span>). Zero seed phrases, non-custodial, and 100% private.
          </p>
        </div>
      </div>
    </div>
  );
};
