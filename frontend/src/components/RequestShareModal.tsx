'use client';

import React, { useState } from 'react';
import { Copy, Check, ArrowDownLeft, ShareNetwork, ArrowSquareOut } from '@phosphor-icons/react';
import type { PaymentRequest } from '../types';
import { useToast } from './Toast';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';

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

  if (!request) return null;

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
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      zIndexClass="z-50"
      maxWidthClass="sm:max-w-md"
      panelClassName="px-6 pt-2 pb-6 sm:p-7"
      showCloseButton
      closeLabel="Close request share dialog"
      ariaLabel="Payment Request Created"
    >
      {/* Eyebrow Badge */}
      <div className="flex items-center justify-center mb-3 pr-8 sm:pr-0">
        <Badge tone="neutral">PAYMENT REQUEST</Badge>
      </div>

      {/* Title */}
      <div className="text-center space-y-1 mb-5">
        <h3 className="text-2xl font-extrabold text-stone-950 font-display">
          Request Created!
        </h3>
        <p className="text-xs text-stone-500 font-sans">
          Share this link with <span className="font-bold font-mono text-stone-900">@{request.requested_handle}</span>. They can accept or decline in one biometric tap (no crypto wallet needed).
        </p>
      </div>

      {/* Minimal Summary Card */}
      <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4 mb-5 space-y-2.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-stone-500">Recipient</span>
          <span className="font-bold text-stone-900">@{request.requested_handle}</span>
        </div>
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-stone-500">Amount</span>
          <span className="font-bold text-stone-900 text-base">{cleanAmount}</span>
        </div>
        {shortMemo && (
          <div className="flex items-start justify-between text-xs font-mono pt-2 border-t border-stone-200/60">
            <span className="text-stone-500 flex-shrink-0 mr-2">Memo</span>
            <span className="text-stone-800 text-right truncate max-w-[210px] font-sans italic" title={request.memo || ''}>
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
          className="w-full min-h-11 py-3.5 px-4 rounded-2xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-xs"
        >
          {copied ? <Check weight="bold" className="w-4 h-4 text-emerald-400" /> : <Copy weight="fill" className="w-4 h-4" />}
          <span>{copied ? 'Copied Link' : 'Copy Request Link'}</span>
        </button>

        <a
          href={twitterIntentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full min-h-11 py-3.5 px-4 rounded-2xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-900 text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer"
        >
          <ShareNetwork weight="fill" className="w-4 h-4" />
          <span>Share on 𝕏</span>
        </a>
      </div>
    </ModalSheet>
  );
};
