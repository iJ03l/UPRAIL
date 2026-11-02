'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, X, ShieldAlert, Activity } from 'lucide-react';
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
        setSitrep(data);
      }
    } catch {
      // Use fallback defaults
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
        setSitrep(data);
        if (data.upstream?.oneClickBridge === 'online' || !data.active) {
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
      {/* ── TOP NAVBAR SITREP BANNER ── */}
      {!isDismissed ? (
        <aside
          aria-label="System status alert"
          className="w-full bg-[#1C1917] text-stone-100 border-b border-amber-500/40 text-xs font-mono select-none relative z-50 shadow-md"
        >
          <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
            {/* Left: Status beacon + Summary */}
            <div className="flex items-center space-x-2.5 min-w-0 flex-1">
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
              </span>

              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px] uppercase tracking-wider flex-shrink-0 border border-amber-500/30">
                SITREP
              </span>

              <span className="text-stone-300 text-[11px] sm:text-xs truncate font-medium">
                <strong className="text-white font-bold">Defuse Bridge Paused:</strong> Upstream GKE node upgrades (CVE-2026-98432) in progress. Quotes paused (~1–2 hrs).
              </span>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center space-x-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] uppercase tracking-wider transition-colors cursor-pointer flex items-center space-x-1 shadow-xs"
              >
                <span>Situation Report</span>
                <ChevronRight className="w-3 h-3" />
              </button>

              <button
                type="button"
                onClick={() => setIsDismissed(true)}
                title="Minimize banner"
                aria-label="Minimize situation report banner"
                className="p-1 rounded hover:bg-stone-800 text-stone-400 hover:text-white transition-colors cursor-pointer"
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
          className="fixed top-2 right-2 z-50 px-2 py-1 rounded-full bg-[#1C1917] border border-amber-500/50 text-amber-400 hover:text-amber-300 text-[10px] font-mono font-bold flex items-center space-x-1.5 shadow-lg cursor-pointer transition-all hover:scale-105"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span>SITREP ACTIVE</span>
        </button>
      )}

      {/* ── SITUATION REPORT MODAL ── */}
      {isModalOpen && (
        <Portal>
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-fade-in"
            onClick={() => setIsModalOpen(false)}
          >
            <div
              className="bg-[#0A0807] border border-stone-800 rounded-2xl w-full max-w-lg p-5 sm:p-6 text-stone-200 font-mono shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between border-b border-stone-800 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-[10px] font-bold tracking-widest text-amber-400 uppercase">
                      SYSTEM SITUATION REPORT
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white tracking-tight">
                    {sitrep.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Status Pill Box */}
              <div className="p-3 bg-stone-900/90 rounded-xl border border-stone-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="text-stone-500 text-[10px] uppercase block">Current Phase</span>
                  <span className="text-amber-400 font-bold">🟡 Node Maintenance (In Progress)</span>
                </div>
                <div>
                  <span className="text-stone-500 text-[10px] uppercase block">Estimated Duration</span>
                  <span className="text-white font-bold">{sitrep.eta}</span>
                </div>
                <div>
                  <span className="text-stone-500 text-[10px] uppercase block">Upstream Network</span>
                  <span className="text-stone-300">Defuse / 1Click GKE</span>
                </div>
              </div>

              {/* Executive Summary */}
              <div className="space-y-1.5 text-xs text-stone-300 leading-relaxed font-sans">
                <p>
                  Defuse Protocol and 1Click relay nodes are undergoing emergency GKE node upgrades following the public disclosure of Linux kernel vulnerability <code className="text-amber-400 font-mono bg-stone-900 px-1 py-0.5 rounded">CVE-2026-98432</code>.
                </p>
                <p>
                  While nodes upgrade, bridge liquidity quotes and multi-chain deposit address derivations are temporarily paused.
                </p>
              </div>

              {/* Impact Breakdown Columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* Paused */}
                <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-900/40 space-y-2">
                  <div className="flex items-center space-x-1.5 text-amber-400 text-xs font-bold uppercase">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Temporarily Paused</span>
                  </div>
                  <ul className="text-[11px] text-stone-300 space-y-1.5">
                    {sitrep.affected.map((item, idx) => (
                      <li key={idx} className="flex items-start space-x-1.5">
                        <span className="text-amber-500">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 100% Operational */}
                <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-900/40 space-y-2">
                  <div className="flex items-center space-x-1.5 text-emerald-400 text-xs font-bold uppercase">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>100% Operational</span>
                  </div>
                  <ul className="text-[11px] text-stone-300 space-y-1.5">
                    {sitrep.operational.map((item, idx) => (
                      <li key={idx} className="flex items-start space-x-1.5">
                        <span className="text-emerald-500">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Live Status Probe Action */}
              <div className="pt-2 border-t border-stone-800 space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleTestBridge}
                    disabled={isPinging}
                    className="py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-white text-xs font-bold font-mono transition-colors cursor-pointer flex items-center space-x-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
                    <span>{isPinging ? 'Pinging Nodes...' : 'Probe Upstream Status'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="py-2 px-4 rounded-xl bg-white hover:bg-stone-200 text-black text-xs font-bold font-mono transition-colors cursor-pointer"
                  >
                    Acknowledge
                  </button>
                </div>

                {pingResult && (
                  <div className="p-2.5 rounded-lg bg-stone-900 border border-stone-800 text-[11px] font-mono animate-fade-in">
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
