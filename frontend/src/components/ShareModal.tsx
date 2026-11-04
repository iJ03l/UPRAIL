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
import { formatTokenAmount, formatUsd } from '../lib/api';
import { useToast } from './Toast';

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
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  if (!isOpen || !payment) return null;

  const isDirect = payment.isDirect || payment.status === 'claimed';
  const displayAmount = payment.grossAmount || (() => {
    const net = parseFloat(payment.amount) || 0;
    const fee = parseFloat(payment.fee || '0') || 0;
    return fee > 0 ? Number((net + fee).toFixed(8)).toString() : payment.amount;
  })();
  const displayAmountUsd = payment.grossAmountUsd ?? (() => {
    if (payment.amountUsd == null) return null;
    return payment.amountUsd + (payment.feeUsd || 0);
  })();

  const handleCopy = () => {
    if (payment.claimLink) {
      navigator.clipboard.writeText(payment.claimLink);
      setCopied(true);
      toast('Payment link copied');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const tweetText = encodeURIComponent(
    isDirect
      ? [
          `Hey @${payment.recipientHandle},`,
          '',
          `I sent you ${formatTokenAmount(displayAmount)} ${payment.token.symbol} on UPRAIL — it’s already in your account.`,
          '',
          'Open the receipt — no wallet needed:',
          '',
          payment.claimLink,
        ].join('\n')
      : [
          `Hey @${payment.recipientHandle},`,
          '',
          `I sent you ${formatTokenAmount(displayAmount)} ${payment.token.symbol} on UPRAIL — it’s waiting for you.`,
          '',
          'Sign in with X, then confirm with your passkey — no crypto wallet needed.',
          '',
          payment.claimLink,
        ].join('\n')
  );
  const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;

  const shortPaymentId = payment.id ? `${payment.id.slice(0, 8)}…${payment.id.slice(-6)}` : '';
  const dateFormatted = payment.createdAt ? new Date(payment.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) : 'Just now';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6 sm:p-7 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Receipt Header Badge */}
        <div className="flex items-center justify-center mb-4">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
            <Shield className="w-3.5 h-3.5 text-stone-900 dark:text-white" />
            <span>UPRAIL Settlement Receipt</span>
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-1 mb-5">
          <h3 className="text-2xl font-extrabold text-stone-950 dark:text-white font-display">
            {isDirect ? 'Payment Delivered' : 'Payment Dispatched'}
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {isDirect ? (
              <>
                Funds deposited directly into{' '}
                <span className="text-stone-900 dark:text-white font-bold font-mono">
                  @{payment.recipientHandle}
                </span>
                ’s vault.
              </>
            ) : (
              <>
                Reserved in escrow for{' '}
                <span className="text-stone-900 dark:text-white font-bold font-mono">
                  @{payment.recipientHandle}
                </span>.
              </>
            )}
          </p>
        </div>

        {/* Prominent Amount Ticket Card */}
        <div className="mb-4 p-4 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-center space-y-1">
          <div className="flex items-center justify-center space-x-2.5">
            <TokenIcon
              symbol={payment.token.symbol}
              iconUrl={payment.token.iconUrl}
              size="lg"
            />
            <span className="text-2xl font-extrabold text-stone-950 dark:text-white font-mono">
              {formatTokenAmount(displayAmount)} {payment.token.symbol}
            </span>
          </div>
          {displayAmountUsd != null && (
            <div className="text-xs text-stone-500 dark:text-stone-400 font-mono">
              ≈ {formatUsd(displayAmountUsd)} USD
            </div>
          )}
        </div>

        {/* Itemized Breakdown Table */}
        <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-950/50 p-3.5 mb-4 space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between">
            <span className="text-stone-500 dark:text-stone-400">Recipient</span>
            <span className="font-bold text-stone-900 dark:text-white">@{payment.recipientHandle}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-stone-500 dark:text-stone-400">Settlement Rail</span>
            <span className="font-bold text-stone-800 dark:text-stone-200">
              {isDirect ? 'Direct Vault Transfer' : 'Confidential Escrow'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-stone-500 dark:text-stone-400">Status</span>
            <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
              isDirect
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20'
            }`}>
              {isDirect ? 'Delivered to Vault' : 'Waiting Claim'}
            </span>
          </div>

          {payment.fee && parseFloat(payment.fee) > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-stone-200/60 dark:border-stone-800/60">
              <span className="text-stone-500 dark:text-stone-400">Protocol Fee (1%)</span>
              <span className="text-stone-700 dark:text-stone-300">
                {payment.fee} {payment.token.symbol}
              </span>
            </div>
          )}

          {payment.memo && (
            <div className="flex items-start justify-between pt-1 border-t border-stone-200/60 dark:border-stone-800/60">
              <span className="text-stone-500 dark:text-stone-400 flex-shrink-0 mr-2">Memo</span>
              <span className="text-stone-800 dark:text-stone-200 text-right truncate max-w-[210px]">
                "{payment.memo}"
              </span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1 border-t border-stone-200/60 dark:border-stone-800/60">
            <span className="text-stone-500 dark:text-stone-400">Timestamp</span>
            <span className="text-stone-600 dark:text-stone-400 text-[11px]">{dateFormatted}</span>
          </div>

          {payment.id && (
            <div className="flex items-center justify-between pt-1 border-t border-stone-200/60 dark:border-stone-800/60">
              <span className="text-stone-500 dark:text-stone-400">Payment ID</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(payment.id);
                  toast('Payment ID copied');
                }}
                className="inline-flex items-center space-x-1 text-stone-700 dark:text-stone-300 hover:text-black dark:hover:text-white cursor-pointer"
                title="Copy Payment ID"
              >
                <span>{shortPaymentId}</span>
                <Copy className="w-3 h-3 text-stone-400" />
              </button>
            </div>
          )}
        </div>

        {/* Link / URL Row */}
        <div className="space-y-1.5 mb-4">
          <label className="text-[10px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block">
            {isDirect ? 'Proof of Payment Link' : 'Passkey Claim Link'}
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={payment.claimLink}
              className="flex-1 bg-stone-50 dark:bg-stone-950 rounded-xl px-3 py-2.5 text-xs text-stone-800 dark:text-stone-200 font-mono border border-stone-200 dark:border-stone-800 focus:outline-hidden select-all"
            />
            <button
              onClick={handleCopy}
              className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 text-xs font-mono font-bold transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600" />
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

        {/* Action Buttons */}
        <div className="space-y-2 mb-4">
          <a
            href={twitterIntentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 font-mono font-bold text-xs transition-colors shadow-xs"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span>Notify @{payment.recipientHandle} on 𝕏</span>
            <ExternalLink className="w-3.5 h-3.5 ml-1 opacity-70" />
          </a>
        </div>

        {/* Privacy Note */}
        <div className="flex items-start space-x-2 p-3 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-[11px] text-stone-600 dark:text-stone-400">
          <Shield className="w-4 h-4 text-stone-900 dark:text-white flex-shrink-0 mt-0.5" />
          <p>
            <strong>Private & Non-Custodial.</strong>{' '}
            {isDirect
              ? 'Funds were moved directly into the recipient’s vault. Only their passkey can authorize withdrawals.'
              : 'Escrowed securely. Only @' + payment.recipientHandle + ' can claim this payment via their biometric passkey.'}
          </p>
        </div>

        {/* Done Button */}
        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 text-xs font-mono font-bold text-stone-500 hover:text-stone-900 dark:hover:text-white transition-colors cursor-pointer"
        >
          Close Receipt
        </button>
      </div>
    </div>
  );
};
