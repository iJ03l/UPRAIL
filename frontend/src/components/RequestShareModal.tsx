'use client';

import React, { useState } from 'react';
import { X, Copy, Check, ArrowDownLeft, Share2, ExternalLink } from 'lucide-react';
import type { PaymentRequest } from '../types';
import { useToast } from './Toast';

interface RequestShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: PaymentRequest | null;
}

export const RequestShareModal: React.FC<RequestShareModalProps> = ({
  isOpen,
  onClose,
  request,
}) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!isOpen || !request) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.uprail.world';
  const shareLink = `${origin}/request/${request.id}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    toast('Request link copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const shortMemo = request.memo
    ? request.memo.length > 50
      ? `${request.memo.slice(0, 47)}…`
      : request.memo
    : null;

  const cleanAmount = (() => {
    let raw = request.amount_formatted || `${request.amount} ${request.asset}`;
    if (
      raw.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1') ||
      raw.toLowerCase().includes('nep141:') ||
      /^[0-9a-f]{64}/i.test(raw.split(' ').pop() || '')
    ) {
      return `${request.amount} USDC`;
    }
    return raw;
  })();

  const tweetText = encodeURIComponent(
    [
      `Hey @${request.requested_handle}, I sent you a payment request for ${cleanAmount} on UPRAIL.`,
      '',
      shortMemo ? `Memo: "${shortMemo}"` : '',
      'You can view, accept, or decline here (no wallet needed):',
      shareLink,
    ].filter(Boolean).join('\n')
  );
  const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6 sm:p-7 overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Eyebrow Badge */}
        <div className="flex items-center justify-center mb-3">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-[10px] font-mono font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">
            <span>PAYMENT REQUEST</span>
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-1 mb-5">
          <h3 className="text-2xl font-extrabold text-stone-950 dark:text-white font-display">
            Request Created!
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400 font-sans">
            Share this link with <span className="font-bold font-mono text-stone-900 dark:text-white">@{request.requested_handle}</span>. They can accept or decline in one biometric tap (no crypto wallet needed).
          </p>
        </div>

        {/* Minimal Summary Card */}
        <div className="rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 p-4 mb-5 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-stone-500 dark:text-stone-400">Recipient</span>
            <span className="font-bold text-stone-900 dark:text-white">@{request.requested_handle}</span>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-stone-500 dark:text-stone-400">Amount</span>
            <span className="font-bold text-stone-900 dark:text-white text-base">{cleanAmount}</span>
          </div>
          {shortMemo && (
            <div className="flex items-start justify-between text-xs font-mono pt-2 border-t border-stone-200/60 dark:border-stone-800/60">
              <span className="text-stone-500 dark:text-stone-400 flex-shrink-0 mr-2">Memo</span>
              <span className="text-stone-800 dark:text-stone-200 text-right truncate max-w-[210px] font-sans italic" title={request.memo || ''}>
                “{shortMemo}”
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={handleCopy}
            className="w-full py-3.5 px-4 rounded-2xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-xs"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400 dark:text-emerald-600" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied Link' : 'Copy Request Link'}</span>
          </button>

          <a
            href={twitterIntentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3.5 px-4 rounded-2xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-900 dark:text-white text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>Share on 𝕏</span>
          </a>
        </div>
      </div>
    </div>
  );
};
