'use client';

import React, { useState, useEffect } from 'react';

export const NearcomSection: React.FC = () => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => (prev + 1) % 480);
    }, 120);
    return () => clearInterval(timer);
  }, []);

  // Compute animated ASCII frame
  const padTo = (s: string, len: number) =>
    s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);

  const cableLen = 28;
  const p = tick % cableLen;
  let topCable = '';
  let botCable = '';
  for (let i = 0; i < cableLen; i++) {
    const d = (i - p + cableLen) % cableLen;
    if (d === 0) topCable += '█';
    else if (d === 1 || d === cableLen - 1) topCable += '▓';
    else if (d === 2 || d === cableLen - 2) topCable += '▒';
    else if (d === 3 || d === cableLen - 3) topCable += '░';
    else topCable += '═';

    const d2 = (i - p + 14 + cableLen) % cableLen;
    if (d2 === 0) botCable += '█';
    else if (d2 === 1 || d2 === cableLen - 1) botCable += '▓';
    else if (d2 === 2 || d2 === cableLen - 2) botCable += '▒';
    else if (d2 === 3 || d2 === cableLen - 3) botCable += '░';
    else botCable += '═';
  }

  // Token carousel in cable core
  const tokens = ['USDC', 'BTC ', 'SOL ', 'NEAR', 'ETH ', 'TRON'];
  const tokenIdx = Math.floor(tick / 4) % tokens.length;
  const curToken = tokens[tokenIdx];
  const arrow = tick % 2 === 0 ? '>>>' : '~~~';

  // Receptacle bus motion
  const busPhase = tick % 4;
  let bus = '';
  for (let i = 0; i < 51; i++) {
    bus += (i + busPhase) % 4 === 0 ? '►' : '═';
  }

  // Blinking LEDs & contacts
  const led1 = tick % 2 === 0 ? '●' : '○';
  const led2 = tick % 3 === 0 ? '●' : '○';
  const spark = ['⚡', '✦', '●', '◆'][tick % 4];

  const l11Prefix = ' ══' + topCable + '════════════════════';
  const l12Prefix = ' ' + arrow + ' [ ' + curToken + ' CONFIDENTIAL INTENT ] >>>>>>>>>>>>>>>>>';
  const l13Prefix = ' ══' + botCable + '════════════════════';

  const TARGET = 144;

  const asciiLines = [
    padTo('   PUBLIC CONDUIT (35+ CHAINS)                      UPRAIL ADAPTER PLUG                             near.com SOVEREIGN BOX', TARGET),
    padTo('                                                                                /─────────────────────────────────────────────────────────────/│', TARGET),
    padTo('                                                                               /             near.com SOVEREIGN HARDWARE ENCLOSURE           / │', TARGET),
    padTo('                                                                              ┌─────────────────────────────────────────────────────────────┐  │', TARGET),
    padTo('                                                                              │ [+]                                                     [+] │  │', TARGET),
    padTo('                                                                              │ ┌─────────────────────────────────────────────────────────┐ │  │', TARGET),
    padTo('                                                                              │ │   █▄ █ █▀▀ ▄▀█ █▀█   ▄▀▀ █▀█ █▀▄▀█                      │ │  │', TARGET),
    padTo('                                                                              │ │   █ ▀█ ██▄ █▀█ █▀▄ ▄ █▄▄ █▄█ █ ▀ █   ACCOUNT VAULT      │ │  │', TARGET),
    padTo('                                                                              │ └─────────────────────────────────────────────────────────┘ │  │', TARGET),
    padTo('                                                                              │                                                             │  │', TARGET),
    padTo('                                                   ╭────────────────────────╮ │ RECEPTACLE PORT: [ nearcom:0x... ]                          │  │', TARGET),
    l11Prefix + '╡  UPRAIL ADAPTER PLUG   ├─┤ ╔═════════════════════════════════════════════════════════╗ │  │',
    l12Prefix + '╡  UNIVERSAL PRIVACY     ╞═╡►║ [ ' + bus + ' ] ║ │  │',
    l13Prefix + '╡  CHORD // NEP-518      ├─┤ ╚═════════════════════════════════════════════════════════╝ │  │',
    padTo('                                                   ╰────────────────────────╯ │                                                             │  │', TARGET),
    padTo('                                                                              │ [' + led1 + '] NEP-518 SHIELD: LOCKED     [' + led2 + '] BRIDGE TARIFF: $0.00     │  │', TARGET),
    padTo('                                                                              │ [●] SOLVER INTENTS: ATOMIC     [●] ESCROW: FAIL-CLOSED      │  │', TARGET),
    padTo('                                                                              │                                                             │  │', TARGET),
    padTo('                                                                              │ HEAT SINK VENTS: |||||||||||||||||||||||||||||||||||||||||  │  │', TARGET),
    padTo('                                                                              │ [+]                                                     [+] │ / ', TARGET),
    padTo('                                                                              └─────────────────────────────────────────────────────────────┘/  ', TARGET),
  ];

  const cycleStr = String(tick).padStart(5, '0');

  return (
    <section id="nearcom" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24 space-y-4">
      {/* 
        Animated ASCII Hardware Schematic: Physical Chord Plugging into near.com Socket Box
      */}
      <div className="rounded-3xl border border-stone-800 bg-[#0A0807] p-5 sm:p-7 space-y-4 shadow-2xl overflow-hidden relative">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-800/80 pb-3 text-xs font-mono">
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-stone-300 font-bold tracking-wider uppercase text-[11px]">
              Hardware Schematic // Universal Ingress Bus
            </span>
          </div>
          <div className="flex items-center space-x-3 text-[10px] text-stone-400">
            <span className="text-emerald-400 font-bold">COUPLING: {spark} ENGAGED</span>
            <span>|</span>
            <span>CYCLE: #{cycleStr}</span>
          </div>
        </div>

        {/* The Animated Monospace ASCII Illustration */}
        <pre className="font-mono text-[9px] sm:text-[10.5px] md:text-[11.5px] leading-tight text-stone-300 overflow-x-auto py-2 select-all scrollbar-thin scrollbar-thumb-stone-800 whitespace-pre">
          {asciiLines.join('\n')}
        </pre>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-800/80 text-[11px] font-mono text-stone-400">
          <div className="flex items-center space-x-3">
            <span className="text-emerald-400 font-bold">● PROTOCOL PINOUT ACTIVE</span>
            <span className="hidden sm:inline text-stone-400">|</span>
            <span className="text-stone-300">
              Target: <code className="text-[#E05326] font-bold">nearcom:0x...</code>
            </span>
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
