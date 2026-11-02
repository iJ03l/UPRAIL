'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  ShieldCheck,
  Lock,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Fingerprint,
} from 'lucide-react';

const PRESET_HANDLES = [
  { handle: 'satoshi', name: 'Satoshi' },
  { handle: 'illia', name: 'Illia' },
  { handle: 'mert', name: 'Mert' },
];

const PRESET_AMOUNTS = ['100', '500', '1,000', '2,500'];

const PRESET_TOKENS = [
  { symbol: 'USDC', name: 'USD Coin', badge: 'Native Stable' },
  { symbol: 'NEAR', name: 'NEAR Protocol', badge: 'Sharded Intents' },
  { symbol: 'SOL', name: 'Solana', badge: 'Native SVM' },
  { symbol: 'BTC', name: 'Bitcoin', badge: 'Native SegWit' },
];

export const InteractiveRailSimulator: React.FC = () => {
  const [handle, setHandle] = useState('illia');
  const [selectedToken, setSelectedToken] = useState(PRESET_TOKENS[0]);
  const [amount, setAmount] = useState('500');
  const [stage, setStage] = useState<'idle' | 'routing' | 'shielding' | 'settled'>('idle');

  const cleanHandle = handle.replace(/^@/, '').trim() || 'illia';

  const handleSimulate = () => {
    if (stage !== 'idle' && stage !== 'settled') return;
    setStage('routing');

    setTimeout(() => {
      setStage('shielding');
      setTimeout(() => {
        setStage('settled');
      }, 1400);
    }, 1200);
  };

  const isSimulating = stage === 'routing' || stage === 'shielding';

  return (
    <div className="w-full border-y border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-[#0A0807] py-14 sm:py-20 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 space-y-8">
        {/* Header */}
        <div className="space-y-2 text-left border-b border-stone-200 dark:border-stone-800 pb-6">
          <span className="text-xs sm:text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
            // Transfer Simulator
          </span>
          <h3 className="text-3xl sm:text-4xl md:text-5xl font-display font-black text-stone-950 dark:text-white tracking-tight">
            Confidential Send &amp; Settlement
          </h3>
          <p className="text-sm sm:text-base text-stone-600 dark:text-stone-400 font-sans max-w-xl">
            Simulate how a transfer enters via an 𝕏 handle, settles confidentially through NEAR Intents, and delivers straight into a personal near.com wallet.
          </p>
        </div>

        {/* 2-Column Minimal Architecture */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
          {/* Left Column: Input Form */}
          <div className="lg:col-span-5 rounded-3xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#110D0B] p-5 sm:p-7 space-y-5 shadow-xs">
            {/* Target 𝕏 Handle */}
            <div className="space-y-2">
              <label className="block text-xs font-mono uppercase tracking-wider text-stone-500 font-bold">
                Destination 𝕏 Handle
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-bold text-[#E05326] text-base">
                  @
                </span>
                <input
                  type="text"
                  value={cleanHandle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="handle"
                  disabled={isSimulating}
                  className="w-full pl-8 pr-4 py-3 bg-stone-50 dark:bg-black border border-stone-200 dark:border-stone-800 focus:border-[#E05326] rounded-xl text-stone-900 dark:text-white font-mono text-sm focus:outline-none transition-colors"
                />
              </div>

              {/* Preset Handle Chips */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {PRESET_HANDLES.map((p) => (
                  <button
                    key={p.handle}
                    type="button"
                    onClick={() => setHandle(p.handle)}
                    disabled={isSimulating}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      cleanHandle.toLowerCase() === p.handle
                        ? 'bg-[#E05326] text-white'
                        : 'bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    @{p.handle}
                  </button>
                ))}
              </div>
            </div>

            {/* Asset Picker */}
            <div className="space-y-2">
              <label className="block text-xs font-mono uppercase tracking-wider text-stone-500 font-bold">
                Asset &amp; Rail
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_TOKENS.map((token) => (
                  <button
                    key={token.symbol}
                    type="button"
                    onClick={() => setSelectedToken(token)}
                    disabled={isSimulating}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer space-y-1 ${
                      selectedToken.symbol === token.symbol
                        ? 'bg-black text-white dark:bg-stone-900 border-[#E05326] ring-1 ring-[#E05326]'
                        : 'bg-stone-50 dark:bg-black border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:border-stone-400'
                    }`}
                  >
                    <div className="text-xs font-mono font-bold">{token.symbol}</div>
                    <div className="text-[10px] text-stone-400 font-mono truncate">{token.badge}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Amount Presets */}
            <div className="space-y-2">
              <label className="block text-xs font-mono uppercase tracking-wider text-stone-500 font-bold">
                Amount (USD)
              </label>
              <div className="grid grid-cols-4 gap-2">
                {PRESET_AMOUNTS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmount(val)}
                    disabled={isSimulating}
                    className={`py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer text-center ${
                      amount === val
                        ? 'bg-black text-white dark:bg-white dark:text-black'
                        : 'bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    ${val}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Button */}
            <button
              type="button"
              onClick={handleSimulate}
              disabled={isSimulating}
              className="w-full py-3.5 rounded-xl bg-[#E05326] hover:bg-[#d0461b] text-white font-display font-extrabold text-xs uppercase tracking-wider shadow-sm hover:shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              {isSimulating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Settling Confidential Intent...</span>
                </>
              ) : (
                <>
                  <span>Simulate Confidential Send</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Right Column: Execution Topology & State */}
          <div className="lg:col-span-7 rounded-3xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#110D0B] p-5 sm:p-7 space-y-6 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 dark:border-stone-800 text-xs font-mono">
              <span className="font-bold text-stone-500 uppercase">Settlement Pipeline</span>
              <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                stage === 'settled'
                  ? 'bg-[#00EC97]/20 text-[#00EC97] border border-[#00EC97]/40'
                  : stage === 'shielding' || stage === 'routing'
                    ? 'bg-[#E05326]/20 text-[#E05326] border border-[#E05326]/40 animate-pulse'
                    : 'bg-stone-100 dark:bg-stone-900 text-stone-400'
              }`}>
                {stage === 'settled' ? 'CONFIDENTIAL SETTLED' : stage === 'shielding' ? 'NEP-518 ACTIVE' : stage === 'routing' ? 'INGRESS ROUTED' : 'READY TO SIMULATE'}
              </span>
            </div>

            {/* 3 Real Product Steps */}
            <div className="space-y-4">
              {/* Step 1: Ingress */}
              <div className={`p-4 rounded-2xl border transition-all ${
                stage !== 'idle'
                  ? 'bg-stone-50 dark:bg-black border-[#E05326]/40'
                  : 'bg-stone-50/50 dark:bg-black/50 border-stone-200 dark:border-stone-800 opacity-60'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-mono font-bold text-[#E05326]">01 / Universal Ingress</div>
                    <div className="font-display font-bold text-sm text-stone-900 dark:text-white">
                      Permanent 𝕏 Handle Deposit Gateway
                    </div>
                    <div className="text-xs text-stone-500 font-mono">
                      Target: @{cleanHandle} · {amount} {selectedToken.symbol} · Zero 15-min session expiry
                    </div>
                  </div>
                  {stage !== 'idle' && (
                    <CheckCircle2 className="w-4 h-4 text-[#E05326] flex-shrink-0 mt-1" />
                  )}
                </div>
              </div>

              {/* Step 2: Solver Relay & NEP-518 */}
              <div className={`p-4 rounded-2xl border transition-all ${
                stage === 'shielding' || stage === 'settled'
                  ? 'bg-stone-50 dark:bg-black border-[#00EC97]/40'
                  : 'bg-stone-50/50 dark:bg-black/50 border-stone-200 dark:border-stone-800 opacity-60'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-mono font-bold text-[#00EC97]">02 / Solver Relay &amp; Escrow</div>
                    <div className="font-display font-bold text-sm text-stone-900 dark:text-white">
                      NEP-518 Confidential Solver Execution
                    </div>
                    <div className="text-xs text-stone-500 font-mono">
                      Contract: intents.near · Escrow: escrow.uprail.near · $0.00 Bridge Fee
                    </div>
                  </div>
                  {(stage === 'shielding' || stage === 'settled') && (
                    <ShieldCheck className="w-4 h-4 text-[#00EC97] flex-shrink-0 mt-1" />
                  )}
                </div>
              </div>

              {/* Step 3: Sovereign Claim */}
              <div className={`p-4 rounded-2xl border transition-all ${
                stage === 'settled'
                  ? 'bg-stone-50 dark:bg-black border-[#00EC97]/40'
                  : 'bg-stone-50/50 dark:bg-black/50 border-stone-200 dark:border-stone-800 opacity-60'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-mono font-bold text-[#00EC97]">03 / Sovereign Claim</div>
                    <div className="font-display font-bold text-sm text-stone-900 dark:text-white">
                      Direct near.com Wallet or Passkey Biometric
                    </div>
                    <div className="text-xs text-stone-500 font-mono">
                      Receptacle: nearcom:0x... or Touch ID / Face ID WebAuthn
                    </div>
                  </div>
                  {stage === 'settled' && (
                    <CheckCircle2 className="w-4 h-4 text-[#00EC97] flex-shrink-0 mt-1" />
                  )}
                </div>
              </div>
            </div>

            {/* Diagnostic Footer */}
            <div className="pt-3 border-t border-stone-200 dark:border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center space-x-3 text-stone-500">
                <span>Identity Leak: <strong className="text-[#00EC97]">0%</strong></span>
                <span>·</span>
                <span>Bridge Fee: <strong className="text-[#00EC97]">$0.00</strong></span>
              </div>
              <a
                href={`https://app.uprail.world/send?recipient=${encodeURIComponent(cleanHandle)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1.5 font-bold text-[#E05326] hover:underline"
              >
                <span>Launch Send in App</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
