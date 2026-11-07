'use client';

import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Shield,
  ExternalLink,
  QrCode,
  Lock,
} from 'lucide-react';
import { TokenIcon } from './TokenIcon';
import { QRCodeDisplay } from './QRCodeDisplay';
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
  const [showQr, setShowQr] = useState(false);
  const { toast } = useToast();

  if (!isOpen || !receipt) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-[#0D0B0A] border border-[#2B211B] shadow-2xl p-5 sm:p-6 overflow-hidden max-h-[92vh] overflow-y-auto text-white">
        {/* Ambient Top Glow Line */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#E05326] to-transparent" />
        
        {/* Subtle Ambient Radial Lighting */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-orange-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

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
            <span className="w-2.5 h-2.5 rounded-full bg-[#00EC97] shadow-[0_0_8px_#00EC97]" />
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-stone-300">
              WALLET TRANSFER RECEIPT
            </span>
          </div>

          <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Dispatched</span>
          </div>
        </div>

        {/* Digital Payment Card Chassis */}
        <div className="relative rounded-2xl bg-gradient-to-b from-[#181310] to-[#120E0C] border border-[#2B211B] p-5 sm:p-6 mb-4 text-center overflow-hidden shadow-inner">
          <div className="absolute top-0 right-0 w-44 h-44 bg-orange-500/10 rounded-full blur-2xl pointer-events-none" />

          {/* Eyebrow */}
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#FF7D54] mb-1">
            CROSS-CHAIN SETTLEMENT
          </div>

          {/* Hero Amount & Asset Display */}
          <div className="flex items-center justify-center gap-2.5 my-2">
            <TokenIcon
              symbol={receipt.symbol}
              iconUrl={receipt.iconUrl}
              size="lg"
              className="w-10 h-10 shadow-lg"
            />
            <span className="font-display font-extrabold text-4xl sm:text-5xl text-white tracking-tight leading-none">
              {formatTokenAmount(receipt.amount)}
            </span>
            <span className="font-display font-bold text-2xl sm:text-3xl text-orange-400 leading-none">
              {receipt.symbol}
            </span>
          </div>

          {typeof receipt.amountUsd === 'number' && (
            <div className="text-xs text-stone-400 font-mono">
              ≈ {formatUsd(receipt.amountUsd)} USD
            </div>
          )}

          {/* Destination Pill */}
          <div className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-stone-900/90 border border-stone-800 text-xs font-mono text-stone-200">
            <span className="text-stone-400">To:</span>
            <span className="font-bold text-white" title={receipt.destinationAddress}>{shortDest}</span>
            <span className="text-stone-500">•</span>
            <span className="text-[11px] text-stone-400">External Address</span>
          </div>

          {/* Itemized Cryptographic Telemetry */}
          <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-2 text-left text-[11px] font-mono">
            <div>
              <span className="text-stone-500 uppercase tracking-wider text-[9px] block">Settlement Rail</span>
              <span className="text-stone-200 font-bold font-mono">1Click Intent Router</span>
            </div>

            <div>
              <span className="text-stone-500 uppercase tracking-wider text-[9px] block">Explorer Proof</span>
              {explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-stone-300 hover:text-white underline underline-offset-2 flex items-center space-x-1"
                >
                  <span>{receipt.txHash ? `${receipt.txHash.slice(0, 8)}…` : 'View Tx'}</span>
                  <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                </a>
              ) : (
                <span className="text-stone-400">{receipt.txHash ? `${receipt.txHash.slice(0, 8)}…` : 'Instant'}</span>
              )}
            </div>
          </div>

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
            <QRCodeDisplay value={receipt.shareLink} size={180} />
            <p className="text-[11px] font-mono text-stone-400 mt-2.5 text-center">
              Scan with mobile camera to view proof of payment
            </p>
          </div>
        )}

        {/* Receipt Link Row */}
        <div className="space-y-1.5 mb-3">
          <label className="text-[10px] font-mono uppercase tracking-wider text-stone-400 block">
            Proof of Transfer Link
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={receipt.shareLink}
              className="flex-1 bg-[#14100D] rounded-xl px-3 py-2.5 text-xs text-stone-200 font-mono border border-[#2B211B] focus:outline-hidden select-all"
            />
            <button
              onClick={handleCopy}
              className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-stone-100 text-[#0D0B0A] text-xs font-mono font-bold transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
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
        <div className="space-y-2 mb-3">
          <a
            href={twitterIntentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-[#E05326] hover:bg-[#C8461C] text-white font-mono font-bold text-xs tracking-wide transition-colors shadow-lg shadow-orange-950/40"
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

        {/* Safe to share note */}
        <div className="flex items-start space-x-2 p-3 rounded-xl bg-[#14100D] border border-[#2B211B] text-[11px] text-stone-400">
          <Lock className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
          <p>
            <strong className="text-stone-300">Safe to Share:</strong> this receipt proves an intent transfer was completed. It never exposes private passkey credentials or sender balances.
          </p>
        </div>

        {/* Done Button */}
        <button
          onClick={onClose}
          className="mt-3 w-full py-2 text-xs font-mono font-bold text-stone-400 hover:text-white transition-colors cursor-pointer text-center"
        >
          Close Card
        </button>
      </div>
    </div>
  );
};
