'use client';

import React, { useState, useEffect } from 'react';
import { Link } from '../lib/router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Fingerprint,
  Eye,
  EyeOff,
  Copy,
  Check,
  QrCode,
  Shield,
  RefreshCw,
  Zap,
  ArrowRight,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { usePayments } from '../hooks/usePayments';
import { useXAuth } from '../hooks/useXAuth';
import { useOnchainData } from '../hooks/useOnchainData';
import { api } from '../lib/api';
import type { PaymentIntent } from '../types';
import type { DepositAddress } from '../lib/onchainApi';
import { XAuthBanner } from '../components/XAuthBanner';

export const AppHome: React.FC = () => {
  const { user } = useXAuth();
  const {
    history,
    loadHistory,
    isLoadingHistory,
  } = usePayments();

  const {
    balances,
    totalBalanceUsd,
    nearAccount,
    hasIntentAccount,
    isLoadingBalances,
    depositAddresses,
    getDepositAddress,
    isLoadingAddresses,
    refreshDepositAddress,
    transactions,
    isLoadingHistory: isLoadingOnchainHistory,
    refreshHistory,
    refresh,
    error: onchainError,
  } = useOnchainData();

  const [hideBalance, setHideBalance] = useState<boolean>(false);
  const [selectedChain, setSelectedChain] = useState<string>('near');
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);
  const [showQrCode, setShowQrCode] = useState(false);
  const [isRefreshingAddr, setIsRefreshingAddr] = useState(false);
  const [pendingPayments, setPendingPayments] = useState<PaymentIntent[]>([]);

  // Load payment history and pending claims on mount
  useEffect(() => {
    loadHistory();
    api.getPendingPayments().then((p) => setPendingPayments(p || []));
  }, [loadHistory]);

  // Current deposit address for selected chain (always from onchain — never hardcoded)
  const currentDepositAddr: DepositAddress | undefined = getDepositAddress(selectedChain);
  const depositAddressValue = currentDepositAddr?.address || '';

  const handleCopyDepositAddress = () => {
    if (!depositAddressValue) return;
    navigator.clipboard.writeText(depositAddressValue);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleRefreshDepositAddress = async () => {
    setIsRefreshingAddr(true);
    try {
      await refreshDepositAddress(selectedChain);
    } finally {
      setIsRefreshingAddr(false);
    }
  };

  const handleCopyTxLink = (claimLink: string, id: string) => {
    navigator.clipboard.writeText(claimLink);
    setCopiedTxId(id);
    setTimeout(() => setCopiedTxId(null), 2000);
  };

  // Collect unique chains from live deposit addresses
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

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">

        {/* ── LEFT COLUMN: Balance, Quick Actions, Receive via Intents ── */}
        <div className="lg:col-span-7 space-y-6">

          {/* 𝕏 Authentication Notice (if unauthenticated) */}
          {!user && (
            <XAuthBanner
              title="Connect 𝕏 to Activate Your Vault"
              description="Your confidential intent vault is bound to your verified 𝕏 handle. Connect with 𝕏 to query live onchain balances, send private payments, and claim incoming transfers."
              actionText="Connect 𝕏"
            />
          )}

          {/* Balance Hero Card — live from onchain intent account */}
          <div className="rounded-3xl p-6 sm:p-7 bg-white border border-stone-200 shadow-xs space-y-4 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-stone-500 font-bold flex items-center space-x-1.5">
                <Shield className="w-3.5 h-3.5 text-stone-900" />
                <span>Intent Account Vault</span>
                {nearAccount && (
                  <span className="ml-1 text-stone-400 font-normal normal-case truncate max-w-[120px]">
                    · {nearAccount}
                  </span>
                )}
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => refresh()}
                  disabled={isLoadingBalances}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer"
                  title="Refresh live balance"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBalances ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setHideBalance(!hideBalance)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer"
                  title={hideBalance ? 'Show balance' : 'Hide balance'}
                >
                  {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Big Balance Number */}
            <div className="space-y-1">
              {isLoadingBalances ? (
                <div className="flex items-center space-x-2 py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
                  <span className="text-sm font-mono text-stone-400">Loading onchain balance...</span>
                </div>
              ) : (
                <div className="text-4xl sm:text-5xl font-display font-extrabold text-stone-950 tracking-tight">
                  {hideBalance ? '••••••••' : `$${totalBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </div>
              )}
              <div className="flex items-center space-x-2 text-xs font-mono text-stone-500">
                <span className="w-1.5 h-1.5 rounded-full bg-stone-900" />
                <span>
                  {hasIntentAccount
                    ? 'Live · Confidential Intents · Passkey Protected'
                    : 'No intent account yet — register a passkey to create yours'}
                </span>
              </div>
            </div>

            {/* Live asset breakdown from onchain */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-100">
              {onchainError ? (
                <span className="text-xs font-mono text-red-500 flex items-center space-x-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{onchainError}</span>
                </span>
              ) : balances.length > 0 ? (
                balances.map((b) => (
                  <span
                    key={b.defuse_asset_id}
                    className="px-2.5 py-1 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono font-medium text-stone-700"
                    title={b.defuse_asset_id}
                  >
                    {b.amountFormatted} {b.symbol}
                  </span>
                ))
              ) : (
                <span className="text-xs font-mono text-stone-400 py-0.5">
                  {isLoadingBalances ? 'Fetching onchain balances...' : 'No balances yet in your intent account'}
                </span>
              )}
            </div>
          </div>

          {/* Incoming Claim Notification Banner (Auto-discovered payments waiting!) */}
          {pendingPayments.length > 0 && (
            <Link
              to="/app/claim"
              className="p-4 rounded-3xl bg-stone-900 text-white border border-stone-800 shadow-md flex items-center justify-between hover:bg-black transition-all group cursor-pointer animate-fade-in"
            >
              <div className="flex items-center space-x-3.5">
                <div className="w-10 h-10 rounded-2xl bg-white text-stone-900 flex items-center justify-center font-bold">
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold font-display flex items-center space-x-2">
                    <span>{pendingPayments.length} incoming payment{pendingPayments.length > 1 ? 's' : ''} ready to claim</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <div className="text-[11px] text-stone-300 font-mono mt-0.5">
                    ≈ ${pendingPayments.reduce((acc, p) => acc + (p.amountUsd || 0), 0).toFixed(2)} USD · Tap to claim with your device Passkey
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </Link>
          )}

          {/* Quick Action Buttons */}
          <div className="grid grid-cols-3 gap-3">
            <Link
              to="/app/send"
              className="py-4 px-3 rounded-2xl border border-stone-200 bg-white hover:border-black text-center transition-all flex flex-col items-center justify-center space-y-1 shadow-xs hover:shadow-sm group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-stone-100 text-stone-900 flex items-center justify-center group-hover:scale-105 transition-transform">
                <ArrowUpRight className="w-5 h-5" />
              </div>
              <span className="text-xs font-display font-bold uppercase tracking-wider text-stone-900 group-hover:text-black transition-colors">
                Send
              </span>
              <span className="text-[10px] font-mono text-stone-400">
                𝕏 & Wallets
              </span>
            </Link>

            <Link
              to="/app/receive"
              className="py-4 px-3 rounded-2xl border border-stone-200 bg-white hover:border-black text-center transition-all flex flex-col items-center justify-center space-y-1 shadow-xs hover:shadow-sm group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-stone-100 text-stone-900 flex items-center justify-center group-hover:scale-105 transition-transform">
                <ArrowDownLeft className="w-5 h-5" />
              </div>
              <span className="text-xs font-display font-bold uppercase tracking-wider text-stone-900 group-hover:text-black transition-colors">
                Receive
              </span>
              <span className="text-[10px] font-mono text-stone-400">
                Any Chain
              </span>
            </Link>

            <Link
              to="/app/claim"
              className="py-4 px-3 rounded-2xl border border-stone-200 bg-white hover:border-black text-center transition-all flex flex-col items-center justify-center space-y-1 shadow-xs hover:shadow-sm group cursor-pointer relative"
            >
              {pendingPayments.length > 0 && (
                <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-stone-900 text-white text-[9px] font-mono font-bold animate-pulse">
                  {pendingPayments.length}
                </span>
              )}
              <div className="w-10 h-10 rounded-xl bg-stone-100 text-stone-900 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Fingerprint className="w-5 h-5" />
              </div>
              <span className="text-xs font-display font-bold uppercase tracking-wider text-stone-900 group-hover:text-black transition-colors">
                Claim
              </span>
              <span className="text-[10px] font-mono text-stone-400">
                {pendingPayments.length > 0 ? `${pendingPayments.length} Waiting` : 'Passkey'}
              </span>
            </Link>
          </div>

          {/* Receive Through Intents — live onchain deposit addresses */}
          <div className="rounded-3xl p-6 bg-white border border-stone-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-stone-950 text-sm flex items-center space-x-1.5">
                <span>Receive via Intents</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-stone-100 text-stone-800">
                  1CLICK
                </span>
              </h3>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-mono text-stone-400">Settles in ~3s</span>
                {isLoadingAddresses && <Loader2 className="w-3 h-3 animate-spin text-stone-400" />}
              </div>
            </div>

            {/* Chain Selector — populated from live onchain supported chains */}
            <div className="flex flex-wrap gap-2">
              {availableChains.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedChain(c.id)}
                  className={`px-3 py-1.5 rounded-xl border text-center transition-all cursor-pointer text-xs font-mono flex items-center space-x-1 ${
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

            {/* Deposit Address — ALWAYS pulled fresh from onchain */}
            <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-stone-600 font-bold">
                  {availableChains.find((c) => c.id === selectedChain)?.name || selectedChain} Gateway
                </span>
                <div className="flex items-center space-x-1 text-[10px] text-stone-400">
                  <Zap className="w-3 h-3 text-stone-700" />
                  <span>Auto-Shielded</span>
                </div>
              </div>

              {!hasIntentAccount ? (
                <div className="text-xs font-mono text-stone-500 py-2 text-center">
                  Register a passkey to get your deposit addresses
                </div>
              ) : isLoadingAddresses && !depositAddressValue ? (
                <div className="flex items-center space-x-2 text-xs font-mono text-stone-400 py-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Fetching onchain deposit address...</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      readOnly
                      value={depositAddressValue || 'Loading address...'}
                      className="flex-1 bg-white rounded-xl px-3 py-2 text-xs text-stone-900 font-mono border border-stone-200 focus:outline-none select-all"
                    />
                    <button
                      type="button"
                      onClick={handleCopyDepositAddress}
                      disabled={!depositAddressValue}
                      className="px-3.5 py-2 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1 disabled:opacity-40"
                    >
                      {copiedAddress ? (
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

                  {currentDepositAddr?.memo && (
                    <div className="text-[10px] font-mono text-stone-500 bg-stone-100 rounded-lg px-2 py-1">
                      Memo: <span className="font-bold text-stone-700">{currentDepositAddr.memo}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-0.5 text-xs">
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setShowQrCode(!showQrCode)}
                        className="text-xs text-stone-900 hover:underline font-mono font-bold flex items-center space-x-1 cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>{showQrCode ? 'Hide QR' : 'Show QR'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleRefreshDepositAddress}
                        disabled={isRefreshingAddr}
                        className="text-xs text-stone-500 hover:text-stone-900 font-mono flex items-center space-x-1 cursor-pointer"
                        title="Deposit addresses are ephemeral — refresh to get the latest"
                      >
                        <RefreshCw className={`w-3 h-3 ${isRefreshingAddr ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                      </button>
                    </div>

                    <Link
                      to="/app/receive"
                      className="text-[11px] font-mono text-stone-500 hover:text-black flex items-center space-x-0.5"
                    >
                      <span>Dedicated View</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>

                  {showQrCode && depositAddressValue && (
                    <div className="p-3 bg-white rounded-xl border border-stone-200 flex flex-col items-center justify-center animate-fade-in mt-2">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                          depositAddressValue
                        )}`}
                        alt="Deposit QR"
                        className="w-28 h-28 object-contain"
                      />
                      <span className="text-[10px] text-stone-400 font-mono mt-1">
                        Scan to send {availableChains.find((c) => c.id === selectedChain)?.name} assets
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            <p className="text-[10px] font-mono text-stone-400 text-center">
              ⚠️ Deposit addresses are ephemeral — always copy fresh before sending
            </p>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Live Transactions ── */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-3xl p-5 sm:p-6 bg-white border border-stone-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center space-x-2">
                <h3 className="font-display font-extrabold text-stone-950 text-base">
                  Transactions
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-bold">
                  {history.length + transactions.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => { loadHistory(); refreshHistory(); }}
                disabled={isLoadingHistory || isLoadingOnchainHistory}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg hover:bg-stone-50 transition-colors cursor-pointer"
                title="Refresh transactions"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${(isLoadingHistory || isLoadingOnchainHistory) ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Simple hairline list — intent history takes priority */}
            <div className="divide-y divide-stone-100">
              {isLoadingOnchainHistory ? (
                <div className="py-8 text-center text-xs text-stone-400 font-mono flex items-center justify-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Fetching onchain history...</span>
                </div>
              ) : history.length === 0 && transactions.length === 0 ? (
                <div className="py-12 text-center text-xs text-stone-400 font-mono">
                  No activity yet.
                </div>
              ) : (
                history.map((tx) => {
                  const isSent = Boolean(user?.handle && tx.senderHandle && tx.senderHandle.toLowerCase() === user.handle.toLowerCase());
                  return (
                    <div
                      key={tx.id}
                      className="py-3 flex items-center justify-between hover:bg-stone-50/70 rounded-xl px-2 transition-colors group"
                    >
                      <div className="flex items-center space-x-2.5">
                        <div className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 bg-stone-100 text-stone-800">
                          {isSent ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-stone-900 font-mono">
                            {isSent ? `@${tx.recipientHandle}` : `@${tx.senderHandle}`}
                          </div>
                          <div className="text-[10px] text-stone-400 font-mono truncate max-w-[120px] sm:max-w-[160px]">
                            {tx.memo || new Date(tx.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <div className="text-right">
                          <div className="text-xs font-mono font-bold text-stone-900">
                            {isSent ? '-' : '+'}{tx.amount} {tx.token.symbol}
                          </div>
                          <span className="text-[9px] font-mono uppercase font-bold px-1.5 py-0.2 rounded text-stone-600 bg-stone-100 border border-stone-200">
                            {tx.status}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyTxLink(tx.claimLink, tx.id)}
                          className="p-1 rounded-lg text-stone-300 hover:text-black hover:bg-stone-100 transition-colors cursor-pointer"
                          title="Copy claim link"
                        >
                          {copiedTxId === tx.id ? (
                            <Check className="w-3.5 h-3.5 text-stone-900" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-2 border-t border-stone-100 text-center">
              <Link
                to="/app/history"
                className="inline-flex items-center space-x-1 text-xs font-mono font-bold text-stone-900 hover:text-black transition-colors"
              >
                <span>Full Ledger</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
