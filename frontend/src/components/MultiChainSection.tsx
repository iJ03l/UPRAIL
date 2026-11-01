'use client';

import React from 'react';
import { Layers, Shield, Zap, CheckCircle2 } from 'lucide-react';

export const MultiChainSection: React.FC = () => {
  return (
    <section id="multichain" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24 space-y-6">
      {/* Section Header */}
      <div className="space-y-2 text-left">
        <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
          // Multi-Chain Scale
        </span>
        <h2 className="text-3xl sm:text-5xl font-display font-extrabold tracking-tight text-stone-950 dark:text-white leading-[1.06]">
          35+ Blockchains. Over 450 Assets.
        </h2>
      </div>

      {/* 4 Hard Telemetry Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">
              Connected Networks
            </span>
            <Layers className="w-3.5 h-3.5 text-[#E05326]" />
          </div>
          <div className="text-2xl sm:text-4xl font-display font-black text-stone-950 dark:text-white">
            35+
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 font-mono leading-tight">
            EVM, Solana, Bitcoin SegWit, NEAR, Sui, Aptos, TON, Tron &amp; L2s.
          </p>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">
              Supported Assets
            </span>
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-2xl sm:text-4xl font-display font-black text-stone-950 dark:text-white">
            450+
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 font-mono leading-tight">
            Omnichain stables, native layer-1s, and ecosystem launchpad tokens.
          </p>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">
              Intent Finality
            </span>
            <Zap className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-2xl sm:text-4xl font-display font-black text-stone-950 dark:text-white">
            &lt; 2.1s
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 font-mono leading-tight">
            Cryptographic solver-auction routing without manual bridging.
          </p>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">
              Sponsored Storage
            </span>
            <CheckCircle2 className="w-3.5 h-3.5 text-[#00EC97]" />
          </div>
          <div className="text-2xl sm:text-4xl font-display font-black text-stone-950 dark:text-white">
            100%
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 font-mono leading-tight">
            0.01 NEAR vault storage &amp; gas reserves funded automatically.
          </p>
        </div>
      </div>
    </section>
  );
};
