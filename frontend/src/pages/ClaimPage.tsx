import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Search,
  Wallet,
  Check,
  Shield,
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
    <div className="w-full space-y-6">
      {/* Back Link */}
      <Link
        to="/app"
        className="inline-flex items-center space-x-1.5 text-xs font-mono text-stone-500 hover:text-black transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Home</span>
      </Link>

      {/* Page Header */}
      <div className="text-center space-y-2 mb-8">
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight">
          Claim <span className="text-black">Private Payment</span>
        </h1>
        <p className="text-sm text-stone-600 max-w-md mx-auto">
          Unlock your payment with Touch ID, Face ID, or your device passcode. No wallet app or seed phrase required.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2.5 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search / Claim code input if no payment loaded */}
      {!payment && !isLoading && (
        <div className="rounded-3xl p-6 sm:p-8 shadow-xs bg-white border border-stone-200 mb-8">
          <form onSubmit={handleManualSearch} className="space-y-4">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block">
              Enter Claim Code or Link
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                placeholder="e.g. up_98a712f or paste claim link"
                className="w-full bg-stone-50 rounded-2xl pl-4 pr-12 py-3.5 text-sm text-stone-900 placeholder-stone-400 border border-stone-200 focus:outline-none focus:border-black focus:bg-white font-mono"
              />
              <button
                type="submit"
                disabled={!inputCode.trim()}
                className="absolute right-2 p-2 rounded-xl bg-black hover:bg-stone-800 text-white disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Search className="w-4 h-4 font-bold" />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="rounded-3xl p-8 bg-white border border-stone-200 text-center space-y-4 animate-pulse mb-8">
          <div className="w-16 h-16 bg-stone-200 rounded-full mx-auto" />
          <div className="h-6 w-48 bg-stone-200 rounded mx-auto" />
          <div className="h-4 w-32 bg-stone-200 rounded mx-auto" />
        </div>
      )}

      {/* Active Payment Card */}
      {payment && (
        <div className="rounded-3xl p-6 sm:p-8 shadow-xs bg-white border border-stone-200 relative mb-8">

          {/* Claimed Celebration Banner */}
          {payment.status === 'claimed' ? (
            <div className="text-center space-y-4 py-4 animate-fade-in">
              <div className="w-18 h-18 rounded-3xl bg-stone-100 border border-stone-300 text-stone-900 flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div>
                <h3 className="text-2xl font-black text-stone-950 font-display">Payment Claimed!</h3>
                <p className="text-xs text-stone-600 font-bold mt-1">
                  Confidential funds safely unlocked on your device
                </p>
              </div>

              {/* Amount Display */}
              <div className="py-4 px-6 rounded-2xl bg-stone-50 border border-stone-200 inline-block min-w-[240px]">
                <div className="text-3xl font-extrabold text-stone-950 font-display">
                  {payment.amount} {payment.token.symbol}
                </div>
                <div className="text-xs text-stone-500 font-mono mt-0.5">
                  ≈ ${payment.amountUsd.toFixed(2)} USD
                </div>
              </div>

              {/* Transaction details */}
              <div className="text-left bg-stone-50 rounded-2xl p-4 border border-stone-200 text-xs space-y-2 font-mono">
                <div className="flex justify-between text-stone-600">
                  <span>Recipient:</span>
                  <span className="text-stone-900 font-bold">@{payment.recipientHandle}</span>
                </div>
                <div className="flex justify-between text-stone-600">
                  <span>Sent by:</span>
                  <span className="text-stone-900 font-bold">@{payment.senderHandle}</span>
                </div>
                {payment.claimTxHash && (
                  <div className="flex justify-between text-stone-600 pt-1 border-t border-stone-200">
                    <span>NEAR Intent Claim:</span>
                    <span className="text-stone-900 font-bold truncate max-w-[180px]">
                      {payment.claimTxHash}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center gap-3">
                <button
                  onClick={() => setShowWithdrawModal(true)}
                  className="flex-1 py-3 px-4 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-900 font-bold text-xs flex items-center justify-center space-x-2 transition-colors border border-stone-200 cursor-pointer"
                >
                  <Wallet className="w-4 h-4 text-stone-900" />
                  <span>Withdraw to Address</span>
                </button>
                <Link
                  to="/app"
                  className="flex-1 py-3 px-4 rounded-xl bg-black hover:bg-stone-800 text-white font-extrabold text-xs flex items-center justify-center space-x-2 transition-colors cursor-pointer"
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
                <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-stone-100 border border-stone-300 text-stone-900 text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-stone-900 animate-pulse" />
                  <span>Payment Ready to Claim</span>
                </div>
                <span className="text-xs font-mono text-stone-400">
                  30-day auto-refund escrow
                </span>
              </div>

              {/* Token & Big Amount */}
              <div className="p-6 rounded-2xl bg-stone-50 border border-stone-200 text-center space-y-2">
                <img
                  src={payment.token.iconUrl}
                  alt={payment.token.symbol}
                  className="w-14 h-14 rounded-full mx-auto bg-white p-1 border border-stone-200 shadow-sm"
                />
                <div className="text-3xl sm:text-4xl font-extrabold text-stone-950 font-display tracking-tight">
                  {payment.amount} {payment.token.symbol}
                </div>
                <div className="text-sm font-semibold text-stone-500 font-mono">
                  ≈ ${payment.amountUsd.toFixed(2)} USD
                </div>
              </div>

              {/* Sender & Memo Information */}
              <div className="space-y-3 bg-stone-50 rounded-2xl p-4 border border-stone-200 text-xs">
                <div className="flex justify-between items-center text-stone-600">
                  <span>Intended Recipient</span>
                  <span className="font-bold text-stone-900 text-sm font-mono">
                    @{payment.recipientHandle}
                  </span>
                </div>
                <div className="flex justify-between items-center text-stone-600">
                  <span>Sent by</span>
                  <span className="text-stone-900 font-bold font-mono">
                    @{payment.senderHandle}
                  </span>
                </div>
                {payment.memo && (
                  <div className="pt-2 border-t border-stone-200 text-stone-800">
                    <span className="text-[10px] uppercase font-bold text-stone-400 block mb-0.5">
                      Private Note:
                    </span>
                    "{payment.memo}"
                  </div>
                )}
              </div>

              {/* Recipient Notice */}
              <div className="flex items-start space-x-2.5 p-3.5 rounded-2xl bg-stone-100 border border-stone-200 text-xs text-stone-700">
                <Fingerprint className="w-4 h-4 text-stone-900 flex-shrink-0 mt-0.5" />
                <p>
                  Claim with your device passkey (Touch ID, Face ID, or PIN).
                  No seed phrases, zero private keys to manage.
                </p>
              </div>

              {/* Primary Claim Button */}
              <button
                onClick={() => setShowPasskeyModal(true)}
                disabled={isClaiming}
                className="w-full py-4 px-6 rounded-2xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-sm uppercase tracking-wider flex items-center justify-center space-x-2 shadow-xs transition-all cursor-pointer disabled:opacity-60"
              >
                {isClaiming ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Verifying Touch ID / Face ID...</span>
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-4 h-4" />
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
      <div className="rounded-3xl p-6 sm:p-7 shadow-lg bg-white border border-stone-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-stone-900" />
            <h3 className="text-base font-bold text-stone-950 font-display">Your Shielded Device Vault</h3>
          </div>
          <span className="text-xs font-mono font-bold text-stone-900">
            ${totalShieldedUsd.toFixed(2)} USD
          </span>
        </div>
        <p className="text-xs text-stone-500 mb-4">
          Secured by your hardware-bound passkey. Only this device can authorize withdrawals.
        </p>

        <div className="space-y-2">
          {shieldedBalances.map((bal) => (
            <div
              key={bal.token.id}
              className="flex items-center justify-between p-3 rounded-2xl bg-stone-50 border border-stone-200"
            >
              <div className="flex items-center space-x-2.5">
                <img
                  src={bal.token.iconUrl}
                  alt={bal.token.symbol}
                  className="w-7 h-7 rounded-full bg-white border border-stone-200"
                />
                <div>
                  <span className="text-xs font-bold text-stone-900 block font-mono">
                    {bal.token.symbol}
                  </span>
                  <span className="text-[10px] text-stone-400">
                    {bal.token.name}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-stone-900 block font-mono">
                  {bal.amount} {bal.token.symbol}
                </span>
                <span className="text-[10px] text-stone-500 font-mono">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-stone-950 mb-1 font-display">Withdraw to Wallet</h3>
            <p className="text-xs text-stone-500 mb-4">
              Send your shielded tokens to any external NEAR or exchange address.
            </p>

            {withdrawSuccess ? (
              <div className="p-4 rounded-2xl bg-stone-100 border border-stone-300 text-stone-900 text-xs flex items-center space-x-2 mb-4">
                <Check className="w-4 h-4 text-stone-900" />
                <span>Withdrawal submitted successfully!</span>
              </div>
            ) : (
              <form onSubmit={handleWithdraw} className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block mb-1">
                    Destination Address
                  </label>
                  <input
                    type="text"
                    value={withdrawAddress}
                    onChange={(e) => setWithdrawAddress(e.target.value)}
                    placeholder="e.g. illia.near or 0x..."
                    className="w-full bg-stone-50 rounded-xl px-4 py-3 text-xs text-stone-900 placeholder-stone-400 border border-stone-200 focus:outline-none focus:border-black font-mono"
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowWithdrawModal(false)}
                    className="flex-1 py-3 text-xs text-stone-500 hover:text-stone-900 font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 rounded-xl bg-black hover:bg-stone-800 text-white font-extrabold text-xs transition-colors cursor-pointer"
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
