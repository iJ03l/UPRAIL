'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from '../lib/router';
import {
  ArrowLeft,
  Record,
  Gift,
  Plus,
  Lock,
  LockOpen,
  Check,
  CaretDown,
  Copy,
  ArrowSquareOut,
  ArrowsClockwise,
  CircleNotch,
  Fingerprint,
  Users,
  TrendUp,
  Trash,
  ArrowUpRight,
  ShareNetwork,
  CheckCircle,
  Clock,
  ShieldCheck,
} from '@phosphor-icons/react';
import { api, formatUsd } from '../lib/api';
import { useXAuth } from '../hooks/useXAuth';
import { useOnchainData } from '../hooks/useOnchainData';
import { useToast } from '../components/Toast';
import { Badge } from '../components/Badge';
import { ModalSheet } from '../components/ModalSheet';
import {
  VaultRiskBadges,
  VaultRiskAckBox,
  getVaultRiskMeta,
  formatSignedUsdChange,
} from '../components/VaultRiskUI';
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
}> = [
  { value: 'CONTRIBUTIONS', label: 'Group Contributions' },
  { value: 'SHARED_GOAL', label: 'Shared Goal' },
  { value: 'RENT', label: 'Rent & Bills' },
  { value: 'TRIP', label: 'Group Trip & Travel' },
  { value: 'DAILY_TIP', label: 'Daily Goal Tip' },
  { value: 'SAVINGS_CLUB', label: 'Savings Circle' },
  { value: 'CUSTOM', label: 'Custom Reason...' },
];

const OCCASION_OPTIONS: Array<{
  value: GiftOccasion;
  label: string;
  presetDays?: number;
  fixedMonthDay?: { month: number; day: number };
}> = [
  { value: 'BIRTHDAY', label: 'Birthday', presetDays: 7 },
  { value: 'CHRISTMAS', label: 'Christmas', fixedMonthDay: { month: 11, day: 25 } },
  { value: 'NEW_YEAR', label: 'New Year', fixedMonthDay: { month: 0, day: 1 } },
  { value: 'ANNIVERSARY', label: 'Anniversary', presetDays: 14 },
  { value: 'GRADUATION', label: 'Graduation', presetDays: 30 },
  { value: 'WEDDING', label: 'Wedding', presetDays: 30 },
  { value: 'THANK_YOU', label: 'Thank You', presetDays: 1 },
  { value: 'JUST_BECAUSE', label: 'Surprise Gift', presetDays: 3 },
  { value: 'CUSTOM', label: 'Custom Occasion...', presetDays: 7 },
];

function formatCentsUsd(cents: number | undefined | null): string {
  if (cents === undefined || cents === null || !Number.isFinite(cents)) return '$0.00';
  return formatUsd(cents / 100);
}

