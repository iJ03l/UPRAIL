'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from '../lib/router';
import {
  ArrowLeft,
  CircleDot,
  Gift,
  Plus,
  Lock,
  Unlock,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  RefreshCw,
  Fingerprint,
  Users,
  TrendingUp,
  Trash2,
  X,
  ArrowUpRight,
  Share2,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { api, formatUsd } from '../lib/api';
import { useXAuth } from '../hooks/useXAuth';
import { useOnchainData } from '../hooks/useOnchainData';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
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
          {selected?.badge && (
            <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-[10px] font-bold">
              {selected.badge}
            </span>
          )}
          <ChevronDown
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
                  {opt.badge && (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-[10px] font-bold">
                      {opt.badge}
                    </span>
                  )}
                  {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CustodySettlementToggle({
  isSelfCustody,
  value,
  onChange,
  kindLabel,
}: {
  isSelfCustody: boolean;
  value: 'contract' | 'escrow';
  onChange: (next: 'contract' | 'escrow') => void;
  kindLabel: string;
}) {
  if (!isSelfCustody) {
    return (
      <div className="px-3 py-2 rounded-xl bg-stone-50 border border-stone-200 text-[11px] font-mono text-stone-600 flex items-center justify-between gap-2">
        <span>Settlement: Standard Escrow Vault</span>
        <span className="text-stone-400">Passkey Self-Custody optional in Settings</span>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-mono font-semibold uppercase text-stone-600">
        Custody &amp; Settlement Mode
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange('contract')}
          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
            value === 'contract'
              ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
              : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
          }`}
        >
          <div className="flex items-center gap-1 text-xs font-display font-bold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>On-Chain Contract</span>
          </div>
          <p className="text-[10px] font-mono text-stone-500 mt-0.5">
            Non-custodial {kindLabel} bound to signer passkeys
          </p>
        </button>
        <button
          type="button"
          onClick={() => onChange('escrow')}
          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
            value === 'escrow'
              ? 'bg-stone-950 border-stone-950 text-white'
              : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
          }`}
        >
          <div className="text-xs font-display font-bold">Escrow Passthrough</div>
          <p
            className={`text-[10px] font-mono mt-0.5 ${
              value === 'escrow' ? 'text-stone-300' : 'text-stone-500'
            }`}
          >
            Standard escrow vault settlement (works with any @handle)
          </p>
        </button>
      </div>
    </div>
  );
}

