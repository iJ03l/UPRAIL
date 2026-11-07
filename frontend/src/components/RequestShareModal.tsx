'use client';

import React, { useState } from 'react';
import { X, Copy, Check, Share2, ExternalLink, QrCode } from 'lucide-react';
import type { PaymentRequest } from '../types';
import { QRCodeDisplay } from './QRCodeDisplay';
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
  const [showQr, setShowQr] = useState(false);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-[#0D0B0A] border border-[#2B211B] shadow-2xl p-5 sm:p-6 overflow-hidden max-h-[92vh] overflow-y-auto text-white">
        {/* Ambient Top Glow Line */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#E05326] to-transparent" />
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-orange-600/15 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Card Header Row */}
        <div className="flex items-center justify-between mb-4 pr-8">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF7D54] shadow-[0_0_8px_#FF7D54]" />
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-stone-300">
              PAYMENT REQUEST
            </span>
          </div>

          <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider bg-orange-500/15 border border-orange-500/30 text-orange-400">
            <span>Pending Dispatch</span>
          </div>
        </div>

        {/* Digital Payment Card Chassis */}
        <div className="relative rounded-2xl bg-gradient-to-b from-[#181310] to-[#120E0C] border border-[#2B211B] p-5 sm:p-6 mb-4 text-center overflow-hidden shadow-inner">
          <div className="absolute top-0 right-0 w-44 h-44 bg-orange-500/10 rounded-full blur-2xl pointer-events-none" />

          {/* Eyebrow */}
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#FF7D54] mb-1">
            REQUESTED AMOUNT
          </div>

          {/* Hero Amount & Asset Display */}
          <div className="flex items-center justify-center gap-2.5 my-2">
            <span className="font-display font-extrabold text-4xl sm:text-5xl text-white tracking-tight leading-none">
              {cleanAmount}
            </span>
          </div>

          {/* Recipient Pill */}
          <div className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-stone-900/90 border border-stone-800 text-xs font-mono text-stone-200">
            <span className="text-stone-400">For:</span>
            <span className="font-bold text-white">@{request.requested_handle}</span>
            <span className="text-stone-500">•</span>
            <span className="text-[11px] text-stone-400">Biometric Claim</span>
          </div>

          {/* Memo (if present) */}
          {shortMemo && (
            <div className="mt-3 p-2.5 rounded-xl bg-black/40 border border-white/5 text-xs text-stone-300 italic font-sans max-w-full text-center truncate">
              “{shortMemo}”
            </div>
          )}

          {/* Railway Graphic */}
          <div className="mt-5 pt-3 border-t border-white/5 flex items-center justify-between">
            <span className="text-[10px] font-mono text-stone-500 tracking-wider">app.uprail.world</span>
            <div className="flex items-center space-x-1.5 flex-1 max-w-[140px] mx-3">
              <span className="w-2 h-2 rounded-full bg-[#E05326]" />
              <span className="flex-1 border-t border-dashed border-stone-700" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#00C1DE]" />
              <span className="flex-1 border-t border-dashed border-stone-700" />
              <span className="w-2 h-2 rounded-full bg-[#00EC97]" />
            </div>
            <span className="text-[9px] font-mono text-stone-500 tracking-wider uppercase">NEAR Intents</span>
          </div>
        </div>

        {/* QR Code Container (Conditional) */}
        {showQr && (
          <div className="mb-4 p-4 rounded-2xl bg-[#14100D] border border-[#2B211B] flex flex-col items-center justify-center animate-fade-in">
            <QRCodeDisplay value={shareLink} size={180} />
            <p className="text-[11px] font-mono text-stone-400 mt-2.5 text-center">
              Scan with mobile camera to view or pay request
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2 mb-3">
          <button
            type="button"
            onClick={handleCopy}
            className="w-full py-3 px-4 rounded-xl bg-white hover:bg-stone-100 text-[#0D0B0A] text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-sm"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied Request Link' : 'Copy Request Link'}</span>
          </button>

          <a
            href={twitterIntentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 px-4 rounded-xl bg-[#E05326] hover:bg-[#C8461C] text-white text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-lg shadow-orange-950/40"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span>Share on 𝕏</span>
            <ExternalLink className="w-3.5 h-3.5 ml-1 opacity-80" />
          </a>

          <button
            type="button"
            onClick={() => setShowQr(!showQr)}
            className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-stone-300 hover:text-white font-mono text-xs transition-colors cursor-pointer border border-white/5"
          >
            <QrCode className="w-3.5 h-3.5 text-stone-400" />
            <span>{showQr ? 'Hide QR Code' : 'Show Mobile QR Code'}</span>
          </button>
        </div>

        {/* Done Button */}
        <button
          onClick={onClose}
          className="mt-2 w-full py-2 text-xs font-mono font-bold text-stone-400 hover:text-white transition-colors cursor-pointer text-center"
        >
          Close
        </button>
      </div>
    </div>
  );
};
