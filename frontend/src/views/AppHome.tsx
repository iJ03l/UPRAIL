'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from '../lib/router';
import { PeopleYouPay } from '../components/PeopleYouPay';
import {
  ArrowDownLeft,
  ArrowsLeftRight,
  ArrowUpRight,
  Fingerprint,
  Eye,
  EyeSlash,
  Copy,
  Check,
  Shield,
  ArrowsClockwise,
  ArrowRight,
  WarningCircle,
  ArrowSquareOut,
  Clock,
  Record as RecordIcon,
  PaperPlaneTilt,
  ArrowFatDown,
  ArrowFatUp,
  CurrencyCircleDollar,
  Leaf,
  ShieldCheck,
  X,
} from '@phosphor-icons/react';
import { getTransactionBalanceEffect, formatBalanceAmount, BalanceEffect } from '../lib/transactions';
import { usePayments } from '../hooks/usePayments';
import { useXAuth } from '../hooks/useXAuth';
import { useOnchainData, balanceUsd } from '../hooks/useOnchainData';
import {
  api,
  cleanMemeSymbol,
  formatCompactAmount,
  formatTokenAmount,
  formatRecipientDisplay,
  formatUsd,
  formatUsdCompact,
  sumUsd,
} from '../lib/api';
import type { CoffeeSettingsResponse, PaymentIntent, PaymentRequest, Token } from '../types';
import { FlowPulseWidget } from '../components/FlowPulseWidget';
import { NearcomWithdrawModal } from '../components/NearcomWithdrawModal';
import { StabilizeModal } from '../components/StabilizeModal';
import { CoffeeModal, CoinPouchIcon } from '../components/CoffeeModal';
import { SelfCustodyUpgradeModal } from '../components/SelfCustodyUpgradeModal';
import { RollingNumber } from '../components/RollingNumber';
import { Skeleton } from '../components/Skeleton';
import { Badge } from '../components/Badge';
import { useToast } from '../components/Toast';
import { activityStatusMeta, cancellationReason } from '../lib/statusLabels';

const SC_BANNER_DISMISS_KEY = 'uprail_self_custody_banner_dismissed';

