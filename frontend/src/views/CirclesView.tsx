'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from '../lib/router';
import {
  ArrowLeft,
  CircleDot,
  Gift,
  Plus,
  Sparkles,
  Lock,
  Unlock,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Fingerprint,
  Users,
  TrendingUp,
  Clock,
  Shield,
  Trash2,
  X,
  AlertCircle,
  ArrowUpRight,
  Share2,
  Calendar,
} from 'lucide-react';
import { api, formatUsd } from '../lib/api';
import { useXAuth } from '../hooks/useXAuth';
import { useOnchainData } from '../hooks/useOnchainData';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { useToast } from '../components/Toast';
import { Portal } from '../components/Portal';
import type {
  EarnVaultDescriptor,
  EarnVaultSymbol,
  CircleView,
  CirclePurpose,
  AuthenticatedGiftView,
  GiftOccasion,
  GiftQuoteResult,
} from '../types';

const PURPOSE_OPTIONS: Array<{
  value: CirclePurpose;
  label: string;
  shortDesc: string;
}> = [
  { value: 'CONTRIBUTIONS', label: 'Group Contributions', shortDesc: 'Pooled team or community fund' },
  { value: 'SHARED_GOAL', label: 'Shared Goal', shortDesc: 'Milestone target with fixed % splits' },
  { value: 'RENT', label: 'Shared Rent & Bills', shortDesc: 'Housemates & recurring split obligations' },
  { value: 'TRIP', label: 'Group Trip & Travel', shortDesc: 'Flights, stays & experiences fund' },
  { value: 'DAILY_TIP', label: 'Daily Goal Tip Jar', shortDesc: 'Recurring tip pool compounding in Earn' },
  { value: 'SAVINGS_CLUB', label: 'Savings Circle', shortDesc: 'High-yield collective savings vault' },
];

const OCCASION_OPTIONS: Array<{
  value: GiftOccasion;
  label: string;
  emoji: string;
  presetDays?: number;
  fixedMonthDay?: { month: number; day: number };
}> = [
  { value: 'BIRTHDAY', label: 'Birthday', emoji: '🎂', presetDays: 7 },
  { value: 'CHRISTMAS', label: 'Christmas', emoji: '🎄', fixedMonthDay: { month: 11, day: 25 } },
  { value: 'NEW_YEAR', label: 'New Year', emoji: '🎆', fixedMonthDay: { month: 0, day: 1 } },
  { value: 'ANNIVERSARY', label: 'Anniversary', emoji: '🥂', presetDays: 14 },
  { value: 'GRADUATION', label: 'Graduation', emoji: '🎓', presetDays: 30 },
  { value: 'WEDDING', label: 'Wedding', emoji: '💍', presetDays: 30 },
  { value: 'THANK_YOU', label: 'Thank You', emoji: '🙏', presetDays: 1 },
  { value: 'JUST_BECAUSE', label: 'Surprise Gift', emoji: '✨', presetDays: 3 },
];

function formatCentsUsd(cents: number | undefined | null): string {
  if (cents === undefined || cents === null || !Number.isFinite(cents)) return '$0.00';
  return formatUsd(cents / 100);
}

