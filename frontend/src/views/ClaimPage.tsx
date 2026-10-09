'use client';

import React, { useState } from 'react';
import { useSearchParams, Link } from '../lib/router';
import {
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useClaimFlow } from '../hooks/useClaimFlow';
import { useXAuth } from '../hooks/useXAuth';
import { PasskeyPrompt } from '../components/PasskeyPrompt';
import { XAuthBanner } from '../components/XAuthBanner';
import { TokenIcon } from '../components/TokenIcon';

export const ClaimPage: React.FC = () => {
  const { user, isLoading: isAuthLoading } = useXAuth();
  const [searchParams] = useSearchParams();
  const queryPaymentCode = searchParams.get('payment') || searchParams.get('code') || '';
  const urlInvite = searchParams.get('invite') || '';

  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);

  const {
    pendingPayments,
    isLoading,
    isClaiming,
    claimSuccess,
    claimResult,
    error,
    hasPasskey,
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

  const totalPendingUsd = pendingPayments.reduce(
    (acc, p) => acc + (p.amountUsd || 0),
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
            <span className="text-emerald-400 font-bold">100% Shielded & Settled</span>
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
                  <TokenIcon
                    symbol={p.token.symbol}
                    iconUrl={p.token.iconUrl}
                    size="xl"
                    className="w-12 h-12 rounded-2xl"
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

      {/* Authentication / Empty State Handling */}
      {!user ? (
        !isAuthLoading && (
          <XAuthBanner
            title="Sign In with 𝕏 to Discover Incoming Claims"
            description="Payments sent to your 𝕏 handle are held in confidential escrow waiting for you. Sign in with 𝕏 to auto-discover all incoming payments and claim them directly into your passkey vault."
            actionText="Sign In with 𝕏"
          />
        )
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

      {/* Passkey Authentication Modal Prompt */}
      <PasskeyPrompt
        isOpen={showPasskeyModal}
        onClose={() => setShowPasskeyModal(false)}
        onConfirm={handleConfirmPasskeyClaim}
        handle={user?.handle || 'your account'}
        isClaiming={isClaiming}
        hasExistingPasskey={hasPasskey}
      />
    </div>
  );
};
