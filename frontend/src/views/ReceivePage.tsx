'use client';

import React, { useState } from 'react';
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

  const [selectedChain, setSelectedChain] = useState<string>('near');
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fallback chain list if none loaded yet
  const availableChains = depositAddresses.length > 0
    ? depositAddresses.map((a) => ({
        id: a.chain,
        name: a.chainName || a.chain,
      }))
    : [
        { id: 'near', name: 'NEAR' },
        { id: 'eth', name: 'Ethereum' },
        { id: 'sol', name: 'Solana' },
        { id: 'btc', name: 'Bitcoin' },
        { id: 'base', name: 'Base' },
        { id: 'arbitrum', name: 'Arbitrum' },
        { id: 'robinhood', name: 'Robinhood' },
      ];

  const chainIcons: Record<string, string> = {
    near: 'Ⓝ',
    eth: '⟠',
    ethereum: '⟠',
    sol: '◎',
    solana: '◎',
    btc: '₿',
    bitcoin: '₿',
    base: '🔵',
    arbitrum: '🔷',
    robinhood: '🪶',
    hood: '🪶',
    bnb: '🟡',
    polygon: '🟣',
    avalanche: '🔺',
    optimism: '🔴',
  };

  const currentAddr = getDepositAddress(selectedChain);
  const depositAddressValue = currentAddr?.address || '';

  const handleCopy = () => {
    if (!depositAddressValue) return;
    navigator.clipboard.writeText(depositAddressValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshDepositAddress(selectedChain);
    } finally {
      setIsRefreshing(false);
    }
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

      {/* Main Card */}
      <div className="rounded-3xl p-6 sm:p-8 shadow-xs bg-white border border-stone-200 space-y-6 relative">

        {/* Chain Selector — pulled live from onchain available chains */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block">
              Select Source Network
            </label>
            <span className="text-[11px] font-mono text-stone-400">
              {availableChains.length} chains supported
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {availableChains.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedChain(c.id)}
                className={`px-3.5 py-2 rounded-2xl border text-center transition-all cursor-pointer text-xs font-mono flex items-center space-x-1.5 ${
                  selectedChain === c.id
                    ? 'bg-black text-white border-black font-bold shadow-xs'
                    : 'bg-stone-50 border-stone-200 hover:bg-stone-100 text-stone-700'
                }`}
              >
                <span>{chainIcons[c.id.toLowerCase()] || '⬡'}</span>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Intent Deposit Address Box — PULLED LIVE ONCHAIN */}
        <div className="p-5 rounded-2xl bg-stone-50 border border-stone-200 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-stone-800 font-mono flex items-center space-x-1.5">
              <span>{availableChains.find((c) => c.id === selectedChain)?.name || selectedChain} Gateway</span>
              {nearAccount && (
                <span className="text-stone-400 font-normal">({nearAccount})</span>
              )}
            </span>
            <div className="flex items-center space-x-2">
              <span className="text-stone-700 font-mono font-bold flex items-center space-x-1">
                <Shield className="w-3.5 h-3.5" />
                <span>Auto-Shielded</span>
              </span>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="text-stone-400 hover:text-stone-700 transition-colors p-1"
                title="Refresh deposit address (ephemeral)"
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
          ) : isLoadingAddresses && !depositAddressValue ? (
            <div className="py-8 flex flex-col items-center justify-center space-y-2 text-stone-400 font-mono text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-stone-900" />
              <span>Fetching live onchain gateway address...</span>
            </div>
          ) : (
            <>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={depositAddressValue || 'Fetching address from onchain...'}
                  className="flex-1 bg-white rounded-xl px-3.5 py-3 text-xs text-stone-900 font-mono border border-stone-200 focus:outline-none select-all"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!depositAddressValue}
                  className="px-4 py-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1 disabled:opacity-40"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
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

              {currentAddr?.memo && (
                <div className="p-2.5 bg-stone-100 rounded-xl text-xs font-mono text-stone-600">
                  Required Memo / Tag: <span className="font-bold text-stone-900">{currentAddr.memo}</span>
                </div>
              )}

              {/* QR Code */}
              {showQr && depositAddressValue && (
                <div className="p-4 bg-white rounded-2xl border border-stone-200 flex flex-col items-center justify-center animate-fade-in">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                      depositAddressValue
                    )}`}
                    alt="Deposit QR"
                    className="w-36 h-36 object-contain"
                  />
                  <span className="text-[11px] text-stone-500 font-mono mt-2">
                    Scan with mobile wallet to send {availableChains.find((c) => c.id === selectedChain)?.name} assets
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-stone-500 pt-1">
                <button
                  type="button"
                  onClick={() => setShowQr(!showQr)}
                  className="text-stone-900 hover:underline font-mono font-bold flex items-center space-x-1 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>{showQr ? 'Hide QR Code' : 'Show QR Code'}</span>
                </button>
                <span className="font-mono text-[11px]">Settles in ~3 seconds</span>
              </div>
            </>
          )}
        </div>

        {/* Ephemeral Warning */}
        <div className="p-3.5 rounded-2xl bg-stone-100 border border-stone-200 text-xs text-stone-700 flex items-start space-x-2.5">
          <AlertTriangle className="w-4 h-4 text-stone-900 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-bold text-stone-900">Ephemeral Deposit Addresses</span>
            <p className="text-[11px] text-stone-600 leading-relaxed">
              Deposit addresses are generated per-user by NEAR Intents solvers and are not permanent. Always copy a fresh address right before depositing.
            </p>
          </div>
        </div>

        {/* How It Works Explainer */}
        <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-700 space-y-1.5 leading-relaxed">
          <div className="flex items-center space-x-1.5 font-bold text-stone-900">
            <Info className="w-3.5 h-3.5 text-stone-900" />
            <span>How Intents Work</span>
          </div>
          <p>
            Send tokens from Robinhood, Coinbase, Binance, Phantom, MetaMask, or any exchange. NEAR Intents detects the incoming deposit, executes a cross-chain solver settlement, and locks the balance into your device-bound passkey vault.
          </p>
        </div>
      </div>
    </div>
  );
};
