'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from '../lib/router';
import {
  Copy,
  Check,
  QrCode,
  Shield,
  ArrowsClockwise,
  CircleNotch,
  Warning,
  Lightning,
  CheckCircle,
  CaretDown,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { useOnchainData } from '../hooks/useOnchainData';
import { fetchDepositAddress, fetchDepositStatus, DepositAddress, DepositStatusResponse } from '../lib/onchainApi';
import { api, formatUsd } from '../lib/api';
import { TokenIcon } from '../components/TokenIcon';
import { ChainLogo } from '../components/ChainLogo';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { BackBar } from '../components/BackBar';
import { AssetPicker } from '../components/AssetPicker';
import { Badge } from '../components/Badge';
import { useToast } from '../components/Toast';
import { Token } from '../types';

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
  { symbol: 'USDC', name: 'USD Coin', badge: 'Most Popular', chains: ['base', 'arbitrum', 'sol', 'near', 'sui', 'hood', 'pol', 'bsc', 'op', 'avax', 'eth'] },
  { symbol: 'USDT', name: 'Tether USD', badge: 'Stablecoin', chains: ['arbitrum', 'sol', 'near', 'sui', 'hood', 'pol', 'bsc', 'op', 'avax', 'eth', 'tron'] },
  { symbol: 'NEAR', name: 'NEAR Protocol', badge: 'Native Shield', chains: ['near', 'bsc', 'sol', 'arbitrum'] },
  { symbol: 'ETH', name: 'Ethereum', badge: 'Cross-chain', chains: ['base', 'arbitrum', 'eth', 'op', 'scroll', 'hood'] },
  { symbol: 'SOL', name: 'Solana', badge: 'Ultra-Fast', chains: ['sol', 'near'] },
  { symbol: 'BTC', name: 'Bitcoin', badge: 'Native SegWit', chains: ['btc', 'near'] },
  { symbol: 'SUI', name: 'Sui', badge: 'Move L1', chains: ['sui', 'near'] },
  { symbol: 'USDG', name: 'Global Dollar', badge: 'Robinhood', chains: ['hood'] },
  { symbol: 'PRL', name: 'Pearl', badge: 'Pearl L1', chains: ['prl'] },
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
  arb: { id: 'arb', name: 'Arbitrum', icon: '🔷', badge: 'L2 Rollup', time: '~15s', recommended: true },
  sol: { id: 'sol', name: 'Solana', icon: '◎', badge: 'SPL Fast', time: '~15s', recommended: true },
  near: { id: 'near', name: 'NEAR', icon: 'Ⓝ', badge: 'Instant Finality', time: '~2s', recommended: true },
  sui: { id: 'sui', name: 'Sui', icon: '💧', badge: 'Move L1', time: '~5s', recommended: true },
  hood: { id: 'hood', name: 'Robinhood', icon: '🏹', badge: 'Robinhood EVM', time: '~15s', recommended: true },
  prl: { id: 'prl', name: 'Pearl', icon: '⚪', badge: 'Pearl L1', time: '~15s' },
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

/** Pre-selected token for the Receive dropdown; the destination is always
 * the user's platform passkey account regardless of token. */
const NEAR_RECEIVE_TOKEN: Token = {
  id: 'nep141:wrap.near',
  symbol: 'NEAR',
  name: 'NEAR Protocol',
  iconUrl: '',
  decimals: 24,
  nearContractId: 'wrap.near',
  chain: 'near',
};

/**
 * Shared deposit-status poller for the Receive tabs. Runs an immediate check,
 * then polls /api/onchain/deposit-status every 2.5s while an address is set and
 * not yet settled. Handlers are held in a ref so re-renders never restart the
 * interval.
 */
function useDepositPoll(opts: {
  address: string | undefined;
  settled: boolean;
  contract?: string;
  token?: string;
  onStatus: (status: DepositStatusResponse) => void;
  onSettled: () => void;
  refreshBalances: () => void;
  refreshHistory: () => void;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { address, settled, contract, token } = opts;

  useEffect(() => {
    if (!address || settled) return;

    // NEAR vault-ingress probes answer with the account's CUMULATIVE FT
    // balance, so the first reading is whatever was already held — not a
    // deposit. Treating that as "arrived" made the tab celebrate a deposit
    // that never happened and re-fetch balances every 2.5s forever. Only a
    // later increase proves new funds actually landed.
    const isCumulative = Boolean(contract);
    let baseline: bigint | null = null;
    // The NEAR tab polls a vault that may sit idle for hours. Re-rendering on
    // an identical payload every 2.5s is pure churn, so the status callback
    // only fires when something the UI can show has actually changed.
    let lastSignature = '';

    const toRaw = (v?: string): bigint => {
      try {
        return BigInt((v || '').trim() || '0');
      } catch {
        return 0n;
      }
    };

    const checkStatus = async () => {
      try {
        const o = optsRef.current;
        const status = await fetchDepositStatus(address, { contract: o.contract, token: o.token });
        const signature = `${status.status}|${status.depositedAmountFormatted}|${status.isSettled}|${status.error || ''}`;
        if (signature !== lastSignature) {
          lastSignature = signature;
          o.onStatus(status);
        }

        let isNewDeposit: boolean;
        if (isCumulative) {
          const raw = toRaw(status.depositedAmount);
          if (baseline === null) {
            baseline = raw;
            isNewDeposit = false;
          } else {
            isNewDeposit = raw > baseline;
            if (isNewDeposit) baseline = raw;
          }
        } else {
          const depAmt = parseFloat(status.depositedAmountFormatted || '0');
          isNewDeposit = status.status === 'SUCCESS' || status.isSettled === true || depAmt > 0;
        }

        if (isNewDeposit) {
          // Only refetch on a real arrival — a settled tab must not poll.
          o.refreshBalances();
          o.refreshHistory();
          o.onSettled();
        }
      } catch (err) {
        // Silent poll error
      }
    };

    // Initial check immediately, then poll every 2.5 seconds
    checkStatus();
    const id = setInterval(checkStatus, 2500);
    return () => clearInterval(id);
  }, [address, settled, contract, token]);
}

export const ReceivePage: React.FC = () => {
  const { hasIntentAccount, nearAccount, balances, refreshBalances, refreshHistory } = useOnchainData();
  const { toast } = useToast();

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
  // Tab 2 — direct receive: pick any token from the full NEAR index; the
  // destination is always the user's own platform passkey account.
  const [nearAsset, setNearAsset] = useState<Token>(NEAR_RECEIVE_TOKEN);
  const [registryTokens, setRegistryTokens] = useState<Token[]>([]);
  const [nearCopiedAddress, setNearCopiedAddress] = useState<boolean>(false);
  const [nearDepositAddress, setNearDepositAddress] = useState<DepositAddress | null>(null);
  const [nearDepositError, setNearDepositError] = useState<string | null>(null);
  const [nearAddressConfirmed, setNearAddressConfirmed] = useState<boolean>(false);
  const [isNearDeriving, setIsNearDeriving] = useState<boolean>(false);
  const [nearDepositStatus, setNearDepositStatus] = useState<DepositStatusResponse | null>(null);
  const [nearSettledSuccess, setNearSettledSuccess] = useState<boolean>(false);
  const [showDirectVault, setShowDirectVault] = useState<boolean>(false);

  // Dropdown states
  const [isTokenDropdownOpen, setIsTokenDropdownOpen] = useState(false);
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [chainSearch, setChainSearch] = useState('');

  const tokenDropdownRef = useRef<HTMLDivElement>(null);
  const chainDropdownRef = useRef<HTMLDivElement>(null);

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
      setRegistryTokens(toks);
      const map = new Map<string, TokenOption>();
      // Seed with curated options
      for (const t of TOKEN_OPTIONS) {
        map.set(t.symbol.toUpperCase(), { ...t, chains: [...t.chains] });
      }
      for (const t of toks) {
        const sym = t.symbol.toUpperCase();
        const rawChain = (t.chain || 'near').toLowerCase();
        const chain =
          rawChain === 'arb'
            ? 'arbitrum'
            : rawChain === 'robinhood'
            ? 'hood'
            : rawChain === 'pearl'
            ? 'prl'
            : rawChain;
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
  };

  const canShowAddress = Boolean(
    hasIntentAccount &&
      selectedToken &&
      selectedChain &&
      depositAmount.trim() &&
      !isNaN(parseFloat(depositAmount)) &&
      parseFloat(depositAmount) > 0
  );

  const handleShowAddress = () => {
    if (!canShowAddress || isDeriving) return;
    loadAddress(true);
  };

  // A one-time quote is only requested when the user clicks "Show Address".
  // Changing the asset, network, or amount invalidates any address on screen.
  useEffect(() => {
    setCurrentAddress(null);
    setDepositStatus(null);
    setSettledSuccess(false);
  }, [selectedToken, selectedChain, depositAmount]);

  const loadNearAddress = useCallback(
    async (refresh = false) => {
      if (!hasIntentAccount || !nearAsset?.symbol) return;
      setIsNearDeriving(true);
      setNearDepositError(null);
      try {
        // Pin the contract: tickers are not unique on NEAR, so resolving by
        // symbol alone can derive an address for the wrong UPTOBER.
        const data = await fetchDepositAddress(
          'near',
          refresh,
          nearAsset.symbol,
          undefined,
          nearAsset.nearContractId
        );
        if (!data?.address) {
          setNearDepositAddress(null);
          setNearDepositError(
            `No ${nearAsset.symbol} deposit route is available right now. No address is shown until one is generated.`
          );
          return;
        }
        setNearDepositAddress(data);
      } catch (err) {
        console.warn('Failed to load NEAR deposit address:', err);
        // Never leave the previous token's address on screen under the new
        // token's name — that is how funds get sent to the wrong asset.
        setNearDepositAddress(null);
        setNearDepositError(
          `Could not create a ${nearAsset.symbol} deposit address. No address is shown until one is generated.`
        );
      } finally {
        setIsNearDeriving(false);
      }
    },
    [hasIntentAccount, nearAsset]
  );

  useEffect(() => {
    if (activeTab === 'defuse') {
      loadNearAddress(false);
    }
  }, [activeTab, nearAsset, loadNearAddress]);

  // Real-time deposit polling (every 2.5s) — one instance per tab, active tab
  // only. Both tabs share the same /api/onchain/deposit-status pipeline.
  useDepositPoll({
    address: activeTab === 'crosschain' ? currentAddress?.address : nearDepositAddress?.address,
    settled: activeTab === 'crosschain' ? settledSuccess : nearSettledSuccess,
    // Only the NEAR tab uses vault-ingress detection; cross-chain deposits are
    // tracked by the bridge indexer and must not be probed on a token contract.
    contract: activeTab === 'defuse' ? nearAsset.nearContractId : undefined,
    token: activeTab === 'defuse' ? nearAsset.symbol : undefined,
    onStatus: (status) => {
      if (activeTab === 'crosschain') setDepositStatus(status);
      else setNearDepositStatus(status);
    },
    onSettled: () => {
      if (activeTab === 'crosschain') setSettledSuccess(true);
      else setNearSettledSuccess(true);
    },
    refreshBalances,
    refreshHistory,
  });

  const handleCopyAddress = () => {
    if (!currentAddress?.address) return;
    navigator.clipboard.writeText(currentAddress.address);
    setCopiedAddress(true);
    toast('Deposit address copied');
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleCopyAmount = () => {
    const amtToCopy = currentAddress?.minAmountFormatted
      ? currentAddress.minAmountFormatted.split(' ')[0]
      : depositAmount.trim();
    if (!amtToCopy) return;
    navigator.clipboard.writeText(amtToCopy);
    setCopiedAmount(true);
    toast('Amount copied');
    setTimeout(() => setCopiedAmount(false), 2000);
  };

  const handleGenerateFresh = () => {
    loadAddress(true);
  };

  // ── Tab 2: NEAR native receive ─────────────────────────────────────────────
  const handleSelectNearToken = (token: Token) => {
    // Drop the old address immediately so it can never be shown (or copied)
    // while the new token's address is being derived, or if derivation fails.
    setNearDepositAddress(null);
    setNearDepositError(null);
    // A new token needs a fresh acknowledgement before its address is shown.
    setNearAddressConfirmed(false);
    setNearAsset(token);
    setNearSettledSuccess(false);
    setNearDepositStatus(null);
  };

  const handleNearCopyAddress = () => {
    const addr = nearDepositAddress?.address || nearAccount;
    if (!addr) return;
    navigator.clipboard.writeText(addr);
    setNearCopiedAddress(true);
    toast('NEAR account copied');
    setTimeout(() => setNearCopiedAddress(false), 2000);
  };

  const handleGenerateFreshNear = () => {
    // Clear the settled banner so polling restarts with a fresh baseline —
    // otherwise the previous deposit stays celebrated and no new arrival is
    // ever noticed while the tab is open.
    setNearSettledSuccess(false);
    setNearDepositStatus(null);
    loadNearAddress(true);
  };

  const depositAddressValue = currentAddress?.address || '';
  const nearDepositAddressValue = nearDepositAddress?.address || '';

  // The curated registry plus whatever the user actually holds, cut down to
  // NEAR-native assets. The backend registry carries every chain it can bridge
  // from (Solana, Ethereum, BSC, ...), and this tab only receives to a NEAR
  // passkey account, so anything not settling on NEAR belongs on the
  // cross-chain tab. Filtering here is what stops ~150 foreign-chain assets
  // from crowding the NEAR-native & memes picker.
  // The backend registry is a curated slice, so a launchpad meme (e.g.
  // UPTOBER) can be absent from it while still sitting in the vault — the
  // held-asset pass below still surfaces those.
  const nearPickerTokens = useMemo<Token[]>(() => {
    const nearOnly = registryTokens.filter((t) => (t.chain || 'near').toLowerCase() === 'near');
    const seen = new Set(nearOnly.map((t) => (t.nearContractId || t.id || '').toLowerCase()));
    const seenSymbols = new Set(nearOnly.map((t) => t.symbol.toUpperCase()));
    const extra: Token[] = [];
    for (const b of balances || []) {
      const contract = (b.nearContractId || '').toLowerCase();
      const sym = (b.symbol || '').toUpperCase();
      if (!contract || seen.has(contract)) continue;
      if (seenSymbols.has(sym)) continue;
      const amt = parseFloat(b.amountFormatted || b.amount || '0') || 0;
      if (amt <= 0) continue;
      seen.add(contract);
      seenSymbols.add(sym);
      extra.push({
        id: b.defuse_asset_id || `nep141:${contract}`,
        symbol: sym,
        name: sym,
        iconUrl: b.icon || '',
        decimals: b.decimals ?? 18,
        nearContractId: b.nearContractId,
        chain: 'near',
        badge: 'NEAR',
        category: 'memes',
        balance: b.amountFormatted || b.amount || '0',
      });
    }
    return extra.length > 0 ? [...nearOnly, ...extra] : nearOnly;
  }, [registryTokens, balances]);

  // Vault ingress addresses are reusable (no 1Click one-time quote), so the
  // single-use / expiry copy would be a lie for them.
  const nearIsOneTime = nearDepositAddress?.isOneTime !== false;
  const minAmountDisplay =
    currentAddress?.minAmountFormatted ||
    (depositAmount && selectedToken ? `${depositAmount} ${selectedToken}` : selectedToken === 'USDC' ? '0.10 USDC' : selectedToken === 'NEAR' ? '0.01 NEAR' : `0.10 ${selectedToken}`);
  const minUsdDisplay = currentAddress?.minAmountUsd || (depositAmount ? `$${parseFloat(depositAmount || '0').toFixed(2)}` : '$0.10');


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
    <div className="w-full space-y-6 max-w-5xl mx-auto">
      {/* Back navigation — wide bar on desktop, floating round on mobile */}
      <BackBar label="Back to Dashboard" />

      {/* Mode Tabs */}
      <div className="flex justify-center mb-6">
        <div className="w-full sm:w-auto flex p-1.5 rounded-2xl bg-stone-100 border border-stone-200 gap-1.5 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab('crosschain')}
            className={`flex-1 sm:flex-initial justify-center px-3 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-mono font-bold transition-all cursor-pointer flex items-center space-x-1.5 sm:space-x-2 ${
              activeTab === 'crosschain'
                ? 'bg-black text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-950 hover:bg-stone-200/60'
            }`}
          >
            <Lightning weight="fill" className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">Any chain</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('defuse')}
            className={`flex-1 sm:flex-initial justify-center px-3 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-mono font-bold transition-all cursor-pointer flex items-center space-x-1.5 sm:space-x-2 ${
              activeTab === 'defuse'
                ? 'bg-black text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-950 hover:bg-stone-200/60'
            }`}
          >
            <Shield weight="fill" className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">NEAR &amp; memes</span>
          </button>
        </div>
      </div>

      {activeTab === 'crosschain' ? (
        /* ── 2-Column Responsive Layout: Main Area (Left) + Side Section (Right) ── */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in">
        {/* ── MAIN AREA (Left 7 Columns) ── */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-3xl p-4 sm:p-6 md:p-8 bg-white border border-stone-200 shadow-sm space-y-6 relative">

        {/* ── STEP 1: ASSET DROPDOWN ── */}
        <div className="space-y-2" ref={tokenDropdownRef}>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold flex-shrink-0">1</span>
              <span>Select Asset to Deposit</span>
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
                      <Badge tone="neutral">{activeTokenObj.badge}</Badge>
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
                      Select an Asset to Deposit...
                    </span>
                    <span className="text-xs text-stone-500 font-sans">
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
                <CaretDown weight="fill" className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${isTokenDropdownOpen ? 'rotate-180 text-stone-900' : ''}`} />
              </div>
            </button>

            {/* Dropdown Popover */}
            {isTokenDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl border border-stone-200 shadow-xl z-50 p-2 space-y-2 animate-fade-in font-sans">
                {/* Search Bar */}
                <div className="relative px-1 pt-1">
                  <MagnifyingGlass weight="bold" className="w-3.5 h-3.5 absolute left-3.5 top-3.5 text-stone-400" />
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
                    <p className="text-xs text-stone-500 text-center py-6 font-mono">
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
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${isSelected ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600'}`}>
                                  {token.badge}
                                </span>
                              </div>
                              <div className={`text-[11px] ${isSelected ? 'text-stone-300' : 'text-stone-500'}`}>
                                {token.name} · {token.chains.length} routes
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 text-right font-mono">
                            <span className={`text-xs ${isSelected ? 'text-white' : 'text-stone-900'}`}>
                              {formatUsd(token.priceUsd ?? null)}
                            </span>
                            {isSelected && <Check weight="bold" className="w-3.5 h-3.5 text-white flex-shrink-0" />}
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
          <div className="flex flex-wrap items-center justify-between gap-1">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold flex-shrink-0">2</span>
              <span>Select Source Blockchain</span>
            </label>
            <span className="text-[11px] font-mono text-stone-500">
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
                      <Badge tone="neutral">{activeChainDef.badge}</Badge>
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
                <CaretDown weight="fill" className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${isChainDropdownOpen ? 'rotate-180 text-stone-900' : ''}`} />
              </div>
            </button>

            {/* Dropdown Popover */}
            {isChainDropdownOpen && selectedToken && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl border border-stone-200 shadow-xl z-50 p-2 space-y-2 animate-fade-in font-sans">
                {/* Search Bar */}
                <div className="relative px-1 pt-1">
                  <MagnifyingGlass weight="bold" className="w-3.5 h-3.5 absolute left-3.5 top-3.5 text-stone-400" />
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
                            {isSelected && <Check weight="bold" className="w-3.5 h-3.5 text-white flex-shrink-0" />}
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
          <div className="flex flex-wrap items-center justify-between gap-1">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold flex-shrink-0">3</span>
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
              placeholder={selectedToken ? `Enter ${selectedToken} amount` : 'Amount'}
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
          <div className="p-3.5 rounded-2xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-700/50 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed space-y-1">
            <div className="flex items-center space-x-1.5 font-bold">
              <Warning weight="fill" className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 flex-shrink-0" />
              <span>Exact-Amount Intent Routing</span>
            </div>
            <p className="text-amber-800 dark:text-amber-200/90">
              The deposit address is locked to this <strong>exact amount</strong> and goes directly into your UPRAIL account. Always transfer the exact amount specified from your external wallet.
            </p>
          </div>

          {!currentAddress && (
            <button
              type="button"
              onClick={handleShowAddress}
              disabled={!canShowAddress || isDeriving}
              className="w-full py-3.5 px-5 rounded-2xl bg-black hover:bg-stone-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-display font-extrabold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center space-x-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {isDeriving ? (
                <>
                  <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />
                  <span>Generating Address...</span>
                </>
              ) : (
                <>
                  <QrCode weight="fill" className="w-4 h-4" />
                  <span>Show Address</span>
                </>
              )}
            </button>
          )}
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
              <Shield weight="fill" className="w-3.5 h-3.5 text-stone-900" />
              <span>One-time deposit address</span>
            </div>
            <p>
              This address is generated only for receiving <strong className="text-stone-900">{selectedToken || 'assets'}</strong> on <strong className="text-stone-900">{activeChainDef?.name || selectedChain || 'your selected network'}</strong>. The money is settled directly into your UPRAIL account (<span className="font-mono text-stone-900 font-semibold break-all">{nearAccount || 'u_...uprail.near'}</span>).
            </p>
          </div>
        </div>

        {/* ── SIDE SECTION: ONE ADDRESS & GENERATED QR CODE (Right 5 Columns) ── */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6">
          <div className="rounded-3xl p-4 sm:p-6 bg-white border border-stone-200 shadow-sm flex flex-col items-center space-y-4">
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
                  <Badge tone="ok">Active</Badge>
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
                        <Check weight="bold" className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy weight="fill" className="w-3.5 h-3.5" />
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
                      <CheckCircle weight="fill" className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span>Deposit Received &amp; Shielded!</span>
                    </div>
                    <p className="text-[11px] text-emerald-800 leading-relaxed font-sans">
                      Your money has arrived and been added to your UPRAIL account.
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
                        Deposit Another
                      </button>
                    </div>
                  </div>
                ) : depositStatus?.status === 'PROCESSING' || parseFloat(depositStatus?.depositedAmountFormatted || '0') > 0 ? (
                  <div className="w-full p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-950 space-y-2 animate-fade-in text-left">
                    <div className="flex items-center space-x-2 text-xs font-bold text-blue-900">
                      <CircleNotch weight="bold" className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
                      <span>Deposit Detected Onchain! Routing via Intents...</span>
                    </div>
                    <p className="text-[11px] text-blue-800 leading-relaxed font-sans">
                      Received <strong className="font-bold">{depositStatus?.depositedAmountFormatted} {selectedToken}</strong> on {activeChainDef?.name || selectedChain}. Settling into your UPRAIL account.
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
                        <Check weight="bold" className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Address Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy weight="fill" className="w-3.5 h-3.5" />
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
                    <ArrowsClockwise weight="bold" className={`w-3 h-3 ${isDeriving ? 'animate-spin' : ''}`} />
                    <span>New Address</span>
                  </button>
                </div>
              </>
            ) : isDeriving ? (
              <div className="py-16 flex flex-col items-center justify-center space-y-3 text-stone-500 font-mono text-xs text-center">
                <CircleNotch weight="bold" className="w-8 h-8 animate-spin text-stone-900" />
                <span>Creating your deposit address &amp; QR for {depositAmount || 'exact'} {selectedToken}...</span>
              </div>
            ) : (
              <div className="py-12 px-4 flex flex-col items-center justify-center space-y-3 text-center">
                <div className="w-16 h-16 rounded-2xl bg-stone-50 border border-dashed border-stone-300 flex items-center justify-center text-stone-400">
                  <QrCode weight="fill" className="w-8 h-8" />
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
                      : 'Click "Show Address" to generate your single-use deposit address & QR code.'}
                  </p>
                </div>
                {canShowAddress && (
                  <button
                    type="button"
                    onClick={handleShowAddress}
                    disabled={isDeriving}
                    className="px-4 py-2 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors flex items-center space-x-1.5 cursor-pointer"
                  >
                    <QrCode weight="fill" className="w-3.5 h-3.5" />
                    <span>Show Address</span>
                  </button>
                )}
                <Badge tone="neutral" icon={<Lightning weight="fill" className="w-3 h-3" />}>
                  Protected by your passkey
                </Badge>
              </div>
            )}
          </div>
        </div>
      </div>
      ) : (
        /* ── DIRECT NEAR NATIVE & MEMES TAB — pick token, deposit to pk account ── */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in">
          {/* ── LEFT COLUMN (7 Cols) ── */}
          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-3xl p-6 sm:p-8 bg-white border border-stone-200 shadow-sm space-y-6">
              {/* Badge & Title */}
              <div className="space-y-2">
                <Badge tone="ok" icon={<Shield weight="fill" className="w-3 h-3" />}>
                  NEAR Protocol Direct Ingress
                </Badge>
                <h2 className="text-xl sm:text-2xl font-display font-extrabold text-stone-950">
                  Deposit any NEAR token
                </h2>
              </div>

              {/* Step 1: full token index dropdown */}
              <div className="space-y-3 pt-4 border-t border-stone-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-stone-700 font-mono flex items-center space-x-2">
                    <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">1</span>
                    <span>Select Token to Deposit</span>
                  </label>
                  <span className="text-[11px] font-mono text-stone-500">All NEAR tokens</span>
                </div>

                <AssetPicker
                  tokens={nearPickerTokens}
                  selectedToken={nearAsset}
                  onSelectToken={handleSelectNearToken}
                  tab="memes"
                />
              </div>
            </div>

            {/* One-line note */}
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-600 font-sans leading-relaxed">
              Send <strong className="text-stone-900 font-semibold">{nearAsset.symbol}</strong> from any wallet or exchange to this address — it goes into your UPRAIL account automatically.
            </div>
          </div>

          {/* ── RIGHT COLUMN (5 Cols, Sticky) ── */}
          <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6">
            <div className="rounded-3xl p-6 bg-white border border-stone-200 shadow-sm flex flex-col items-center space-y-4">
              {/* Active Pair Header */}
              <div className="w-full flex items-center justify-between pb-2 border-b border-stone-100 gap-2">
                <div className="flex items-center space-x-2 min-w-0">
                  <TokenIcon symbol={nearAsset.symbol} size="sm" />
                  <ChainLogo chainId="near" className="w-4 h-4 flex-shrink-0" />
                  <span className="font-mono text-xs font-bold text-stone-950 truncate">
                    {nearAsset.symbol} (NEAR Network)
                  </span>
                </div>
                <Badge tone="ok">Active</Badge>
              </div>

              {/* Wrong-asset guardrail: the quote only settles the selected token. */}
              <div className="w-full p-3 rounded-2xl bg-amber-50 border border-amber-200 text-left space-y-1">
                <div className="flex items-center space-x-1.5 text-[11px] font-bold text-amber-900">
                  <Warning weight="fill" className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Send only {nearAsset.symbol} on NEAR to this address</span>
                </div>
                <p className="text-[11px] text-amber-800 font-sans leading-relaxed">
                  This address is generated for {nearAsset.symbol}
                  {nearAsset.nearContractId ? (
                    <span className="font-mono text-[10px] break-all"> ({nearAsset.nearContractId})</span>
                  ) : null}
                  . A different token or network sent here is not credited and may be unrecoverable.
                </p>
              </div>

              {isNearDeriving ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-3 text-stone-500 font-mono text-xs text-center">
                  <CircleNotch weight="bold" className="w-8 h-8 animate-spin text-stone-900" />
                  <span>Deriving shielded deposit address for {nearAsset.symbol}...</span>
                </div>
              ) : nearDepositError ? (
                <div className="w-full py-10 flex flex-col items-center justify-center space-y-3 text-center px-2">
                  <Warning weight="fill" className="w-8 h-8 text-amber-600" />
                  <p className="text-xs text-stone-600 font-sans leading-relaxed">{nearDepositError}</p>
                  <button
                    type="button"
                    onClick={() => loadNearAddress(true)}
                    className="px-3 py-1.5 rounded-xl bg-black text-white text-[11px] font-bold font-mono hover:bg-stone-800 transition-colors cursor-pointer"
                  >
                    Try again
                  </button>
                </div>
              ) : nearDepositAddressValue ? (
                !nearAddressConfirmed ? (
                  <div className="w-full py-6 flex flex-col items-center text-center space-y-4 animate-fade-in">
                    <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center">
                      <TokenIcon symbol={nearAsset.symbol} size="md" />
                    </div>
                    <div className="space-y-1 px-2">
                      <p className="text-sm font-display font-extrabold text-stone-950">
                        Ready to receive {nearAsset.symbol}
                      </p>
                      <p className="text-[11px] text-stone-500 font-sans leading-relaxed max-w-[280px]">
                        Your single-use address is ready. Reveal it only when you are about to send{' '}
                        <strong className="text-stone-800 font-semibold">{nearAsset.symbol}</strong> on NEAR.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNearAddressConfirmed(true)}
                      className="w-full py-3 px-4 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold font-mono transition-colors cursor-pointer flex items-center justify-center space-x-2 shadow-xs"
                    >
                      <QrCode weight="fill" className="w-4 h-4" />
                      <span>Show {nearAsset.symbol} address</span>
                    </button>
                    <p className="text-[10px] text-amber-700 font-mono">
                      Only {nearAsset.symbol} on NEAR is credited to this address.
                    </p>
                  </div>
                ) : (
                <>
                  {/* QR of the single-use shielded ingress address */}
                  <div className="py-1">
                    <QRCodeDisplay value={nearDepositAddressValue} size={190} />
                  </div>

                  {/* Status Banner */}
                  {nearSettledSuccess ? (
                    <div className="w-full p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2.5 animate-fade-in shadow-xs text-left">
                      <div className="flex items-center space-x-2 font-bold text-emerald-900 text-xs">
                        <CheckCircle weight="fill" className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        <span>Deposit Received &amp; Shielded!</span>
                      </div>
                      <p className="text-[11px] text-emerald-800 leading-relaxed font-sans">
                        Your {nearAsset.symbol} has arrived and been added to your UPRAIL account.
                      </p>
                      <div className="flex items-center space-x-2 pt-1">
                        <Link
                          to="/app"
                          className="px-3 py-1.5 rounded-xl bg-black text-white text-[11px] font-bold font-mono hover:bg-stone-800 transition-colors"
                        >
                          View in Dashboard
                        </Link>
                        <button
                          type="button"
                          onClick={handleGenerateFreshNear}
                          className="px-3 py-1.5 rounded-xl bg-white border border-stone-200 text-stone-900 text-[11px] font-bold font-mono hover:bg-stone-50 transition-colors cursor-pointer"
                        >
                          Deposit Another
                        </button>
                      </div>
                    </div>
                  ) : nearDepositStatus?.status === 'PROCESSING' ? (
                    <div className="w-full p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-950 space-y-2 animate-fade-in text-left">
                      <div className="flex items-center space-x-2 text-xs font-bold text-blue-900">
                        <CircleNotch weight="bold" className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
                        <span>Deposit Detected on NEAR! Settling...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full p-3.5 rounded-2xl bg-stone-50 border border-stone-200 flex items-center space-x-3 text-left">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping flex-shrink-0" />
                      <div className="font-sans text-xs text-stone-600">
                        <span>Standby: Waiting for incoming {nearAsset.symbol} on NEAR</span>
                        <span className="text-stone-400 block text-[11px] font-mono mt-0.5">
                          {nearIsOneTime
                            ? 'Single-use ephemeral ingress • 100% onchain shielded'
                            : 'Reusable address • detected when the money arrives'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Single-Use Deposit Address with 1-Click Copy */}
                  <div className="w-full space-y-2 text-left">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold uppercase tracking-wider text-stone-600 text-[10px]">
                        Shielded Deposit Address
                      </span>
                      <span className="text-[10px] text-stone-400">
                        {nearIsOneTime ? 'Single-use' : 'Reusable'}
                      </span>
                    </div>
                    <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl font-mono text-xs text-stone-900 break-all select-all font-medium">
                      {nearDepositAddressValue}
                    </div>
                    <button
                      type="button"
                      onClick={handleNearCopyAddress}
                      className="w-full py-2.5 px-4 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold font-mono transition-colors cursor-pointer flex items-center justify-center space-x-2 shadow-xs"
                    >
                      {nearCopiedAddress ? (
                        <>
                          <Check weight="bold" className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Address Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy weight="fill" className="w-3.5 h-3.5" />
                          <span>Copy Shielded Address</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="w-full pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] font-mono text-stone-500">
                    <span>{nearIsOneTime ? 'Expires in ~3 days' : 'Reusable — no expiry'}</span>
                    <button
                      type="button"
                      onClick={handleGenerateFreshNear}
                      disabled={isNearDeriving}
                      className="text-stone-600 hover:text-black flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                    >
                      <ArrowsClockwise weight="bold" className={`w-3 h-3 ${isNearDeriving ? 'animate-spin' : ''}`} />
                      <span>{nearIsOneTime ? 'New Address' : 'Refresh'}</span>
                    </button>
                  </div>

                  {/* Direct Vault Address Expandable Option — suppressed when the
                      primary address already IS the vault (ingress fallback). */}
                  {nearAccount && nearIsOneTime && (
                    <div className="w-full pt-3 border-t border-stone-100 text-left">
                      <button
                        type="button"
                        onClick={() => setShowDirectVault(!showDirectVault)}
                        className="text-[11px] font-mono text-stone-500 hover:text-stone-900 flex items-center justify-between w-full cursor-pointer py-1"
                      >
                        <span>Direct UPRAIL address (Advanced)</span>
                        <span>{showDirectVault ? '−' : '+'}</span>
                      </button>
                      {showDirectVault && (
                        <div className="mt-2 p-3 bg-stone-50 border border-stone-200 rounded-xl space-y-2 animate-fade-in">
                          <span className="text-[10px] text-stone-400 font-mono block">
                            Reusable address — use it for future deposits
                          </span>
                          <div className="font-mono text-xs text-stone-900 break-all select-all">
                            {nearAccount}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(nearAccount);
                              setNearCopiedAddress(true);
                              toast('NEAR account copied');
                              setTimeout(() => setNearCopiedAddress(false), 2000);
                            }}
                            className="text-xs font-mono font-bold text-stone-700 hover:text-black underline"
                          >
                            Copy Direct Address
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
                )
              ) : !hasIntentAccount ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-3 text-stone-500 font-mono text-xs text-center">
                  <CircleNotch weight="bold" className="w-8 h-8 animate-spin text-stone-900" />
                  <span>Setting up your UPRAIL account…</span>
                  <span className="text-stone-400 max-w-[240px] leading-relaxed">
                    Deposit addresses appear once setup finishes — usually a few seconds after your first sign-in.
                  </span>
                  <button
                    type="button"
                    onClick={() => refreshBalances()}
                    className="mt-1 text-xs font-bold text-stone-700 hover:text-black underline"
                  >
                    Check again
                  </button>
                </div>
              ) : nearAccount ? (
                <>
                  <div className="py-1">
                    <QRCodeDisplay value={nearAccount} size={190} />
                  </div>
                  <div className="w-full space-y-2 text-left">
                    <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl font-mono text-xs text-stone-900 break-all select-all font-medium">
                      {nearAccount}
                    </div>
                    <button
                      type="button"
                      onClick={handleNearCopyAddress}
                      className="w-full py-2.5 px-4 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold font-mono transition-colors cursor-pointer flex items-center justify-center space-x-2 shadow-xs"
                    >
                      <Copy weight="fill" className="w-3.5 h-3.5" />
                      <span>Copy Address</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-16 flex flex-col items-center justify-center space-y-3 text-stone-500 font-mono text-xs text-center">
                  <CircleNotch weight="bold" className="w-8 h-8 animate-spin text-stone-900" />
                  <span>Loading your UPRAIL account...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
