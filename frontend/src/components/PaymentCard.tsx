'use client';

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
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-black text-white border border-black">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse mr-1.5"></span>
            Ready to Claim
          </span>
        );
      case 'claimed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-900 border border-stone-300">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-stone-900" />
            Claimed
          </span>
        );
      case 'escrowed':
      case 'pending':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-700 border border-stone-200">
            <Clock className="w-3.5 h-3.5 mr-1 text-stone-600" />
            Open Intent
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-500 border border-stone-200">
            Expired
          </span>
        );
      default:
        return null;
    }
  };

  if (compact) {
    return (
      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white border border-stone-200 hover:border-stone-300 transition-colors shadow-sm">
        <div className="flex items-center space-x-3">
          <img
            src={payment.token.iconUrl}
            alt={payment.token.symbol}
            className="w-8 h-8 rounded-full bg-stone-100 border border-stone-200"
          />
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-stone-900 font-mono">
                {payment.amount} {payment.token.symbol}
              </span>
              <span className="text-xs text-stone-500">
                to @{payment.recipientHandle}
              </span>
            </div>
            <span className="text-[11px] font-mono text-stone-400">
              {new Date(payment.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {getStatusBadge()}
          <button
            onClick={handleCopyLink}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
            title="Copy claim link"
          >
            {copied ? <Check className="w-4 h-4 text-stone-900" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-3xl bg-white border border-stone-200 shadow-md p-5 sm:p-6 transition-all hover:shadow-lg">
      {/* Top Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <img
              src={payment.token.iconUrl}
              alt={payment.token.symbol}
              className="w-12 h-12 rounded-full bg-stone-100 p-0.5 border border-stone-200"
            />
            <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-white border border-stone-200 shadow-sm">
              <ShieldCheck className="w-4 h-4 text-stone-800" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-lg font-black text-stone-950 font-display">
                {payment.amount} {payment.token.symbol}
              </h4>
              <span className="text-xs font-medium text-stone-500 font-mono">
                (${payment.amountUsd.toFixed(2)})
              </span>
            </div>
            <p className="text-xs text-stone-600 mt-0.5">
              Payment for{' '}
              <span className="font-bold text-stone-900 font-mono">
                @{payment.recipientHandle}
              </span>
            </p>
          </div>
        </div>

        <div>{getStatusBadge()}</div>
      </div>

      {/* Note / Memo */}
      {payment.memo && (
        <div className="mt-4 p-3 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-800">
          <span className="text-stone-400 font-bold uppercase text-[10px] block mb-0.5">
            Private Note
          </span>
          "{payment.memo}"
        </div>
      )}

      {/* Security Info Grid */}
      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] bg-stone-50 rounded-2xl p-3 border border-stone-200 font-mono">
        <div>
          <span className="text-stone-400 block">Sender</span>
          <span className="text-stone-800 font-bold">@{payment.senderHandle}</span>
        </div>
        <div>
          <span className="text-stone-400 block">Claim Method</span>
          <span className="text-stone-800 font-bold flex items-center space-x-1">
            <Fingerprint className="w-3 h-3 text-stone-700" />
            <span>Device Passkey</span>
          </span>
        </div>
      </div>

      {/* Action Footer */}
      <div className="mt-5 pt-4 border-t border-stone-200 flex items-center justify-between gap-3">
        <button
          onClick={handleCopyLink}
          className="flex-1 flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 text-xs font-bold transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-stone-900" />
              <span className="text-stone-900">Link Copied!</span>
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
            className="flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 text-xs font-bold transition-colors cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share</span>
          </button>
        )}

        <a
          href={payment.claimLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center space-x-1 py-2.5 px-3 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors"
        >
          <span>Open</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};
