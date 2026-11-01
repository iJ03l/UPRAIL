'use client';

import React, { useState } from 'react';
import { ChainLogo } from './ChainLogo';
import { TokenIcon } from './TokenIcon';
import { Zap, Shield, Layers, ArrowUpRight, CheckCircle2 } from 'lucide-react';

interface ChainItem {
  id: string;
  name: string;
  family: string;
  finality: string;
  highlight: string;
  nativeToken: string;
}

const FEATURED_CHAINS: ChainItem[] = [
  { id: 'near', name: 'NEAR Protocol', family: 'Sharded Intents', finality: '1.0s', highlight: 'Native Confidential Rail', nativeToken: 'NEAR' },
  { id: 'base', name: 'Base', family: 'OP Stack L2', finality: '1.2s', highlight: 'Sub-Cent Gas Ingress', nativeToken: 'USDC' },
  { id: 'sol', name: 'Solana', family: 'SVM Execution', finality: '0.8s', highlight: 'SPL & Native Settlement', nativeToken: 'SOL' },
  { id: 'btc', name: 'Bitcoin', family: 'UTXO Native SegWit', finality: 'Solver Auction', highlight: 'Zero-Bridge BTC Ingress', nativeToken: 'BTC' },
  { id: 'eth', name: 'Ethereum', family: 'Mainnet L1', finality: '12.0s', highlight: 'L1 Direct Settlement', nativeToken: 'ETH' },
  { id: 'arbitrum', name: 'Arbitrum One', family: 'Nitro Rollup', finality: '1.5s', highlight: 'Deep DeFi Liquidity', nativeToken: 'USDC' },
  { id: 'pol', name: 'Polygon', family: 'PoS / AggLayer', finality: '2.0s', highlight: 'Low-Fee Routing', nativeToken: 'POL' },
  { id: 'op', name: 'Optimism', family: 'Superchain L2', finality: '1.8s', highlight: 'OP Stack Shared Sequencer', nativeToken: 'ETH' },
  { id: 'avax', name: 'Avalanche', family: 'Avalanche C-Chain', finality: '1.5s', highlight: 'Sub-Second Finality', nativeToken: 'AVAX' },
  { id: 'bsc', name: 'BNB Chain', family: 'BSC Network', finality: '3.0s', highlight: 'High-Throughput Ingress', nativeToken: 'BNB' },
  { id: 'tron', name: 'TRON', family: 'TRC-20 Rail', finality: '2.0s', highlight: 'Global USDT Remittance', nativeToken: 'USDT' },
  { id: 'doge', name: 'Dogecoin', family: 'UTXO Native', finality: 'Solver Auction', highlight: 'Non-Custodial Ingress', nativeToken: 'DOGE' },
];

const CURATED_ASSETS = [
  { symbol: 'USDC', name: 'USD Coin', standard: 'Omnichain Stable', chains: 'Base, Arb, Sol, Eth, NEAR' },
  { symbol: 'USDT', name: 'Tether USD', standard: 'TRC-20 / ERC-20', chains: 'Tron, Eth, Arb, NEAR' },
  { symbol: 'NEAR', name: 'NEAR', standard: 'Native Sharded', chains: 'NEAR Protocol Core' },
  { symbol: 'ETH', name: 'Ethereum', standard: 'Native / ERC-20', chains: 'Ethereum, Base, Arbitrum' },
  { symbol: 'SOL', name: 'Solana', standard: 'Native / SPL', chains: 'Solana SVM' },
  { symbol: 'BTC', name: 'Bitcoin', standard: 'Native SegWit / wBTC', chains: 'Bitcoin Network' },
  { symbol: 'wNEAR', name: 'Wrapped NEAR', standard: 'NEP-141 Intents', chains: 'NEAR Intents Mesh' },
  { symbol: 'DAI', name: 'Maker DAI', standard: 'Multi-Collateral', chains: 'Ethereum, Arbitrum' },
  { symbol: 'SWEAT', name: 'Sweat Economy', standard: 'NEP-141 Move-to-Earn', chains: 'NEAR Ecosystem' },
  { symbol: 'BLACKDRAGON', name: 'BlackDragon', standard: 'Community NEP-141', chains: 'NEAR Ecosystem' },
  { symbol: 'HOOT', name: 'JustHoot', standard: 'Launchpad NEP-141', chains: 'JustHoot v2 Creator Pool' },
  { symbol: 'NEARLY', name: 'Nearly Token', standard: 'Launchpad NEP-141', chains: 'Nearly Launchpad' },
  { symbol: 'INTEAR', name: 'Intear', standard: 'DEX NEP-141', chains: 'Intear Launchpad & DEX' },
];