function truncateDecimals(raw: string | number | undefined | null, maxDecimals = 5): string {
  if (raw === undefined || raw === null) return '0';
  const s = String(raw).trim();
  if (!s) return '0';
  const dot = s.indexOf('.');
  if (dot === -1) return s;
  const intPart = s.slice(0, dot);
  const fracPart = s.slice(dot + 1);
  if (fracPart.length <= maxDecimals) return s;
  const trimmed = fracPart.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmed.length > 0 ? `${intPart}.${trimmed}` : intPart;
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

function distributeEvenPercentages(
  members: Array<{ handle: string; percentage: string }>
): Array<{ handle: string; percentage: string }> {
  const count = members.length;
  if (count === 0) return [];
  if (count === 1) {
    return [{ ...members[0], percentage: '100' }];
  }
  const baseBps = Math.floor(10000 / count);
  const remBps = 10000 - baseBps * count;
  return members.map((m, idx) => ({
    ...m,
    percentage: ((baseBps + (idx === count - 1 ? remBps : 0)) / 100)
      .toFixed(2)
      .replace(/\.00$/, ''),
  }));
}

interface StyledSelectOption<T extends string> {
  value: T;
  label: string;
  badge?: string;
}

function StyledSelect<T extends string>({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  mono = false,
}: {
  value: T;
  options: Array<StyledSelectOption<T>>;
  onChange: (value: T) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value) || options[0] || null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full px-3.5 py-2.5 rounded-xl border bg-white text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
          open
            ? 'border-stone-900 ring-2 ring-stone-900/10'
            : 'border-stone-300 hover:border-stone-400'
        } ${mono ? 'font-mono text-xs' : 'text-sm font-medium'}`}
      >
        <span className="truncate text-stone-950">
          {selected ? selected.label : placeholder}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {selected?.badge && <Badge tone="ok">{selected.badge}</Badge>}
          <CaretDown weight="fill"
            className={`w-4 h-4 text-stone-400 transition-transform duration-150 ${
              open ? 'rotate-180 text-stone-800' : ''
            }`}
          />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-1.5 rounded-xl border border-stone-200 bg-white shadow-xl py-1 max-h-60 overflow-y-auto z-50"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-3.5 py-2 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-stone-100 text-stone-950 font-semibold'
                    : 'text-stone-700 hover:bg-stone-50'
                } ${mono ? 'font-mono text-xs' : 'text-sm'}`}
              >
                <span className="truncate">{opt.label}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {opt.badge && <Badge tone="ok">{opt.badge}</Badge>}
                  {isSelected && <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


export const CirclesView: React.FC = () => {
  const { user } = useXAuth();
  const { balances, refresh: refreshOnchain } = useOnchainData();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'circles' | 'gifts'>('circles');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'gifts') setActiveTab('gifts');
    }
  }, []);
  const [vaults, setVaults] = useState<EarnVaultDescriptor[]>([]);
  const [circles, setCircles] = useState<CircleView[]>([]);
  const [sentGifts, setSentGifts] = useState<AuthenticatedGiftView[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<AuthenticatedGiftView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Modals state
  const [isCreateCircleOpen, setIsCreateCircleOpen] = useState(false);
  const [isCreateGiftOpen, setIsCreateGiftOpen] = useState(false);
  const [contributeCircle, setContributeCircle] = useState<CircleView | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create Circle form state — defaults to solo creator at 100% and USD-stable Core vault (gtUSDCp)
  const [circleName, setCircleName] = useState('');
  const [circlePurpose, setCirclePurpose] = useState<CirclePurpose>('SHARED_GOAL');
  const [circleCustomPurpose, setCircleCustomPurpose] = useState('');
  const [circleTargetUsd, setCircleTargetUsd] = useState('500');
  const [circleVaultSymbol, setCircleVaultSymbol] = useState<EarnVaultSymbol>('gtUSDCp');
  const [circleRiskAck, setCircleRiskAck] = useState(false);
  const [circleMembers, setCircleMembers] = useState<Array<{ handle: string; percentage: string }>>([
    { handle: user?.handle || '', percentage: '100' },
  ]);
  const [isSubmittingCircle, setIsSubmittingCircle] = useState(false);
  const [circleStepMsg, setCircleStepMsg] = useState<string | null>(null);

  // Contribute form state
  const [contribOriginAsset, setContribOriginAsset] = useState('');
  const [contribAmount, setContribAmount] = useState('');
  const [contribRiskAck, setContribRiskAck] = useState(false);
  const [isSubmittingContrib, setIsSubmittingContrib] = useState(false);
  const [contribStepMsg, setContribStepMsg] = useState<string | null>(null);
  const [isActionBusyId, setIsActionBusyId] = useState<string | null>(null);
  const [actionBusyKind, setActionBusyKind] = useState<
    'join' | 'settle' | 'dissolve' | 'claim' | 'reclaim' | null
  >(null);
  const [actionStepMsg, setActionStepMsg] = useState<string | null>(null);
  const passkeyBusyRef = useRef(false);

  // Create Gift form state — defaults to USD-stable Core vault (gtUSDCp)
  const [giftRecipient, setGiftRecipient] = useState('');
  const [giftOccasion, setGiftOccasion] = useState<GiftOccasion>('BIRTHDAY');
  const [giftCustomOccasion, setGiftCustomOccasion] = useState('');
  const [giftMessage, setGiftMessage] = useState('');
  const [giftVaultSymbol, setGiftVaultSymbol] = useState<EarnVaultSymbol>('gtUSDCp');
  const [giftRiskAck, setGiftRiskAck] = useState(false);
  const [giftOriginAsset, setGiftOriginAsset] = useState('');
  const [giftAmount, setGiftAmount] = useState('25');
  const [giftStepMsg, setGiftStepMsg] = useState<string | null>(null);
  const [giftTimelockLocal, setGiftTimelockLocal] = useState(() =>
    defaultTimelockForOccasion('BIRTHDAY')
  );
  const [giftQuote, setGiftQuote] = useState<GiftQuoteResult | null>(null);
  const [isQuotingGift, setIsQuotingGift] = useState(false);
  const [isSubmittingGift, setIsSubmittingGift] = useState(false);

  // Require fresh conscious confirmation whenever the user switches to a different vault or reopens a modal
  useEffect(() => {
    setCircleRiskAck(false);
  }, [circleVaultSymbol, isCreateCircleOpen]);

  useEffect(() => {
    setContribRiskAck(false);
  }, [contributeCircle?.id]);

  useEffect(() => {
    setGiftRiskAck(false);
  }, [giftVaultSymbol, isCreateGiftOpen]);

  // Live 1-second ticker for gift countdowns
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync creator handle into default Circle form when user loads, and enforce 100% if solo
  useEffect(() => {
    if (user?.handle) {
      setCircleMembers((prev) => {
        if (prev.length === 1) {
          return [{ handle: prev[0].handle || user.handle, percentage: '100' }];
        }
        if (prev.length > 0 && !prev[0].handle) {
          const next = [...prev];
          next[0] = { ...next[0], handle: user.handle };
          return next;
        }
        return prev;
      });
    }
  }, [user?.handle]);

  // Whenever there is only 1 member in the Circle form, automatically lock percentage to 100%
  useEffect(() => {
    if (circleMembers.length === 1 && circleMembers[0].percentage !== '100') {
      setCircleMembers([{ ...circleMembers[0], percentage: '100' }]);
    }
  }, [circleMembers]);

  // Both Circles and Vault Gifts are strictly USDC-only.
  const availableOriginAssets = useMemo(() => {
    const usdcId = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
    const nativeUsdc = balances.find((b) => {
      const sym = (b.symbol || '').toUpperCase();
      const id = (b.defuse_asset_id || '').toLowerCase();
      const cid = (b.nearContractId || '').toLowerCase();
      return (
        sym === 'USDC' &&
        (id === usdcId ||
          cid === '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1' ||
          id.includes('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'))
      );
    });
    const anyUsdc =
      nativeUsdc && parseFloat(nativeUsdc.amountFormatted || '0') > 0
        ? nativeUsdc
        : balances.find(
            (b) => (b.symbol || '').toUpperCase() === 'USDC' && parseFloat(b.amountFormatted || '0') > 0
          ) || nativeUsdc;
    return [
      {
        assetId: (anyUsdc?.defuse_asset_id || usdcId),
        symbol: 'USDC',
        balanceFormatted: truncateDecimals(anyUsdc?.amountFormatted || '0.00', 5),
        priceUsd:
          typeof anyUsdc?.priceUsd === 'number' && anyUsdc.priceUsd > 0 ? anyUsdc.priceUsd : 1,
        chain: 'near',
      },
    ];
  }, [balances]);

  useEffect(() => {
    if (availableOriginAssets.length > 0) {
      const usdcAssetId = availableOriginAssets[0].assetId;
      if (giftOriginAsset !== usdcAssetId) setGiftOriginAsset(usdcAssetId);
      if (contribOriginAsset !== usdcAssetId) setContribOriginAsset(usdcAssetId);
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

  const [resolvedProfiles, setResolvedProfiles] = useState<
    Record<string, { loading: boolean; exists: boolean; avatarUrl?: string; name?: string }>
  >({});

  // Resolve user avatars for @handle inputs across Circle and Gift modals
  useEffect(() => {
    if (!isCreateCircleOpen && !isCreateGiftOpen) return;
    const handlesToResolve = new Set<string>();

    if (isCreateCircleOpen) {
      for (const m of circleMembers) {
        const clean = m.handle.trim().replace(/^@+/, '').toLowerCase();
        if (/^[a-z0-9_]{1,15}$/.test(clean)) {
          handlesToResolve.add(clean);
        }
      }
    }
    if (isCreateGiftOpen) {
      const cleanGift = giftRecipient.trim().replace(/^@+/, '').toLowerCase();
      if (/^[a-z0-9_]{1,15}$/.test(cleanGift)) {
        handlesToResolve.add(cleanGift);
      }
    }

    const pending: string[] = [];
    for (const h of handlesToResolve) {
      if (user?.handle && h === user.handle.toLowerCase() && user.avatarUrl) {
        if (!resolvedProfiles[h] || resolvedProfiles[h].loading) {
          setResolvedProfiles((prev) => ({
            ...prev,
            [h]: {
              loading: false,
              exists: true,
              avatarUrl: user.avatarUrl,
              name: user.name,
            },
          }));
        }
        continue;
      }
      if (!resolvedProfiles[h]) {
        pending.push(h);
      }
    }

    if (pending.length === 0) return;

    const timer = setTimeout(() => {
      for (const h of pending) {
        setResolvedProfiles((prev) => ({
          ...prev,
          [h]: { loading: true, exists: true },
        }));
        api
          .resolveHandle(h)
          .then((res) => {
            setResolvedProfiles((prev) => ({
              ...prev,
              [h]: {
                loading: false,
                exists: res.exists !== false,
                avatarUrl: res.avatarUrl || `https://unavatar.io/x/${h}`,
                name: res.name,
              },
            }));
          })
          .catch(() => {
            setResolvedProfiles((prev) => ({
              ...prev,
              [h]: { loading: false, exists: false },
            }));
          });
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [isCreateCircleOpen, isCreateGiftOpen, circleMembers, giftRecipient, user, resolvedProfiles]);

  const totalMemberPercentage = useMemo(() => {
    if (circleMembers.length === 1) return 100;
    return circleMembers.reduce((acc, m) => acc + (parseFloat(m.percentage) || 0), 0);
  }, [circleMembers]);

  const selectedCircleVault = useMemo(
    () => vaults.find((v) => v.symbol === circleVaultSymbol) || vaults[0],
    [vaults, circleVaultSymbol]
  );

  const selectedGiftVault = useMemo(
    () => vaults.find((v) => v.symbol === giftVaultSymbol) || vaults[0],
    [vaults, giftVaultSymbol]
  );

  const circleValidation = useMemo(() => {
    if (user?.custodyMode !== 'self') {
      return {
        isValid: false,
        hint: 'Enable Passkey Self-Custody in Settings to launch a Vault Circle.',
      };
    }
    const trimmedName = circleName.trim();
    if (trimmedName.length < 2) {
      return { isValid: false, hint: 'Enter a Circle name (at least 2 characters).' };
    }
    if (circlePurpose === 'CUSTOM' && circleCustomPurpose.trim().length < 2) {
      return { isValid: false, hint: 'Enter a custom reason (at least 2 characters).' };
    }
    const targetNum = parseFloat(circleTargetUsd);
    const minTarget = selectedCircleVault?.minDepositUsd || 10;
    if (!Number.isFinite(targetNum) || targetNum < minTarget || targetNum > 1_000_000) {
      return {
        isValid: false,
        hint: `Target goal must be at least $${minTarget} USD for ${selectedCircleVault?.name || 'this vault'}.`,
      };
    }
    if (!circleVaultSymbol) {
      return { isValid: false, hint: 'Select an Intents Earn Vault.' };
    }
    const effective =
      circleMembers.length === 1
        ? [{ ...circleMembers[0], percentage: '100' }]
        : circleMembers;
    if (effective.length < 1 || effective.length > 25) {
      return { isValid: false, hint: 'Circle must have between 1 and 25 participants.' };
    }
    const seen = new Set<string>();
    for (const m of effective) {
      const cleanH = m.handle.trim().replace(/^@+/, '').toLowerCase();
      if (!cleanH || !/^[a-z0-9_]{1,15}$/.test(cleanH)) {
        return {
          isValid: false,
          hint: 'Every participant must have a valid @handle (1–15 letters, numbers, or _).',
        };
      }
      if (seen.has(cleanH)) {
        return { isValid: false, hint: `Duplicate participant @${cleanH}.` };
      }
      seen.add(cleanH);
      const prof = resolvedProfiles[cleanH];
      if (prof && !prof.loading && !prof.exists) {
        return { isValid: false, hint: `Account @${cleanH} was not found on X.` };
      }
      const pct = parseFloat(m.percentage);
      if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
        return { isValid: false, hint: `Each participant share must be between 1% and 100%.` };
      }
    }
    const sum = effective.reduce((acc, m) => acc + (parseFloat(m.percentage) || 0), 0);
    if (Math.abs(sum - 100) > 0.01) {
      return {
        isValid: false,
        hint: `Participant shares must sum to exactly 100% (currently ${sum.toFixed(2)}%).`,
      };
    }
    if (getVaultRiskMeta(selectedCircleVault).requiresRiskAck && !circleRiskAck) {
      return {
        isValid: false,
        hint: `Confirm ${selectedCircleVault?.symbol || circleVaultSymbol} is volatile.`,
      };
    }
    return { isValid: true, hint: null };
  }, [
    user?.custodyMode,
    circleName,
    circlePurpose,
    circleCustomPurpose,
    circleTargetUsd,
    selectedCircleVault,
    circleVaultSymbol,
    circleRiskAck,
    circleMembers,
    resolvedProfiles,
  ]);

  const selectedContribVault = useMemo(
    () =>
      contributeCircle
        ? vaults.find((v) => v.symbol === contributeCircle.vaultSymbol) || null
        : null,
    [vaults, contributeCircle]
  );

  const contribValidation = useMemo(() => {
    if (!contributeCircle) return { isValid: false, hint: null };
    if (!contribOriginAsset) {
      return { isValid: false, hint: 'Select a payment token.' };
    }
    const amt = parseFloat(contribAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { isValid: false, hint: 'Enter a valid amount to add.' };
    }
    const circleVault = selectedContribVault;
    const minUsd = circleVault?.minDepositUsd || 5;
    const originObj = availableOriginAssets.find((a) => a.assetId === contribOriginAsset);
    const unitPrice = originObj?.priceUsd ?? 1;
    const estUsd = amt * unitPrice;
    if (estUsd + 1e-6 < minUsd) {
      return {
        isValid: false,
        hint: `Minimum deposit for ${contributeCircle.vaultSymbol} is $${minUsd} USD (currently ~$${estUsd.toFixed(2)}).`,
      };
    }
    const availBal = originObj ? parseFloat(originObj.balanceFormatted || '0') : 0;
    if (originObj && amt > availBal + 1e-6) {
      return {
        isValid: false,
        hint: `Insufficient ${originObj.symbol} balance (${originObj.balanceFormatted} available).`,
      };
    }
    if (circleVault && getVaultRiskMeta(circleVault).requiresRiskAck && !contribRiskAck) {
      return {
        isValid: false,
        hint: `Confirm ${contributeCircle.vaultSymbol} is volatile.`,
      };
    }
    return { isValid: true, hint: null };
  }, [
    contributeCircle,
    selectedContribVault,
    contribOriginAsset,
    contribAmount,
    contribRiskAck,
    availableOriginAssets,
  ]);

  const giftValidation = useMemo(() => {
    if (user?.custodyMode !== 'self') {
      return {
        isValid: false,
        hint: 'Enable Passkey Self-Custody in Settings to send an Earn Gift.',
      };
    }
    const cleanRecip = giftRecipient.trim().replace(/^@+/, '');
    if (!cleanRecip) {
      return { isValid: false, hint: 'Enter a recipient @handle.' };
    }
    if (cleanRecip.includes('.') || !/^[A-Za-z0-9_]{1,15}$/.test(cleanRecip)) {
      return {
        isValid: false,
        hint: 'Enter a valid X @handle (1–15 letters, numbers, or _), not a wallet address.',
      };
    }
    const cleanLower = cleanRecip.toLowerCase();
    if (user?.handle && cleanLower === user.handle.toLowerCase()) {
      return { isValid: false, hint: 'Choose another @handle (cannot gift to yourself).' };
    }
    const prof = resolvedProfiles[cleanLower];
    if (prof && !prof.loading && !prof.exists) {
      return { isValid: false, hint: `Account @${cleanLower} was not found on X.` };
    }
    if (giftOccasion === 'CUSTOM' && giftCustomOccasion.trim().length < 2) {
      return { isValid: false, hint: 'Enter a custom occasion (at least 2 characters).' };
    }
    if (!giftVaultSymbol || !giftOriginAsset) {
      return { isValid: false, hint: 'Select a vault and payment token.' };
    }
    const amt = parseFloat(giftAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { isValid: false, hint: 'Enter a valid gift amount.' };
    }
    const minUsd = selectedGiftVault?.minDepositUsd || 5;
    const originObj = availableOriginAssets.find((a) => a.assetId === giftOriginAsset);
    const unitPrice = originObj?.priceUsd ?? 1;
    const estUsd = amt * unitPrice;
    if (estUsd + 1e-6 < minUsd) {
      return {
        isValid: false,
        hint: `Minimum deposit for ${selectedGiftVault?.symbol || giftVaultSymbol} is $${minUsd} USD (currently ~$${estUsd.toFixed(2)}).`,
      };
    }
    const availBal = originObj ? parseFloat(originObj.balanceFormatted || '0') : 0;
    if (originObj && amt > availBal + 1e-6) {
      return {
        isValid: false,
        hint: `Insufficient ${originObj.symbol} balance (${originObj.balanceFormatted} available).`,
      };
    }
    const unlockMs = new Date(giftTimelockLocal).getTime();
    if (!Number.isFinite(unlockMs) || unlockMs <= Date.now() + 60_000) {
      return { isValid: false, hint: 'Select an unlock date & time in the future.' };
    }
    if (getVaultRiskMeta(selectedGiftVault).requiresRiskAck && !giftRiskAck) {
      return {
        isValid: false,
        hint: `Confirm ${selectedGiftVault?.symbol || giftVaultSymbol} is volatile.`,
      };
    }
    return { isValid: true, hint: null };
  }, [
    user?.custodyMode,
    giftRecipient,
    user?.handle,
    resolvedProfiles,
    giftOccasion,
    giftCustomOccasion,
    giftVaultSymbol,
    selectedGiftVault,
    giftRiskAck,
    giftOriginAsset,
    giftAmount,
    availableOriginAssets,
    giftTimelockLocal,
  ]);

  const splitMembersEvenly = () => {
    setCircleMembers((prev) => distributeEvenPercentages(prev));
  };

  const handleAddMemberRow = () => {
    setCircleMembers((prev) => distributeEvenPercentages([...prev, { handle: '', percentage: '0' }]));
  };

  const handleRemoveMemberRow = (idx: number) => {
    setCircleMembers((prev) => {
      const filtered = prev.filter((_, i) => i !== idx);
      if (filtered.length === 1) {
        return [{ ...filtered[0], percentage: '100' }];
      }
      return filtered;
    });
  };

  const handleCopyLink = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast('Link copied to clipboard', 'success');
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
  };

  const anyActionBusy =
    Boolean(isActionBusyId) ||
    isSubmittingCircle ||
    isSubmittingContrib ||
    isSubmittingGift;

  const handleCreateCircle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passkeyBusyRef.current) return;
    if (!circleValidation.isValid) {
      if (circleValidation.hint) toast(circleValidation.hint, 'error');
      return;
    }
    const effectiveMembers =
      circleMembers.length === 1
        ? [{ ...circleMembers[0], percentage: '100' }]
        : circleMembers;

    const sumPct = effectiveMembers.reduce((acc, m) => acc + (parseFloat(m.percentage) || 0), 0);
    if (Math.abs(sumPct - 100) > 0.01) {
      toast(
        `Member allocations must equal 100% (currently ${sumPct.toFixed(2)}%).`,
        'error'
      );
      return;
    }
    if (circlePurpose === 'CUSTOM' && circleCustomPurpose.trim().length < 2) {
      toast('Enter a custom reason for this Circle.', 'error');
      return;
    }

    passkeyBusyRef.current = true;
    setIsSubmittingCircle(true);
    setCircleStepMsg('Preparing Circle contract…');
    try {
      const cleanMembers = effectiveMembers.map((m) => ({
        handle: m.handle.trim().replace(/^@+/, ''),
        percentageShare: parseFloat(m.percentage),
      }));
      if (user?.custodyMode !== 'self') {
        toast('Enable Passkey Self-Custody in Settings to launch a Vault Circle.', 'error');
        return;
      }
      const created = await api.createCircleSelfCustody(
        {
          name: circleName.trim(),
          purpose: circlePurpose,
          customPurpose:
            circlePurpose === 'CUSTOM' ? circleCustomPurpose.trim() : undefined,
          targetAmountUsd: parseFloat(circleTargetUsd),
          vaultAsset: circleVaultSymbol,
          payoutHandle: user?.handle,
          members: cleanMembers,
          mode: 'contract',
        },
        (_stage, msg) => setCircleStepMsg(msg)
      );
      setCircles((prev) => [created, ...prev]);
      setIsCreateCircleOpen(false);
      setCircleName('');
      setCircleCustomPurpose('');
      toast(
        `${created.name} is live in ${created.vaultSymbol}! Participants can sign & add funds at any time.`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not create Circle. Check member handles and try again.', 'error');
    } finally {
      passkeyBusyRef.current = false;
      setIsSubmittingCircle(false);
      setCircleStepMsg(null);
    }
  };

  const handleJoinCircle = async (circle: CircleView) => {
    if (passkeyBusyRef.current) return;
    if (user && user.custodyMode !== 'self') {
      toast('Please complete Passkey Self-Custody migration first.', 'error');
      return;
    }
    passkeyBusyRef.current = true;
    setIsActionBusyId(circle.id);
    setActionBusyKind('join');
    setActionStepMsg('Preparing Circle signature…');
    try {
      const updated = await api.joinCircleSelfCustody(circle.id, (_stage, msg) =>
        setActionStepMsg(msg)
      );
      setCircles((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      toast(
        `Signed & joined ${updated.name}! You can add funds to your share at any point.`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not sign into Circle.', 'error');
    } finally {
      passkeyBusyRef.current = false;
      setIsActionBusyId(null);
      setActionBusyKind(null);
      setActionStepMsg(null);
    }
  };

  const handleContribute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contributeCircle || passkeyBusyRef.current) return;
    if (user && user.custodyMode !== 'self') {
      toast('Please complete Passkey Self-Custody migration first.', 'error');
      return;
    }
    passkeyBusyRef.current = true;
    setIsSubmittingContrib(true);
    setContribStepMsg('Preparing vault deposit…');
    try {
      const res = await api.contributeToCircleSelfCustody(
        {
          circleId: contributeCircle.id,
          originAsset: contribOriginAsset,
          amount: contribAmount.trim(),
        },
        (_stage, message) => setContribStepMsg(message)
      );
      setCircles((prev) => prev.map((c) => (c.id === res.circle.id ? res.circle : c)));
      setContributeCircle(null);
      setContribAmount('');
      refreshOnchain();
      const addedLabel = truncateDecimals(
        (res as any).sharesAddedFormatted || (res as any).sharesAdded || contribAmount.trim(),
        5
      );
      toast(
        (res as any).status === 'PENDING_FUNDING'
          ? `Contribution submitted to ${res.circle.name}; awaiting vault settlement.`
          : `Added ${addedLabel} ${res.circle.vaultSymbol} into ${res.circle.name}!`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Unable to process Circle contribution.', 'error');
    } finally {
      passkeyBusyRef.current = false;
      setIsSubmittingContrib(false);
      setContribStepMsg(null);
    }
  };

  const handleSettleCircle = async (circle: CircleView) => {
    if (passkeyBusyRef.current) return;
    if (user && user.custodyMode !== 'self') {
      toast('Please complete Passkey Self-Custody migration first.', 'error');
      return;
    }
    passkeyBusyRef.current = true;
    setIsActionBusyId(circle.id);
    setActionBusyKind('settle');
    setActionStepMsg('Preparing Circle settlement…');
    try {
      const res = await api.settleCircleSelfCustody(circle.id, (_stage, msg) =>
        setActionStepMsg(msg)
      );
      setCircles((prev) => prev.map((c) => (c.id === res.circle.id ? res.circle : c)));
      refreshOnchain();
      const settledLabel = truncateDecimals(
        (res as any).sharesSettledFormatted || (res as any).payoutShares,
        5
      );
      const settledPayout = (res as any).payoutHandle || circle.payoutHandle;
      toast(
        `Settled ${settledLabel} ${circle.vaultSymbol} (principal + yield) to @${settledPayout}!`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not settle Circle.', 'error');
    } finally {
      passkeyBusyRef.current = false;
      setIsActionBusyId(null);
      setActionBusyKind(null);
      setActionStepMsg(null);
    }
  };

  const handleDissolveCircle = async (circle: CircleView) => {
    if (passkeyBusyRef.current) return;
    if (user && user.custodyMode !== 'self') {
      toast('Please complete Passkey Self-Custody migration first.', 'error');
      return;
    }
    passkeyBusyRef.current = true;
    setIsActionBusyId(circle.id);
    setActionBusyKind('dissolve');
    setActionStepMsg('Preparing Circle dissolve…');
    try {
      const res = await api.dissolveCircleSelfCustody(circle.id, (_stage, msg) =>
        setActionStepMsg(msg)
      );
      setCircles((prev) => prev.map((c) => (c.id === res.circle.id ? res.circle : c)));
      refreshOnchain();
      if (res.circle.status === 'DISSOLVED') {
        toast(
          `All contributors signed! Circle dissolved — refunded vault shares + yield to ${res.refundedMembers} contributor(s).`,
          'info'
        );
      } else {
        const signed = res.circle.dissolveApprovalsCount ?? 1;
        const required = res.circle.dissolveRequiredCount ?? 1;
        toast(
          `Dissolve activated (${signed}/${required} contributors signed). All contributors must sign to dissolve.`,
          'info'
        );
      }
    } catch (err: any) {
      toast(err?.message || 'Could not activate Circle dissolve.', 'error');
    } finally {
      passkeyBusyRef.current = false;
      setIsActionBusyId(null);
      setActionBusyKind(null);
      setActionStepMsg(null);
    }
  };

  const handleCreateGift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passkeyBusyRef.current) return;
    const cleanRecip = giftRecipient.trim().replace(/^@+/, '');
    if (!cleanRecip || cleanRecip.includes('.')) {
      toast(
        'Gifts must be sent to an @handle, never a wallet address.',
        'error'
      );
      return;
    }
    if (giftOccasion === 'CUSTOM' && giftCustomOccasion.trim().length < 2) {
      toast('Enter a custom occasion for this gift.', 'error');
      return;
    }
    const unlockMs = new Date(giftTimelockLocal).getTime();
    if (!Number.isFinite(unlockMs) || unlockMs <= Date.now() + 60_000) {
      toast('Pick a future date & time for the gift unlock.', 'error');
      return;
    }

    if (user?.custodyMode !== 'self') {
      toast('Please complete Passkey Self-Custody migration first.', 'error');
      return;
    }

    passkeyBusyRef.current = true;
    setIsSubmittingGift(true);
    setGiftStepMsg('Preparing timelocked gift vault…');
    try {
      const created = await api.createGiftSelfCustody(
        {
          recipientHandle: cleanRecip,
          occasion: giftOccasion,
          customOccasion:
            giftOccasion === 'CUSTOM' ? giftCustomOccasion.trim() : undefined,
          message: giftMessage.trim() || undefined,
          showAmount: false,
          vaultAsset: giftVaultSymbol,
          originAsset: giftOriginAsset,
          amount: giftAmount.trim(),
          timelockUntil: unlockMs,
          mode: 'contract',
        },
        (_stage, message) => setGiftStepMsg(message)
      );
      setSentGifts((prev) => [created, ...prev]);
      setIsCreateGiftOpen(false);
      setGiftRecipient('');
      setGiftCustomOccasion('');
      setGiftMessage('');
      setGiftAmount('');
      setActiveTab('gifts');
      refreshOnchain();
      toast(
        `Gifted ${created.vaultSymbol} (${created.estimatedApyPct}% APY) to @${created.recipientHandle}!`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not create gift. Check balance and @handle.', 'error');
    } finally {
      passkeyBusyRef.current = false;
      setIsSubmittingGift(false);
      setGiftStepMsg(null);
    }
  };

  const handleClaimGift = async (gift: AuthenticatedGiftView) => {
    if (passkeyBusyRef.current) return;
    if (user && user.custodyMode !== 'self') {
      toast('Please complete Passkey Self-Custody migration first.', 'error');
      return;
    }
    passkeyBusyRef.current = true;
    const myHandle = (user?.handle || '').toLowerCase();
    const isSenderReclaim =
      gift.role === 'SENDER' ||
      Boolean(
        gift.senderCanReclaim &&
          myHandle === gift.senderHandle.toLowerCase() &&
          myHandle !== gift.recipientHandle.toLowerCase()
      );
    setIsActionBusyId(gift.id);
    setActionBusyKind(isSenderReclaim ? 'reclaim' : 'claim');
    setActionStepMsg(
      isSenderReclaim ? 'Preparing vault reclaim…' : 'Preparing timelocked vault unlock…'
    );
    const applyGiftUpdate = (updated: AuthenticatedGiftView) => {
      setReceivedGifts((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      setSentGifts((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
    };
    try {
      if (isSenderReclaim) {
        const res = await api.reclaimGiftSelfCustody(gift.id, (_stage, msg) =>
          setActionStepMsg(msg)
        );
        applyGiftUpdate(
          res.gift || {
            ...gift,
            status: 'RECLAIMED',
            canClaim: false,
            senderCanReclaim: false,
          }
        );
        refreshOnchain();
        toast(`Reclaimed ${gift.vaultSymbol} gift back to your vault!`, 'success');
      } else {
        const res = await api.claimGiftSelfCustody(gift.id, (_stage, msg) =>
          setActionStepMsg(msg)
        );
        applyGiftUpdate(res.gift);
        refreshOnchain();
        if (res.payoutAsset === 'USDC') {
          toast(
            res.usdcSwapStatus === 'SUCCESS'
              ? `Unwrapped & converted gift to ${res.usdcAmount} USDC!`
              : `Claimed & converting ${res.sharesClaimed} ${res.gift.vaultSymbol} → ~${res.usdcAmount} USDC!`,
            'success'
          );
        } else if (res.usdcSwapNote) {
          toast(
            `Unwrapped ${res.sharesClaimed} ${res.gift.vaultSymbol} to your wallet. Stabilize to USDC anytime.`,
            'success'
          );
        } else {
          toast(
            `Unwrapped ${res.sharesClaimed} ${res.gift.vaultSymbol} (principal + yield) into your vault!`,
            'success'
          );
        }
      }
    } catch (err: any) {
      toast(
        err?.message ||
          (isSenderReclaim ? 'Could not reclaim gift.' : 'Could not unwrap gift.'),
        'error'
      );
    } finally {
      passkeyBusyRef.current = false;
      setIsActionBusyId(null);
      setActionBusyKind(null);
      setActionStepMsg(null);
    }
  };

  const activeReceivedGifts = useMemo(
    () => receivedGifts.filter((g) => g.status === 'LOCKED'),
    [receivedGifts]
  );
  const activeSentGifts = useMemo(
    () => sentGifts.filter((g) => g.status === 'LOCKED'),
    [sentGifts]
  );
  const activeGiftCount = useMemo(
    () => new Set([...activeReceivedGifts, ...activeSentGifts].map((g) => g.id)).size,
    [activeReceivedGifts, activeSentGifts]
  );
  const giftHistory = useMemo(() => {
    const byId = new Map<string, AuthenticatedGiftView>();
    for (const g of [...receivedGifts, ...sentGifts]) {
      if (g.status === 'CLAIMED' || g.status === 'RECLAIMED') {
        byId.set(g.id, g);
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) =>
        (b.claimedAt || b.timelockUntil || b.createdAt || 0) -
        (a.claimedAt || a.timelockUntil || a.createdAt || 0)
    );
  }, [receivedGifts, sentGifts]);

  // Summary metrics (only active open Circles and active LOCKED Gifts)
  const activeUniqueGifts = useMemo(() => {
    const byId = new Map<string, AuthenticatedGiftView>();
    for (const g of [...activeReceivedGifts, ...activeSentGifts]) {
      byId.set(g.id, g);
    }
    return Array.from(byId.values());
  }, [activeReceivedGifts, activeSentGifts]);

  const activeOpenCircles = useMemo(
    () =>
      circles.filter(
        (c) =>
          c.status === 'PENDING_SIGNATURES' ||
          c.status === 'ACTIVE' ||
          c.status === 'GOAL_MET'
      ),
    [circles]
  );

  const totalCirclesPrincipalCents = useMemo(
    () =>
      activeOpenCircles.reduce(
        (acc, c) => acc + (c.contributedUsdCents ?? c.totalContributedUsdCents ?? 0),
        0
      ) + activeUniqueGifts.reduce((acc, g) => acc + (g.principalUsdCents || 0), 0),
    [activeOpenCircles, activeUniqueGifts]
  );
  const totalCirclesYieldCents = useMemo(
    () => activeOpenCircles.reduce((acc, c) => acc + (c.yieldUsdCents || 0), 0),
    [activeOpenCircles]
  );
  const totalGiftsYieldCents = useMemo(
    () => activeUniqueGifts.reduce((acc, g) => acc + (g.yieldUsdCents || 0), 0),
    [activeUniqueGifts]
  );

  const myMemberInContribCircle = useMemo(() => {
    if (!contributeCircle) return null;
    const myHandle = (user?.handle || '').toLowerCase();
    return (
      contributeCircle.members.find(
        (m) => m.isCurrentUser || (myHandle && m.handle.toLowerCase() === myHandle)
      ) || null
    );
  }, [contributeCircle, user?.handle]);

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
            <ArrowLeft weight="bold" className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-display font-extrabold text-stone-950 tracking-tight">
                Circles & Earn Gifting
              </h1>
            </div>
            <p className="text-xs text-[var(--fg-muted)]">
              Save toward a goal with friends, or gift a locked vault.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateGiftOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-900 text-xs font-display font-bold transition-all cursor-pointer shadow-2xs"
          >
            <Gift weight="fill" className="w-3.5 h-3.5 text-amber-600" />
            <span>Gift a Vault</span>
          </button>
          <button
            type="button"
            onClick={() => setIsCreateCircleOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-all cursor-pointer shadow-xs"
          >
            <Plus weight="bold" className="w-3.5 h-3.5" />
            <span>New Circle</span>
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs + Live Yield Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-3">
        <div className="inline-flex p-1 rounded-xl bg-stone-100 border border-stone-200 self-start">
          <button
            type="button"
            onClick={() => setActiveTab('circles')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-display font-bold transition-all cursor-pointer ${
              activeTab === 'circles'
                ? 'bg-stone-950 text-white shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Users weight="fill" className="w-3.5 h-3.5" />
            <span>Earn Circles ({circles.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gifts')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-display font-bold transition-all cursor-pointer ${
              activeTab === 'gifts'
                ? 'bg-stone-950 text-white shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Gift weight="fill" className="w-3.5 h-3.5" />
            <span>Timelocked Gifts ({activeGiftCount})</span>
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
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 text-emerald-600 flex items-center justify-center mx-auto">
                <Users weight="fill" className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-display font-bold text-stone-950">
                  No Active Circles Yet
                </h3>
                <p className="text-xs text-stone-500 leading-relaxed">
                  Start a Circle solo (automatically 100%) or invite @handles with custom percentage shares.
                  Every participant signs with their passkey and can add funds repeatedly at any point.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateCircleOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-all cursor-pointer"
              >
                <Plus weight="bold" className="w-4 h-4" />
                <span>Create Your First Circle</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {circles.map((circle) => {
                const circleProgress = circle.progressPct ?? circle.completionPct ?? 0;
                const allMembersSigned =
                  circle.members.length > 0 && circle.members.every((m) => m.hasSigned);
                const unsignedCount = circle.members.filter((m) => !m.hasSigned).length;
                const isCircleOpen =
                  circle.status === 'PENDING_SIGNATURES' ||
                  circle.status === 'ACTIVE' ||
                  circle.status === 'GOAL_MET';
                const canParticipate = circle.isMember || circle.isCreator;
                const canAddFunds =
                  canParticipate && allMembersSigned && circle.status !== 'PENDING_SIGNATURES';
                const myHandle = (user?.handle || '').toLowerCase();
                const myMemberRow =
                  circle.members.find(
                    (m) => m.isCurrentUser || (myHandle && m.handle.toLowerCase() === myHandle)
                  ) || null;
                const isCallerContributor =
                  Boolean(myMemberRow && BigInt(myMemberRow.sharesAtomic || '0') > 0n);
                const hasPoolShares = BigInt(circle.totalSharesAtomic || '0') > 0n;
                const canCallerDissolve = hasPoolShares
                  ? isCallerContributor
                  : circle.isCreator;
                const dissolveSigned = circle.dissolveApprovalsCount ?? 0;
                const dissolveRequired = circle.dissolveRequiredCount ?? 1;
                const isSolo = circle.members.length === 1;
                const circleVaultMeta = vaults.find((v) => v.symbol === circle.vaultSymbol);
                const vaultMinUsd = circleVaultMeta?.minDepositUsd || 5;
                const ticketSerial = circle.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
                const youCents = Math.max(0, myMemberRow?.contributedUsdCents ?? 0);
                const totalCents = Math.max(0, circle.currentValueUsdCents || 0);
                const targetCents = Math.max(1, circle.targetUsdCents || 1);
                const othersCents = Math.max(0, totalCents - youCents);
                const leftCents = Math.max(0, targetCents - totalCents);
                const youPct = Math.min(100, (youCents / targetCents) * 100);
                const othersPct = Math.min(100 - youPct, (othersCents / targetCents) * 100);
                const leftPct = Math.max(0, 100 - youPct - othersPct);

                const statusLabel =
                  circle.status === 'PENDING_SIGNATURES'
                    ? 'Waiting signatures'
                    : circle.status === 'GOAL_MET'
                    ? 'Goal met'
                    : circle.status.charAt(0) + circle.status.slice(1).toLowerCase();
                const isOkStatus =
                  circle.status === 'ACTIVE' ||
                  circle.status === 'GOAL_MET' ||
                  circle.status === 'SETTLED' ||
                  circle.status === 'COMPLETED';

                return (
                  <div
                    key={circle.id}
                    className="relative overflow-hidden bg-white border border-stone-200 rounded-2xl shadow-2xs flex flex-col"
                  >
                    {/* TICKET TOP STRIP */}
                    <div className="px-4 py-2 bg-stone-50 border-b border-stone-200 flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">{circle.purposeLabel}</Badge>
                        <Badge tone="neutral">
                          {circle.vaultSymbol} · {circle.estimatedApyPct}% APY
                        </Badge>
                      </div>

                      <span className="font-mono text-[10px] text-[var(--fg-muted)] tracking-wider uppercase">
                        #{ticketSerial}
                      </span>
                    </div>

                    {/* TICKET MAIN BODY */}
                    <div className="px-4 py-3.5 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          <h3 className="text-base font-display font-extrabold text-stone-950 leading-tight truncate">
                            {circle.name}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-stone-500">
                            <span className="inline-flex items-center gap-1 text-stone-800 font-semibold">
                              <img
                                src={`https://unavatar.io/x/${circle.payoutHandle}`}
                                alt={`@${circle.payoutHandle}`}
                                className="w-3.5 h-3.5 rounded-full object-cover border border-stone-200 bg-stone-100"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                                }}
                              />
                              <span>Payout @{circle.payoutHandle}</span>
                            </span>
                            {circle.creatorHandle.toLowerCase() !==
                              circle.payoutHandle.toLowerCase() && (
                              <span>• @{circle.creatorHandle}</span>
                            )}
                          </div>
                          {circle.contractMode === 'contract' && (
                            <Link
                              to={`/verify?kind=circle&id=${encodeURIComponent(
                                circle.onchainCircleId || circle.id
                              )}`}
                              className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 hover:underline leading-none pt-0.5"
                              title="Inspect Circle signers and balances on circle.uprail.near"
                            >
                              <ShieldCheck weight="fill" className="w-2.5 h-2.5 shrink-0" />
                              <span>Contract verified ↗</span>
                            </Link>
                          )}
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-lg font-display font-extrabold text-stone-950 tabular-nums">
                            {formatCentsUsd(circle.currentValueUsdCents)}{' '}
                            <span className="text-[11px] font-mono font-normal text-[var(--fg-muted)]">
                              / {formatCentsUsd(circle.targetUsdCents)}
                            </span>
                          </div>
                          {hasPoolShares ? (() => {
                            const chg = formatSignedUsdChange(
                              circle.netChangeUsdCents,
                              circle.yieldUsdCents,
                              formatCentsUsd
                            );
                            return (
                              <div
                                className={`text-[11px] font-mono ${
                                  chg.isNegative ? 'text-amber-700' : 'text-emerald-600'
                                }`}
                              >
                                {chg.label} {chg.isNegative ? 'net (incl. price)' : 'yield'}
                              </div>
                            );
                          })() : (
                            <div className="text-[11px] font-mono text-[var(--fg-muted)]">
                              Min ${vaultMinUsd}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Segmented Contribution Progress Bar + Legend */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[10px] font-mono uppercase tracking-wider text-stone-500">
                          <span>Funded</span>
                          <span className="font-bold text-stone-900">
                            {circleProgress.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2.5 w-full flex items-center gap-[2px]">
                          {youPct > 0 && (
                            <div
                              style={{ width: `${youPct}%` }}
                              className="h-full bg-[var(--fg)] rounded-sm transition-all duration-500"
                            />
                          )}
                          {othersPct > 0 && (
                            <div
                              style={{ width: `${othersPct}%` }}
                              className="h-full bg-[#047857] dark:bg-[#34d399] rounded-sm transition-all duration-500"
                            />
                          )}
                          {leftPct > 0 && (
                            <div
                              style={{ width: `${leftPct}%` }}
                              className="h-full bg-[var(--bg-muted)] rounded-sm transition-all duration-500"
                            />
                          )}
                        </div>
                        <p className="text-[11px] font-mono text-[var(--fg-muted)] tabular-nums">
                          You {formatCentsUsd(youCents)} · Others {formatCentsUsd(othersCents)} · Left{' '}
                          {formatCentsUsd(leftCents)}
                        </p>
                      </div>
                    </div>

                    {/* PERFORATED TICKET TEAR LINE WITH SIDE NOTCHES */}
                    <div className="relative flex items-center">
                      <div className="w-3.5 h-3.5 -ml-2 rounded-full bg-stone-100 border border-stone-200 shrink-0" />
                      <div className="w-full border-t-2 border-dashed border-stone-200" />
                      <div className="w-3.5 h-3.5 -mr-2 rounded-full bg-stone-100 border border-stone-200 shrink-0" />
                    </div>

                    {/* TICKET STUB (Compact Participant DPs + Status + Action Bar) */}
                    <div className="px-4 py-2.5 bg-stone-50/60 space-y-2 mt-auto">
                      {!isSolo && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className="flex items-center -space-x-1.5 overflow-hidden py-0.5 pl-0.5">
                              {circle.members.map((m) => {
                                const memberPct = m.progressPct ?? m.fulfillmentPct ?? 0;
                                return (
                                  <div
                                    key={m.id}
                                    title={`@${m.handle} (${m.percentageShare.toFixed(2).replace(/\.00$/, '')}%) · ${formatCentsUsd(m.contributedUsdCents)}/${formatCentsUsd(m.quotaUsdCents)} · ${
                                      m.hasMetQuota
                                        ? '100% ✓'
                                        : m.hasSigned
                                        ? `${memberPct.toFixed(0)}%`
                                        : 'Unsigned'
                                    }`}
                                    className={`relative w-6 h-6 rounded-full bg-stone-200 ring-2 shrink-0 ${
                                      m.hasMetQuota || m.hasSigned
                                        ? 'ring-emerald-500'
                                        : 'ring-amber-400'
                                    }`}
                                  >
                                    <img
                                      src={`https://unavatar.io/x/${m.handle}`}
                                      alt={`@${m.handle}`}
                                      className="w-full h-full rounded-full object-cover"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                            <span className="text-[10px] font-mono text-stone-500 truncate">
                              {circle.members.filter((m) => m.hasSigned).length}/{circle.members.length} signed
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              handleCopyLink(
                                circle.id,
                                `${window.location.origin}/app/circles?circle=${encodeURIComponent(
                                  circle.id
                                )}`
                              )
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-mono text-stone-500 hover:text-stone-900 cursor-pointer shrink-0"
                          >
                            {copiedId === circle.id ? (
                              <Check weight="bold" className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy weight="fill" className="w-3 h-3" />
                            )}
                            <span>Invite Link</span>
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {/* Left Pass Info + Repositioned Smaller Status */}
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider leading-none border ${
                              circle.status === 'PENDING_SIGNATURES'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : isOkStatus
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-stone-100 text-stone-600 border-stone-200'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                circle.status === 'PENDING_SIGNATURES'
                                  ? 'bg-amber-500'
                                  : isOkStatus
                                  ? 'bg-emerald-500'
                                  : 'bg-stone-400'
                              }`}
                            />
                            <span>{statusLabel}</span>
                          </span>
                          {isSolo && (
                            <span className="text-[10px] font-mono text-stone-500">
                              Solo • 100% Share
                            </span>
                          )}
                        </div>

                        {/* Right Action Buttons */}
                        {isCircleOpen && (
                          <div className="flex flex-wrap items-center gap-2">
                            {circle.isMember && !circle.hasSigned && (
                              <button
                                type="button"
                                disabled={anyActionBusy}
                                onClick={() => handleJoinCircle(circle)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-900 text-xs font-display font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                              >
                                {isActionBusyId === circle.id && actionBusyKind === 'join' ? (
                                  <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                                ) : (
                                  <Fingerprint weight="bold" className="w-3.5 h-3.5 text-emerald-600" />
                                )}
                                <span>
                                  {isActionBusyId === circle.id && actionBusyKind === 'join'
                                    ? 'Signing…'
                                    : 'Sign & Join'}
                                </span>
                              </button>
                            )}
                            {canAddFunds ? (
                              <button
                                type="button"
                                disabled={anyActionBusy}
                                onClick={() => {
                                  setContributeCircle(circle);
                                  setContribAmount('');
                                }}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-display font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
                              >
                                <ArrowUpRight weight="bold" className="w-3.5 h-3.5" />
                                <span>Add Funds</span>
                              </button>
                            ) : (
                              canParticipate &&
                              !allMembersSigned && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-mono">
                                  <Clock weight="fill" className="w-3.5 h-3.5" />
                                  <span>
                                    Waiting for {unsignedCount} signature
                                    {unsignedCount === 1 ? '' : 's'} to activate vault
                                  </span>
                                </span>
                              )
                            )}
                            {circle.isCreator && hasPoolShares && (
                              <button
                                type="button"
                                disabled={anyActionBusy}
                                onClick={() => handleSettleCircle(circle)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-stone-950"
                                title="Disburse pooled vault shares + yield to payout handle (1% protocol fee on payout)"
                              >
                                {isActionBusyId === circle.id && actionBusyKind === 'settle' ? (
                                  <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Fingerprint weight="bold" className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {isActionBusyId === circle.id && actionBusyKind === 'settle'
                                    ? 'Settling…'
                                    : 'Settle'}
                                </span>
                              </button>
                            )}
                            {canCallerDissolve && (
                              <button
                                type="button"
                                disabled={anyActionBusy || Boolean(circle.hasApprovedDissolve)}
                                onClick={() => handleDissolveCircle(circle)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-600 text-xs font-mono transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                title="All contributors who funded the Circle must sign with their passkey to dissolve and refund pro-rata shares + yield"
                              >
                                {isActionBusyId === circle.id && actionBusyKind === 'dissolve' ? (
                                  <CircleNotch weight="bold" className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Fingerprint weight="bold" className="w-3 h-3" />
                                )}
                                <span>
                                  {isActionBusyId === circle.id && actionBusyKind === 'dissolve'
                                    ? 'Signing…'
                                    : hasPoolShares
                                    ? `Dissolve (${dissolveSigned}/${dissolveRequired})`
                                    : 'Dissolve'}
                                </span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {isActionBusyId === circle.id && actionStepMsg && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="px-3 py-2 rounded-xl bg-stone-50 border border-stone-200 text-[11px] font-mono text-stone-700 flex items-center gap-2"
                        >
                          <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin text-stone-900 flex-shrink-0" />
                          <span>{actionStepMsg}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: 1-TO-1 TIMELOCKED EARN VAULT GIFTING */}
      {activeTab === 'gifts' && (
        <div className="space-y-6">
          {/* Active Received Gifts */}
          <div className="space-y-3">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-stone-500">
              Gifts Sent to You (@{user?.handle})
            </h2>
            {activeReceivedGifts.length === 0 ? (
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-6 text-center text-xs text-stone-500">
                {giftHistory.some(
                  (g) =>
                    g.role === 'RECIPIENT' ||
                    (user?.handle && g.recipientHandle.toLowerCase() === user.handle.toLowerCase())
                )
                  ? 'No locked gifts remaining. Claimed gifts are listed in Gift History below.'
                  : `No Earn Vault gifts received yet. When someone sends an Earn Vault gift to @${user?.handle}, it will appear here with live compounding yield.`}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeReceivedGifts.map((gift) => {
                  const unlocked = nowMs >= gift.timelockUntil;
                  const isBusyThis = isActionBusyId === gift.id;
                  return (
                    <div
                      key={gift.id}
                      className="bg-white border border-stone-200 rounded-2xl p-5 shadow-2xs space-y-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge tone="neutral">{gift.occasionLabel}</Badge>
                            <Badge tone="neutral">
                              {gift.vaultSymbol} · {gift.estimatedApyPct}% APY
                            </Badge>
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
                          {(() => {
                            const chg = formatSignedUsdChange(
                              gift.netChangeUsdCents,
                              gift.yieldUsdCents,
                              formatCentsUsd
                            );
                            return (
                              <div
                                className={`text-[11px] font-mono ${
                                  chg.isNegative ? 'text-amber-700' : 'text-emerald-600'
                                }`}
                              >
                                Deposited {formatCentsUsd(gift.principalUsdCents)} ({chg.label})
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono">
                        <div className="flex items-center gap-2 text-stone-700">
                          {unlocked ? (
                            <LockOpen weight="fill" className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Lock weight="fill" className="w-4 h-4 text-amber-600" />
                          )}
                          <span>{formatCountdown(gift.timelockUntil, nowMs)}</span>
                        </div>
                        <span className="text-stone-500">
                          {truncateDecimals(gift.sharesFormatted, 5)} {gift.vaultSymbol}
                        </span>
                      </div>

                      {isBusyThis && actionStepMsg && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="px-3 py-2 rounded-xl bg-emerald-50/80 border border-emerald-200 text-[11px] font-mono text-emerald-900 flex items-center gap-2"
                        >
                          <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin text-emerald-600 flex-shrink-0" />
                          <span>{actionStepMsg}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <Link
                            to={`/gift/${gift.id}`}
                            className="text-xs font-mono text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
                          >
                            <span>View Gift Card</span>
                            <ArrowSquareOut weight="fill" className="w-3 h-3" />
                          </Link>
                          {gift.contractMode === 'contract' && (
                            <Link
                              to={`/verify?kind=gift&id=${encodeURIComponent(
                                gift.onchainGiftId || gift.id
                              )}`}
                              className="text-xs font-mono font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"
                            >
                              <ShieldCheck weight="fill" className="w-3 h-3" />
                              <span>Verify On-Chain</span>
                            </Link>
                          )}
                        </div>

                        <button
                          type="button"
                          disabled={!unlocked || anyActionBusy}
                          onClick={() => handleClaimGift(gift)}
                          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-display font-bold transition-all disabled:cursor-not-allowed ${
                            isBusyThis
                              ? 'bg-emerald-600/75 text-white opacity-85'
                              : unlocked && !anyActionBusy
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs'
                              : unlocked
                              ? 'bg-emerald-600/50 text-white opacity-60'
                              : 'bg-stone-200 text-stone-500'
                          }`}
                        >
                          {isBusyThis ? (
                            <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                          ) : (
                            <Fingerprint weight="bold" className="w-3.5 h-3.5 flex-shrink-0" />
                          )}
                          <span>
                            {isBusyThis
                              ? 'Unlocking…'
                              : unlocked
                              ? 'Unwrap & Claim to USDC'
                              : 'Locked Until Timelock'}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Sent Gifts */}
          <div className="space-y-3">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-stone-500">
              Gifts You Sent ({activeSentGifts.length})
            </h2>
            {activeSentGifts.length === 0 ? (
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-6 text-center space-y-3">
                <p className="text-xs text-stone-500">
                  Gift a live compounding Earn Vault to any @handle for birthdays, Christmas, anniversaries, or custom occasions.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsCreateGiftOpen(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-950 text-white text-xs font-display font-bold cursor-pointer"
                  >
                    <Gift weight="fill" className="w-3.5 h-3.5" />
                    <span>Send an Earn Vault Gift</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeSentGifts.map((gift) => {
                  const isBusyThis = isActionBusyId === gift.id;
                  return (
                    <div
                      key={gift.id}
                      className="bg-white border border-stone-200 rounded-2xl p-5 shadow-2xs space-y-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge tone="neutral">{gift.occasionLabel}</Badge>
                            <Badge tone="neutral">
                              {gift.vaultSymbol} · {gift.estimatedApyPct}% APY
                            </Badge>
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
                          {(() => {
                            const chg = formatSignedUsdChange(
                              gift.netChangeUsdCents,
                              gift.yieldUsdCents,
                              formatCentsUsd
                            );
                            return (
                              <div
                                className={`text-[11px] font-mono ${
                                  chg.isNegative ? 'text-amber-700' : 'text-emerald-600'
                                }`}
                              >
                                {chg.label} {chg.isNegative ? 'net (incl. price)' : 'yield'}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-[11px] font-mono text-stone-600">
                        <span>
                          Unlocks: {new Date(gift.timelockUntil).toLocaleString()}
                        </span>
                        <span className="font-bold uppercase text-stone-900">{gift.status}</span>
                      </div>

                      {isBusyThis && actionStepMsg && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="px-3 py-2 rounded-xl bg-amber-50/80 border border-amber-200 text-[11px] font-mono text-amber-900 flex items-center gap-2"
                        >
                          <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin text-amber-600 flex-shrink-0" />
                          <span>{actionStepMsg}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopyLink(gift.id, gift.shareUrl)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-xs font-mono text-stone-700 cursor-pointer"
                          >
                            {copiedId === gift.id ? (
                              <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy weight="fill" className="w-3.5 h-3.5" />
                            )}
                            <span>Copy SEO Gift Link</span>
                          </button>
                          {gift.contractMode === 'contract' ? (
                            <Link
                              to={`/verify?kind=gift&id=${encodeURIComponent(
                                gift.onchainGiftId || gift.id
                              )}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 text-emerald-700 dark:text-emerald-300 text-xs font-mono font-bold"
                            >
                              <ShieldCheck weight="fill" className="w-3 h-3" />
                              <span>Verify</span>
                            </Link>
                          ) : gift.contractMode === 'escrow' ? (
                            <Badge tone="neutral">Escrow</Badge>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {(gift.canClaim ||
                            gift.senderCanReclaim ||
                            (gift.status === 'LOCKED' &&
                              nowMs >= gift.timelockUntil + 30 * 24 * 60 * 60 * 1000)) && (
                            <button
                              type="button"
                              disabled={anyActionBusy}
                              onClick={() => handleClaimGift(gift)}
                              title="30 days have passed since unlock and recipient has not claimed yet — reclaim vault shares + yield back to your account"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 text-xs font-display font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isBusyThis ? (
                                <CircleNotch weight="bold" className="w-3 h-3 animate-spin" />
                              ) : (
                                <Fingerprint weight="bold" className="w-3 h-3" />
                              )}
                              <span>{isBusyThis ? 'Reclaiming…' : 'Reclaim Unclaimed'}</span>
                            </button>
                          )}
                          <a
                            href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                              `I just gifted @${gift.recipientHandle} a compounding ${gift.vaultSymbol} Earn Vault (${gift.estimatedApyPct}% APY) on @uprailworld`
                            )}&url=${encodeURIComponent(gift.shareUrl)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold"
                          >
                            <ShareNetwork weight="fill" className="w-3 h-3" />
                            <span>Share on 𝕏</span>
                          </a>
                          <Link
                            to={`/gift/${gift.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-xs font-mono text-stone-600"
                          >
                            <span>Card</span>
                            <ArrowSquareOut weight="fill" className="w-3 h-3" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Intents Earn Vaults List */}
      <div className="bg-stone-50 border border-stone-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <TrendUp weight="fill" className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-stone-700">
              Intents Earn Vaults ({vaults.length})
            </span>
          </div>
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-stone-500 hover:text-stone-900 cursor-pointer"
          >
            <ArrowsClockwise weight="bold" className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>

        <div className="divide-y divide-stone-200 bg-white">
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
                className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-colors cursor-pointer ${
                  isSelected ? 'bg-emerald-50/70' : 'hover:bg-stone-50'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isSelected ? 'bg-emerald-600' : 'bg-stone-300'
                    }`}
                  />
                  <span className="font-display font-extrabold text-sm text-stone-950">
                    {v.symbol}
                  </span>
                  <VaultRiskBadges vault={v} compact />
                </div>

                <Badge tone="ok">{v.estimatedApyPct.toFixed(1)}% APY</Badge>
              </div>
            );
          })}
        </div>
      </div>

      {/* Gift History (Placed under Intents Earn Vaults — compact ledger rows, not cards) */}
      {activeTab === 'gifts' && giftHistory.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-stone-500">
            Gift History ({giftHistory.length})
          </h2>
          <div className="border-y border-stone-200 divide-y divide-stone-200/80">
            {giftHistory.map((gift) => {
              const myHandle = (user?.handle || '').toLowerCase();
              const wasReceived =
                gift.role === 'RECIPIENT' ||
                (Boolean(myHandle) && gift.recipientHandle.toLowerCase() === myHandle);
              const dateMs = gift.claimedAt || gift.timelockUntil || gift.createdAt;
              const chg = formatSignedUsdChange(
                gift.netChangeUsdCents,
                gift.yieldUsdCents,
                formatCentsUsd
              );
              return (
                <div
                  key={gift.id}
                  className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CheckCircle
                      weight="fill"
                      className={`w-4 h-4 flex-shrink-0 ${
                        gift.status === 'CLAIMED' ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display font-bold text-stone-950 truncate">
                          {wasReceived
                            ? `From @${gift.senderHandle}`
                            : `To @${gift.recipientHandle}`}
                        </span>
                        <span className="text-[11px] font-mono text-stone-500">
                          {gift.occasionLabel} · {gift.vaultSymbol}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold uppercase ${
                            gift.status === 'CLAIMED' ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {gift.status === 'CLAIMED' ? 'Claimed' : 'Reclaimed'}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-stone-400">
                        {dateMs ? new Date(dateMs).toLocaleDateString() : ''}
                        {' · '}
                        {truncateDecimals(gift.sharesFormatted, 5)} {gift.vaultSymbol}
                        {(chg.isPositive || chg.isNegative) ? ` (${chg.label})` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 ml-auto">
                    <span className="font-display font-bold text-stone-950 tabular-nums">
                      {formatCentsUsd(gift.currentValueUsdCents)}
                    </span>
                    {gift.contractMode === 'contract' && (
                      <Link
                        to={`/verify?kind=gift&id=${encodeURIComponent(
                          gift.onchainGiftId || gift.id
                        )}`}
                        className="text-[11px] font-mono font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"
                      >
                        <ShieldCheck weight="fill" className="w-3 h-3" />
                        <span>Verify</span>
                      </Link>
                    )}
                    <Link
                      to={`/gift/${gift.id}`}
                      className="text-[11px] font-mono text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
                    >
                      <span>Details</span>
                      <ArrowSquareOut weight="fill" className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE CIRCLE (Sanitized, Dropdown Reason + Custom, Auto-100% Solo) */}
      <ModalSheet
        isOpen={isCreateCircleOpen}
        onClose={() => setIsCreateCircleOpen(false)}
        canClose={!isSubmittingCircle}
        zIndexClass="z-[110]"
        maxWidthClass="sm:max-w-lg"
        panelClassName="px-4 sm:p-6 pb-6 space-y-5"
        showCloseButton
        closeLabel="Close New Earn Circle dialog"
        ariaLabel="New Earn Circle"
      >
        <div className="flex items-center gap-2.5 pr-11">
          <div className="w-9 h-9 rounded-xl bg-stone-100 border border-stone-200 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <Record weight="fill" className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-display font-extrabold text-stone-950">
            New Earn Circle
          </h2>
        </div>

        <form onSubmit={handleCreateCircle} className="space-y-4 overflow-x-hidden">
          <div>
            <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
              Circle Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Tokyo Summer Trip, House Rent, Core Savings"
              value={circleName}
              onChange={(e) => setCircleName(e.target.value)}
              className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-normal focus:outline-none focus:border-stone-900"
            />
          </div>

          {/* Dropdown Reason + Custom input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                Reason
              </label>
              <StyledSelect
                value={circlePurpose}
                onChange={(val) => setCirclePurpose(val as CirclePurpose)}
                options={PURPOSE_OPTIONS.map((p) => ({
                  value: p.value,
                  label: p.label,
                }))}
              />
            </div>

            <div className="min-w-0">
              <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                Target Goal (USD)
              </label>
              <input
                type="number"
                min="10"
                step="1"
                required
                value={circleTargetUsd}
                onChange={(e) => setCircleTargetUsd(e.target.value)}
                className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-mono font-normal focus:outline-none focus:border-stone-900"
              />
            </div>
          </div>

          {circlePurpose === 'CUSTOM' && (
            <div>
              <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                Custom Reason
              </label>
              <input
                type="text"
                required
                maxLength={48}
                placeholder="Enter custom reason (e.g. Studio Equipment, Retreat)"
                value={circleCustomPurpose}
                onChange={(e) => setCircleCustomPurpose(e.target.value)}
                className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-normal focus:outline-none focus:border-stone-900"
              />
            </div>
          )}

          {/* Intents Earn Vault Dropdown */}
          <div>
            <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
              Intents Earn Vault
            </label>
            <StyledSelect
              mono
              value={circleVaultSymbol}
              onChange={(val) => setCircleVaultSymbol(val as EarnVaultSymbol)}
              options={vaults.map((v) => ({
                value: v.symbol,
                label: v.symbol,
                badge: `${v.estimatedApyPct.toFixed(1)}% APY`,
              }))}
            />
          </div>

          {/* Member Percentage Quotas */}
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-mono font-semibold uppercase text-stone-600">
                Participants ({circleMembers.length === 1 ? 'Solo • Auto 100%' : `${circleMembers.length} Members`})
              </label>
              <div className="flex items-center gap-3">
                {circleMembers.length > 1 && (
                  <button
                    type="button"
                    onClick={splitMembersEvenly}
                    className="text-[11px] font-mono text-emerald-600 hover:underline cursor-pointer"
                  >
                    Split Evenly
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddMemberRow}
                  className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-stone-900 hover:underline cursor-pointer"
                >
                  <Plus weight="bold" className="w-3 h-3" /> Add @handle
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto overflow-x-hidden pr-0.5">
              {circleMembers.map((m, idx) => {
                const isSolo = circleMembers.length === 1;
                const pct = isSolo ? 100 : parseFloat(m.percentage) || 0;
                const usdShare = ((parseFloat(circleTargetUsd) || 0) * pct) / 100;
                const cleanH = m.handle.trim().replace(/^@+/, '').toLowerCase();
                const prof = cleanH ? resolvedProfiles[cleanH] : undefined;
                return (
                  <div key={idx} className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    <div className="relative flex-1 min-w-0">
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
                        className="w-full min-w-0 px-3 py-2 pr-8 rounded-xl border border-stone-300 text-sm sm:text-xs font-mono font-normal"
                      />
                      {prof?.loading ? (
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                          <ArrowsClockwise weight="bold" className="w-3.5 h-3.5 text-stone-400 animate-spin" />
                        </span>
                      ) : prof?.exists && prof?.avatarUrl ? (
                        <img
                          src={prof.avatarUrl}
                          alt={`@${cleanH}`}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full object-cover border border-stone-200 bg-stone-100 pointer-events-none"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="relative w-[68px] sm:w-24 min-w-0 flex-shrink-0">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="0.01"
                        required
                        readOnly={isSolo}
                        value={isSolo ? '100' : m.percentage}
                        onChange={(e) => {
                          if (isSolo) return;
                          const next = [...circleMembers];
                          next[idx] = { ...next[idx], percentage: e.target.value };
                          setCircleMembers(next);
                        }}
                        className={`w-full min-w-0 px-2 py-2 pr-5 rounded-xl border border-stone-300 text-sm sm:text-xs font-mono font-normal text-right ${
                          isSolo ? 'opacity-75 cursor-not-allowed' : ''
                        }`}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono text-stone-400 pointer-events-none">
                        %
                      </span>
                    </div>
                    <span className="hidden sm:inline-block w-20 text-right text-[11px] font-mono text-stone-500 tabular-nums flex-shrink-0">
                      {formatUsd(usdShare)}
                    </span>
                    {circleMembers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMemberRow(idx)}
                        aria-label="Remove participant"
                        className="p-1.5 text-stone-400 hover:text-red-600 cursor-pointer flex-shrink-0"
                      >
                        <Trash weight="fill" className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono pt-1">
              <span className="text-stone-500">Total Share Allocation:</span>
              <span
                className={`font-bold tabular-nums ${
                  Math.abs(totalMemberPercentage - 100) <= 0.01
                    ? 'text-emerald-600'
                    : 'text-red-600'
                }`}
              >
                {totalMemberPercentage.toFixed(2)}% / 100%
              </span>
            </div>
          </div>

          <VaultRiskAckBox
            vault={selectedCircleVault}
            acknowledged={circleRiskAck}
            onToggle={setCircleRiskAck}
            disabled={isSubmittingCircle}
          />

          {!isSubmittingCircle && circleValidation.hint && (
            <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-mono text-amber-800">
              {circleValidation.hint}
            </div>
          )}

          {isSubmittingCircle && circleStepMsg && (
            <div
              role="status"
              aria-live="polite"
              className="px-3 py-2 rounded-xl bg-stone-100 border border-stone-200 text-[11px] font-mono text-stone-700 flex items-center gap-2"
            >
              <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              <span>{circleStepMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!circleValidation.isValid || isSubmittingCircle}
            className="w-full min-h-12 py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmittingCircle ? (
              <CircleNotch weight="bold" className="w-4 h-4 animate-spin flex-shrink-0" />
            ) : (
              <Fingerprint weight="bold" className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="truncate">
              {isSubmittingCircle
                ? circleStepMsg || 'Signing with Passkey...'
                : 'Sign with Passkey & Launch Circle'}
            </span>
          </button>
        </form>
      </ModalSheet>

      {/* MODAL 2: ADD FUNDS TO CIRCLE (Supports repeated partial or full additions at any point) */}
      <ModalSheet
        isOpen={Boolean(contributeCircle)}
        onClose={() => setContributeCircle(null)}
        canClose={!isSubmittingContrib}
        zIndexClass="z-[110]"
        maxWidthClass="sm:max-w-md"
        panelClassName="px-4 sm:p-6 pb-6 space-y-4"
        showCloseButton
        closeLabel="Close add funds dialog"
        ariaLabel={contributeCircle ? `Add Funds to ${contributeCircle.name}` : 'Add Funds'}
      >
        {contributeCircle && (
          <>
            <div className="pr-11 space-y-1.5">
              <h2 className="text-lg font-display font-extrabold text-stone-950">
                Add Funds to {contributeCircle.name}
              </h2>
              <p className="text-xs text-stone-500">
                Compounds in {contributeCircle.vaultSymbol} ({contributeCircle.estimatedApyPct}% APY). Add partial amounts or complete your share anytime.
              </p>
            </div>

            {myMemberInContribCircle && (
              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">Your Share ({myMemberInContribCircle.percentageShare}%):</span>
                  <span className="font-bold text-stone-900">
                    {formatCentsUsd(myMemberInContribCircle.contributedUsdCents)} /{' '}
                    {formatCentsUsd(myMemberInContribCircle.quotaUsdCents)}
                  </span>
                </div>
                {myMemberInContribCircle.quotaUsdCents > myMemberInContribCircle.contributedUsdCents && (
                  <div className="flex items-center justify-between pt-1 border-t border-stone-200">
                    <span className="text-stone-500">Remaining to 100%:</span>
                    <button
                      type="button"
                      onClick={() => {
                        const remUsd =
                          (myMemberInContribCircle.quotaUsdCents -
                            myMemberInContribCircle.contributedUsdCents) /
                          100;
                        setContribAmount(remUsd.toFixed(2).replace(/\.00$/, ''));
                      }}
                      className="text-emerald-600 font-bold hover:underline cursor-pointer"
                    >
                      Fill {formatCentsUsd(
                        myMemberInContribCircle.quotaUsdCents -
                          myMemberInContribCircle.contributedUsdCents
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleContribute} className="space-y-4">
              <div>
                <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                  Pay With
                </label>
                <StyledSelect
                  mono
                  value={contribOriginAsset}
                  onChange={setContribOriginAsset}
                  options={availableOriginAssets.map((a) => ({
                    value: a.assetId,
                    label: a.symbol,
                    badge: `${a.balanceFormatted} avail`,
                  }))}
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                  Amount to Add
                </label>
                <input
                  type="number"
                  step="any"
                  min="1"
                  required
                  placeholder="e.g. 25"
                  value={contribAmount}
                  onChange={(e) => setContribAmount(e.target.value)}
                  className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-mono font-normal"
                />
              </div>

              <VaultRiskAckBox
                vault={selectedContribVault}
                acknowledged={contribRiskAck}
                onToggle={setContribRiskAck}
                disabled={isSubmittingContrib}
              />

              {!isSubmittingContrib && contribValidation.hint && (
                <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-mono text-amber-800">
                  {contribValidation.hint}
                </div>
              )}

              {isSubmittingContrib && contribStepMsg && (
                <div
                  role="status"
                  aria-live="polite"
                  className="px-3 py-2 rounded-xl bg-stone-100 border border-stone-200 text-[11px] font-mono text-stone-700 flex items-center gap-2"
                >
                  <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                  <span>{contribStepMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!contribValidation.isValid || isSubmittingContrib}
                className="w-full min-h-12 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmittingContrib ? (
                  <CircleNotch weight="bold" className="w-4 h-4 animate-spin flex-shrink-0" />
                ) : (
                  <Fingerprint weight="bold" className="w-4 h-4 flex-shrink-0" />
                )}
                <span className="truncate">
                  {isSubmittingContrib
                    ? contribStepMsg || 'Signing & Adding to Vault...'
                    : `Sign with Passkey & Add to ${contributeCircle.vaultSymbol}`}
                </span>
              </button>
            </form>
          </>
        )}
      </ModalSheet>

      {/* MODAL 3: SEND TIMELOCKED EARN VAULT GIFT (Sanitized, Dropdown Occasion + Custom) */}
      <ModalSheet
        isOpen={isCreateGiftOpen}
        onClose={() => setIsCreateGiftOpen(false)}
        canClose={!isSubmittingGift}
        zIndexClass="z-[110]"
        maxWidthClass="sm:max-w-lg"
        panelClassName="px-4 sm:p-6 pb-6 space-y-5"
        showCloseButton
        closeLabel="Close Gift an Intents Earn Vault dialog"
        ariaLabel="Gift an Intents Earn Vault"
      >
        <div className="flex items-center gap-2.5 pr-11">
          <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center flex-shrink-0">
            <Gift weight="fill" className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-display font-extrabold text-stone-950 leading-tight">
              Gift an Intents Earn Vault
            </h2>
          </div>
        </div>

        <form onSubmit={handleCreateGift} className="space-y-4 overflow-x-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                Recipient @handle
              </label>
              {(() => {
                const cleanG = giftRecipient.trim().replace(/^@+/, '').toLowerCase();
                const profG = cleanG ? resolvedProfiles[cleanG] : undefined;
                return (
                  <div className="relative">
                    <input
                      type="text"
                      required
                      placeholder="@alice"
                      value={giftRecipient}
                      onChange={(e) => setGiftRecipient(e.target.value)}
                      className="w-full min-w-0 px-3.5 py-2.5 pr-9 rounded-xl border border-stone-300 text-sm font-mono font-normal focus:outline-none focus:border-stone-900"
                    />
                    {profG?.loading ? (
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                        <ArrowsClockwise weight="bold" className="w-3.5 h-3.5 text-stone-400 animate-spin" />
                      </span>
                    ) : profG?.exists && profG?.avatarUrl ? (
                      <img
                        src={profG.avatarUrl}
                        alt={`@${cleanG}`}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full object-cover border border-stone-200 bg-stone-100 pointer-events-none"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                  </div>
                );
              })()}
            </div>

            <div className="min-w-0">
              <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                Occasion
              </label>
              <StyledSelect
                value={giftOccasion}
                onChange={(val) => {
                  const occ = val as GiftOccasion;
                  setGiftOccasion(occ);
                  setGiftTimelockLocal(defaultTimelockForOccasion(occ));
                }}
                options={OCCASION_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
              />
            </div>
          </div>

          {giftOccasion === 'CUSTOM' && (
            <div>
              <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                Custom Occasion
              </label>
              <input
                type="text"
                required
                maxLength={48}
                placeholder="Enter occasion (e.g. Eid, Promotion, Baby Shower)"
                value={giftCustomOccasion}
                onChange={(e) => setGiftCustomOccasion(e.target.value)}
                className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-normal focus:outline-none focus:border-stone-900"
              />
            </div>
          )}

          {/* Intents Earn Vault Dropdown */}
          <div>
            <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
              Intents Earn Vault
            </label>
            <StyledSelect
              mono
              value={giftVaultSymbol}
              onChange={(val) => setGiftVaultSymbol(val as EarnVaultSymbol)}
              options={vaults.map((v) => ({
                value: v.symbol,
                label: v.symbol,
                badge: `${v.estimatedApyPct.toFixed(1)}% APY`,
              }))}
            />
          </div>

          {/* Payment Token & Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                Pay With
              </label>
              <StyledSelect
                mono
                value={giftOriginAsset}
                onChange={setGiftOriginAsset}
                options={availableOriginAssets.map((a) => ({
                  value: a.assetId,
                  label: a.symbol,
                  badge: a.balanceFormatted,
                }))}
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
                Amount
              </label>
              <input
                type="number"
                step="any"
                min="1"
                required
                placeholder="e.g. 25"
                value={giftAmount}
                onChange={(e) => setGiftAmount(e.target.value)}
                className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-mono font-normal"
              />
            </div>
          </div>

          {/* Live Intents Earn Quote Preview */}
          {isQuotingGift ? (
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono text-stone-500">
              Fetching live Intents Earn Vault quote...
            </div>
          ) : (
            giftQuote && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2 text-xs font-mono">
                <span className="text-stone-700">Estimated Vault Shares:</span>
                <span className="font-semibold text-emerald-800 text-right">
                  ~{truncateDecimals(giftQuote.estimatedSharesOut, 5)} {giftQuote.vaultSymbol} (
                  {giftQuote.estimatedApyPct}% APY)
                </span>
              </div>
            )
          )}

          {/* Unlock Date & Time */}
          <div className="min-w-0">
            <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
              Unlock Date & Time
            </label>
            <input
              type="datetime-local"
              required
              value={giftTimelockLocal}
              onChange={(e) => setGiftTimelockLocal(e.target.value)}
              className="w-full min-w-0 max-w-full appearance-none px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm sm:text-xs font-mono font-normal bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-mono font-semibold uppercase text-stone-600 mb-1">
              Note (Optional)
            </label>
            <input
              type="text"
              maxLength={240}
              placeholder="Enjoy the compounded yield!"
              value={giftMessage}
              onChange={(e) => setGiftMessage(e.target.value)}
              className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm sm:text-xs font-normal"
            />
          </div>

          <VaultRiskAckBox
            vault={selectedGiftVault}
            acknowledged={giftRiskAck}
            onToggle={setGiftRiskAck}
            disabled={isSubmittingGift}
          />

          {!isSubmittingGift && giftValidation.hint && (
            <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-mono text-amber-800">
              {giftValidation.hint}
            </div>
          )}

          {isSubmittingGift && giftStepMsg && (
            <div
              role="status"
              aria-live="polite"
              className="px-3 py-2 rounded-xl bg-stone-100 border border-stone-200 text-[11px] font-mono text-stone-700 flex items-center gap-2"
            >
              <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              <span>{giftStepMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!giftValidation.isValid || isSubmittingGift}
            className="w-full min-h-12 py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmittingGift ? (
              <CircleNotch weight="bold" className="w-4 h-4 animate-spin flex-shrink-0" />
            ) : (
              <Fingerprint weight="bold" className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="truncate">
              {isSubmittingGift
                ? giftStepMsg || 'Signing & Locking Gift...'
                : `Sign with Passkey & Send ${giftVaultSymbol} Gift`}
            </span>
          </button>
        </form>
      </ModalSheet>
    </div>
  );
};
