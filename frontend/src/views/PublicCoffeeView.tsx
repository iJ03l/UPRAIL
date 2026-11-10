'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Coffee,
  Copy,
  Check,
  Loader2,
  Shield,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ChevronDown,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api';
import { TokenIcon } from '../components/TokenIcon';
import { ChainLogo } from '../components/ChainLogo';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { useToast } from '../components/Toast';
import type {
  CoffeeCreatorProfile,
  CoffeeTokenOption,
  CoffeeDonation,
} from '../types';

const PRESET_AMOUNTS = [2, 5, 10, 25];

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

export const PublicCoffeeView: React.FC = () => {
  const { toast } = useToast();
  const [handle, setHandle] = useState<string>('');
  const [profile, setProfile] = useState<CoffeeCreatorProfile | null>(null);
  const [tokens, setTokens] = useState<CoffeeTokenOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Selection state
  const [selectedPreset, setSelectedPreset] = useState<number | 'custom'>(5);
  const [customAmount, setCustomAmount] = useState<string>('15');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('USDC');
  const [selectedChain, setSelectedChain] = useState<string>('base');
  const [showMoreTokens, setShowMoreTokens] = useState(false);

  // Ephemeral deposit & standby state
  const [isCreating, setIsCreating] = useState(false);
  const [donateError, setDonateError] = useState<string | null>(null);
  const [donation, setDonation] = useState<CoffeeDonation | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);
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

    Promise.all([api.getCoffeeProfile(h), api.getCoffeeOptions()])
      .then(([prof, opts]) => {
        if (cancelled) return;
        setProfile(prof);
        setTokens(opts);
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

  const effectiveAmountUsd = useMemo(() => {
    if (selectedPreset !== 'custom') return selectedPreset;
    const parsed = parseFloat(customAmount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [selectedPreset, customAmount]);

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

  const handleSelectToken = (symbol: string) => {
    setSelectedSymbol(symbol);
    const nextToken = tokens.find((t) => t.symbol === symbol);
    if (nextToken && nextToken.chains.length > 0) {
      const keep = nextToken.chains.find((c) => c.chain === selectedChain);
      if (!keep) {
        const preferred =
          nextToken.chains.find((c) => c.chain === 'base') || nextToken.chains[0];
        setSelectedChain(preferred.chain);
      }
    }
  };

  const handleConfirm = async () => {
    if (!profile || !activeToken || !activeChainObj) return;
    if (effectiveAmountUsd < 1) {
      setDonateError('Minimum amount is $1.');
      return;
    }
    setIsCreating(true);
    setDonateError(null);
    try {
      const res = await api.createCoffeeDonation({
        handle: profile.handle,
        amountUsd: effectiveAmountUsd,
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

  const copyText = async (text: string, which: 'addr' | 'memo') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'addr') {
        setCopiedAddr(true);
        setTimeout(() => setCopiedAddr(false), 2000);
      } else {
        setCopiedMemo(true);
        setTimeout(() => setCopiedMemo(false), 2000);
      }
      toast('Copied to clipboard');
    } catch {
      toast('Failed to copy');
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F5F0] text-stone-950 flex flex-col justify-between font-sans selection:bg-stone-900 selection:text-white">
      {/* Minimal Top Bar */}
      <header className="w-full max-w-2xl mx-auto px-4 sm:px-6 pt-5 pb-2 flex items-center justify-between">
        <a
          href="https://uprail.world"
          className="inline-flex items-center gap-2 text-stone-950 hover:opacity-80 transition-opacity"
        >
          <span className="w-6 h-6 rounded-lg bg-stone-950 text-white font-display font-black text-xs flex items-center justify-center tracking-tighter">
            UP
          </span>
          <span className="font-display font-extrabold text-sm tracking-tight">
            UPRAIL
          </span>
        </a>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-stone-200/80 text-[10px] font-mono text-stone-500 uppercase tracking-wider">
          <Shield className="w-3 h-3 text-emerald-600" />
          <span>No login needed</span>
        </span>
      </header>

      {/* Main Centered Container */}
      <main className="flex-1 flex items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-md">
          {isLoading ? (
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm p-10 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
              <p className="text-xs font-mono text-stone-500">Loading creator page…</p>
            </div>
          ) : loadError ? (
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm p-8 text-center space-y-4">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
              <p className="text-sm text-stone-700">{loadError}</p>
            </div>
          ) : !profile?.found ? (
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto text-stone-500">
                <Coffee className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg font-display font-extrabold text-stone-950">
                  {handle ? `@${handle} isn’t on UPRAIL yet` : 'Creator not found'}
                </h1>
                <p className="text-xs text-stone-500 leading-relaxed">
                  You can still send money to any X handle via UPRAIL’s private escrow.
                </p>
              </div>
              <a
                href="https://app.uprail.world"
                className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold transition-colors"
              >
                <span>Open app.uprail.world</span>
                <ExternalLink className="w-3.5 h-3.5" />
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
                  This creator hasn’t toggled on their Buy Me a Coffee page yet.
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
            /* ─── STANDBY EPHEMERAL WALLET VIEW ───────────────────────────────── */
            <div className="bg-white rounded-3xl border border-stone-200/90 shadow-sm overflow-hidden animate-in fade-in duration-200">
              {/* Top Creator Strip */}
              <div className="px-6 py-4 bg-stone-50/80 border-b border-stone-100 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setDonation(null)}
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-stone-500 hover:text-stone-950 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
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
                <div className="p-7 text-center space-y-5">
                  <div className="w-14 h-14 rounded-3xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-xl font-display font-extrabold text-stone-950">
                      Coffee Delivered!
                    </h2>
                    <p className="text-xs sm:text-sm text-stone-600">
                      <strong className="font-mono text-stone-950">
                        {donation.estimatedNetOut} {donation.targetSymbol}
                      </strong>{' '}
                      has been settled privately to{' '}
                      <strong className="text-stone-950">@{donation.recipientHandle}</strong>.
                    </p>
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
                  <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
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
                  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-amber-50/90 border border-amber-200/80 text-amber-900">
                    <div className="flex items-center gap-2 text-xs font-mono font-semibold">
                      {donation.status === 'PROCESSING' || donation.status === 'SETTLING' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                          <span>Deposit detected · Delivering…</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                          <span>Standing by for deposit…</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] font-mono text-amber-700">
                      <Clock className="w-3 h-3" />
                      <span>{formatCountdown(donation.expiresAt, nowMs)}</span>
                    </div>
                  </div>

                  {/* Exact Amount & Chain */}
                  <div className="text-center space-y-1">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-stone-400">
                      Send exactly on {donation.originChainName}
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <TokenIcon symbol={donation.originSymbol} size="sm" />
                      <span className="text-2xl font-display font-extrabold text-stone-950 tabular-nums">
                        {donation.amountToSend} {donation.originSymbol}
                      </span>
                    </div>
                  </div>

                  {/* QR Code */}
                  <div className="flex justify-center">
                    <div className="p-3 bg-white rounded-2xl border border-stone-200 shadow-2xs">
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
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {donation.depositMemo && (
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-mono uppercase tracking-wider text-amber-700 font-bold">
                        Required Memo / Tag
                      </label>
                      <div className="flex items-center gap-2 p-2.5 pl-3.5 rounded-2xl bg-amber-50 border border-amber-200">
                        <span className="font-mono text-xs text-stone-950 flex-1 select-all">
                          {donation.depositMemo}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyText(donation.depositMemo!, 'memo')}
                          className="p-1.5 rounded-lg bg-white border border-amber-200 text-stone-700 cursor-pointer"
                        >
                          {copiedMemo ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Fee & Settlement Breakdown */}
                  <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-[11px] font-mono text-stone-500">
                    <span>Creator receives (after 1% fee)</span>
                    <span className="font-semibold text-stone-900">
                      ~{donation.estimatedNetOut} {donation.targetSymbol}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ─── SELECTION FORM (AMOUNT + TOKEN + CHAIN + CONFIRM) ────────── */
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
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200/70 text-amber-800 text-[10px] font-mono font-bold uppercase tracking-wider mb-1">
                    <Coffee className="w-3 h-3" />
                    <span>Buy a coffee</span>
                  </div>
                  <h1 className="text-lg sm:text-xl font-display font-extrabold text-stone-950 tracking-tight truncate">
                    @{profile.handle}
                  </h1>
                </div>
              </div>

              {/* 1. Prefilled Amounts + Custom */}
              <div className="space-y-2">
                <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-500">
                  Amount (USD)
                </label>
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {PRESET_AMOUNTS.map((amt) => {
                    const active = selectedPreset === amt;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setSelectedPreset(amt)}
                        className={`py-2.5 rounded-2xl text-xs sm:text-sm font-display font-bold transition-all cursor-pointer border ${
                          active
                            ? 'bg-stone-950 text-white border-stone-950 shadow-xs'
                            : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200/80'
                        }`}
                      >
                        ${amt}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setSelectedPreset('custom')}
                    className={`py-2.5 rounded-2xl text-xs font-display font-bold transition-all cursor-pointer border ${
                      selectedPreset === 'custom'
                        ? 'bg-stone-950 text-white border-stone-950 shadow-xs'
                        : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200/80'
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {selectedPreset === 'custom' && (
                  <div className="relative mt-2 animate-in fade-in duration-150">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-stone-400">
                      $
                    </span>
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      step="any"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      placeholder="Enter USD amount"
                      className="w-full pl-8 pr-4 py-2.5 rounded-2xl bg-stone-50 border border-stone-200 focus:border-stone-950 focus:bg-white outline-none font-mono text-sm font-bold text-stone-950 transition-colors"
                    />
                  </div>
                )}
              </div>

              {/* 2. Token Picker (USDC & USDT pinned on top) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-mono uppercase tracking-wider text-stone-500">
                    Token
                  </label>
                  {otherTokens.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowMoreTokens((v) => !v)}
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-stone-500 hover:text-stone-900 cursor-pointer"
                    >
                      <span>{showMoreTokens ? 'Hide others' : 'More tokens'}</span>
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${
                          showMoreTokens ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  )}
                </div>

                {/* USDC & USDT always pinned on top */}
                <div className="grid grid-cols-2 gap-2">
                  {pinnedStables.map((t) => {
                    const active = selectedSymbol === t.symbol;
                    return (
                      <button
                        key={t.symbol}
                        type="button"
                        onClick={() => handleSelectToken(t.symbol)}
                        className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                          active
                            ? 'bg-stone-950 text-white border-stone-950 shadow-xs'
                            : 'bg-stone-50 hover:bg-stone-100 text-stone-900 border-stone-200/80'
                        }`}
                      >
                        <TokenIcon symbol={t.symbol} size="sm" />
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

                {/* Other tokens toggleable */}
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
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold transition-all cursor-pointer ${
                              active
                                ? 'bg-stone-950 text-white border-stone-950'
                                : 'bg-white hover:bg-stone-50 text-stone-700 border-stone-200'
                            }`}
                          >
                            <TokenIcon symbol={t.symbol} size={14} />
                            <span>{t.symbol}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>

              {/* 3. Chain Picker */}
              <div className="space-y-2">
                <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-500">
                  Sending From Chain
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto pr-0.5">
                  {availableChains.map((c) => {
                    const active = activeChainObj?.chain === c.chain;
                    return (
                      <button
                        key={c.chain}
                        type="button"
                        onClick={() => setSelectedChain(c.chain)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl border text-left transition-all cursor-pointer ${
                          active
                            ? 'bg-stone-950 text-white border-stone-950 shadow-xs'
                            : 'bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200/80'
                        }`}
                      >
                        <ChainLogo chainId={c.chain} className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs font-display font-bold truncate">
                          {c.chainName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {donateError && (
                <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs font-mono text-red-700">
                  {donateError}
                </div>
              )}

              {/* 4. Confirm Button */}
              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={isCreating || effectiveAmountUsd < 1 || !activeChainObj}
                  className="w-full py-3.5 px-5 rounded-2xl bg-stone-950 hover:bg-stone-800 disabled:bg-stone-300 text-white font-display font-extrabold text-xs sm:text-sm uppercase tracking-wider shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Preparing ephemeral wallet…</span>
                    </>
                  ) : (
                    <>
                      <Coffee className="w-4 h-4" />
                      <span>
                        Confirm · ${effectiveAmountUsd > 0 ? effectiveAmountUsd : '0'}{' '}
                        {activeToken?.symbol || 'USDC'}
                      </span>
                    </>
                  )}
                </button>
                <p className="text-center text-[11px] font-mono text-stone-400">
                  Reveals a one-time deposit address · 1% fee · 99% to @{profile.handle}
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="w-full max-w-2xl mx-auto px-4 pb-6 pt-2 text-center text-[11px] font-mono text-stone-400">
        Powered by{' '}
        <a
          href="https://uprail.world"
          className="text-stone-600 hover:text-stone-950 underline underline-offset-2"
        >
          UPRAIL
        </a>{' '}
        · Private value rails on NEAR Intents
      </footer>
    </div>
  );
};