export const CirclesView: React.FC = () => {
  const { user } = useXAuth();
  const { balances, refresh: refreshOnchain } = useOnchainData();
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
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
  useBodyScrollLock(Boolean(isCreateCircleOpen || isCreateGiftOpen || contributeCircle));
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create Circle form state — defaults to solo creator at 100%
  const [circleName, setCircleName] = useState('');
  const [circlePurpose, setCirclePurpose] = useState<CirclePurpose>('SHARED_GOAL');
  const [circleCustomPurpose, setCircleCustomPurpose] = useState('');
  const [circleTargetUsd, setCircleTargetUsd] = useState('500');
  const [circleVaultSymbol, setCircleVaultSymbol] = useState<EarnVaultSymbol>('TLO');
  const [circleMembers, setCircleMembers] = useState<Array<{ handle: string; percentage: string }>>([
    { handle: user?.handle || '', percentage: '100' },
  ]);
  const [circleCreateMode, setCircleCreateMode] = useState<'contract' | 'escrow'>(
    user?.custodyMode === 'self' ? 'contract' : 'escrow'
  );
  const [isSubmittingCircle, setIsSubmittingCircle] = useState(false);

  // Contribute form state
  const [contribOriginAsset, setContribOriginAsset] = useState('');
  const [contribAmount, setContribAmount] = useState('');
  const [isSubmittingContrib, setIsSubmittingContrib] = useState(false);
  const [isActionBusyId, setIsActionBusyId] = useState<string | null>(null);

  // Create Gift form state
  const [giftRecipient, setGiftRecipient] = useState('');
  const [giftOccasion, setGiftOccasion] = useState<GiftOccasion>('BIRTHDAY');
  const [giftCustomOccasion, setGiftCustomOccasion] = useState('');
  const [giftMessage, setGiftMessage] = useState('');
  const [giftVaultSymbol, setGiftVaultSymbol] = useState<EarnVaultSymbol>('TLO');
  const [giftOriginAsset, setGiftOriginAsset] = useState('');
  const [giftAmount, setGiftAmount] = useState('25');
  const [giftTimelockLocal, setGiftTimelockLocal] = useState(() =>
    defaultTimelockForOccasion('BIRTHDAY')
  );
  const [giftCreateMode, setGiftCreateMode] = useState<'contract' | 'escrow'>(
    user?.custodyMode === 'self' ? 'contract' : 'escrow'
  );
  const [giftQuote, setGiftQuote] = useState<GiftQuoteResult | null>(null);
  const [isQuotingGift, setIsQuotingGift] = useState(false);
  const [isSubmittingGift, setIsSubmittingGift] = useState(false);

  // Default creation mode tracks loaded custodyMode without locking user overrides
  useEffect(() => {
    const defaultMode: 'contract' | 'escrow' =
      user?.custodyMode === 'self' ? 'contract' : 'escrow';
    setCircleCreateMode(defaultMode);
    setGiftCreateMode(defaultMode);
  }, [user?.custodyMode]);

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
        balanceFormatted: anyUsdc?.amountFormatted || '0.00',
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
    return { isValid: true, hint: null };
  }, [
    circleName,
    circlePurpose,
    circleCustomPurpose,
    circleTargetUsd,
    selectedCircleVault,
    circleVaultSymbol,
    circleMembers,
    resolvedProfiles,
  ]);

  const contribValidation = useMemo(() => {
    if (!contributeCircle) return { isValid: false, hint: null };
    if (!contribOriginAsset) {
      return { isValid: false, hint: 'Select a payment token.' };
    }
    const amt = parseFloat(contribAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { isValid: false, hint: 'Enter a valid amount to add.' };
    }
    const circleVault = vaults.find((v) => v.symbol === contributeCircle.vaultSymbol);
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
    return { isValid: true, hint: null };
  }, [contributeCircle, contribOriginAsset, contribAmount, availableOriginAssets, vaults]);

  const giftValidation = useMemo(() => {
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
        hint: `Minimum deposit for ${selectedGiftVault?.name || giftVaultSymbol} is $${minUsd} USD (currently ~$${estUsd.toFixed(2)}).`,
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
    return { isValid: true, hint: null };
  }, [
    giftRecipient,
    user?.handle,
    resolvedProfiles,
    giftOccasion,
    giftCustomOccasion,
    giftVaultSymbol,
    selectedGiftVault,
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

  const handleCreateCircle = async (e: React.FormEvent) => {
    e.preventDefault();
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

    setIsSubmittingCircle(true);
    try {
      const cleanMembers = effectiveMembers.map((m) => ({
        handle: m.handle.trim().replace(/^@+/, ''),
        percentageShare: parseFloat(m.percentage),
      }));
      const created =
        user?.custodyMode === 'self'
          ? await api.createCircleSelfCustody({
              name: circleName.trim(),
              purpose: circlePurpose,
              customPurpose:
                circlePurpose === 'CUSTOM' ? circleCustomPurpose.trim() : undefined,
              targetAmountUsd: parseFloat(circleTargetUsd),
              vaultAsset: circleVaultSymbol,
              payoutHandle: user?.handle,
              members: cleanMembers,
              mode: circleCreateMode,
            })
          : await api.createCircle({
              name: circleName.trim(),
              purpose: circlePurpose,
              customPurpose:
                circlePurpose === 'CUSTOM' ? circleCustomPurpose.trim() : undefined,
              targetAmountUsd: parseFloat(circleTargetUsd),
              vaultAsset: circleVaultSymbol,
              payoutHandle: user?.handle,
              members: cleanMembers,
              mode: circleCreateMode,
              passkeyAssertion: await authorizeWithPasskey(
                `Create Circle "${circleName}" on ${circleVaultSymbol} Earn Vault`
              ),
            });
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
      setIsSubmittingCircle(false);
    }
  };

  const handleJoinCircle = async (circle: CircleView) => {
    setIsActionBusyId(circle.id);
    try {
      const updated =
        user?.custodyMode === 'self'
          ? await api.joinCircleSelfCustody(circle.id)
          : await api.joinCircle({
              circleId: circle.id,
              passkeyAssertion: await authorizeWithPasskey(
                `Sign & Join Circle "${circle.name}" (${circle.vaultSymbol} Earn Vault)`
              ),
            });
      setCircles((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      toast(
        `Signed & joined ${updated.name}! You can add funds to your share at any point.`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not sign into Circle.', 'error');
    } finally {
      setIsActionBusyId(null);
    }
  };

  const handleContribute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contributeCircle) return;
    setIsSubmittingContrib(true);
    try {
      const res =
        user?.custodyMode === 'self'
          ? await api.contributeToCircleSelfCustody({
              circleId: contributeCircle.id,
              originAsset: contribOriginAsset,
              amount: contribAmount.trim(),
            })
          : await api.contributeToCircle({
              circleId: contributeCircle.id,
              originAsset: contribOriginAsset,
              amount: contribAmount.trim(),
              fundingMode: 'BALANCE',
              passkeyAssertion: await authorizeWithPasskey(
                `Add ${contribAmount} to ${contributeCircle.name}`
              ),
            });
      setCircles((prev) => prev.map((c) => (c.id === res.circle.id ? res.circle : c)));
      setContributeCircle(null);
      setContribAmount('');
      refreshOnchain();
      const addedLabel =
        (res as any).sharesAddedFormatted || (res as any).sharesAdded || contribAmount.trim();
      toast(
        (res as any).status === 'PENDING_FUNDING'
          ? `Contribution submitted to ${res.circle.name}; awaiting vault settlement.`
          : `Added ${addedLabel} ${res.circle.vaultSymbol} into ${res.circle.name}!`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Unable to process Circle contribution.', 'error');
    } finally {
      setIsSubmittingContrib(false);
    }
  };

  const handleSettleCircle = async (circle: CircleView) => {
    setIsActionBusyId(circle.id);
    try {
      const res =
        user?.custodyMode === 'self'
          ? await api.settleCircleSelfCustody(circle.id)
          : await api.settleCircle({
              circleId: circle.id,
              passkeyAssertion: await authorizeWithPasskey(
                `Settle Circle "${circle.name}" to @${circle.payoutHandle}`
              ),
            });
      setCircles((prev) => prev.map((c) => (c.id === res.circle.id ? res.circle : c)));
      refreshOnchain();
      const settledLabel = (res as any).sharesSettledFormatted || (res as any).payoutShares;
      const settledPayout = (res as any).payoutHandle || circle.payoutHandle;
      toast(
        `Settled ${settledLabel} ${circle.vaultSymbol} (principal + yield) to @${settledPayout}!`,
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
      const res =
        user?.custodyMode === 'self'
          ? await api.dissolveCircleSelfCustody(circle.id)
          : await api.dissolveCircle({
              circleId: circle.id,
              passkeyAssertion: await authorizeWithPasskey(
                `Activate dissolve for Circle "${circle.name}" (requires all contributors)`
              ),
            });
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
      setIsActionBusyId(null);
    }
  };

  const handleCreateGift = async (e: React.FormEvent) => {
    e.preventDefault();
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

    setIsSubmittingGift(true);
    try {
      const created =
        user?.custodyMode === 'self'
          ? await api.createGiftSelfCustody({
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
              mode: giftCreateMode,
            })
          : await api.createGift({
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
              fundingMode: 'BALANCE',
              mode: giftCreateMode,
              passkeyAssertion: await authorizeWithPasskey(
                `Gift ${giftAmount} in ${giftVaultSymbol} Earn Vault to @${cleanRecip}`
              ),
            });
      setSentGifts((prev) => [created, ...prev]);
      setIsCreateGiftOpen(false);
      setGiftRecipient('');
      setGiftCustomOccasion('');
      setGiftMessage('');
      setActiveTab('gifts');
      refreshOnchain();
      toast(
        `Gifted ${created.vaultSymbol} (${created.estimatedApyPct}% APY) to @${created.recipientHandle}!`,
        'success'
      );
    } catch (err: any) {
      toast(err?.message || 'Could not create gift. Check balance and @handle.', 'error');
    } finally {
      setIsSubmittingGift(false);
    }
  };

  const handleClaimGift = async (gift: AuthenticatedGiftView) => {
    setIsActionBusyId(gift.id);
    const myHandle = (user?.handle || '').toLowerCase();
    const isSenderReclaim =
      gift.role === 'SENDER' ||
      Boolean(
        gift.senderCanReclaim &&
          myHandle === gift.senderHandle.toLowerCase() &&
          myHandle !== gift.recipientHandle.toLowerCase()
      );
    const applyGiftUpdate = (updated: AuthenticatedGiftView) => {
      setReceivedGifts((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      setSentGifts((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
    };
    try {
      if (user?.custodyMode === 'self') {
        if (isSenderReclaim) {
          const res = await api.reclaimGiftSelfCustody(gift.id);
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
          const res = await api.claimGiftSelfCustody(gift.id);
          applyGiftUpdate(res.gift);
          refreshOnchain();
          toast(
            `Unwrapped ${res.sharesClaimed} ${res.gift.vaultSymbol} (principal + yield) into your vault!`,
            'success'
          );
        }
        return;
      }

      const assertion = await authorizeWithPasskey(
        isSenderReclaim
          ? `Reclaim unclaimed ${gift.sharesFormatted} ${gift.vaultSymbol} gift`
          : `Unwrap & claim ${gift.sharesFormatted} ${gift.vaultSymbol} gift from @${gift.senderHandle}`
      );
      const res = isSenderReclaim
        ? await api.reclaimGiftServer({
            giftId: gift.id,
            passkeyAssertion: assertion,
          })
        : await api.claimGift({
            giftId: gift.id,
            passkeyAssertion: assertion,
          });
      applyGiftUpdate(res.gift);
      refreshOnchain();
      toast(
        isSenderReclaim
          ? `Reclaimed ${res.sharesClaimed} ${res.gift.vaultSymbol} back to your vault!`
          : `Unwrapped ${res.sharesClaimed} ${res.gift.vaultSymbol} (principal + yield) into your vault!`,
        'success'
      );
    } catch (err: any) {
      toast(
        err?.message ||
          (isSenderReclaim ? 'Could not reclaim gift.' : 'Could not unwrap gift.'),
        'error'
      );
    } finally {
      setIsActionBusyId(null);
    }
  };

  // Summary metrics
  const totalCirclesPrincipalCents = useMemo(
    () =>
      circles.reduce(
        (acc, c) => acc + (c.contributedUsdCents ?? c.totalContributedUsdCents ?? 0),
        0
      ),
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
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-display font-extrabold text-stone-950 tracking-tight">
                Circles & Earn Gifting
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-mono font-bold uppercase tracking-wider">
                Intents Earn
              </span>
            </div>
            <p className="text-xs text-stone-500">
              Pool shared goals by percentage or send timelocked Intents Earn Vault gifts to any @handle.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateGiftOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-900 text-xs font-display font-bold transition-all cursor-pointer shadow-2xs"
          >
            <Gift className="w-3.5 h-3.5 text-amber-600" />
            <span>Gift a Vault</span>
          </button>
          <button
            type="button"
            onClick={() => setIsCreateCircleOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-all cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
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
            <CircleDot className="w-3.5 h-3.5" />
            <span>Circles ({circles.length})</span>
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
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-stone-200 text-emerald-600 flex items-center justify-center mx-auto">
                <Users className="w-6 h-6" />
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
                <Plus className="w-4 h-4" />
                <span>Create Your First Circle</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
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

                return (
                  <div
                    key={circle.id}
                    className="relative overflow-hidden bg-white border border-stone-200 rounded-2xl shadow-2xs"
                  >
                    {/* TICKET TOP STRIP */}
                    <div className="px-5 py-2.5 bg-stone-50 border-b border-stone-200 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-stone-200/80 text-stone-800 font-mono text-[10px] font-bold uppercase tracking-wider">
                          {circle.purposeLabel}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-[10px] font-bold">
                          {circle.vaultSymbol} • {circle.estimatedApyPct}% APY
                        </span>
                        {circle.contractMode === 'contract' ? (
                          <Link
                            to={`/verify?kind=circle&id=${encodeURIComponent(
                              circle.onchainCircleId || circle.id
                            )}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100/80 hover:bg-emerald-200/80 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/80 border border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300 font-mono text-[10px] font-bold transition-colors"
                            title="Inspect Circle signers and balances on circle.uprail.near"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            <span>Contract Verified</span>
                          </Link>
                        ) : circle.contractMode === 'escrow' ? (
                          <span className="px-2 py-0.5 rounded bg-stone-100 border border-stone-200 text-stone-600 font-mono text-[10px] font-bold">
                            Escrow Vault
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-stone-400 tracking-widest uppercase">
                          #{ticketSerial}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                            circle.status === 'PENDING_SIGNATURES' || circle.status === 'ACTIVE'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : circle.status === 'GOAL_MET' ||
                                circle.status === 'SETTLED' ||
                                circle.status === 'COMPLETED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {circle.status === 'PENDING_SIGNATURES'
                            ? 'WAITING SIGNATURES'
                            : circle.status === 'GOAL_MET'
                            ? 'GOAL MET'
                            : circle.status}
                        </span>
                      </div>
                    </div>

                    {/* TICKET MAIN BODY */}
                    <div className="px-5 py-4 space-y-3.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <h3 className="text-lg font-display font-extrabold text-stone-950 leading-tight">
                            {circle.name}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-stone-500">
                            <span className="inline-flex items-center gap-1.5 text-stone-800 font-semibold">
                              <img
                                src={`https://unavatar.io/x/${circle.payoutHandle}`}
                                alt={`@${circle.payoutHandle}`}
                                className="w-4 h-4 rounded-full object-cover border border-stone-200 bg-stone-100"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                                }}
                              />
                              <span>Payout @{circle.payoutHandle}</span>
                            </span>
                            {circle.creatorHandle.toLowerCase() !==
                              circle.payoutHandle.toLowerCase() && (
                              <span>• By @{circle.creatorHandle}</span>
                            )}
                          </div>
                        </div>

                        <div className="sm:text-right">
                          <div className="text-xl font-display font-extrabold text-stone-950 tabular-nums">
                            {formatCentsUsd(circle.currentValueUsdCents)}{' '}
                            <span className="text-xs font-mono font-normal text-stone-400">
                              / {formatCentsUsd(circle.targetUsdCents)}
                            </span>
                          </div>
                          {hasPoolShares ? (
                            <div className="text-[11px] font-mono text-emerald-600">
                              +{formatCentsUsd(circle.yieldUsdCents)} yield ({circle.totalSharesFormatted}{' '}
                              {circle.vaultSymbol})
                            </div>
                          ) : (
                            <div className="text-[11px] font-mono text-stone-400">
                              Min deposit ${vaultMinUsd} USD
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Sleek Progress Track */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-mono uppercase tracking-wider text-stone-500">
                          <span>Funded</span>
                          <span className="font-bold text-stone-900">
                            {circleProgress.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-stone-100 overflow-hidden">
                          <div
                            className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, circleProgress)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* PERFORATED TICKET TEAR LINE WITH SIDE NOTCHES */}
                    <div className="relative flex items-center">
                      <div className="w-4 h-4 -ml-2 rounded-full bg-stone-100 border border-stone-200 shrink-0" />
                      <div className="w-full border-t-2 border-dashed border-stone-200" />
                      <div className="w-4 h-4 -mr-2 rounded-full bg-stone-100 border border-stone-200 shrink-0" />
                    </div>

                    {/* TICKET STUB (Participants for Group Circles + Action Bar) */}
                    <div className="px-5 py-3.5 bg-stone-50/60 space-y-3">
                      {!isSolo && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
                              Participants ({circle.members.length})
                            </span>
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
                              className="inline-flex items-center gap-1 text-[11px] font-mono text-stone-500 hover:text-stone-900 cursor-pointer"
                            >
                              {copiedId === circle.id ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>Invite Link</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {circle.members.map((m) => {
                              const memberPct = m.progressPct ?? m.fulfillmentPct ?? 0;
                              return (
                                <div
                                  key={m.id}
                                  className="px-3 py-2 rounded-xl bg-white border border-stone-200 flex items-center justify-between gap-2 text-xs"
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <img
                                      src={`https://unavatar.io/x/${m.handle}`}
                                      alt={`@${m.handle}`}
                                      className="w-4 h-4 rounded-full object-cover border border-stone-200 bg-stone-100 shrink-0"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                    <span className="font-mono font-bold text-stone-900 truncate">
                                      @{m.handle}
                                    </span>
                                    <span className="text-[10px] font-mono text-stone-400">
                                      ({m.percentageShare.toFixed(2).replace(/\.00$/, '')}%)
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                                    <span className="text-stone-600 tabular-nums">
                                      {formatCentsUsd(m.contributedUsdCents)}/
                                      {formatCentsUsd(m.quotaUsdCents)}
                                    </span>
                                    {m.hasApprovedDissolve && isCircleOpen && (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                                        Dissolve ✓
                                      </span>
                                    )}
                                    <span
                                      className={`px-1.5 py-0.5 rounded font-bold ${
                                        m.hasMetQuota
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                          : m.hasSigned
                                          ? 'bg-stone-100 text-stone-700'
                                          : 'bg-amber-50 text-amber-700'
                                      }`}
                                    >
                                      {m.hasMetQuota
                                        ? '100% ✓'
                                        : m.hasSigned
                                        ? `${memberPct.toFixed(0)}%`
                                        : 'Unsigned'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {/* Left Ticket Barcode & Pass Info */}
                        <div className="flex items-center gap-2.5">
                          <div
                            className="flex items-center gap-[2px] h-5 opacity-45 select-none"
                            aria-hidden="true"
                          >
                            <span className="w-[2px] h-full bg-stone-900" />
                            <span className="w-[1px] h-full bg-stone-900" />
                            <span className="w-[3px] h-full bg-stone-900" />
                            <span className="w-[1px] h-full bg-stone-900" />
                            <span className="w-[2px] h-full bg-stone-900" />
                            <span className="w-[1px] h-full bg-stone-900" />
                            <span className="w-[3px] h-full bg-stone-900" />
                            <span className="w-[2px] h-full bg-stone-900" />
                          </div>
                          <span className="text-[11px] font-mono text-stone-500">
                            {isSolo
                              ? 'Solo Vault Pass • 100% Share'
                              : `${circle.members.filter((m) => m.hasSigned).length}/${
                                  circle.members.length
                                } Signed`}
                          </span>
                        </div>

                        {/* Right Action Buttons */}
                        {isCircleOpen && (
                          <div className="flex flex-wrap items-center gap-2">
                            {circle.isMember && !circle.hasSigned && (
                              <button
                                type="button"
                                disabled={isActionBusyId === circle.id || isAuthorizing}
                                onClick={() => handleJoinCircle(circle)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-900 text-xs font-display font-bold transition-all cursor-pointer disabled:opacity-50"
                              >
                                <Fingerprint className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Sign & Join</span>
                              </button>
                            )}
                            {canAddFunds ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setContributeCircle(circle);
                                  setContribAmount('');
                                }}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-display font-bold transition-all cursor-pointer"
                              >
                                <ArrowUpRight className="w-3.5 h-3.5" />
                                <span>Add Funds</span>
                              </button>
                            ) : (
                              canParticipate &&
                              !allMembersSigned && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-mono">
                                  <Clock className="w-3.5 h-3.5" />
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
                                disabled={isActionBusyId === circle.id || isAuthorizing}
                                onClick={() => handleSettleCircle(circle)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-all cursor-pointer disabled:opacity-50"
                                title="Disburse pooled vault shares + yield to payout handle (1% protocol fee on payout)"
                              >
                                <Fingerprint className="w-3.5 h-3.5" />
                                <span>Settle</span>
                              </button>
                            )}
                            {canCallerDissolve && (
                              <button
                                type="button"
                                disabled={
                                  isActionBusyId === circle.id ||
                                  isAuthorizing ||
                                  Boolean(circle.hasApprovedDissolve)
                                }
                                onClick={() => handleDissolveCircle(circle)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-600 text-xs font-mono transition-all cursor-pointer disabled:opacity-60"
                                title="All contributors who funded the Circle must sign with their passkey to dissolve and refund pro-rata shares + yield"
                              >
                                <Fingerprint className="w-3 h-3" />
                                <span>
                                  {hasPoolShares
                                    ? circle.hasApprovedDissolve
                                      ? `Dissolve (${dissolveSigned}/${dissolveRequired})`
                                      : `Dissolve (${dissolveSigned}/${dissolveRequired})`
                                    : 'Dissolve'}
                                </span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
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
          {/* Received Gifts */}
          <div className="space-y-3">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-stone-500">
              Gifts Sent to You (@{user?.handle})
            </h2>
            {receivedGifts.length === 0 ? (
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-6 text-center text-xs text-stone-500">
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

                      <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono">
                        <div className="flex items-center gap-2 text-stone-700">
                          {unlocked ? (
                            <Unlock className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Lock className="w-4 h-4 text-amber-600" />
                          )}
                          <span>
                            {gift.status === 'CLAIMED'
                              ? 'Unwrapped & Claimed'
                              : gift.status === 'RECLAIMED'
                              ? 'Reclaimed by Sender'
                              : formatCountdown(gift.timelockUntil, nowMs)}
                          </span>
                        </div>
                        <span className="text-stone-500">
                          {gift.sharesFormatted} {gift.vaultSymbol}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <Link
                            to={`/gift/${gift.id}`}
                            className="text-xs font-mono text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
                          >
                            <span>View Gift Card</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                          {gift.contractMode === 'contract' && (
                            <Link
                              to={`/verify?kind=gift&id=${encodeURIComponent(
                                gift.onchainGiftId || gift.id
                              )}`}
                              className="text-xs font-mono font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"
                            >
                              <ShieldCheck className="w-3 h-3" />
                              <span>Verify On-Chain</span>
                            </Link>
                          )}
                        </div>

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
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-6 text-center space-y-3">
                <p className="text-xs text-stone-500">
                  Gift a live compounding Earn Vault to any @handle for birthdays, Christmas, anniversaries, or custom occasions.
                </p>
                <button
                  type="button"
                  onClick={() => setIsCreateGiftOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-950 text-white text-xs font-display font-bold cursor-pointer"
                >
                  <Gift className="w-3.5 h-3.5" />
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

                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-[11px] font-mono text-stone-600">
                      <span>
                        Unlocks: {new Date(gift.timelockUntil).toLocaleString()}
                      </span>
                      <span className="font-bold uppercase text-stone-900">{gift.status}</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
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
                        {gift.contractMode === 'contract' ? (
                          <Link
                            to={`/verify?kind=gift&id=${encodeURIComponent(
                              gift.onchainGiftId || gift.id
                            )}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 text-emerald-700 dark:text-emerald-300 text-xs font-mono font-bold"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            <span>Verify</span>
                          </Link>
                        ) : gift.contractMode === 'escrow' ? (
                          <span className="px-2 py-1 rounded-lg bg-stone-100 border border-stone-200 text-stone-500 text-[10px] font-mono font-bold">
                            Escrow
                          </span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(gift.canClaim ||
                          gift.senderCanReclaim ||
                          (gift.status === 'LOCKED' &&
                            nowMs >= gift.timelockUntil + 30 * 24 * 60 * 60 * 1000)) && (
                          <button
                            type="button"
                            disabled={isActionBusyId === gift.id || isAuthorizing}
                            onClick={() => handleClaimGift(gift)}
                            title="30 days have passed since unlock and recipient has not claimed yet — reclaim vault shares + yield back to your account"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 text-xs font-display font-bold cursor-pointer"
                          >
                            <Fingerprint className="w-3 h-3" />
                            <span>Reclaim Unclaimed</span>
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

      {/* Intents Earn Vaults List (Placed under Create Your Circle / Active Circles card) */}
      <div className="bg-stone-50 border border-stone-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-stone-700">
              Intents Earn Vaults ({vaults.length})
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
                className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors cursor-pointer ${
                  isSelected ? 'bg-emerald-50/70' : 'hover:bg-stone-50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isSelected ? 'bg-emerald-600' : 'bg-stone-300'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-extrabold text-sm text-stone-950">
                        {v.symbol}
                      </span>
                      <span className="text-xs font-medium text-stone-700 truncate">
                        {v.name}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 uppercase flex-shrink-0">
                        {v.chainName}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-stone-500 truncate">
                      {v.protocol} • Min ${v.minDepositUsd} USD
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-xs font-bold">
                    {v.estimatedApyPct.toFixed(1)}% APY
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODAL 1: CREATE CIRCLE (Sanitized, Dropdown Reason + Custom, Auto-100% Solo) */}
      {isCreateCircleOpen && (
        <Portal>
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-md">
            <div className="bg-white border border-stone-200 rounded-3xl max-w-lg w-full p-4 sm:p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-stone-100 border border-stone-200 text-emerald-600 flex items-center justify-center">
                    <CircleDot className="w-5 h-5" />
                  </div>
                  <h2 className="text-lg font-display font-extrabold text-stone-950">
                    New Earn Circle
                  </h2>
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
                  <div>
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

                  <div>
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
                    value={circleVaultSymbol}
                    onChange={(val) => setCircleVaultSymbol(val as EarnVaultSymbol)}
                    options={vaults.map((v) => ({
                      value: v.symbol as EarnVaultSymbol,
                      label: v.name,
                      badge: `${v.estimatedApyPct}% APY`,
                    }))}
                  />
                </div>

                {/* Member Percentage Quotas */}
                <div className="space-y-2">
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
                        <Plus className="w-3 h-3" /> Add @handle
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {circleMembers.map((m, idx) => {
                      const isSolo = circleMembers.length === 1;
                      const pct = isSolo ? 100 : parseFloat(m.percentage) || 0;
                      const usdShare = ((parseFloat(circleTargetUsd) || 0) * pct) / 100;
                      const cleanH = m.handle.trim().replace(/^@+/, '').toLowerCase();
                      const prof = cleanH ? resolvedProfiles[cleanH] : undefined;
                      return (
                        <div key={idx} className="flex items-center gap-2 min-w-0">
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
                                <RefreshCw className="w-3.5 h-3.5 text-stone-400 animate-spin" />
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
                          <div className="relative w-20 sm:w-24 flex-shrink-0">
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
                              className={`w-full px-2 py-2 pr-6 rounded-xl border border-stone-300 text-sm sm:text-xs font-mono font-normal text-right ${
                                isSolo ? 'opacity-75 cursor-not-allowed' : ''
                              }`}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono text-stone-400">
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
                              className="p-1.5 text-stone-400 hover:text-red-600 cursor-pointer flex-shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono pt-1">
                    <span className="text-stone-500">Total Share Allocation:</span>
                    <span
                      className={`font-bold ${
                        Math.abs(totalMemberPercentage - 100) <= 0.01
                          ? 'text-emerald-600'
                          : 'text-red-600'
                      }`}
                    >
                      {totalMemberPercentage.toFixed(2)}% / 100%
                    </span>
                  </div>
                </div>

                <CustodySettlementToggle
                  isSelfCustody={user?.custodyMode === 'self'}
                  value={circleCreateMode}
                  onChange={setCircleCreateMode}
                  kindLabel="Circle pool"
                />

                {circleValidation.hint && (
                  <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-mono text-amber-800">
                    {circleValidation.hint}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!circleValidation.isValid || isSubmittingCircle || isAuthorizing}
                  className="w-full py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Fingerprint className="w-4 h-4" />
                  <span>
                    {isSubmittingCircle || isAuthorizing
                      ? 'Signing with Passkey...'
                      : 'Sign with Passkey & Launch Circle'}
                  </span>
                </button>
              </form>
            </div>
          </div>
        </Portal>
      )}

      {/* MODAL 2: ADD FUNDS TO CIRCLE (Supports repeated partial or full additions at any point) */}
      {contributeCircle && (
        <Portal>
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-md">
            <div className="bg-white border border-stone-200 rounded-3xl max-w-md w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-display font-extrabold text-stone-950">
                    Add Funds to {contributeCircle.name}
                  </h2>
                  <p className="text-xs text-stone-500">
                    Compounds in {contributeCircle.vaultSymbol} ({contributeCircle.estimatedApyPct}% APY). Add partial amounts or complete your share anytime.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setContributeCircle(null)}
                  className="p-1.5 text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
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

                {contribValidation.hint && (
                  <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-mono text-amber-800">
                    {contribValidation.hint}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!contribValidation.isValid || isSubmittingContrib || isAuthorizing}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Fingerprint className="w-4 h-4" />
                  <span>
                    {isSubmittingContrib || isAuthorizing
                      ? 'Signing & Adding to Vault...'
                      : `Sign with Passkey & Add to ${contributeCircle.vaultSymbol}`}
                  </span>
                </button>
              </form>
            </div>
          </div>
        </Portal>
      )}

      {/* MODAL 3: SEND TIMELOCKED EARN VAULT GIFT (Sanitized, Dropdown Occasion + Custom) */}
      {isCreateGiftOpen && (
        <Portal>
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-md">
            <div className="bg-white border border-stone-200 rounded-3xl max-w-lg w-full p-4 sm:p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
                    <Gift className="w-5 h-5" />
                  </div>
                  <h2 className="text-lg font-display font-extrabold text-stone-950">
                    Gift an Intents Earn Vault
                  </h2>
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
                              <RefreshCw className="w-3.5 h-3.5 text-stone-400 animate-spin" />
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
                    value={giftVaultSymbol}
                    onChange={(val) => setGiftVaultSymbol(val as EarnVaultSymbol)}
                    options={vaults.map((v) => ({
                      value: v.symbol as EarnVaultSymbol,
                      label: v.name,
                      badge: `${v.estimatedApyPct}% APY`,
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
                        ~{giftQuote.estimatedSharesOut} {giftQuote.vaultSymbol} (
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

                <CustodySettlementToggle
                  isSelfCustody={user?.custodyMode === 'self'}
                  value={giftCreateMode}
                  onChange={setGiftCreateMode}
                  kindLabel="timelocked gift"
                />

                {giftValidation.hint && (
                  <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-mono text-amber-800">
                    {giftValidation.hint}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!giftValidation.isValid || isSubmittingGift || isAuthorizing}
                  className="w-full py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Fingerprint className="w-4 h-4" />
                  <span>
                    {isSubmittingGift || isAuthorizing
                      ? 'Signing & Locking Gift...'
                      : `Sign with Passkey & Send ${giftVaultSymbol} Gift`}
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
