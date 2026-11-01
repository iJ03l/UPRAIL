'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  ExternalLink,
} from 'lucide-react';
import { usePayments } from '../hooks/usePayments';
import { useXAuth } from '../hooks/useXAuth';
import { useOnchainData, balanceUsd } from '../hooks/useOnchainData';
import {
  api,
  cleanMemeSymbol,
  formatCompactAmount,
  formatTokenAmount,
  formatRecipientDisplay,
  formatUsd,
  formatUsdCompact,
  sumUsd,
} from '../lib/api';
import type { PaymentIntent } from '../types';
import { FlowPulseWidget } from '../components/FlowPulseWidget';
import { NearcomWithdrawModal } from '../components/NearcomWithdrawModal';
import { RollingNumber } from '../components/RollingNumber';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { cancellationReason, historyStatusLabel } from '../lib/statusLabels';

export const AppHome: React.FC = () => {
  const { user } = useXAuth();
  const { toast } = useToast();
  const {
    tokens: paymentTokens,
    history,
    loadHistory,
    isLoadingHistory,
  } = usePayments();

  const {
    balances,
    tokens,
    totalBalanceUsd,
    unpricedBalanceCount,
    nearAccount,
    hasIntentAccount,
    isLoadingBalances,
    accountError,
    balancesError,
    transactions,
    isLoadingHistory: isLoadingOnchainHistory,
    refreshHistory,
    refresh,
    refreshBalances,
    error: onchainError,
  } = useOnchainData();

  const [hideBalance, setHideBalance] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState<boolean>(false);

  const handleManualRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        refresh(),
        refreshBalances(),
        refreshHistory(),
        loadHistory(),
        api.getPendingPayments().then((p) => setPendingPayments(p || [])),
      ]);
    } catch (err) {
      console.warn('Manual refresh notice:', err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // First visit has nothing cached: show skeletons. A cached refresh keeps the
  // last numbers on screen and only swaps them when the fresh data lands.
  const isFirstLoad = isLoadingBalances && totalBalanceUsd === null && balances.length === 0;
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);
  const [pendingPayments, setPendingPayments] = useState<PaymentIntent[]>([]);

  // Received-payment notifications. Direct sends land straight in the vault
  // (no claim step), so the recipient is told here instead. Derived from the
  // payments table — no schema change — with a local "seen" marker.
  const RECEIPTS_SEEN_KEY = 'uprail_seen_receipts';
  const [seenReceiptIds, setSeenReceiptIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(RECEIPTS_SEEN_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const receivedReceipts = useMemo(() => {
    if (!user?.handle) return [];
    const h = user.handle.toLowerCase();
    return history
      .filter((p) => p.recipientHandle?.replace(/^@/, '').toLowerCase() === h)
      .filter((p) => p.isDirect || p.status === 'claimed')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [history, user?.handle]);

  const unseenReceipts = receivedReceipts.filter((p) => !seenReceiptIds.includes(p.id));

  const dismissReceipts = () => {
    const ids = Array.from(new Set([...seenReceiptIds, ...receivedReceipts.map((p) => p.id)]));
    setSeenReceiptIds(ids);
    try {
      window.localStorage.setItem(RECEIPTS_SEEN_KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  };
  // One automatic provisioning retry: a fresh signup can land here before the
  // background account creation settles. Manual retry stays on the button.
  const autoRetried = React.useRef(false);
  useEffect(() => {
    if (
      !autoRetried.current &&
      !isLoadingBalances &&
      !hasIntentAccount &&
      user?.hasPasskey === true
    ) {
      autoRetried.current = true;
      const id = window.setTimeout(() => void refreshBalances(), 8000);
      return () => window.clearTimeout(id);
    }
  }, [isLoadingBalances, hasIntentAccount, user, refreshBalances]);

  // Load payment history and pending claims on mount
  useEffect(() => {
    loadHistory();
    api.getPendingPayments().then((p) => setPendingPayments(p || []));
  }, [loadHistory]);

  const handleCopyTxLink = (claimLink: string, id: string) => {
    navigator.clipboard.writeText(claimLink);
    setCopiedTxId(id);
    toast('Copied to clipboard');
    setTimeout(() => setCopiedTxId(null), 2000);
  };

  const recentActivity = useMemo(() => {
    type UnifiedActivity = {
      id: string;
      type: 'payment' | 'deposit' | 'withdrawal';
      isSent: boolean;
      title: string;
      subtitle: string;
      reason?: string | null;
      amount: string;
      symbol: string;
      status: string;
      timestamp: number;
      copyValue?: string;
      copyTitle?: string;
      explorerUrl?: string;
    };

    const list: UnifiedActivity[] = [];

    for (const p of history) {
      const isSent = Boolean(
        user?.handle && p.senderHandle && p.senderHandle.toLowerCase() === user.handle.toLowerCase()
      );
      list.push({
        id: p.id,
        type: 'payment',
        isSent,
        title: isSent ? formatRecipientDisplay(p.recipientHandle) : `@${p.senderHandle}`,
        subtitle: p.memo || new Date(p.createdAt).toLocaleDateString(),
        reason:
          p.status === 'cancelled'
            ? cancellationReason(p.cancelReason, p.cancelCode)
            : null,
        amount: `${isSent ? '-' : '+'}${formatTokenAmount(p.amount)}`,
        symbol: p.token.symbol,
        status: p.status,
        timestamp: new Date(p.createdAt).getTime(),
        copyValue: p.status === 'claimed' ? undefined : (p.claimLink || undefined),
        copyTitle: 'Copy payment link',
      });
    }

    for (const tx of transactions) {
      const isDeposit = tx.intent_type === 'deposit';
      const isWithdrawal = tx.intent_type === 'withdrawal';
      // An outgoing transfer carries its asset in `defuse_asset_id_out`; only
      // deposits populate `_in`. Reading `_in` alone left every send unlabelled
      // and falling through to the NEAR default.
      const txAssetId = tx.defuse_asset_id_in || tx.defuse_asset_id_out || '';
      const txAssetLower = txAssetId.toLowerCase();
      const assetToken = tokens.find(
        (t) =>
          t.id.toLowerCase() === txAssetLower ||
          // Suffix, not substring: "wrap.near" is a substring of other account
          // ids, so `includes` could pick the wrong token.
          (!!t.nearContractId &&
            txAssetLower.endsWith(`:${t.nearContractId.toLowerCase()}`))
      );
      const balanceToken = balances.find(
        (b) =>
          b.defuse_asset_id?.toLowerCase() === txAssetLower ||
          (b.nearContractId &&
            txAssetLower.endsWith(`:${b.nearContractId.toLowerCase()}`))
      );
      const rawAssetId = txAssetLower;
      const symbol =
        (tx.symbol ? cleanMemeSymbol(tx.symbol) : '') ||
        (assetToken?.symbol ? cleanMemeSymbol(assetToken.symbol) : '') ||
        (balanceToken?.symbol ? cleanMemeSymbol(balanceToken.symbol) : '') ||
        (rawAssetId.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')
          ? 'USDC'
          : rawAssetId.includes('wrap.near')
          ? 'NEAR'
          : rawAssetId.includes('usdc')
          ? 'USDC'
          : cleanMemeSymbol(rawAssetId) || '—');
      const amt = tx.amount_in || tx.amount_out || '0';

      const shortId = tx.id ? `${tx.id.slice(0, 6)}...${tx.id.slice(-4)}` : '';
      const explorerUrl =
        !isWithdrawal && tx.id && !tx.id.startsWith('0x') && tx.id.length > 20
          ? `https://nearblocks.io/txns/${tx.id}`
          : undefined;

      list.push({
        id: tx.id,
        type: isDeposit ? 'deposit' : isWithdrawal ? 'withdrawal' : 'payment',
        isSent: !isDeposit,
        title: isDeposit
          ? 'Deposit to Vault'
          : isWithdrawal
          ? `Withdraw to ${tx.receiver_id ? `${tx.receiver_id.slice(0, 6)}...` : 'wallet'}`
          : 'Intent Transfer',
        subtitle: `${new Date(tx.block_timestamp).toLocaleDateString()} • Tx: ${shortId}`,
        amount: `${isDeposit ? '+' : '-'}${amt}`,
        symbol,
        status: tx.status,
        timestamp: Number(tx.block_timestamp) || 0,
        copyValue: tx.id,
        copyTitle: 'Copy tx hash',
        explorerUrl,
      });
    }

    list.sort((a, b) => b.timestamp - a.timestamp);
    return list;
  }, [history, transactions, user?.handle, tokens, balances]);

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">

        {/* ── LEFT COLUMN: Balance, Quick Actions, Receive via Intents ── */}
        <div className="lg:col-span-7 space-y-6">

          {/* Balance Hero Card — live from onchain intent account */}
          <div className="rounded-3xl p-5 sm:p-8 md:p-10 bg-white border border-stone-200 shadow-xs space-y-5 sm:space-y-6 relative">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-stone-500 font-bold flex items-center space-x-1.5 min-w-0">
                <Shield className="w-3.5 h-3.5 text-stone-900 flex-shrink-0" />
                <span className="truncate">UPRAIL Account</span>
                {nearAccount && (
                  <span className="hidden sm:inline ml-1 text-stone-400 font-normal normal-case truncate max-w-[140px]">
                    · {nearAccount}
                  </span>
                )}
              </span>
              <div className="flex items-center space-x-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing || isLoadingBalances}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer"
                  title="Refresh live balance & activity"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${(isRefreshing || isLoadingBalances) ? 'animate-spin text-stone-900' : ''}`} />
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
              {isFirstLoad ? (
                <div className="py-3 space-y-3" aria-hidden="true">
                  <Skeleton className="h-11 w-56 sm:w-72" />
                  <Skeleton className="h-3 w-64" />
                </div>
              ) : (
                <div className="text-3xl sm:text-5xl font-display font-extrabold text-stone-950 tracking-tight tabular-nums break-all">
                  <RollingNumber
                    value={hideBalance ? null : totalBalanceUsd}
                    format={formatUsdCompact}
                    fallback={hideBalance ? '••••••••' : '—'}
                  />
                </div>
              )}
              {/* The headline is a priced subtotal whenever any holding is
                  priced — a dash is useless. Say how much is missing so the
                  figure is read as a floor, never as the full portfolio. */}
              {!isFirstLoad && !hideBalance && unpricedBalanceCount > 0 && totalBalanceUsd !== null && (
                <div className="text-[11px] font-mono text-amber-600">
                  +{unpricedBalanceCount} holding{unpricedBalanceCount === 1 ? '' : 's'} without a
                  live price
                </div>
              )}
              <div className="flex items-center space-x-2 text-[11px] sm:text-xs font-mono text-stone-500">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasIntentAccount ? 'bg-stone-900' : 'bg-amber-500 animate-pulse'}`} />
                {hasIntentAccount ? (
                  <span>Live · Private · Protected by your passkey</span>
                ) : user?.hasPasskey === true ? (
                  <span className="flex items-center gap-2">
                    <span>Setting up your UPRAIL account…</span>
                    <button
                      type="button"
                      onClick={() => void refreshBalances()}
                      disabled={isLoadingBalances}
                      className="underline underline-offset-2 hover:text-stone-900 disabled:opacity-50 cursor-pointer"
                    >
                      Retry
                    </button>
                  </span>
                ) : (
                  <span>No account yet — set up a passkey to create yours</span>
                )}
              </div>
              {!hasIntentAccount && user?.hasPasskey === true && accountError && !isLoadingBalances ? (
                <p className="text-[11px] font-mono text-stone-400">
                  Provisioning note: {accountError}
                </p>
              ) : null}
            </div>

            {/* Live asset breakdown from onchain */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-100">
              {balances.length > 0 ? (
                balances.map((b) => {
                  const usd = hideBalance ? null : balanceUsd(b, tokens);
                  return (
                    <span
                      key={b.defuse_asset_id}
                      className="px-2.5 py-1 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono font-medium text-stone-700"
                      title={b.defuse_asset_id}
                    >
                      {formatCompactAmount(b.amountFormatted)} {b.symbol}
                      {usd !== null && usd > 0 ? (
                        <span className="text-stone-400"> · {formatUsdCompact(usd)}</span>
                      ) : null}
                    </span>
                  );
                })
              ) : isFirstLoad ? (
                <div className="flex flex-wrap gap-2 pt-0.5" aria-hidden="true">
                  <Skeleton variant="chip" className="w-24" />
                  <Skeleton variant="chip" className="w-20" />
                  <Skeleton variant="chip" className="w-16" />
                </div>
              ) : balancesError || onchainError ? (
                <span className="text-xs font-mono text-red-500 flex items-center space-x-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{balancesError || onchainError}</span>
                  <button
                    type="button"
                    onClick={() => void refreshBalances()}
                    className="underline underline-offset-2 hover:text-red-700 cursor-pointer"
                  >
                    Retry
                  </button>
                </span>
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
              className="p-4 rounded-3xl bg-stone-900 text-white border border-stone-800 shadow-md flex items-center justify-between gap-3 hover:bg-black transition-all group cursor-pointer animate-fade-in"
            >
              <div className="flex items-center space-x-3 sm:space-x-3.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-white text-stone-900 flex items-center justify-center font-bold flex-shrink-0">
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold font-display flex items-center space-x-2">
                    <span className="truncate">{pendingPayments.length} payment{pendingPayments.length > 1 ? 's' : ''} waiting</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                  </div>
                  <div className="text-[11px] text-stone-300 font-mono mt-0.5 truncate">
                    ≈ {formatUsd(sumUsd(pendingPayments.map((p) => p.amountUsd)))} USD · Tap to receive
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-white group-hover:translate-x-1 transition-all flex-shrink-0" />
            </Link>
          )}

          {/* Received Payment Notice (direct sends land in the vault; tell the recipient) */}
          {unseenReceipts.length > 0 && (
            <div className="p-4 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 shadow-xs flex items-center justify-between gap-3 animate-fade-in">
              <Link
                to="/app/history"
                className="flex items-center space-x-3.5 min-w-0 group"
              >
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-600 flex items-center justify-center font-bold flex-shrink-0">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold font-display text-stone-950 truncate">
                    {unseenReceipts.length === 1
                      ? `You received ${formatTokenAmount(unseenReceipts[0].amount)} ${unseenReceipts[0].token.symbol} from @${unseenReceipts[0].senderHandle || 'someone'}`
                      : `You received ${unseenReceipts.length} payments`}
                  </div>
                  <div className="text-[11px] text-stone-600 font-mono truncate">
                    Delivered privately to your vault · Tap to view history
                  </div>
                </div>
              </Link>
              <button
                type="button"
                onClick={dismissReceipts}
                className="flex-shrink-0 text-[11px] font-mono font-bold text-stone-600 hover:text-stone-900 px-2.5 py-1.5 rounded-lg hover:bg-emerald-500/10 transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Quick Action Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <Link
              to="/app/send"
              className="py-3.5 sm:py-4 px-2 sm:px-3 rounded-2xl border border-stone-200 bg-white hover:border-black text-center transition-all flex flex-col items-center justify-center space-y-1 shadow-xs hover:shadow-sm group cursor-pointer"
            >
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-stone-100 text-stone-900 flex items-center justify-center group-hover:scale-105 transition-transform">
                <ArrowUpRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <span className="text-[11px] sm:text-xs font-display font-bold uppercase tracking-wider text-stone-900 group-hover:text-black transition-colors">
                Send
              </span>
              <span className="text-[9px] sm:text-[10px] font-mono text-stone-400">
                𝕏 & Wallets
              </span>
            </Link>

            <Link
              to="/app/receive"
              className="py-3.5 sm:py-4 px-2 sm:px-3 rounded-2xl border border-stone-200 bg-white hover:border-black text-center transition-all flex flex-col items-center justify-center space-y-1 shadow-xs hover:shadow-sm group cursor-pointer"
            >
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-stone-100 text-stone-900 flex items-center justify-center group-hover:scale-105 transition-transform">
                <ArrowDownLeft className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <span className="text-[11px] sm:text-xs font-display font-bold uppercase tracking-wider text-stone-900 group-hover:text-black transition-colors">
                Receive
              </span>
              <span className="text-[9px] sm:text-[10px] font-mono text-stone-400">
                Any Chain
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setIsWithdrawModalOpen(true)}
              className="py-3.5 sm:py-4 px-2 sm:px-3 rounded-2xl border border-stone-200 bg-white hover:border-black text-center transition-all flex flex-col items-center justify-center space-y-1 shadow-xs hover:shadow-sm group cursor-pointer"
            >
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-stone-100 text-stone-900 flex items-center justify-center group-hover:scale-105 transition-transform">
                <ArrowUpRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <span className="text-[11px] sm:text-xs font-display font-bold uppercase tracking-wider text-stone-900 group-hover:text-black transition-colors">
                Withdraw
              </span>
              <span className="text-[9px] sm:text-[10px] font-mono text-stone-400">
                near.com
              </span>
            </button>

            <Link
              to="/app/claim"
              className="py-3.5 sm:py-4 px-2 sm:px-3 rounded-2xl border border-stone-200 bg-white hover:border-black text-center transition-all flex flex-col items-center justify-center space-y-1 shadow-xs hover:shadow-sm group cursor-pointer relative"
            >
              {pendingPayments.length > 0 && (
                <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-stone-900 text-white text-[9px] font-mono font-bold animate-pulse">
                  {pendingPayments.length}
                </span>
              )}
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-stone-100 text-stone-900 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Fingerprint className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <span className="text-[11px] sm:text-xs font-display font-bold uppercase tracking-wider text-stone-900 group-hover:text-black transition-colors">
                Payments
              </span>
              <span className="text-[9px] sm:text-[10px] font-mono text-stone-400">
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
                  {Math.min(recentActivity.length, 4)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing || isLoadingHistory || isLoadingOnchainHistory}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg hover:bg-stone-50 transition-colors cursor-pointer"
                title="Refresh transactions"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${(isRefreshing || isLoadingHistory || isLoadingOnchainHistory) ? 'animate-spin text-stone-900' : ''}`} />
              </button>
            </div>

            {/* Simple hairline list — unified onchain and P2P ledger */}
            <div className="divide-y divide-stone-100 max-h-[390px] sm:max-h-[450px] overflow-y-auto pr-1 overscroll-contain">
              {(isLoadingHistory || isLoadingOnchainHistory) && recentActivity.length === 0 ? (
                <div className="py-2 space-y-3" aria-hidden="true">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 px-1 py-1">
                      <div className="flex items-center space-x-2.5">
                        <Skeleton variant="circle" className="w-7 h-7" />
                        <div className="space-y-1.5">
                          <Skeleton className="w-24" />
                          <Skeleton className="w-16 h-2.5" />
                        </div>
                      </div>
                      <div className="space-y-1.5 text-right">
                        <Skeleton className="ml-auto w-20 h-3" />
                        <Skeleton className="ml-auto w-12 h-2.5" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentActivity.length === 0 ? (
                <div className="py-12 text-center text-xs text-stone-400 font-mono">
                  No activity yet.
                </div>
              ) : (
                recentActivity.slice(0, 4).map((tx) => {
                  return (
                    <div
                      key={tx.id}
                      className="py-3 flex items-center justify-between gap-2 hover:bg-stone-50/70 rounded-xl px-2 transition-colors group"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${tx.isSent ? 'bg-stone-100 text-stone-800' : 'bg-emerald-50 text-emerald-800'}`}>
                          {tx.isSent ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-700" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-stone-900 font-mono truncate">
                            {tx.title}
                          </div>
                          <div className="text-[10px] text-stone-400 font-mono truncate">
                            {tx.subtitle}
                          </div>
                          {tx.reason && (
                            <div
                              className="text-[10px] text-amber-700 font-mono flex items-start gap-1 leading-snug mt-0.5 max-w-[220px] sm:max-w-xs"
                              title={tx.reason}
                            >
                              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              <span className="line-clamp-2 break-words">{tx.reason}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5 sm:space-x-2 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-xs font-mono font-bold text-stone-900 whitespace-nowrap">
                            {tx.amount} {tx.symbol}
                          </div>
                          <span className={`text-[9px] font-mono uppercase font-bold px-1.5 py-0.2 rounded border ${
                            tx.status === 'success' || tx.status === 'claimed'
                              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                              : tx.status === 'failed'
                              ? 'text-red-700 bg-red-50 border-red-200'
                              : tx.status === 'cancelled'
                              ? 'text-amber-700 bg-amber-50 border-amber-200'
                              : 'text-stone-600 bg-stone-100 border-stone-200'
                          }`}>
                            {historyStatusLabel(tx.status)}
                          </span>
                        </div>
                        {tx.copyValue && (
                          <button
                            type="button"
                            onClick={() => handleCopyTxLink(tx.copyValue!, tx.id)}
                            className="p-1 rounded-lg text-stone-300 hover:text-black hover:bg-stone-100 transition-colors cursor-pointer"
                            title={tx.copyTitle || "Copy link"}
                          >
                            {copiedTxId === tx.id ? (
                              <Check className="w-3.5 h-3.5 text-stone-900" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        {tx.explorerUrl && (
                          <a
                            href={tx.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded-lg text-stone-300 hover:text-black hover:bg-stone-100 transition-colors"
                            title="View on Explorer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
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
                <span>Full Ledger ({recentActivity.length})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── FLOW TELEMETRY & ACTIVITY PULSE WIDGET (Under everything) ── */}
      <div className="mt-8">
        <FlowPulseWidget history={history} transactions={transactions} tokens={tokens} />
      </div>

      <NearcomWithdrawModal
        isOpen={isWithdrawModalOpen}
        onClose={() => setIsWithdrawModalOpen(false)}
        tokens={paymentTokens}
        onSuccess={() => {
          void handleManualRefresh();
        }}
      />
    </div>
  );
};
