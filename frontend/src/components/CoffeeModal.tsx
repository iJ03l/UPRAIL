'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Check,
  ArrowSquareOut,
  CircleNotch,
  Fingerprint,
  Sparkle,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { ModalSheet } from './ModalSheet';
import { Badge } from './Badge';
import { usePasskeyTxAuth } from '../hooks/usePasskeyTxAuth';
import { useToast } from './Toast';
import type { CoffeeSettingsResponse } from '../types';

export const CoinPouchIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    {/* Cinch top ruffle */}
    <path
      d="M10.2 3.2C10.8 2.6 11.7 2.8 12.4 3.4C13.2 2.5 14.8 2.5 15.6 3.4C16.3 2.8 17.2 2.6 17.8 3.2L16.3 7.6H11.7L10.2 3.2Z"
      fill="#F59E0B"
      stroke="#78350F"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    {/* Plump coin pouch belly */}
    <path
      d="M11.6 8.2C7.2 9.4 4.8 13.8 5.1 18.6C5.4 22.8 8.6 25 14 25C19.4 25 22.6 22.8 22.9 18.6C23.2 13.8 20.8 9.4 16.4 8.2H11.6Z"
      fill="#FBBF24"
      stroke="#78350F"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    {/* Tied rope / knot around neck with hanging ends */}
    <path
      d="M10.8 7.8C12.2 8.5 15.8 8.5 17.2 7.8"
      stroke="#92400E"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <path
      d="M14.2 8.2L16.6 10.7M13.8 8.2L12.1 10.6"
      stroke="#92400E"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    {/* Coins visible inside the pouch */}
    <circle cx="11.8" cy="17.6" r="4.1" fill="#FDE68A" stroke="#92400E" strokeWidth="1.35" />
    <circle cx="15.8" cy="15.8" r="4.1" fill="#FEF3C7" stroke="#92400E" strokeWidth="1.35" />
    <path
      d="M15.8 13.6V18M17.1 14.5C16.7 14.1 16 14 15.4 14.2C14.8 14.4 14.7 15.1 15.4 15.4L16.2 15.8C16.9 16.1 16.8 16.9 16.1 17.1C15.5 17.3 14.8 17.1 14.5 16.7"
      stroke="#92400E"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

export const SolidCoffeeIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M8.5 5.25C8.5 4.05 9.5 3.45 9.5 2.25M12.5 5.25C12.5 4.05 13.5 3.45 13.5 2.25"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M4 8.25C4 7.7 4.45 7.25 5 7.25H16.5C17.05 7.25 17.5 7.7 17.5 8.25V13.25C17.5 16.56 14.81 19.25 11.5 19.25H10C6.69 19.25 4 16.56 4 13.25V8.25Z"
      fill="currentColor"
    />
    <path
      d="M17.5 9.25H18.75C20.27 9.25 21.5 10.48 21.5 12C21.5 13.52 20.27 14.75 18.75 14.75H17.2"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
    <path
      d="M4.25 21.5H17.25"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

interface CoffeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  xHandle: string;
  onStatusChange?: (enabled: boolean) => void;
}

