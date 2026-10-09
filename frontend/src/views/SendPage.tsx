'use client';

import React, { useState, useEffect } from 'react';
import { Link } from '../lib/router';
import {
  Zap,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Wallet,
  AtSign,
  Fingerprint,
} from 'lucide-react';
import { HandleInput } from '../components/HandleInput';
import { AmountInput } from '../components/AmountInput';
import { ShareModal } from '../components/ShareModal';
import { usePayments } from '../hooks/usePayments';
import { PaymentIntent } from '../types';

export const SendPage: React.FC = () => {
  const {
    tokens,
    selectedToken,
    setSelectedToken,
    quote,
    isSubmitting,
    error,
    sendPayment,
    updateQuote,
    clearError,
  } = usePayments();

  const [sendMode, setSendMode] = useState<'handle' | 'wallet'>('handle');
  const [recipient, setRecipient] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [createdPayment, setCreatedPayment] = useState<PaymentIntent | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Recalculate quote on token or amount changes
  useEffect(() => {
    updateQuote(selectedToken.id, amount);
  }, [selectedToken.id, amount, updateQuote]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setSuccessToast(null);

    const target = sendMode === 'handle' ? recipient : walletAddress;
    if (!target.trim()) return;
    if (!amount || parseFloat(amount) <= 0) return;

    try {
      const payment = await sendPayment(target, amount, memo);
      setCreatedPayment(payment);
      setShowShareModal(true);
      setSuccessToast(
        sendMode === 'handle'
          ? `Successfully sent ${payment.amount} ${payment.token.symbol} to @${payment.recipientHandle}!`
          : `Intent executed! Sent ${payment.amount} ${payment.token.symbol} to ${target.slice(0, 10)}...`
      );
      setRecipient('');
      setWalletAddress('');
      setAmount('');
      setMemo('');
    } catch {
      // Error is tracked in hook
    }
  };

  const isFormValid =
    (sendMode === 'handle' ? recipient.trim().length >= 2 : walletAddress.trim().length >= 5) &&
    parseFloat(amount) > 0 &&
    !isSubmitting;

  return (
    <div className="w-full space-y-6">
      {/* Back Link */}
      <Link
        to="/app"
        className="inline-flex items-center space-x-1.5 text-xs font-mono text-stone-500 hover:text-black transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Home</span>
      </Link>

      {/* Page Title & Intro */}
      <div className="text-center space-y-2 mb-6">
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight">
          Send Value Privately
        </h1>
        <p className="text-sm text-stone-600 max-w-md mx-auto">
          Send to an 𝕏 handle claimed with Touch ID, or route via cross-chain intents to any external wallet.
        </p>
      </div>

      {/* Success Notification */}
      {successToast && (
        <div className="p-4 rounded-2xl bg-stone-100 border border-stone-300 text-stone-900 text-xs flex items-center justify-between shadow-xs animate-fade-in">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-stone-900 flex-shrink-0" />
            <span className="font-medium">{successToast}</span>
          </div>
          {createdPayment && (
            <button
              onClick={() => setShowShareModal(true)}
              className="ml-3 font-bold text-stone-900 underline hover:text-black cursor-pointer"
            >
              Share Link
            </button>
          )}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2.5 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Primary Payment Card */}
      <div className="rounded-3xl p-6 sm:p-8 shadow-sm bg-white border border-stone-200 relative space-y-6">

        {/* Destination Mode Selector (𝕏 Handle vs Wallet Address via Intents) */}
        <div className="flex p-1 rounded-2xl bg-stone-100 border border-stone-200 text-xs font-mono font-bold">
          <button
            type="button"
            onClick={() => setSendMode('handle')}
            className={`flex-1 py-2.5 rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              sendMode === 'handle'
                ? 'bg-white text-stone-950 shadow-xs'
                : 'text-stone-500 hover:text-black'
            }`}
          >
            <AtSign className="w-3.5 h-3.5 text-stone-900" />
            <span>Send to 𝕏 Handle</span>
          </button>
          <button
            type="button"
            onClick={() => setSendMode('wallet')}
            className={`flex-1 py-2.5 rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              sendMode === 'wallet'
                ? 'bg-white text-stone-950 shadow-xs'
                : 'text-stone-500 hover:text-black'
            }`}
          >
            <Wallet className="w-3.5 h-3.5 text-stone-900" />
            <span>Send to Wallet via Intents</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Mode 1: 𝕏 Handle Input */}
          {sendMode === 'handle' ? (
            <HandleInput
              value={recipient}
              onChange={setRecipient}
              disabled={isSubmitting}
              placeholder="username"
            />
          ) : (
            /* Mode 2: Wallet Address Input (EVM, Solana, NEAR) */
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                  Recipient Wallet Address
                </label>
                <span className="text-xs text-stone-700 font-mono font-bold">
                  Cross-Chain Solver
                </span>
              </div>
              <input
                type="text"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value.trim())}
                disabled={isSubmitting}
                placeholder="0x... (EVM), Solana base58, or .near"
                className="w-full rounded-2xl bg-stone-50 border border-stone-200 px-4 py-3.5 text-xs text-stone-900 font-mono placeholder-stone-400 focus:outline-none focus:border-black focus:bg-white transition-colors"
              />
            </div>
          )}

          {/* Amount and Asset Picker */}
          <AmountInput
            amount={amount}
            onChangeAmount={setAmount}
            tokens={tokens}
            selectedToken={selectedToken}
            onSelectToken={setSelectedToken}
            disabled={isSubmitting}
          />

          {/* Optional Memo */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Private Note (Optional)
              </label>
              <span className="text-[11px] font-mono text-stone-700 font-semibold">Encrypted</span>
            </div>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. bounty, consulting, dinner ☕"
              maxLength={120}
              className="w-full rounded-2xl bg-stone-50 border border-stone-200 px-4 py-3 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-black focus:bg-white transition-colors"
            />
          </div>

          {/* Quote & Execution Telemetry */}
          {quote && parseFloat(amount) > 0 && (
            <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between text-stone-500">
                <span>Platform Fee (0.8%)</span>
                <span className="text-stone-900 font-bold">
                  {quote.protocolFee} {quote.token.symbol} (${quote.protocolFeeUsd.toFixed(2)})
                </span>
              </div>
              <div className="flex items-center justify-between text-stone-500 text-[11px]">
                <span className="text-stone-400">Fee Routing</span>
                <span className="text-stone-600 font-mono">Immediate → fees.uprail.near</span>
              </div>
              <div className="flex items-center justify-between text-stone-500 text-[11px]">
                <span className="text-stone-400">Recipient Claim Fee</span>
                <span className="text-stone-900 font-bold">0% (Claims 100%)</span>
              </div>
              <div className="flex items-center justify-between text-stone-500 text-[11px]">
                <span className="text-stone-400">Access Invite</span>
                <span className="text-stone-900 font-bold">Preloaded in Claim Link</span>
              </div>
              <div className="flex items-center justify-between text-stone-500">
                <span>Solver Routing</span>
                <span className="text-stone-900 flex items-center font-bold">
                  <Zap className="w-3 h-3 text-stone-900 mr-1" />
                  NEAR 1Click Intent
                </span>
              </div>
              <div className="pt-2 border-t border-stone-200 flex items-center justify-between font-bold text-stone-900 text-sm">
                <span>Total to Send</span>
                <span className="text-stone-950 font-bold">
                  {quote.totalAmount} {quote.token.symbol} (${quote.totalUsd.toFixed(2)})
                </span>
              </div>
            </div>
          )}

          {/* Send CTA Button — Authorized by Device Passkey */}
          <button
            type="submit"
            disabled={!isFormValid}
            className={`w-full py-4 px-6 rounded-2xl font-display font-extrabold text-sm uppercase tracking-wider flex items-center justify-center space-x-2 transition-all duration-200 shadow-xs ${
              isFormValid
                ? 'bg-black hover:bg-stone-800 text-white cursor-pointer hover:scale-[1.01] active:scale-[0.99]'
                : 'bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Authorizing with Passkey...</span>
              </>
            ) : (
              <>
                <Fingerprint className="w-4 h-4" />
                <span>
                  {sendMode === 'handle'
                    ? recipient
                      ? `Authorize & Send to @${recipient.replace(/^@/, '')}`
                      : 'Enter Handle to Send'
                    : walletAddress
                    ? `Authorize & Route via Intents`
                    : 'Enter Wallet Address'}
                </span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Share Modal Dialog */}
      {createdPayment && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          payment={createdPayment}
        />
      )}
    </div>
  );
};
