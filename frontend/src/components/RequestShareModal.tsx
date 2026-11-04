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

  const tweetText = encodeURIComponent(
    [
      `Hey @${request.requested_handle},`,
      '',
      `I requested a payment of ${request.amount_formatted} on @uprailworld.`,
      request.memo ? `Memo: "${request.memo}"` : '',
      '',
      'View, accept, or decline securely without creating a wallet:',
      shareLink,
    ].filter(Boolean).join('\n')
  );
  const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6 sm:p-7 overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 flex items-center justify-center text-orange-600 dark:text-orange-400 shadow-xs">
            <ArrowDownLeft className="w-7 h-7" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-1 mb-5">
          <h3 className="text-xl font-extrabold text-stone-950 dark:text-white font-display">
            Request Created!
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400 font-sans">
            Share this link with @{request.requested_handle} to receive payment
          </p>
        </div>

        {/* Summary Card */}
        <div className="rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 p-4 mb-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-stone-500 dark:text-stone-400">Target</span>
            <span className="font-bold text-stone-900 dark:text-white">@{request.requested_handle}</span>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-stone-500 dark:text-stone-400">Amount</span>
            <span className="font-bold text-stone-900 dark:text-white text-sm">{request.amount_formatted}</span>
          </div>
          {request.memo && (
            <div className="flex items-start justify-between text-xs font-mono pt-1 border-t border-stone-200/60 dark:border-stone-800/60">
              <span className="text-stone-500 dark:text-stone-400">Memo</span>
              <span className="text-stone-800 dark:text-stone-200 text-right max-w-[200px] truncate">{request.memo}</span>
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
            <span>Post on 𝕏</span>
          </a>
        </div>
      </div>
    </div>
  );
};
