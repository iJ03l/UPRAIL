import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
} from 'lucide-react';
import { usePayments } from '../hooks/usePayments';
import { useXAuth } from '../hooks/useXAuth';

const RECEIVE_CHAINS = [
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', icon: '⟠' },
  { id: 'solana', name: 'Solana', symbol: 'SOL', icon: '◎' },
  { id: 'base', name: 'Base', symbol: 'BASE', icon: '🔵' },
  { id: 'near', name: 'NEAR', symbol: 'NEAR', icon: 'Ⓝ' },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ARB', icon: '🔷' },
  { id: 'robinhood', name: 'Robinhood', symbol: 'HOOD', icon: '🪶' },
];

export const AppHome: React.FC = () => {
  const { user } = useXAuth();
  const {
    history,
    loadHistory,
    isLoadingHistory,
  } = usePayments();

  const [hideBalance, setHideBalance] = useState<boolean>(false);
  const [selectedChain, setSelectedChain] = useState(RECEIVE_CHAINS[0]);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);
  const [showQrCode, setShowQrCode] = useState(false);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const intentDepositAddress =
    selectedChain.id === 'solana'
      ? 'UPRaiL7xK9nB5tE2wM1pQ4v8yJ3zD6sF0a'
      : selectedChain.id === 'near'
      ? 'escrow.uprail.near'
      : '0x71a2B89eC0d4E95F63B72eF10a12c345E6789a1b';

  const handleCopyIntentAddress = () => {
    navigator.clipboard.writeText(intentDepositAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleCopyTxLink = (claimLink: string, id: string) => {
    navigator.clipboard.writeText(claimLink);
    setCopiedTxId(id);
    setTimeout(() => setCopiedTxId(null), 2000);
  };

  const totalBalanceUsd = 1420.50;

  return (
    <div className="w-full">
      {/* 
        Side-by-side on desktop, stacked on mobile.
        Everything visible at a glance!
      */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* 
          LEFT COLUMN: Balance, Quick Actions, Receive through Intents
        */}
        <div className="lg:col-span-7 space-y-6">
          {/* Balance Hero Card */}
          <div className="rounded-3xl p-6 sm:p-7 bg-white border border-stone-200 shadow-xs space-y-4 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-stone-500 font-bold flex items-center space-x-1.5">
                <Shield className="w-3.5 h-3.5 text-stone-900" />
                <span>Shielded Vault</span>
              </span>
              <button
                type="button"
                onClick={() => setHideBalance(!hideBalance)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer"
                title={hideBalance ? 'Show balance' : 'Hide balance'}
              >
                {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Big Balance Number */}
            <div className="space-y-1">
              <div className="text-4xl sm:text-5xl font-display font-extrabold text-stone-950 tracking-tight">
                {hideBalance ? '••••••••' : `$${totalBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </div>
              <div className="flex items-center space-x-2 text-xs font-mono text-stone-500">
                <span className="w-1.5 h-1.5 rounded-full bg-stone-900" />
                <span>Passkey Protected</span>
              </div>
            </div>

            {/* Asset breakdown pills */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-100">
              <span className="px-2.5 py-1 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono font-medium text-stone-700">
                1,000 USDC
              </span>
              <span className="px-2.5 py-1 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono font-medium text-stone-700">
                75 NEAR
              </span>
              <span className="px-2.5 py-1 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono font-medium text-stone-700">
                0.12 ETH
              </span>
            </div>
          </div>

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
              className="py-4 px-3 rounded-2xl border border-stone-200 bg-white hover:border-black text-center transition-all flex flex-col items-center justify-center space-y-1 shadow-xs hover:shadow-sm group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-stone-100 text-stone-900 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Fingerprint className="w-5 h-5" />
              </div>
              <span className="text-xs font-display font-bold uppercase tracking-wider text-stone-900 group-hover:text-black transition-colors">
                Claim
              </span>
              <span className="text-[10px] font-mono text-stone-400">
                Passkey
              </span>
            </Link>
          </div>

          {/* Receive Through Intents (Visible on dashboard) */}
          <div className="rounded-3xl p-6 bg-white border border-stone-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-stone-950 text-sm flex items-center space-x-1.5">
                <span>Receive via Intents</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-stone-100 text-stone-800">
                  1CLICK
                </span>
              </h3>
              <span className="text-[11px] font-mono text-stone-400">
                Settles in ~3s
              </span>
            </div>

            {/* Chain Selector Buttons */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {RECEIVE_CHAINS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedChain(c)}
                  className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                    selectedChain.id === c.id
                      ? 'bg-black text-white border-black font-bold shadow-xs'
                      : 'bg-stone-50 border-stone-200 hover:bg-stone-100 text-stone-700'
                  }`}
                >
                  <div className="text-sm">{c.icon}</div>
                  <div className="text-[10px] mt-0.5 truncate font-mono">{c.symbol}</div>
                </button>
              ))}
            </div>

            {/* Intent Deposit Address Input & Copy */}
            <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-stone-600 font-bold">
                  {selectedChain.name} Gateway
                </span>
                <span className="text-[10px] text-stone-400 flex items-center space-x-1">
                  <Zap className="w-3 h-3 text-stone-700" />
                  <span>Auto-Shielded</span>
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={intentDepositAddress}
                  className="flex-1 bg-white rounded-xl px-3 py-2 text-xs text-stone-900 font-mono border border-stone-200 focus:outline-none select-all"
                />
                <button
                  type="button"
                  onClick={handleCopyIntentAddress}
                  className="px-3.5 py-2 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1"
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

              <div className="flex items-center justify-between pt-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setShowQrCode(!showQrCode)}
                  className="text-xs text-stone-900 hover:underline font-mono font-bold flex items-center space-x-1 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>{showQrCode ? 'Hide QR' : 'Show QR'}</span>
                </button>
                <Link
                  to="/app/receive"
                  className="text-[11px] font-mono text-stone-500 hover:text-black flex items-center space-x-0.5"
                >
                  <span>Dedicated View</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {showQrCode && (
                <div className="p-3 bg-white rounded-xl border border-stone-200 flex flex-col items-center justify-center animate-fade-in mt-2">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                      intentDepositAddress
                    )}`}
                    alt="Deposit QR"
                    className="w-28 h-28 object-contain"
                  />
                  <span className="text-[10px] text-stone-400 font-mono mt-1">
                    Scan to send {selectedChain.name} assets
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 
          RIGHT COLUMN: Transactions on the Side (Always Visible)
        */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-3xl p-5 sm:p-6 bg-white border border-stone-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center space-x-2">
                <h3 className="font-display font-extrabold text-stone-950 text-base">
                  Transactions
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-bold">
                  {history.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => loadHistory()}
                disabled={isLoadingHistory}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg hover:bg-stone-50 transition-colors cursor-pointer"
                title="Refresh transactions"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Simple hairline list */}
            <div className="divide-y divide-stone-100">
              {history.length === 0 ? (
                <div className="py-12 text-center text-xs text-stone-400 font-mono">
                  No activity yet.
                </div>
              ) : (
                history.map((tx) => {
                  const isSent = tx.senderHandle === (user?.handle || 'cryptowhale');
                  return (
                    <div
                      key={tx.id}
                      className="py-3 flex items-center justify-between hover:bg-stone-50/70 rounded-xl px-2 transition-colors group"
                    >
                      {/* Left: Direction Icon + Handle */}
                      <div className="flex items-center space-x-2.5">
                        <div
                          className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 bg-stone-100 text-stone-800"
                        >
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

                      {/* Right: Amount, Status & Copy */}
                      <div className="flex items-center space-x-2">
                        <div className="text-right">
                          <div className="text-xs font-mono font-bold text-stone-900">
                            {isSent ? '-' : '+'}{tx.amount} {tx.token.symbol}
                          </div>
                          <span
                            className="text-[9px] font-mono uppercase font-bold px-1.5 py-0.2 rounded text-stone-600 bg-stone-100 border border-stone-200"
                          >
                            {tx.status}
                          </span>
                        </div>

                        {/* Quick Copy Link */}
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

            {/* Link to Dedicated History Page */}
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
