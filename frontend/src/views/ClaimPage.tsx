'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useLocation, useNavigate, Link } from '../lib/router';
import {
  Fingerprint,
  CheckCircle,
  WarningCircle,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowsClockwise,
  Sparkle,
  User,
  Copy,
  Check,
} from '@phosphor-icons/react';
import { useClaimFlow } from '../hooks/useClaimFlow';
import { useXAuth } from '../hooks/useXAuth';
import { PasskeyPrompt } from '../components/PasskeyPrompt';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { XAuthBanner } from '../components/XAuthBanner';
import { InAppBrowserNotice } from '../components/InAppBrowserNotice';
import { TokenIcon } from '../components/TokenIcon';
import { BackBar } from '../components/BackBar';
import { Badge, BadgeTone } from '../components/Badge';
import { formatTokenAmount, formatUsd, sumUsd, api } from '../lib/api';
import { PaymentIntent, PaymentStatus, ShieldedBalance } from '../types';

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Waiting',
  escrowed: 'Waiting',
  ready: 'Ready',
  claimed: 'Received',
  expired: 'Expired',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

const PAYMENT_STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  pending: 'warn',
  escrowed: 'warn',
  ready: 'ok',
  claimed: 'ok',
  expired: 'danger',
  refunded: 'neutral',
  cancelled: 'danger',
};

// ── Withdraw shortcut ───────────────────────────────────────────────────────
const WithdrawRedirectCard: React.FC<{ balances: ShieldedBalance[] }> = ({ balances }) => {
  const totalUsd = sumUsd(balances.map((b) => b.amountUsd));
  const count = balances.length;

  return (
    <Link
      to="/app/send?mode=wallet"
      className="rounded-3xl p-5 sm:p-6 bg-white border border-stone-200 shadow-xs flex items-center justify-between gap-4 hover:border-black transition-colors group"
    >
      <div className="flex items-center space-x-3 min-w-0">
        <div className="w-10 h-10 rounded-2xl bg-stone-100 text-stone-900 flex items-center justify-center flex-shrink-0 group-hover:bg-stone-900 group-hover:text-white transition-colors">
          <ArrowUpRight weight="bold" className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-stone-950 font-display">Withdraw to a wallet</div>
          <div className="text-[11px] text-stone-500 font-mono truncate">
            {count} asset{count === 1 ? '' : 's'} available
            {totalUsd != null && totalUsd > 0 ? ` · ≈ ${formatUsd(totalUsd)}` : ''}
          </div>
        </div>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-stone-200 px-3 py-2 text-[10px] font-display font-extrabold uppercase tracking-wider text-stone-700 group-hover:border-black group-hover:text-black transition-colors">
        Open Send
        <ArrowRight weight="bold" className="w-3.5 h-3.5" />
      </span>
    </Link>
  );
};

