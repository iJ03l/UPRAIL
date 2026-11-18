'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Copy,
  Check,
  CircleNotch,
  LockOpen,
  ArrowLeft,
  CheckCircle,
  Clock,
  CaretDown,
  WarningCircle,
  ArrowSquareOut,
  Sun,
  Moon,
  Robot,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { GlitchLogo } from '../components/GlitchLogo';
import { useTheme } from '../components/ThemeProvider';
import { SolidCoffeeIcon } from '../components/CoffeeModal';
import { TokenIcon } from '../components/TokenIcon';
import { ChainLogo } from '../components/ChainLogo';
import { Badge } from '../components/Badge';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { useToast } from '../components/Toast';
import type {
  CoffeeCreatorProfile,
  CoffeeTokenOption,
  CoffeeDonation,
} from '../types';

const TOKEN_PRESETS: Record<string, number[]> = {
  USDC: [2, 5, 10, 25],
  USDT: [2, 5, 10, 25],
  USDG: [2, 5, 10, 25],
  NEAR: [0.5, 1, 2, 5],
  SOL: [0.02, 0.05, 0.1, 0.25],
  ETH: [0.001, 0.005, 0.01, 0.05],
  BTC: [0.00005, 0.0001, 0.0005, 0.001],
  BNB: [0.005, 0.01, 0.05, 0.1],
  POL: [5, 10, 25, 50],
  AVAX: [0.1, 0.25, 0.5, 1],
  SUI: [1, 2, 5, 10],
  PRL: [1, 2, 5, 10],
  XRP: [1, 2, 5, 10],
  DOGE: [10, 25, 50, 100],
};

function getPresetsForToken(symbol: string, priceUsd?: number): number[] {
  const sym = symbol.trim().toUpperCase();
  if (TOKEN_PRESETS[sym]) return TOKEN_PRESETS[sym];
  if (priceUsd && priceUsd > 0) {
    return [2, 5, 10, 25].map((usd) => {
      const raw = usd / priceUsd;
      if (raw >= 10) return Math.round(raw);
      if (raw >= 1) return Number(raw.toFixed(1));
      return Number(raw.toPrecision(2));
    });
  }
  return [1, 2, 5, 10];
}

function extractHandleFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const search = new URLSearchParams(window.location.search);
  const qHandle = search.get('handle') || search.get('u');
  if (qHandle) return qHandle.trim().replace(/^@+/, '').toLowerCase();

  const parts = window.location.pathname
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  if (parts[0].toLowerCase() === 'tip' && parts[1]) {
    return parts[1].replace(/^@+/, '').toLowerCase();
  }
  const last = parts[parts.length - 1];
  if (last.toLowerCase() === 'tip') return '';
  return last.replace(/^@+/, '').toLowerCase();
}

