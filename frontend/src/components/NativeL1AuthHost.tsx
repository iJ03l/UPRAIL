'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Loader2,
  ShieldAlert,
  ArrowRight,
  X,
} from 'lucide-react';
import {
  performWebAuthnAssertion,
  registerNativeL1PromptHandler,
  type NativeL1PromptRequest,
} from '../lib/selfCustody';
import { describePasskeyError } from '../lib/webauthn';

interface ActiveRequest {
  req: NativeL1PromptRequest;
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

const OPERATION_LABELS: Record<string, { title: string; cta: string; badge: string }> = {
  sweep_to_intents: {
    title: 'Sweep NEAR L1 Assets to Intents',
    cta: 'Use L1 Key & Sweep to Intents',
    badge: 'L1 → Intents Sweep',
  },
  native_send: {
    title: 'Send NEAR Native L1 Asset',
    cta: 'Use L1 Key & Send Payment',
    badge: 'NEAR L1 Transfer',
  },
  native_escrow_lock: {
    title: 'Lock NEAR Native L1 Asset in Escrow',
    cta: 'Use L1 Key & Lock Escrow',
    badge: 'NEAR L1 Escrow Lock',
  },
  native_withdraw: {
    title: 'Withdraw NEAR Native L1 Asset',
    cta: 'Use L1 Key & Withdraw',
    badge: 'NEAR L1 Withdraw',
  },
};

export const NativeL1AuthHost: React.FC = () => {
  const [active, setActive] = useState<ActiveRequest | null>(null);
  const [phase, setPhase] = useState<'sign' | 'signing' | 'ready' | 'authorizing'>('sign');
  const [signedAssertion, setSignedAssertion] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef<ActiveRequest | null>(null);
  activeRef.current = active;

  useEffect(() => {
    return registerNativeL1PromptHandler(
      (req) =>
        new Promise((resolve, reject) => {
          if (activeRef.current) {
            activeRef.current.reject(new Error('Superseded by a newer NEAR L1 authorization prompt.'));
          }
          setSignedAssertion(null);
          setError(null);
          setPhase('sign');
          setActive({ req, resolve, reject });
        })
    );
  }, []);

  if (!active) return null;

  const { prepared, submitAuthorized } = active.req;
  const meta = OPERATION_LABELS[prepared.operation] || {
    title: 'Authorize NEAR L1 Key Operation',
    cta: 'Use L1 Key & Authorize',
    badge: 'NEAR L1 Key',
  };

  const handleCancel = () => {
    const cur = active;
    setActive(null);
    setSignedAssertion(null);
    setError(null);
    setPhase('sign');
    cur.reject(new Error('NEAR L1 key authorization cancelled'));
  };

  const handleStep1Sign = async () => {
    setError(null);
    setPhase('signing');
    try {
      const assertion = await performWebAuthnAssertion(prepared.options);
      setSignedAssertion(assertion);
      setPhase('ready');
    } catch (err: any) {
      setPhase('sign');
      setError(describePasskeyError(err));
    }
  };

  const handleStep2AuthorizeAndUseKey = async () => {
    if (!signedAssertion) return;
    setError(null);
    setPhase('authorizing');
    try {
      const result = await submitAuthorized(signedAssertion);
      const cur = active;
      setActive(null);
      setSignedAssertion(null);
      setPhase('sign');
      cur.resolve(result);
    } catch (err: any) {
      setPhase('ready');
      setError(err?.message || 'NEAR L1 key authorization failed.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="native-l1-auth-title"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6 sm:p-7 space-y-5 text-stone-900 dark:text-stone-100">
        <button
          type="button"
          onClick={handleCancel}
          disabled={phase === 'signing' || phase === 'authorizing'}
          className="absolute top-5 right-5 p-1.5 rounded-xl text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40"
          aria-label="Cancel NEAR L1 key authorization"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="space-y-2 pr-8">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 text-[10px] font-mono font-bold uppercase tracking-wider">
            <KeyRound className="w-3 h-3" />
            <span>{meta.badge}</span>
          </div>
          <h3 id="native-l1-auth-title" className="text-lg font-display font-extrabold tracking-tight">
            {meta.title}
          </h3>
          <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
            NEAR Native L1 assets live on your L1 sub-account rather than <code className="font-mono text-[11px]">intents.near</code>. Unlocking &amp; using that key requires two deliberate steps.
          </p>
        </div>

        {/* Two-step Progress Pill */}
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div
            className={`p-2.5 rounded-2xl border flex items-center gap-2 ${
              phase === 'ready' || phase === 'authorizing'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-stone-950 dark:bg-stone-100 text-white dark:text-stone-950 border-stone-950 dark:border-stone-100'
            }`}
          >
            {phase === 'ready' || phase === 'authorizing' ? (
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                1
              </span>
            )}
            <span className="font-bold truncate">Sign Passkey</span>
          </div>

          <div
            className={`p-2.5 rounded-2xl border flex items-center gap-2 ${
              phase === 'ready' || phase === 'authorizing'
                ? 'bg-stone-950 dark:bg-stone-100 text-white dark:text-stone-950 border-stone-950 dark:border-stone-100'
                : 'bg-stone-50 dark:bg-stone-800/60 border-stone-200 dark:border-stone-700 text-stone-400'
            }`}
          >
            <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px] font-bold flex-shrink-0">
              2
            </span>
            <span className="font-bold truncate">Use L1 Key</span>
          </div>
        </div>

        {/* Exact Details Card */}
        <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/80 divide-y divide-stone-200 dark:divide-stone-700/70 text-xs font-mono">
          {prepared.nearAccount && (
            <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
              <span className="text-stone-500">L1 Account</span>
              <span className="font-bold truncate max-w-[220px]">{prepared.nearAccount}</span>
            </div>
          )}
          {(prepared.amount || prepared.symbol || prepared.asset) && (
            <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
              <span className="text-stone-500">Asset</span>
              <span className="font-bold">
                {prepared.amount ? `${prepared.amount} ` : ''}
                {prepared.symbol || prepared.asset}
              </span>
            </div>
          )}
          {prepared.target && (
            <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
              <span className="text-stone-500">Target</span>
              <span className="font-bold truncate max-w-[220px]">{prepared.target}</span>
            </div>
          )}
          <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
            <span className="text-stone-500">Grant Scope</span>
            <span className="font-bold text-amber-800 dark:text-amber-300">Single-use (5m)</span>
          </div>
        </div>

        {phase === 'ready' || phase === 'authorizing' ? (
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 text-[11px] font-mono text-emerald-900 dark:text-emerald-200 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <span>
              Passkey signature verified locally. Tap below to authorize your NEAR L1 key for this exact action.
            </span>
          </div>
        ) : (
          <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 text-[11px] font-mono text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <span>
              Separates NEAR L1 Ed25519 actions from your Intents Passkey vault — like revealing a key.
            </span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs font-mono text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleCancel}
            disabled={phase === 'signing' || phase === 'authorizing'}
            className="px-4 py-3 rounded-2xl border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 text-xs font-mono font-bold text-stone-700 dark:text-stone-300 transition-colors cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>

          {phase === 'sign' || phase === 'signing' ? (
            <button
              type="button"
              onClick={handleStep1Sign}
              disabled={phase === 'signing'}
              className="flex-1 py-3 px-4 rounded-2xl bg-black dark:bg-white hover:bg-stone-800 dark:hover:bg-stone-200 text-white dark:text-stone-950 text-xs font-display font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 shadow-md transition-all"
            >
              {phase === 'signing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Waiting for Passkey…</span>
                </>
              ) : (
                <>
                  <Fingerprint className="w-4 h-4" />
                  <span>Step 1: Sign with Passkey</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStep2AuthorizeAndUseKey}
              disabled={phase === 'authorizing'}
              className="flex-1 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-display font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 shadow-md transition-all"
            >
              {phase === 'authorizing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Using L1 Key…</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Step 2: {meta.cta}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
