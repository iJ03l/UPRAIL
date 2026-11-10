'use client';

import React, { useEffect, useState } from 'react';
import {
  Coffee,
  X,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  Shield,
  Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Toast';
import type { CoffeeSettingsResponse } from '../types';

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
  const [settings, setSettings] = useState<CoffeeSettingsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
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

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isEnabled = settings?.enabled ?? false;

  const handleToggle = async () => {
    if (isToggling) return;
    const next = !isEnabled;
    setIsToggling(true);
    setError(null);
    try {
      const res = await api.toggleCoffee(next);
      setSettings((prev) =>
        prev
          ? { ...prev, enabled: res.enabled, url: res.url }
          : { enabled: res.enabled, handle: res.handle, url: res.url, recentDonations: [] }
      );
      onStatusChange?.(res.enabled);
      toast(res.enabled ? 'Buy Me a Coffee link activated' : 'Buy Me a Coffee link paused');
    } catch (err: any) {
      setError(err?.message || 'Failed to update status');
    } finally {
      setIsToggling(false);
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
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl border border-stone-200 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-700">
              <Coffee className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-display font-extrabold text-stone-950 tracking-tight">
                Buy Me a Coffee
              </h2>
              <p className="text-[11px] font-mono text-stone-500">
                Receive tips from 35+ chains · No login for donors
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-full text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs font-mono text-red-700">
              {error}
            </div>
          )}

          {isLoading && !settings ? (
            <div className="py-8 flex items-center justify-center text-stone-400 gap-2 text-xs font-mono">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading link status…</span>
            </div>
          ) : (
            <>
              {/* Toggle Row */}
              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200/80 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-display font-bold text-stone-950">
                      Public Coffee Link
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
                        isEnabled
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-stone-200 text-stone-600'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isEnabled ? 'bg-emerald-600 animate-pulse' : 'bg-stone-500'
                        }`}
                      />
                      {isEnabled ? 'Active' : 'Off'}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Toggle on to activate your public tip page. Zero setup needed.
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  onClick={() => void handleToggle()}
                  disabled={isToggling}
                  className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-60 ${
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
                  <span>1% protocol fee · 99% to vault</span>
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
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    disabled={!isEnabled}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-stone-100 text-stone-950 text-xs font-display font-bold transition-colors cursor-pointer flex-shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-mono text-stone-500 px-1">
                  <Shield className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                  <span>
                    Contributors pick USDC/USDT &amp; any chain—settled privately to your vault.
                  </span>
                </div>
              </div>

              {/* Recent Tips (if any) */}
              {settings?.recentDonations && settings.recentDonations.length > 0 && (
                <div className="pt-2 border-t border-stone-100 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-stone-500">
                    <Sparkles className="w-3 h-3 text-amber-600" />
                    <span>Recent Coffees</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {settings.recentDonations.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-stone-50 border border-stone-200/60 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-amber-700 font-semibold">☕</span>
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
      </div>
    </div>
  );
};
