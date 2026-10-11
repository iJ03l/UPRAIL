'use client';

import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Shield,
  ExternalLink,
  QrCode,
  Sparkles,
} from 'lucide-react';
import { PaymentIntent } from '../types';
import { TokenIcon } from './TokenIcon';
import { formatUsd } from '../lib/api';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  payment: PaymentIntent | null;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  payment,
}) => {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  if (!isOpen || !payment) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(payment.claimLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tweetText = encodeURIComponent(
    `Hey @${payment.recipientHandle}, I sent you ${payment.amount} ${payment.token.symbol} on UP! Claim it instantly with your device passkey: ${payment.claimLink}`
  );
  const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 shadow-2xl p-6 sm:p-7 overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-900 shadow-sm">
            <Sparkles className="w-7 h-7" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-1 mb-5">
          <h3 className="text-xl font-extrabold text-stone-950 font-display">Payment Ready!</h3>
          <p className="text-xs text-stone-600">
            Share the claim link with{' '}
            <span className="text-stone-900 font-bold font-mono">
              @{payment.recipientHandle}
            </span>{' '}
            to collect their funds.
          </p>
        </div>

        {/* Payment Summary Pill */}
        <div className="mb-5 p-3 rounded-2xl bg-stone-50 border border-stone-200 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <TokenIcon
              symbol={payment.token.symbol}
              iconUrl={payment.token.iconUrl}
              size="lg"
            />
            <div>
              <span className="text-sm font-extrabold text-stone-950 font-mono">
                {payment.amount} {payment.token.symbol}
              </span>
              <span className="text-xs text-stone-500 block font-mono">
                ≈ {formatUsd(payment.amountUsd)} USD
              </span>
            </div>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-stone-100 text-stone-900 border border-stone-200 font-bold">
            Private Escrow
          </span>
        </div>

        {/* Claim Link Input */}
        <div className="space-y-1.5 mb-4">
          <label className="text-[11px] font-bold uppercase tracking-wider text-stone-600">
            Secure Claim Link
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={payment.claimLink}
              className="flex-1 bg-stone-50 rounded-xl px-3 py-2.5 text-xs text-stone-800 font-mono border border-stone-200 focus:outline-none select-all"
            />
            <button
              onClick={handleCopy}
              className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              {copied ? (
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
        </div>

        {/* Preloaded Invite Code Notice */}
        <div className="mb-4 p-3 rounded-2xl bg-stone-50 border border-stone-200 flex items-center justify-between text-xs font-mono">
          <span className="text-stone-500 text-[11px]">VIP Invite Attached:</span>
          <span className="font-bold text-stone-900 bg-white px-2 py-0.5 rounded border border-stone-200">
            {payment.inviteCode || (payment.claimLink.includes('invite=') ? payment.claimLink.split('invite=')[1] : 'INCLUDED')}
          </span>
          <span className="text-[10px] text-stone-400">Preloaded for Recipient</span>
        </div>

        {/* Actions */}
        <div className="space-y-2 mb-5">
          <a
            href={twitterIntentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-black hover:bg-stone-800 text-white font-extrabold text-xs transition-colors shadow-sm"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span>Notify @{payment.recipientHandle} on 𝕏</span>
            <ExternalLink className="w-3.5 h-3.5 ml-1 opacity-70" />
          </a>

          <button
            onClick={() => setShowQr(!showQr)}
            className="w-full flex items-center justify-center space-x-1.5 py-2.5 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold border border-stone-200 transition-colors cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5 text-stone-500" />
            <span>{showQr ? 'Hide Claim Link' : 'Show Claim Link'}</span>
          </button>
        </div>

        {/* Claim link card — rendered fully client-side. No third-party QR
            service is used: those services receive the URL being encoded,
            which would leak the payment id + invite code. */}
        {showQr && (
          <div className="p-4 rounded-2xl bg-white border border-stone-200 flex flex-col mb-4 animate-fade-in">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">
              Claim Link
            </span>
            <p className="text-[11px] font-mono text-stone-700 break-all bg-stone-50 border border-stone-200 rounded-lg p-2 select-all">
              {payment.claimLink}
            </p>
            <span className="text-[10px] text-stone-400 mt-1.5">
              Shown locally — never sent to a third-party QR service
            </span>
          </div>
        )}

        {/* Privacy Note */}
        <div className="flex items-start space-x-2 p-3 rounded-2xl bg-stone-50 border border-stone-200 text-[11px] text-stone-700">
          <Shield className="w-4 h-4 text-stone-900 flex-shrink-0 mt-0.5" />
          <p>
            <strong>Zero risk:</strong> Even if this link is shared publicly, only the device passkey belonging to <span className="font-bold text-stone-900 font-mono">@{payment.recipientHandle}</span> can unlock the funds.
          </p>
        </div>

        {/* Done Button */}
        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 text-xs font-bold text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  );
};
