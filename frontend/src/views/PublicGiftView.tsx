'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from '../lib/router';
import {
  Gift,
  Lock,
  LockOpen,
  Fingerprint,
  TrendUp,
  Copy,
  Check,
  ShareNetwork,
  ArrowRight,
  Sparkle,
  ArrowSquareOut,
  Shield,
  ShieldCheck,
} from '@phosphor-icons/react';
import { api, formatUsd } from '../lib/api';
import { useXAuth } from '../hooks/useXAuth';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { useToast } from '../components/Toast';
import { GlitchLogo } from '../components/GlitchLogo';
import { Badge } from '../components/Badge';
import type { PublicGiftCardView, AuthenticatedGiftView } from '../types';

function extractGiftIdFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const search = new URLSearchParams(window.location.search);
  const fromQuery = search.get('id') || search.get('gift');
  if (fromQuery) return fromQuery.trim();
  const match = window.location.pathname.match(/\/gift\/([A-Za-z0-9_-]{4,80})/);
  return match ? match[1] : '';
}

function formatCentsUsd(cents: number | undefined | null): string {
  if (cents === undefined || cents === null || !Number.isFinite(cents)) return 'Hidden';
  return formatUsd(cents / 100);
}

export const PublicGiftView: React.FC = () => {
  const { user, isAuthenticated } = useXAuth();
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
  const { toast } = useToast();

  const [giftId, setGiftId] = useState('');
  const [publicGift, setPublicGift] = useState<PublicGiftCardView | null>(null);
  const [authGift, setAuthGift] = useState<AuthenticatedGiftView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isClaiming, setIsClaiming] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setGiftId(extractGiftIdFromLocation());
    try {
      const savedTheme = localStorage.getItem('uprail_theme');
      const prefersDark =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark =
        savedTheme === 'dark' || ((!savedTheme || savedTheme === 'system') && prefersDark);
      document.documentElement.classList.toggle('dark', isDark);
    } catch {}
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadGift = useCallback(async () => {
    if (!giftId) return;
    setIsLoading(true);
    setError(null);
    try {
      const pub = await api.getPublicGift(giftId);
      setPublicGift(pub);
      if (isAuthenticated) {
        try {
          const priv = await api.getGift(giftId);
          setAuthGift(priv);
        } catch {
          setAuthGift(null);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Gift not found.');
    } finally {
      setIsLoading(false);
    }
  }, [giftId, isAuthenticated]);

  useEffect(() => {
    if (giftId) loadGift();
    else setIsLoading(false);
  }, [giftId, loadGift]);

  const activeGift = authGift || publicGift;
  const isUnlocked = activeGift ? nowMs >= activeGift.timelockUntil : false;
  const isRecipient =
    Boolean(
      user?.handle &&
        activeGift &&
        user.handle.toLowerCase() === activeGift.recipientHandle.toLowerCase()
    ) || authGift?.role === 'RECIPIENT';

  const countdownParts = (() => {
    if (!activeGift) return { days: 0, hours: 0, mins: 0, secs: 0 };
    const diff = Math.max(0, activeGift.timelockUntil - nowMs);
    const totalSec = Math.floor(diff / 1000);
    return {
      days: Math.floor(totalSec / 86400),
      hours: Math.floor((totalSec % 86400) / 3600),
      mins: Math.floor((totalSec % 3600) / 60),
      secs: totalSec % 60,
    };
  })();

  const runGiftSettlement = async (mode: 'claim' | 'reclaim') => {
    if (!activeGift) return;
    setIsClaiming(true);
    try {
      if (user?.custodyMode === 'self') {
        if (mode === 'reclaim') {
          const res = await api.reclaimGiftSelfCustody(activeGift.id);
          if (res.gift) {
            setAuthGift(res.gift);
            setPublicGift((prev) => (prev ? { ...prev, status: res.gift!.status } : prev));
          } else {
            await loadGift();
          }
          toast(
            `Reclaimed ${activeGift.vaultSymbol} Earn Vault gift back to your vault!`,
            'success'
          );
        } else {
          const res = await api.claimGiftSelfCustody(activeGift.id);
          setAuthGift(res.gift);
          setPublicGift((prev) => (prev ? { ...prev, status: res.gift.status } : prev));
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
              `Unwrapped ${res.sharesClaimed} ${res.gift.vaultSymbol} (principal + yield) to your vault!`,
              'success'
            );
          }
        }
        return;
      }

      const assertion = await authorizeWithPasskey(
        mode === 'reclaim'
          ? `Reclaim unclaimed ${activeGift.vaultSymbol} Earn Vault gift`
          : `Unwrap & claim ${activeGift.vaultSymbol} Earn Vault gift to USDC from @${activeGift.senderHandle}`
      );
      const res =
        mode === 'reclaim'
          ? await api.reclaimGiftServer({
              giftId: activeGift.id,
              passkeyAssertion: assertion,
            })
          : await api.claimGift({
              giftId: activeGift.id,
              passkeyAssertion: assertion,
            });
      setAuthGift(res.gift);
      setPublicGift((prev) => (prev ? { ...prev, status: res.gift.status } : prev));
      if (mode === 'reclaim') {
        toast(`Reclaimed ${res.sharesClaimed} ${res.gift.vaultSymbol} back to your vault!`, 'success');
      } else if (res.payoutAsset === 'USDC') {
        toast(
          res.usdcSwapStatus === 'SUCCESS'
            ? `Unwrapped & converted gift to ${res.usdcAmount} USDC!`
            : `Claimed & converting ${res.sharesClaimed} ${res.gift.vaultSymbol} → ~${res.usdcAmount} USDC!`,
          'success'
        );
      } else {
        toast(
          `Unwrapped ${res.sharesClaimed} ${res.gift.vaultSymbol} (principal + yield) to your vault!`,
          'success'
        );
      }
    } catch (err: any) {
      toast(
        err?.message ||
          (mode === 'reclaim'
            ? 'Could not reclaim gift. Verify your passkey and try again.'
            : 'Could not unwrap gift. Verify your passkey and try again.'),
        'error'
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleUnwrap = () => runGiftSettlement('claim');
  const handleReclaim = () => runGiftSettlement('reclaim');

  const handleCopyShareUrl = () => {
    if (!activeGift) return;
    navigator.clipboard.writeText(activeGift.shareUrl);
    setCopied(true);
    toast('Gift link copied', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col justify-between p-4 sm:p-8">
      {/* Top Bar */}
      <header className="max-w-3xl w-full mx-auto flex items-center justify-between">
        <GlitchLogo href="/app" size="md" />
        <Link
          to="/app/circles"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-stone-200 bg-white hover:bg-stone-100 text-xs font-mono font-bold text-stone-800 transition-colors"
        >
          <span>Open Circles & Gifting</span>
          <ArrowRight weight="bold" className="w-3.5 h-3.5" />
        </Link>
      </header>

      {/* Center Gift Card */}
      <main className="max-w-xl w-full mx-auto my-8">
        {isLoading ? (
          <div className="bg-white border border-stone-200 rounded-3xl p-8 text-center space-y-3 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-stone-950 text-amber-400 flex items-center justify-center mx-auto animate-pulse">
              <Gift weight="fill" className="w-6 h-6" />
            </div>
            <p className="text-xs font-mono text-stone-500">Loading Earn Vault Gift...</p>
          </div>
        ) : error || !activeGift ? (
          <div className="bg-white border border-stone-200 rounded-3xl p-8 text-center space-y-4 shadow-sm">
            <h1 className="text-lg font-display font-extrabold text-stone-950">
              Gift Not Found
            </h1>
            <p className="text-xs text-stone-500">
              {error || 'Check that the gift link is complete and try again.'}
            </p>
            <Link
              to="/app/circles"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-950 text-white text-xs font-display font-bold"
            >
              <span>Go to Circles & Gifts</span>
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-xl">
            {/* Dark Hero Header */}
            <div className="bg-stone-950 text-white p-6 sm:p-8 space-y-4 relative overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone="warn">{activeGift.occasionLabel}</Badge>
                <Badge tone="ok" icon={<TrendUp weight="fill" className="w-3 h-3" />}>
                  {activeGift.vaultSymbol} • {activeGift.estimatedApyPct}% APY
                </Badge>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-mono uppercase tracking-widest text-stone-400">
                  1-to-1 Timelocked Earn Vault Gift
                </div>
                <h1 className="text-2xl sm:text-3xl font-display font-extrabold tracking-tight">
                  @{activeGift.senderHandle}{' '}
                  <span className="text-stone-500 font-normal">→</span> @
                  {activeGift.recipientHandle}
                </h1>
              </div>

              {authGift?.message && (
                <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 text-sm text-stone-200 italic">
                  &ldquo;{authGift.message}&rdquo;
                </div>
              )}
            </div>

            {/* Valuation & Yield Breakdown */}
            <div className="p-6 sm:p-8 space-y-6">
              {(authGift || activeGift.showAmount) ? (
                <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center">
                  <div>
                    <div className="text-[10px] font-mono uppercase text-stone-400">Principal</div>
                    <div className="text-base sm:text-lg font-display font-extrabold text-stone-900 tabular-nums mt-0.5">
                      {formatCentsUsd(activeGift.principalUsdCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase text-emerald-600">
                      Accrued Yield
                    </div>
                    <div className="text-base sm:text-lg font-display font-extrabold text-emerald-600 tabular-nums mt-0.5">
                      +{formatCentsUsd(activeGift.yieldUsdCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase text-stone-500">
                      Current Value
                    </div>
                    <div className="text-base sm:text-lg font-display font-extrabold text-stone-950 tabular-nums mt-0.5">
                      {formatCentsUsd(activeGift.currentValueUsdCents)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center space-y-1">
                  <div className="text-xs font-mono font-bold text-stone-800">
                    Sealed Earn Vault Position ({activeGift.vaultName})
                  </div>
                  <p className="text-[11px] text-stone-500">
                    Sign in as @{activeGift.recipientHandle} to view exact principal and live compounding yield.
                  </p>
                </div>
              )}

              {/* Live Timelock Countdown */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-stone-500">
                  <span className="flex items-center gap-1.5">
                    {isUnlocked ? (
                      <LockOpen weight="fill" className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Lock weight="fill" className="w-3.5 h-3.5 text-amber-600" />
                    )}
                    <span>
                      {activeGift.status === 'CLAIMED'
                        ? 'Claimed by Recipient'
                        : activeGift.status === 'RECLAIMED'
                        ? 'Reclaimed by Sender'
                        : isUnlocked
                        ? 'Timelock Reached — Ready to Unwrap!'
                        : 'Timelock Countdown'}
                    </span>
                  </span>
                  <span>{new Date(activeGift.timelockUntil).toLocaleString()}</span>
                </div>

                {!isUnlocked && activeGift.status === 'LOCKED' && (
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: 'Days', val: countdownParts.days },
                      { label: 'Hours', val: countdownParts.hours },
                      { label: 'Minutes', val: countdownParts.mins },
                      { label: 'Seconds', val: countdownParts.secs },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="p-3 rounded-2xl bg-stone-950 text-white font-mono"
                      >
                        <div className="text-xl font-extrabold tabular-nums">
                          {String(item.val).padStart(2, '0')}
                        </div>
                        <div className="text-[10px] uppercase text-stone-400">{item.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action CTA */}
              {activeGift.status === 'CLAIMED' ? (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center text-xs font-mono text-emerald-800 font-bold">
                  ✓ This Earn Vault gift and its compounded yield have been claimed by @
                  {activeGift.recipientHandle}.
                </div>
              ) : activeGift.status === 'RECLAIMED' ? (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-center text-xs font-mono text-amber-800 font-bold">
                  ↺ Unclaimed gift was reclaimed by @{activeGift.senderHandle}.
                </div>
              ) : !isAuthenticated ? (
                <button
                  type="button"
                  onClick={() => api.loginWithX()}
                  className="w-full py-3.5 rounded-2xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
                >
                  <Fingerprint weight="bold" className="w-4 h-4 text-emerald-400" />
                  <span>
                    Sign in as @{activeGift.recipientHandle} to View Live Yield & Unwrap
                  </span>
                </button>
              ) : isRecipient ? (
                <button
                  type="button"
                  disabled={!isUnlocked || isClaiming || isAuthorizing}
                  onClick={handleUnwrap}
                  className={`w-full py-3.5 rounded-2xl text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                    isUnlocked
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-md'
                      : 'bg-stone-200 text-stone-500 cursor-not-allowed'
                  }`}
                >
                  <Fingerprint weight="bold" className="w-4 h-4" />
                  <span>
                    {isClaiming || isAuthorizing
                      ? 'Unwrapping & Settling on NEAR Intents...'
                      : isUnlocked
                      ? `Unwrap & Claim ${activeGift.vaultSymbol} → USDC`
                      : 'Compounding Yield Until Unlock Date'}
                  </span>
                </button>
              ) : authGift?.senderCanReclaim ? (
                <button
                  type="button"
                  disabled={isClaiming || isAuthorizing}
                  onClick={handleReclaim}
                  className="w-full py-3.5 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-display font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                >
                  <Fingerprint weight="bold" className="w-4 h-4" />
                  <span>
                    {isClaiming || isAuthorizing
                      ? 'Reclaiming Gift & Yield to Your Vault...'
                      : `30d Grace Passed — Reclaim ${activeGift.vaultSymbol} + Yield`}
                  </span>
                </button>
              ) : (
                <div className="p-3.5 rounded-2xl bg-stone-100 text-center text-xs font-mono text-stone-600">
                  Signed in as @{user?.handle}. Only @{activeGift.recipientHandle} can unwrap this gift with their passkey.
                </div>
              )}

              {/* Share / Copy SEO Link Footer */}
              <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyShareUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 hover:bg-stone-50 text-xs font-mono text-stone-700 cursor-pointer"
                  >
                    {copied ? (
                      <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy weight="fill" className="w-3.5 h-3.5" />
                    )}
                    <span>Copy Gift Link</span>
                  </button>

                  {(authGift?.contractMode || publicGift?.contractMode) === 'contract' && (
                    <Link
                      to={`/verify?kind=gift&id=${encodeURIComponent(
                        authGift?.onchainGiftId || activeGift.id
                      )}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-mono font-bold text-emerald-700"
                    >
                      <ShieldCheck weight="fill" className="w-3.5 h-3.5" />
                      <span>Verify On-Chain</span>
                    </Link>
                  )}
                </div>

                <a
                  href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                    `@${activeGift.senderHandle} gifted @${activeGift.recipientHandle} a compounding ${activeGift.vaultSymbol} Earn Vault (${activeGift.estimatedApyPct}% APY) on @uprailworld 🎁✨`
                  )}&url=${encodeURIComponent(activeGift.shareUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 text-white text-xs font-display font-bold"
                >
                  <ShareNetwork weight="fill" className="w-3.5 h-3.5" />
                  <span>Share Card on 𝕏</span>
                </a>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="text-center text-[11px] font-mono text-stone-500">
        Powered by UPRAIL &amp; Intents Earn • Passkey-Secured Custody
      </footer>
    </div>
  );
};
