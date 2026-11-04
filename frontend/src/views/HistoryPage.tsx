'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  Share2,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { usePayments } from '../hooks/usePayments';
import { useXAuth } from '../hooks/useXAuth';
import { useOnchainData } from '../hooks/useOnchainData';
import { api, cleanMemeSymbol, formatRecipientDisplay, formatTokenAmount, formatUsd } from '../lib/api';
import { ShareModal } from '../components/ShareModal';
import { BackBar } from '../components/BackBar';
import { SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { PaymentIntent, PaymentRequest } from '../types';
import { cancellationReason, historyStatusLabel } from '../lib/statusLabels';

export const HistoryPage: React.FC = () => {
  const { user } = useXAuth();
  const { toast } = useToast();
  const { history, isLoadingHistory, loadHistory } = usePayments();
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
  const [requests, setRequests] = useState<PaymentRequest[]>([]);

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

  useEffect(() => {
    loadHistory();
    loadOnchainHistory();
    loadRequests();
  }, [loadHistory, loadOnchainHistory]);

  const handleRefresh = () => {
    loadHistory();
    loadOnchainHistory();
    loadRequests();
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
      type: 'payment' | 'deposit' | 'withdrawal';
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
      payment?: PaymentIntent;
      copyValue?: string;
      explorerUrl?: string;
    };

    const list: UnifiedHistoryItem[] = [];

    // 1. Peer-to-peer / confidential intent payments
    for (const p of history) {
      const isSent = Boolean(
        user?.handle && p.senderHandle && p.senderHandle.toLowerCase() === user.handle.toLowerCase()
      );
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
        payment: p,
        copyValue: p.claimLink,
      });
    }

    // 2. UPRAIL Payment Requests
    for (const req of requests) {
      const isSent = Boolean(
        user?.handle && req.requester_handle && req.requester_handle.toLowerCase() === user.handle.toLowerCase()
      );
      const targetToken = tokens.find(
        (t) => t.id.toLowerCase() === req.asset.toLowerCase() || t.symbol.toLowerCase() === req.asset.toLowerCase()
      );
      list.push({
        id: req.id,
        type: 'payment',
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
        copyValue: typeof window !== 'undefined' ? `${window.location.origin}/request/${req.id}` : `/request/${req.id}`,
      });
    }

    // 3. Onchain deposits, withdrawals, and direct settlements
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
      const price = assetToken?.priceUsd || balanceToken?.priceUsd;
      const amountUsd = price ? (parseFloat(amt) || 0) * price : null;

      const shortId = tx.id ? `${tx.id.slice(0, 8)}...${tx.id.slice(-6)}` : '';
      const explorerUrl =
        !isWithdrawal && tx.id && !tx.id.startsWith('0x') && tx.id.length > 20
          ? `https://nearblocks.io/txns/${tx.id}`
          : undefined;

      list.push({
        id: tx.id,
        type: isDeposit ? 'deposit' : isWithdrawal ? 'withdrawal' : 'payment',
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
        copyValue: tx.id,
        explorerUrl,
      });
    }

    list.sort((a, b) => b.timestamp - a.timestamp);
    return list;
  }, [history, requests, transactions, user?.handle, tokens, balances]);

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
        matchesFilter = item.subtitle?.includes('Payment Request') || item.title?.includes('Request');
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
          disabled={isLoading}
          className="p-2.5 rounded-xl border border-stone-200 hover:border-black text-stone-600 hover:text-black bg-stone-50 transition-colors cursor-pointer text-xs flex items-center space-x-1"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline font-mono">Refresh</span>
        </button>
      </div>

      {/* Search & Status Filters */}
      <div className="space-y-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by @handle, tx hash, token, or note..."
            className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl text-base sm:text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-black focus:bg-white transition-colors"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 text-xs font-mono">
          {[
            { id: 'all', label: 'All' },
            { id: 'requests', label: 'Requests' },
            { id: 'deposits', label: 'Deposits' },
            { id: 'withdrawals', label: 'Withdrawals' },
            { id: 'ready', label: 'Waiting' },
            { id: 'claimed', label: 'Received' },
            { id: 'pending', label: 'Pending' },
            { id: 'expired', label: 'Expired' },
            { id: 'refunded', label: 'Refunded' },
            { id: 'cancelled', label: 'Cancelled' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
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
              return (
                <div
                  key={tx.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/80 rounded-2xl px-2.5 transition-colors"
                >
                  {/* Left: Direction icon + Information */}
                  <div className="flex items-start sm:items-center space-x-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                        tx.type === 'deposit'
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-stone-100 text-stone-800'
                      }`}
                    >
                      {tx.isSent ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownLeft className="w-4 h-4 text-emerald-700" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-stone-900 font-mono truncate max-w-[160px] sm:max-w-none">
                          {tx.title}
                        </span>
                        <span className="text-[10px] text-stone-400 font-mono flex-shrink-0">
                          {tx.date}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 font-mono mt-0.5 line-clamp-1 break-all">
                        {tx.subtitle}
                      </p>
                      {tx.reason && (
                        <p
                          className="text-[10px] text-amber-700 font-mono mt-1 flex items-start gap-1.5 leading-snug"
                          title={tx.reason}
                        >
                          <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span className="line-clamp-2 break-words">{tx.reason}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Amount, Badge, and Action buttons */}
                  <div className="flex items-center justify-between sm:justify-end space-x-3 pl-12 sm:pl-0">
                    <div className="text-right">
                      <div
                        className={`text-xs font-mono font-bold ${
                          tx.isSent ? 'text-red-600' : 'text-emerald-600'
                        }`}
                      >
                        {tx.isSent ? '-' : '+'}{formatTokenAmount(tx.amount)} {tx.symbol}
                      </div>
                      <div className="flex items-center space-x-1.5 justify-end">
                        {tx.amountUsd !== null && (
                          <span className="text-[10px] text-stone-400 font-mono">
                            ≈ {formatUsd(tx.amountUsd)}
                          </span>
                        )}
                        <span
                          className={`text-[9px] font-mono uppercase font-bold px-1.5 py-0.2 rounded border ${
                            tx.status === 'success' || tx.status === 'claimed'
                              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                              : tx.status === 'failed'
                              ? 'text-red-700 bg-red-50 border-red-200'
                              : tx.status === 'cancelled'
                              ? 'text-amber-700 bg-amber-50 border-amber-200'
                              : 'text-stone-600 bg-stone-100 border-stone-200'
                          }`}
                        >
                          {historyStatusLabel(tx.status)}
                        </span>
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
                            <Check className="w-3.5 h-3.5 text-stone-900" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}

                      {tx.payment && (
                        <button
                          onClick={() => setSelectedSharePayment(tx.payment!)}
                          className="p-1.5 rounded-lg text-stone-400 hover:text-black hover:bg-stone-100 transition-colors cursor-pointer"
                          title="Share link"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {tx.explorerUrl && (
                        <a
                          href={tx.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-stone-400 hover:text-black hover:bg-stone-100 transition-colors"
                          title="View on NEARBlocks"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
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
