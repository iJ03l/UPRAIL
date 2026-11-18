'use client';

import React, { useState } from 'react';
import {
  Copy,
  Check,
  Shield,
  ArrowSquareOut,
  QrCode,
  Sparkle,
} from '@phosphor-icons/react';
import { PaymentIntent } from '../types';
import { TokenIcon } from './TokenIcon';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';
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

  if (!payment) return null;

  const isDirect = payment.isDirect || payment.status === 'claimed';
  const displayAmount = payment.amount;
  const displayAmountUsd = payment.amountUsd ?? null;

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
          `I sent you ${formatTokenAmount(displayAmount)} ${payment.token.symbol} on UPRAIL. It’s already in your account.`,
          '',
          'Open the receipt (no wallet needed):',
          '',
          payment.claimLink,
        ].join('\n')
      : [
          `Hey @${payment.recipientHandle},`,
          '',
          `I sent you ${formatTokenAmount(displayAmount)} ${payment.token.symbol} on UPRAIL. It’s waiting for you.`,
          '',
          'Sign in with X, then confirm with your passkey (no crypto wallet needed):',
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
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      zIndexClass="z-50"
      maxWidthClass="sm:max-w-md"
      panelClassName="px-6 pt-2 pb-6 sm:p-7"
      showCloseButton
      closeLabel="Close settlement receipt"
      ariaLabel={isDirect ? 'Payment Delivered' : 'Payment Dispatched'}
    >
      {/* Receipt Header Badge */}
      <div className="flex items-center justify-center mb-4 pr-8 sm:pr-0">
        <Badge tone="neutral" icon={<Shield weight="fill" className="w-3 h-3" />}>
          UPRAIL Settlement Receipt
        </Badge>
      </div>

      {/* Title */}
      <div className="text-center space-y-1 mb-5">
        <h3 className="text-2xl font-extrabold text-stone-950 font-display">
          {isDirect ? 'Payment Delivered' : 'Payment Dispatched'}
        </h3>
        <p className="text-xs text-stone-500">
          {isDirect ? (
            <>
              Funds deposited directly into{' '}
              <span className="text-stone-900 font-bold font-mono">
                @{payment.recipientHandle}
              </span>
              ’s vault.
            </>
          ) : (
            <>
              Reserved in escrow for{' '}
              <span className="text-stone-900 font-bold font-mono">
                @{payment.recipientHandle}
              </span>.
            </>
          )}
        </p>
      </div>

      {/* Prominent Amount Ticket Card */}
      <div className="mb-4 p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center space-y-1">
        <div className="flex items-center justify-center space-x-2.5">
          <TokenIcon
            symbol={payment.token.symbol}
            iconUrl={payment.token.iconUrl}
            size="lg"
          />
          <span className="text-2xl font-extrabold text-stone-950 font-mono">
            {formatTokenAmount(displayAmount)} {payment.token.symbol}
          </span>
        </div>
        {displayAmountUsd != null && (
          <div className="text-xs text-stone-500 font-mono">
            ≈ {formatUsd(displayAmountUsd)} USD
          </div>
        )}
      </div>

      {/* Itemized Breakdown Table */}
      <div className="rounded-2xl border border-stone-200 bg-stone-50/50 p-3.5 mb-4 space-y-2 text-xs font-mono">
        <div className="flex items-center justify-between">
          <span className="text-stone-500">Recipient</span>
          <span className="font-bold text-stone-900">@{payment.recipientHandle}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-stone-500">Settlement Rail</span>
          <span className="font-bold text-stone-800">
            {isDirect ? 'Direct Vault Transfer' : 'Confidential Escrow'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-stone-500">Status</span>
          <Badge tone={isDirect ? 'ok' : 'warn'}>
            {isDirect ? 'Delivered to Vault' : 'Waiting Claim'}
          </Badge>
        </div>

        {payment.fee && parseFloat(payment.fee) > 0 && (
          <>
            <div className="flex items-center justify-between pt-1 border-t border-stone-200/60">
              <span className="text-stone-500">Protocol Fee (1%)</span>
              <span className="text-stone-700">
                {payment.fee} {payment.token.symbol}
              </span>
            </div>
            {payment.grossAmount && (
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Total Debited</span>
                <span className="text-stone-700 font-bold">
                  {formatTokenAmount(payment.grossAmount)} {payment.token.symbol}
                </span>
              </div>
            )}
          </>
        )}

        {payment.memo && (
          <div className="flex items-start justify-between pt-1 border-t border-stone-200/60">
            <span className="text-stone-500 flex-shrink-0 mr-2">Memo</span>
            <span className="text-stone-800 text-right truncate max-w-[210px]">
              "{payment.memo}"
            </span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-stone-200/60">
          <span className="text-stone-500">Timestamp</span>
          <span className="text-stone-600 text-[11px]">{dateFormatted}</span>
        </div>

        {payment.id && (
          <div className="flex items-center justify-between pt-1 border-t border-stone-200/60">
            <span className="text-stone-500">Payment ID</span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(payment.id);
                toast('Payment ID copied');
              }}
              className="inline-flex items-center space-x-1 text-stone-700 hover:text-black cursor-pointer"
              title="Copy Payment ID"
            >
              <span>{shortPaymentId}</span>
              <Copy weight="fill" className="w-3 h-3 text-stone-400" />
            </button>
          </div>
        )}
      </div>

      {/* Link / URL Row */}
      <div className="space-y-1.5 mb-4">
        <label className="text-[10px] font-mono uppercase tracking-wider text-stone-500 block">
          {isDirect ? 'Proof of Payment Link' : 'Passkey Claim Link'}
        </label>
        <div className="flex items-center space-x-2">
          <input
            type="text"
            readOnly
            value={payment.claimLink}
            className="flex-1 min-w-0 bg-stone-50 rounded-xl px-3 py-2.5 text-xs text-stone-800 font-mono border border-stone-200 focus:outline-hidden select-all"
          />
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1.5 min-h-11 px-3.5 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-mono font-bold transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check weight="bold" className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy weight="fill" className="w-3.5 h-3.5" />
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
          className="w-full min-h-11 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-black hover:bg-stone-800 text-white font-mono font-bold text-xs transition-colors shadow-xs"
        >
          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span>Notify @{payment.recipientHandle} on 𝕏</span>
          <ArrowSquareOut weight="fill" className="w-3.5 h-3.5 ml-1 opacity-70" />
        </a>
      </div>

      {/* Privacy Note */}
      <div className="flex items-start space-x-2 p-3 rounded-2xl bg-stone-50 border border-stone-200 text-[11px] text-stone-600">
        <Shield weight="fill" className="w-4 h-4 text-stone-900 flex-shrink-0 mt-0.5" />
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
        className="mt-4 w-full min-h-11 py-2.5 text-xs font-mono font-bold text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
      >
        Close Receipt
      </button>
    </ModalSheet>
  );
};
