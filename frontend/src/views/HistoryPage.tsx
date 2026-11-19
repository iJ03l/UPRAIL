'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  MagnifyingGlass,
  ArrowsClockwise,
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  ShareNetwork,
  ArrowSquareOut,
  WarningCircle,
  Clock,
  ShieldCheck,
  XCircle,
  CircleNotch,
  Gift,
} from '@phosphor-icons/react';
import { Link } from '../lib/router';
import { getTransactionBalanceEffect, formatBalanceAmount, BalanceEffect } from '../lib/transactions';
import { usePayments } from '../hooks/usePayments';
import { useXAuth } from '../hooks/useXAuth';
import { useOnchainData } from '../hooks/useOnchainData';
import { api, cleanMemeSymbol, formatRecipientDisplay, formatTokenAmount, formatUsd } from '../lib/api';
import { ShareModal } from '../components/ShareModal';
import { BackBar } from '../components/BackBar';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { AuthenticatedGiftView, CoffeeSettingsResponse, PaymentIntent, PaymentRequest } from '../types';
import { activityStatusMeta, cancellationReason } from '../lib/statusLabels';

export const HistoryPage: React.FC = () => {
  const { user } = useXAuth();
  const { toast } = useToast();
  const { history, isLoadingHistory, loadHistory, cancelPayment } = usePayments();
  const {
    transactions,
    tokens,
    balances,
    isLoadingHistory: isLoadingOnchain,
    refreshHistory: loadOnchainHistory,
  } = useOnchainData();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedSharePayment, setSelectedSharePayment] = useState<PaymentIntent | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelStepMsg, setCancelStepMsg] = useState<string | null>(null);
  const cancellingRef = useRef(false);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [gifts, setGifts] = useState<AuthenticatedGiftView[]>([]);

  const loadRequests = async () => {
    try {
      const [inc, out] = await Promise.all([
        api.getIncomingRequests(),
        api.getOutgoingRequests(),
      ]);
      const combined = [...(inc || []), ...(out || [])];
      const seen = new Set<string>();
      setRequests(
        combined.filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        })
      );
    } catch {}
  };

  const [coffeeDonations, setCoffeeDonations] = useState<CoffeeSettingsResponse['recentDonations']>([]);
  const loadCoffee = async () => {
    try {
      const s = await api.getCoffeeSettings();
      setCoffeeDonations(s?.recentDonations || []);
    } catch {}
  };

  const loadGifts = async () => {
    try {
      const { sent, received } = await api.listGifts();
      const combined = [...(received || []), ...(sent || [])];
      const seen = new Set<string>();
      setGifts(
        combined.filter((g) => {
          if (seen.has(g.id)) return false;
          seen.add(g.id);
          return true;
        })
      );
    } catch {}
  };

  useEffect(() => {
    loadHistory();
    loadOnchainHistory();
    loadRequests();
    loadCoffee();
    loadGifts();
  }, [loadHistory, loadOnchainHistory]);

  const handleRefresh = () => {
    loadHistory();
    loadOnchainHistory();
    loadRequests();
    loadCoffee();
    loadGifts();
  };

  const handleCopy = (value: string, id: string) => {
    navigator.clipboard.writeText(value);
    setCopiedId(id);
    toast('Copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const unifiedHistory = useMemo(() => {
    type UnifiedHistoryItem = {
      id: string;
      type: 'payment' | 'deposit' | 'withdrawal' | 'request' | 'gift';
      isSent: boolean;
      title: string;
      subtitle: string;
      reason?: string | null;
      senderHandle?: string;
      recipientHandle?: string;
      amount: string;
      amountUsd: number | null;
      symbol: string;
      status: string;
      date: string;
      timestamp: number;
      balanceEffect: BalanceEffect;
      payment?: PaymentIntent;
      giftId?: string;
      verifyUrl?: string;
      copyValue?: string;
      explorerUrl?: string;
    };

    const list: UnifiedHistoryItem[] = [];

    // 1. Peer-to-peer / confidential intent payments
    for (const p of history) {
      const isSent = Boolean(
        user?.handle && p.senderHandle && p.senderHandle.toLowerCase() === user.handle.toLowerCase()
      );
      const balanceEffect = getTransactionBalanceEffect({
        type: 'payment',
        isSent,
        status: p.status,
      });
      list.push({
        id: p.id,
        type: 'payment',
        isSent,
        title: isSent ? `To ${formatRecipientDisplay(p.recipientHandle)}` : `From @${p.senderHandle}`,
        subtitle: p.memo || 'Confidential transfer via NEAR Intents',
        reason:
          p.status === 'cancelled'
            ? cancellationReason(p.cancelReason, p.cancelCode)
            : null,
        senderHandle: p.senderHandle,
        recipientHandle: p.recipientHandle,
        amount: p.amount,
        amountUsd: p.amountUsd,
        symbol: p.token.symbol,
        status: p.status,
        date: new Date(p.createdAt).toLocaleDateString(),
        timestamp: new Date(p.createdAt).getTime(),
        balanceEffect,
        payment: p,
        copyValue: p.claimLink,
      });
    }

    // 2. UPRAIL Payment Requests
    for (const req of requests) {
      const isSent = Boolean(
        user?.handle && req.requester_handle && req.requester_handle.toLowerCase() === user.handle.toLowerCase()
      );
      const balanceEffect = getTransactionBalanceEffect({
        type: 'request',
        isRequest: true,
        isSent,
        status: req.status,
      });
      const targetToken = tokens.find(
        (t) => t.id.toLowerCase() === req.asset.toLowerCase() || t.symbol.toLowerCase() === req.asset.toLowerCase()
      );
      list.push({
        id: req.id,
        type: 'request',
        isSent,
        title: isSent ? `Request to @${req.requested_handle}` : `Request from @${req.requester_handle}`,
        subtitle: req.memo || 'UPRAIL Payment Request',
        reason: req.decline_reason ? `Declined: ${req.decline_reason}` : null,
        amount: req.amount,
        amountUsd: null,
        symbol: targetToken?.symbol || req.asset.split('.').pop()?.toUpperCase() || 'USDC',
        status: req.status.toLowerCase(),
        date: new Date(req.created_at).toLocaleDateString(),
        timestamp: req.created_at,
        balanceEffect,
        copyValue: typeof window !== 'undefined' ? `${window.location.origin}/request/${req.id}` : `/request/${req.id}`,
      });
    }

    // 3. Onchain deposits, withdrawals, and direct settlements
    for (const tx of transactions) {
      const isDeposit = tx.intent_type === 'deposit';
      const isWithdrawal = tx.intent_type === 'withdrawal';
      const txType = isDeposit ? 'deposit' : isWithdrawal ? 'withdrawal' : 'payment';
      const balanceEffect = getTransactionBalanceEffect({
        type: txType,
        isSent: !isDeposit,
        status: tx.status,
      });
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
      const price = assetToken?.priceUsd || balanceToken?.priceUsd;
      const amountUsd = price ? (parseFloat(amt) || 0) * price : null;

      const shortId = tx.id ? `${tx.id.slice(0, 8)}...${tx.id.slice(-6)}` : '';
      const explorerUrl =
        !isWithdrawal && tx.id && !tx.id.startsWith('0x') && tx.id.length > 20
          ? `https://nearblocks.io/txns/${tx.id}`
          : undefined;

      list.push({
        id: tx.id,
        type: txType,
        isSent: !isDeposit,
        title: isDeposit
          ? 'Deposit to Confidential Vault'
          : isWithdrawal
          ? `Withdrawal to ${tx.receiver_id ? `${tx.receiver_id.slice(0, 8)}...` : 'External Wallet'}`
          : 'Intent Transfer',
        subtitle: isDeposit
          ? `Ingress via 1Click / NEAR Intents • Tx: ${shortId}`
          : `Settled onchain • Tx: ${shortId}`,
        amount: amt,
        amountUsd,
        symbol,
        status: tx.status,
        date: new Date(tx.block_timestamp).toLocaleDateString(),
        timestamp: Number(tx.block_timestamp) || 0,
        balanceEffect,
        copyValue: tx.id,
        explorerUrl,
      });
    }

    // 4. Buy Me a Coffee tips received via the public pay link (settled in stables)
    const coffeeTxHashes = new Set<string>();
    const coffeeIds = new Set<string>();
    for (const d of coffeeDonations) {
      if (d.payoutTxHash) coffeeTxHashes.add(d.payoutTxHash);
      coffeeIds.add(d.id);
      list.push({
        id: d.id,
        type: 'deposit',
        isSent: false,
        title: 'Buy Me a Coffee tip',
        subtitle: `Paid in ${d.originSymbol} • Settled as ${d.targetSymbol}`,
        amount: d.netAmount || d.grossAmount,
        amountUsd: parseFloat(d.netAmount || d.grossAmount) || null,
        symbol: d.targetSymbol,
        status: 'completed',
        date: new Date(d.createdAt).toLocaleDateString(),
        timestamp: d.createdAt,
        balanceEffect: getTransactionBalanceEffect({ type: 'deposit', isSent: false, status: 'completed' }),
        copyValue: d.payoutTxHash || undefined,
      });
    }

    // 5. Claimed / Reclaimed Timelocked Gifts (compact ledger rows, not cards)
    const giftClaimTxHashes = new Set<string>();
    const giftRowIds = new Set<string>();
    for (const g of gifts) {
      if (g.status !== 'CLAIMED' && g.status !== 'RECLAIMED') continue;
      const myHandle = (user?.handle || '').toLowerCase();
      const isReceived =
        g.role === 'RECIPIENT' ||
        (Boolean(myHandle) && g.recipientHandle.toLowerCase() === myHandle);
      const isSent = !isReceived;
      const statusLower = g.status.toLowerCase();
      const ts = g.claimedAt || g.timelockUntil || g.createdAt;
      const rowId = `gift_${g.id}`;
      giftRowIds.add(rowId);
      if (g.claimTxHash) giftClaimTxHashes.add(g.claimTxHash);
      const yieldSuffix =
        g.yieldUsdCents > 0 ? ` • +${formatUsd(g.yieldUsdCents / 100)} yield` : '';
      list.push({
        id: rowId,
        type: 'gift',
        isSent,
        title:
          g.status === 'RECLAIMED'
            ? `Reclaimed gift to @${g.recipientHandle}`
            : isSent
            ? `Gift to @${g.recipientHandle}`
            : `Gift from @${g.senderHandle}`,
        subtitle: `${g.occasionLabel} • ${g.vaultSymbol} Timelocked Vault${yieldSuffix}`,
        senderHandle: g.senderHandle,
        recipientHandle: g.recipientHandle,
        amount: g.sharesFormatted || '0',
        amountUsd: g.currentValueUsdCents > 0 ? g.currentValueUsdCents / 100 : null,
        symbol: g.vaultSymbol,
        status: statusLower,
        date: ts ? new Date(ts).toLocaleDateString() : '',
        timestamp: ts || 0,
        balanceEffect: getTransactionBalanceEffect({
          type: 'gift',
          isSent,
          status: statusLower,
        }),
        giftId: g.id,
        copyValue: g.claimTxHash || g.shareUrl || undefined,
        verifyUrl:
          g.contractMode === 'contract'
            ? `/verify?kind=gift&id=${encodeURIComponent(g.onchainGiftId || g.id)}`
            : undefined,
      });
    }

    const deduped = list.filter((item) => {
      if (coffeeTxHashes.size && !coffeeIds.has(item.id) && coffeeTxHashes.has(item.id)) {
        return false;
      }
      if (giftClaimTxHashes.size && !giftRowIds.has(item.id) && giftClaimTxHashes.has(item.id)) {
        return false;
      }
      return true;
    });

    deduped.sort((a, b) => b.timestamp - a.timestamp);
    return deduped;
  }, [history, requests, transactions, user?.handle, tokens, balances, coffeeDonations, gifts]);

  const filteredHistory = useMemo(() => {
    return unifiedHistory.filter((item) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.symbol.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.senderHandle && item.senderHandle.toLowerCase().includes(q)) ||
        (item.recipientHandle && item.recipientHandle.toLowerCase().includes(q));

      let matchesFilter = true;
      if (statusFilter === 'all') {
        matchesFilter = true;
      } else if (statusFilter === 'requests') {
        matchesFilter = item.type === 'request' || item.subtitle?.includes('Payment Request') || item.title?.includes('Request');
      } else if (statusFilter === 'gifts') {
        matchesFilter = item.type === 'gift';
      } else if (statusFilter === 'deposits') {
        matchesFilter = item.type === 'deposit';
      } else if (statusFilter === 'withdrawals') {
        matchesFilter = item.type === 'withdrawal';
      } else {
        matchesFilter = item.status.toLowerCase() === statusFilter.toLowerCase();
      }

      return matchesSearch && matchesFilter;
    });
  }, [unifiedHistory, searchQuery, statusFilter]);

  const isLoading = isLoadingHistory || isLoadingOnchain;

  return (
    <div className="w-full space-y-6">
      {/* Back navigation — wide bar on desktop, floating round on mobile */}
      <BackBar label="Back to Home" />

      {/* Refresh (page title removed — the back bar owns the top now) */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleRefresh}
          disabled={isLoading || Boolean(cancellingId)}
          className="p-2.5 rounded-xl border border-stone-200 hover:border-black text-stone-600 hover:text-black bg-stone-50 transition-colors cursor-pointer text-xs flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Refresh"
        >
          <ArrowsClockwise weight="bold" className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline font-mono">Refresh</span>
        </button>
      </div>

      {/* Live Refund Progress Banner */}
      {cancellingId && cancelStepMsg && (
        <div
          role="status"
          aria-live="polite"
          className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-mono flex items-center gap-2.5"
        >
          <CircleNotch weight="bold" className="w-4 h-4 animate-spin flex-shrink-0" />
          <span>{cancelStepMsg}</span>
        </div>
      )}

      {/* Search & Status Filters */}
      <div className="space-y-3">
        {/* Search Input */}
        <div className="relative">
          <MagnifyingGlass weight="bold" className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by @handle, tx hash, token, or note..."
            className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl text-base sm:text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-black focus:bg-white transition-colors"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory scroll-px-1 pb-1.5 text-xs font-mono">
          {[
            { id: 'all', label: 'All' },
            { id: 'gifts', label: 'Gifts' },
            { id: 'requests', label: 'Requests' },
            { id: 'deposits', label: 'Deposits' },
            { id: 'withdrawals', label: 'Withdrawals' },
            { id: 'ready', label: 'Waiting' },
            { id: 'claimed', label: 'Received' },
            { id: 'pending', label: 'Pending' },
            { id: 'declined', label: 'Declined' },
            { id: 'expired', label: 'Expired' },
            { id: 'refunded', label: 'Refunded' },
            { id: 'cancelled', label: 'Cancelled' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`snap-start flex-shrink-0 min-h-10 px-3.5 py-2 rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-black text-white font-bold'
                  : 'bg-stone-100 hover:bg-stone-200 text-stone-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* The Simple List Card */}
      <div className="rounded-3xl p-4 sm:p-6 bg-white border border-stone-200 shadow-sm">
        {isLoading && filteredHistory.length === 0 ? (
          <SkeletonList rows={5} className="py-2" />
        ) : filteredHistory.length === 0 ? (
          <div className="py-12 text-center text-stone-400 space-y-1 font-mono text-xs">
            <p>No transactions match your search or filter.</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {filteredHistory.map((tx) => {
              const isCancellingThis = cancellingId === tx.id;
              return (
                <div
                  key={tx.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/80 rounded-2xl px-2.5 transition-colors"
                >
                  {/* Left: Direction icon + Information */}
                  <div className="flex items-start sm:items-center space-x-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                        tx.balanceEffect === 'debit'
                          ? 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/40 dark:border-red-900/60'
                          : tx.balanceEffect === 'incoming'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900/60'
                          : 'bg-stone-100 text-stone-700 border border-stone-200 dark:bg-stone-800 dark:border-stone-700'
                      }`}
                    >
                      {tx.type === 'gift' ? (
                        <Gift
                          weight="fill"
                          className={`w-4 h-4 ${
                            tx.balanceEffect === 'debit'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        />
                      ) : tx.balanceEffect === 'debit' ? (
                        <ArrowUpRight weight="bold" className="w-4 h-4 text-red-600 dark:text-red-400" />
                      ) : tx.balanceEffect === 'incoming' ? (
                        <ArrowDownLeft weight="bold" className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Clock weight="fill" className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-stone-900 dark:text-stone-100 font-mono truncate max-w-[160px] sm:max-w-none">
                          {tx.title}
                        </span>
                        <span className="text-[10px] text-stone-400 font-mono flex-shrink-0">
                          {tx.date}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 dark:text-stone-400 font-mono mt-0.5 line-clamp-1 break-all">
                        {tx.subtitle}
                      </p>
                      {tx.reason && (
                        <p
                          className="text-[10px] text-amber-700 dark:text-amber-400 font-mono mt-1 flex items-start gap-1.5 leading-snug"
                          title={tx.reason}
                        >
                          <WarningCircle weight="fill" className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span className="line-clamp-2 break-words">{tx.reason}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Amount, Badge, and Action buttons */}
                  <div className="flex items-center justify-between sm:justify-end space-x-3 pl-12 sm:pl-0">
                    <div className="text-right">
                      {(() => {
                        const amt = formatBalanceAmount(formatTokenAmount(tx.amount), tx.balanceEffect);
                        return (
                          <div className="text-xs font-mono font-bold whitespace-nowrap">
                            <span className={amt.colorClass}>
                              {amt.prefix}{amt.amount}
                            </span>{' '}
                            <span className="text-stone-500 dark:text-stone-400 font-normal">{tx.symbol}</span>
                          </div>
                        );
                      })()}
                      <div className="flex items-center space-x-1.5 justify-end">
                        {tx.amountUsd !== null && (
                          <span className="text-[10px] text-stone-400 font-mono">
                            ≈ {formatUsd(tx.amountUsd)}
                          </span>
                        )}
                        {(() => {
                          const statusMeta = activityStatusMeta({
                            type: tx.type,
                            isSent: tx.isSent,
                            status: tx.status,
                          });
                          return (
                            <span
                              className={`text-[9px] font-mono uppercase font-bold px-1.5 py-0.2 rounded border ${statusMeta.className}`}
                            >
                              {statusMeta.label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Action buttons (Copy link / hash, Share, Explorer) */}
                    <div className="flex items-center space-x-1">
                      {tx.copyValue && (
                        <button
                          onClick={() => handleCopy(tx.copyValue!, tx.id)}
                          className="p-1.5 rounded-lg text-stone-400 hover:text-black hover:bg-stone-200 transition-colors cursor-pointer"
                          title={tx.payment ? 'Copy payment link' : 'Copy transaction hash'}
                        >
                          {copiedId === tx.id ? (
                            <Check weight="bold" className="w-3.5 h-3.5 text-stone-900" />
                          ) : (
                            <Copy weight="fill" className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}

                      {tx.payment && (
                        <button
                          onClick={() => setSelectedSharePayment(tx.payment!)}
                          className="p-1.5 rounded-lg text-stone-400 hover:text-black hover:bg-stone-100 transition-colors cursor-pointer"
                          title="Share link"
                        >
                          <ShareNetwork weight="fill" className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {tx.payment &&
                        tx.isSent &&
                        ['ready', 'escrowed', 'ESCROWED'].includes(tx.status) && (
                          <button
                            type="button"
                            disabled={Boolean(cancellingId)}
                            onClick={async () => {
                              if (cancellingRef.current) return;
                              cancellingRef.current = true;
                              setCancellingId(tx.id);
                              setCancelStepMsg('Preparing escrow refund…');
                              try {
                                await cancelPayment(tx.id, (_stage, msg) => {
                                  if (msg) setCancelStepMsg(msg);
                                });
                                toast('Payment cancelled & refunded to your balance');
                              } catch (err: any) {
                                toast(err?.message || 'Failed to cancel & refund payment', 'error');
                              } finally {
                                cancellingRef.current = false;
                                setCancellingId(null);
                                setCancelStepMsg(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-mono font-bold text-amber-700 hover:text-amber-900 hover:bg-amber-50 border border-amber-200/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Cancel unclaimed send & refund"
                          >
                            {isCancellingThis ? (
                              <CircleNotch weight="bold" className="w-3 h-3 animate-spin" />
                            ) : (
                              <XCircle weight="fill" className="w-3 h-3" />
                            )}
                            <span>{isCancellingThis ? 'Refunding…' : 'Cancel & Refund'}</span>
                          </button>
                        )}

                      {tx.payment?.contractMode === 'contract' &&
                        (tx.payment.escrowSendId || tx.payment.id) && (
                          <Link
                            to={`/verify?kind=send&id=${encodeURIComponent(
                              tx.payment.escrowSendId || tx.payment.id
                            )}`}
                            className="p-1.5 rounded-lg text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 transition-colors"
                            title="Verify on-chain contract escrow"
                          >
                            <ShieldCheck weight="fill" className="w-3.5 h-3.5" />
                          </Link>
                        )}

                      {tx.verifyUrl && (
                        <Link
                          to={tx.verifyUrl}
                          className="p-1.5 rounded-lg text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 transition-colors"
                          title="Verify on-chain gift vault"
                        >
                          <ShieldCheck weight="fill" className="w-3.5 h-3.5" />
                        </Link>
                      )}

                      {tx.giftId && (
                        <Link
                          to={`/gift/${tx.giftId}`}
                          className="p-1.5 rounded-lg text-stone-400 hover:text-black hover:bg-stone-100 transition-colors"
                          title="View gift details"
                        >
                          <ArrowSquareOut weight="fill" className="w-3.5 h-3.5" />
                        </Link>
                      )}

                      {tx.explorerUrl && (
                        <a
                          href={tx.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-stone-400 hover:text-black hover:bg-stone-100 transition-colors"
                          title="View on NEARBlocks"
                        >
                          <ArrowSquareOut weight="fill" className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Share Modal Dialog */}
      {selectedSharePayment && (
        <ShareModal
          payment={selectedSharePayment}
          isOpen={true}
          onClose={() => setSelectedSharePayment(null)}
        />
      )}
    </div>
  );
};
