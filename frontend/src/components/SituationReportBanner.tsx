'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, X } from 'lucide-react';
import { Portal } from './Portal';

export interface SitrepData {
  active: boolean;
  severity: 'maintenance' | 'operational' | 'degraded' | 'outage';
  badge: string;
  title: string;
  summary: string;
  startedAt: string;
  eta: string;
  upstream?: {
    oneClickBridge: string;
    cause: string;
  };
  affected: string[];
  operational: string[];
  timestamp?: string;
}

const DEFAULT_SITREP: SitrepData = {
  active: true,
  severity: 'maintenance',
  badge: 'UPSTREAM NODE UPGRADE',
  title: 'Upstream Defuse/1Click GKE Node Upgrades (CVE-2026-98432)',
  summary:
    'Defuse solver bridge nodes are paused for emergency GKE upgrades to patch Linux kernel vulnerability CVE-2026-98432. Cross-chain bridge quotes and deposit address generation are temporarily unavailable. Internal transfers and 𝕏 handle payments are 100% operational.',
  startedAt: 'Nov 2, 2026 1:15 PM',
  eta: 'About 1–2 hours',
  upstream: {
    oneClickBridge: 'paused_maintenance',
    cause: 'GKE node upgrades for CVE-2026-98432',
  },
  affected: [
    'Cross-chain deposit quote generation',
    'Multi-chain solver swaps',
    'Cross-chain bridge withdrawals',
  ],
  operational: [
    'UPRAIL value streams & 𝕏 handle payments',
    'Virtual escrow ledger & balances',
    'WebAuthn hardware passkeys & sessions',
    'NEAR Intents onchain settlements',
  ],
};

/**
 * Strict sanitization to prevent prototype pollution, injection, or unexpected data shapes.
 */
function sanitizeSitrep(raw: unknown): SitrepData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_SITREP;
  }
  const r = raw as Record<string, unknown>;
  const cleanStr = (val: unknown, fallback: string, maxLen = 300): string => {
    if (typeof val !== 'string') return fallback;
    return val.trim().slice(0, maxLen);
  };

  const cleanArr = (val: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(val)) return fallback;
    return val
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 200))
      .slice(0, 10);
  };

  const validSeverities = new Set(['maintenance', 'operational', 'degraded', 'outage']);
  const severity = typeof r.severity === 'string' && validSeverities.has(r.severity)
    ? (r.severity as SitrepData['severity'])
    : 'maintenance';

  return {
    active: Boolean(r.active ?? true),
    severity,
    badge: cleanStr(r.badge, 'UPSTREAM STATUS', 50),
    title: cleanStr(r.title, DEFAULT_SITREP.title, 120),
    summary: cleanStr(r.summary, DEFAULT_SITREP.summary, 500),
    startedAt: cleanStr(r.startedAt, DEFAULT_SITREP.startedAt, 50),
    eta: cleanStr(r.eta, DEFAULT_SITREP.eta, 50),
    upstream: r.upstream && typeof r.upstream === 'object'
      ? {
          oneClickBridge: cleanStr((r.upstream as Record<string, unknown>).oneClickBridge, 'unknown', 50),
          cause: cleanStr((r.upstream as Record<string, unknown>).cause, '', 100),
        }
      : DEFAULT_SITREP.upstream,
    affected: cleanArr(r.affected, DEFAULT_SITREP.affected),
    operational: cleanArr(r.operational, DEFAULT_SITREP.operational),
    timestamp: typeof r.timestamp === 'string' ? cleanStr(r.timestamp, '', 50) : undefined,
  };
}

