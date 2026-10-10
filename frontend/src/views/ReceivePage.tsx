'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  ExternalLink,
  Radio,
} from 'lucide-react';
import { useOnchainData } from '../hooks/useOnchainData';
import { fetchDepositAddress, fetchDepositStatus, DepositAddress, DepositStatusResponse } from '../lib/onchainApi';
import { TokenIcon } from '../components/TokenIcon';

interface TokenOption {
  symbol: string;
  name: string;
  badge: string;
  chains: string[];
}

interface ChainOption {
  id: string;
  name: string;
  icon: string;
  badge: string;
  time: string;
  recommended?: boolean;
}

const TOKEN_OPTIONS: TokenOption[] = [
  { symbol: 'USDC', name: 'USD Coin', badge: 'Most Popular', chains: ['base', 'arbitrum', 'sol', 'near', 'eth'] },
  { symbol: 'USDT', name: 'Tether USD', badge: 'Stablecoin', chains: ['arbitrum', 'sol', 'near', 'eth'] },
  { symbol: 'NEAR', name: 'NEAR Protocol', badge: 'Native Shield', chains: ['near'] },
  { symbol: 'ETH', name: 'Ethereum', badge: 'Cross-chain', chains: ['base', 'arbitrum', 'eth'] },
  { symbol: 'SOL', name: 'Solana', badge: 'Ultra-Fast', chains: ['sol'] },
  { symbol: 'BTC', name: 'Bitcoin', badge: 'Native SegWit', chains: ['btc'] },
];

const CHAIN_DEFINITIONS: Record<string, ChainOption> = {
  base: { id: 'base', name: 'Base', icon: '🔵', badge: 'L2 Sub-Cent', time: '~15s', recommended: true },
  arbitrum: { id: 'arbitrum', name: 'Arbitrum', icon: '🔷', badge: 'L2 Rollup', time: '~15s', recommended: true },
  sol: { id: 'sol', name: 'Solana', icon: '◎', badge: 'SPL Fast', time: '~15s' },
  near: { id: 'near', name: 'NEAR', icon: 'Ⓝ', badge: 'Instant Finality', time: '~2s' },
  eth: { id: 'eth', name: 'Ethereum', icon: '⟠', badge: 'Mainnet L1', time: '~45s' },
  btc: { id: 'btc', name: 'Bitcoin', icon: '₿', badge: 'Native SegWit', time: '~1 confirmation' },
};

