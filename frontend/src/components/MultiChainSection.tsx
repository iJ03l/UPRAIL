'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Layers, Shield, Zap, CheckCircle2, ArrowUpRight } from 'lucide-react';

const NETWORKS = [
  { name: 'Bitcoin', symbol: 'BTC', arch: 'UTXO' },
  { name: 'Ethereum', symbol: 'ETH', arch: 'EVM L1' },
  { name: 'Solana', symbol: 'SOL', arch: 'SVM' },
  { name: 'NEAR Protocol', symbol: 'NEAR', arch: 'Sharded Intents' },
  { name: 'Base', symbol: 'BASE', arch: 'OP Stack' },
  { name: 'Arbitrum', symbol: 'ARB', arch: 'Nitro Rollup' },
  { name: 'Polygon', symbol: 'POL', arch: 'AggLayer' },
  { name: 'Sui', symbol: 'SUI', arch: 'Move' },
  { name: 'Aptos', symbol: 'APT', arch: 'Move' },
  { name: 'TON', symbol: 'TON', arch: 'TVM' },
  { name: 'Avalanche', symbol: 'AVAX', arch: 'C-Chain' },
  { name: 'Tron', symbol: 'TRX', arch: 'TRC-20' },
  { name: 'Optimism', symbol: 'OP', arch: 'Superchain' },
  { name: 'Monad', symbol: 'MONAD', arch: 'Parallel EVM' },
  { name: 'Berachain', symbol: 'BERA', arch: 'Proof of Liquidity' },
];

const ASSETS = [
  { symbol: 'USDC', name: 'USD Coin', standard: 'Native Stable' },
  { symbol: 'USDT', name: 'Tether USD', standard: 'Omnichain' },
  { symbol: 'NEAR', name: 'NEAR Protocol', standard: 'Native L1' },
  { symbol: 'SOL', name: 'Solana', standard: 'Native SVM' },
  { symbol: 'BTC', name: 'Bitcoin', standard: 'Native SegWit' },
  { symbol: 'ETH', name: 'Ethereum', standard: 'Native L1' },
  { symbol: 'wNEAR', name: 'Wrapped NEAR', standard: 'NEP-141' },
  { symbol: 'DAI', name: 'Maker DAI', standard: 'Decentralized' },
  { symbol: 'SWEAT', name: 'Sweat Economy', standard: 'NEP-141' },
  { symbol: 'BLACKDRAGON', name: 'BlackDragon', standard: 'NEP-141' },
  { symbol: 'HOOT', name: 'JustHoot', standard: 'Rhea Launchpad' },
  { symbol: 'NEARLY', name: 'Nearly Token', standard: 'Rhea Launchpad' },
  { symbol: 'INTEAR', name: 'Intear', standard: 'Rhea Launchpad' },
];