export const SituationReportBanner: React.FC = () => {
  const [sitrep, setSitrep] = useState<SitrepData>(DEFAULT_SITREP);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  const fetchSitrep = useCallback(async () => {
    try {
      const res = await fetch('/api/system/sitrep');
      if (res.ok) {
        const data = await res.json();
        setSitrep(sanitizeSitrep(data));
      }
    } catch {
      // Retain fallback defaults
    }
  }, []);

  useEffect(() => {
    fetchSitrep();
    // Poll status every 30s
    const timer = setInterval(fetchSitrep, 30_000);
    return () => clearInterval(timer);
  }, [fetchSitrep]);

  const handleTestBridge = async () => {
    setIsPinging(true);
    setPingResult(null);
    try {
      const res = await fetch('/api/system/sitrep');
      if (res.ok) {
        const data = await res.json();
        const clean = sanitizeSitrep(data);
        setSitrep(clean);
        if (clean.upstream?.oneClickBridge === 'online' || !clean.active) {
          setPingResult('🟢 Upstream bridge is BACK ONLINE! All systems operational.');
        } else {
          setPingResult('🟡 Upstream nodes still upgrading (CVE-2026-98432). Expected duration: ~1–2 hrs.');
        }
      } else {
        setPingResult('🟡 Upstream nodes still upgrading. Expected duration: ~1–2 hrs.');
      }
    } catch {
      setPingResult('🟡 Upstream nodes still upgrading. Expected duration: ~1–2 hrs.');
    } finally {
      setIsPinging(false);
    }
  };

  if (!sitrep.active) return null;

  return (
    <>
      {/* ── THEME-AWARE TOP NAVBAR SITREP BANNER (100% Solid Colors, Zero Gradients) ── */}
      {!isDismissed ? (
        <aside
          aria-label="System status alert"
          className="w-full bg-[#FFFBEB] dark:bg-[#1C1917] text-amber-950 dark:text-stone-100 border-b border-amber-300 dark:border-amber-500/40 text-xs font-mono select-none relative z-50 shadow-xs transition-colors"
        >
          <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
            {/* Left: Status beacon + Summary */}
            <div className="flex items-center space-x-2.5 min-w-0 flex-1">
              <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600 dark:bg-amber-500" />
              </span>

              <span className="px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-500/20 text-amber-900 dark:text-amber-300 font-bold text-[10px] uppercase tracking-wider flex-shrink-0 border border-amber-300 dark:border-amber-500/30">
                SITREP
              </span>

              <span className="text-amber-900 dark:text-stone-300 text-[11px] sm:text-xs truncate font-medium">
                <strong className="text-black dark:text-white font-bold">Defuse Bridge Paused:</strong> Upstream GKE node upgrades (CVE-2026-98432) in progress. Quotes paused (~1–2 hrs).
              </span>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center space-x-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 dark:bg-amber-400 dark:hover:bg-amber-300 text-black font-bold text-[11px] uppercase tracking-wider transition-colors cursor-pointer flex items-center space-x-1 shadow-xs"
              >
                <span>Situation Report</span>
                <ChevronRight className="w-3 h-3" />
              </button>

              <button
                type="button"
                onClick={() => setIsDismissed(true)}
                title="Minimize banner"
                aria-label="Minimize situation report banner"
                className="p-1 rounded-md hover:bg-amber-200 dark:hover:bg-stone-800 text-amber-800 dark:text-stone-400 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </aside>
      ) : (
        /* Minimized pill in top right corner if dismissed */
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          title="Open Situation Report"
          className="fixed top-2 right-2 z-50 px-2.5 py-1 rounded-full bg-white dark:bg-[#1C1917] border border-amber-400 dark:border-amber-500/50 text-amber-900 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-stone-800 text-[10px] font-mono font-bold flex items-center space-x-1.5 shadow-md cursor-pointer transition-transform hover:scale-105"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-500 animate-pulse" />
          <span>SITREP ACTIVE</span>
        </button>
      )}

      {/* ── THEME-AWARE SITUATION REPORT MODAL ── */}
      {isModalOpen && (
        <Portal>
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-xs animate-fade-in"
            onClick={() => setIsModalOpen(false)}
          >
            <div
              className="bg-white dark:bg-[#0A0807] border border-stone-200 dark:border-stone-800 rounded-2xl w-full max-w-lg p-5 sm:p-6 text-stone-900 dark:text-stone-200 font-mono shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between border-b border-stone-200 dark:border-stone-800 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-[10px] font-bold tracking-widest text-amber-600 dark:text-amber-400 uppercase">
                      SYSTEM SITUATION REPORT
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-stone-950 dark:text-white tracking-tight">
                    {sitrep.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Status Pill Box */}
              <div className="p-3 bg-stone-50 dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="text-stone-500 text-[10px] uppercase block">Current Phase</span>
                  <span className="text-amber-700 dark:text-amber-400 font-bold">🟡 Node Maintenance (In Progress)</span>
                </div>
                <div>
                  <span className="text-stone-500 text-[10px] uppercase block">Estimated Duration</span>
                  <span className="text-stone-900 dark:text-white font-bold">{sitrep.eta}</span>
                </div>
                <div>
                  <span className="text-stone-500 text-[10px] uppercase block">Upstream Network</span>
                  <span className="text-stone-700 dark:text-stone-300">Defuse / 1Click GKE</span>
                </div>
              </div>

              {/* Executive Summary */}
              <div className="space-y-1.5 text-xs text-stone-700 dark:text-stone-300 leading-relaxed font-sans">
                <p>
                  Defuse Protocol and 1Click relay nodes are undergoing emergency GKE node upgrades following the public disclosure of Linux kernel vulnerability <code className="text-amber-800 dark:text-amber-400 font-mono bg-stone-100 dark:bg-stone-900 px-1 py-0.5 rounded border border-stone-200 dark:border-stone-800">CVE-2026-98432</code>.
                </p>
                <p>
                  While nodes upgrade, bridge liquidity quotes and multi-chain deposit address derivations are temporarily paused.
                </p>
              </div>

              {/* Impact Breakdown Columns (Solid backgrounds, no gradients) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* Paused */}
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 space-y-2">
                  <div className="flex items-center space-x-1.5 text-amber-800 dark:text-amber-400 text-xs font-bold uppercase">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Temporarily Paused</span>
                  </div>
                  <ul className="text-[11px] text-amber-950 dark:text-stone-300 space-y-1.5">
                    {sitrep.affected.map((item, idx) => (
                      <li key={idx} className="flex items-start space-x-1.5">
                        <span className="text-amber-600 dark:text-amber-500 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 100% Operational */}
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 space-y-2">
                  <div className="flex items-center space-x-1.5 text-emerald-800 dark:text-emerald-400 text-xs font-bold uppercase">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>100% Operational</span>
                  </div>
                  <ul className="text-[11px] text-emerald-950 dark:text-stone-300 space-y-1.5">
                    {sitrep.operational.map((item, idx) => (
                      <li key={idx} className="flex items-start space-x-1.5">
                        <span className="text-emerald-600 dark:text-emerald-500 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Live Status Probe Action */}
              <div className="pt-2 border-t border-stone-200 dark:border-stone-800 space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleTestBridge}
                    disabled={isPinging}
                    className="py-2 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-900 dark:text-white text-xs font-bold font-mono transition-colors cursor-pointer flex items-center space-x-2 disabled:opacity-50 border border-stone-200 dark:border-stone-700"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
                    <span>{isPinging ? 'Pinging Nodes...' : 'Probe Upstream Status'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="py-2 px-4 rounded-xl bg-black hover:bg-stone-800 text-white dark:bg-white dark:hover:bg-stone-200 dark:text-black text-xs font-bold font-mono transition-colors cursor-pointer shadow-xs"
                  >
                    Acknowledge
                  </button>
                </div>

                {pingResult && (
                  <div className="p-2.5 rounded-lg bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-[11px] font-mono text-stone-900 dark:text-stone-200 animate-fade-in">
                    {pingResult}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
};
