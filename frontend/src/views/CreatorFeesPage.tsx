'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Coins,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  ArrowDownLeft,
  Wallet,
  Sparkles,
  RefreshCw,
  Info,
} from 'lucide-react';
import { api } from '../lib/api';
import type { FeeConfig, FeeEvent } from '../types';

function shortId(id: string): string {
  if (!id) return '';
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

export const CreatorFeesPage: React.FC = () => {
  const [config, setConfig] = useState<FeeConfig | null>(null);
  const [events, setEvents] = useState<FeeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cfg, ev] = await Promise.all([api.getFeeConfig(), api.getFeeEvents()]);
      setConfig(cfg);
      setEvents(ev.events || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load creator fees');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copyAddress = () => {
    if (!config?.payoutAddress) return;
    navigator.clipboard.writeText(config.payoutAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center space-x-2 text-stone-900">
          <Coins className="w-5 h-5" />
          <h1 className="text-2xl font-display font-extrabold tracking-tight">Creator Fees</h1>
        </div>
        <p className="text-sm text-stone-500 max-w-2xl">
          Launch on a NEAR-native launchpad and route your creator fees to{' '}
          <span className="font-mono font-bold text-stone-700">@{config?.handle || 'you'}</span>.
          Nominate the address below as your creator — fees land on the same confidential rail as
          everything else, and you cash out to any chain from your vault.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center space-x-2 text-stone-400 text-sm font-mono py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Resolving your payout address…</span>
        </div>
      ) : (
        config && (
          <>
            {/* Payout address */}
            <div className="p-5 rounded-3xl bg-stone-950 text-stone-100 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-[11px] uppercase tracking-wider text-stone-400 font-bold">
                  <Wallet className="w-3.5 h-3.5" />
                  <span>Your creator payout address</span>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    config.registered
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {config.registered ? 'ACTIVE' : 'PENDING ACTIVATION'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-stone-900 border border-stone-800">
                <code className="text-sm font-mono text-stone-100 break-all select-all">
                  {config.payoutAddress}
                </code>
                <button
                  onClick={copyAddress}
                  className="p-2 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer flex-shrink-0"
                  title="Copy address"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-start space-x-2 text-[11px] text-stone-400">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Paste this into the creator / fee-recipient field when you launch. If a payment is
                  sent to a handle that hasn't signed up yet, it's escrowed until they claim.
                </span>
              </div>
            </div>

            {/* Launchpad guides */}
            <div className="space-y-3">
              <div className="flex items-center space-x-2 text-stone-900">
                <Sparkles className="w-4 h-4" />
                <h2 className="text-sm font-display font-bold uppercase tracking-wider">Launchpads</h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {config.launchpads.map((lp) => (
                  <div key={lp.id} className="p-5 rounded-3xl bg-stone-50 border border-stone-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-display font-extrabold text-stone-950">{lp.name}</span>
                      <a
                        href={lp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center space-x-1 text-[11px] font-mono font-bold text-stone-600 hover:text-stone-950 transition-colors"
                      >
                        <span>Launch</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="text-[11px] font-mono text-stone-500">
                      Field: <span className="font-bold text-stone-700">{lp.creatorLabel}</span>
                    </div>
                    <ol className="space-y-1.5">
                      {lp.steps.map((s, i) => (
                        <li key={i} className="flex space-x-2 text-xs text-stone-600">
                          <span className="w-4 h-4 rounded-full bg-white border border-stone-200 text-[10px] font-mono font-bold text-stone-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent fees */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-stone-900">
                  <ArrowDownLeft className="w-4 h-4" />
                  <h2 className="text-sm font-display font-bold uppercase tracking-wider">Recent Fees</h2>
                </div>
                <button
                  onClick={load}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                  title="Refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              {events.length === 0 ? (
                <div className="p-8 rounded-3xl bg-stone-50 border border-dashed border-stone-200 text-center space-y-2">
                  <Coins className="w-8 h-8 text-stone-300 mx-auto" />
                  <p className="text-sm text-stone-500">
                    No creator fees yet. Fees appear here as they arrive at your address.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((ev) => (
                    <div key={ev.id} className="p-3.5 rounded-2xl bg-white border border-stone-200 flex items-center justify-between gap-3">
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">
                          <ArrowDownLeft className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-bold text-stone-900">
                            {ev.amount_in || '0'}{' '}
                            {ev.defuse_asset_id_in ? shortId(ev.defuse_asset_id_in.replace(/^nep141:/, '')) : ''}
                          </div>
                          <div className="text-[10px] text-stone-400 font-mono truncate">
                            {ev.sender_id ? `from ${shortId(ev.sender_id)}` : ev.intent_type} · {shortId(ev.id)}
                          </div>
                        </div>
                      </div>
                      <span className="text-[9px] font-mono uppercase font-bold px-1.5 py-0.5 rounded border text-emerald-700 bg-emerald-50 border-emerald-200 flex-shrink-0">
                        {ev.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
};
