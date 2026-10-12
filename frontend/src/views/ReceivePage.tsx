'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from '../lib/router';
import {
  Copy,
  Check,
  QrCode,
  Shield,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Zap,
  CheckCircle2,
  ChevronDown,
  Search,
  ArrowRight,
} from 'lucide-react';
import { useOnchainData } from '../hooks/useOnchainData';
import { fetchDepositAddress, fetchDepositStatus, DepositAddress, DepositStatusResponse } from '../lib/onchainApi';
import { api, formatUsd } from '../lib/api';
import { TokenIcon } from '../components/TokenIcon';
import { ChainLogo } from '../components/ChainLogo';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { BackBar } from '../components/BackBar';

export interface TokenOption {
  symbol: string;
  name: string;
  badge: string;
  /** Live registry price; absent means unknown (rendered as —). */
  priceUsd?: number;
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
  { symbol: 'USDC', name: 'USD Coin', badge: 'Most Popular', chains: ['base', 'arbitrum', 'sol', 'near', 'pol', 'bsc', 'op', 'avax', 'eth'] },
  { symbol: 'USDT', name: 'Tether USD', badge: 'Stablecoin', chains: ['arbitrum', 'sol', 'near', 'pol', 'bsc', 'op', 'avax', 'eth', 'tron'] },
  { symbol: 'NEAR', name: 'NEAR Protocol', badge: 'Native Shield', chains: ['near', 'bsc', 'sol', 'arbitrum'] },
  { symbol: 'ETH', name: 'Ethereum', badge: 'Cross-chain', chains: ['base', 'arbitrum', 'eth', 'op', 'scroll'] },
  { symbol: 'SOL', name: 'Solana', badge: 'Ultra-Fast', chains: ['sol', 'near'] },
  { symbol: 'BTC', name: 'Bitcoin', badge: 'Native SegWit', chains: ['btc', 'near'] },
  { symbol: 'DOGE', name: 'Dogecoin', badge: 'Meme L1', chains: ['doge', 'near'] },
  { symbol: 'DAI', name: 'Dai Stablecoin', badge: 'Decentralized', chains: ['arbitrum', 'eth', 'near'] },
  { symbol: 'FRAX', name: 'Frax Stablecoin', badge: 'Stablecoin', chains: ['near', 'eth'] },
  { symbol: 'AVAX', name: 'Avalanche', badge: 'EVM L1', chains: ['avax', 'near'] },
  { symbol: 'BNB', name: 'BNB Chain', badge: 'EVM L1', chains: ['bsc', 'near'] },
  { symbol: 'POL', name: 'Polygon', badge: 'PoS L2', chains: ['pol', 'near'] },
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

export interface NearNativeTokenOption {
  symbol: string;
  name: string;
  badge: string;
  isNative?: boolean;
}

const NEAR_NATIVE_TOKENS: NearNativeTokenOption[] = [
  { symbol: 'NEAR', name: 'NEAR Protocol', badge: 'Native Coin', isNative: true },
  { symbol: 'USDC', name: 'USD Coin', badge: 'Bridged NEP-141' },
  { symbol: 'USDT', name: 'Tether USD', badge: 'Bridged NEP-141' },
  { symbol: 'SHITZU', name: 'Shitzu', badge: 'Meme' },
  { symbol: 'BLACKDRAGON', name: 'Black Dragon', badge: 'Meme' },
];
// LONK/NEKO are intentionally absent: they are not in the intents registry and
// the backend now fails closed on unresolvable tokens instead of silently
// quoting a different asset. Long-tail coverage comes from the search picker.

/**
 * Shared deposit-status poller for the Receive tabs. Runs an immediate check,
 * then polls /api/onchain/deposit-status every 2.5s while an address is set and
 * not yet settled. Handlers are held in a ref so re-renders never restart the
 * interval.
 */
function useDepositPoll(opts: {
  address: string | undefined;
  settled: boolean;
  onStatus: (status: DepositStatusResponse) => void;
  onSettled: () => void;
  refreshBalances: () => void;
  refreshHistory: () => void;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { address, settled } = opts;

  useEffect(() => {
    if (!address || settled) return;

    const checkStatus = async () => {
      try {
        const status = await fetchDepositStatus(address);
        const o = optsRef.current;
        o.onStatus(status);

        const depAmt = parseFloat(status.depositedAmountFormatted || '0');
        if (status.status === 'SUCCESS' || depAmt > 0) {
          // Trigger balance and history updates in the app immediately
          o.refreshBalances();
          o.refreshHistory();

          if (status.status === 'SUCCESS' || status.isSettled) {
            o.onSettled();
          }
        }
      } catch (err) {
        // Silent poll error
      }
    };

    // Initial check immediately, then poll every 2.5 seconds
    checkStatus();
    const id = setInterval(checkStatus, 2500);
    return () => clearInterval(id);
  }, [address, settled]);
}

export const ReceivePage: React.FC = () => {
  const { hasIntentAccount, nearAccount, refreshBalances, refreshHistory } = useOnchainData();

  const [tokens, setTokens] = useState<TokenOption[]>(TOKEN_OPTIONS);
  // Start BLANK — do not derive until token, chain, AND exact amount are selected
  const [selectedToken, setSelectedToken] = useState<string>('');
  const [selectedChain, setSelectedChain] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [currentAddress, setCurrentAddress] = useState<DepositAddress | null>(null);
  const [isDeriving, setIsDeriving] = useState<boolean>(false);
  const [copiedAddress, setCopiedAddress] = useState<boolean>(false);
  const [copiedAmount, setCopiedAmount] = useState<boolean>(false);
  const [showQr, setShowQr] = useState<boolean>(true);
  const [depositStatus, setDepositStatus] = useState<DepositStatusResponse | null>(null);
  const [settledSuccess, setSettledSuccess] = useState<boolean>(false);

  // Tab state: cross-chain bridge vs direct NEAR native & memes
  const [activeTab, setActiveTab] = useState<'crosschain' | 'defuse'>('crosschain');
  // Tab 2 — NEAR-native deposits ride the same 1Click derive/QR/status
  // pipeline as the cross-chain tab, pinned to chain="near".
  const [nearSelectedToken, setNearSelectedToken] = useState<string>('NEAR');
  const [nearAmount, setNearAmount] = useState<string>('');
  const [nearAddress, setNearAddress] = useState<DepositAddress | null>(null);
  const [nearDeriving, setNearDeriving] = useState<boolean>(false);
  const [nearStatus, setNearStatus] = useState<DepositStatusResponse | null>(null);
  const [nearSettled, setNearSettled] = useState<boolean>(false);
  const [nearError, setNearError] = useState<string | null>(null);
  const [nearCopiedAddress, setNearCopiedAddress] = useState<boolean>(false);
  const [nearCopiedAmount, setNearCopiedAmount] = useState<boolean>(false);
  const [isNearSearchOpen, setIsNearSearchOpen] = useState(false);
  const [nearSearch, setNearSearch] = useState('');

  // Dropdown states
  const [isTokenDropdownOpen, setIsTokenDropdownOpen] = useState(false);
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [chainSearch, setChainSearch] = useState('');

  const tokenDropdownRef = useRef<HTMLDivElement>(null);
  const chainDropdownRef = useRef<HTMLDivElement>(null);
  const nearSearchRef = useRef<HTMLDivElement>(null);

  // Preset quick-select amounts based on active token
  const presetAmounts = useMemo(() => {
    const sym = (selectedToken || '').toUpperCase();
    if (['USDC', 'USDT', 'DAI', 'FRAX'].includes(sym)) {
      return ['5', '10', '25', '50', '100'];
    }
    if (sym === 'NEAR') {
      return ['1', '5', '10', '25', '50'];
    }
    if (sym === 'SOL') {
      return ['0.1', '0.25', '0.5', '1', '2'];
    }
    if (sym === 'ETH') {
      return ['0.01', '0.02', '0.05', '0.1'];
    }
    if (sym === 'BTC') {
      return ['0.001', '0.002', '0.005', '0.01'];
    }
    if (sym === 'DOGE') {
      return ['25', '50', '100', '250'];
    }
    return ['5', '10', '25', '50', '100'];
  }, [selectedToken]);

  // Load any additional live tokens supported by NEAR Intents from backend.
  // Repolled while visible so the prices next to each asset stay live.
  useEffect(() => {
    let mounted = true;
    const load = () => api.getTokens().then((toks) => {
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
          if (typeof t.priceUsd === 'number') existing.priceUsd = t.priceUsd;
        } else {
          map.set(sym, {
            symbol: sym,
            name: t.name || sym,
            badge: t.badge || 'Cross-chain',
            priceUsd: t.priceUsd,
            chains: [chain],
          });
        }
      }
      setTokens(Array.from(map.values()));
    });
    load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    return () => {
      mounted = false;
      window.clearInterval(id);
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
      if (nearSearchRef.current && !nearSearchRef.current.contains(e.target as Node)) {
        setIsNearSearchOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsTokenDropdownOpen(false);
        setIsChainDropdownOpen(false);
        setIsNearSearchOpen(false);
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
    setCurrentAddress(null);
    setDepositStatus(null);
    setSettledSuccess(false);
  };

  // Derive deposit address from backend ONLY when token, chain, and exact amount are selected
  const loadAddress = useCallback(
    async (refresh = false, overrideAmount?: string) => {
      const amt = (overrideAmount !== undefined ? overrideAmount : depositAmount).trim();
      const numAmt = parseFloat(amt);
      if (!hasIntentAccount || !selectedToken || !selectedChain || !amt || isNaN(numAmt) || numAmt <= 0) {
        return;
      }
      setIsDeriving(true);
      try {
        const addr = await fetchDepositAddress(selectedChain, refresh, selectedToken, amt);
        setCurrentAddress(addr);
        setDepositStatus(null);
        setSettledSuccess(false);
      } catch (err) {
        console.error('[ReceivePage] Failed to fetch deposit address:', err);
      } finally {
        setIsDeriving(false);
      }
    },
    [hasIntentAccount, selectedChain, selectedToken, depositAmount]
  );

  const handleSelectPreset = (presetVal: string) => {
    setDepositAmount(presetVal);
    if (selectedToken && selectedChain) {
      loadAddress(true, presetVal);
    }
  };

  // Debounced address derivation when user changes amount
  useEffect(() => {
    const amt = depositAmount.trim();
    const numAmt = parseFloat(amt);
    if (!selectedToken || !selectedChain || !amt || isNaN(numAmt) || numAmt <= 0) {
      setCurrentAddress(null);
      setDepositStatus(null);
      setSettledSuccess(false);
      return;
    }

    const timer = setTimeout(() => {
      loadAddress(false, amt);
    }, 600);

    return () => clearTimeout(timer);
  }, [selectedToken, selectedChain, depositAmount, loadAddress]);

  // Real-time deposit polling (every 2.5s) — one instance per tab, active tab
  // only. Both tabs share the same /api/onchain/deposit-status pipeline.
  useDepositPoll({
    address: activeTab === 'crosschain' ? currentAddress?.address : undefined,
    settled: settledSuccess,
    onStatus: setDepositStatus,
    onSettled: () => setSettledSuccess(true),
    refreshBalances,
    refreshHistory,
  });
  useDepositPoll({
    address: activeTab === 'defuse' ? nearAddress?.address : undefined,
    settled: nearSettled,
    onStatus: setNearStatus,
    onSettled: () => setNearSettled(true),
    refreshBalances,
    refreshHistory,
  });

  const handleCopyAddress = () => {
    if (!currentAddress?.address) return;
    navigator.clipboard.writeText(currentAddress.address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleCopyAmount = () => {
    const amtToCopy = currentAddress?.minAmountFormatted
      ? currentAddress.minAmountFormatted.split(' ')[0]
      : depositAmount.trim();
    if (!amtToCopy) return;
    navigator.clipboard.writeText(amtToCopy);
    setCopiedAmount(true);
    setTimeout(() => setCopiedAmount(false), 2000);
  };

  const handleGenerateFresh = () => {
    loadAddress(true);
  };

  // ── Tab 2: NEAR-native deposits — derive/QR/status like cross-chain ─────────
  const loadNearAddress = useCallback(
    async (refresh = false, overrideAmount?: string) => {
      if (!hasIntentAccount || !nearSelectedToken) return;
      const amt = (overrideAmount !== undefined ? overrideAmount : nearAmount).trim();
      if (amt && (isNaN(parseFloat(amt)) || parseFloat(amt) <= 0)) return;
      setNearDeriving(true);
      setNearError(null);
      try {
        // No amount → the backend quotes its default minimum; a typed amount
        // requests an exact-amount quote (which always bypasses the D1 cache).
        const addr = await fetchDepositAddress('near', refresh, nearSelectedToken, amt || undefined);
        if (addr) {
          setNearAddress(addr);
          setNearStatus(null);
          setNearSettled(false);
        } else {
          setNearAddress(null);
          setNearError(`${nearSelectedToken} deposits on NEAR aren't supported yet.`);
        }
      } catch (err) {
        console.error('[ReceivePage] Failed to fetch NEAR deposit address:', err);
        setNearAddress(null);
        setNearError('Could not derive a deposit address. Please try again.');
      } finally {
        setNearDeriving(false);
      }
    },
    [hasIntentAccount, nearSelectedToken, nearAmount]
  );

  const handleSelectNearToken = (tokenSym: string) => {
    setNearSelectedToken(tokenSym);
    setIsNearSearchOpen(false);
    setNearSearch('');
    setNearAddress(null);
    setNearStatus(null);
    setNearSettled(false);
    setNearError(null);
  };

  const handleNearSelectPreset = (presetVal: string) => {
    setNearAmount(presetVal);
    loadNearAddress(true, presetVal);
  };

  // Debounced derivation while typing an amount; opening the tab or picking a
  // token derives the default quote.
  useEffect(() => {
    if (activeTab !== 'defuse' || !nearSelectedToken) return;
    const amt = nearAmount.trim();
    if (amt && (isNaN(parseFloat(amt)) || parseFloat(amt) <= 0)) {
      setNearAddress(null);
      setNearStatus(null);
      setNearSettled(false);
      return;
    }
    const timer = setTimeout(() => {
      loadNearAddress(false, amt);
    }, 600);
    return () => clearTimeout(timer);
  }, [activeTab, nearSelectedToken, nearAmount, loadNearAddress]);

  const handleNearCopyAddress = () => {
    if (!nearAddress?.address) return;
    navigator.clipboard.writeText(nearAddress.address);
    setNearCopiedAddress(true);
    setTimeout(() => setNearCopiedAddress(false), 2000);
  };

  const handleNearCopyAmount = () => {
    const amtToCopy = nearAddress?.minAmountFormatted
      ? nearAddress.minAmountFormatted.split(' ')[0]
      : nearAmount.trim();
    if (!amtToCopy) return;
    navigator.clipboard.writeText(amtToCopy);
    setNearCopiedAmount(true);
    setTimeout(() => setNearCopiedAmount(false), 2000);
  };

  const depositAddressValue = currentAddress?.address || '';
  const minAmountDisplay =
    currentAddress?.minAmountFormatted ||
    (depositAmount && selectedToken ? `${depositAmount} ${selectedToken}` : selectedToken === 'USDC' ? '0.10 USDC' : selectedToken === 'NEAR' ? '0.01 NEAR' : `0.10 ${selectedToken}`);
  const minUsdDisplay = currentAddress?.minAmountUsd || (depositAmount ? `$${parseFloat(depositAmount || '0').toFixed(2)}` : '$0.10');
  const nearSendDisplay =
    nearAddress?.minAmountFormatted ||
    (nearAmount.trim() && nearSelectedToken ? `${nearAmount.trim()} ${nearSelectedToken}` : '');

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

  // Tab 2 quick-amount presets: stables in whole units, everything else small.
  const nearPresetAmounts = useMemo(() => {
    const sym = (nearSelectedToken || '').toUpperCase();
    if (['USDC', 'USDT'].includes(sym)) return ['5', '10', '25', '50', '100'];
    return ['1', '5', '10', '25', '50'];
  }, [nearSelectedToken]);

  // Tab 2 long-tail picker: NEAR-network assets from the live registry.
  const nearSearchResults = useMemo(() => {
    const base = tokens.filter((t) => t.chains.includes('near'));
    const q = nearSearch.toLowerCase().trim();
    if (!q) return base.slice(0, 25);
    return base
      .filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      .slice(0, 25);
  }, [tokens, nearSearch]);

  return (
    <div className="w-full space-y-6 max-w-5xl mx-auto">
      {/* Back navigation — wide bar on desktop, floating round on mobile */}
      <BackBar label="Back to Dashboard" />

      {/* Mode Tabs */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex p-1.5 rounded-2xl bg-stone-100 border border-stone-200 gap-1.5 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab('crosschain')}
            className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-mono font-bold transition-all cursor-pointer flex items-center space-x-2 ${
              activeTab === 'crosschain'
                ? 'bg-black text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-950 hover:bg-stone-200/60'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Cross-Chain Assets</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('defuse')}
            className={`px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-mono font-bold transition-all cursor-pointer flex items-center space-x-2 ${
              activeTab === 'defuse'
                ? 'bg-black text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-950 hover:bg-stone-200/60'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>NEAR Native &amp; Memes</span>
          </button>
        </div>
      </div>

      {activeTab === 'crosschain' ? (
        /* ── 2-Column Responsive Layout: Main Area (Left) + Side Section (Right) ── */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in">
        {/* ── MAIN AREA (Left 7 Columns) ── */}
        <div className="lg:col-span-7 space-y-6">
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
                    {formatUsd(activeTokenObj.priceUsd ?? null)}
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
                              {formatUsd(token.priceUsd ?? null)}
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
                  <ChainLogo chainId={activeChainDef.id} className="w-8 h-8" />
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
                            <ChainLogo chainId={chain.id} className="w-6 h-6" />
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

        {/* ── STEP 3: EXACT DEPOSIT AMOUNT ── */}
        <div className="space-y-3 pt-2 border-t border-stone-100">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">3</span>
              <span>Enter Exact Deposit Amount</span>
            </label>
            <span className="text-[11px] font-mono text-amber-700 font-semibold flex items-center space-x-1">
              <span>Exact Input Required</span>
            </span>
          </div>

          {/* Amount Input */}
          <div className="relative">
            <input
              type="number"
              step="any"
              min="0"
              disabled={!selectedToken || !selectedChain}
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder={selectedToken ? `Enter exact ${selectedToken} amount to send...` : 'Select asset & network first'}
              className={`w-full p-3.5 pr-20 rounded-2xl border font-mono text-base font-bold transition-all focus:outline-none focus:border-black ${
                !selectedToken || !selectedChain
                  ? 'bg-stone-50/50 border-stone-200/70 text-stone-400 cursor-not-allowed opacity-75'
                  : 'bg-stone-50 hover:bg-stone-100/80 border-stone-200 text-stone-950'
              }`}
            />
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center space-x-1.5">
              {selectedToken && (
                <span className="text-xs font-mono font-extrabold px-2 py-1 rounded-lg bg-stone-200/80 text-stone-800">
                  {selectedToken}
                </span>
              )}
            </div>
          </div>

          {/* Quick-Select Preset Pills */}
          {selectedToken && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-stone-400">Quick select preset amounts:</div>
              <div className="flex flex-wrap gap-2">
                {presetAmounts.map((p) => {
                  const isSelected = depositAmount === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={!selectedChain}
                      onClick={() => handleSelectPreset(p)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        isSelected
                          ? 'bg-black text-white shadow-xs'
                          : 'bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200/60'
                      }`}
                    >
                      {p} {selectedToken}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Critical Exact Input Notice */}
          <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed space-y-1">
            <div className="flex items-center space-x-1.5 font-bold">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 flex-shrink-0" />
              <span>Exact-Amount Intent Routing</span>
            </div>
            <p className="text-amber-800">
              The deposit address is locked to this <strong>exact amount</strong> and routes directly to your confidential passkey vault. Always transfer the exact amount specified from your external wallet.
            </p>
          </div>
        </div>

        {/* Minimum Deposit / Finality Badge when selected */}
        {selectedToken && selectedChain && (
          <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-xs font-mono">
            <span className="text-stone-500">Quoted Deposit:</span>
            <span className="font-bold text-stone-950 flex items-center space-x-1">
              <span>{minAmountDisplay}</span>
              <span className="text-stone-500 font-normal">({minUsdDisplay})</span>
            </span>
          </div>
        )}
      </div>

          {/* Ephemeral Gateway Explainer */}
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-600 space-y-1.5 leading-relaxed font-sans">
            <div className="flex items-center space-x-1.5 font-bold text-stone-900 font-mono">
              <Shield className="w-3.5 h-3.5 text-stone-900" />
              <span>Confidential Ephemeral Ingress</span>
            </div>
            <p>
              Your gateway address is ephemeral and generated exclusively for receiving <strong className="text-stone-900">{selectedToken || 'assets'}</strong> on <strong className="text-stone-900">{activeChainDef?.name || selectedChain || 'your selected network'}</strong>. Funds are settled via NEAR Intents directly into your confidential passkey vault (<span className="font-mono text-stone-900 font-semibold">{nearAccount || 'u_...uprail.near'}</span>).
            </p>
          </div>
        </div>

        {/* ── SIDE SECTION: ONE ADDRESS & GENERATED QR CODE (Right 5 Columns) ── */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6">
          <div className="rounded-3xl p-6 bg-white border border-stone-200 shadow-sm flex flex-col items-center space-y-4">
            {selectedToken && selectedChain && depositAddressValue ? (
              <>
                {/* Active Pair Header */}
                <div className="w-full flex items-center justify-between pb-2 border-b border-stone-100 gap-2">
                  <div className="flex items-center space-x-2 min-w-0">
                    <TokenIcon symbol={selectedToken} size="sm" />
                    <ChainLogo chainId={selectedChain} className="w-4 h-4 flex-shrink-0" />
                    <span className="font-mono text-xs font-bold text-stone-950 truncate">
                      {selectedToken} ({activeChainDef?.name || selectedChain})
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono font-bold flex-shrink-0">
                    Active
                  </span>
                </div>

                {/* Send Exactly Box with 1-Click Copy Amount */}
                <div className="w-full p-3.5 rounded-2xl bg-stone-950 text-white flex items-center justify-between shadow-xs">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400">
                      Send Exactly
                    </div>
                    <div className="text-base sm:text-lg font-mono font-black text-white truncate">
                      {depositAmount || minAmountDisplay.split(' ')[0]} {selectedToken}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyAmount}
                    className="py-1.5 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-mono font-bold transition-all cursor-pointer flex items-center space-x-1.5 border border-white/10 flex-shrink-0 ml-2"
                  >
                    {copiedAmount ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Amount</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Generated QR Code */}
                <div className="py-1">
                  <QRCodeDisplay value={depositAddressValue} size={190} />
                </div>

                {/* Standby Waiting / Live Deposit Status (Under QR code) */}
                {settledSuccess ? (
                  <div className="w-full p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2.5 animate-fade-in shadow-xs text-left">
                    <div className="flex items-center space-x-2 font-bold text-emerald-900 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span>Deposit Received &amp; Shielded!</span>
                    </div>
                    <p className="text-[11px] text-emerald-800 leading-relaxed font-sans">
                      Your funds have arrived and been credited to your confidential passkey vault.
                    </p>
                    {depositStatus?.depositedAmountFormatted && (
                      <div className="p-2.5 bg-white/80 rounded-xl border border-emerald-200 flex items-center justify-between font-mono text-[11px]">
                        <span className="text-stone-500">Credited:</span>
                        <span className="font-bold text-emerald-900">
                          {depositStatus.depositedAmountFormatted} {selectedToken}
                          {depositStatus.depositedAmountUsd ? ` (~$${depositStatus.depositedAmountUsd})` : ''}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center space-x-2 pt-1">
                      <Link
                        to="/app"
                        className="px-3 py-1.5 rounded-xl bg-black text-white text-[11px] font-bold font-mono hover:bg-stone-800 transition-colors"
                      >
                        View in Dashboard
                      </Link>
                      <button
                        type="button"
                        onClick={handleGenerateFresh}
                        className="px-3 py-1.5 rounded-xl bg-white border border-stone-200 text-stone-900 text-[11px] font-bold font-mono hover:bg-stone-50 transition-colors cursor-pointer"
                      >
                        Receive Another
                      </button>
                    </div>
                  </div>
                ) : depositStatus?.status === 'PROCESSING' || parseFloat(depositStatus?.depositedAmountFormatted || '0') > 0 ? (
                  <div className="w-full p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-950 space-y-2 animate-fade-in text-left">
                    <div className="flex items-center space-x-2 text-xs font-bold text-blue-900">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
                      <span>Deposit Detected Onchain! Routing via Intents...</span>
                    </div>
                    <p className="text-[11px] text-blue-800 leading-relaxed font-sans">
                      Received <strong className="font-bold">{depositStatus?.depositedAmountFormatted} {selectedToken}</strong> on {activeChainDef?.name || selectedChain}. Solver network executing vault settlement.
                    </p>
                    {depositStatus?.txHashes && depositStatus.txHashes.length > 0 && (
                      <div className="text-[10px] font-mono text-blue-700 truncate flex items-center space-x-1">
                        <span>Tx:</span>
                        <span className="underline font-bold">{depositStatus.txHashes[0].slice(0, 16)}...</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full p-3.5 rounded-2xl bg-stone-50 border border-stone-200 flex items-center space-x-3 text-left">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping flex-shrink-0" />
                    <div className="font-sans text-xs text-stone-600">
                      <div>
                        <span>Standby: Waiting for incoming deposit on </span>
                        <strong className="text-stone-900 font-semibold">{activeChainDef?.name || selectedChain}</strong>
                      </div>
                      <span className="text-stone-400 block text-[11px] font-mono mt-0.5">
                        Transfer exactly <strong className="text-stone-700 font-bold">{depositAmount || minAmountDisplay}</strong> to the address below.
                      </span>
                    </div>
                  </div>
                )}

                {/* ONE Single Address Display with 1-Click Copy */}
                <div className="w-full space-y-2 text-left">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold uppercase tracking-wider text-stone-600 text-[10px]">
                      Deposit Address
                    </span>
                    <span className="text-[10px] text-stone-400">Single-use</span>
                  </div>
                  <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl font-mono text-xs text-stone-900 break-all select-all font-medium">
                    {depositAddressValue}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="w-full py-2.5 px-4 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold font-mono transition-colors cursor-pointer flex items-center justify-center space-x-2 shadow-xs"
                  >
                    {copiedAddress ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Address Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Address</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Memo Display if Required */}
                {currentAddress?.memo && (
                  <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl text-left space-y-1 font-mono text-xs">
                    <div className="flex items-center justify-between text-amber-900 font-bold text-[10px] uppercase">
                      <span>Required Memo:</span>
                      <span className="text-amber-700 font-normal">Must include</span>
                    </div>
                    <span className="font-bold text-amber-950 break-all select-all block">
                      {currentAddress.memo}
                    </span>
                  </div>
                )}

                <div className="w-full pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] font-mono text-stone-500">
                  <span>Expires in ~3 days</span>
                  <button
                    type="button"
                    onClick={handleGenerateFresh}
                    disabled={isDeriving}
                    className="text-stone-600 hover:text-black flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isDeriving ? 'animate-spin' : ''}`} />
                    <span>New Address</span>
                  </button>
                </div>
              </>
            ) : isDeriving ? (
              <div className="py-16 flex flex-col items-center justify-center space-y-3 text-stone-500 font-mono text-xs text-center">
                <Loader2 className="w-8 h-8 animate-spin text-stone-900" />
                <span>Deriving confidential gateway &amp; QR for {depositAmount || 'exact'} {selectedToken}...</span>
              </div>
            ) : (
              <div className="py-12 px-4 flex flex-col items-center justify-center space-y-3 text-center">
                <div className="w-16 h-16 rounded-2xl bg-stone-50 border border-dashed border-stone-300 flex items-center justify-center text-stone-400">
                  <QrCode className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-mono font-bold text-stone-900 uppercase tracking-wider">
                    QR &amp; Deposit Address
                  </h4>
                  <p className="text-xs text-stone-500 max-w-xs font-sans leading-relaxed">
                    {!selectedToken
                      ? 'Select an asset in Step 1 to begin.'
                      : !selectedChain
                      ? `Select source blockchain network for ${selectedToken} in Step 2.`
                      : !depositAmount || parseFloat(depositAmount) <= 0
                      ? `Enter the exact ${selectedToken} deposit amount in Step 3.`
                      : 'Generating your single-use deposit address & QR code...'}
                  </p>
                </div>
                <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-stone-100 text-[10px] font-mono text-stone-500">
                  <Zap className="w-3 h-3 text-stone-500" />
                  <span>Hardware Passkey Vault Ingress</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      ) : (
        /* ── DIRECT NEAR NATIVE & MEMES TAB — same 1Click pipeline, chain=near ── */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in">
          {/* ── LEFT COLUMN (7 Cols) ── */}
          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-3xl p-6 sm:p-8 bg-white border border-stone-200 shadow-sm space-y-6 relative">
              {/* Badge & Title */}
              <div className="space-y-2">
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-mono font-bold">
                  <Shield className="w-3.5 h-3.5 text-emerald-600" />
                  <span>NEAR Protocol Direct Ingress</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-display font-extrabold text-stone-950">
                  NEAR Native &amp; Meme Deposit
                </h2>
                <p className="text-xs sm:text-sm text-stone-600 leading-relaxed font-sans">
                  Scan, send from any NEAR wallet, done. One-time deposit addresses for native NEAR and NEP-141 tokens — memes included — settle straight into your passkey vault via NEAR Intents.
                </p>
              </div>

              {/* Step 1: Select Token or Meme */}
              <div className="space-y-3 pt-4 border-t border-stone-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-2">
                    <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">1</span>
                    <span>Select Token or Meme</span>
                  </label>
                  <span className="text-[11px] font-mono text-stone-400">NEAR Ecosystem</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {NEAR_NATIVE_TOKENS.map((token) => {
                    const isSelected = nearSelectedToken === token.symbol;
                    return (
                      <button
                        key={token.symbol}
                        type="button"
                        onClick={() => handleSelectNearToken(token.symbol)}
                        className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
                          isSelected
                            ? 'bg-black text-white border-black shadow-xs'
                            : 'bg-stone-50 hover:bg-stone-100/80 border-stone-200 text-stone-900'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <TokenIcon symbol={token.symbol} size="md" />
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                              isSelected ? 'bg-white/20 text-white' : 'bg-stone-200/80 text-stone-700'
                            }`}
                          >
                            {token.badge}
                          </span>
                        </div>
                        <div>
                          <div className={`font-mono text-xs font-extrabold truncate ${isSelected ? 'text-white' : 'text-stone-950'}`}>
                            {token.symbol}
                          </div>
                          <div className={`text-[10px] truncate ${isSelected ? 'text-stone-300' : 'text-stone-500'}`}>
                            {token.name}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {/* Search any NEP-141 — registry long tail */}
                  <button
                    type="button"
                    onClick={() => setIsNearSearchOpen(!isNearSearchOpen)}
                    className={`p-3 rounded-2xl border border-dashed text-left transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
                      isNearSearchOpen
                        ? 'bg-black text-white border-black shadow-xs'
                        : 'bg-stone-50 hover:bg-stone-100/80 border-stone-300 text-stone-900'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-xl border border-stone-300 flex items-center justify-center">
                        <Search className="w-4 h-4" />
                      </div>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                          isNearSearchOpen ? 'bg-white/20 text-white' : 'bg-stone-200/80 text-stone-700'
                        }`}
                      >
                        Any NEP-141
                      </span>
                    </div>
                    <div>
                      <div className={`font-mono text-xs font-extrabold truncate ${isNearSearchOpen ? 'text-white' : 'text-stone-950'}`}>
                        Search
                      </div>
                      <div className={`text-[10px] truncate ${isNearSearchOpen ? 'text-stone-300' : 'text-stone-500'}`}>
                        Full token list
                      </div>
                    </div>
                  </button>
                </div>

                {/* Search dropdown over the live registry */}
                {isNearSearchOpen && (
                  <div className="relative animate-fade-in" ref={nearSearchRef}>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-3.5 top-3.5 text-stone-400" />
                      <input
                        type="text"
                        value={nearSearch}
                        onChange={(e) => setNearSearch(e.target.value)}
                        placeholder="Search any NEAR token or meme..."
                        autoFocus
                        className="w-full bg-stone-50 rounded-xl pl-9 pr-3 py-2 text-xs text-stone-900 placeholder-stone-400 border border-stone-200 focus:outline-none focus:border-black font-mono transition-colors"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto space-y-1 mt-2 pr-1">
                      {nearSearchResults.length === 0 ? (
                        <p className="text-xs text-stone-400 text-center py-5 font-mono">
                          No NEAR tokens match "{nearSearch}"
                        </p>
                      ) : (
                        nearSearchResults.map((token) => {
                          const isSelected = nearSelectedToken.toUpperCase() === token.symbol.toUpperCase();
                          return (
                            <button
                              key={token.symbol}
                              type="button"
                              onClick={() => handleSelectNearToken(token.symbol)}
                              className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-colors text-left cursor-pointer ${
                                isSelected ? 'bg-black text-white font-bold' : 'hover:bg-stone-50 text-stone-800'
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
                                    {token.name}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2 text-right font-mono">
                                <span className={`text-xs ${isSelected ? 'text-white' : 'text-stone-900'}`}>
                                  {formatUsd(token.priceUsd ?? null)}
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

              {/* Step 2: Deposit Amount */}
              <div className="space-y-3 pt-4 border-t border-stone-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-2">
                    <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">2</span>
                    <span>Enter Deposit Amount</span>
                  </label>
                  <span className="text-[11px] font-mono text-stone-400">Optional — defaults to quoted minimum</span>
                </div>

                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={nearAmount}
                    onChange={(e) => setNearAmount(e.target.value)}
                    placeholder={`Amount of ${nearSelectedToken} (empty = quoted minimum)`}
                    className="w-full p-3.5 pr-24 rounded-2xl border font-mono text-base font-bold transition-all focus:outline-none focus:border-black bg-stone-50 hover:bg-stone-100/80 border-stone-200 text-stone-950"
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    <span className="text-xs font-mono font-extrabold px-2 py-1 rounded-lg bg-stone-200/80 text-stone-800">
                      {nearSelectedToken}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-mono text-stone-400">Quick select preset amounts:</div>
                  <div className="flex flex-wrap gap-2">
                    {nearPresetAmounts.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handleNearSelectPreset(p)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                          nearAmount === p
                            ? 'bg-black text-white shadow-xs'
                            : 'bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200/60'
                        }`}
                      >
                        {p} {nearSelectedToken}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 text-[11px] text-stone-600 leading-relaxed space-y-1 font-sans">
                  <div className="flex items-center space-x-1.5 font-bold text-stone-900 font-mono">
                    <Zap className="w-3.5 h-3.5 text-amber-600" />
                    <span>How it settles</span>
                  </div>
                  <p>
                    Send the quoted amount to the one-time address — no memo, no CLI. The solver network shields it into your passkey vault (<span className="font-mono text-stone-900 font-semibold">{nearAccount || 'u_...uprail.near'}</span>), usually within seconds of arrival.
                  </p>
                </div>
              </div>
            </div>

            {/* Ephemeral Gateway Explainer */}
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-600 space-y-1.5 leading-relaxed font-sans">
              <div className="flex items-center space-x-1.5 font-bold text-stone-900 font-mono">
                <Shield className="w-3.5 h-3.5 text-stone-900" />
                <span>Confidential Ephemeral Ingress</span>
              </div>
              <p>
                Your gateway address is ephemeral and generated exclusively for receiving <strong className="text-stone-900">{nearSelectedToken}</strong> on NEAR. Works from Meteor, Sender, HERE, Mintbase, or an exchange withdrawal — funds settle via NEAR Intents directly into your confidential passkey vault.
              </p>
            </div>
          </div>

          {/* ── RIGHT COLUMN (5 Cols, Sticky) ── */}
          <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6">
            <div className="rounded-3xl p-6 bg-white border border-stone-200 shadow-sm flex flex-col items-center space-y-4">
              {/* Active Pair Header */}
              <div className="w-full flex items-center justify-between pb-2 border-b border-stone-100 gap-2">
                <div className="flex items-center space-x-2 min-w-0">
                  <TokenIcon symbol={nearSelectedToken} size="sm" />
                  <ChainLogo chainId="near" className="w-4 h-4 flex-shrink-0" />
                  <span className="font-mono text-xs font-bold text-stone-950 truncate">
                    {nearSelectedToken} (NEAR Network)
                  </span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono font-bold flex-shrink-0">
                  Active
                </span>
              </div>

              {nearAddress?.address ? (
                <>
                  {/* Send Exactly Box with 1-Click Copy Amount */}
                  <div className="w-full p-3.5 rounded-2xl bg-stone-950 text-white flex items-center justify-between shadow-xs">
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400">Send Exactly</div>
                      <div className="text-base sm:text-lg font-mono font-black text-white truncate">
                        {nearSendDisplay || `Any amount of ${nearSelectedToken}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleNearCopyAmount}
                      disabled={!nearSendDisplay}
                      className="py-1.5 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-mono font-bold transition-all cursor-pointer flex items-center space-x-1.5 border border-white/10 flex-shrink-0 ml-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {nearCopiedAmount ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Amount</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Generated QR Code */}
                  <div className="py-1">
                    <QRCodeDisplay value={nearAddress.address} size={190} />
                  </div>

                  {/* Standby Waiting / Live Deposit Status (Under QR code) */}
                  {nearSettled ? (
                    <div className="w-full p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2.5 animate-fade-in shadow-xs text-left">
                      <div className="flex items-center space-x-2 font-bold text-emerald-900 text-xs">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        <span>Deposit Received &amp; Shielded!</span>
                      </div>
                      <p className="text-[11px] text-emerald-800 leading-relaxed font-sans">
                        Your funds have arrived and been credited to your confidential passkey vault.
                      </p>
                      {nearStatus?.depositedAmountFormatted && (
                        <div className="p-2.5 bg-white/80 rounded-xl border border-emerald-200 flex items-center justify-between font-mono text-[11px]">
                          <span className="text-stone-500">Credited:</span>
                          <span className="font-bold text-emerald-900">
                            {nearStatus.depositedAmountFormatted}
                            {nearStatus.depositedAmountUsd ? ` (~$${nearStatus.depositedAmountUsd})` : ''}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center space-x-2 pt-1">
                        <Link
                          to="/app"
                          className="px-3 py-1.5 rounded-xl bg-black text-white text-[11px] font-bold font-mono hover:bg-stone-800 transition-colors"
                        >
                          View in Dashboard
                        </Link>
                        <button
                          type="button"
                          onClick={() => loadNearAddress(true)}
                          className="px-3 py-1.5 rounded-xl bg-white border border-stone-200 text-stone-900 text-[11px] font-bold font-mono hover:bg-stone-50 transition-colors cursor-pointer"
                        >
                          Receive Another
                        </button>
                      </div>
                    </div>
                  ) : nearStatus?.status === 'PROCESSING' || parseFloat(nearStatus?.depositedAmountFormatted || '0') > 0 ? (
                    <div className="w-full p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-950 space-y-2 animate-fade-in text-left">
                      <div className="flex items-center space-x-2 text-xs font-bold text-blue-900">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
                        <span>Deposit Detected Onchain! Routing via Intents...</span>
                      </div>
                      <p className="text-[11px] text-blue-800 leading-relaxed font-sans">
                        Received <strong className="font-bold">{nearStatus?.depositedAmountFormatted}</strong> on NEAR. Solver network executing vault settlement.
                      </p>
                      {nearStatus?.txHashes && nearStatus.txHashes.length > 0 && (
                        <div className="text-[10px] font-mono text-blue-700 truncate flex items-center space-x-1">
                          <span>Tx:</span>
                          <span className="underline font-bold">{nearStatus.txHashes[0].slice(0, 16)}...</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full p-3.5 rounded-2xl bg-stone-50 border border-stone-200 flex items-center space-x-3 text-left">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping flex-shrink-0" />
                      <div className="font-sans text-xs text-stone-600">
                        <div>
                          <span>Standby: Waiting for incoming deposit on </span>
                          <strong className="text-stone-900 font-semibold">NEAR</strong>
                        </div>
                        <span className="text-stone-400 block text-[11px] font-mono mt-0.5">
                          Transfer{' '}
                          {nearSendDisplay ? (
                            <strong className="text-stone-700 font-bold">{nearSendDisplay}</strong>
                          ) : (
                            `any amount of ${nearSelectedToken}`
                          )}{' '}
                          to the address below.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* One-Time Address Display with 1-Click Copy */}
                  <div className="w-full space-y-2 text-left">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold uppercase tracking-wider text-stone-600 text-[10px]">
                        Deposit Address
                      </span>
                      <span className="text-[10px] text-stone-400">Single-use</span>
                    </div>
                    <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl font-mono text-xs text-stone-900 break-all select-all font-medium">
                      {nearAddress.address}
                    </div>
                    <button
                      type="button"
                      onClick={handleNearCopyAddress}
                      className="w-full py-2.5 px-4 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold font-mono transition-colors cursor-pointer flex items-center justify-center space-x-2 shadow-xs"
                    >
                      {nearCopiedAddress ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Address Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Address</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Memo Display if Required */}
                  {nearAddress.memo && (
                    <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl text-left space-y-1 font-mono text-xs">
                      <div className="flex items-center justify-between text-amber-900 font-bold text-[10px] uppercase">
                        <span>Required Memo:</span>
                        <span className="text-amber-700 font-normal">Must include</span>
                      </div>
                      <span className="font-bold text-amber-950 break-all select-all block">{nearAddress.memo}</span>
                    </div>
                  )}

                  <div className="w-full pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] font-mono text-stone-500">
                    <span>Expires in ~3 days</span>
                    <button
                      type="button"
                      onClick={() => loadNearAddress(true)}
                      disabled={nearDeriving}
                      className="text-stone-600 hover:text-black flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${nearDeriving ? 'animate-spin' : ''}`} />
                      <span>New Address</span>
                    </button>
                  </div>
                </>
              ) : nearDeriving ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-3 text-stone-500 font-mono text-xs text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-stone-900" />
                  <span>
                    Deriving confidential gateway &amp; QR for {nearAmount || 'quoted'} {nearSelectedToken}...
                  </span>
                </div>
              ) : nearError ? (
                <div className="py-8 px-4 flex flex-col items-center justify-center space-y-3 text-center animate-fade-in">
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-amber-600" />
                  </div>
                  <p className="text-xs text-stone-600 max-w-xs font-sans leading-relaxed">{nearError}</p>
                  <button
                    type="button"
                    onClick={() => loadNearAddress(true)}
                    className="px-4 py-2 rounded-xl bg-black text-white text-xs font-bold font-mono hover:bg-stone-800 transition-colors cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <div className="py-12 px-4 flex flex-col items-center justify-center space-y-3 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-stone-50 border border-dashed border-stone-300 flex items-center justify-center text-stone-400">
                    <QrCode className="w-8 h-8" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-mono font-bold text-stone-900 uppercase tracking-wider">QR &amp; Deposit Address</h4>
                    <p className="text-xs text-stone-500 max-w-xs font-sans leading-relaxed">
                      Your one-time {nearSelectedToken} deposit address &amp; QR code will appear here.
                    </p>
                  </div>
                  <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-stone-100 text-[10px] font-mono text-stone-500">
                    <Shield className="w-3 h-3 text-stone-500" />
                    <span>Hardware Passkey Vault Ingress</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
