'use client';

import React, { useEffect, useState } from 'react';
import { Link } from '../lib/router';
import {
  History,
  Search,
  RefreshCw,
  ArrowLeft,
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  Share2,
} from 'lucide-react';
import { usePayments } from '../hooks/usePayments';
import { useXAuth } from '../hooks/useXAuth';
import { formatRecipientDisplay } from '../lib/api';
import { ShareModal } from '../components/ShareModal';
import { PaymentIntent } from '../types';

export const HistoryPage: React.FC = () => {
  const { user } = useXAuth();
  const { history, isLoadingHistory, loadHistory } = usePayments();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedSharePayment, setSelectedSharePayment] = useState<PaymentIntent | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleCopy = (payment: PaymentIntent) => {
    navigator.clipboard.writeText(payment.claimLink);
    setCopiedId(payment.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredHistory = history.filter((p) => {
    const matchesSearch =
      p.recipientHandle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.senderHandle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.memo && p.memo.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === 'all' || p.status.toLowerCase() === statusFilter.toLowerCase();

    return matchesSearch && matchesStatus;
  });

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

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950 flex items-center gap-2">
            <History className="w-6 h-6 text-stone-900" />
            Transaction History
          </h1>
          <p className="text-xs text-stone-500 font-mono mt-0.5">
            Simple chronological ledger of confidential transfers
          </p>
        </div>

        <button
          onClick={() => loadHistory()}
          disabled={isLoadingHistory}
          className="p-2.5 rounded-xl border border-stone-200 hover:border-black text-stone-600 hover:text-black bg-stone-50 transition-colors cursor-pointer text-xs flex items-center space-x-1"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
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
            placeholder="Search by @handle, token, or note..."
            className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-black focus:bg-white transition-colors"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 text-xs font-mono">
          {[
            { id: 'all', label: 'All' },
            { id: 'ready', label: 'Ready to Claim' },
            { id: 'claimed', label: 'Claimed' },
            { id: 'pending', label: 'Open Intents' },
            { id: 'expired', label: 'Expired' },
            { id: 'refunded', label: 'Refunded' },
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
        {isLoadingHistory ? (
          <div className="py-16 text-center text-stone-400 space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin text-stone-900 mx-auto" />
            <p className="text-xs font-mono">Loading transactions...</p>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="py-12 text-center text-stone-400 space-y-1 font-mono text-xs">
            <p>No transactions match your search or filter.</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {filteredHistory.map((tx) => {
              const isSent = Boolean(user?.handle && tx.senderHandle && tx.senderHandle.toLowerCase() === user.handle.toLowerCase());
              return (
                <div
                  key={tx.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/80 rounded-2xl px-2.5 transition-colors"
                >
                  {/* Left: Direction icon + Information */}
                  <div className="flex items-start sm:items-center space-x-3">
                    <div
                      className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 text-xs font-bold bg-stone-100 text-stone-800"
                    >
                      {isSent ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-stone-900 font-mono">
                          {isSent ? `To ${formatRecipientDisplay(tx.recipientHandle)}` : `From @${tx.senderHandle}`}
                        </span>
                        <span className="text-[10px] text-stone-400 font-mono">
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 font-mono mt-0.5">
                        {tx.memo || 'Confidential transfer via NEAR Intents'}
                      </p>
                    </div>
                  </div>

                  {/* Right: Amount, Badge, and Action buttons */}
                  <div className="flex items-center justify-between sm:justify-end space-x-3 pl-12 sm:pl-0">
                    <div className="text-right">
                      <div
                        className="text-xs font-mono font-bold text-stone-900"
                      >
                        {isSent ? '-' : '+'}{tx.amount} {tx.token.symbol}
                      </div>
                      <div className="flex items-center space-x-1.5 justify-end">
                        <span className="text-[10px] text-stone-400 font-mono">
                          ≈ ${tx.amountUsd.toFixed(2)}
                        </span>
                        <span
                          className="text-[9px] font-mono uppercase font-bold px-1.5 py-0.2 rounded text-stone-600 bg-stone-100 border border-stone-200"
                        >
                          {tx.status}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons (Copy link, Share) */}
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => handleCopy(tx)}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-black hover:bg-stone-200 transition-colors cursor-pointer"
                        title="Copy claim link"
                      >
                        {copiedId === tx.id ? (
                          <Check className="w-3.5 h-3.5 text-stone-900" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        onClick={() => setSelectedSharePayment(tx)}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-black hover:bg-stone-100 transition-colors cursor-pointer"
                        title="Share link"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
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
