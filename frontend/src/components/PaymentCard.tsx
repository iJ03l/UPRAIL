import React, { useState } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Share2,
  ArrowUpRight,
  Fingerprint,
} from 'lucide-react';
import { PaymentIntent } from '../types';

interface PaymentCardProps {
  payment: PaymentIntent;
  onShare?: (payment: PaymentIntent) => void;
  compact?: boolean;
}

export const PaymentCard: React.FC<PaymentCardProps> = ({
  payment,
  onShare,
  compact = false,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(payment.claimLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusBadge = () => {
    switch (payment.status) {
      case 'ready':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5"></span>
            Ready to Claim
          </span>
        );
      case 'claimed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            Claimed with Passkey
          </span>
        );
      case 'escrowed':
      case 'pending':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3.5 h-3.5 mr-1" />
            Locking in Escrow
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-700/50 text-slate-400 border border-slate-600">
            Expired
          </span>
        );
      default:
        return null;
    }
  };

  if (compact) {
    return (
      <div className="flex items-center justify-between p-3.5 rounded-xl bg-dark-card border border-dark-border hover:border-slate-700 transition-colors">
        <div className="flex items-center space-x-3">
          <img
            src={payment.token.iconUrl}
            alt={payment.token.symbol}
            className="w-8 h-8 rounded-full bg-slate-800"
          />
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-white">
                {payment.amount} {payment.token.symbol}
              </span>
              <span className="text-xs text-slate-400">
                to @{payment.recipientHandle}
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              {new Date(payment.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {getStatusBadge()}
          <button
            onClick={handleCopyLink}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Copy claim link"
          >
            {copied ? <Check className="w-4 h-4 text-brand-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-dark-card border border-dark-border shadow-xl p-5 sm:p-6 transition-all">
      {/* Top Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <img
              src={payment.token.iconUrl}
              alt={payment.token.symbol}
              className="w-12 h-12 rounded-full bg-slate-800 p-0.5 border border-slate-700"
            />
            <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-dark-card border border-dark-border">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-lg font-black text-white">
                {payment.amount} {payment.token.symbol}
              </h4>
              <span className="text-xs font-medium text-slate-400">
                (${payment.amountUsd.toFixed(2)})
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Confidential intent for{' '}
              <span className="font-semibold text-brand-400">
                @{payment.recipientHandle}
              </span>
            </p>
          </div>
        </div>

        <div>{getStatusBadge()}</div>
      </div>

      {/* Note / Memo */}
      {payment.memo && (
        <div className="mt-4 p-3 rounded-xl bg-dark-surface border border-dark-border/60 text-xs text-slate-300">
          <span className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">
            Confidential Note
          </span>
          "{payment.memo}"
        </div>
      )}

      {/* Security Info Grid */}
      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] bg-dark-surface/60 rounded-xl p-3 border border-dark-border/40">
        <div>
          <span className="text-slate-500 block">Sender</span>
          <span className="text-slate-300 font-medium font-mono">@{payment.senderHandle}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Claim Authentication</span>
          <span className="text-slate-300 font-medium flex items-center space-x-1">
            <Fingerprint className="w-3 h-3 text-cyan-400" />
            <span>NIST P-256 Passkey</span>
          </span>
        </div>
        {payment.shieldedTxHash && (
          <div className="col-span-2 pt-1 border-t border-dark-border/30">
            <span className="text-slate-500 block">NEAR Shielded Intent</span>
            <span className="text-slate-400 font-mono text-[10px] truncate block">
              {payment.shieldedTxHash}
            </span>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="mt-5 pt-4 border-t border-dark-border/60 flex items-center justify-between gap-3">
        <button
          onClick={handleCopyLink}
          className="flex-1 flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-dark-surface hover:bg-slate-800 text-slate-300 hover:text-white border border-dark-border text-xs font-semibold transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-brand-300">Link Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Link</span>
            </>
          )}
        </button>

        {onShare && (
          <button
            onClick={() => onShare(payment)}
            className="flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-brand-500/10 hover:bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-semibold transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share</span>
          </button>
        )}

        <a
          href={payment.claimLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center space-x-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
        >
          <span>Open</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};