export const CoffeeModal: React.FC<CoffeeModalProps> = ({
  isOpen,
  onClose,
  xHandle,
  onStatusChange,
}) => {
  const { toast } = useToast();
  const { authorizeWithPasskey, isAuthorizing } = usePasskeyTxAuth();
  const [settings, setSettings] = useState<CoffeeSettingsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [stepMsg, setStepMsg] = useState<string | null>(null);
  const togglingRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanHandle = (xHandle || '').replace(/^@+/, '').toLowerCase();
  const displayUrl = settings?.url || `https://uprail.world/${cleanHandle}`;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api
      .getCoffeeSettings()
      .then((res) => {
        if (!cancelled) {
          setSettings(res);
          onStatusChange?.(res.enabled);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Could not load Buy Me a Coffee settings');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const isEnabled = settings?.enabled ?? false;
  const busy = isToggling || isAuthorizing;

  const handleToggle = async () => {
    if (busy || togglingRef.current) return;
    togglingRef.current = true;
    const next = !isEnabled;
    setIsToggling(true);
    setStepMsg('Confirm with Face ID or passkey…');
    setError(null);
    try {
      const passkeyAssertion = await authorizeWithPasskey(
        next
          ? `Activate public payment link uprail.world/${cleanHandle}`
          : `Pause public payment link uprail.world/${cleanHandle}`,
        (_stage, msg) => setStepMsg(msg)
      );
      setStepMsg(next ? 'Activating public pay link…' : 'Pausing public pay link…');
      const res = await api.toggleCoffee({ enabled: next, passkeyAssertion });
      setSettings((prev) =>
        prev
          ? { ...prev, enabled: res.enabled, url: res.url }
          : { enabled: res.enabled, handle: res.handle, url: res.url, recentDonations: [] }
      );
      onStatusChange?.(res.enabled);
      toast(res.enabled ? 'Buy Me a Coffee link activated' : 'Buy Me a Coffee link paused');
    } catch (err: any) {
      setError(err?.message || 'Passkey verification failed');
    } finally {
      togglingRef.current = false;
      setIsToggling(false);
      setStepMsg(null);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      toast('Coffee link copied!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Copy failed');
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      canClose={!busy}
      zIndexClass="z-50"
      maxWidthClass="sm:max-w-md"
      showCloseButton={!busy}
      closeLabel="Close Buy Me a Coffee settings"
      ariaLabel="Buy Me a Coffee settings"
    >
      {/* Header */}
      <div className="px-6 pt-2 sm:pt-5 pb-4 pr-14 border-b border-stone-100 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 flex items-center justify-center text-amber-700 dark:text-amber-300 flex-shrink-0">
          <SolidCoffeeIcon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-display font-extrabold text-stone-950 tracking-tight">
            Buy Me a Coffee
          </h2>
          <p className="text-[11px] font-mono text-stone-500">
            Receive from 35+ chains · No login for senders
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs font-mono text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {isLoading && !settings ? (
          <div className="py-8 flex items-center justify-center text-stone-400 gap-2 text-xs font-mono">
            <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />
            <span>Loading link status…</span>
          </div>
        ) : (
          <>
            {/* Passkey-gated Toggle Row */}
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/80 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-display font-bold text-stone-950">
                    Public Pay Link
                  </span>
                  <Badge tone={isEnabled ? 'ok' : 'neutral'}>
                    {isEnabled ? 'Active' : 'Off'}
                  </Badge>
                </div>
                <p className="text-xs text-stone-500 leading-relaxed flex items-center gap-1.5">
                  {busy ? (
                    <CircleNotch weight="bold" className="w-3.5 h-3.5 text-stone-700 animate-spin flex-shrink-0" />
                  ) : (
                    <Fingerprint weight="bold" className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                  )}
                  <span>
                    {busy
                      ? stepMsg || 'Confirm with Face ID or passkey…'
                      : 'Passkey confirmation required to change'}
                  </span>
                </p>
              </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={isEnabled}
                    onClick={() => void handleToggle()}
                    disabled={busy}
                    className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed ${
                      isEnabled ? 'bg-stone-950' : 'bg-stone-300'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        isEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Active Link Card */}
                <div
                  className={`space-y-3 transition-opacity duration-200 ${
                    isEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-stone-500">
                    <span>Your Public Link</span>
                    <span>Zero setup · Private</span>
                  </div>

                  <div className="flex items-center gap-2 p-2 pl-3.5 rounded-2xl bg-stone-950 text-white border border-stone-800">
                    <span className="font-mono text-xs sm:text-sm font-semibold truncate flex-1 select-all">
                      uprail.world/{cleanHandle}
                    </span>

                    <a
                      href={displayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Preview public page"
                      className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors flex-shrink-0"
                    >
                      <ArrowSquareOut weight="fill" className="w-3.5 h-3.5" />
                    </a>

                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      disabled={!isEnabled}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-stone-100 text-stone-950 text-xs font-display font-bold transition-colors cursor-pointer flex-shrink-0"
                    >
                      {copied ? (
                        <>
                          <Check weight="bold" className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy weight="fill" className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  <p className="text-[11px] font-mono text-stone-500 px-1">
                    People &amp; agents visiting this link pay in USDC/USDT or major assets from any chain.
                  </p>
                </div>

                {/* Recent Tips (if any) */}
                {settings?.recentDonations && settings.recentDonations.length > 0 && (
                  <div className="pt-2 border-t border-stone-100 space-y-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-stone-500">
                      <Sparkle weight="fill" className="w-3 h-3 text-amber-600" />
                      <span>Recent Coffees</span>
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                      {settings.recentDonations.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between px-3 py-2 rounded-xl bg-stone-50 border border-stone-200/60 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <SolidCoffeeIcon className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                            <span className="font-mono text-stone-700 truncate">
                              +{d.netAmount} {d.targetSymbol}
                            </span>
                          </div>
                          <span className="font-mono text-[10px] text-stone-400 uppercase flex-shrink-0">
                            via {d.originChain}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
      </div>
    </ModalSheet>
  );
};