export const MultiChainSection: React.FC = () => {
  return (
    <section id="multichain" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="space-y-2 text-left">
        <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
          // Multi-Chain Scale
        </span>
        <h2 className="text-3xl sm:text-5xl font-display font-extrabold tracking-tight text-stone-950 dark:text-white leading-[1.06]">
          35+ Blockchains. Over 450 Assets.
        </h2>
      </div>

      {/* 4 Crisp Telemetry Metrics (Pure Numbers & Technical Tags, Zero Fluff Text) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Metric 1 */}
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-2 shadow-xs relative overflow-hidden group hover:border-[#E05326] transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 group-hover:text-[#E05326] transition-colors">
              Connected Networks
            </span>
            <Layers className="w-3.5 h-3.5 text-[#E05326]" />
          </div>
          <div className="text-3xl sm:text-5xl font-display font-black text-stone-950 dark:text-white tracking-tight">
            35+
          </div>
          <div className="flex items-center space-x-1.5 pt-1 text-[10px] font-mono font-bold text-stone-400">
            <span className="h-1.5 w-1.5 rounded-full bg-[#E05326] animate-pulse" />
            <span>EVM · SVM · UTXO</span>
          </div>
        </motion.div>

        {/* Metric 2 */}
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-2 shadow-xs relative overflow-hidden group hover:border-emerald-500 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 group-hover:text-emerald-500 transition-colors">
              Supported Assets
            </span>
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-3xl sm:text-5xl font-display font-black text-stone-950 dark:text-white tracking-tight">
            450+
          </div>
          <div className="flex items-center space-x-1.5 pt-1 text-[10px] font-mono font-bold text-stone-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>STABLES · L1s · NEP-141</span>
          </div>
        </motion.div>

        {/* Metric 3 */}
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-2 shadow-xs relative overflow-hidden group hover:border-amber-500 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 group-hover:text-amber-500 transition-colors">
              Intent Finality
            </span>
            <Zap className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-3xl sm:text-5xl font-display font-black text-stone-950 dark:text-white tracking-tight">
            &lt; 2.1s
          </div>
          <div className="flex items-center space-x-1.5 pt-1 text-[10px] font-mono font-bold text-stone-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>ATOMIC SOLVER RELAY</span>
          </div>
        </motion.div>

        {/* Metric 4 */}
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-2 shadow-xs relative overflow-hidden group hover:border-[#00EC97] transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 group-hover:text-[#00EC97] transition-colors">
              Sponsored Gas
            </span>
            <CheckCircle2 className="w-3.5 h-3.5 text-[#00EC97]" />
          </div>
          <div className="text-3xl sm:text-5xl font-display font-black text-stone-950 dark:text-white tracking-tight">
            100%
          </div>
          <div className="flex items-center space-x-1.5 pt-1 text-[10px] font-mono font-bold text-stone-400">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00EC97]" />
            <span>0.01 NEAR SPONSORED</span>
          </div>
        </motion.div>
      </div>

      {/* Kinetic Hardware Rail Matrix (Infinite Hardware-Accelerated Stream via Framer Motion) */}
      <div className="rounded-3xl border border-stone-200 dark:border-stone-800/80 bg-stone-50/50 dark:bg-[#0A0807] p-4 sm:p-6 space-y-3 overflow-hidden relative shadow-sm">
        {/* Fading Edge Mask Gradients */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 sm:w-24 bg-gradient-to-r from-stone-50 dark:from-[#0A0807] to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 sm:w-24 bg-gradient-to-l from-stone-50 dark:from-[#0A0807] to-transparent z-10" />

        {/* Track 1: Connected Blockchains Marquee */}
        <div className="flex overflow-hidden select-none">
          <motion.div
            className="flex items-center space-x-2.5 flex-shrink-0"
            animate={{ x: [0, -1080] }}
            transition={{
              repeat: Infinity,
              ease: 'linear',
              duration: 28,
            }}
          >
            {[...NETWORKS, ...NETWORKS].map((chain, idx) => (
              <div
                key={`${chain.symbol}-${idx}`}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-white dark:bg-stone-900/90 border border-stone-200 dark:border-stone-800 hover:border-[#E05326] transition-colors flex-shrink-0 cursor-default group"
              >
                <span className="font-mono font-black text-xs text-stone-950 dark:text-white group-hover:text-[#E05326] transition-colors">
                  {chain.symbol}
                </span>
                <span className="text-[11px] font-sans text-stone-500 dark:text-stone-400">
                  {chain.name}
                </span>
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
                  {chain.arch}
                </span>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Track 2: Supported Assets Marquee (Reversed Flow) */}
        <div className="flex overflow-hidden select-none pt-1">
          <motion.div
            className="flex items-center space-x-2.5 flex-shrink-0"
            animate={{ x: [-1080, 0] }}
            transition={{
              repeat: Infinity,
              ease: 'linear',
              duration: 32,
            }}
          >
            {[...ASSETS, ...ASSETS].map((asset, idx) => (
              <div
                key={`${asset.symbol}-${idx}`}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-white dark:bg-stone-900/90 border border-stone-200 dark:border-stone-800 hover:border-[#00EC97] transition-colors flex-shrink-0 cursor-default group"
              >
                <span className="font-mono font-black text-xs text-stone-950 dark:text-white group-hover:text-[#00EC97] transition-colors">
                  {asset.symbol}
                </span>
                <span className="text-[11px] font-sans text-stone-500 dark:text-stone-400">
                  {asset.name}
                </span>
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
                  {asset.standard}
                </span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
};
