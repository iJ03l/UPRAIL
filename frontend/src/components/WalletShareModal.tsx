'use client';

import React, { useState } from 'react';
import {
  Copy,
  Check,
  Shield,
  ArrowSquareOut,
  QrCode,
  PaperPlaneTilt,
} from '@phosphor-icons/react';
import { TokenIcon } from './TokenIcon';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';
import { formatTokenAmount, formatUsd } from '../lib/api';
import { useToast } from './Toast';

export interface WalletSendReceipt {
  shareLink: string;
  amount: string;
  symbol: string;
  iconUrl?: string;
  destinationAddress: string;
  txHash?: string;
  amountUsd?: number | null;
}

interface WalletShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: WalletSendReceipt | null;
}

function shortenAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export const WalletShareModal: React.FC<WalletShareModalProps> = ({
  isOpen,
  onClose,
  receipt,
}) => {
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const { toast } = useToast();

  if (!receipt) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(receipt.shareLink);
    setCopied(true);
    toast('Share link copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const shortDest = shortenAddress(receipt.destinationAddress);
  const tweetText = encodeURIComponent(
    [
      `I just sent ${formatTokenAmount(receipt.amount)} ${receipt.symbol} to ${shortDest} on UPRAIL. Settled privately.`,
      '',
      'Receipt (proof of payment):',
      '',
      receipt.shareLink,
    ].join('\n')
  );
  const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
  const explorerUrl = receipt.txHash ? `https://nearblocks.io/txns/${receipt.txHash}` : null;

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      zIndexClass="z-50"
      maxWidthClass="sm:max-w-md"
      panelClassName="px-6 pt-2 pb-6 sm:p-7"
      showCloseButton
      closeLabel="Close wallet receipt"
      ariaLabel="Sent to Wallet"
    >
      {/* Header Badge */}
      <div className="flex items-center justify-center mb-4 pr-8 sm:pr-0">
        <Badge tone="neutral" icon={<Shield weight="fill" className="w-3 h-3" />}>
          Wallet Settlement Receipt
        </Badge>
      </div>

      {/* Title */}
      <div className="text-center space-y-1 mb-5">
        <h3 className="text-2xl font-extrabold text-stone-950 font-display">
          Sent to Wallet
        </h3>
        <p className="text-xs text-stone-500">
          Funds dispatched to{' '}
          <span className="text-stone-900 font-bold font-mono">{shortDest}</span>
        </p>
      </div>

      {/* Amount Card */}
      <div className="mb-4 p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center space-y-1">
        <div className="flex items-center justify-center space-x-2.5">
          <TokenIcon symbol={receipt.symbol} iconUrl={receipt.iconUrl} size="lg" />
          <span className="text-2xl font-extrabold text-stone-950 font-mono">
            {formatTokenAmount(receipt.amount)} {receipt.symbol}
          </span>
        </div>
        {typeof receipt.amountUsd === 'number' && (
          <div className="text-xs text-stone-500 font-mono">
            ≈ {formatUsd(receipt.amountUsd)} USD
          </div>
        )}
      </div>

      {/* Breakdown box */}
      <div className="mb-4 p-3.5 rounded-2xl bg-stone-50/50 border border-stone-200 space-y-2 text-xs font-mono">
        <div className="flex items-center justify-between gap-3">
          <span className="text-stone-500">Destination</span>
          <span className="font-bold text-stone-900 truncate max-w-[200px]" title={receipt.destinationAddress}>
            {shortDest}
          </span>
        </div>
        {receipt.txHash && (
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-stone-200/60">
            <span className="text-stone-500">Transaction</span>
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-stone-900 underline underline-offset-2 hover:text-black flex items-center space-x-1"
              >
                <span>{receipt.txHash.slice(0, 10)}…</span>
                <ArrowSquareOut weight="fill" className="w-3 h-3" />
              </a>
            ) : (
              <span className="font-bold text-stone-900">{receipt.txHash.slice(0, 12)}…</span>
            )}
          </div>
        )}
      </div>

      {/* Receipt link */}
      <div className="space-y-1.5 mb-4">
        <label className="text-[10px] font-mono uppercase tracking-wider text-stone-500 block">
          Proof of Transfer Link
        </label>
        <div className="flex items-center space-x-2">
          <input
            type="text"
            readOnly
            value={receipt.shareLink}
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

      {/* Actions */}
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
          <span>Share on 𝕏</span>
          <ArrowSquareOut weight="fill" className="w-3.5 h-3.5 ml-1 opacity-70" />
        </a>
      </div>

      {/* Privacy Note */}
      <div className="flex items-start space-x-2 p-3 rounded-2xl bg-stone-50 border border-stone-200 text-[11px] text-stone-600">
        <Shield weight="fill" className="w-4 h-4 text-stone-900 flex-shrink-0 mt-0.5" />
        <p>
          <strong>Safe to share:</strong> this receipt only proves a transfer happened. It never
          grants access to the funds or your account.
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
