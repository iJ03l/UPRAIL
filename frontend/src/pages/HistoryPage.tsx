import React, { useEffect, useState } from 'react';
import {
  History,
  ShieldCheck,
  Search,
  RefreshCw,
  Filter,
} from 'lucide-react';
import { usePayments } from '../hooks/usePayments';
import { PaymentCard } from '../components/PaymentCard';
import { ShareModal } from '../components/ShareModal';
import { PaymentIntent } from '../types';

export const HistoryPage: React.FC = () => {
  const { history, isLoadingHistory, loadHistory } = usePayments();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedSharePayment, setSelectedSharePayment] = useState<PaymentIntent | null>(null);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

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
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-white flex items-center gap-2.5">
            <History className="w-7 h-7 text-[#E05326]" />
            Payment History
          </h1>
          <p className="text-sm text-[#C3B9B2] mt-1">
            Track all outgoing confidential intents on app.uprail.world and their real-time escrow/claim status
          </p>
        </div>

        <button
          onClick={() => loadHistory()}
          disabled={isLoadingHistory}
          className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-medium bg-dark-card border border-dark-border text-slate-300 hover:text-white hover:bg-dark-border/50 transition-colors disabled:opacity-50 w-full sm:w-auto"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingHistory ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by @handle, asset symbol, or memo..."
            className="w-full pl-10 pr-4 py-2.5 bg-dark-card border border-dark-border rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 hidden sm:block" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3.5 py-2.5 bg-dark-card border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-brand-500/50"
          >
            <option value="all">All Statuses</option>
            <option value="ready">Ready to Claim</option>
            <option value="claimed">Claimed</option>
            <option value="escrowed">Escrowed</option>
            <option value="pending">Pending</option>
            <option value="expired">Expired</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
      </div>

      {/* List */}
      {isLoadingHistory ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin text-brand-400 mb-3" />
          <p className="text-sm">Loading confidential payments...</p>
        </div>
      ) : filteredHistory.length === 0 ? (
        <div className="bg-dark-card/50 border border-dark-border rounded-2xl p-12 text-center">
          <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-white mb-1">No payments found</h3>
          <p className="text-sm text-slate-400 max-w-sm mx-auto mb-6">
            {searchQuery || statusFilter !== 'all'
              ? 'No payments matched your current filter criteria.'
              : 'You have not created any confidential payments yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredHistory.map((payment) => (
            <PaymentCard
              key={payment.id}
              payment={payment}
              onShare={(p) => setSelectedSharePayment(p)}
            />
          ))}
        </div>
      )}

      {/* Share Modal */}
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
