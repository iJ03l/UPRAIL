import React, { useState, useEffect } from 'react';
import {
  Send,
  Shield,
  Zap,
  CheckCircle2,
  AlertCircle,
  Lock,
  ArrowRight,
} from 'lucide-react';
import { HandleInput } from '../components/HandleInput';
import { AmountInput } from '../components/AmountInput';
import { ShareModal } from '../components/ShareModal';
import { usePayments } from '../hooks/usePayments';
import { useXAuth } from '../hooks/useXAuth';
import { PaymentIntent } from '../types';

export const SendPage: React.FC = () => {
  const { user, login } = useXAuth();
  const {
    tokens,
    selectedToken,
    setSelectedToken,
    quote,
    isQuoting,
    isSubmitting,
    error,
    sendPayment,
    updateQuote,
    clearError,
  } = usePayments();

  const [recipient, setRecipient] = useState('');
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

    if (!recipient.trim()) return;
    if (!amount || parseFloat(amount) <= 0) return;

    try {
      const payment = await sendPayment(recipient, amount, memo);
      setCreatedPayment(payment);
      setShowShareModal(true);
      setSuccessToast(
        `Successfully created confidential payment of ${payment.amount} ${payment.token.symbol} for @${payment.recipientHandle}!`
      );
      // Reset inputs
      setRecipient('');
      setAmount('');
      setMemo('');
    } catch {
      // Error is tracked in hook
    }
  };

  const isFormValid =
    recipient.trim().length >= 2 &&
    parseFloat(amount) > 0 &&
    !isSubmitting &&
    !isQuoting;

  return (
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
      {/* Page Title & Intro */}
      <div className="text-center space-y-2 mb-8">
        <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#E05326]/10 border border-[#E05326]/30 text-[#E05326] text-xs font-mono font-medium mb-1">
          <Shield className="w-3.5 h-3.5" />
          <span>NEAR Confidential Intents</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-white tracking-tight">
          Send to any <span className="text-gradient-burnt">𝕏 Handle</span>
        </h1>
        <p className="text-sm text-[#C3B9B2] max-w-md mx-auto">
          Confidential transfers claimed with device passkeys on app.uprail.world. Zero mempools, no public balance leak.
        </p>
      </div>

      {/* Success Notification */}
      {successToast && (
        <div className="mb-6 p-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between animate-fade-in">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{successToast}</span>
          </div>
          {createdPayment && (
            <button
              onClick={() => setShowShareModal(true)}
              className="ml-3 font-bold text-white underline hover:text-emerald-200"
            >
              Share Link
            </button>
          )}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-center space-x-2.5 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sender State Notice if anonymous */}
      {!user && (
        <div className="mb-6 p-3.5 rounded-2xl bg-[#140F0D] border border-[#2C221D] text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2 text-[#C3B9B2]">
            <Lock className="w-4 h-4 text-[#E05326]" />
            <span>Sending as anonymous confidential sender</span>
          </div>
          <button
            onClick={() => login()}
            className="text-xs font-bold text-[#E05326] hover:text-[#FF7D54] underline"
          >
            Sign in with 𝕏
          </button>
        </div>
      )}

      {/* Primary Payment Card */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden border border-[#2C221D]">
        {/* Subtle burnt orange accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#E05326] via-[#FF6B35] to-[#FFFFFF]" />

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Recipient Handle Input */}
          <HandleInput
            value={recipient}
            onChange={setRecipient}
            disabled={isSubmitting}
            placeholder="satoshi or alice"
          />

          {/* Amount and Asset Picker */}
          <AmountInput
            amount={amount}
            onChangeAmount={setAmount}
            tokens={tokens}
            selectedToken={selectedToken}
            onSelectToken={setSelectedToken}
            disabled={isSubmitting}
          />

          {/* Optional Memo / Message */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono font-semibold uppercase tracking-wider text-[#A69C95]">
                Confidential Memo (Optional)
              </label>
              <span className="text-[11px] font-mono text-[#E05326]">Encrypted</span>
            </div>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. Design review payment ☕"
              maxLength={120}
              className="w-full rounded-2xl bg-[#0E0B09] border border-[#2C221D] px-4 py-3 text-sm text-white placeholder-stone-600 focus:outline-none focus:border-[#E05326] transition-colors"
            />
          </div>

          {/* Quote & Fee Breakdown */}
          {quote && parseFloat(amount) > 0 && (
            <div className="rounded-2xl bg-[#0E0B09] border border-[#2C221D] p-4 space-y-2.5 text-xs animate-fade-in">
              <div className="flex items-center justify-between text-[#A69C95]">
                <span>Protocol Fee</span>
                <span className="text-emerald-400 font-medium">Free (0%)</span>
              </div>
              <div className="flex items-center justify-between text-[#A69C95]">
                <span>Network Execution</span>
                <span className="text-white font-mono">
                  {quote.networkFee} {quote.token.symbol} (${quote.networkFeeUsd.toFixed(2)})
                </span>
              </div>
              <div className="flex items-center justify-between text-[#A69C95]">
                <span>Settlement Speed</span>
                <span className="text-[#FFAB76] flex items-center font-mono">
                  <Zap className="w-3 h-3 text-[#E05326] mr-1" />
                  Instant (~2 sec)
                </span>
              </div>
              <div className="pt-2 border-t border-[#2C221D] flex items-center justify-between font-bold text-white text-sm">
                <span>Total Escrow Amount</span>
                <span className="text-[#E05326] font-mono">
                  {quote.totalAmount} {quote.token.symbol} (${quote.totalUsd.toFixed(2)})
                </span>
              </div>
            </div>
          )}

          {/* Send CTA Button */}
          <button
            type="submit"
            disabled={!isFormValid}
            className={`w-full py-4 px-6 rounded-2xl font-display font-extrabold text-base flex items-center justify-center space-x-2 transition-all duration-200 shadow-xl ${
              isFormValid
                ? 'bg-gradient-to-r from-[#E05326] to-[#FF6B35] text-white hover:shadow-[0_0_35px_rgba(224,83,38,0.6)] cursor-pointer transform hover:-translate-y-0.5'
                : 'bg-[#181310] text-stone-600 border border-[#2C221D] cursor-not-allowed'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Creating Shielded Intent...</span>
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                <span>
                  {recipient
                    ? `Send to @${recipient.replace(/^@/, '')}`
                    : 'Enter Recipient to Send'}
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
