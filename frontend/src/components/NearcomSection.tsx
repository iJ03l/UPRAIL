'use client';

import React from 'react';

export const NearcomSection: React.FC = () => {
  return (
    <section id="nearcom" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24 space-y-4">
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
      <div className="space-y-1.5 text-left max-w-2xl">
        <h3 className="text-xl sm:text-2xl font-display font-extrabold text-stone-950 dark:text-white">
          The public adapter to privacy
        </h3>
        <p className="text-sm text-stone-600 dark:text-stone-400 font-sans leading-relaxed">
          An open socket for the world to send crypto confidentially to your 𝕏 handle—routed directly into your personal near.com wallet with zero bridge fees and zero risk of loss.
        </p>
      </div>
    </section>
  );
};
