'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Shield,
  Copy,
  Check,
  QrCode,
  Share2,
  RefreshCw,
  X,
  Ban,
  User,
  ExternalLink,
} from 'lucide-react';
import { api, formatTokenAmount, formatUsd, tokenUsdPrice, cleanAssetSymbol } from '../lib/api';
import { useXAuth } from '../hooks/useXAuth';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { useOnchainData } from '../hooks/useOnchainData';
import { useToast } from '../components/Toast';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { fetchDepositAddress } from '../lib/onchainApi';
import { Link } from '../lib/router';
import type { PaymentRequest, Token } from '../types';

interface PublicRequestViewProps {
  requestId?: string;
}

export const PublicRequestView: React.FC<PublicRequestViewProps> = ({ requestId: propId }) => {
  const { user } = useXAuth();
  const { authorizeWithPasskey } = usePasskeyTxAuth();
  const { balances, tokens, refreshBalances } = useOnchainData();
  const { toast } = useToast();

  const [id, setId] = useState<string>(propId || '');
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [isCopiedDeposit, setIsCopiedDeposit] = useState(false);
  const [isCopiedShare, setIsCopiedShare] = useState(false);
  const [successPaymentId, setSuccessPaymentId] = useState<string | null>(null);

  // Extract ID from prop or window location if not passed
  useEffect(() => {
    if (!id && typeof window !== 'undefined') {
      const parts = window.location.pathname.split('/');
      const reqIdx = parts.indexOf('request');
      if (reqIdx !== -1 && parts[reqIdx + 1]) {
        setId(parts[reqIdx + 1]);
      }
    }
  }, [id]);

  const loadRequest = async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      setError(null);
      const req = await api.getPublicRequest(id);
      setRequest(req);
    } catch (err: any) {
      setError(err?.message || 'Payment request not found or expired');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (id) loadRequest();
  }, [id]);

  const cleanTicker = request?.asset ? cleanAssetSymbol(request.asset) : 'USDC';

  // Resolve requested token and user's held balance
  const targetToken = tokens.find(
    (t) =>
      t.id.toLowerCase() === request?.asset.toLowerCase() ||
      t.symbol.toLowerCase() === request?.asset.toLowerCase() ||
      (request?.asset && t.nearContractId && request.asset.includes(t.nearContractId))
  ) || {
    id: request?.asset || 'usdc',
    symbol: cleanTicker,
    name: cleanTicker,
    decimals: 6,
    iconUrl: '',
    nearContractId: '',
  };

  const cleanAmountFormatted = (() => {
    let raw = request?.amount_formatted || `${request?.amount} ${cleanTicker}`;
    if (
      raw.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1') ||
      raw.toLowerCase().includes('nep141:') ||
      /^[0-9a-f]{64}/i.test(raw.split(' ').pop() || '')
    ) {
      return `${request?.amount} ${cleanTicker}`;
    }
    return raw;
  })();

  const heldBalanceItem = balances.find(
    (b) =>
      b.defuse_asset_id?.toLowerCase() === request?.asset.toLowerCase() ||
      b.symbol.toLowerCase() === targetToken.symbol.toLowerCase() ||
      (request?.asset && b.nearContractId && request.asset.includes(b.nearContractId))
  );

  const availableBalanceNum = parseFloat(heldBalanceItem?.amountFormatted || heldBalanceItem?.amount || '0') || 0;
  const requestedAmountNum = parseFloat(request?.amount || '0') || 0;
  const isFunded = availableBalanceNum >= requestedAmountNum;

  // Identity checks
  const isRequester =
    user?.handle && request?.requester_handle && user.handle.toLowerCase() === request.requester_handle.toLowerCase();
  const isRequestedRecipient =
    user?.handle && request?.requested_handle && user.handle.toLowerCase() === request.requested_handle.toLowerCase();
  const isOtherUser = user?.handle && !isRequester && !isRequestedRecipient;

  // Load deposit address if unfunded
  const loadDeposit = async () => {
    try {
      const chain = 'near';
      const addr = await fetchDepositAddress(chain);
      if (addr?.address) setDepositAddress(addr.address);
    } catch (err) {
      console.warn('Could not load deposit address:', err);
    }
  };

  const handleAcceptAndPay = async () => {
    if (!request || !isRequestedRecipient) return;
    try {
      setIsProcessing(true);
      setActionError(null);

      // 1. Authorize movement of funds with passkey
      let assertion: unknown = undefined;
      try {
        assertion = await authorizeWithPasskey(
          `Pay request of ${request.amount} ${targetToken.symbol} to @${request.requester_handle}`
        );
      } catch (authErr: any) {
        throw new Error(authErr?.message || 'Passkey authorization cancelled');
      }

      // 2. Execute payment intent linked to requestId
      const payment = await api.createPayment({
        recipientHandle: request.requester_handle,
        tokenId: request.asset,
        amount: request.amount,
        memo: request.memo || undefined,
        passkeyAssertion: assertion,
        requestId: request.id,
        token: targetToken,
      });

      // 3. Update status locally
      setRequest((prev) => (prev ? { ...prev, status: 'COMPLETED', payment_id: payment.id } : null));
      setSuccessPaymentId(payment.id);
      toast('Payment request successfully paid!');
      refreshBalances();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to complete payment');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!request || !isRequestedRecipient) return;
    try {
      setIsProcessing(true);
      setActionError(null);
      await api.declinePaymentRequest(request.id, declineReason.trim() || undefined);
      setRequest((prev) => (prev ? { ...prev, status: 'DECLINED', decline_reason: declineReason } : null));
      setShowDeclineModal(false);
      toast('Payment request declined');
    } catch (err: any) {
      setActionError(err?.message || 'Failed to decline request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = async () => {
    if (!request || !isRequester) return;
    try {
      setIsProcessing(true);
      setActionError(null);
      await api.cancelPaymentRequest(request.id);
      setRequest((prev) => (prev ? { ...prev, status: 'CANCELLED' } : null));
      toast('Payment request cancelled');
    } catch (err: any) {
      setActionError(err?.message || 'Failed to cancel request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBlockRequester = async () => {
    if (!request) return;
    if (confirm(`Block @${request.requester_handle} from sending you payment requests?`)) {
      try {
        await api.blockUser(request.requester_handle);
        toast(`@${request.requester_handle} blocked`);
      } catch (err: any) {
        toast(err?.message || 'Could not block user');
      }
    }
  };

  const handleCopyShareLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setIsCopiedShare(true);
      toast('Link copied to clipboard');
      setTimeout(() => setIsCopiedShare(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4 animate-fade-in">
        <div className="w-12 h-12 rounded-2xl bg-stone-100 dark:bg-stone-800 animate-pulse mx-auto" />
        <div className="h-4 w-40 bg-stone-100 dark:bg-stone-800 rounded-md mx-auto animate-pulse" />
        <div className="h-8 w-60 bg-stone-100 dark:bg-stone-800 rounded-md mx-auto animate-pulse" />
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center space-y-5 animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-center justify-center text-red-600 dark:text-red-400 mx-auto">
          <XCircle className="w-7 h-7" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold font-display text-stone-900 dark:text-white">
            Request Not Found
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {error || 'This payment request does not exist, has expired, or was removed.'}
          </p>
        </div>
        <Link
          to="/app"
          className="inline-flex py-3 px-6 rounded-2xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 text-xs font-mono font-bold transition-all shadow-xs"
        >
          Go to UPRAIL Dashboard
        </Link>
      </div>
    );
  }

  const isPending = request.status === 'PENDING';
  const isCompleted = request.status === 'COMPLETED';
  const isDeclined = request.status === 'DECLINED';
  const isCancelled = request.status === 'CANCELLED';
  const isExpired = request.status === 'EXPIRED';

  const returnUrl = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : `/request/${request.id}`;

  return (
    <div className="max-w-md mx-auto py-8 px-4 space-y-6 animate-fade-in">
      {/* Brand Header */}
      <div className="flex items-center justify-between pb-2 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-center space-x-2">
          <span className="font-extrabold text-sm font-display tracking-wider uppercase text-stone-900 dark:text-white">
            UPRAIL
          </span>
          <span className="text-[10px] font-mono text-stone-400">/</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Payment Request
          </span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={handleCopyShareLink}
            title="Share request link"
            className="p-1.5 rounded-lg border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-600 dark:text-stone-400 transition-colors"
          >
            {isCopiedShare ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Request Card */}
      <div className="rounded-3xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-sm p-6 space-y-5">
        {/* Status Badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <img
              src={request.requester_avatar || `https://unavatar.io/twitter/${request.requester_handle}`}
              alt={request.requester_handle}
              className="w-10 h-10 rounded-full border border-stone-200 dark:border-stone-700 object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                const fb = (e.currentTarget.parentElement?.querySelector('.avatar-initials') as HTMLElement);
                if (fb) fb.style.display = 'flex';
              }}
            />
            <div className="avatar-initials hidden w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-white font-mono font-bold items-center justify-center border border-stone-200 dark:border-stone-700">
              {request.requester_handle.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-xs font-bold text-stone-900 dark:text-white font-display">
                @{request.requester_handle}
              </div>
              <div className="text-[10px] text-stone-500 dark:text-stone-400 font-mono">
                requested payment
              </div>
            </div>
          </div>

          <div>
            {isPending && (
              <span className="px-2.5 py-1 rounded-full bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>Pending</span>
              </span>
            )}
            {isCompleted && (
              <span className="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center space-x-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Paid</span>
              </span>
            )}
            {isDeclined && (
              <span className="px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 text-[10px] font-mono font-bold uppercase tracking-wider">
                Declined
              </span>
            )}
            {isCancelled && (
              <span className="px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 text-[10px] font-mono font-bold uppercase tracking-wider">
                Cancelled
              </span>
            )}
            {isExpired && (
              <span className="px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 text-[10px] font-mono font-bold uppercase tracking-wider">
                Expired
              </span>
            )}
          </div>
        </div>

        {/* Amount Display */}
        <div className="text-center py-4 bg-stone-50 dark:bg-stone-950 rounded-2xl border border-stone-100 dark:border-stone-800 space-y-1">
          <div className="text-3xl font-extrabold font-mono text-stone-950 dark:text-white">
            {cleanAmountFormatted}
          </div>
          <div className="text-xs text-stone-500 dark:text-stone-400 font-mono">
            For @{request.requested_handle}
          </div>
        </div>

        {/* Memo & Meta */}
        <div className="space-y-2 text-xs font-mono">
          {request.memo && (
            <div className="p-3 rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800">
              <span className="text-stone-400 dark:text-stone-500 uppercase tracking-wider text-[9px] block mb-0.5">
                Reason
              </span>
              <p className="text-stone-900 dark:text-white font-sans text-xs">
                "{request.memo}"
              </p>
            </div>
          )}

          <div className="flex items-center justify-between text-stone-500 dark:text-stone-400 pt-1">
            <span>Requested</span>
            <span>{new Date(request.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center justify-between text-stone-500 dark:text-stone-400">
            <span>Expires</span>
            <span>{new Date(request.expires_at).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Action Error Message */}
        {actionError && (
          <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Interactive Actions Area */}
        <div className="pt-2">
          {/* Case 1: Unauthenticated Visitor */}
          {!user && (
            <div className="space-y-3">
              <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-xs text-stone-600 dark:text-stone-300 space-y-1 text-center">
                <p className="font-semibold text-stone-900 dark:text-white">
                  Requested from @{request.requested_handle}
                </p>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Sign in with 𝕏 to accept or decline. No crypto wallet or seed phrase needed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => api.loginWithX()}
                className="w-full py-4 rounded-2xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 font-display font-bold uppercase tracking-wider text-xs transition-all shadow-xs flex items-center justify-center space-x-2 cursor-pointer"
              >
                <span>Sign in with 𝕏 to Respond</span>
              </button>
            </div>
          )}

          {/* Case 2: Logged in as Other User */}
          {user && isOtherUser && (
            <div className="space-y-3">
              <div className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-xs text-stone-600 dark:text-stone-400 text-center">
                This request was sent to <strong className="text-stone-900 dark:text-white">@{request.requested_handle}</strong>.
                You are currently signed in as @{user.handle}.
              </div>
              <button
                type="button"
                onClick={() => api.loginWithX()}
                className="w-full py-3 rounded-2xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white font-mono font-bold text-xs hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
              >
                Switch 𝕏 Account
              </button>
            </div>
          )}

          {/* Case 3: Logged in as Requester */}
          {user && isRequester && (
            <div className="space-y-3">
              <div className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-xs text-stone-600 dark:text-stone-400 text-center font-mono">
                You created this request.
              </div>
              {isPending && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isProcessing}
                  className="w-full py-3.5 rounded-2xl border border-stone-300 dark:border-stone-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 font-mono font-bold text-xs transition-colors cursor-pointer"
                >
                  {isProcessing ? 'Cancelling...' : 'Cancel Request'}
                </button>
              )}
            </div>
          )}

          {/* Case 4: Logged in as Requested Recipient */}
          {user && isRequestedRecipient && (
            <div className="space-y-3">
              {isCompleted && (
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center space-y-1">
                  <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300 font-display">
                    Payment Completed
                  </div>
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
                    You paid {cleanAmountFormatted} to @{request.requester_handle}
                  </div>
                  {request.payment_id && (
                    <Link
                      to={`/app/claim/${request.payment_id}`}
                      className="inline-block mt-2 text-xs font-mono font-bold text-emerald-700 dark:text-emerald-300 underline"
                    >
                      View Receipt &rarr;
                    </Link>
                  )}
                </div>
              )}

              {isDeclined && (
                <div className="p-4 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-center text-xs text-stone-600 dark:text-stone-400">
                  You declined this request.
                </div>
              )}

              {isCancelled && (
                <div className="p-4 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-center text-xs text-stone-600 dark:text-stone-400">
                  This request was cancelled by @{request.requester_handle}.
                </div>
              )}

              {isExpired && (
                <div className="p-4 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-center text-xs text-stone-600 dark:text-stone-400">
                  This request has expired.
                </div>
              )}

              {isPending && (
                <div className="space-y-3">
                  {/* Balance Status */}
                  <div className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 flex items-center justify-between text-xs font-mono">
                    <span className="text-stone-500 dark:text-stone-400">Your Available Balance</span>
                    <span className="font-bold text-stone-900 dark:text-white">
                      {availableBalanceNum.toFixed(2)} {targetToken.symbol}
                    </span>
                  </div>

                  {isFunded ? (
                    /* Funded Flow: One-tap Accept with Passkey */
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={handleAcceptAndPay}
                        disabled={isProcessing}
                        className="w-full py-4 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white font-display font-bold uppercase tracking-wider text-xs transition-all flex items-center justify-center space-x-2 shadow-xs hover:shadow-md cursor-pointer disabled:opacity-50"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                        <span>{isProcessing ? 'Confirming...' : `Accept & Send ${cleanAmountFormatted}`}</span>
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setShowDeclineModal(true)}
                          disabled={isProcessing}
                          className="py-2.5 px-3 rounded-xl border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-mono font-bold transition-all"
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          onClick={handleBlockRequester}
                          className="py-2.5 px-3 rounded-xl border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-red-500 text-xs font-mono font-bold transition-all flex items-center justify-center space-x-1"
                        >
                          <Ban className="w-3 h-3" />
                          <span>Block</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Unfunded Flow: Deposit and Accept */
                    <div className="space-y-3">
                      <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                        <p className="font-bold">Vault Needs Funding</p>
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                          You need {cleanAmountFormatted} to accept this request. Deposit to your vault to proceed.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          loadDeposit();
                          setShowDepositModal(true);
                        }}
                        className="w-full py-4 rounded-2xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 font-display font-bold uppercase tracking-wider text-xs transition-all flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
                      >
                        <ArrowDownLeft className="w-4 h-4" />
                        <span>Deposit & Pay</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowDeclineModal(true)}
                        className="w-full py-2.5 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 text-xs font-mono font-bold hover:bg-stone-100 dark:hover:bg-stone-800"
                      >
                        Decline Request
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Decline Reason Modal */}
      {showDeclineModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold font-display uppercase tracking-wider text-stone-900 dark:text-white">
                Decline Request
              </h3>
              <button
                type="button"
                onClick={() => setShowDeclineModal(false)}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 font-sans">
              Are you sure you want to decline this payment request from @{request.requester_handle}?
            </p>
            <input
              type="text"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Reason (optional)"
              maxLength={200}
              className="w-full p-3 rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-xs text-stone-900 dark:text-white font-sans outline-hidden"
            />
            <div className="flex space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDeclineModal(false)}
                className="w-1/2 py-2.5 rounded-xl border border-stone-200 dark:border-stone-700 text-xs font-mono font-bold text-stone-700 dark:text-stone-300"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleDecline}
                disabled={isProcessing}
                className="w-1/2 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-mono font-bold disabled:opacity-50"
              >
                {isProcessing ? 'Declining...' : 'Confirm Decline'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold font-display uppercase tracking-wider text-stone-900 dark:text-white">
                Deposit to Your Vault
              </h3>
              <button
                type="button"
                onClick={() => setShowDepositModal(false)}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 font-sans">
              Send {targetToken.symbol} to your personal UPRAIL vault address. Once settled, tap "Refresh".
            </p>

            {depositAddress && (
              <div className="flex justify-center p-3 bg-white rounded-2xl border border-stone-200">
                <QRCodeDisplay value={depositAddress} size={150} />
              </div>
            )}

            <div className="p-3 rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 flex items-center justify-between text-xs font-mono">
              <span className="truncate max-w-[220px] text-stone-900 dark:text-white">
                {depositAddress || 'Loading address...'}
              </span>
              {depositAddress && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(depositAddress);
                    setIsCopiedDeposit(true);
                    setTimeout(() => setIsCopiedDeposit(false), 2000);
                  }}
                  className="p-1 text-stone-500 hover:text-stone-900 dark:hover:text-white"
                >
                  {isCopiedDeposit ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  refreshBalances();
                  setShowDepositModal(false);
                }}
                className="w-full py-3 rounded-2xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 text-xs font-mono font-bold flex items-center justify-center space-x-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Done & Refresh</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
