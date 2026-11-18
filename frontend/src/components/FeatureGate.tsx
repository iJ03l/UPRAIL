'use client';

import React, { useEffect, useState } from 'react';
import { Lock, ArrowRight, Sparkle } from '@phosphor-icons/react';
import { Badge } from './Badge';

/**
 * Temporary access gate for a not-yet-public feature.
 *
 * The expected code is read from `NEXT_PUBLIC_AGENTS_GATE_KEY` at build time.
 * When the variable is unset the gate is disabled and children render straight
 * away, so removing the variable (and this wrapper) fully un-gates the feature.
 */
export const FeatureGate: React.FC<{
  storageKey: string;
  title: string;
  subtitle?: string;
  docsHref?: string;
  children: React.ReactNode;
}> = ({ storageKey, title, subtitle, docsHref, children }) => {
  const expected = process.env.NEXT_PUBLIC_AGENTS_GATE_KEY || '';
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!expected) {
      setUnlocked(true);
      return;
    }
    try {
      setUnlocked(localStorage.getItem(storageKey) === '1');
    } catch {
      setUnlocked(false);
    }
  }, [expected, storageKey]);

  if (unlocked === null) return null;
  if (unlocked) return <>{children}</>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() === expected) {
      try {
        localStorage.setItem(storageKey, '1');
      } catch {}
      setUnlocked(true);
    } else {
      setError(true);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white border border-stone-200 rounded-3xl p-8 shadow-sm space-y-6">
        <div className="space-y-3 text-center">
          <Badge tone="neutral" icon={<Sparkle weight="fill" className="w-3 h-3" />}>
            Coming soon
          </Badge>
          <div className="w-12 h-12 mx-auto rounded-2xl bg-stone-950 text-white flex items-center justify-center">
            <Lock weight="fill" className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-display font-extrabold tracking-tight text-stone-950">
              {title}
            </h1>
            {subtitle && <p className="text-sm text-stone-500 leading-relaxed">{subtitle}</p>}
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            value={value}
            autoFocus
            onChange={(e) => {
              setValue(e.target.value);
              setError(false);
            }}
            placeholder="Access code"
            className={`w-full px-4 py-3 rounded-xl border bg-stone-50 font-mono text-sm text-stone-900 focus:outline-none focus:ring-2 transition-colors ${
              error
                ? 'border-red-300 focus:ring-red-200'
                : 'border-stone-200 focus:ring-stone-300 focus:border-stone-400'
            }`}
          />
          {error && <p className="text-xs text-red-600 font-mono">Incorrect access code.</p>}
          <button
            type="submit"
            className="w-full px-4 py-3 rounded-xl bg-stone-950 hover:bg-stone-800 text-white font-display font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
          >
            <span>Unlock preview</span>
            <ArrowRight weight="bold" className="w-3.5 h-3.5" />
          </button>
        </form>

        {docsHref && (
          <p className="text-center text-[11px] font-mono text-stone-400">
            Read the{' '}
            <a href={docsHref} className="underline text-stone-600 hover:text-stone-900">
              developer docs
            </a>
          </p>
        )}
      </div>
    </div>
  );
};