export const ClaimPage: React.FC = () => {
  const { user, isLoading: isAuthLoading } = useXAuth();
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isFeesView = searchParams.get('view') === 'fees';

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
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [pendingClaim, setPendingClaim] = useState<{ id: string; all: boolean } | null>(null);

  // A share link may point at a payment that was already DELIVERED or sent by this user.
  const [linkedPayment, setLinkedPayment] = useState<PaymentIntent | null>(null);
  useEffect(() => {
    if (!queryPaymentCode) {
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
  }, [queryPaymentCode]);

  const userHandle = user?.handle?.replace(/^@/, '').toLowerCase();
  const recipientHandle = linkedPayment?.recipientHandle?.replace(/^@/, '').toLowerCase();
  const senderHandle = linkedPayment?.senderHandle?.replace(/^@/, '').toLowerCase();

  const isSender = Boolean(linkedPayment && userHandle && senderHandle && userHandle === senderHandle);
  const isRecipient = Boolean(linkedPayment && userHandle && recipientHandle && userHandle === recipientHandle);
  const isThirdParty = Boolean(
    linkedPayment && userHandle && recipientHandle && userHandle !== recipientHandle && userHandle !== senderHandle
  );
  const isReceipt = Boolean(
    linkedPayment && (isRecipient || !userHandle) && (linkedPayment.isDirect || linkedPayment.status === 'claimed')
  );
  const isHandledTargetedView = Boolean(isReceipt || isSender || isThirdParty);

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
    setPendingClaim({ id: paymentId, all: paymentId === 'all' });
  };

  const handleConfirmClaimStart = () => {
    if (!pendingClaim) return;
    setActiveClaimId(pendingClaim.id);
    setShowPasskeyModal(true);
    setPendingClaim(null);
  };

  const handleConfirmPasskeyClaim = async () => {
    try {
      if (activeClaimId === 'all') {
        await claimAllWithPasskey(visiblePayments);
      } else if (activeClaimId) {
        await claimPaymentWithPasskey(activeClaimId);
      }
    } catch {
      // Error is set in the hook — it will display inside PasskeyPrompt
    } finally {
      setShowPasskeyModal(false);
    }
  };

  const handleRefresh = async () => {
    if (isFeesView) {
      await api.syncCreatorFees().catch(() => {});
    }
    await Promise.all([loadPendingPayments(), loadShieldedBalances()]);
  };

  const creatorFeePayments = pendingPayments.filter((p) => p.isCreatorFee);
  const visiblePayments = isFeesView ? creatorFeePayments : pendingPayments;
  const totalPendingUsd = sumUsd(visiblePayments.map((p) => p.amountUsd));

  const previewPayment =
    pendingClaim && !pendingClaim.all
      ? pendingPayments.find((p) => p.id === pendingClaim.id) || null
      : null;
  const previewCount = pendingClaim?.all ? visiblePayments.length : previewPayment ? 1 : 0;
  const previewUsd = pendingClaim?.all ? totalPendingUsd : previewPayment?.amountUsd ?? null;

  return (
    <div className="w-full space-y-6">
      {/* Back navigation — wide bar on desktop, floating round on mobile */}
      <BackBar label="Back to Home" />

      {/* Passkeys are unavailable inside X/Telegram webviews — warn early */}
      <InAppBrowserNotice />

      {/* Payments / Creator fees tabs, plus refresh */}
      <div className="flex items-center justify-between gap-2">
        {!queryPaymentCode ? (
          <div className="grid flex-1 sm:flex-initial grid-cols-2 gap-1.5 p-1.5 rounded-2xl bg-stone-50 border border-stone-200 sm:w-auto">
            <button
              type="button"
              onClick={() => navigate('/app/claim', { replace: true })}
              aria-pressed={!isFeesView}
              className={`flex items-center justify-center gap-1.5 min-h-10 px-3 sm:px-4 py-2 rounded-xl border text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                !isFeesView
                  ? 'bg-black text-white border-black'
                  : 'bg-transparent text-stone-600 border-transparent hover:bg-stone-100 hover:text-black'
              }`}
            >
              <Fingerprint weight="bold" className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Payments</span>
              {pendingPayments.length > 0 && (
                <Badge tone="neutral">{pendingPayments.length}</Badge>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/claim?view=fees', { replace: true })}
              aria-pressed={isFeesView}
              className={`flex items-center justify-center gap-1.5 min-h-10 px-3 sm:px-4 py-2 rounded-xl border text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                isFeesView
                  ? 'bg-black text-white border-black'
                  : 'bg-transparent text-stone-600 border-transparent hover:bg-stone-100 hover:text-black'
              }`}
            >
              <Sparkle weight="fill" className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Creator fees</span>
              {creatorFeePayments.length > 0 && (
                <Badge tone="neutral">{creatorFeePayments.length}</Badge>
              )}
            </button>
          </div>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          aria-label="Refresh"
          title="Refresh incoming payments"
          className="w-12 h-12 rounded-2xl border border-stone-200 hover:border-black text-stone-600 hover:text-black bg-stone-50 transition-colors cursor-pointer flex items-center justify-center flex-shrink-0"
        >
          <ArrowsClockwise weight="bold" className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* SENDER RECEIPT: Current user sent this payment */}
      {isSender && linkedPayment && (
        <div className="rounded-3xl p-6 sm:p-7 bg-white border border-stone-200 shadow-xs space-y-4 animate-fade-in text-left">
          <div className="flex items-center space-x-3.5">
            <div className="w-11 h-11 rounded-2xl bg-stone-100 border border-stone-200 text-stone-900 flex items-center justify-center flex-shrink-0">
              <ArrowUpRight weight="bold" className="w-6 h-6 text-stone-800" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold font-display text-stone-950">Payment Sent</h3>
                <Badge tone={linkedPayment.status === 'claimed' ? 'ok' : 'warn'}>
                  {linkedPayment.status === 'claimed' ? 'Delivered' : 'Waiting for claim'}
                </Badge>
              </div>
              <p className="text-[13px] text-[var(--fg-muted)] font-sans mt-0.5">
                To @{linkedPayment.recipientHandle} ·{' '}
                {new Date(linkedPayment.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-stone-50 border border-stone-200">
            <div className="flex items-center space-x-3">
              <TokenIcon
                symbol={linkedPayment.token.symbol}
                iconUrl={linkedPayment.token.iconUrl}
                size="lg"
              />
              <div>
                <div className="text-[26px] leading-tight font-extrabold font-display text-stone-950">
                  -{formatTokenAmount(linkedPayment.amount)} {linkedPayment.token.symbol}
                </div>
                {linkedPayment.token.symbol !== 'USDC' && linkedPayment.token.symbol !== 'USDT' && (
                  <div className="text-xs text-[var(--fg-muted)] font-mono">
                    ≈ {formatUsd(linkedPayment.amountUsd)} USD
                  </div>
                )}
              </div>
            </div>
            <Badge tone={linkedPayment.status === 'claimed' ? 'ok' : 'warn'}>
              {linkedPayment.status === 'claimed' ? 'Claimed by recipient' : 'In confidential escrow'}
            </Badge>
          </div>

          {linkedPayment.memo && (
            <p className="text-xs text-[var(--fg-muted)] font-sans">{linkedPayment.memo}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/app/home"
              className="py-2.5 px-4 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              Open Dashboard
            </Link>
            <Link
              to="/app/history"
              className="py-2.5 px-4 rounded-xl border border-stone-200 hover:border-black text-stone-700 hover:text-black font-display font-bold text-xs uppercase tracking-wider bg-white transition-colors cursor-pointer"
            >
              View Full Ledger
            </Link>
          </div>
        </div>
      )}

      {/* THIRD-PARTY NOTICE: Logged in as someone else */}
      {isThirdParty && linkedPayment && (
        <div className="rounded-3xl p-6 sm:p-7 bg-white border border-stone-200 shadow-xs space-y-4 animate-fade-in text-left">
          <div className="flex items-center space-x-3.5">
            <div className="w-11 h-11 rounded-2xl bg-stone-100 border border-stone-200 text-stone-700 flex items-center justify-center flex-shrink-0">
              <User weight="fill" className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display text-stone-950">
                Payment for @{linkedPayment.recipientHandle}
              </h3>
              <p className="text-xs text-stone-500 font-mono mt-0.5">
                Sent by @{linkedPayment.senderHandle || 'anonymous'} · {new Date(linkedPayment.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs text-stone-600 font-sans space-y-2">
            <p>
              This payment is addressed exclusively to <strong className="font-mono text-stone-900 font-bold">@{linkedPayment.recipientHandle}</strong>.
            </p>
            <p className="text-stone-500 text-[11px] font-mono">
              You are currently signed in as <strong className="text-stone-900 font-bold">@{user?.handle}</strong>. Only the intended recipient can claim these funds.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/app/home"
              className="py-2.5 px-4 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              Go to Your Dashboard
            </Link>
          </div>
        </div>
      )}

      {/* RECIPIENT RECEIPT: The linked payment was already delivered to recipient's vault */}
      {isReceipt && linkedPayment && (
        <div className="rounded-3xl p-6 sm:p-7 bg-stone-50 border border-stone-200 shadow-xs space-y-4 animate-fade-in text-left">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 flex items-center justify-center">
              <ArrowDownLeft weight="bold" className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display text-stone-950">Payment received</h3>
              <p className="text-xs text-stone-500 font-mono">
                From @{linkedPayment.senderHandle || 'anonymous'} ·{' '}
                {new Date(linkedPayment.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-2xl bg-white border border-stone-200">
            <TokenIcon
              symbol={linkedPayment.token.symbol}
              iconUrl={linkedPayment.token.iconUrl}
              size="lg"
            />
            <div>
              <div className="text-[26px] leading-tight font-extrabold font-display text-emerald-600">
                +{formatTokenAmount(linkedPayment.amount)} {linkedPayment.token.symbol}
              </div>
              {linkedPayment.token.symbol !== 'USDC' && linkedPayment.token.symbol !== 'USDT' && (
                <div className="text-xs text-[var(--fg-muted)] font-mono">
                  ≈ {formatUsd(linkedPayment.amountUsd)} USD
                </div>
              )}
            </div>
            <div className="sm:ml-auto">
              <Badge tone="ok">In your UPRAIL vault</Badge>
            </div>
          </div>

          {linkedPayment.memo && (
            <p className="text-xs text-[var(--fg-muted)] font-sans">{linkedPayment.memo}</p>
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
              See Other Payments
            </Link>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between animate-fade-in">
          <div className="flex items-center space-x-2.5">
            <WarningCircle weight="fill" className="w-4 h-4 text-red-500 flex-shrink-0" />
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
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-white text-stone-900 flex items-center justify-center font-bold flex-shrink-0">
                <CheckCircle weight="fill" className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display">Money received</h3>
                <p className="text-xs text-stone-300 font-mono">
                  {claimResult?.message || 'It\'s in your UPRAIL account.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={resetSuccess}
              className="min-h-11 px-4 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-display font-bold transition-colors cursor-pointer flex-shrink-0"
            >
              Done
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-800 text-xs font-mono">
            <span className="text-emerald-400 font-bold">Received and secured</span>
            {claimResult?.shieldedTxHash && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-stone-300 truncate max-w-[160px]">
                  Tx: {claimResult.shieldedTxHash}
                </span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(claimResult.shieldedTxHash!)}
                  aria-label="Copy transaction hash"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-stone-200 cursor-pointer"
                >
                  <Copy weight="fill" className="w-3.5 h-3.5" />
                </button>
              </div>
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

      {/* Withdraw shortcut — the Send screen owns the full flow, including
          destination network selection, quote, and receipt. */}
      {user && shieldedBalances.length > 0 && (
        <WithdrawRedirectCard balances={shieldedBalances} />
      )}

      {/* Pending Payments List — AUTOMATICALLY DISCOVERED (No link/code input!) */}
      {!isHandledTargetedView && !isLoading && visiblePayments.length > 0 && (
        <div className="space-y-4">
          {/* Batch Claim All CTA (if more than 1 payment) */}
          {visiblePayments.length > 1 && (
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-stone-950 font-display">
                  {visiblePayments.length} {isFeesView ? 'creator fees' : 'payments'} waiting
                </div>
                <div className="text-xs text-[var(--fg-muted)] font-sans">
                  {formatUsd(totalPendingUsd)} total
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleStartClaim('all')}
                disabled={isClaiming}
                className="w-full sm:w-auto min-h-11 px-5 py-2.5 rounded-xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-xs disabled:opacity-60"
              >
                <Fingerprint weight="bold" className="w-4 h-4" />
                <span>Receive all</span>
              </button>
            </div>
          )}

          {/* Individual Payment Cards */}
          <div className="space-y-3">
            {visiblePayments.map((p) => {
              const isStable = p.token.symbol === 'USDC' || p.token.symbol === 'USDT';
              const shortDate = new Date(p.createdAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              });
              return (
                <div
                  key={p.id}
                  className="rounded-3xl p-4 sm:p-6 bg-white border border-stone-200 shadow-xs hover:border-stone-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  {/* Left: Token Icon + Amount Hero + Sender + Memo */}
                  <div className="flex items-start sm:items-center space-x-3.5 min-w-0">
                    <TokenIcon
                      symbol={p.token.symbol}
                      iconUrl={p.token.iconUrl}
                      size="xl"
                      className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex-shrink-0"
                    />
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[26px] leading-tight font-extrabold text-stone-950 font-display tracking-tight">
                          {formatTokenAmount(p.amount)} {p.token.symbol}
                        </span>
                        {!isStable && p.amountUsd != null && (
                          <span className="text-xs text-[var(--fg-muted)] font-mono">
                            ≈ {formatUsd(p.amountUsd)} USD
                          </span>
                        )}
                        {p.isCreatorFee && (
                          <Badge tone="neutral">Creator fee</Badge>
                        )}
                        <Badge tone={PAYMENT_STATUS_TONE[p.status]}>
                          {PAYMENT_STATUS_LABEL[p.status]}
                        </Badge>
                      </div>

                      <div className="text-[13px] font-sans text-[var(--fg-muted)] flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        {p.isCreatorFee ? (
                          <>
                            <span>From</span>
                            <span className="font-semibold text-stone-900">
                              {p.creatorLaunchpad || 'launchpad'} launchpad
                            </span>
                          </>
                        ) : (
                          <>
                            <span>From</span>
                            <span className="font-semibold text-stone-900">
                              @{p.senderHandle || 'anonymous'}
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span>{shortDate}</span>
                      </div>

                      {p.memo && (
                        <p className="text-xs text-[var(--fg-muted)] font-sans break-words">
                          {p.memo}
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
                      className="w-full sm:w-auto min-h-11 px-5 py-3 rounded-2xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-xs transition-all cursor-pointer disabled:opacity-60"
                    >
                      <Fingerprint weight="bold" className="w-4 h-4" />
                      <span>Receive payment</span>
                      <ArrowRight weight="bold" className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Authentication / Empty State Handling */}
      {!isHandledTargetedView &&
        (!user ? (
        !isAuthLoading && (
          <XAuthBanner
            title="Sign In with 𝕏 to See Your Payments"
            description="When someone sends you money on UPRAIL, it waits here until you receive it. Sign in with 𝕏 to see it."
            actionText="Sign In with 𝕏"
          />
        )
      ) : (
        /* Empty State: Authenticated but NO pending payments */
        !isLoading && visiblePayments.length === 0 && (
          <div className="rounded-3xl p-8 sm:p-12 bg-white border border-stone-200 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 text-stone-800 flex items-center justify-center mx-auto">
              <CheckCircle weight="fill" className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-bold font-display text-stone-950">
                {isFeesView ? 'No Creator Fees Yet' : 'All Caught Up!'}
              </h3>
              <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
                {isFeesView
                  ? 'Creator fees paid to your X handle by a launchpad will appear here automatically. Nothing to set up on this page.'
                  : 'You have no pending payments. When anyone sends funds to'}
                {!isFeesView && (
                  <>
                    {' '}
                    <span className="font-mono font-bold text-stone-900">@{user.handle}</span>, they will
                    automatically appear here, ready to receive.
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
                Deposit funds
              </Link>
            </div>
          </div>
        )
      ))}

      <ConfirmDialog
        isOpen={Boolean(pendingClaim)}
        onCancel={() => setPendingClaim(null)}
        onConfirm={handleConfirmClaimStart}
        tone="financial"
        title={pendingClaim?.all ? 'Receive all payments' : 'Receive payment'}
        description="Confirm with Face ID or fingerprint next."
        confirmLabel="Continue"
        details={[
          ...(pendingClaim?.all
            ? [
                { label: 'Payments', value: String(previewCount), emphasis: true },
                {
                  label: 'Total value',
                  value: previewUsd != null ? `≈ ${formatUsd(previewUsd)}` : '—',
                },
              ]
            : [
                {
                  label: 'From',
                  value: previewPayment ? `@${previewPayment.senderHandle}` : '—',
                  mono: false,
                },
                {
                  label: 'Amount',
                  value: previewPayment
                    ? `${formatTokenAmount(previewPayment.amount)} ${previewPayment.token.symbol}`
                    : '—',
                  emphasis: true,
                },
                ...(previewPayment?.amountUsd != null
                  ? [{ label: 'Value', value: `≈ ${formatUsd(previewPayment.amountUsd)}` }]
                  : []),
                ...(previewPayment?.memo
                  ? [{ label: 'Note', value: previewPayment.memo, mono: false }]
                  : []),
              ]),
          { label: 'Destination', value: `@${user?.handle || 'your account'}`, mono: false },
        ]}
      />

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