export const AppHome: React.FC = () => {
  const navigate = useNavigate();
  const { user, refreshSession } = useXAuth();
  const { toast } = useToast();
  const {
    tokens: paymentTokens,
    history,
    loadHistory,
    isLoadingHistory,
  } = usePayments();

  const {
    balances,
    tokens,
    totalBalanceUsd,
    unpricedBalanceCount,
    hasIntentAccount,
    isLoadingBalances,
    accountError,
    balancesError,
    transactions,
    isLoadingHistory: isLoadingOnchainHistory,
    refreshHistory,
    refresh,
    refreshBalances,
    error: onchainError,
  } = useOnchainData();

  const [hideBalance, setHideBalance] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState<boolean>(false);
  const [isStabilizeModalOpen, setIsStabilizeModalOpen] = useState<boolean>(false);
  const [stabilizeInitialToken, setStabilizeInitialToken] = useState<Token | null>(null);
  const [isCoffeeModalOpen, setIsCoffeeModalOpen] = useState<boolean>(false);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState<boolean>(false);
  const [scBannerDismissed, setScBannerDismissed] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(SC_BANNER_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const handleManualRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        refresh(),
        refreshBalances(),
        refreshHistory(),
        loadHistory(),
        api.getPendingPayments().then((p) => setPendingPayments(p || [])),
        api.getIncomingRequests().then((r) => setIncomingRequests(r || [])),
      ]);
    } catch (err) {
      console.warn('Manual refresh notice:', err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // First visit has nothing cached: show skeletons. A cached refresh keeps the
  // last numbers on screen and only swaps them when the fresh data lands.
  const isFirstLoad = isLoadingBalances && totalBalanceUsd === null && balances.length === 0;
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);
  const [pendingPayments, setPendingPayments] = useState<PaymentIntent[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<PaymentRequest[]>([]);

  useEffect(() => {
    api.getIncomingRequests().then((r) => setIncomingRequests(r || [])).catch(() => {});
  }, []);

  // Completed Buy Me a Coffee tips (public pay link) settle escrow → vault and
  // are not rows in `payments`, so fetch them separately for the activity feed.
  const [coffeeDonations, setCoffeeDonations] = useState<CoffeeSettingsResponse['recentDonations']>([]);
  useEffect(() => {
    api
      .getCoffeeSettings()
      .then((s) => setCoffeeDonations(s?.recentDonations || []))
      .catch(() => {});
  }, []);

  // Received-payment notifications. Direct sends land straight in the vault
  // (no claim step), so the recipient is told here instead. Scoped per user handle
  // and synchronized on mount so dismissed receipts stay permanently dismissed.
  const RECEIPTS_SEEN_KEY = user?.handle
    ? `uprail_seen_receipts_${user.handle.toLowerCase().replace(/^@+/, '')}`
    : 'uprail_seen_receipts';
  const [seenReceiptIds, setSeenReceiptIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECEIPTS_SEEN_KEY);
      if (raw) {
        setSeenReceiptIds(JSON.parse(raw));
      }
    } catch {}
  }, [RECEIPTS_SEEN_KEY]);

  const receivedReceipts = useMemo(() => {
    if (!user?.handle) return [];
    const h = user.handle.toLowerCase();
    return history
      .filter((p) => p.recipientHandle?.replace(/^@/, '').toLowerCase() === h)
      .filter((p) => p.isDirect || p.status === 'claimed')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [history, user?.handle]);

  const unseenReceipts = receivedReceipts.filter((p) => p.id && !seenReceiptIds.includes(p.id));

  const dismissReceipts = () => {
    try {
      let currentStored: string[] = [];
      const raw = window.localStorage.getItem(RECEIPTS_SEEN_KEY);
      if (raw) currentStored = JSON.parse(raw);
      const ids = Array.from(new Set([...currentStored, ...seenReceiptIds, ...receivedReceipts.map((p) => p.id)]));
      setSeenReceiptIds(ids);
      window.localStorage.setItem(RECEIPTS_SEEN_KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  };

  const pendingIncomingRequests = useMemo(() => {
    return incomingRequests.filter((r) => r.status === 'PENDING');
  }, [incomingRequests]);
  // One automatic provisioning retry: a fresh signup can land here before the
  // background account creation settles. Manual retry stays on the button.
  const autoRetried = React.useRef(false);
  useEffect(() => {
    if (
      !autoRetried.current &&
      !isLoadingBalances &&
      !hasIntentAccount &&
      user?.hasPasskey === true
    ) {
      autoRetried.current = true;
      const id = window.setTimeout(() => void refreshBalances(), 8000);
      return () => window.clearTimeout(id);
    }
  }, [isLoadingBalances, hasIntentAccount, user, refreshBalances]);

  const [requests, setRequests] = useState<PaymentRequest[]>([]);

  const loadRequests = useCallback(async () => {
    try {
      const [inc, out] = await Promise.all([
        api.getIncomingRequests(),
        api.getOutgoingRequests(),
      ]);
      const combined = [...(inc || []), ...(out || [])];
      const seen = new Set<string>();
      setRequests(
        combined.filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        })
      );
    } catch {}
  }, []);

  // Load payment history, requests, and pending claims on mount
  useEffect(() => {
    loadHistory();
    loadRequests();
    api.getPendingPayments().then((p) => setPendingPayments(p || []));
  }, [loadHistory, loadRequests]);

  const handleCopyTxLink = (claimLink: string, id: string) => {
    navigator.clipboard.writeText(claimLink);
    setCopiedTxId(id);
    toast('Copied to clipboard');
    setTimeout(() => setCopiedTxId(null), 2000);
  };

  const recentActivity = useMemo(() => {
    type UnifiedActivity = {
      id: string;
      type: 'payment' | 'deposit' | 'withdrawal' | 'request';
      isSent: boolean;
      title: string;
      subtitle: string;
      reason?: string | null;
      amount: string;
      symbol: string;
      status: string;
      timestamp: number;
      balanceEffect: BalanceEffect;
      copyValue?: string;
      copyTitle?: string;
      explorerUrl?: string;
    };

    const list: UnifiedActivity[] = [];

    for (const p of history) {
      const isSent = Boolean(
        user?.handle && p.senderHandle && p.senderHandle.toLowerCase() === user.handle.toLowerCase()
      );
      const balanceEffect = getTransactionBalanceEffect({
        type: 'payment',
        isSent,
        status: p.status,
      });
      list.push({
        id: p.id,
        type: 'payment',
        isSent,
        title: isSent ? formatRecipientDisplay(p.recipientHandle) : `@${p.senderHandle}`,
        subtitle: p.memo || new Date(p.createdAt).toLocaleDateString(),
        reason:
          p.status === 'cancelled'
            ? cancellationReason(p.cancelReason, p.cancelCode)
            : null,
        amount: formatTokenAmount(p.amount),
        symbol: p.token.symbol,
        status: p.status,
        timestamp: new Date(p.createdAt).getTime(),
        balanceEffect,
        copyValue: p.status === 'claimed' ? undefined : (p.claimLink || undefined),
        copyTitle: 'Copy payment link',
      });
    }

    for (const tx of transactions) {
      const isDeposit = tx.intent_type === 'deposit';
      const isWithdrawal = tx.intent_type === 'withdrawal';
      const txType = isDeposit ? 'deposit' : isWithdrawal ? 'withdrawal' : 'payment';
      const balanceEffect = getTransactionBalanceEffect({
        type: txType,
        isSent: !isDeposit,
        status: tx.status,
      });
      // An outgoing transfer carries its asset in `defuse_asset_id_out`; only
      // deposits populate `_in`. Reading `_in` alone left every send unlabelled
      // and falling through to the NEAR default.
      const txAssetId = tx.defuse_asset_id_in || tx.defuse_asset_id_out || '';
      const txAssetLower = txAssetId.toLowerCase();
      const assetToken = tokens.find(
        (t) =>
          t.id.toLowerCase() === txAssetLower ||
          // Suffix, not substring: "wrap.near" is a substring of other account
          // ids, so `includes` could pick the wrong token.
          (!!t.nearContractId &&
            txAssetLower.endsWith(`:${t.nearContractId.toLowerCase()}`))
      );
      const balanceToken = balances.find(
        (b) =>
          b.defuse_asset_id?.toLowerCase() === txAssetLower ||
          (b.nearContractId &&
            txAssetLower.endsWith(`:${b.nearContractId.toLowerCase()}`))
      );
      const rawAssetId = txAssetLower;
      const symbol =
        (tx.symbol ? cleanMemeSymbol(tx.symbol) : '') ||
        (assetToken?.symbol ? cleanMemeSymbol(assetToken.symbol) : '') ||
        (balanceToken?.symbol ? cleanMemeSymbol(balanceToken.symbol) : '') ||
        (rawAssetId.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')
          ? 'USDC'
          : rawAssetId.includes('wrap.near')
          ? 'NEAR'
          : rawAssetId.includes('usdc')
          ? 'USDC'
          : cleanMemeSymbol(rawAssetId) || '—');
      const amt = tx.amount_in || tx.amount_out || '0';

      const shortId = tx.id ? `${tx.id.slice(0, 6)}...${tx.id.slice(-4)}` : '';
      const isStabilize = Boolean(tx.receiver_id && tx.receiver_id.startsWith('stabilize:'));
      const stabilizeParts = isStabilize && tx.receiver_id ? tx.receiver_id.split(':') : [];
      const stabilizeTarget = stabilizeParts[1] || 'USDC';
      const stabilizeOutAmt = stabilizeParts[2] || '';
      const explorerUrl =
        !isWithdrawal && !isStabilize && tx.id && !tx.id.startsWith('0x') && tx.id.length > 20
          ? `https://nearblocks.io/txns/${tx.id}`
          : undefined;

      list.push({
        id: tx.id,
        type: txType,
        isSent: !isDeposit && !isStabilize,
        title: isStabilize
          ? `Stabilized to ${stabilizeTarget}${stabilizeOutAmt ? ` (+${stabilizeOutAmt})` : ''}`
          : isDeposit
          ? 'Deposit to Vault'
          : isWithdrawal
          ? `Withdraw to ${tx.receiver_id ? `${tx.receiver_id.slice(0, 6)}...` : 'wallet'}`
          : 'Intent Transfer',
        subtitle: `${new Date(tx.block_timestamp).toLocaleDateString()} • Tx: ${shortId}`,
        amount: amt,
        symbol,
        status: tx.status,
        timestamp: Number(tx.block_timestamp) || 0,
        balanceEffect: isStabilize ? 'none' : balanceEffect,
        copyValue: tx.id,
        copyTitle: 'Copy tx hash',
        explorerUrl,
      });
    }

    for (const req of requests) {
      const isSent = Boolean(
        user?.handle && req.requester_handle && req.requester_handle.toLowerCase() === user.handle.toLowerCase()
      );
      const balanceEffect = getTransactionBalanceEffect({
        type: 'request',
        isRequest: true,
        isSent,
        status: req.status,
      });
      const targetToken = tokens.find(
        (t) => t.id.toLowerCase() === req.asset.toLowerCase() || t.symbol.toLowerCase() === req.asset.toLowerCase()
      );
      const sym = targetToken?.symbol || req.asset.split('.').pop()?.toUpperCase() || 'USDC';
      const cleanSym = cleanMemeSymbol(sym) || 'USDC';
      const reqUrl = typeof window !== 'undefined' ? `${window.location.origin}/request/${req.id}` : `/request/${req.id}`;

      list.push({
        id: req.id,
        type: 'request',
        isSent,
        title: isSent ? `Request to @${req.requested_handle}` : `Request from @${req.requester_handle}`,
        subtitle: req.memo || (isSent ? 'Sent payment request' : 'Received payment request'),
        reason: req.decline_reason ? `Declined: ${req.decline_reason}` : null,
        amount: formatTokenAmount(req.amount),
        symbol: cleanSym,
        status: req.status.toLowerCase(),
        timestamp: req.created_at,
        balanceEffect,
        copyValue: reqUrl,
        copyTitle: 'Copy request link',
      });
    }

    // Buy Me a Coffee tips received via the public pay link
    const coffeeTxHashes = new Set<string>();
    for (const d of coffeeDonations) {
      if (d.payoutTxHash) coffeeTxHashes.add(d.payoutTxHash);
      list.push({
        id: d.id,
        type: 'deposit',
        isSent: false,
        title: 'Buy Me a Coffee tip',
        subtitle: `${new Date(d.createdAt).toLocaleDateString()} • Paid in ${d.originSymbol}`,
        amount: formatTokenAmount(d.netAmount || d.grossAmount),
        symbol: d.targetSymbol,
        status: 'completed',
        timestamp: d.createdAt,
        balanceEffect: getTransactionBalanceEffect({ type: 'deposit', isSent: false, status: 'completed' }),
        copyValue: d.payoutTxHash || undefined,
        copyTitle: 'Copy tx hash',
      });
    }

    const coffeeIds = new Set(coffeeDonations.map((d) => d.id));
    const deduped = coffeeTxHashes.size
      ? list.filter((item) => coffeeIds.has(item.id) || !coffeeTxHashes.has(item.id))
      : list;

    deduped.sort((a, b) => b.timestamp - a.timestamp);
    return deduped;
  }, [history, requests, transactions, user?.handle, tokens, balances, coffeeDonations]);

  return (
    <div className="w-full space-y-5">
      {user && user.custodyMode !== 'self' && !scBannerDismissed && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <ShieldCheck weight="fill" className="w-4 h-4 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-display font-bold text-stone-900">
                Passkey Self-Custody is available
              </div>
              <p className="text-[11px] text-stone-600 leading-snug">
                Remove server signing from your on-chain Intents account and authorize every move directly from your device passkey.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsUpgradeModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-black hover:bg-stone-800 text-white text-xs font-display font-bold transition-colors cursor-pointer"
            >
              Upgrade Now
            </button>
            <button
              type="button"
              onClick={() => {
                setScBannerDismissed(true);
                try {
                  window.localStorage.setItem(SC_BANNER_DISMISS_KEY, '1');
                } catch {}
              }}
              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 transition-colors cursor-pointer"
              aria-label="Dismiss Self-Custody banner"
              title="Dismiss"
            >
              <X weight="bold" className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">

        {/* ── LEFT COLUMN: Balance, Quick Actions, Receive via Intents ── */}
        <div className="lg:col-span-7 space-y-6">

          {/* Balance Hero Card — live from onchain intent account */}
          <div className="rounded-3xl p-5 sm:p-8 md:p-10 bg-white border border-stone-200 shadow-xs space-y-5 sm:space-y-6 relative">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="text-xs font-mono uppercase tracking-wider text-stone-500 font-bold flex items-center space-x-1.5 min-w-0">
                  <Shield weight="fill" className="w-3.5 h-3.5 text-stone-900 flex-shrink-0" />
                  <span className="truncate">UPRAIL Account</span>
                </span>
              </div>
              <div className="flex items-center space-x-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing || isLoadingBalances}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer"
                  title="Refresh live balance & activity"
                >
                  <ArrowsClockwise weight="bold" className={`w-3.5 h-3.5 ${(isRefreshing || isLoadingBalances) ? 'animate-spin text-stone-900' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setHideBalance(!hideBalance)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer"
                  title={hideBalance ? 'Show balance' : 'Hide balance'}
                >
                  {hideBalance ? <EyeSlash weight="fill" className="w-4 h-4" /> : <Eye weight="fill" className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Big Balance Number + Stabilize Button on opposite side */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                {isFirstLoad ? (
                  <div className="py-3 space-y-3" aria-hidden="true">
                    <Skeleton className="h-11 w-56 sm:w-72" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                ) : (
                  <div className="text-3xl sm:text-5xl font-display font-extrabold text-stone-950 tracking-tight tabular-nums break-all min-w-0">
                    <RollingNumber
                      value={hideBalance ? null : totalBalanceUsd}
                      format={formatUsdCompact}
                      fallback={hideBalance ? '••••••••' : '—'}
                    />
                  </div>
                )}

                <div className="flex flex-col items-stretch sm:items-end gap-1.5 flex-shrink-0">
                  <Link
                    to="/app/circles"
                    title="Circles & Timelocked Earn Vault Gifting"
                    className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-2xl border border-stone-200 bg-white hover:bg-stone-50 hover:border-stone-300 text-stone-900 text-xs font-display font-bold tracking-wide shadow-2xs transition-all group cursor-pointer"
                  >
                    <Leaf weight="fill" className="w-3.5 h-3.5 text-[#00D68F] dark:text-[#00EC97] drop-shadow-[0_0_5px_rgba(0,236,151,0.45)] transition-transform group-hover:scale-110 group-hover:-rotate-6" />
                    <span>Circles</span>
                    <ArrowUpRight weight="bold" className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-900 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                  </Link>

                  {(() => {
                    const hasEligibleStabilize = balances.some((b) => {
                      const symUpper = (b.symbol || '').toUpperCase();
                      const is1Click =
                        b.supportsOneClick ??
                        (symUpper === 'NEAR' || symUpper === 'WNEAR' || !b.isPlainOnly);
                      if (!is1Click || symUpper === 'USDC' || symUpper === 'USDT') return false;
                      const amt = parseFloat(b.amountFormatted || '0') || 0;
                      if (amt <= 0) return false;
                      if ((symUpper === 'NEAR' || symUpper === 'WNEAR') && amt < 0.05) return false;
                      const usd = balanceUsd(b, tokens);
                      if (usd !== null && usd < 1) return false;
                      return true;
                    });
                    const stabilizeDisabled = !isFirstLoad && balances.length > 0 && !hasEligibleStabilize;
                    return (
                      <button
                        type="button"
                        disabled={stabilizeDisabled}
                        onClick={() => {
                          if (stabilizeDisabled) return;
                          setStabilizeInitialToken(null);
                          setIsStabilizeModalOpen(true);
                        }}
                        title={
                          stabilizeDisabled
                            ? 'Hold at least $1.00 USD in a non-stable token to stabilize'
                            : 'Convert held crypto to USDC or USDT'
                        }
                        className={`relative overflow-hidden inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl border text-xs font-display font-extrabold uppercase tracking-wider shadow-xs transition-all group ${
                          stabilizeDisabled
                            ? 'bg-stone-200 border-stone-300 text-stone-500 cursor-not-allowed opacity-70'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700/80 hover:shadow-sm cursor-pointer'
                        }`}
                      >
                        {!stabilizeDisabled && (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none select-none absolute inset-0 overflow-hidden font-mono text-[6.5px] leading-[7.5px] tracking-[0.12em] text-white/20 group-hover:text-white/25 whitespace-pre flex flex-col justify-between py-0.5 transition-colors"
                          >
                            <span>░▒▓█╬═══╬█▓▒░▒▓█╬═══╬█▓▒░</span>
                            <span>▒░╬─┼─USDC/USDT─┼─╬░▒▓█╬░</span>
                            <span>▓█╬═══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓</span>
                            <span>░▒▓█╬─┼─1CLICK─┼─╬█▓▒░▒▓█</span>
                          </span>
                        )}
                        <ArrowsLeftRight weight="bold"
                          className={`relative z-10 w-3.5 h-3.5 transition-colors drop-shadow-xs ${
                            stabilizeDisabled ? 'text-stone-400' : 'text-emerald-100 group-hover:text-white'
                          }`}
                        />
                        <span className="relative z-10 drop-shadow-xs">Stabilize</span>
                      </button>
                    );
                  })()}

                  <button
                    type="button"
                    onClick={() => setIsCoffeeModalOpen(true)}
                    title="Buy Me a Coffee — Public pay link"
                    aria-label="Buy Me a Coffee"
                    className="inline-flex items-center justify-center p-1 bg-transparent border-0 shadow-none hover:scale-110 active:scale-95 transition-transform cursor-pointer focus:outline-none"
                  >
                    <CoinPouchIcon className="w-8 h-8 drop-shadow-xs" />
                  </button>
                </div>
              </div>
              {/* The headline is a priced subtotal whenever any holding is
                  priced — a dash is useless. Say how much is missing so the
                  figure is read as a floor, never as the full portfolio. */}
              {!isFirstLoad && !hideBalance && unpricedBalanceCount > 0 && totalBalanceUsd !== null && (
                <div className="text-[11px] font-mono text-amber-600">
                  +{unpricedBalanceCount} holding{unpricedBalanceCount === 1 ? '' : 's'} without a
                  live price
                </div>
              )}
              <div className="flex items-center space-x-2 text-[11px] sm:text-xs font-mono text-stone-500">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasIntentAccount ? 'bg-stone-900' : 'bg-amber-500 animate-pulse'}`} />
                {hasIntentAccount ? (
                  <span>Live · Private · Protected by your passkey</span>
                ) : user?.hasPasskey === true ? (
                  <span className="flex items-center gap-2">
                    <span>Setting up your UPRAIL account…</span>
                    <button
                      type="button"
                      onClick={() => void refreshBalances()}
                      disabled={isLoadingBalances}
                      className="underline underline-offset-2 hover:text-stone-900 disabled:opacity-50 cursor-pointer"
                    >
                      Retry
                    </button>
                  </span>
                ) : (
                  <span>No account yet — set up a passkey to create yours</span>
                )}
              </div>
              {!hasIntentAccount && user?.hasPasskey === true && accountError && !isLoadingBalances ? (
                <p className="text-[11px] font-mono text-stone-400">
                  Provisioning note: {accountError}
                </p>
              ) : null}
            </div>

            {/* Live asset breakdown from onchain */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-100">
              {balances.length > 0 ? (
                balances.map((b) => {
                  const rawUsd = balanceUsd(b, tokens);
                  const usd = hideBalance ? null : rawUsd;
                  const symUpper = (b.symbol || '').toUpperCase();
                  const is1Click =
                    b.supportsOneClick ?? (symUpper === 'NEAR' || symUpper === 'WNEAR' || !b.isPlainOnly);
                  const numAmt = parseFloat(b.amountFormatted || '0') || 0;
                  const isNearAsset = symUpper === 'NEAR' || symUpper === 'WNEAR';
                  const meetsMinAmount =
                    numAmt > 0 &&
                    (!isNearAsset || numAmt >= 0.05) &&
                    (rawUsd === null || rawUsd >= 1);
                  const canStabilize =
                    is1Click &&
                    symUpper !== 'USDC' &&
                    symUpper !== 'USDT' &&
                    meetsMinAmount;
                  return (
                    <button
                      key={b.defuse_asset_id}
                      type="button"
                      disabled={!canStabilize}
                      onClick={() => {
                        if (!canStabilize) return;
                        const matched = paymentTokens.find(
                          (t) =>
                            t.id.toLowerCase() === b.defuse_asset_id.toLowerCase() ||
                            t.symbol.toUpperCase() === symUpper
                        );
                        setStabilizeInitialToken({
                          id: b.defuse_asset_id,
                          symbol: b.symbol,
                          name: matched?.name || b.symbol,
                          iconUrl: b.icon || matched?.iconUrl || '',
                          decimals: b.decimals,
                          nearContractId: b.nearContractId || matched?.nearContractId || '',
                          priceUsd: b.priceUsd ?? matched?.priceUsd,
                          balance: b.amountFormatted,
                        });
                        setIsStabilizeModalOpen(true);
                      }}
                      className={`px-2.5 py-1 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono font-medium text-stone-700 transition-all ${
                        canStabilize
                          ? 'hover:border-stone-900 hover:bg-stone-100 cursor-pointer'
                          : 'cursor-default'
                      }`}
                      title={
                        canStabilize
                          ? `Tap to stabilize ${b.symbol} to USDC or USDT`
                          : is1Click && symUpper !== 'USDC' && symUpper !== 'USDT' && numAmt > 0
                          ? `Minimum $1.00 USD required to stabilize ${b.symbol}`
                          : b.defuse_asset_id
                      }
                    >
                      {hideBalance ? `•••• ${b.symbol}` : `${formatCompactAmount(b.amountFormatted)} ${b.symbol}`}
                      {usd !== null && usd > 0 ? (
                        <span className="text-stone-400"> · {formatUsdCompact(usd)}</span>
                      ) : null}
                    </button>
                  );
                })
              ) : isFirstLoad ? (
                <div className="flex flex-wrap gap-2 pt-0.5" aria-hidden="true">
                  <Skeleton variant="chip" className="w-24" />
                  <Skeleton variant="chip" className="w-20" />
                  <Skeleton variant="chip" className="w-16" />
                </div>
              ) : balancesError || onchainError ? (
                <span className="text-xs font-mono text-red-500 flex items-center space-x-1">
                  <WarningCircle weight="fill" className="w-3 h-3" />
                  <span>{balancesError || onchainError}</span>
                  <button
                    type="button"
                    onClick={() => void refreshBalances()}
                    className="underline underline-offset-2 hover:text-red-700 cursor-pointer"
                  >
                    Retry
                  </button>
                </span>
              ) : (
                <span className="text-xs font-mono text-stone-400 py-0.5">
                  {isLoadingBalances ? 'Fetching onchain balances...' : 'No balances yet in your intent account'}
                </span>
              )}
            </div>
          </div>

          {/* Incoming Payment Requests Banner */}
          {pendingIncomingRequests.length > 0 && (
            <Link
              to={`/request/${pendingIncomingRequests[0].id}`}
              className="p-4 rounded-3xl bg-orange-600 text-white shadow-md flex items-center justify-between gap-3 hover:bg-orange-700 transition-all group cursor-pointer animate-fade-in"
            >
              <div className="flex items-center space-x-3 sm:space-x-3.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-white text-orange-600 flex items-center justify-center font-bold flex-shrink-0">
                  <ArrowDownLeft weight="bold" className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold font-display flex items-center space-x-2">
                    <span className="truncate">
                      {pendingIncomingRequests.length === 1
                        ? `@${pendingIncomingRequests[0].requester_handle} requested ${pendingIncomingRequests[0].amount_formatted}`
                        : `${pendingIncomingRequests.length} payment requests waiting`}
                    </span>
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse flex-shrink-0" />
                  </div>
                  <div className="text-[11px] text-orange-100 font-mono mt-0.5 truncate">
                    Tap to review and accept or decline
                  </div>
                </div>
              </div>
              <ArrowRight weight="bold" className="w-4 h-4 text-orange-200 group-hover:text-white group-hover:translate-x-1 transition-all flex-shrink-0" />
            </Link>
          )}

          {/* Incoming Claim Notification Banner (Auto-discovered payments waiting!) */}
          {pendingPayments.length > 0 && (
            <Link
              to="/app/claim"
              className="p-4 rounded-3xl bg-stone-900 text-white border border-stone-800 shadow-md flex items-center justify-between gap-3 hover:bg-black transition-all group cursor-pointer animate-fade-in"
            >
              <div className="flex items-center space-x-3 sm:space-x-3.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-white text-stone-900 flex items-center justify-center font-bold flex-shrink-0">
                  <Fingerprint weight="bold" className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold font-display flex items-center space-x-2">
                    <span className="truncate">{pendingPayments.length} payment{pendingPayments.length > 1 ? 's' : ''} waiting</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                  </div>
                  <div className="text-[11px] text-stone-300 font-mono mt-0.5 truncate">
                    ≈ {formatUsd(sumUsd(pendingPayments.map((p) => p.amountUsd)))} USD · Tap to receive
                  </div>
                </div>
              </div>
              <ArrowRight weight="bold" className="w-4 h-4 text-stone-400 group-hover:text-white group-hover:translate-x-1 transition-all flex-shrink-0" />
            </Link>
          )}

          {/* Received Payment Notice (direct sends land in the vault; tell the recipient) */}
          {unseenReceipts.length > 0 && (
            <div className="p-4 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 shadow-xs flex items-center justify-between gap-3 animate-fade-in">
              <Link
                to="/app/history"
                onClick={dismissReceipts}
                className="flex items-center space-x-3.5 min-w-0 group"
              >
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-600 flex items-center justify-center font-bold flex-shrink-0">
                  <ArrowDownLeft weight="bold" className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold font-display text-stone-950 truncate">
                    {unseenReceipts.length === 1
                      ? `You received ${formatTokenAmount(unseenReceipts[0].amount)} ${unseenReceipts[0].token.symbol} from @${unseenReceipts[0].senderHandle || 'someone'}`
                      : `You received ${unseenReceipts.length} payments`}
                  </div>
                  <div className="text-[11px] text-stone-600 font-mono truncate">
                    Delivered privately to your vault · Tap to view history
                  </div>
                </div>
              </Link>
              <button
                type="button"
                onClick={dismissReceipts}
                className="flex-shrink-0 text-[11px] font-mono font-bold text-stone-600 hover:text-stone-900 px-2.5 py-1.5 rounded-lg hover:bg-emerald-500/10 transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Quick Action Buttons */}
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2.5">
            <Link
              to="/app/send"
              className="min-w-0 py-2.5 sm:py-4 px-1.5 sm:px-3 rounded-xl sm:rounded-2xl border border-stone-200 bg-white hover:border-black dark:hover:!border-orange-500 text-center transition-all duration-150 flex flex-col items-center justify-center space-y-1 sm:space-y-1.5 shadow-xs hover:shadow-sm group cursor-pointer"
            >
              <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 dark:group-hover:!bg-orange-500 dark:group-hover:!text-white flex items-center justify-center group-hover:scale-105 transition-all shadow-2xs">
                <PaperPlaneTilt weight="fill" className="w-4 h-4 sm:w-[22px] sm:h-[22px]" />
              </div>
              <span className="text-[10px] sm:text-xs font-display font-bold uppercase tracking-wider leading-tight text-stone-900 group-hover:text-black dark:group-hover:!text-orange-500 transition-colors truncate max-w-full">
                Send
              </span>
              <span className="text-[8.5px] sm:text-[10px] font-mono leading-tight text-stone-500 dark:group-hover:!text-orange-400/90 transition-colors truncate max-w-full">
                𝕏 &amp; Wallets
              </span>
            </Link>

            <Link
              to="/app/request"
              className="min-w-0 py-2.5 sm:py-4 px-1.5 sm:px-3 rounded-xl sm:rounded-2xl border border-stone-200 bg-white hover:border-black dark:hover:!border-orange-500 text-center transition-all duration-150 flex flex-col items-center justify-center space-y-1 sm:space-y-1.5 shadow-xs hover:shadow-sm group cursor-pointer relative"
            >
              {pendingIncomingRequests.length > 0 && (
                <Badge tone="warn" className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2">
                  {pendingIncomingRequests.length}
                </Badge>
              )}
              <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 dark:group-hover:!bg-orange-500 dark:group-hover:!text-white flex items-center justify-center group-hover:scale-105 transition-all shadow-2xs">
                <ArrowFatDown weight="fill" className="w-4 h-4 sm:w-[22px] sm:h-[22px]" />
              </div>
              <span className="text-[10px] sm:text-xs font-display font-bold uppercase tracking-wider leading-tight text-stone-900 group-hover:text-black dark:group-hover:!text-orange-500 transition-colors truncate max-w-full">
                Request
              </span>
              <span className="text-[8.5px] sm:text-[10px] font-mono leading-tight text-stone-500 dark:group-hover:!text-orange-400/90 transition-colors truncate max-w-full">
                From 𝕏
              </span>
            </Link>

            <Link
              to="/app/receive"
              className="min-w-0 py-2.5 sm:py-4 px-1.5 sm:px-3 rounded-xl sm:rounded-2xl border border-stone-200 bg-white hover:border-black dark:hover:!border-orange-500 text-center transition-all duration-150 flex flex-col items-center justify-center space-y-1 sm:space-y-1.5 shadow-xs hover:shadow-sm group cursor-pointer"
            >
              <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 dark:group-hover:!bg-orange-500 dark:group-hover:!text-white flex items-center justify-center group-hover:scale-105 transition-all shadow-2xs">
                <CurrencyCircleDollar weight="fill" className="w-4 h-4 sm:w-[22px] sm:h-[22px]" />
              </div>
              <span className="text-[10px] sm:text-xs font-display font-bold uppercase tracking-wider leading-tight text-stone-900 group-hover:text-black dark:group-hover:!text-orange-500 transition-colors truncate max-w-full">
                Deposit
              </span>
              <span className="text-[8.5px] sm:text-[10px] font-mono leading-tight text-stone-500 dark:group-hover:!text-orange-400/90 transition-colors truncate max-w-full">
                Any Chain
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setIsWithdrawModalOpen(true)}
              className="relative overflow-hidden min-w-0 py-2.5 sm:py-4 px-1.5 sm:px-3 rounded-xl sm:rounded-2xl border border-emerald-700/80 bg-emerald-600 hover:bg-emerald-700 text-center transition-all duration-150 flex flex-col items-center justify-center space-y-1 sm:space-y-1.5 shadow-xs hover:shadow-sm group cursor-pointer"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none select-none absolute inset-0 overflow-hidden font-mono text-[6.5px] leading-[8px] tracking-[0.12em] text-white/15 group-hover:text-white/25 whitespace-pre flex flex-col justify-between py-1 transition-colors"
              >
                <span>╔══╬░▒▓█ NEAR.COM █▓▒░╬══╗</span>
                <span>║░▒▓█╬──┼──VAULT──┼──╬█▓▒║</span>
                <span>╠══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓█╬═╣</span>
                <span>║▓▒░╬──┼─NEP-518─┼──╬░▒▓█║</span>
                <span>║░▒▓█╬═══╬█▓▒░▒▓█╬═══╬█▓▒║</span>
                <span>║█▓▒░╬──┼─SHIELD─┼──╬░▒▓█║</span>
                <span>╠══╬░▒▓█╬═══╬█▓▒░▒▓█╬══╬═╣</span>
                <span>║▒░╬──┼─0.00 GAS─┼──╬█▓▒░║</span>
                <span>╚══╬█▓▒░▒▓█╬═══╬█▓▒░▒▓█╬═╝</span>
              </span>
              <div className="relative z-10 w-8 h-8 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-white text-emerald-700 flex items-center justify-center group-hover:scale-105 transition-all shadow-2xs">
                <ArrowFatUp weight="fill" className="w-4 h-4 sm:w-[22px] sm:h-[22px]" />
              </div>
              <span className="relative z-10 text-[10px] sm:text-xs font-display font-bold uppercase tracking-wider leading-tight text-white transition-colors drop-shadow-xs truncate max-w-full">
                Withdraw
              </span>
              <span className="relative z-10 text-[8.5px] sm:text-[10px] font-mono leading-tight text-emerald-100 transition-colors drop-shadow-xs truncate max-w-full">
                near.com
              </span>
            </button>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Live Transactions ── */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-3xl p-5 sm:p-6 bg-white border border-stone-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center space-x-2">
                <h3 className="font-display font-extrabold text-stone-950 text-base">
                  Transactions
                </h3>
                <Badge tone="neutral">{Math.min(recentActivity.length, 4)}</Badge>
              </div>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing || isLoadingHistory || isLoadingOnchainHistory}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg hover:bg-stone-50 transition-colors cursor-pointer"
                title="Refresh transactions"
              >
                <ArrowsClockwise weight="bold" className={`w-3.5 h-3.5 ${(isRefreshing || isLoadingHistory || isLoadingOnchainHistory) ? 'animate-spin text-stone-900' : ''}`} />
              </button>
            </div>

            {/* Simple hairline list — unified onchain and P2P ledger */}
            <div className="divide-y divide-stone-100 max-h-[390px] sm:max-h-[450px] overflow-y-auto pr-1 overscroll-contain">
              {(isLoadingHistory || isLoadingOnchainHistory) && recentActivity.length === 0 ? (
                <div className="py-2 space-y-3" aria-hidden="true">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 px-1 py-1">
                      <div className="flex items-center space-x-2.5">
                        <Skeleton variant="circle" className="w-7 h-7" />
                        <div className="space-y-1.5">
                          <Skeleton className="w-24" />
                          <Skeleton className="w-16 h-2.5" />
                        </div>
                      </div>
                      <div className="space-y-1.5 text-right">
                        <Skeleton className="ml-auto w-20 h-3" />
                        <Skeleton className="ml-auto w-12 h-2.5" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentActivity.length === 0 ? (
                <div className="py-12 text-center text-xs text-stone-400 font-mono">
                  No activity yet.
                </div>
              ) : (
                recentActivity.slice(0, 4).map((tx) => {
                  return (
                    <div
                      key={tx.id}
                      className="py-3 flex items-center justify-between gap-2 hover:bg-stone-50/70 rounded-xl px-2 transition-colors group"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          tx.balanceEffect === 'debit'
                            ? 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/40 dark:border-red-900/60'
                            : tx.balanceEffect === 'incoming'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900/60'
                            : 'bg-stone-100 text-stone-700 border border-stone-200 dark:bg-stone-800 dark:border-stone-700'
                        }`}>
                          {tx.balanceEffect === 'debit' ? (
                            <ArrowUpRight weight="bold" className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                          ) : tx.balanceEffect === 'incoming' ? (
                            <ArrowDownLeft weight="bold" className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Clock weight="fill" className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-stone-900 dark:text-stone-100 font-mono truncate">
                            {tx.title}
                          </div>
                          <div className="text-[10px] text-stone-400 font-mono truncate">
                            {tx.subtitle}
                          </div>
                          {tx.reason && (
                            <div
                              className="text-[10px] text-amber-700 dark:text-amber-400 font-mono flex items-start gap-1 leading-snug mt-0.5 max-w-[220px] sm:max-w-xs"
                              title={tx.reason}
                            >
                              <WarningCircle weight="fill" className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              <span className="line-clamp-2 break-words">{tx.reason}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5 sm:space-x-2 flex-shrink-0">
                        <div className="text-right">
                          {(() => {
                            const amt = formatBalanceAmount(tx.amount, tx.balanceEffect);
                            return (
                              <div className="text-xs font-mono font-bold whitespace-nowrap">
                                <span className={amt.colorClass}>
                                  {amt.prefix}{amt.amount}
                                </span>{' '}
                                <span className="text-stone-500 dark:text-stone-400 font-normal">{tx.symbol}</span>
                              </div>
                            );
                          })()}
                          {(() => {
                            const statusMeta = activityStatusMeta({
                              type: tx.type,
                              isSent: tx.isSent,
                              status: tx.status,
                            });
                            return (
                              <span
                                className={`text-[9px] font-mono uppercase font-bold px-1.5 py-0.2 rounded border ${statusMeta.className}`}
                              >
                                {statusMeta.label}
                              </span>
                            );
                          })()}
                        </div>
                        {tx.copyValue && (
                          <button
                            type="button"
                            onClick={() => handleCopyTxLink(tx.copyValue!, tx.id)}
                            className="p-1 rounded-lg text-stone-300 hover:text-black hover:bg-stone-100 transition-colors cursor-pointer"
                            title={tx.copyTitle || "Copy link"}
                          >
                            {copiedTxId === tx.id ? (
                              <Check weight="bold" className="w-3.5 h-3.5 text-stone-900" />
                            ) : (
                              <Copy weight="fill" className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        {tx.explorerUrl && (
                          <a
                            href={tx.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded-lg text-stone-300 hover:text-black hover:bg-stone-100 transition-colors"
                            title="View on Explorer"
                          >
                            <ArrowSquareOut weight="fill" className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-2 border-t border-stone-100 text-center">
              <Link
                to="/app/history"
                className="inline-flex items-center space-x-1 text-xs font-mono font-bold text-stone-900 hover:text-black transition-colors"
              >
                <span>Full Ledger ({recentActivity.length})</span>
                <ArrowRight weight="bold" className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── PEOPLE YOU PAY (Full Width on Desktop) ── */}
      <div className="w-full mt-6 sm:mt-8">
        <PeopleYouPay
          onSelectRecipient={(handle, asset, prefAmount) => {
            const q = new URLSearchParams();
            q.set('recipient', handle);
            if (asset) q.set('asset', asset);
            if (prefAmount) q.set('amount', prefAmount);
            navigate(`/app/send?${q.toString()}`);
          }}
          onRequestMoney={(handle, asset) => {
            const q = new URLSearchParams();
            q.set('handle', handle);
            if (asset) q.set('asset', asset);
            navigate(`/app/request?${q.toString()}`);
          }}
        />
      </div>

      {/* ── FLOW TELEMETRY & ACTIVITY PULSE WIDGET (Under everything) ── */}
      <div className="mt-8">
        <FlowPulseWidget history={history} transactions={transactions} tokens={tokens} />
      </div>

      <NearcomWithdrawModal
        isOpen={isWithdrawModalOpen}
        onClose={() => setIsWithdrawModalOpen(false)}
        tokens={balances
          .filter((b) => (parseFloat(b.amountFormatted || '0') || 0) > 0)
          .map((b) => {
            const symUpper = (b.symbol || '').toUpperCase();
            const matched = paymentTokens.find(
              (t) =>
                t.id.toLowerCase() === b.defuse_asset_id.toLowerCase() ||
                t.symbol.toUpperCase() === symUpper
            );
            return {
              id: b.nearContractId ? `nep141:${b.nearContractId}` : b.defuse_asset_id,
              symbol: b.symbol,
              name: matched?.name || b.symbol,
              iconUrl: b.icon || matched?.iconUrl || '',
              decimals: b.decimals,
              nearContractId: b.nearContractId || matched?.nearContractId || '',
              priceUsd: b.priceUsd ?? matched?.priceUsd,
              balance: b.amountFormatted,
            };
          })}
        onSuccess={() => {
          void handleManualRefresh();
        }}
      />

      <StabilizeModal
        isOpen={isStabilizeModalOpen}
        onClose={() => {
          setIsStabilizeModalOpen(false);
          setStabilizeInitialToken(null);
        }}
        tokens={balances
          .filter(
            (b) =>
              (b.supportsOneClick ?? (b.symbol?.toUpperCase() === 'NEAR' || !b.isPlainOnly)) &&
              (parseFloat(b.amountFormatted || '0') || 0) > 0
          )
          .map((b) => {
            const symUpper = (b.symbol || '').toUpperCase();
            const matched = paymentTokens.find(
              (t) =>
                t.id.toLowerCase() === b.defuse_asset_id.toLowerCase() ||
                t.symbol.toUpperCase() === symUpper
            );
            return {
              id: b.defuse_asset_id,
              symbol: b.symbol,
              name: matched?.name || b.symbol,
              iconUrl: b.icon || matched?.iconUrl || '',
              decimals: b.decimals,
              nearContractId: b.nearContractId || matched?.nearContractId || '',
              priceUsd: b.priceUsd ?? matched?.priceUsd,
              balance: b.amountFormatted,
            };
          })}
        initialToken={stabilizeInitialToken}
        onSuccess={() => {
          void handleManualRefresh();
        }}
      />

      <CoffeeModal
        isOpen={isCoffeeModalOpen}
        onClose={() => setIsCoffeeModalOpen(false)}
        xHandle={user?.handle || ''}
      />

      <SelfCustodyUpgradeModal
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        onUpgraded={() => {
          void refreshSession();
          void handleManualRefresh();
        }}
      />
    </div>
  );
};

