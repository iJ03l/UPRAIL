'use client';

import React from 'react';
import {
  ShieldCheck,
  ExternalLink,
  Lock,
  Cpu,
  Layers,
} from 'lucide-react';

export const NearcomSection: React.FC = () => {
  return (
    <section id="nearcom" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24 space-y-10">
      {/* Section Header */}
      <div className="space-y-3 text-left">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold">
            // The near.com Sovereign Gateway
          </span>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold">
            Zero Bridge Fees
          </span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-display font-extrabold tracking-tight text-stone-950 dark:text-white leading-[1.06]">
          Opening near.com to the World.
          <br className="hidden sm:inline" /> Confidentially. Zero Compromise.
        </h2>
        <p className="text-sm sm:text-base text-stone-600 dark:text-stone-400 max-w-3xl leading-relaxed">
          On near.com, cross-chain deposit addresses are ephemeral 15-minute session quotes that require
          you to be logged in at your keyboard. UPRAIL turns your 𝕏 handle into a permanent universal
          gateway—settling confidentially on NEAR Intents with zero-loss escrow protection and
          one-tap withdrawal straight into your personal near.com wallet.
        </p>
      </div>

      {/* 
        ASCII Hardware Schematic: Chord Plugging into near.com Socket Box
      */}
      <div className="rounded-3xl border border-stone-800 bg-[#0A0807] p-5 sm:p-7 space-y-4 shadow-2xl overflow-hidden relative">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-800/80 pb-3 text-xs font-mono">
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-stone-300 font-bold tracking-wider uppercase text-[11px]">
              Hardware Schematic // Universal Ingress Bus
            </span>
          </div>
          <span className="text-stone-400 text-[10px]">
            ASCII ARCHITECTURE: PUBLIC RAIL &rarr; near.com ADAPTER
          </span>
        </div>

        {/* The Monospace ASCII Illustration */}
        <pre className="font-mono text-[10px] sm:text-[11.5px] leading-tight text-stone-300 overflow-x-auto py-2 select-all scrollbar-thin scrollbar-thumb-stone-800">
{`========================================================================================================================
[ PUBLIC VALUE BUS (35+ CHAINS) ]               [ UPRAIL ADAPTER PLUG ]             [ near.com SOVEREIGN SOCKET BOX ]
========================================================================================================================

 35+ BLOCKCHAINS (EVM, SVM, UTXO)                 ┌─────────────┐
 Base · Solana · BTC · ETH · Arbitrum ─────────┐  │   UPRAIL    │       ┌──────────────────────────────────────────────┐
 Tron · Sui · Aptos · TON · Polygon ───────────┼──┤   ADAPTER   ├───┐   │ [●] RECEPTACLE PORT: nearcom:0x...           │
                                               │  │    CHORD    │   │   │ -------------------------------------------- │
 UNIVERSAL PUBLIC IDENTITY                     │  │    PLUG     │   └──►│  PIN 01: [NEP-518 SHIELD] ──► ACTIVE [100%]  │
 @handle (No Expiring Session Quotes) ─────────┴──┤             │       │  PIN 02: [SOLVER INTENTS] ──► ATOMIC ROUTE   │
                                                  │  [=======]  ├──────►│  PIN 03: [BRIDGE TARIFF]  ──► $0.00 / 0%     │
 CONFIDENTIAL EXECUTION CONDUIT                   │  [▓▓▓▓▓▓▓]  │       │  PIN 04: [ESCROW SAFETY]  ──► 30-DAY REFUND  │
 intents.near · Zero Seed Phrase Custody ─────────┤  [=======]  │   ┌──►│ -------------------------------------------- │
                                                  │             │   │   │  COUPLING: [ ENGAGED // WEBAUTHN P-256 ARMED]│
 PASSKEY HARDWARE BIOMETRIC GROUND ───────────────┴─────────────┘───┘   └──────────────────────────────────────────────┘
 Touch ID / Face ID / YubiKey ES256                      ▲                                     ▲
                                                [ CHORD ENGAGED ]                     [ SOVEREIGN RECEPTACLE LOCKED ]
========================================================================================================================`}
        </pre>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-800/80 text-[11px] font-mono text-stone-400">
          <div className="flex items-center space-x-3">
            <span className="text-emerald-400 font-bold">● PROTOCOL PINOUT ACTIVE</span>
            <span className="hidden sm:inline text-stone-400">|</span>
            <span className="text-stone-300">Target: <code className="text-[#E05326] font-bold">nearcom:0x...</code></span>
          </div>
          <span className="text-stone-400">Zero Bridge Fee · 100% Sponsored Execution Gas</span>
        </div>
      </div>

      {/* 
        Writeup: The Public Adapter to Privacy
      */}
      <div className="rounded-3xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 p-6 sm:p-9 space-y-8 shadow-xs">
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#E05326] font-bold px-2 py-0.5 rounded bg-orange-50 dark:bg-orange-950/60 border border-orange-200 dark:border-orange-900">
              Architecture Analysis
            </span>
            <span className="text-xs font-mono text-stone-400">
              The Public Adapter to Privacy
            </span>
          </div>

          <h3 className="text-2xl sm:text-3xl font-display font-black text-stone-950 dark:text-white tracking-tight">
            The Public Adapter to Privacy
          </h3>

          <p className="text-sm sm:text-base text-stone-600 dark:text-stone-400 leading-relaxed max-w-3xl font-sans">
            Public blockchains are radical transparency machines: every send permanently records the sender,
            recipient, token balance, and transaction history on public explorers. Meanwhile,{' '}
            <strong className="text-stone-900 dark:text-white">near.com</strong> built a sovereign account
            abstraction model, but cross-chain ingress still relies on ephemeral, 15-minute rotating session quotes
            that require the recipient to be online at the keyboard.
          </p>
          <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed max-w-3xl font-sans">
            UPRAIL operates as the physical adapter chord between the open, chaotic public web and near.com&apos;s
            private sovereign account layer. It bridges the impedance mismatch between public identity and
            cryptographic privacy with zero compromise and zero risk of loss.
          </p>
        </div>

        {/* 4 Architectural Pillars of the Adapter */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 pt-2">
          {/* 1. Eliminating the Rotating Address Barrier */}
          <div className="p-5 sm:p-6 rounded-2xl bg-stone-50 dark:bg-stone-900/40 border border-stone-200/80 dark:border-stone-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-stone-900 dark:text-white">
                01 / Universal Ingress vs Rotating Quotes
              </span>
              <Layers className="w-4 h-4 text-[#E05326]" />
            </div>
            <h4 className="font-display font-extrabold text-base text-stone-950 dark:text-white">
              Permanent Asynchronous Identity
            </h4>
            <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed font-sans">
              On near.com, you cannot print a deposit address on an invoice, paste it into your 𝕏 bio, or give it to an
              autonomous AI agent: cross-chain deposit quotes expire after 15 minutes. UPRAIL eliminates this barrier by
              mapping your 𝕏 handle to a persistent NEAR Intents vault. Anyone on 35+ chains sends to your handle at any
              time—quotes are resolved dynamically upon execution.
            </p>
          </div>

          {/* 2. Cryptographic Isolation */}
          <div className="p-5 sm:p-6 rounded-2xl bg-stone-50 dark:bg-stone-900/40 border border-stone-200/80 dark:border-stone-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-stone-900 dark:text-white">
                02 / Shielded Confidential Conduit
              </span>
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
            </div>
            <h4 className="font-display font-extrabold text-base text-stone-950 dark:text-white">
              Zero Counterparty Leakage (NEP-518)
            </h4>
            <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed font-sans">
              When value passes through the adapter, it does not broadcast an unshielded public transfer. Funds clear
              through the NEAR Confidential Intents layer (<code className="text-xs font-mono text-stone-900 dark:text-stone-200">intents.near</code> + NEP-518).
              Block explorers display only the solver contract pool—counterparty handles, amounts, and memos stay
              isolated inside zero-knowledge shielded state.
            </p>
          </div>

          {/* 3. 1-Tap Zero-Fee Settlement */}
          <div className="p-5 sm:p-6 rounded-2xl bg-stone-50 dark:bg-stone-900/40 border border-stone-200/80 dark:border-stone-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-stone-900 dark:text-white">
                03 / Internal Receptacle
              </span>
              <Cpu className="w-4 h-4 text-blue-500" />
            </div>
            <h4 className="font-display font-extrabold text-base text-stone-950 dark:text-white">
              1-Tap Zero-Fee Settlement to near.com
            </h4>
            <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed font-sans">
              Once value settles into your vault, moving it into your personal near.com wallet (<code className="text-xs font-mono text-stone-900 dark:text-stone-200">nearcom:0x...</code>)
              involves zero cross-chain bridge fees and zero slippage. Because your vault and near.com account reside within
              the same NEAR Intents liquidity layer, withdrawals execute with a single passkey tap at{' '}
              <strong className="text-stone-900 dark:text-white">100% sponsored gas and $0.00 bridge cost</strong>.
            </p>
          </div>

          {/* 4. Escrowed Zero-Loss Guarantee */}
          <div className="p-5 sm:p-6 rounded-2xl bg-stone-50 dark:bg-stone-900/40 border border-stone-200/80 dark:border-stone-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-stone-900 dark:text-white">
                04 / Fail-Closed Guarantee
              </span>
              <Lock className="w-4 h-4 text-amber-500" />
            </div>
            <h4 className="font-display font-extrabold text-base text-stone-950 dark:text-white">
              Escrow-Enforced Zero Risk of Loss
            </h4>
            <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 leading-relaxed font-sans">
              In standard crypto, sending funds to an expired deposit quote or an unclaimed address burns capital.
              UPRAIL operates fail-closed: transfers to unregistered handles sit in a pooled smart-contract escrow. Senders
              can cancel anytime, and unclaimed funds auto-refund after 30 days. No user funds are ever stranded.
            </p>
          </div>
        </div>

        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/80 dark:border-stone-800 text-xs font-mono">
          <a
            href="https://docs.uprail.world/docs/near"
            target="_blank"
            rel="noopener noreferrer"
            className="text-stone-600 dark:text-stone-400 hover:text-stone-950 dark:hover:text-white transition-colors inline-flex items-center gap-1 font-bold"
          >
            <span>Read full near.com technical integration guide</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href="https://app.uprail.world/app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#E05326] hover:underline inline-flex items-center gap-1 font-bold"
          >
            <span>Configure near.com withdrawal destination &rarr;</span>
          </a>
        </div>
      </div>
    </section>
  );
};
