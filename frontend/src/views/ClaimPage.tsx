'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useLocation, Link } from '../lib/router';
import {
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useClaimFlow } from '../hooks/useClaimFlow';
import { useXAuth } from '../hooks/useXAuth';
import { PasskeyPrompt } from '../components/PasskeyPrompt';
import { XAuthBanner } from '../components/XAuthBanner';
import { InAppBrowserNotice } from '../components/InAppBrowserNotice';
import { TokenIcon } from '../components/TokenIcon';
import { BackBar } from '../components/BackBar';
import { formatUsd, sumUsd, api } from '../lib/api';
import { PaymentIntent } from '../types';
import { currentInvite, inviteFromSearch } from '../lib/invite';

// ── Shielded balance withdraw card ──────────────────────────────────────────
const WithdrawCard: React.FC<{
  balances: { token: { id: string; symbol: string; iconUrl?: string }; amount: string; amountUsd: number | null }[];
  isClaiming: boolean;
  onWithdraw: (balanceIndex: number, destination: string) => Promise<unknown>;
}> = ({ balances, isClaiming, onWithdraw }) => {
  const [balanceIndex, setBalanceIndex] = useState(0);
  const [destination, setDestination] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const active = balances.length > 0 ? balances[Math.min(balanceIndex, balances.length - 1)] : null;

  const handleWithdraw = async () => {
    setResult(null);
    try {
      const res = (await onWithdraw(Math.min(balanceIndex, balances.length - 1), destination.trim())) as {
        success: boolean;
        txHash: string;
      };
      setResult(`Withdrawn — tx ${res.txHash}`);
    } catch {
      // Error is surfaced by the page-level error alert
    }
  };

  if (balances.length === 0) return null;

  return (
    <div className="rounded-3xl p-5 sm:p-6 bg-white border border-stone-200 shadow-xs space-y-4">
      <div className="flex items-center space-x-2.5">
        <ArrowUpRight className="w-5 h-5 text-stone-900" />
        <div>
          <div className="text-xs font-bold text-stone-950 font-display">Withdraw from Vault</div>
          <div className="text-[11px] text-stone-500 font-mono">
            Passkey-authorized · settle via POST /api/claim/withdraw
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5">
        <select
          value={Math.min(balanceIndex, balances.length - 1)}
          onChange={(e) => setBalanceIndex(Number(e.target.value))}
          className="sm:w-48 rounded-xl bg-stone-50 border border-stone-200 px-3 py-2.5 text-xs font-mono text-stone-900 focus:outline-none focus:border-black"
        >
          {balances.map((b, i) => (
            <option key={`${b.token.id}-${i}`} value={i}>
              {b.token.symbol} · {b.amount}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value.trim())}
          placeholder="Destination address (NEAR, 0x…, Solana)…"
          className="flex-1 rounded-xl bg-stone-50 border border-stone-200 px-3 py-2.5 text-base sm:text-xs font-mono text-stone-900 placeholder-stone-400 focus:outline-none focus:border-black focus:bg-white"
        />
      </div>

      {result && (
        <p className="text-xs font-mono text-emerald-700 break-all">{result}</p>
      )}

      <button
        type="button"
        onClick={handleWithdraw}
        disabled={isClaiming || !destination.trim() || !active}
        className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-xs disabled:opacity-60"
      >
        <Fingerprint className="w-4 h-4" />
        <span>Withdraw {active ? `${active.token.symbol}` : ''} with Passkey</span>
      </button>
    </div>
  );
};

export const ClaimPage: React.FC<{ feesOnly?: boolean }> = ({ feesOnly = false }) => {
  const { user, isLoading: isAuthLoading } = useXAuth();
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();

  // Share links are path-style: https://app.uprail.world/claim/<paymentId>
  // (the trailing segment is only a payment code when it is not a route name).
  const pathSegments = pathname.split('/').filter(Boolean);
  const lastSegment = pathSegments[pathSegments.length - 1] || '';
  const isRouteName =
    lastSegment === '' ||
    lastSegment === 'claim' ||
    lastSegment === 'fees' ||
    lastSegment === 'app' ||
    lastSegment === 'id';
  const pathPaymentCode = isRouteName ? '' : lastSegment;

  const queryPaymentCode =
    searchParams.get('payment') || searchParams.get('code') || pathPaymentCode || '';
  // Remember the invite that arrived with the share link: the recipient is
  // about to be bounced through login/parking and must not have to retype it.
  const urlInvite = useMemo(
    () => inviteFromSearch(searchParams.toString()) || currentInvite() || '',
    [searchParams]
  );

  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);

  // A share link may point at a payment that was already DELIVERED (an
  // already-registered recipient, or a claim that already settled). In that
  // case the page shows a receipt notice instead of the claim flow.
  const [linkedPayment, setLinkedPayment] = useState<PaymentIntent | null>(null);
  useEffect(() => {
    if (!queryPaymentCode || !user) {
      setLinkedPayment(null);
      return;
    }
    let active = true;
    api
      .getPaymentByCode(queryPaymentCode)
      .then((p) => {
        if (active) setLinkedPayment(p);
      })
      .catch(() => {
        if (active) setLinkedPayment(null);
      });
    return () => {
      active = false;
    };
  }, [queryPaymentCode, user]);

  const isReceipt = Boolean(
    linkedPayment &&
      user?.handle &&
      linkedPayment.recipientHandle?.replace(/^@/, '').toLowerCase() === user.handle.toLowerCase() &&
      (linkedPayment.isDirect || linkedPayment.status === 'claimed')
  );

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
    withdrawShieldedWithPasskey,
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
    } catch {
      // Error is set in the hook — it will display inside PasskeyPrompt
    } finally {
      setShowPasskeyModal(false);
    }
  };

  const visiblePayments = feesOnly ? pendingPayments.filter((p) => p.isCreatorFee) : pendingPayments;
  const totalPendingUsd = sumUsd(visiblePayments.map((p) => p.amountUsd));

  return (
    <div className="w-full space-y-6">
      {/* Back navigation — wide bar on desktop, floating round on mobile */}
      <BackBar label="Back to Home" />

      {/* Passkeys are unavailable inside X/Telegram webviews — warn early */}
      <InAppBrowserNotice />

      {/* Refresh (page title removed — the back bar owns the top now) */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => loadPendingPayments()}
          disabled={isLoading}
          className="p-2.5 rounded-xl border border-stone-200 hover:border-black text-stone-600 hover:text-black bg-stone-50 transition-colors cursor-pointer text-xs flex items-center space-x-1.5 font-mono font-bold"
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
            Full Access Preloaded
          </span>
        </div>
      )}

      {/* Receipt: the linked payment was already delivered to this vault */}
      {isReceipt && linkedPayment && (
        <div className="rounded-3xl p-6 sm:p-7 bg-stone-50 border border-stone-200 shadow-xs space-y-4 animate-fade-in">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display text-stone-950">Payment received</h3>
              <p className="text-xs text-stone-500 font-mono">
                From @{linkedPayment.senderHandle || 'anonymous'} ·{' '}
                {new Date(linkedPayment.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3.5 p-3.5 rounded-2xl bg-white border border-stone-200">
            <TokenIcon
              symbol={linkedPayment.token.symbol}
              iconUrl={linkedPayment.token.iconUrl}
              size="lg"
            />
            <div>
              <div className="text-base font-extrabold font-display text-stone-950">
                {linkedPayment.amount} {linkedPayment.token.symbol}
              </div>
              <div className="text-xs text-stone-500 font-mono">
                ≈ {formatUsd(linkedPayment.amountUsd)} USD
              </div>
            </div>
            <span className="ml-auto text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
              Delivered to your vault
            </span>
          </div>

          {linkedPayment.memo && (
            <p className="text-xs text-stone-500 font-mono italic">"{linkedPayment.memo}"</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/app/home"
              className="py-2.5 px-4 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              Open Dashboard
            </Link>
            <Link
              to="/app/claim"
              className="py-2.5 px-4 rounded-xl border border-stone-200 hover:border-black text-stone-700 hover:text-black font-display font-bold text-xs uppercase tracking-wider bg-white transition-colors cursor-pointer"
            >
              Claim Other Payments
            </Link>
          </div>
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

      {/* Shielded Vault Balances + Passkey Withdraw */}
      {user && (
        <WithdrawCard
          balances={shieldedBalances}
          isClaiming={isClaiming}
          onWithdraw={withdrawShieldedWithPasskey}
        />
      )}

      {/* Pending Payments List — AUTOMATICALLY DISCOVERED (No link/code input!) */}
      {!isReceipt && !isLoading && visiblePayments.length > 0 && (
        <div className="space-y-4">
          {/* Batch Claim All CTA (if more than 1 payment) */}
          {visiblePayments.length > 1 && (
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-2.5">
                <Sparkles className="w-5 h-5 text-stone-900" />
                <div>
                  <div className="text-xs font-bold text-stone-950 font-display">
                    {visiblePayments.length} {feesOnly ? 'Creator Fees' : 'Payments'} Waiting
                  </div>
                  <div className="text-[11px] text-stone-500 font-mono">
                    Total: ≈ {formatUsd(totalPendingUsd)} USD
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
            {visiblePayments.map((p) => (
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
                        ≈ {formatUsd(p.amountUsd)} USD
                      </span>
                      {p.isCreatorFee && (
                        <span className="text-[9px] font-mono uppercase font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          Creator fee
                        </span>
                      )}
                      <span className="text-[9px] font-mono uppercase font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">
                        {p.status}
                      </span>
                    </div>

                    <div className="text-xs font-mono text-stone-600 flex items-center space-x-1.5">
                      {p.isCreatorFee ? (
                        <>
                          <span>From:</span>
                          <span className="font-bold text-stone-900">
                            {p.creatorLaunchpad || 'launchpad'} launchpad
                          </span>
                        </>
                      ) : (
                        <>
                          <span>Sent by:</span>
                          <span className="font-bold text-stone-900">@{p.senderHandle || 'anonymous'}</span>
                        </>
                      )}
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
      {!isReceipt &&
        (!user ? (
        !isAuthLoading && (
          <XAuthBanner
            title="Sign In with 𝕏 to Discover Incoming Claims"
            description="Payments sent to your 𝕏 handle are held in confidential escrow waiting for you. Sign in with 𝕏 to auto-discover all incoming payments and claim them directly into your passkey vault."
            actionText="Sign In with 𝕏"
          />
        )
      ) : (
        /* Empty State: Authenticated but NO pending payments */
        !isLoading && visiblePayments.length === 0 && (
          <div className="rounded-3xl p-8 sm:p-12 bg-white border border-stone-200 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 text-stone-800 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-bold font-display text-stone-950">
                {feesOnly ? 'No Creator Fees Yet' : 'All Caught Up!'}
              </h3>
              <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
                {feesOnly
                  ? 'Launchpad creator fees paid to your X handle will appear here, ready to claim with your passkey.'
                  : 'You have no pending payments. When anyone sends funds to'}
                {!feesOnly && (
                  <>
                    {' '}
                    <span className="font-mono font-bold text-stone-900">@{user.handle}</span>, they will
                    automatically appear here ready to claim with your passkey.
                  </>
                )}
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
      ))}

      {/* Passkey Authentication Modal Prompt */}
      <PasskeyPrompt
        isOpen={showPasskeyModal}
        onClose={() => setShowPasskeyModal(false)}
        onConfirm={handleConfirmPasskeyClaim}
        handle={user?.handle || 'your account'}
        isClaiming={isClaiming}
        hasExistingPasskey={hasPasskey}
        error={error}
        onClearError={clearError}
      />
    </div>
  );
};
