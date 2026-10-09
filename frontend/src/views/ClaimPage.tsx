'use client';

import React, { useState } from 'react';
import { useSearchParams, Link } from '../lib/router';
import {
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Wallet,
  Check,
  Shield,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useClaimFlow } from '../hooks/useClaimFlow';
import { useXAuth } from '../hooks/useXAuth';
import { PasskeyPrompt } from '../components/PasskeyPrompt';
import { XAuthBanner } from '../components/XAuthBanner';
import { api } from '../lib/api';

export const ClaimPage: React.FC = () => {
  const { user } = useXAuth();
  const [searchParams] = useSearchParams();
  const queryPaymentCode = searchParams.get('payment') || searchParams.get('code') || '';
  const urlInvite = searchParams.get('invite') || '';

  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawTxHash, setWithdrawTxHash] = useState<string | null>(null);

  const {
    pendingPayments,
    isLoading,
    isClaiming,
    claimSuccess,
    claimResult,
    error,
    hasPasskey,
    shieldedBalances,
    loadShieldedBalances,
    loadPendingPayments,
    claimPaymentWithPasskey,
    claimAllWithPasskey,
    clearError,
    resetSuccess,
  } = useClaimFlow(queryPaymentCode);

  const handleStartClaim = (paymentId: string) => {
    setActiveClaimId(paymentId);
    setShowPasskeyModal(true);
  };

  const handleConfirmPasskeyClaim = async () => {
    try {
      if (activeClaimId === 'all') {
        await claimAllWithPasskey();
      } else if (activeClaimId) {
        await claimPaymentWithPasskey(activeClaimId);
      }
      setShowPasskeyModal(false);
    } catch {
      // Error handled in hook
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawAddress.trim() || isWithdrawing) return;
    setIsWithdrawing(true);
    setWithdrawError(null);
    try {
      const targetToken = shieldedBalances[0]?.token?.id || 'usdc';
      const targetAmount = shieldedBalances[0]?.amount || 'all';
      const res = await api.withdraw({
        destinationAddress: withdrawAddress.trim(),
        asset: targetToken,
        amount: targetAmount,
      });
      setWithdrawTxHash(res.txHash);
      setWithdrawSuccess(true);
      await loadShieldedBalances();
      setTimeout(() => {
        setShowWithdrawModal(false);
        setWithdrawSuccess(false);
        setWithdrawAddress('');
        setWithdrawTxHash(null);
      }, 3500);
    } catch (err: any) {
      setWithdrawError(err.message || 'Withdrawal failed');
    } finally {
      setIsWithdrawing(false);
    }
  };

  const totalPendingUsd = pendingPayments.reduce(
    (acc, p) => acc + (p.amountUsd || 0),
    0
  );

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 tracking-tight flex items-center gap-2">
            <span>Incoming Claims</span>
            {pendingPayments.length > 0 && (
              <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-stone-900 text-white font-bold align-middle">
                {pendingPayments.length} waiting
              </span>
            )}
          </h1>
          <p className="text-sm text-stone-600 mt-1">
            Funds sent to {user?.handle ? <span className="font-mono font-bold text-stone-900">@{user.handle}</span> : 'you'} appear here automatically. Claim instantly with your device passkey.
          </p>
        </div>

        <button
          onClick={() => loadPendingPayments()}
          disabled={isLoading}
          className="self-start sm:self-auto p-2.5 rounded-xl border border-stone-200 hover:border-black text-stone-600 hover:text-black bg-stone-50 transition-colors cursor-pointer text-xs flex items-center space-x-1.5 font-mono font-bold"
          title="Refresh incoming payments"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Preloaded VIP Access Invite Banner */}
      {urlInvite && (
        <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-mono animate-fade-in shadow-xs">
          <div className="flex items-center space-x-2.5">
            <Sparkles className="w-4 h-4 text-stone-900 flex-shrink-0" />
            <div>
              <span className="text-stone-600">VIP Access Invite: </span>
              <span className="font-bold text-stone-950 px-2 py-0.5 rounded bg-white border border-stone-300 tracking-wider">
                {urlInvite.toUpperCase()}
              </span>
            </div>
          </div>
          <span className="text-[11px] text-stone-900 font-bold bg-white px-2.5 py-1 rounded-full border border-stone-200">
            0% Claim Fee • Full Access Preloaded
          </span>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between animate-fade-in">
          <div className="flex items-center space-x-2.5">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={clearError} className="text-red-500 hover:text-red-800 text-xs font-mono font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* Success Celebration Banner */}
      {claimSuccess && (
        <div className="rounded-3xl p-6 sm:p-7 bg-stone-900 text-white border border-stone-800 shadow-md space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-white text-stone-900 flex items-center justify-center font-bold">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display">Payment Claimed!</h3>
                <p className="text-xs text-stone-300 font-mono">
                  {claimResult?.message || 'Settled into your confidential NEAR vault'}
                </p>
              </div>
            </div>
            <button
              onClick={resetSuccess}
              className="text-xs font-mono text-stone-400 hover:text-white underline cursor-pointer"
            >
              Done
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-800 text-xs font-mono">
            <span className="text-stone-400">Vault Balance:</span>
            <span className="font-bold text-white">${totalShieldedUsd.toFixed(2)} USD</span>
            {claimResult?.shieldedTxHash && (
              <span className="text-stone-400 ml-auto truncate max-w-[200px]">
                Tx: {claimResult.shieldedTxHash}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-3xl p-6 bg-white border border-stone-200 animate-pulse flex items-center justify-between"
            >
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-stone-200 rounded-2xl" />
                <div className="space-y-2">
                  <div className="h-4 w-32 bg-stone-200 rounded" />
                  <div className="h-3 w-24 bg-stone-100 rounded" />
                </div>
              </div>
              <div className="h-10 w-28 bg-stone-200 rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {/* Pending Payments List — AUTOMATICALLY DISCOVERED (No link/code input!) */}
      {!isLoading && pendingPayments.length > 0 && (
        <div className="space-y-4">
          {/* Batch Claim All CTA (if more than 1 payment) */}
          {pendingPayments.length > 1 && (
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-2.5">
                <Sparkles className="w-5 h-5 text-stone-900" />
                <div>
                  <div className="text-xs font-bold text-stone-950 font-display">
                    {pendingPayments.length} Payments Waiting
                  </div>
                  <div className="text-[11px] text-stone-500 font-mono">
                    Total: ≈ ${totalPendingUsd.toFixed(2)} USD
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleStartClaim('all')}
                disabled={isClaiming}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-xs disabled:opacity-60"
              >
                <Fingerprint className="w-4 h-4" />
                <span>Claim All with Passkey</span>
              </button>
            </div>
          )}

          {/* Individual Payment Cards */}
          <div className="space-y-3">
            {pendingPayments.map((p) => (
              <div
                key={p.id}
                className="rounded-3xl p-5 sm:p-6 bg-white border border-stone-200 shadow-xs hover:border-stone-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                {/* Left: Token Icon + Sender + Memo */}
                <div className="flex items-start sm:items-center space-x-3.5">
                  <img
                    src={p.token.iconUrl}
                    alt={p.token.symbol}
                    className="w-12 h-12 rounded-2xl p-1 bg-stone-50 border border-stone-200 flex-shrink-0"
                  />
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-base font-extrabold text-stone-950 font-display">
                        {p.amount} {p.token.symbol}
                      </span>
                      <span className="text-xs text-stone-500 font-mono">
                        ≈ ${p.amountUsd.toFixed(2)} USD
                      </span>
                      <span className="text-[9px] font-mono uppercase font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">
                        {p.status}
                      </span>
                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-900 text-white">
                        0% Fee
                      </span>
                    </div>

                    <div className="text-xs font-mono text-stone-600 flex items-center space-x-1.5">
                      <span>Sent by:</span>
                      <span className="font-bold text-stone-900">@{p.senderHandle || 'anonymous'}</span>
                      <span className="text-stone-400">·</span>
                      <span className="text-stone-400">{new Date(p.createdAt).toLocaleDateString()}</span>
                    </div>

                    {p.memo && (
                      <p className="text-xs text-stone-500 font-mono italic">
                        "{p.memo}"
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: Claim Action Button */}
                <div className="flex items-center sm:self-center">
                  <button
                    type="button"
                    onClick={() => handleStartClaim(p.id)}
                    disabled={isClaiming}
                    className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-xs transition-all cursor-pointer disabled:opacity-60"
                  >
                    <Fingerprint className="w-4 h-4" />
                    <span>Claim with Passkey</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unauthenticated State: Show X Authentication Wall */}
      {!user ? (
        <XAuthBanner
          title="Sign In with 𝕏 to Discover Incoming Claims"
          description="Payments sent to your 𝕏 handle are held in confidential escrow waiting for you. Sign in with 𝕏 to auto-discover all incoming payments and claim them directly into your passkey vault."
          actionText="Sign In with 𝕏"
        />
      ) : (
        /* Empty State: Authenticated but NO pending payments */
        !isLoading && pendingPayments.length === 0 && (
          <div className="rounded-3xl p-8 sm:p-12 bg-white border border-stone-200 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 text-stone-800 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-bold font-display text-stone-950">All Caught Up!</h3>
              <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
                You have no pending payments. When anyone sends funds to{' '}
                <span className="font-mono font-bold text-stone-900">@{user.handle}</span>, they will automatically appear here ready to claim with your Touch ID / Face ID.
              </p>
            </div>

            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/app/send"
                className="py-2.5 px-4 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
              >
                Send Payment
              </Link>
              <Link
                to="/app/receive"
                className="py-2.5 px-4 rounded-xl border border-stone-200 hover:border-black text-stone-700 hover:text-black font-display font-bold text-xs uppercase tracking-wider bg-stone-50 transition-colors cursor-pointer"
              >
                Receive via Gateway
              </Link>
            </div>
          </div>
        )
      )}

      {/* Device Shielded Vault Balances Card */}
      <div className="rounded-3xl p-6 sm:p-7 shadow-xs bg-white border border-stone-200 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-stone-100">
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-stone-900" />
            <h3 className="text-base font-bold text-stone-950 font-display">
              Your Shielded Device Vault
            </h3>
          </div>
          <div className="text-right">
            <span className="text-xs font-mono font-bold text-stone-900">
              ${totalShieldedUsd.toFixed(2)} USD
            </span>
            <div className="text-[10px] text-stone-400 font-mono">
              Passkey protected
            </div>
          </div>
        </div>

        <p className="text-xs text-stone-500 leading-relaxed">
          Secured by your hardware-bound passkey. Every withdrawal requires device biometric authorization.
        </p>

        {shieldedBalances.length > 0 ? (
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
        ) : (
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center text-xs font-mono text-stone-400">
            No shielded balances yet. Claim incoming payments to deposit here.
          </div>
        )}

        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowWithdrawModal(true)}
            className="w-full py-3 px-4 rounded-xl border border-stone-200 hover:border-black text-stone-700 hover:text-black font-display font-bold text-xs uppercase tracking-wider bg-stone-50 transition-colors flex items-center justify-center space-x-2 cursor-pointer"
          >
            <Wallet className="w-4 h-4" />
            <span>Withdraw to External Wallet</span>
          </button>
        </div>
      </div>

      {/* Passkey Authentication Modal Prompt */}
      <PasskeyPrompt
        isOpen={showPasskeyModal}
        onClose={() => setShowPasskeyModal(false)}
        onConfirm={handleConfirmPasskeyClaim}
        handle={user?.handle || 'your account'}
        isClaiming={isClaiming}
        hasExistingPasskey={hasPasskey}
      />

      {/* Withdraw Modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="relative w-full max-w-md rounded-3xl bg-white border border-stone-200 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-stone-950 mb-1 font-display">
              Withdraw to External Wallet
            </h3>
            <p className="text-xs text-stone-500 mb-4">
              Send your shielded tokens to any external NEAR or exchange address.
            </p>

            {withdrawSuccess ? (
              <div className="p-4 rounded-2xl bg-stone-100 border border-stone-300 text-stone-900 text-xs space-y-2 mb-4">
                <div className="flex items-center space-x-2 font-bold">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>Withdrawal relayed successfully!</span>
                </div>
                {withdrawTxHash && (
                  <div className="text-[11px] font-mono text-stone-500 break-all">
                    Tx: {withdrawTxHash}
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleWithdraw} className="space-y-4">
                {withdrawError && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{withdrawError}</span>
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block mb-1">
                    Destination Address
                  </label>
                  <input
                    type="text"
                    value={withdrawAddress}
                    onChange={(e) => setWithdrawAddress(e.target.value)}
                    placeholder="e.g. illia.near, 0x..., or Solana address"
                    disabled={isWithdrawing}
                    className="w-full bg-stone-50 rounded-xl px-4 py-3 text-xs text-stone-900 placeholder-stone-400 border border-stone-200 focus:outline-none focus:border-black font-mono disabled:opacity-50"
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowWithdrawModal(false)}
                    disabled={isWithdrawing}
                    className="flex-1 py-3 text-xs text-stone-500 hover:text-stone-900 font-bold cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isWithdrawing}
                    className="flex-1 py-3 rounded-xl bg-black hover:bg-stone-800 text-white font-extrabold text-xs transition-colors cursor-pointer flex items-center justify-center space-x-2 disabled:opacity-50"
                  >
                    {isWithdrawing ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <span>Confirm Withdrawal</span>
                    )}
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
