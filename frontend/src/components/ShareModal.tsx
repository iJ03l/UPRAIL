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
  Lock,
} from 'lucide-react';
import { PaymentIntent } from '../types';
import { TokenIcon } from './TokenIcon';
import { QRCodeDisplay } from './QRCodeDisplay';
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
            <span className="w-2.5 h-2.5 rounded-full bg-[#E05326] shadow-[0_0_8px_#E05326]" />
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-stone-300">
              UPRAIL VALUE CARD
            </span>
          </div>

          <div className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider ${
            isDirect
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
              : 'bg-orange-500/15 border border-orange-500/30 text-orange-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isDirect ? 'bg-emerald-400' : 'bg-orange-400'}`} />
            <span>{isDirect ? 'Delivered' : 'Waiting Claim'}</span>
          </div>
        </div>

        {/* Digital Payment Card Chassis */}
        <div className="relative rounded-2xl bg-gradient-to-b from-[#181310] to-[#120E0C] border border-[#2B211B] p-5 sm:p-6 mb-4 text-center overflow-hidden shadow-inner">
          {/* Subtle Card Glow */}
          <div className="absolute top-0 right-0 w-44 h-44 bg-orange-500/10 rounded-full blur-2xl pointer-events-none" />

          {/* Eyebrow */}
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#FF7D54] mb-1">
            {isDirect ? 'DIRECT VAULT SETTLEMENT' : 'CONFIDENTIAL ESCROW RESERVED'}
          </div>

          {/* Hero Amount & Asset Display */}
          <div className="flex items-center justify-center gap-2.5 my-2">
            <TokenIcon
              symbol={payment.token.symbol}
              iconUrl={payment.token.iconUrl}
              size="lg"
              className="w-10 h-10 shadow-lg"
            />
            <span className="font-display font-extrabold text-4xl sm:text-5xl text-white tracking-tight leading-none">
              {formatTokenAmount(displayAmount)}
            </span>
            <span className="font-display font-bold text-2xl sm:text-3xl text-orange-400 leading-none">
              {payment.token.symbol}
            </span>
          </div>

          {displayAmountUsd != null && (
            <div className="text-xs text-stone-400 font-mono">
              ≈ {formatUsd(displayAmountUsd)} USD
            </div>
          )}

          {/* Recipient Pill */}
          <div className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-stone-900/90 border border-stone-800 text-xs font-mono text-stone-200">
            <svg className="w-3.5 h-3.5 fill-current text-stone-400" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span className="font-bold text-white">@{payment.recipientHandle}</span>
            <span className="text-stone-500">•</span>
            <span className="text-[11px] text-stone-400">Passkey Protected</span>
          </div>

          {/* Memo (if present) */}
          {payment.memo && (
            <div className="mt-3 p-2.5 rounded-xl bg-black/40 border border-white/5 text-xs text-stone-300 italic font-sans max-w-full text-center truncate">
              "{payment.memo}"
            </div>
          )}

          {/* Itemized Cryptographic Telemetry */}
          <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-2 text-left text-[11px] font-mono">
            <div>
              <span className="text-stone-500 uppercase tracking-wider text-[9px] block">Rail</span>
              <span className="text-stone-200 font-bold font-mono">
                {isDirect ? 'Direct Vault Transfer' : 'Confidential Escrow'}
              </span>
            </div>

            <div>
              <span className="text-stone-500 uppercase tracking-wider text-[9px] block">Security</span>
              <span className="text-stone-200 font-bold font-mono">Biometric Passkey</span>
            </div>

            <div>
              <span className="text-stone-500 uppercase tracking-wider text-[9px] block">Timestamp</span>
              <span className="text-stone-400 font-mono text-[10px]">{dateFormatted}</span>
            </div>

            <div>
              <span className="text-stone-500 uppercase tracking-wider text-[9px] block">Payment ID</span>
              {payment.id ? (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(payment.id);
                    toast('Payment ID copied');
                  }}
                  className="inline-flex items-center space-x-1 text-stone-300 hover:text-white cursor-pointer"
                  title="Copy Payment ID"
                >
                  <span>{shortPaymentId}</span>
                  <Copy className="w-2.5 h-2.5 text-stone-500" />
                </button>
              ) : (
                <span className="text-stone-500">—</span>
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
            <QRCodeDisplay value={payment.claimLink} size={180} />
            <p className="text-[11px] font-mono text-stone-400 mt-2.5 text-center">
              Scan with mobile camera to claim with Touch ID / Face ID
            </p>
          </div>
        )}

        {/* Claim / Receipt Link Row */}
        <div className="space-y-1.5 mb-3">
          <label className="text-[10px] font-mono uppercase tracking-wider text-stone-400 block">
            {isDirect ? 'Proof of Payment Link' : 'Passkey Claim Link'}
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={payment.claimLink}
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

        {/* Primary Action Suite */}
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
            <span>Notify @{payment.recipientHandle} on 𝕏</span>
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

        {/* Privacy & Non-Custodial Assurance */}
        <div className="flex items-start space-x-2 p-3 rounded-xl bg-[#14100D] border border-[#2B211B] text-[11px] text-stone-400">
          <Lock className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
          <p>
            <strong className="text-stone-300">Confidential by Default.</strong>{' '}
            {isDirect
              ? 'Funds were moved directly into the recipient’s vault. Only their passkey can authorize withdrawals.'
              : 'Escrowed securely. Only @' + payment.recipientHandle + ' can claim this payment via their biometric passkey.'}
          </p>
        </div>

        {/* Done / Close Button */}
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
