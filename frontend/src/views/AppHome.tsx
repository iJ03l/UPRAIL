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
  Shield,
  RefreshCw,
  ArrowRight,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { usePayments } from '../hooks/usePayments';
import { useXAuth } from '../hooks/useXAuth';
import { useOnchainData } from '../hooks/useOnchainData';
import { api } from '../lib/api';
import type { PaymentIntent } from '../types';

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
    transactions,
    isLoadingHistory: isLoadingOnchainHistory,
    refreshHistory,
    refresh,
    error: onchainError,
  } = useOnchainData();

  const [hideBalance, setHideBalance] = useState<boolean>(false);
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);
  const [pendingPayments, setPendingPayments] = useState<PaymentIntent[]>([]);

  // Load payment history and pending claims on mount
  useEffect(() => {
    loadHistory();
    api.getPendingPayments().then((p) => setPendingPayments(p || []));
  }, [loadHistory]);

  const handleCopyTxLink = (claimLink: string, id: string) => {
    navigator.clipboard.writeText(claimLink);
    setCopiedTxId(id);
    setTimeout(() => setCopiedTxId(null), 2000);
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">

        {/* ── LEFT COLUMN: Balance, Quick Actions, Receive via Intents ── */}
        <div className="lg:col-span-7 space-y-6">

          {/* Balance Hero Card — live from onchain intent account */}
          <div className="rounded-3xl p-7 sm:p-9 md:p-10 bg-white border border-stone-200 shadow-xs space-y-6 relative">
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