function formatCountdown(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  if (diff <= 0) return 'Unlocked & Ready';
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

function defaultTimelockForOccasion(occasion: GiftOccasion): string {
  const now = new Date();
  const opt = OCCASION_OPTIONS.find((o) => o.value === occasion);
  let target = new Date(now.getTime() + 7 * 86400 * 1000);
  if (opt?.fixedMonthDay) {
    const year = now.getFullYear();
    const candidate = new Date(year, opt.fixedMonthDay.month, opt.fixedMonthDay.day, 9, 0, 0);
    if (candidate.getTime() <= now.getTime() + 3600 * 1000) {
      candidate.setFullYear(year + 1);
    }
    target = candidate;
  } else if (opt?.presetDays) {
    target = new Date(now.getTime() + opt.presetDays * 86400 * 1000);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(
    target.getHours()
  )}:${pad(target.getMinutes())}`;
}

export const CirclesView: React.FC = () => {
  const { user } = useXAuth();
  const { balances, refresh: refreshOnchain } = useOnchainData();
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'circles' | 'gifts'>('circles');
  const [vaults, setVaults] = useState<EarnVaultDescriptor[]>([]);
  const [circles, setCircles] = useState<CircleView[]>([]);
  const [sentGifts, setSentGifts] = useState<AuthenticatedGiftView[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<AuthenticatedGiftView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Modals state
  const [isCreateCircleOpen, setIsCreateCircleOpen] = useState(false);
  const [isCreateGiftOpen, setIsCreateGiftOpen] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState<CircleView | null>(null);
  const [contributeCircle, setContributeCircle] = useState<CircleView | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create Circle form state
  const [circleName, setCircleName] = useState('');
  const [circlePurpose, setCirclePurpose] = useState<CirclePurpose>('SHARED_GOAL');
  const [circleNote, setCircleNote] = useState('');
  const [circleTargetUsd, setCircleTargetUsd] = useState('500');
  const [circleVaultSymbol, setCircleVaultSymbol] = useState<EarnVaultSymbol>('TLO');
  const [circlePayoutHandle, setCirclePayoutHandle] = useState('');
  const [circleMembers, setCircleMembers] = useState<Array<{ handle: string; percentage: string }>>([
    { handle: user?.handle || '', percentage: '50' },
    { handle: '', percentage: '50' },
  ]);
  const [isSubmittingCircle, setIsSubmittingCircle] = useState(false);

  // Contribute form state
  const [contribOriginAsset, setContribOriginAsset] = useState('');
  const [contribAmount, setContribAmount] = useState('');
  const [contribFundingMode, setContribFundingMode] = useState<'BALANCE' | 'EXTERNAL_DEPOSIT'>('BALANCE');
  const [pendingContribDeposit, setPendingContribDeposit] = useState<{
    depositAddress: string;
    depositMemo: string | null;
    amount: string;
    symbol: string;
  } | null>(null);
  const [isSubmittingContrib, setIsSubmittingContrib] = useState(false);
  const [isActionBusyId, setIsActionBusyId] = useState<string | null>(null);

  // Create Gift form state
  const [giftRecipient, setGiftRecipient] = useState('');
  const [giftOccasion, setGiftOccasion] = useState<GiftOccasion>('BIRTHDAY');
  const [giftMessage, setGiftMessage] = useState('');
  const [giftShowAmount, setGiftShowAmount] = useState(false);
  const [giftVaultSymbol, setGiftVaultSymbol] = useState<EarnVaultSymbol>('TLO');
  const [giftOriginAsset, setGiftOriginAsset] = useState('');
  const [giftAmount, setGiftAmount] = useState('25');
  const [giftTimelockLocal, setGiftTimelockLocal] = useState(() => defaultTimelockForOccasion('BIRTHDAY'));
  const [giftFundingMode, setGiftFundingMode] = useState<'BALANCE' | 'EXTERNAL_DEPOSIT'>('BALANCE');
  const [giftQuote, setGiftQuote] = useState<GiftQuoteResult | null>(null);
  const [isQuotingGift, setIsQuotingGift] = useState(false);
  const [isSubmittingGift, setIsSubmittingGift] = useState(false);

  // Live 1-second ticker for gift countdowns
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync creator handle into default Circle form when user loads
  useEffect(() => {
    if (user?.handle) {
      setCirclePayoutHandle((prev) => prev || user.handle);
      setCircleMembers((prev) => {
        if (prev.length > 0 && !prev[0].handle) {
          const next = [...prev];
          next[0] = { ...next[0], handle: user.handle };
          return next;
        }
        return prev;
      });
    }
  }, [user?.handle]);

  // Pick default origin asset from user's highest positive balance or USDC
  const availableOriginAssets = useMemo(() => {
    const held = balances
      .filter((b) => (parseFloat(b.amountFormatted || '0') || 0) > 0)
      .map((b) => ({
        assetId: b.defuse_asset_id || b.nearContractId || b.symbol,
        symbol: b.symbol,
        balanceFormatted: b.amountFormatted,
        chain: 'near',
      }));
    if (held.length > 0) return held;
    return [
      {
        assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
        symbol: 'USDC',
        balanceFormatted: '0.00',
        chain: 'near',
      },
      {
        assetId: 'nep141:usdt.tether-token.near',
        symbol: 'USDT',
        balanceFormatted: '0.00',
        chain: 'near',
      },
      {
        assetId: 'nep141:wrap.near',
        symbol: 'NEAR',
        balanceFormatted: '0.00',
        chain: 'near',
      },
    ];
  }, [balances]);

  useEffect(() => {
    if (availableOriginAssets.length > 0) {
      if (!giftOriginAsset) setGiftOriginAsset(availableOriginAssets[0].assetId);
      if (!contribOriginAsset) setContribOriginAsset(availableOriginAssets[0].assetId);
    }
  }, [availableOriginAssets, giftOriginAsset, contribOriginAsset]);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [vaultList, circleList, giftLists] = await Promise.all([
        api.getEarnVaults().catch(() => []),
        api.listCircles().catch(() => []),
        api.listGifts().catch(() => ({ sent: [], received: [] })),
      ]);
      if (vaultList.length > 0) setVaults(vaultList);
      setCircles(circleList);
      setSentGifts(giftLists.sent);
      setReceivedGifts(giftLists.received);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Live quote preview for Gift modal
  useEffect(() => {
    if (!isCreateGiftOpen) return;
    const amt = parseFloat(giftAmount);
    if (!giftOriginAsset || !giftVaultSymbol || !Number.isFinite(amt) || amt <= 0) {
      setGiftQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsQuotingGift(true);
      try {
        const q = await api.quoteGift({
          originAsset: giftOriginAsset,
          amount: String(giftAmount),
          vaultAsset: giftVaultSymbol,
        });
        if (!cancelled) setGiftQuote(q);
      } catch {
        if (!cancelled) setGiftQuote(null);
      } finally {
        if (!cancelled) setIsQuotingGift(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isCreateGiftOpen, giftOriginAsset, giftAmount, giftVaultSymbol]);

  const totalMemberPercentage = useMemo(() => {
    return circleMembers.reduce((acc, m) => acc + (parseFloat(m.percentage) || 0), 0);
  }, [circleMembers]);

  const splitMembersEvenly = () => {
    const count = circleMembers.length;
    if (count === 0) return;
    const baseBps = Math.floor(10000 / count);
    const remBps = 10000 - baseBps * count;
    setCircleMembers(
      circleMembers.map((m, idx) => ({
        ...m,
        percentage: ((baseBps + (idx === count - 1 ? remBps : 0)) / 100).toFixed(2).replace(/\.00$/, ''),
      }))
    );
  };

  const handleCopyLink = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast('Link copied to clipboard', 'success');
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
  };

  const handleCreateCircle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Math.abs(totalMemberPercentage - 100) > 0.01) {
      toast(
        `Member allocations must equal 100% (currently ${totalMemberPercentage.toFixed(2)}%).`,
        'error'
      );
      return;
    }
    setIsSubmittingCircle(true);
    try {
      const assertion = await authorizeWithPasskey(
        `Create Circle "${circleName}" on ${circleVaultSymbol} Earn Vault`
      );
      const created = await api.createCircle({
        name: circleName.trim(),
        purpose: circlePurpose,
        note: circleNote.trim() || undefined,
        targetAmountUsd: parseFloat(circleTargetUsd),
        vaultAsset: circleVaultSymbol,
        payoutHandle: circlePayoutHandle.trim() || user?.handle,
        members: circleMembers.map((m) => ({
          handle: m.handle.trim().replace(/^@+/, ''),
          percentageShare: parseFloat(m.percentage),
        })),
        passkeyAssertion: assertion,
      });
      setCircles((prev) => [created, ...prev]);
      setIsCreateCircleOpen(false);
      setSelectedCircle(created);
      toast(
        `${created.name} is live and ready for member contributions in ${created.vaultSymbol}!`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not create Circle. Check member handles and try again.', 'error');
    } finally {
      setIsSubmittingCircle(false);
    }
  };

  const handleContribute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contributeCircle) return;
    setIsSubmittingContrib(true);
    setPendingContribDeposit(null);
    try {
      const assertion = await authorizeWithPasskey(
        `Contribute ${contribAmount} to ${contributeCircle.name}`
      );
      const res = await api.contributeToCircle({
        circleId: contributeCircle.id,
        originAsset: contribOriginAsset,
        amount: contribAmount.trim(),
        fundingMode: contribFundingMode,
        passkeyAssertion: assertion,
      });
      setCircles((prev) => prev.map((c) => (c.id === res.circle.id ? res.circle : c)));
      if (selectedCircle?.id === res.circle.id) {
        setSelectedCircle(res.circle);
      }
      if (res.status === 'PENDING_FUNDING' && res.depositAddress) {
        const assetObj = availableOriginAssets.find((a) => a.assetId === contribOriginAsset);
        setPendingContribDeposit({
          depositAddress: res.depositAddress,
          depositMemo: res.depositMemo,
          amount: contribAmount.trim(),
          symbol: assetObj?.symbol || 'tokens',
        });
        toast('Send the exact amount to the 1Click deposit address to mint Circle vault shares.', 'info');
      } else {
        setContributeCircle(null);
        setContribAmount('');
        refreshOnchain();
        toast(
          `Minted ${res.sharesAddedFormatted} ${res.circle.vaultSymbol} into ${res.circle.name}!`,
          'success'
        );
      }
    } catch (err: any) {
      toast(err?.message || 'Unable to process Circle contribution.', 'error');
    } finally {
      setIsSubmittingContrib(false);
    }
  };

  const handleSettleCircle = async (circle: CircleView) => {
    setIsActionBusyId(circle.id);
    try {
      const assertion = await authorizeWithPasskey(
        `Settle Circle "${circle.name}" to @${circle.payoutHandle}`
      );
      const res = await api.settleCircle({
        circleId: circle.id,
        passkeyAssertion: assertion,
      });
      setCircles((prev) => prev.map((c) => (c.id === res.circle.id ? res.circle : c)));
      if (selectedCircle?.id === res.circle.id) setSelectedCircle(res.circle);
      refreshOnchain();
      toast(
        `Settled ${res.sharesSettledFormatted} ${circle.vaultSymbol} (principal + yield) to @${res.payoutHandle}!`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not settle Circle.', 'error');
    } finally {
      setIsActionBusyId(null);
    }
  };

  const handleDissolveCircle = async (circle: CircleView) => {
    setIsActionBusyId(circle.id);
    try {
      const assertion = await authorizeWithPasskey(
        `Dissolve Circle "${circle.name}" and refund members`
      );
      const res = await api.dissolveCircle({
        circleId: circle.id,
        passkeyAssertion: assertion,
      });
      setCircles((prev) => prev.map((c) => (c.id === res.circle.id ? res.circle : c)));
      if (selectedCircle?.id === res.circle.id) setSelectedCircle(res.circle);
      refreshOnchain();
      toast(
        `Circle dissolved — refunded vault shares + yield to ${res.refundedMembers} member(s).`,
        'info'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not dissolve Circle.', 'error');
    } finally {
      setIsActionBusyId(null);
    }
  };

  const handleCreateGift = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRecip = giftRecipient.trim().replace(/^@+/, '');
    if (!cleanRecip || cleanRecip.includes('.')) {
      toast(
        'Earn Vault gifts are strictly sent to an @handle, never a raw wallet address.',
        'error'
      );
      return;
    }
    const unlockMs = new Date(giftTimelockLocal).getTime();
    if (!Number.isFinite(unlockMs) || unlockMs <= Date.now() + 60_000) {
      toast('Pick a future date & time for the gift timelock.', 'error');
      return;
    }

    setIsSubmittingGift(true);
    try {
      const assertion = await authorizeWithPasskey(
        `Gift ${giftAmount} in ${giftVaultSymbol} Earn Vault to @${cleanRecip}`
      );
      const created = await api.createGift({
        recipientHandle: cleanRecip,
        occasion: giftOccasion,
        message: giftMessage.trim() || undefined,
        showAmount: giftShowAmount,
        vaultAsset: giftVaultSymbol,
        originAsset: giftOriginAsset,
        amount: giftAmount.trim(),
        timelockUntil: unlockMs,
        fundingMode: giftFundingMode,
        passkeyAssertion: assertion,
      });
      setSentGifts((prev) => [created, ...prev]);
      setIsCreateGiftOpen(false);
      setActiveTab('gifts');
      refreshOnchain();
      toast(
        `Gifted ${created.vaultSymbol} (${created.estimatedApyPct}% APY) to @${created.recipientHandle}!`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not create gift. Check balance and handle.', 'error');
    } finally {
      setIsSubmittingGift(false);
    }
  };

  const handleClaimGift = async (gift: AuthenticatedGiftView) => {
    setIsActionBusyId(gift.id);
    try {
      const assertion = await authorizeWithPasskey(
        `Unwrap & claim ${gift.sharesFormatted} ${gift.vaultSymbol} gift from @${gift.senderHandle}`
      );
      const res = await api.claimGift({
        giftId: gift.id,
        passkeyAssertion: assertion,
      });
      setReceivedGifts((prev) => prev.map((g) => (g.id === res.gift.id ? res.gift : g)));
      refreshOnchain();
      toast(
        `Unwrapped ${res.sharesClaimed} ${res.gift.vaultSymbol} (principal + yield) into your vault!`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not unwrap gift.', 'error');
    } finally {
      setIsActionBusyId(null);
    }
  };

  // Summary metrics
  const totalCirclesPrincipalCents = useMemo(
    () => circles.reduce((acc, c) => acc + (c.contributedUsdCents || 0), 0),
    [circles]
  );
  const totalCirclesYieldCents = useMemo(
    () => circles.reduce((acc, c) => acc + (c.yieldUsdCents || 0), 0),
    [circles]
  );
  const totalGiftsYieldCents = useMemo(
    () =>
      [...sentGifts, ...receivedGifts].reduce((acc, g) => acc + (g.yieldUsdCents || 0), 0),
    [sentGifts, receivedGifts]
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/app"
            className="w-9 h-9 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 flex items-center justify-center text-stone-700 transition-colors"
            title="Back to Vault"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-display font-extrabold text-stone-950 tracking-tight">
                Circles & Earn Gifting
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-mono font-bold uppercase tracking-wider">
                1Click Earn
              </span>
            </div>
            <p className="text-xs text-stone-500">
              Pool shared goals by percentage or send timelocked Earn Vault gifts to any @handle.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateGiftOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-900 text-xs font-display font-bold transition-all cursor-pointer shadow-2xs"
          >
            <Gift className="w-3.5 h-3.5 text-amber-600" />
            <span>Gift a Vault</span>
          </button>
          <button
            type="button"
            onClick={() => setIsCreateCircleOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-all cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>New Circle</span>
          </button>
        </div>
      </div>

      {/* Live 1Click Earn Vaults Selector Bar */}
      <div className="bg-stone-100/90 border border-stone-200/80 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-stone-700">
              Available 1Click Earn Vaults (All Selectable for Circles & Gifts)
            </span>
          </div>
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-stone-500 hover:text-stone-900 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {vaults.map((v) => {
            const isSelected =
              (activeTab === 'circles' ? circleVaultSymbol : giftVaultSymbol) === v.symbol;
            return (
              <div
                key={v.assetId}
                onClick={() => {
                  setCircleVaultSymbol(v.symbol);
                  setGiftVaultSymbol(v.symbol);
                }}
                className={`rounded-xl p-3.5 border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white border-stone-900 shadow-xs'
                    : 'bg-white/70 border-stone-200/80 hover:border-stone-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-extrabold text-sm text-stone-950">
                      {v.symbol}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 uppercase">
                      {v.chainName}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-xs font-bold">
                    {v.estimatedApyPct.toFixed(1)}% APY
                  </span>
                </div>
                <div className="text-xs font-medium text-stone-800">{v.name}</div>
                <div className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">
                  {v.protocol} • Min ${v.minDepositUsd} USD
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mode Switcher Tabs + Live Yield Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-3">
        <div className="inline-flex p-1 rounded-xl bg-stone-100 border border-stone-200/80 self-start">
          <button
            type="button"
            onClick={() => setActiveTab('circles')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-display font-bold transition-all cursor-pointer ${
              activeTab === 'circles'
                ? 'bg-stone-950 text-white shadow-2xs'
                : 'text-stone-600 hover:text-stone-950'
            }`}
          >
            <CircleDot className="w-3.5 h-3.5" />
            <span>Circles ({circles.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gifts')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-display font-bold transition-all cursor-pointer ${
              activeTab === 'gifts'
                ? 'bg-stone-950 text-white shadow-2xs'
                : 'text-stone-600 hover:text-stone-950'
            }`}
          >
            <Gift className="w-3.5 h-3.5" />
            <span>Timelocked Gifts ({sentGifts.length + receivedGifts.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-stone-400 uppercase mr-1.5">Pooled:</span>
            <span className="font-bold text-stone-900">
              {formatCentsUsd(totalCirclesPrincipalCents)}
            </span>
          </div>
          <div>
            <span className="text-stone-400 uppercase mr-1.5">Accrued Yield:</span>
            <span className="font-bold text-emerald-600">
              +{formatCentsUsd(totalCirclesYieldCents + totalGiftsYieldCents)}
            </span>
          </div>
        </div>
      </div>

      {/* TAB 1: CIRCLES */}
      {activeTab === 'circles' && (
        <div className="space-y-4">
          {circles.length === 0 ? (
            <div className="bg-stone-100/70 border border-stone-200/80 rounded-2xl p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-stone-950 text-emerald-400 flex items-center justify-center mx-auto">
                <Users className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-display font-bold text-stone-950">
                  No Active Circles Yet
                </h3>
                <p className="text-xs text-stone-500 leading-relaxed">
                  Create a Circle for group contributions, shared goals, rent, trips, or daily tips.
                  Assign percentage quotas to any @handle and compound yield in TLO, gtUSDCp, or kV-gtSOLb.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateCircleOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4 text-emerald-400" />
                <span>Create Your First Circle</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {circles.map((circle) => (
                <div
                  key={circle.id}
                  className="bg-white border border-stone-200/90 rounded-2xl p-5 shadow-2xs space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-stone-100 text-stone-700 font-mono text-[10px] font-bold uppercase tracking-wider">
                          {circle.purposeLabel}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-[10px] font-bold">
                          {circle.vaultSymbol} • {circle.estimatedApyPct}% APY
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold uppercase ${
                            circle.status === 'ACTIVE'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : circle.status === 'COMPLETED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {circle.status}
                        </span>
                      </div>
                      <h3 className="text-lg font-display font-extrabold text-stone-950">
                        {circle.name}
                      </h3>
                      {circle.note && (
                        <p className="text-xs text-stone-500">{circle.note}</p>
                      )}
                      <div className="text-[11px] font-mono text-stone-500">
                        Created by @{circle.creatorHandle} • Payout recipient:{' '}
                        <span className="text-stone-900 font-semibold">@{circle.payoutHandle}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:items-end justify-between gap-2">
                      <div className="text-right">
                        <div className="text-xl font-display font-extrabold text-stone-950 tabular-nums">
                          {formatCentsUsd(circle.currentValueUsdCents)}{' '}
                          <span className="text-xs font-mono font-normal text-stone-400">
                            / {formatCentsUsd(circle.targetUsdCents)}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-emerald-600">
                          +{formatCentsUsd(circle.yieldUsdCents)} live yield ({circle.totalSharesFormatted}{' '}
                          {circle.vaultSymbol})
                        </div>
                      </div>

                      {circle.status === 'ACTIVE' && (
                        <div className="flex flex-wrap items-center gap-2">
                          {circle.isMember && (
                            <button
                              type="button"
                              onClick={() => {
                                setContributeCircle(circle);
                                setPendingContribDeposit(null);
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-display font-bold transition-all cursor-pointer"
                            >
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              <span>Contribute Share</span>
                            </button>
                          )}
                          {circle.isCreator && Number(circle.totalSharesAtomic) > 0 && (
                            <>
                              <button
                                type="button"
                                disabled={isActionBusyId === circle.id || isAuthorizing}
                                onClick={() => handleSettleCircle(circle)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-all cursor-pointer disabled:opacity-50"
                              >
                                <Fingerprint className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Settle to @{circle.payoutHandle}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isActionBusyId === circle.id || isAuthorizing}
                                onClick={() => handleDissolveCircle(circle)}
                                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-600 text-xs font-mono transition-all cursor-pointer disabled:opacity-50"
                                title="Refund pro-rata shares + yield to members"
                              >
                                <span>Dissolve</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Overall Circle Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono text-stone-500">
                      <span>Pool Quota Progress</span>
                      <span className="font-bold text-stone-900">
                        {circle.progressPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, circle.progressPct)}%` }}
                      />
                    </div>
                  </div>

                  {/* Member Percentage Allocations Table */}
                  <div className="border-t border-stone-100 pt-3 space-y-2">
                    <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-stone-400">
                      Member Percentage Allocations (100.00% Total)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {circle.members.map((m) => (
                        <div
                          key={m.id}
                          className="p-3 rounded-xl bg-stone-50/90 border border-stone-200/70 space-y-1.5"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-stone-900">
                                @{m.handle}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-stone-200/80 text-stone-700 font-mono text-[10px] font-bold">
                                {m.percentageShare.toFixed(2).replace(/\.00$/, '')}%
                              </span>
                            </div>
                            <span
                              className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                m.hasMetQuota
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {m.hasMetQuota ? 'QUOTA MET ✓' : `${m.progressPct.toFixed(0)}% MET`}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] font-mono text-stone-500">
                            <span>
                              Contributed: {formatCentsUsd(m.contributedUsdCents)} /{' '}
                              {formatCentsUsd(m.quotaUsdCents)}
                            </span>
                            {m.yieldUsdCents > 0 && (
                              <span className="text-emerald-600">
                                +{formatCentsUsd(m.yieldUsdCents)} yield
                              </span>
                            )}
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-stone-200 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                m.hasMetQuota ? 'bg-emerald-600' : 'bg-stone-900'
                              }`}
                              style={{ width: `${Math.min(100, m.progressPct)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: 1-TO-1 TIMELOCKED EARN VAULT GIFTING */}
      {activeTab === 'gifts' && (
        <div className="space-y-6">
          {/* Received Gifts */}
          <div className="space-y-3">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-stone-500">
              Gifts Sent to You (@{user?.handle})
            </h2>
            {receivedGifts.length === 0 ? (
              <div className="bg-stone-100/60 border border-stone-200/80 rounded-2xl p-6 text-center text-xs text-stone-500">
                No Earn Vault gifts received yet. When someone sends an Earn Vault gift to @{user?.handle}, it will appear here with live compounding yield.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {receivedGifts.map((gift) => {
                  const unlocked = nowMs >= gift.timelockUntil;
                  return (
                    <div
                      key={gift.id}
                      className="bg-white border border-stone-200 rounded-2xl p-5 shadow-2xs space-y-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-mono font-bold uppercase">
                              {gift.occasionLabel}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-mono font-bold">
                              {gift.vaultSymbol} • {gift.estimatedApyPct}% APY
                            </span>
                          </div>
                          <h3 className="text-base font-display font-extrabold text-stone-950 mt-1.5">
                            From @{gift.senderHandle}
                          </h3>
                          {gift.message && (
                            <p className="text-xs text-stone-600 italic mt-1">
                              &ldquo;{gift.message}&rdquo;
                            </p>
                          )}
                        </div>

                        <div className="text-right">
                          <div className="text-lg font-display font-extrabold text-stone-950 tabular-nums">
                            {formatCentsUsd(gift.currentValueUsdCents)}
                          </div>
                          <div className="text-[11px] font-mono text-emerald-600">
                            Principal {formatCentsUsd(gift.principalUsdCents)} +{' '}
                            {formatCentsUsd(gift.yieldUsdCents)} yield
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-stone-200/70 text-xs font-mono">
                        <div className="flex items-center gap-2 text-stone-700">
                          {unlocked ? (
                            <Unlock className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Lock className="w-4 h-4 text-amber-600" />
                          )}
                          <span>
                            {gift.status === 'CLAIMED'
                              ? 'Unwrapped & Claimed'
                              : formatCountdown(gift.timelockUntil, nowMs)}
                          </span>
                        </div>
                        <span className="text-stone-500">
                          {gift.sharesFormatted} {gift.vaultSymbol}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <Link
                          to={`/gift/${gift.id}`}
                          className="text-xs font-mono text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
                        >
                          <span>View Gift Card</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>

                        {gift.status === 'LOCKED' && (
                          <button
                            type="button"
                            disabled={!unlocked || isActionBusyId === gift.id || isAuthorizing}
                            onClick={() => handleClaimGift(gift)}
                            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-display font-bold transition-all ${
                              unlocked
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs'
                                : 'bg-stone-200 text-stone-500 cursor-not-allowed'
                            }`}
                          >
                            <Fingerprint className="w-3.5 h-3.5" />
                            <span>
                              {unlocked ? 'Unwrap & Claim Vault + Yield' : 'Locked Until Timelock'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sent Gifts */}
          <div className="space-y-3">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-stone-500">
              Gifts You Sent ({sentGifts.length})
            </h2>
            {sentGifts.length === 0 ? (
              <div className="bg-stone-100/60 border border-stone-200/80 rounded-2xl p-6 text-center space-y-3">
                <p className="text-xs text-stone-500">
                  Gift a live compounding Earn Vault to any @handle for birthdays, Christmas, anniversaries, or milestones.
                </p>
                <button
                  type="button"
                  onClick={() => setIsCreateGiftOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-950 text-white text-xs font-display font-bold cursor-pointer"
                >
                  <Gift className="w-3.5 h-3.5 text-amber-400" />
                  <span>Send an Earn Vault Gift</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sentGifts.map((gift) => (
                  <div
                    key={gift.id}
                    className="bg-white border border-stone-200 rounded-2xl p-5 shadow-2xs space-y-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-mono font-bold uppercase">
                            {gift.occasionLabel}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-mono font-bold">
                            {gift.vaultSymbol} • {gift.estimatedApyPct}% APY
                          </span>
                        </div>
                        <h3 className="text-base font-display font-extrabold text-stone-950 mt-1.5">
                          To @{gift.recipientHandle}
                        </h3>
                        {gift.message && (
                          <p className="text-xs text-stone-500 italic mt-0.5">
                            &ldquo;{gift.message}&rdquo;
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        <div className="text-lg font-display font-extrabold text-stone-950 tabular-nums">
                          {formatCentsUsd(gift.currentValueUsdCents)}
                        </div>
                        <div className="text-[11px] font-mono text-emerald-600">
                          +{formatCentsUsd(gift.yieldUsdCents)} yield
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-stone-50 border border-stone-200/70 text-[11px] font-mono text-stone-600">
                      <span>
                        Unlocks: {new Date(gift.timelockUntil).toLocaleString()}
                      </span>
                      <span className="font-bold uppercase text-stone-900">{gift.status}</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleCopyLink(gift.id, gift.shareUrl)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-xs font-mono text-stone-700 cursor-pointer"
                      >
                        {copiedId === gift.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>Copy SEO Gift Link</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <a
                          href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                            `I just gifted @${gift.recipientHandle} a compounding ${gift.vaultSymbol} Earn Vault (${gift.estimatedApyPct}% APY) on @uprailworld 🎁✨`
                          )}&url=${encodeURIComponent(gift.shareUrl)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold"
                        >
                          <Share2 className="w-3 h-3" />
                          <span>Share on 𝕏</span>
                        </a>
                        <Link
                          to={`/gift/${gift.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-xs font-mono text-stone-600"
                        >
                          <span>Card</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE CIRCLE */}
      {isCreateCircleOpen && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 backdrop-blur-xs p-4 overflow-y-auto">
            <div className="bg-white border border-stone-200 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-stone-950 text-emerald-400 flex items-center justify-center">
                    <CircleDot className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-display font-extrabold text-stone-950">
                      Create an Earn Circle
                    </h2>
                    <p className="text-xs text-stone-500">
                      Members are sized by percentage and compound yield together.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateCircleOpen(false)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateCircle} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                    Circle Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Tokyo Summer Trip, House Rent, Core Dev Pool"
                    value={circleName}
                    onChange={(e) => setCircleName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm focus:outline-none focus:border-stone-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1.5">
                    Reason / Purpose for Circle
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {PURPOSE_OPTIONS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setCirclePurpose(p.value)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          circlePurpose === p.value
                            ? 'border-stone-950 bg-stone-950 text-white'
                            : 'border-stone-200 bg-stone-50/70 hover:border-stone-300 text-stone-800'
                        }`}
                      >
                        <div className="text-xs font-display font-bold">{p.label}</div>
                        <div
                          className={`text-[10px] line-clamp-1 ${
                            circlePurpose === p.value ? 'text-stone-300' : 'text-stone-500'
                          }`}
                        >
                          {p.shortDesc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                      Target Pool Goal (USD)
                    </label>
                    <input
                      type="number"
                      min="10"
                      step="1"
                      required
                      value={circleTargetUsd}
                      onChange={(e) => setCircleTargetUsd(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-mono focus:outline-none focus:border-stone-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                      Payout @handle
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="@handle"
                      value={circlePayoutHandle}
                      onChange={(e) => setCirclePayoutHandle(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-mono focus:outline-none focus:border-stone-900"
                    />
                  </div>
                </div>

                {/* Earn Vault Picker */}
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1.5">
                    Select 1Click Earn Vault Asset (Yield Accrual)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {vaults.map((v) => (
                      <button
                        key={v.symbol}
                        type="button"
                        onClick={() => setCircleVaultSymbol(v.symbol)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          circleVaultSymbol === v.symbol
                            ? 'border-emerald-600 bg-emerald-50/70'
                            : 'border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display font-extrabold text-xs text-stone-950">
                            {v.symbol}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-emerald-700">
                            {v.estimatedApyPct}%
                          </span>
                        </div>
                        <div className="text-[10px] text-stone-500 truncate mt-0.5">
                          {v.protocol}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Member Percentage Quotas */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-mono font-bold uppercase text-stone-600">
                      Members & Percentage Shares
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={splitMembersEvenly}
                        className="text-[11px] font-mono text-emerald-700 hover:underline cursor-pointer"
                      >
                        Split Evenly
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCircleMembers((prev) => [...prev, { handle: '', percentage: '0' }])
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-stone-900 hover:underline cursor-pointer"
                      >
                        <Plus className="w-3 h-3" /> Add @handle
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {circleMembers.map((m, idx) => {
                      const pct = parseFloat(m.percentage) || 0;
                      const usdShare = ((parseFloat(circleTargetUsd) || 0) * pct) / 100;
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            required
                            placeholder="@handle"
                            value={m.handle}
                            onChange={(e) => {
                              const next = [...circleMembers];
                              next[idx] = { ...next[idx], handle: e.target.value };
                              setCircleMembers(next);
                            }}
                            className="flex-1 px-3 py-2 rounded-xl border border-stone-300 text-xs font-mono"
                          />
                          <div className="relative w-24">
                            <input
                              type="number"
                              min="1"
                              max="100"
                              step="0.01"
                              required
                              value={m.percentage}
                              onChange={(e) => {
                                const next = [...circleMembers];
                                next[idx] = { ...next[idx], percentage: e.target.value };
                                setCircleMembers(next);
                              }}
                              className="w-full px-2.5 py-2 pr-6 rounded-xl border border-stone-300 text-xs font-mono text-right"
                            />
                            <span className="absolute right-2 top-2 text-xs font-mono text-stone-400">
                              %
                            </span>
                          </div>
                          <span className="w-20 text-right text-[11px] font-mono text-stone-500 tabular-nums">
                            {formatUsd(usdShare)}
                          </span>
                          {circleMembers.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setCircleMembers((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="p-1.5 text-stone-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono pt-1">
                    <span className="text-stone-500">Total Allocation:</span>
                    <span
                      className={`font-bold ${
                        Math.abs(totalMemberPercentage - 100) <= 0.01
                          ? 'text-emerald-600'
                          : 'text-red-600'
                      }`}
                    >
                      {totalMemberPercentage.toFixed(2)}% / 100.00%
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingCircle || isAuthorizing}
                  className="w-full py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Fingerprint className="w-4 h-4 text-emerald-400" />
                  <span>
                    {isSubmittingCircle || isAuthorizing
                      ? 'Authorizing with Passkey...'
                      : 'Confirm with Passkey & Launch Circle'}
                  </span>
                </button>
              </form>
            </div>
          </div>
        </Portal>
      )}

      {/* MODAL 2: CONTRIBUTE TO CIRCLE */}
      {contributeCircle && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 backdrop-blur-xs p-4">
            <div className="bg-white border border-stone-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-display font-extrabold text-stone-950">
                    Contribute to {contributeCircle.name}
                  </h2>
                  <p className="text-xs text-stone-500">
                    Routes via 1Click into {contributeCircle.vaultSymbol} ({contributeCircle.estimatedApyPct}% APY)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setContributeCircle(null);
                    setPendingContribDeposit(null);
                  }}
                  className="p-1.5 text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {pendingContribDeposit ? (
                <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-3 text-xs font-mono">
                  <div className="text-emerald-700 font-bold">
                    Send exactly {pendingContribDeposit.amount} {pendingContribDeposit.symbol} to:
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-stone-200 break-all select-all">
                    {pendingContribDeposit.depositAddress}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyLink('contrib_addr', pendingContribDeposit.depositAddress)
                    }
                    className="w-full py-2.5 rounded-xl bg-stone-950 text-white font-display font-bold cursor-pointer"
                  >
                    Copy Deposit Address
                  </button>
                </div>
              ) : (
                <form onSubmit={handleContribute} className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                      Payment Asset
                    </label>
                    <select
                      value={contribOriginAsset}
                      onChange={(e) => setContribOriginAsset(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-xs font-mono bg-white"
                    >
                      {availableOriginAssets.map((a) => (
                        <option key={a.assetId} value={a.assetId}>
                          {a.symbol} ({a.balanceFormatted} available)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                      Amount to Contribute
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      required
                      placeholder="e.g. 50"
                      value={contribAmount}
                      onChange={(e) => setContribAmount(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setContribFundingMode('BALANCE')}
                      className={`py-2 px-3 rounded-xl border text-xs font-mono font-bold cursor-pointer ${
                        contribFundingMode === 'BALANCE'
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 text-stone-600'
                      }`}
                    >
                      From UPRAIL Balance
                    </button>
                    <button
                      type="button"
                      onClick={() => setContribFundingMode('EXTERNAL_DEPOSIT')}
                      className={`py-2 px-3 rounded-xl border text-xs font-mono font-bold cursor-pointer ${
                        contribFundingMode === 'EXTERNAL_DEPOSIT'
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 text-stone-600'
                      }`}
                    >
                      External Wallet Deposit
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingContrib || isAuthorizing}
                    className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Fingerprint className="w-4 h-4" />
                    <span>
                      {isSubmittingContrib || isAuthorizing
                        ? 'Authorizing & Routing to Earn...'
                        : `Confirm with Passkey & Mint ${contributeCircle.vaultSymbol}`}
                    </span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </Portal>
      )}

      {/* MODAL 3: SEND TIMELOCKED EARN VAULT GIFT */}
      {isCreateGiftOpen && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 backdrop-blur-xs p-4 overflow-y-auto">
            <div className="bg-white border border-stone-200 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-500 text-stone-950 flex items-center justify-center">
                    <Gift className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-display font-extrabold text-stone-950">
                      Gift a Timelocked Earn Vault
                    </h2>
                    <p className="text-xs text-stone-500">
                      1-to-1 to any @handle. Compounds yield until the unlock date.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateGiftOpen(false)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateGift} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                    Recipient 𝕏 Handle (Strictly @handle)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="@alice"
                    value={giftRecipient}
                    onChange={(e) => setGiftRecipient(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-mono focus:outline-none focus:border-stone-900"
                  />
                </div>

                {/* Occasion Selector */}
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1.5">
                    Occasion
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {OCCASION_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => {
                          setGiftOccasion(o.value);
                          setGiftTimelockLocal(defaultTimelockForOccasion(o.value));
                        }}
                        className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                          giftOccasion === o.value
                            ? 'border-stone-950 bg-stone-950 text-white'
                            : 'border-stone-200 hover:border-stone-300 text-stone-800'
                        }`}
                      >
                        <div className="text-xs font-display font-bold">
                          {o.emoji} {o.label}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Earn Vault Picker */}
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1.5">
                    Earn Vault Asset (Mandatory Yield Accrual)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {vaults.map((v) => (
                      <button
                        key={v.symbol}
                        type="button"
                        onClick={() => setGiftVaultSymbol(v.symbol)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          giftVaultSymbol === v.symbol
                            ? 'border-emerald-600 bg-emerald-50/70'
                            : 'border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display font-extrabold text-xs text-stone-950">
                            {v.symbol}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-emerald-700">
                            {v.estimatedApyPct}%
                          </span>
                        </div>
                        <div className="text-[10px] text-stone-500 truncate mt-0.5">
                          Min ${v.minDepositUsd}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payment Token & Amount */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                      Pay With
                    </label>
                    <select
                      value={giftOriginAsset}
                      onChange={(e) => setGiftOriginAsset(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-stone-300 text-xs font-mono bg-white"
                    >
                      {availableOriginAssets.map((a) => (
                        <option key={a.assetId} value={a.assetId}>
                          {a.symbol} ({a.balanceFormatted})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                      Amount
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      required
                      value={giftAmount}
                      onChange={(e) => setGiftAmount(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-mono"
                    />
                  </div>
                </div>

                {/* Live 1Click Earn Quote Preview */}
                {isQuotingGift ? (
                  <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono text-stone-500">
                    Fetching live 1Click Earn Vault quote...
                  </div>
                ) : (
                  giftQuote && (
                    <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between text-xs font-mono">
                      <span className="text-stone-700">Estimated Vault Shares:</span>
                      <span className="font-bold text-emerald-800">
                        ~{giftQuote.estimatedSharesOut} {giftQuote.vaultSymbol} (
                        {giftQuote.estimatedApyPct}% APY)
                      </span>
                    </div>
                  )
                )}

                {/* Unlock Date & Time */}
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                    Timelock Unlock Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={giftTimelockLocal}
                    onChange={(e) => setGiftTimelockLocal(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-stone-600 mb-1">
                    Personal Note (Shown on Unwrap)
                  </label>
                  <input
                    type="text"
                    maxLength={240}
                    placeholder="Happy Birthday! Enjoy the compounded yield 🎉"
                    value={giftMessage}
                    onChange={(e) => setGiftMessage(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-xs"
                  />
                </div>

                <label className="flex items-center gap-2.5 text-xs text-stone-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={giftShowAmount}
                    onChange={(e) => setGiftShowAmount(e.target.checked)}
                    className="rounded border-stone-300"
                  />
                  <span>
                    Show dollar amount on public SEO share card (Recipient always sees principal + live yield when signed in)
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmittingGift || isAuthorizing}
                  className="w-full py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Fingerprint className="w-4 h-4 text-amber-400" />
                  <span>
                    {isSubmittingGift || isAuthorizing
                      ? 'Authorizing & Minting Gift Vault...'
                      : `Confirm with Passkey & Lock ${giftVaultSymbol} Gift`}
                  </span>
                </button>
              </form>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
};
