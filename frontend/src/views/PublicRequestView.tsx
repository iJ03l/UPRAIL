'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle,
  XCircle,
  Clock,
  WarningCircle,
  Warning,
  CircleNotch,
  Shield,
  Copy,
  Check,
  QrCode,
  ShareNetwork,
  ArrowsClockwise,
  Prohibit,
  User,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import { api, formatTokenAmount, formatUsd, tokenUsdPrice, cleanAssetSymbol } from '../lib/api';
import { useXAuth } from '../hooks/useXAuth';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { useOnchainData } from '../hooks/useOnchainData';
import { useToast } from '../components/Toast';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { ModalSheet } from '../components/ModalSheet';
import { Badge } from '../components/Badge';
import {
  fetchDepositAddress,
  fetchDepositStatus,
  type DepositStatusResponse,
  type DepositAddress,
  type OnchainToken,
} from '../lib/onchainApi';
import { Link } from '../lib/router';
import type { PaymentRequest, Token } from '../types';

interface PublicRequestViewProps {
  requestId?: string;
}

export const PublicRequestView: React.FC<PublicRequestViewProps> = ({ requestId: propId }) => {
  const { user } = useXAuth();
  const { authorizeWithPasskey } = usePasskeyTxAuth();
  const { balances, tokens, nearAccount, refreshBalances } = useOnchainData();
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
  const [depositChain, setDepositChain] = useState<string>('base');
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [depositAddressObj, setDepositAddressObj] = useState<DepositAddress | null>(null);
  const [isDerivingDeposit, setIsDerivingDeposit] = useState(false);
  const [depositStatus, setDepositStatus] = useState<DepositStatusResponse | null>(null);
  const [isCopiedDeposit, setIsCopiedDeposit] = useState(false);
  const [isCopiedShare, setIsCopiedShare] = useState(false);
  const [successPaymentId, setSuccessPaymentId] = useState<string | null>(null);

  // Extract ID from prop or window location if not passed
  useEffect(() => {
    if (!id && typeof window !== 'undefined') {
      const parts = window.location.pathname.split('/');
      const reqIdx = parts.indexOf('request');
      const pathId = reqIdx !== -1 && parts[reqIdx + 1] ? parts[reqIdx + 1].trim() : '';
      const queryId = new URLSearchParams(window.location.search).get('id')?.trim() || '';
      const resolvedId = pathId || queryId;
      if (resolvedId) {
        setId(resolvedId);
      } else {
        setError('No payment request ID was provided in this link.');
        setIsLoading(false);
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
  const targetToken: OnchainToken = tokens.find(
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
    chain: 'near',
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

  // Dynamically resolve all chains supporting this token from the live onchain token registry
  const availableChains = useMemo<string[]>(() => {
    const sym = targetToken.symbol.toUpperCase();
    const set = new Set<string>();
    tokens.forEach((t) => {
      if (
        (t.symbol.toUpperCase() === sym || t.id.toLowerCase() === targetToken.id.toLowerCase()) &&
        t.chain
      ) {
        set.add(t.chain.toLowerCase());
      }
    });
    if (targetToken.chain) set.add(targetToken.chain.toLowerCase());
    const list = Array.from(set);
    return list.length > 0 ? list : ['near'];
  }, [tokens, targetToken]);

  // Keep selected depositChain valid among available chains
  useEffect(() => {
    if (availableChains.length > 0 && !availableChains.includes(depositChain)) {
      setDepositChain(availableChains[0]);
    }
  }, [availableChains, depositChain]);

  // Load fresh deposit address for chosen chain, exact token, and amount
  const loadDeposit = useCallback(
    async (chainToUse?: string, refresh = true) => {
      const chain = chainToUse || depositChain;
      if (!request) return;
      try {
        setIsDerivingDeposit(true);
        setDepositStatus(null);
        const addr = await fetchDepositAddress(
          chain,
          refresh,
          targetToken.symbol,
          request.amount,
          targetToken.nearContractId
        );
        setDepositAddressObj(addr);
        setDepositAddress(addr?.address || null);
      } catch (err) {
        console.warn('Could not load deposit address:', err);
      } finally {
        setIsDerivingDeposit(false);
      }
    },
    [depositChain, request, targetToken.symbol, targetToken.nearContractId]
  );

  // Poll deposit status live while deposit modal is open
  useEffect(() => {
    if (!showDepositModal || !depositAddress) return;
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetchDepositStatus(depositAddress, {
          contract: targetToken.nearContractId,
          token: targetToken.symbol,
        });
        if (cancelled) return;
        setDepositStatus(res);
        if (res.isSettled || res.status === 'SUCCESS' || parseFloat(res.depositedAmountFormatted || '0') > 0) {
          toast(
            `Deposit Settled! Received ${res.depositedAmountFormatted || request?.amount} ${targetToken.symbol}. Vault funded.`,
            'success'
          );
          await refreshBalances();
          setTimeout(() => {
            if (!cancelled) setShowDepositModal(false);
          }, 1200);
        }
      } catch (err) {
        console.warn('[PublicRequestView] deposit poll error:', err);
      }
    };

    check();
    const interval = setInterval(check, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showDepositModal, depositAddress, targetToken.nearContractId, targetToken.symbol, refreshBalances, toast, request?.amount]);

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
          <XCircle weight="fill" className="w-7 h-7" />
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
            {isCopiedShare ? <Check weight="bold" className="w-3.5 h-3.5 text-emerald-500" /> : <ShareNetwork weight="fill" className="w-3.5 h-3.5" />}
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
              <Badge tone="warn" icon={<Clock weight="fill" className="w-3 h-3" />}>
                Pending
              </Badge>
            )}
            {isCompleted && (
              <Badge tone="ok" icon={<CheckCircle weight="fill" className="w-3 h-3" />}>
                Paid
              </Badge>
            )}
            {isDeclined && <Badge tone="neutral">Declined</Badge>}
            {isCancelled && <Badge tone="neutral">Cancelled</Badge>}
            {isExpired && <Badge tone="neutral">Expired</Badge>}
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
            <WarningCircle weight="fill" className="w-4 h-4 flex-shrink-0 mt-0.5" />
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
                        <ArrowUpRight weight="bold" className="w-4 h-4" />
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
                          <Prohibit weight="fill" className="w-3 h-3" />
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
                        <ArrowDownLeft weight="bold" className="w-4 h-4" />
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
      <ModalSheet
        isOpen={showDeclineModal}
        onClose={() => setShowDeclineModal(false)}
        canClose={!isProcessing}
        zIndexClass="z-50"
        maxWidthClass="sm:max-w-sm"
        panelClassName="p-6 pt-2 sm:p-6 space-y-4"
        showCloseButton
        closeLabel="Close decline request modal"
        ariaLabel="Decline Request"
      >
        <div className="pr-11">
          <h3 className="text-sm font-bold font-display uppercase tracking-wider text-stone-900 dark:text-white">
            Decline Request
          </h3>
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
          className="w-full p-3 rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-base sm:text-xs text-stone-900 dark:text-white font-sans outline-hidden"
        />
        <div className="flex space-x-2 pt-1">
          <button
            type="button"
            onClick={() => setShowDeclineModal(false)}
            className="w-1/2 py-2.5 min-h-11 rounded-xl border border-stone-200 dark:border-stone-700 text-xs font-mono font-bold text-stone-700 dark:text-stone-300 cursor-pointer"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleDecline}
            disabled={isProcessing}
            className="w-1/2 py-2.5 min-h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-mono font-bold disabled:opacity-50 cursor-pointer"
          >
            {isProcessing ? 'Declining...' : 'Confirm Decline'}
          </button>
        </div>
      </ModalSheet>

      {/* Dynamic Multi-Chain Deposit Modal */}
      <ModalSheet
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        zIndexClass="z-50"
        maxWidthClass="sm:max-w-sm"
        panelClassName="p-6 pt-2 sm:p-6 space-y-4"
        showCloseButton
        closeLabel="Close deposit modal"
        ariaLabel="Deposit to Your Vault"
      >
        <div className="pr-11">
          <h3 className="text-sm font-bold font-display uppercase tracking-wider text-stone-900 dark:text-white">
            Deposit to Your Vault
          </h3>
        </div>

        {/* Dynamic Network Selector */}
        {availableChains.length > 1 && (
          <div className="space-y-1.5 text-left">
            <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500 font-bold block">
              Select Source Network
            </span>
            <div className="flex flex-wrap gap-1.5">
              {availableChains.map((chain) => (
                <button
                  key={chain}
                  type="button"
                  onClick={() => {
                    setDepositChain(chain);
                    loadDeposit(chain, true);
                  }}
                  className={`px-2.5 py-2 min-h-10 rounded-xl text-xs font-mono font-bold uppercase transition-all cursor-pointer ${
                    depositChain === chain
                      ? 'bg-black text-white dark:bg-white dark:text-black shadow-xs'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:text-black dark:hover:text-white'
                  }`}
                >
                  {chain}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dynamic Instructions */}
        <div className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-left space-y-1">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-bold text-stone-900 dark:text-white">
              Send {targetToken.symbol} on {depositChain.toUpperCase()}
            </span>
            <span className="text-[11px] text-stone-500 font-bold uppercase">
              {depositAddressObj?.isOneTime ? 'Single-Use' : 'Direct'}
            </span>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 font-sans leading-relaxed">
            Send exactly {cleanAmountFormatted} on {depositChain.toUpperCase()}. Solvers route and credit it directly to your UPRAIL vault.
          </p>
        </div>

        {/* QR Code and Address */}
        {isDerivingDeposit ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-2 text-stone-500 text-xs font-mono">
            <CircleNotch weight="bold" className="w-6 h-6 animate-spin text-stone-900 dark:text-white" />
            <span>Generating {targetToken.symbol} deposit address on {depositChain.toUpperCase()}...</span>
          </div>
        ) : depositAddress ? (
          <>
            <div className="flex justify-center p-3 bg-white rounded-2xl border border-stone-200">
              <QRCodeDisplay value={depositAddress} size={150} />
            </div>

            <div className="p-3 rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 flex items-center justify-between text-xs font-mono">
              <span className="truncate max-w-[220px] text-stone-900 dark:text-white font-medium select-all">
                {depositAddress}
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(depositAddress);
                  setIsCopiedDeposit(true);
                  setTimeout(() => setIsCopiedDeposit(false), 2000);
                }}
                className="p-2 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-600 dark:text-stone-300 cursor-pointer"
                aria-label="Copy deposit address"
              >
                {isCopiedDeposit ? <Check weight="bold" className="w-4 h-4 text-emerald-500" /> : <Copy weight="fill" className="w-4 h-4" />}
              </button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-xs text-stone-500 font-mono">
            Could not load deposit address for {depositChain.toUpperCase()}.
          </div>
        )}

        {/* Real-time Deposit Status */}
        {depositStatus?.isSettled || depositStatus?.status === 'SUCCESS' ? (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center space-x-2 text-xs font-mono text-emerald-800 dark:text-emerald-300">
            <CheckCircle weight="fill" className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>Deposit confirmed &amp; settled! Completing payment...</span>
          </div>
        ) : depositStatus?.status === 'PROCESSING' || parseFloat(depositStatus?.depositedAmountFormatted || '0') > 0 ? (
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex items-center space-x-2 text-xs font-mono text-blue-800 dark:text-blue-300">
            <CircleNotch weight="bold" className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
            <span>Deposit detected onchain! Routing via Intents...</span>
          </div>
        ) : (
          <div className="p-2.5 rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 flex items-center space-x-2 text-[11px] font-mono text-stone-500">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping flex-shrink-0" />
            <span>Standby: Waiting for incoming {targetToken.symbol} on {depositChain.toUpperCase()}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex space-x-2 pt-1">
          <button
            type="button"
            onClick={() => loadDeposit(depositChain, true)}
            disabled={isDerivingDeposit}
            className="w-1/2 py-2.5 min-h-11 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 text-xs font-mono font-bold hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center justify-center space-x-1 disabled:opacity-50 cursor-pointer"
          >
            <ArrowsClockwise weight="bold" className={`w-3.5 h-3.5 ${isDerivingDeposit ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await refreshBalances();
              setShowDepositModal(false);
            }}
            className="w-1/2 py-2.5 min-h-11 rounded-xl bg-stone-900 hover:bg-black dark:bg-white dark:hover:bg-stone-100 text-white dark:text-stone-900 text-xs font-mono font-bold flex items-center justify-center space-x-1 cursor-pointer"
          >
            <span>Done</span>
          </button>
        </div>
      </ModalSheet>
    </div>
  );
};
