import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Fingerprint,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Search,
  Wallet,
  Check,
} from 'lucide-react';
import { useClaimFlow } from '../hooks/useClaimFlow';
import { PasskeyPrompt } from '../components/PasskeyPrompt';

export const ClaimPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const queryPaymentCode = searchParams.get('payment') || searchParams.get('code') || '';

  const [inputCode, setInputCode] = useState(queryPaymentCode);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);

  const {
    payment,
    isLoading,
    isClaiming,
    error,
    hasPasskey,
    shieldedBalances,
    fetchPayment,
    claimWithPasskey,
    clearError,
  } = useClaimFlow(queryPaymentCode);

  useEffect(() => {
    if (queryPaymentCode) {
      setInputCode(queryPaymentCode);
      fetchPayment(queryPaymentCode);
    }
  }, [queryPaymentCode, fetchPayment]);

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (!inputCode.trim()) return;
    // Extract code if user pasted a full URL
    let code = inputCode.trim();
    if (code.includes('payment=')) {
      code = code.split('payment=')[1].split('&')[0];
    } else if (code.includes('/claim/')) {
      code = code.split('/claim/')[1].split('?')[0];
    }
    fetchPayment(code);
  };

  const handleClaim = async () => {
    try {
      await claimWithPasskey();
      setShowPasskeyModal(false);
    } catch {
      // Handled in hook
    }
  };

  const handleWithdraw = (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawAddress.trim()) return;
    setWithdrawSuccess(true);
    setTimeout(() => {
      setShowWithdrawModal(false);
      setWithdrawSuccess(false);
      setWithdrawAddress('');
    }, 2000);
  };

  const totalShieldedUsd = shieldedBalances.reduce(
    (acc, b) => acc + (b.amountUsd || 0),
    0
  );

  return (
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
      {/* Page Header */}
      <div className="text-center space-y-2 mb-8">
        <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#E05326]/10 border border-[#E05326]/30 text-[#E05326] text-xs font-mono font-medium mb-1">
          <Fingerprint className="w-3.5 h-3.5" />
          <span>Device Passkey Claim</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-white tracking-tight">
          Claim <span className="text-gradient-burnt">Confidential Payment</span>
        </h1>
        <p className="text-sm text-[#C3B9B2] max-w-md mx-auto">
          Sign with Touch ID, Face ID, or your device passcode on app.uprail.world. Zero wallet app or seed phrase required.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-center space-x-2.5 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search / Claim code input if no payment loaded */}
      {!payment && !isLoading && (
        <div className="glass-card rounded-3xl p-6 sm:p-8 shadow-2xl mb-8">
          <form onSubmit={handleManualSearch} className="space-y-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
              Enter Claim Code or Link
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                placeholder="e.g. up_98a712f or paste claim link"
                className="w-full bg-dark-surface rounded-2xl pl-4 pr-12 py-3.5 text-sm text-white placeholder-slate-500 border border-dark-border focus:outline-none focus:border-brand-500 font-mono"
              />
              <button
                type="submit"
                disabled={!inputCode.trim()}
                className="absolute right-2 p-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-dark-bg disabled:opacity-40 transition-colors"
              >
                <Search className="w-4 h-4 font-bold" />
              </button>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <span>Have a demo link?</span>
              <button
                type="button"
                onClick={() => {
                  setInputCode('up_98a712f');
                  fetchPayment('up_98a712f');
                }}
                className="text-brand-400 hover:underline font-semibold"
              >
                Load Demo Payment (up_98a712f)
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="glass-card rounded-3xl p-8 text-center space-y-4 animate-pulse">
          <div className="w-16 h-16 bg-slate-800 rounded-full mx-auto" />
          <div className="h-6 w-48 bg-slate-800 rounded mx-auto" />
          <div className="h-4 w-32 bg-slate-800 rounded mx-auto" />
        </div>
      )}

      {/* Payment Active Card */}
      {payment && (
        <div className="glass-card rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden mb-8">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand-500 via-emerald-400 to-near-cyan" />

          {/* Claimed Celebration Banner */}
          {payment.status === 'claimed' ? (
            <div className="text-center space-y-4 py-4 animate-fade-in">
              <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-glow-brand">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <h3 className="text-2xl font-black text-white">Payment Claimed!</h3>
                <p className="text-xs text-emerald-400 font-medium mt-1">
                  Confidential funds shielded in your device passkey vault
                </p>
              </div>

              {/* Amount Display */}
              <div className="py-4 px-6 rounded-2xl bg-dark-surface/90 border border-dark-border inline-block min-w-[240px]">
                <div className="text-3xl font-extrabold text-white">
                  {payment.amount} {payment.token.symbol}
                </div>
                <div className="text-xs text-slate-400">
                  ≈ ${payment.amountUsd.toFixed(2)} USD
                </div>
              </div>

              {/* Transaction details */}
              <div className="text-left bg-dark-surface/60 rounded-2xl p-4 border border-dark-border/40 text-xs space-y-2">
                <div className="flex justify-between text-slate-400">
                  <span>Recipient:</span>
                  <span className="text-brand-400 font-semibold">@{payment.recipientHandle}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Sender:</span>
                  <span className="text-slate-300 font-mono">@{payment.senderHandle}</span>
                </div>
                {payment.claimTxHash && (
                  <div className="flex justify-between text-slate-400 pt-1 border-t border-dark-border/40">
                    <span>NEAR Intent Claim:</span>
                    <span className="text-emerald-400 font-mono text-[11px] truncate max-w-[180px]">
                      {payment.claimTxHash}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center gap-3">
                <button
                  onClick={() => setShowWithdrawModal(true)}
                  className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center space-x-2 transition-colors"
                >
                  <Wallet className="w-4 h-4 text-brand-400" />
                  <span>Withdraw to Address</span>
                </button>
                <Link
                  to="/"
                  className="flex-1 py-3 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-dark-bg font-extrabold text-xs flex items-center justify-center space-x-2 transition-colors"
                >
                  <span>Send a Payment</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ) : (
            /* Ready to Claim State */
            <div className="space-y-6">
              {/* Ready Header */}
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Payment Ready to Claim</span>
                </div>
                <span className="text-xs text-slate-500">
                  Expires in 7 days
                </span>
              </div>

              {/* Token & Big Amount */}
              <div className="p-6 rounded-2xl bg-dark-surface/90 border border-dark-border text-center space-y-2">
                <img
                  src={payment.token.iconUrl}
                  alt={payment.token.symbol}
                  className="w-14 h-14 rounded-full mx-auto bg-slate-800 p-1 border border-slate-700"
                />
                <div className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                  {payment.amount} {payment.token.symbol}
                </div>
                <div className="text-sm font-semibold text-slate-400">
                  ≈ ${payment.amountUsd.toFixed(2)} USD
                </div>
              </div>

              {/* Sender & Memo Information */}
              <div className="space-y-3 bg-dark-surface/50 rounded-2xl p-4 border border-dark-border/40 text-xs">
                <div className="flex justify-between items-center text-slate-400">
                  <span>Intended Recipient</span>
                  <span className="font-bold text-brand-400 text-sm">
                    @{payment.recipientHandle}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Sent by</span>
                  <span className="text-slate-200 font-mono">
                    @{payment.senderHandle}
                  </span>
                </div>
                {payment.memo && (
                  <div className="pt-2 border-t border-dark-border/40 text-slate-300">
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">
                      Note from sender:
                    </span>
                    "{payment.memo}"
                  </div>
                )}
              </div>

              {/* Recipient Notice */}
              <div className="flex items-start space-x-2.5 p-3.5 rounded-2xl bg-[#E05326]/10 border border-[#E05326]/30 text-xs text-[#FFAB76]">
                <Fingerprint className="w-4 h-4 text-[#E05326] flex-shrink-0 mt-0.5" />
                <p>
                  Claim with your device passkey (Touch ID, Face ID, or PIN).
                  No seed phrases, no private key management.
                </p>
              </div>

              {/* Primary Claim Button */}
              <button
                onClick={() => setShowPasskeyModal(true)}
                disabled={isClaiming}
                className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-[#E05326] to-[#FF6B35] text-white font-display font-black text-base flex items-center justify-center space-x-2 shadow-xl shadow-[#E05326]/30 hover:shadow-[0_0_35px_rgba(224,83,38,0.6)] hover:opacity-95 transition-all transform hover:-translate-y-0.5 cursor-pointer disabled:opacity-60"
              >
                {isClaiming ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Verifying Passkey Biometrics...</span>
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-5 h-5" />
                    <span>Claim with Device Passkey</span>
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Device Shielded Vault Balances Card */}
      <div className="glass-card rounded-3xl p-6 sm:p-7 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-extrabold text-white">Your Shielded Device Vault</h3>
          </div>
          <span className="text-xs font-mono font-bold text-emerald-400">
            ${totalShieldedUsd.toFixed(2)} USD
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Protected by your device-bound NIST P-256 passkey. Only this device can sign transfers.
        </p>

        <div className="space-y-2">
          {shieldedBalances.map((bal) => (
            <div
              key={bal.token.id}
              className="flex items-center justify-between p-3 rounded-2xl bg-dark-surface border border-dark-border"
            >
              <div className="flex items-center space-x-2.5">
                <img
                  src={bal.token.iconUrl}
                  alt={bal.token.symbol}
                  className="w-7 h-7 rounded-full bg-slate-800"
                />
                <div>
                  <span className="text-xs font-bold text-white block">
                    {bal.token.symbol}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {bal.token.name}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-white block">
                  {bal.amount} {bal.token.symbol}
                </span>
                <span className="text-[11px] text-slate-400">
                  ≈ ${bal.amountUsd.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Passkey Authentication Modal */}
      {payment && (
        <PasskeyPrompt
          isOpen={showPasskeyModal}
          onClose={() => setShowPasskeyModal(false)}
          onConfirm={handleClaim}
          handle={payment.recipientHandle}
          isClaiming={isClaiming}
          hasExistingPasskey={hasPasskey}
        />
      )}

      {/* Withdraw Modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md rounded-3xl bg-dark-card border border-dark-border p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Withdraw from Shielded Vault</h3>
            <p className="text-xs text-slate-400 mb-4">
              Send your shielded tokens to any external NEAR or exchange account.
            </p>

            {withdrawSuccess ? (
              <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center space-x-2 mb-4">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Withdrawal intent submitted successfully!</span>
              </div>
            ) : (
              <form onSubmit={handleWithdraw} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                    Destination Account / Address
                  </label>
                  <input
                    type="text"
                    value={withdrawAddress}
                    onChange={(e) => setWithdrawAddress(e.target.value)}
                    placeholder="e.g. alice.near or 0x..."
                    className="w-full bg-dark-surface rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 border border-dark-border focus:outline-none focus:border-brand-500 font-mono"
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowWithdrawModal(false)}
                    className="flex-1 py-3 text-xs text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-dark-bg font-extrabold text-xs transition-colors"
                  >
                    Confirm Withdrawal
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
