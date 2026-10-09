'use client';

import React, { useState, useEffect } from 'react';
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
  KeyRound,
  ExternalLink,
} from 'lucide-react';
import { useOnchainData } from '../hooks/useOnchainData';

export const ReceivePage: React.FC = () => {
  const {
    depositAddresses,
    getDepositAddress,
    isLoadingAddresses,
    refreshDepositAddress,
    hasIntentAccount,
    nearAccount,
  } = useOnchainData();

  const [selectedChain, setSelectedChain] = useState<string>('eth');
  const [copied, setCopied] = useState(false);
  const [copiedVault, setCopiedVault] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const availableChains = [
    { id: 'eth', name: 'Ethereum', icon: '⟠', badge: 'ERC-20 / Native' },
    { id: 'btc', name: 'Bitcoin', icon: '₿', badge: 'Native SegWit' },
    { id: 'sol', name: 'Solana', icon: '◎', badge: 'SPL / Native' },
    { id: 'base', name: 'Base', icon: '🔵', badge: 'L2 Sub-Cent' },
    { id: 'arbitrum', name: 'Arbitrum', icon: '🔷', badge: 'L2 Rollup' },
    { id: 'near', name: 'NEAR', icon: 'Ⓝ', badge: 'Fast Finality' },
    { id: 'robinhood', name: 'Robinhood', icon: '🪶', badge: 'Crypto Gateway' },
  ];

  const currentAddr = getDepositAddress(selectedChain);
  const depositAddressValue = currentAddr?.address || '';

  // Auto-fetch if selected chain address is not loaded yet
  useEffect(() => {
    if (hasIntentAccount && !depositAddressValue && !isRefreshing && !isLoadingAddresses) {
      setIsRefreshing(true);
      refreshDepositAddress(selectedChain).finally(() => setIsRefreshing(false));
    }
  }, [selectedChain, hasIntentAccount, depositAddressValue, isRefreshing, isLoadingAddresses, refreshDepositAddress]);

  const handleCopy = () => {
    if (!depositAddressValue) return;
    navigator.clipboard.writeText(depositAddressValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyVault = () => {
    if (!nearAccount) return;
    navigator.clipboard.writeText(nearAccount);
    setCopiedVault(true);
    setTimeout(() => setCopiedVault(false), 2000);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshDepositAddress(selectedChain);
    } finally {
      setIsRefreshing(false);
    }
  };

  const chainDescriptions: Record<string, string> = {
    eth: 'Send native ETH or ERC-20 tokens (e.g. USDC, USDT) directly from MetaMask, Coinbase, Rainbow, or any Ethereum wallet.',
    btc: 'Send BTC directly from Coinbase, Cash App, Ledger, Trezor, or any Bitcoin wallet using Native SegWit.',
    sol: 'Send SOL or SPL tokens directly from Phantom, Solflare, Backpack, or any Solana exchange.',
    base: 'Send Base ETH or USDC directly from Coinbase, MetaMask, or any Base wallet with near-zero gas fees.',
    arbitrum: 'Send Arbitrum ETH or USDC directly from any Arbitrum One wallet or exchange.',
    near: 'Send NEAR or NEP-141 tokens from Binance, Bybit, OKX, Meteor, or HERE wallet.',
    robinhood: 'Direct bridge gateway for Robinhood Crypto withdrawals.',
  };

  const chainSettlementTime: Record<string, string> = {
    eth: '~45 seconds (EVM finality)',
    btc: '~1 confirmation (Bitcoin mempool)',
    sol: '~20 seconds (Solana fast bridge)',
    base: '~15 seconds (Base L2)',
    arbitrum: '~15 seconds (Arbitrum L2)',
    near: '~3 seconds (Instant NEAR finality)',
    robinhood: '~30 seconds (Robinhood Gateway)',
  };

  return (
    <div className="w-full space-y-6">
      {/* Back Link */}
      <Link
        to="/app"
        className="inline-flex items-center space-x-1.5 text-xs font-mono text-stone-500 hover:text-black transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Home</span>
      </Link>

      {/* Page Title */}
      <div className="text-center space-y-2 mb-6">
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight">
          Receive from Any Chain
        </h1>
        <p className="text-sm text-stone-600 max-w-md mx-auto">
          Deposit tokens from any wallet or exchange. NEAR Intents automatically routes and shields it directly into your passkey-bound vault.
        </p>
      </div>

      {/* Custody Vault Status Card */}
      <div className="rounded-3xl p-5 sm:p-6 bg-stone-900 text-white border border-stone-800 space-y-3 relative overflow-hidden shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Shield className="w-3 h-3 mr-1" />
                Hardware Custody Vault Active
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-stone-800 text-stone-300 border border-stone-700">
                <KeyRound className="w-3 h-3 mr-1" />
                Passkey P-256
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-bold font-display tracking-tight text-white flex items-center space-x-2">
              <span>Your Confidential Intent Vault</span>
            </h2>
          </div>

          {nearAccount && (
            <div className="flex items-center space-x-2 bg-stone-950/80 p-2 rounded-2xl border border-stone-800 self-start sm:self-auto">
              <span className="font-mono text-xs text-stone-300 px-1 truncate max-w-[200px] sm:max-w-[240px]">
                {nearAccount}
              </span>
              <button
                type="button"
                onClick={handleCopyVault}
                className="p-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 transition-colors cursor-pointer"
                title="Copy Vault Account ID"
              >
                {copiedVault ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-stone-400 leading-relaxed">
          Your vault is 100% self-custodial on the NEAR Intents settlement layer. Deposits from any external network below are swept by solvers and auto-shielded directly into this account.
        </p>
      </div>

      {/* Main Card */}
      <div className="rounded-3xl p-6 sm:p-8 shadow-xs bg-white border border-stone-200 space-y-6 relative">
        {/* Chain Selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block">
              Select Source Network
            </label>
            <span className="text-[11px] font-mono text-stone-400">
              {availableChains.length} networks supported
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {availableChains.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedChain(c.id)}
                className={`p-3 rounded-2xl border text-center transition-all cursor-pointer text-xs font-mono flex flex-col items-center justify-center space-y-1 ${
                  selectedChain === c.id
                    ? 'bg-black text-white border-black font-bold shadow-xs ring-2 ring-stone-900/10'
                    : 'bg-stone-50 border-stone-200 hover:bg-stone-100 text-stone-700'
                }`}
              >
                <span className="text-base">{c.icon}</span>
                <span className="truncate w-full text-center">{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Intent Deposit Address Box */}
        <div className="p-5 sm:p-6 rounded-2xl bg-stone-50 border border-stone-200 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-stone-900 font-mono flex items-center space-x-1.5">
              <span>{availableChains.find((c) => c.id === selectedChain)?.name} Gateway</span>
              <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-stone-200/60 text-stone-600">
                {availableChains.find((c) => c.id === selectedChain)?.badge}
              </span>
            </span>

            <div className="flex items-center space-x-2">
              <span className="text-emerald-700 font-mono text-[11px] font-bold flex items-center space-x-1 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                <Shield className="w-3 h-3 text-emerald-600" />
                <span>Auto-Shielded</span>
              </span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="text-stone-400 hover:text-stone-700 transition-colors p-1"
                title="Refresh deposit address"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

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
          ) : (isLoadingAddresses || isRefreshing) && !depositAddressValue ? (
            <div className="py-10 flex flex-col items-center justify-center space-y-2 text-stone-500 font-mono text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-stone-900" />
              <span>Generating live gateway deposit address onchain...</span>
            </div>
          ) : (
            <>
              {/* Address Field */}
              <div className="space-y-1.5">
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={depositAddressValue || 'Generating onchain gateway address...'}
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

                <p className="text-[11px] font-mono text-stone-500">
                  {chainDescriptions[selectedChain] || 'Send assets directly to this gateway address.'}
                </p>
              </div>

              {/* Memo Note if specifically required */}
              {currentAddr?.memo && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-mono text-amber-900 flex items-start space-x-2">
                  <Info className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Required Memo / Tag:</span>{' '}
                    <span className="font-bold underline">{currentAddr.memo}</span>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      You must include this memo in your transfer or funds will not route.
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
                    className="w-40 h-40 object-contain"
                  />
                  <span className="text-[11px] text-stone-500 font-mono mt-3">
                    Scan with mobile wallet or exchange app to deposit
                  </span>
                </div>
              )}

              {/* Toggle QR & Settlement Time */}
              <div className="flex items-center justify-between text-xs text-stone-500 pt-1 border-t border-stone-200/60">
                <button
                  type="button"
                  onClick={() => setShowQr(!showQr)}
                  className="text-stone-900 hover:underline font-mono font-bold flex items-center space-x-1 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>{showQr ? 'Hide QR Code' : 'Show QR Code'}</span>
                </button>
                <span className="font-mono text-[11px]">
                  Settlement: {chainSettlementTime[selectedChain] || '~15 seconds'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Explainer: How Cross-Chain Settlement Works */}
        <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-700 space-y-1.5 leading-relaxed">
          <div className="flex items-center space-x-1.5 font-bold text-stone-900">
            <Info className="w-3.5 h-3.5 text-stone-900" />
            <span>How NEAR Intents Custody Works</span>
          </div>
          <p>
            When you transfer funds to the gateway address above, the NEAR Intents solver network detects the transaction on the source blockchain (Ethereum, Bitcoin, Solana, etc.), verifies settlement, and credits the balance to your confidential passkey vault. You retain 100% hardware-authenticated control with zero seed phrases.
          </p>
        </div>
      </div>
    </div>
  );
};