function formatCountdown(expiresAt: number, now: number): string {
  const diff = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function shortenId(id: string): string {
  if (!id || id.length <= 18) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

export const PublicCoffeeView: React.FC = () => {
  const { toast } = useToast();
  const { resolved, setMode } = useTheme();
  const isDark = resolved === 'dark';

  const [handle, setHandle] = useState<string>('');
  const [profile, setProfile] = useState<CoffeeCreatorProfile | null>(null);
  const [tokens, setTokens] = useState<CoffeeTokenOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Selection state — amount is always in the selected token's native units
  const [selectedPreset, setSelectedPreset] = useState<number | 'custom'>(5);
  const [customAmount, setCustomAmount] = useState<string>('15');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('USDC');
  const [selectedChain, setSelectedChain] = useState<string>('base');
  const [showMoreTokens, setShowMoreTokens] = useState(false);
  const [showMoreChains, setShowMoreChains] = useState(false);

  // Ephemeral deposit & standby state
  const [isCreating, setIsCreating] = useState(false);
  const [donateError, setDonateError] = useState<string | null>(null);
  const [donation, setDonation] = useState<CoffeeDonation | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);
  const [copiedReceiptId, setCopiedReceiptId] = useState(false);
  const [showAgentInfo, setShowAgentInfo] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const h = extractHandleFromLocation();
    setHandle(h);
    if (!h) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    const search = new URLSearchParams(window.location.search);
    const receiptId = search.get('receipt');

    Promise.all([
      api.getCoffeeProfile(h),
      api.getCoffeeOptions(),
      receiptId ? api.getCoffeeDonationStatus(receiptId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([prof, opts, existingReceipt]) => {
        if (cancelled) return;
        setProfile(prof);
        setTokens(opts);
        if (existingReceipt) {
          setDonation(existingReceipt);
        }
        if (opts.length > 0) {
          const usdc = opts.find((t) => t.symbol === 'USDC') || opts[0];
          setSelectedSymbol(usdc.symbol);
          const defaultChain =
            usdc.chains.find((c) => c.chain === 'base') || usdc.chains[0];
          if (defaultChain) setSelectedChain(defaultChain.chain);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setLoadError(err?.message || 'Unable to load creator page');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Poll standby status while donation is waiting/processing/settling
  useEffect(() => {
    if (!donation) return;
    if (
      donation.status === 'COMPLETED' ||
      donation.status === 'FAILED' ||
      donation.status === 'EXPIRED'
    ) {
      return;
    }

    const timer = setInterval(() => {
      setNowMs(Date.now());
      api
        .getCoffeeDonationStatus(donation.id)
        .then((fresh) => {
          setDonation(fresh);
        })
        .catch(() => {});
    }, 3500);

    return () => clearInterval(timer);
  }, [donation?.id, donation?.status]);

  const pinnedStables = useMemo(
    () => tokens.filter((t) => t.symbol === 'USDC' || t.symbol === 'USDT'),
    [tokens]
  );

  const otherTokens = useMemo(
    () => tokens.filter((t) => t.symbol !== 'USDC' && t.symbol !== 'USDT'),
    [tokens]
  );

  const activeToken = useMemo(
    () => tokens.find((t) => t.symbol === selectedSymbol) || tokens[0] || null,
    [tokens, selectedSymbol]
  );

  const availableChains = useMemo(() => activeToken?.chains || [], [activeToken]);

  const activeChainObj = useMemo(
    () =>
      availableChains.find((c) => c.chain === selectedChain) ||
      availableChains[0] ||
      null,
    [availableChains, selectedChain]
  );

  const isStableSelected = Boolean(
    activeToken?.isStable || activeToken?.symbol === 'USDC' || activeToken?.symbol === 'USDT'
  );

  const tokenPresets = useMemo(
    () => getPresetsForToken(activeToken?.symbol || 'USDC', activeChainObj?.priceUsd),
    [activeToken?.symbol, activeChainObj?.priceUsd]
  );

  const effectiveTokenAmountStr = useMemo(() => {
    if (selectedPreset !== 'custom') return String(selectedPreset);
    return customAmount.trim();
  }, [selectedPreset, customAmount]);

  const effectiveTokenAmount = useMemo(() => {
    const parsed = parseFloat(effectiveTokenAmountStr);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [effectiveTokenAmountStr]);

  const effectiveUsdEstimate = useMemo(() => {
    if (effectiveTokenAmount <= 0) return 0;
    if (isStableSelected) return effectiveTokenAmount;
    const price = activeChainObj?.priceUsd;
    return price && price > 0 ? effectiveTokenAmount * price : 0;
  }, [effectiveTokenAmount, isStableSelected, activeChainObj?.priceUsd]);

  const belowMinimumUsd = useMemo(() => {
    if (effectiveTokenAmount <= 0) return true;
    if (isStableSelected) return effectiveTokenAmount < 1;
    const price = activeChainObj?.priceUsd;
    if (price && price > 0) return effectiveTokenAmount * price < 0.99;
    return false;
  }, [effectiveTokenAmount, isStableSelected, activeChainObj?.priceUsd]);

  const handleSelectToken = (symbol: string) => {
    setSelectedSymbol(symbol);
    setDonateError(null);
    const nextToken = tokens.find((t) => t.symbol === symbol);
    let nextChainObj = nextToken?.chains[0];
    if (nextToken && nextToken.chains.length > 0) {
      const keep = nextToken.chains.find((c) => c.chain === selectedChain);
      if (keep) {
        nextChainObj = keep;
      } else {
        const preferred =
          nextToken.chains.find((c) => c.chain === 'base') || nextToken.chains[0];
        nextChainObj = preferred;
        setSelectedChain(preferred.chain);
      }
    }
    const presets = getPresetsForToken(symbol, nextChainObj?.priceUsd);
    const price = nextChainObj?.priceUsd;
    const isStable = symbol === 'USDC' || symbol === 'USDT';
    const defaultChoice =
      presets.find((p, idx) => idx >= 1 && (isStable || !price || p * price >= 1)) ??
      presets.find((p) => isStable || !price || p * price >= 1) ??
      presets[1] ??
      presets[0];
    setSelectedPreset(defaultChoice);
    setCustomAmount(String(presets[presets.length - 1] ?? defaultChoice));
  };

  const handleConfirm = async () => {
    if (!profile || !activeToken || !activeChainObj) return;
    if (effectiveTokenAmount <= 0) {
      setDonateError(`Enter a valid ${activeToken.symbol} amount.`);
      return;
    }
    if (belowMinimumUsd) {
      const minHint =
        !isStableSelected && activeChainObj.priceUsd && activeChainObj.priceUsd > 0
          ? ` (at least ~${(1 / activeChainObj.priceUsd)
              .toFixed(Math.min(activeChainObj.decimals, 4))
              .replace(/\.?0+$/, '')} ${activeToken.symbol})`
          : '';
      setDonateError(`Minimum amount is $1.00 USD${minHint}.`);
      return;
    }
    setIsCreating(true);
    setDonateError(null);
    try {
      const res = await api.createCoffeeDonation({
        handle: profile.handle,
        amountToken: effectiveTokenAmountStr,
        ...(isStableSelected ? { amountUsd: effectiveTokenAmount } : {}),
        originSymbol: activeToken.symbol,
        originChain: activeChainObj.chain,
        originAsset: activeChainObj.assetId,
        targetSymbol: activeToken.symbol === 'USDT' ? 'USDT' : 'USDC',
      });
      setDonation(res);
      setNowMs(Date.now());
    } catch (err: any) {
      setDonateError(err?.message || 'Could not generate deposit address. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const copyText = async (text: string, which: 'addr' | 'memo' | 'receipt' | 'agent') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'addr') {
        setCopiedAddr(true);
        setTimeout(() => setCopiedAddr(false), 2000);
      } else if (which === 'memo') {
        setCopiedMemo(true);
        setTimeout(() => setCopiedMemo(false), 2000);
      } else if (which === 'receipt') {
        setCopiedReceiptId(true);
        setTimeout(() => setCopiedReceiptId(false), 2000);
      }
      toast('Copied to clipboard');
    } catch {
      toast('Failed to copy');
    }
  };

  const agentCurlSnippet = profile
    ? `curl -sS -X POST https://uprail.world/${profile.handle} -H "Content-Type: application/json" -d '${
        isStableSelected
          ? JSON.stringify({
              amountUsd: effectiveTokenAmount || 5,
              originSymbol: activeToken?.symbol || 'USDC',
              originChain: activeChainObj?.chain || 'base',
            })
          : JSON.stringify({
              amountToken: effectiveTokenAmountStr || '1',
              originSymbol: activeToken?.symbol || 'NEAR',
              originChain: activeChainObj?.chain || 'near',
            })
      }'`
    : '';

  const structuredPaymentMeta = profile
    ? JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'PayAction',
        protocol: 'uprail-coffee-v1',
        recipient: `@${profile.handle}`,
        url: `https://uprail.world/${profile.handle}`,
        authRequired: false,
        payEndpoint: `https://uprail.world/${profile.handle}`,
        discoveryEndpoint: `https://uprail.world/${profile.handle}?format=json`,
        acceptedBody: {
          amountToken: 'string | number (exact origin token amount, recommended)',
          amountUsd: 'number (>= 1, alternative for USD quotes)',
          originSymbol: 'USDC | USDT | SOL | ETH | NEAR | BTC',
          originChain: 'base | arbitrum | solana | ethereum | polygon | near | ...',
        },
        statusEndpointTemplate: 'https://api.uprail.world/api/coffee/status/{id}',
      })
    : null;

  return (
    <div
      className="min-h-screen bg-surface text-stone-900 flex flex-col justify-between font-sans selection:bg-stone-900 selection:text-white"
      data-uprail-agent-pay={profile?.enabled ? `https://uprail.world/${profile.handle}` : undefined}
    >
      {structuredPaymentMeta && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredPaymentMeta }}
        />
      )}

      {/* Responsive Header — Real UPRAIL Logo, Fixed Icon Pill & Theme Toggle */}
      <header className="sticky top-0 z-30 w-full border-b border-stone-200/80 bg-surface-glass backdrop-blur-md">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-10 h-16 sm:h-[72px] flex items-center justify-between gap-2">
          <GlitchLogo href="/" size="md" hideWordmarkOnMobile className="flex-shrink-0" />

          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge tone="neutral" icon={<LockOpen weight="fill" className="w-3 h-3" />}>
              No login needed
            </Badge>

            <button
              type="button"
              onClick={() => setMode(isDark ? 'light' : 'dark')}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-11 h-11 rounded-full bg-white hover:bg-stone-100 border border-stone-200/80 flex items-center justify-center text-stone-600 hover:text-stone-950 transition-colors cursor-pointer"
            >
              {isDark ? <Sun weight="fill" className="w-3.5 h-3.5" /> : <Moon weight="fill" className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Centered Container */}
      <main className="flex-1 flex items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-md space-y-3">
          {isLoading ? (
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm p-10 flex flex-col items-center justify-center gap-3">
              <CircleNotch weight="bold" className="w-6 h-6 animate-spin text-stone-400" />
              <p className="text-xs font-mono text-stone-500">Loading creator page…</p>
            </div>
          ) : loadError ? (
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm p-8 text-center space-y-4">
              <WarningCircle weight="fill" className="w-8 h-8 text-red-500 mx-auto" />
              <p className="text-sm text-stone-700">{loadError}</p>
            </div>
          ) : !profile?.found ? (
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto text-stone-500">
                <SolidCoffeeIcon className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg font-display font-extrabold text-stone-950">
                  {handle ? `@${handle} isn’t on UPRAIL yet` : 'Creator not found'}
                </h1>
                <p className="text-xs text-stone-500 leading-relaxed">
                  You can still send money to any X handle privately on UPRAIL.
                </p>
              </div>
              <a
                href="https://app.uprail.world"
                className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-colors"
              >
                <span>Open app.uprail.world</span>
                <ArrowSquareOut weight="fill" className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : !profile.enabled ? (
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm p-8 text-center space-y-4">
              {profile.avatarUrl && (
                <img
                  src={profile.avatarUrl}
                  alt={profile.handle}
                  className="w-14 h-14 rounded-full mx-auto border border-stone-200 object-cover"
                />
              )}
              <div className="space-y-1">
                <h1 className="text-lg font-display font-extrabold text-stone-950">
                  @{profile.handle}
                </h1>
                <p className="text-xs text-stone-500 leading-relaxed">
                  This creator hasn’t activated their payment page yet.
                </p>
              </div>
              <a
                href="https://app.uprail.world/send"
                className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-colors"
              >
                <span>Send via UPRAIL App</span>
              </a>
            </div>
          ) : donation ? (
            /* ─── STANDBY WALLET OR MINIMAL RECEIPT VIEW ───────────────────── */
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm overflow-hidden animate-in fade-in duration-200">
              {/* Top Strip */}
              <div className="px-6 py-4 bg-stone-50/80 border-b border-stone-100 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setDonation(null)}
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-stone-500 hover:text-stone-950 transition-colors cursor-pointer"
                >
                  <ArrowLeft weight="bold" className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <div className="flex items-center gap-2">
                  {profile.avatarUrl && (
                    <img
                      src={profile.avatarUrl}
                      alt={profile.handle}
                      className="w-5 h-5 rounded-full object-cover border border-stone-200"
                    />
                  )}
                  <span className="text-xs font-display font-bold text-stone-900">
                    @{profile.handle}
                  </span>
                </div>
              </div>

              {donation.status === 'COMPLETED' ? (
                /* ─── MINIMAL COFFEE RECEIPT (ZERO MENTION OF ESCROW) ──────── */
                <div className="p-6 sm:p-7 space-y-6">
                  <div className="text-center space-y-2.5">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600">
                      <CheckCircle weight="fill" className="w-7 h-7" />
                    </div>
                    <Badge tone="ok">Receipt · Delivered</Badge>
                    <div className="text-3xl font-display font-extrabold text-stone-950 tracking-tight tabular-nums font-mono">
                      {donation.estimatedNetOut} {donation.targetSymbol}
                    </div>
                    <p className="text-xs text-stone-500">
                      Delivered privately to <span className="font-semibold text-stone-900">@{donation.recipientHandle}</span>
                    </p>
                  </div>

                  {/* Minimal Hairline Receipt Table */}
                  <div className="rounded-2xl bg-stone-50 border border-stone-200/80 divide-y divide-stone-200/70 text-xs font-mono">
                    <div className="flex items-center justify-between px-4 py-3 gap-2">
                      <span className="text-stone-500">To</span>
                      <span className="font-bold text-stone-900">@{donation.recipientHandle}</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 gap-2">
                      <span className="text-stone-500">Paid</span>
                      <span className="font-semibold text-stone-900 tabular-nums">
                        {donation.amountToSend} {donation.originSymbol}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 gap-2">
                      <span className="text-stone-500">Network</span>
                      <span className="font-semibold text-stone-900">{donation.originChainName}</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 gap-2">
                      <span className="text-stone-500">Receipt</span>
                      <button
                        type="button"
                        onClick={() => void copyText(donation.id, 'receipt')}
                        className="inline-flex items-center gap-1.5 font-semibold text-stone-900 hover:text-stone-600 cursor-pointer"
                      >
                        <span>{shortenId(donation.id)}</span>
                        {copiedReceiptId ? (
                          <Check weight="bold" className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy weight="fill" className="w-3 h-3 text-stone-400" />
                        )}
                      </button>
                    </div>
                    {donation.payoutTxHash && !donation.payoutTxHash.startsWith('agent:') && (
                      <div className="flex items-center justify-between px-4 py-3 gap-2">
                        <span className="text-stone-500">Proof</span>
                        <a
                          href={`https://nearblocks.io/txns/${donation.payoutTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-stone-900 hover:underline"
                        >
                          <span>{shortenId(donation.payoutTxHash)}</span>
                          <ArrowSquareOut weight="fill" className="w-3 h-3 text-stone-400" />
                        </a>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setDonation(null)}
                    className="w-full py-3.5 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Buy Another Coffee
                  </button>
                </div>
              ) : donation.status === 'FAILED' || donation.status === 'EXPIRED' ? (
                <div className="p-7 text-center space-y-4">
                  <WarningCircle weight="fill" className="w-10 h-10 text-amber-500 mx-auto" />
                  <div className="space-y-1">
                    <h2 className="text-lg font-display font-extrabold text-stone-950">
                      {donation.status === 'EXPIRED' ? 'Quote Expired' : 'Deposit Failed'}
                    </h2>
                    <p className="text-xs text-stone-500">
                      This one-time deposit address is no longer active. Generate a fresh one to continue.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDonation(null)}
                    className="w-full py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <div className="p-6 space-y-5">
                  {/* Live Standby Banner */}
                  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-amber-900 dark:text-amber-200">
                    <div className="flex items-center gap-2 text-xs font-mono font-semibold">
                      {donation.status === 'INCOMPLETE_DEPOSIT' ? (
                        <>
                          <WarningCircle weight="fill" className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                          <span>Partial deposit detected · Waiting for remainder or refund…</span>
                        </>
                      ) : donation.status === 'PROCESSING' || donation.status === 'SETTLING' ? (
                        <>
                          <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin text-amber-700 dark:text-amber-300" />
                          <span>Deposit detected · Delivering…</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                          <span>Standing by for deposit…</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] font-mono text-amber-700 dark:text-amber-300">
                      <Clock weight="fill" className="w-3 h-3" />
                      <span>{formatCountdown(donation.expiresAt, nowMs)}</span>
                    </div>
                  </div>

                  {/* Amount & Chain */}
                  <div className="text-center space-y-1">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-stone-400">
                      Send on {donation.originChainName}
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <TokenIcon symbol={donation.originSymbol} size="sm" />
                      <span className="text-2xl font-display font-extrabold text-stone-950 tabular-nums">
                        {donation.amountToSend} {donation.originSymbol}
                      </span>
                    </div>
                  </div>

                  {/* QR Code — crisp white backing for scannability in both dark & light themes */}
                  <div className="flex justify-center">
                    <div className="p-3 bg-white rounded-2xl border border-stone-200 shadow-2xs" style={{ backgroundColor: '#ffffff' }}>
                      <QRCodeDisplay value={donation.depositAddress} size={172} />
                    </div>
                  </div>

                  {/* Ephemeral Address Copy Box */}
                  <div className="space-y-2">
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">
                      One-Time Ephemeral Deposit Address ({donation.originChainName})
                    </label>
                    <div className="flex items-center gap-2 p-2.5 pl-3.5 rounded-2xl bg-stone-50 border border-stone-200">
                      <span className="font-mono text-xs text-stone-900 break-all flex-1 select-all leading-relaxed">
                        {donation.depositAddress}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyText(donation.depositAddress, 'addr')}
                        className="p-2 rounded-xl bg-white hover:bg-stone-100 border border-stone-200 text-stone-700 transition-colors cursor-pointer flex-shrink-0"
                        title="Copy address"
                      >
                        {copiedAddr ? (
                          <Check weight="bold" className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy weight="fill" className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {donation.depositMemo && (
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300 font-bold">
                        Required Memo / Tag
                      </label>
                      <div className="flex items-center gap-2 p-2.5 pl-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                        <span className="font-mono text-xs text-stone-950 flex-1 select-all">
                          {donation.depositMemo}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyText(donation.depositMemo!, 'memo')}
                          className="p-1.5 rounded-lg bg-white border border-amber-200 text-stone-700 cursor-pointer"
                        >
                          {copiedMemo ? (
                            <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy weight="fill" className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Settlement destination note (no fee percentage text) */}
                  <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-[11px] font-mono text-stone-500">
                    <span>@{donation.recipientHandle} receives</span>
                    <span className="font-semibold text-stone-900">
                      {donation.estimatedNetOut} {donation.targetSymbol}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ─── SELECTION FORM (AMOUNT + TOKEN + CHAIN + CONFIRM) ────────── */
            <>
              <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm p-5 sm:p-7 space-y-6">
                {/* Creator Identity */}
                <div className="flex items-center gap-3.5">
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt={profile.handle}
                      className="w-12 h-12 rounded-2xl object-cover border border-stone-200 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl bg-stone-950 text-white flex items-center justify-center font-display font-bold text-lg flex-shrink-0">
                      {profile.handle.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <Badge tone="neutral" icon={<SolidCoffeeIcon className="w-3 h-3" />} className="mb-1">
                      Buy a coffee
                    </Badge>
                    <h1 className="text-lg sm:text-xl font-display font-extrabold text-stone-950 tracking-tight truncate">
                      @{profile.handle}
                    </h1>
                  </div>
                </div>

                {/* 1. Token Picker (USDC & USDT pinned on top) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-stone-500">
                      Token
                    </label>
                    {otherTokens.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowMoreTokens((v) => !v)}
                        className="inline-flex items-center gap-1 min-h-9 px-2 -mr-2 text-[11px] font-mono text-stone-500 hover:text-stone-900 cursor-pointer"
                      >
                        <span>{showMoreTokens ? 'Hide others' : 'More tokens'}</span>
                        <CaretDown weight="fill"
                          className={`w-3 h-3 transition-transform ${
                            showMoreTokens ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {pinnedStables.map((t) => {
                      const active = selectedSymbol === t.symbol;
                      return (
                        <button
                          key={t.symbol}
                          type="button"
                          onClick={() => handleSelectToken(t.symbol)}
                          aria-pressed={active}
                          className={`min-h-11 flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                            active
                              ? 'bg-stone-950 text-white border-stone-950 shadow-xs'
                              : 'bg-stone-50 hover:bg-stone-100 text-stone-900 border-stone-200/80'
                          }`}
                        >
                          <span className="w-[22px] h-[22px] rounded-full bg-[#ffffff] ring-1 ring-[#e7e5e4] flex items-center justify-center flex-shrink-0">
                            <TokenIcon symbol={t.symbol} size={18} />
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-display font-extrabold leading-tight">
                              {t.symbol}
                            </div>
                            <div
                              className={`text-[10px] font-mono truncate ${
                                active ? 'text-stone-300' : 'text-stone-500'
                              }`}
                            >
                              {t.name}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {(showMoreTokens ||
                    (selectedSymbol !== 'USDC' && selectedSymbol !== 'USDT')) &&
                    otherTokens.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1 animate-in fade-in duration-150">
                        {otherTokens.map((t) => {
                          const active = selectedSymbol === t.symbol;
                          return (
                            <button
                              key={t.symbol}
                              type="button"
                              onClick={() => handleSelectToken(t.symbol)}
                              aria-pressed={active}
                              className={`min-h-11 inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-mono font-semibold transition-all cursor-pointer ${
                                active
                                  ? 'bg-stone-950 text-white border-stone-950'
                                  : 'bg-white hover:bg-stone-50 text-stone-700 border-stone-200'
                              }`}
                            >
                              <span className="w-[22px] h-[22px] rounded-full bg-[#ffffff] ring-1 ring-[#e7e5e4] flex items-center justify-center flex-shrink-0">
                                <TokenIcon symbol={t.symbol} size={18} />
                              </span>
                              <span>{t.symbol}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                </div>

                {/* 2. Prefilled Token Amounts + Custom Direct Token Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-500">
                      Amount ({activeToken?.symbol || 'USDC'})
                    </label>
                    {!isStableSelected && effectiveUsdEstimate > 0 && (
                      <span
                        className={`text-[11px] font-mono ${
                          belowMinimumUsd ? 'text-amber-600' : 'text-stone-400'
                        }`}
                      >
                        ≈ ${effectiveUsdEstimate.toFixed(2)} USD
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                    {tokenPresets.map((amt) => {
                      const active = selectedPreset === amt;
                      return (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setSelectedPreset(amt)}
                          aria-pressed={active}
                          className={`min-h-11 py-2.5 rounded-2xl text-sm font-display font-bold transition-all cursor-pointer border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fg)] ${
                            active
                              ? 'bg-stone-950 text-white border-stone-950 shadow-xs outline outline-2 outline-offset-2 outline-[var(--fg)]'
                              : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200/80'
                          }`}
                        >
                          {isStableSelected ? `$${amt}` : amt}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPreset('custom');
                        if (!customAmount) {
                          setCustomAmount(String(tokenPresets[1] ?? tokenPresets[0] ?? '1'));
                        }
                      }}
                      aria-pressed={selectedPreset === 'custom'}
                      className={`min-h-11 py-2.5 rounded-2xl text-sm font-display font-bold transition-all cursor-pointer border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fg)] ${
                        selectedPreset === 'custom'
                          ? 'bg-stone-950 text-white border-stone-950 shadow-xs outline outline-2 outline-offset-2 outline-[var(--fg)]'
                          : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200/80'
                      }`}
                    >
                      Custom
                    </button>
                  </div>

                  {selectedPreset === 'custom' && (
                    <div className="relative mt-2 animate-in fade-in duration-150">
                      {isStableSelected && (
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-stone-400">
                          $
                        </span>
                      )}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        placeholder={`Enter ${activeToken?.symbol || 'token'} amount`}
                        className={`w-full ${
                          isStableSelected ? 'pl-8 pr-4' : 'pl-4 pr-16'
                        } py-2.5 rounded-2xl bg-stone-50 border border-stone-200 focus:border-stone-950 focus:bg-white outline-none font-mono text-sm font-bold text-stone-950 transition-colors`}
                      />
                      {!isStableSelected && (
                        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-stone-500">
                          {activeToken?.symbol}
                        </span>
                      )}
                    </div>
                  )}

                  {belowMinimumUsd && effectiveTokenAmount > 0 && (
                    <p className="text-[11px] font-mono text-amber-600">
                      Minimum deposit is $1.00 USD equivalent.
                    </p>
                  )}
                </div>

                {/* 3. Chain Picker (first 5 networks + Show more chains toggle) */}
                {(() => {
                  const INITIAL_CHAIN_LIMIT = 5;
                  const hasExtraChains = availableChains.length > INITIAL_CHAIN_LIMIT;
                  const hiddenCount = Math.max(0, availableChains.length - INITIAL_CHAIN_LIMIT);
                  let visibleChains = availableChains;
                  if (hasExtraChains && !showMoreChains) {
                    const topFive = availableChains.slice(0, INITIAL_CHAIN_LIMIT);
                    if (
                      activeChainObj &&
                      !topFive.some((c) => c.chain === activeChainObj.chain)
                    ) {
                      visibleChains = [...topFive.slice(0, INITIAL_CHAIN_LIMIT - 1), activeChainObj];
                    } else {
                      visibleChains = topFive;
                    }
                  }
                  const hiddenPreviewChains = availableChains
                    .filter((c) => !visibleChains.some((v) => v.chain === c.chain))
                    .slice(0, 3);

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-500">
                          Sending From Chain
                        </label>
                        {hasExtraChains && showMoreChains && (
                          <button
                            type="button"
                            onClick={() => setShowMoreChains(false)}
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-stone-500 hover:text-stone-900 cursor-pointer"
                          >
                            <span>Show less</span>
                            <CaretDown weight="fill" className="w-3 h-3 rotate-180 transition-transform" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {visibleChains.map((c) => {
                          const active = activeChainObj?.chain === c.chain;
                          return (
                            <button
                              key={c.chain}
                              type="button"
                              onClick={() => setSelectedChain(c.chain)}
                              aria-pressed={active}
                              className={`min-h-11 flex items-center gap-2 px-3 py-2.5 rounded-2xl border text-left transition-all cursor-pointer ${
                                active
                                  ? 'bg-stone-950 text-white border-stone-950 shadow-xs'
                                  : 'bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200/80'
                              }`}
                            >
                              <span className="w-[22px] h-[22px] rounded-full bg-[#ffffff] ring-1 ring-[#e7e5e4] flex items-center justify-center flex-shrink-0">
                                <ChainLogo chainId={c.chain} className="w-4 h-4" />
                              </span>
                              <span className="text-xs font-display font-bold truncate">
                                {c.chainName}
                              </span>
                            </button>
                          );
                        })}

                        {hasExtraChains && !showMoreChains && (
                          <button
                            type="button"
                            onClick={() => setShowMoreChains(true)}
                            className="min-h-11 flex items-center justify-between gap-1.5 px-3 py-2.5 rounded-2xl border border-dashed border-stone-300 bg-white hover:bg-stone-50 hover:border-stone-400 text-stone-700 hover:text-stone-950 text-left transition-all cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              {hiddenPreviewChains.length > 0 && (
                                <div className="flex items-center -space-x-1.5 flex-shrink-0">
                                  {hiddenPreviewChains.map((hc) => (
                                    <span
                                      key={hc.chain}
                                      className="w-[18px] h-[18px] rounded-full bg-[#ffffff] ring-1 ring-[#e7e5e4] flex items-center justify-center"
                                    >
                                      <ChainLogo chainId={hc.chain} className="w-3.5 h-3.5" />
                                    </span>
                                  ))}
                                </div>
                              )}
                              <span className="text-[11px] font-mono font-bold truncate">
                                Show {hiddenCount} more {hiddenCount === 1 ? 'chain' : 'chains'}
                              </span>
                            </div>
                            <CaretDown weight="fill" className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-900 flex-shrink-0 transition-transform group-hover:translate-y-0.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {donateError && (
                  <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs font-mono text-red-700 dark:text-red-300">
                    {donateError}
                  </div>
                )}

                {/* 4. Confirm Button */}
                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleConfirm()}
                    disabled={isCreating || belowMinimumUsd || !activeChainObj}
                    className="w-full min-h-12 py-3.5 px-5 rounded-2xl bg-stone-950 hover:bg-stone-800 disabled:bg-[var(--bg-muted)] disabled:text-[var(--fg-muted)] text-white font-display font-extrabold text-sm tracking-wide shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isCreating ? (
                      <>
                        <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />
                        <span>Preparing deposit address…</span>
                      </>
                    ) : (
                      <>
                        <SolidCoffeeIcon className="w-4 h-4" />
                        <span>
                          {`Pay ${effectiveTokenAmount > 0 ? effectiveTokenAmountStr : '0'} ${activeToken?.symbol || 'USDC'}`}
                        </span>
                      </>
                    )}
                  </button>
                  <p className="text-center text-xs font-mono text-[var(--fg-muted)]">
                    One-time address · arrives privately
                  </p>
                </div>
              </div>

              {/* Unobtrusive Agent Pay Endpoint Disclosure */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setShowAgentInfo((v) => !v)}
                  className="inline-flex items-center gap-1.5 min-h-9 px-3 py-1 rounded-full text-[11px] font-mono text-[var(--fg-muted)] hover:text-stone-900 border border-stone-200/70 bg-white/80 hover:bg-white transition-colors cursor-pointer"
                >
                  <Robot weight="fill" className="w-3 h-3" />
                  <span>Agent Pay API</span>
                  <CaretDown weight="fill"
                    className={`w-3 h-3 transition-transform ${showAgentInfo ? 'rotate-180' : ''}`}
                  />
                </button>
                {showAgentInfo && (
                  <div className="mt-2 p-3.5 rounded-2xl bg-white border border-stone-200/90 text-left space-y-2 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-stone-500">
                      <span>Direct HTTP Payment (No Auth)</span>
                      <button
                        type="button"
                        onClick={() => void copyText(agentCurlSnippet, 'agent')}
                        className="inline-flex items-center gap-1 text-stone-700 hover:text-stone-950 font-bold cursor-pointer"
                      >
                        <Copy weight="fill" className="w-3 h-3" />
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre className="text-[10px] font-mono text-stone-700 bg-stone-50 border border-stone-200/70 rounded-xl p-2.5 overflow-x-auto whitespace-pre-wrap break-all">
                      {agentCurlSnippet}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="w-full max-w-3xl mx-auto px-4 pb-6 pt-2 text-center text-xs font-mono text-[var(--fg-muted)]">
        Powered by{' '}
        <a
          href="https://uprail.world"
          className="text-[var(--fg)] hover:underline underline-offset-2"
        >
          UPRAIL
        </a>
      </footer>
    </div>
  );
};