export const ReceivePage: React.FC = () => {
  const { hasIntentAccount, nearAccount, refreshBalances, refreshHistory } = useOnchainData();

  const [selectedToken, setSelectedToken] = useState<string>('USDC');
  const [selectedChain, setSelectedChain] = useState<string>('base');
  const [currentAddress, setCurrentAddress] = useState<DepositAddress | null>(null);
  const [isDeriving, setIsDeriving] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [showQr, setShowQr] = useState<boolean>(true);
  const [depositStatus, setDepositStatus] = useState<DepositStatusResponse | null>(null);
  const [settledSuccess, setSettledSuccess] = useState<boolean>(false);

  const pollIntervalRef = useRef<any>(null);

  // Available chains for the currently selected token
  const activeTokenObj = TOKEN_OPTIONS.find((t) => t.symbol === selectedToken) || TOKEN_OPTIONS[0];
  const availableChains = activeTokenObj.chains.map((c) => CHAIN_DEFINITIONS[c]).filter(Boolean);

  // When token changes, verify selected chain is valid for this token
  const handleSelectToken = (tokenSym: string) => {
    setSelectedToken(tokenSym);
    const tokenObj = TOKEN_OPTIONS.find((t) => t.symbol === tokenSym);
    if (tokenObj && !tokenObj.chains.includes(selectedChain)) {
      setSelectedChain(tokenObj.chains[0]);
    }
    setDepositStatus(null);
    setSettledSuccess(false);
  };

  // Derive deposit address from backend
  const loadAddress = useCallback(async (refresh = false) => {
    if (!hasIntentAccount) return;
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
  }, [hasIntentAccount, selectedChain, selectedToken]);

  // Load address on token or chain change
  useEffect(() => {
    loadAddress(false);
  }, [loadAddress]);

  // Real-time Polling for Deposit Status
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

  const activeChainDef = CHAIN_DEFINITIONS[selectedChain] || CHAIN_DEFINITIONS.base;
  const depositAddressValue = currentAddress?.address || '';
  const minAmountDisplay = currentAddress?.minAmountFormatted || (selectedToken === 'USDC' ? '0.15 USDC' : '0.10 ' + selectedToken);
  const minUsdDisplay = currentAddress?.minAmountUsd || '$0.15';

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

      {/* Header */}
      <div className="text-center space-y-2 mb-6">
        <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-stone-100 border border-stone-200 text-stone-700 text-xs font-mono font-medium mb-1">
          <Shield className="w-3.5 h-3.5 text-stone-900" />
          <span>Confidential Cross-Chain Ingress</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight">
          Receive to Private Vault
        </h1>
        <p className="text-sm text-stone-600 max-w-md mx-auto">
          Pick your token and source chain. A confidential 1-time address is generated that automatically shields funds upon arrival.
        </p>
      </div>

      {/* Main Container */}
      <div className="rounded-3xl p-6 sm:p-8 bg-white border border-stone-200 shadow-sm space-y-6 relative">
        {/* Step 1: Select Token */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">1</span>
              <span>Select Asset to Receive</span>
            </label>
            <span className="text-[11px] font-mono text-stone-400">
              {TOKEN_OPTIONS.length} tokens
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {TOKEN_OPTIONS.map((token) => {
              const isSelected = selectedToken === token.symbol;
              return (
                <button
                  key={token.symbol}
                  type="button"
                  onClick={() => handleSelectToken(token.symbol)}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center space-y-1.5 ${
                    isSelected
                      ? 'bg-black text-white border-black font-bold shadow-xs ring-2 ring-stone-900/10'
                      : 'bg-stone-50 border-stone-200 hover:bg-stone-100 text-stone-800'
                  }`}
                >
                  <TokenIcon symbol={token.symbol} size="md" />
                  <div className="w-full text-center">
                    <span className="font-mono text-xs font-bold block">{token.symbol}</span>
                    <span className={`text-[10px] truncate block ${isSelected ? 'text-stone-300' : 'text-stone-400'}`}>
                      {token.name}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Select Chain */}
        <div className="space-y-2.5 pt-2 border-t border-stone-100">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">2</span>
              <span>Select Source Blockchain</span>
            </label>
            <span className="text-[11px] font-mono text-stone-400">
              {availableChains.length} supported route{availableChains.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {availableChains.map((chain) => {
              const isSelected = selectedChain === chain.id;
              return (
                <button
                  key={chain.id}
                  type="button"
                  onClick={() => {
                    setSelectedChain(chain.id);
                    setDepositStatus(null);
                    setSettledSuccess(false);
                  }}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center space-y-1 ${
                    isSelected
                      ? 'bg-black text-white border-black font-bold shadow-xs ring-2 ring-stone-900/10'
                      : 'bg-stone-50 border-stone-200 hover:bg-stone-100 text-stone-700'
                  }`}
                >
                  <span className="text-lg">{chain.icon}</span>
                  <div className="w-full text-center">
                    <span className="font-mono text-xs font-bold block">{chain.name}</span>
                    <span className={`text-[9px] block ${isSelected ? 'text-stone-300' : 'text-stone-400'}`}>
                      {chain.time}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 3: Confidential 1-Time Address Card */}
        <div className="pt-2 border-t border-stone-100 space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 font-mono flex items-center space-x-1.5">
              <span className="w-4 h-4 rounded-full bg-black text-white text-[10px] flex items-center justify-center font-bold">3</span>
              <span>Confidential Receive Gateway</span>
            </label>
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
          </div>

          {/* 1-Time Notice Banner */}
          <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-2xl flex items-start space-x-2.5 text-xs text-amber-950">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5 font-sans leading-relaxed">
              <div className="font-bold flex items-center space-x-1.5">
                <span>Single-Use Confidential Address</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-200 text-amber-900 font-mono uppercase">
                  1-Time Ingress
                </span>
              </div>
              <p className="text-[11px] text-amber-900">
                This address is ephemeral and generated exclusively for receiving <strong className="font-semibold">{selectedToken}</strong> on <strong className="font-semibold">{activeChainDef.name}</strong>. Funds are automatically bridged and shielded into your confidential passkey vault upon receipt.
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
                    <span>Network: {activeChainDef.name}</span>
                    <span>Expected finality: {activeChainDef.time}</span>
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

                {/* QR Code */}
                {showQr && depositAddressValue && (
                  <div className="p-4 bg-white rounded-2xl border border-stone-200 flex flex-col items-center justify-center animate-fade-in shadow-2xs">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                        depositAddressValue
                      )}`}
                      alt="Deposit QR"
                      className="w-36 h-36 object-contain"
                    />
                    <span className="text-[11px] text-stone-500 font-mono mt-2.5">
                      Scan to deposit {selectedToken} on {activeChainDef.name}
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
                    <span>{showQr ? 'Hide QR' : 'Show QR'}</span>
                  </button>
                  <span className="text-[11px] text-stone-400">
                    Expires in ~3 days
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Step 4: Real-time Live Deposit Tracker */}
        {depositAddressValue && (
          <div className="pt-2 border-t border-stone-100 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 font-mono flex items-center space-x-1.5">
                <Radio className="w-3.5 h-3.5 text-stone-900 animate-pulse" />
                <span>Live Deposit Tracker</span>
              </label>
              <span className="text-[11px] font-mono text-stone-400 flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>Monitoring {activeChainDef.name}</span>
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
                  Received <strong className="font-bold">{depositStatus?.depositedAmountFormatted} {selectedToken}</strong> on {activeChainDef.name}. Solver network is executing settlement into your vault.
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
                  <strong className="text-stone-900 font-semibold">{activeChainDef.name}</strong>.
                  <span className="text-stone-400 block text-[11px] font-mono mt-0.5">
                    Send at least {minAmountDisplay} to the address above.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Explainer */}
        <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-700 space-y-1.5 leading-relaxed">
          <div className="flex items-center space-x-1.5 font-bold text-stone-900">
            <Info className="w-3.5 h-3.5 text-stone-900" />
            <span>How Confidential Intents Custody Works</span>
          </div>
          <p>
            When you transfer to the ephemeral gateway, the NEAR Intents solver network detects the transaction on {activeChainDef.name}, confirms economic finality, and credits the balance to your hardware passkey vault (<span className="font-mono text-stone-900 font-semibold">{nearAccount || 'u_...uprail.near'}</span>). Zero seed phrases, non-custodial, and 100% private.
          </p>
        </div>
      </div>
    </div>
  );
};