export const MultiChainSection: React.FC = () => {
  const [selectedChain, setSelectedChain] = useState<string>('near');
  const activeChain = FEATURED_CHAINS.find((c) => c.id === selectedChain) || FEATURED_CHAINS[0];

  return (
    <section id="multichain" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24 space-y-8">
      {/* Section Header */}
      <div className="space-y-3 text-left">
        <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
          // Multi-Chain Scale &amp; Liquidity
        </span>
        <h2 className="text-3xl sm:text-5xl font-display font-extrabold tracking-tight text-stone-950 dark:text-white leading-[1.06]">
          35+ Blockchains. 50+ Assets.
          <br className="hidden sm:inline" /> Zero Bridging Friction.
        </h2>
        <p className="text-sm sm:text-base text-stone-600 dark:text-stone-400 max-w-3xl leading-relaxed">
          No manual gas bridges, no wrapped-token slippage, and no fragile liquidity pools.
          UPRAIL routes deposit ingress and passkey-signed withdrawals across every major L1, L2,
          and alternative execution layer—settling atomically into NEAR Confidential Intents.
        </p>
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
              Verified Assets
            </span>
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-2xl sm:text-4xl font-display font-black text-stone-950 dark:text-white">
            50+
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 font-mono leading-tight">
            USDC, USDT, NEAR, BTC, ETH, SOL, plus Rhea launchpad tokens.
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

      {/* Interactive Chain Matrix Chassis */}
      <div className="rounded-3xl bg-stone-950 text-white border border-stone-800 p-5 sm:p-8 space-y-6 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-800/80 pb-4">
          <div className="space-y-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#E05326]">
              Execution Rails
            </span>
            <h3 className="text-xl sm:text-2xl font-display font-extrabold text-white">
              Sovereign Chain Ingress &amp; Withdrawal Matrix
            </h3>
          </div>
          <span className="text-xs font-mono text-stone-400 self-start sm:self-auto">
            Click any network to inspect route metrics
          </span>
        </div>

        {/* Chain Selector Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {FEATURED_CHAINS.map((chain) => {
            const isSelected = chain.id === selectedChain;
            return (
              <button
                key={chain.id}
                type="button"
                onClick={() => setSelectedChain(chain.id)}
                className={`p-3 rounded-2xl text-left border transition-all flex flex-col justify-between space-y-2.5 cursor-pointer ${
                  isSelected
                    ? 'bg-stone-900 border-[#E05326] shadow-sm shadow-[#E05326]/20 ring-1 ring-[#E05326]'
                    : 'bg-stone-900/40 border-stone-800 hover:border-stone-700 hover:bg-stone-900/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <ChainLogo chainId={chain.id} className="w-6 h-6" />
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-black/60 text-stone-400 font-bold border border-stone-800">
                    {chain.nativeToken}
                  </span>
                </div>
                <div>
                  <div className="text-xs font-display font-bold text-white truncate">
                    {chain.name}
                  </div>
                  <div className="text-[10px] font-mono text-stone-400 truncate">
                    {chain.family}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Chain Telemetry Detail Panel */}
        <div className="p-4 sm:p-5 rounded-2xl bg-black/60 border border-stone-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <ChainLogo chainId={activeChain.id} className="w-10 h-10" />
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-base font-display font-black text-white">
                  {activeChain.name}
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-bold">
                  {activeChain.highlight}
                </span>
              </div>
              <p className="text-xs text-stone-400 font-mono mt-0.5">
                Architecture: {activeChain.family} · Finality Window: {activeChain.finality}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 self-start md:self-auto text-xs font-mono">
            <span className="text-stone-400">Atomic Solver Route:</span>
            <span className="text-[#00EC97] font-bold">Direct to @handle</span>
          </div>
        </div>

        {/* 23+ Additional Chains Banner */}
        <div className="p-3.5 rounded-2xl bg-stone-900/60 border border-stone-800/60 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-stone-400">
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-stone-300 font-bold">
              + 23 additional blockchains connected via 1Click Solver Relay:
            </span>
          </div>
          <span className="text-stone-400 text-[11px]">
            Sui, Aptos, TON, Monad, Berachain, Mantle, Linea, Scroll, Blast, zkSync, Hyperliquid, Stellar, XRP Ledger, Zcash...
          </span>
        </div>
      </div>

      {/* Curated Verified Asset Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">
              Token Catalog
            </span>
            <h3 className="text-lg font-display font-extrabold text-stone-950 dark:text-white">
              Direct Ingress &amp; Confidentially Shielded Assets
            </h3>
          </div>
          <a
            href="https://app.uprail.world/send"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-[#E05326] hover:underline inline-flex items-center gap-1 font-bold"
          >
            <span>View in App</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-2.5">
          {CURATED_ASSETS.map((asset) => (
            <div
              key={asset.symbol}
              className="p-3 rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 flex items-center space-x-2.5 hover:border-stone-400 dark:hover:border-stone-700 transition-colors shadow-xs"
            >
              <TokenIcon symbol={asset.symbol} size="md" className="flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-display font-bold text-stone-950 dark:text-white truncate">
                  {asset.symbol}
                </div>
                <div className="text-[10px] font-mono text-stone-500 dark:text-stone-400 truncate">
                  {asset.name}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] font-mono text-stone-500 dark:text-stone-400 pt-1">
          * Any NEP-141 token deployed on NEAR or created through Rhea launchpads (Nearly, JustHoot, Intear) is immediately routable to an 𝕏 handle with sponsored storage.
        </p>
      </div>
    </section>
  );
};
