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

  const padTo = (s: string, len: number) =>
    s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);

  // Compute Animated Desktop ASCII (Width: 126 columns)
  const computeDesktopAscii = () => {
    const TARGET = 126;
    const cableLen = 22;
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

      const d2 = (i - p + 11 + cableLen) % cableLen;
      if (d2 === 0) botCable += '█';
      else if (d2 === 1 || d2 === cableLen - 1) botCable += '▓';
      else if (d2 === 2 || d2 === cableLen - 2) botCable += '▒';
      else if (d2 === 3 || d2 === cableLen - 3) botCable += '░';
      else botCable += '═';
    }

    const tokens = ['USDC', 'BTC ', 'SOL ', 'NEAR', 'ETH ', 'TRON'];
    const curToken = tokens[Math.floor(tick / 4) % tokens.length];
    const arrow = tick % 2 === 0 ? '>>>' : '~~~';
    const spark = ['⚡', '✦', '●', '◆'][tick % 4];

    const busPhase = tick % 4;
    let bus = '';
    for (let i = 0; i < 41; i++) {
      bus += (i + busPhase) % 4 === 0 ? '►' : '═';
    }

    const led1 = tick % 2 === 0 ? '●' : '○';
    const led2 = tick % 3 === 0 ? '●' : '○';

    return [
      padTo('   PUBLIC VALUE RAIL (35+ CHAINS)               UPRAIL UNIVERSAL ADAPTER CHORD            near.com SOVEREIGN HARDWARE BOX', TARGET),
      padTo('                                                                                       /────────────────────────────────────────────────────────────/│', TARGET),
      padTo('                                                                                      /              near.com SOVEREIGN VAULT CHASSIS              / │', TARGET),
      padTo('                                                                                     ┌────────────────────────────────────────────────────────────┐  │', TARGET),
      padTo('                                                                                     │ [✛]                                                    [✛] │  │', TARGET),
      padTo('                                                                                     │ ┌────────────────────────────────────────────────────────┐ │  │', TARGET),
      padTo('                                                                                     │ │   █▄ █ █▀▀ ▄▀█ █▀█ ▄▀▀ █▀█ █▄ ▄█                       │ │  │', TARGET),
      padTo('                                                                                     │ │   █ ▀█ ██▄ █▀█ █▀▄ █▄▄ █▄█ █ ▀ █   ACCOUNT VAULT       │ │  │', TARGET),
      padTo('                                                                                     │ └────────────────────────────────────────────────────────┘ │  │', TARGET),
      padTo('                                                                                     │                                                            │  │', TARGET),
      padTo('                                                  ┌──[LATCH: ARMED]──┐               │   RECEPTACLE PORT: [ nearcom:0x... ]                       │  │', TARGET),
      padTo(' ══' + topCable + '═════════════[STRAIN RELIEF]══╡  UPRAIL ADAPTER  ├───────────────┤ ┌────────────────────────────────────────────────────────┐ │  │', TARGET),
      padTo('  ' + arrow + ' [ ' + curToken + ' SHIELDED INTENT ] ' + arrow + '>>╡  NEP-518 CHORD   ╞═[PIN ' + spark + ' COUPLING]►►│ │ ╔═════════════════════════════════════════╗ │ │ │  │', TARGET),
      padTo(' ══' + botCable + '═════════════[100% SPONSORED]══╡  FAIL-CLOSED     ├───────────────┤ │ ║ [ ' + bus + ' ] ║ │ │ │  │', TARGET),
      padTo('                                                  └──[GROUND: 0.0Ω]──┘               │ │ ╚═════════════════════════════════════════╝ │ │ │  │', TARGET),
      padTo('                                                                                     │ └────────────────────────────────────────────────────────┘ │  │', TARGET),
      padTo('                                                                                     │                                                            │  │', TARGET),
      padTo('                                                                                     │  [' + led1 + '] NEP-518 SHIELD: ENGAGED      [' + led2 + '] BRIDGE TARIFF: $0.00    │  │', TARGET),
      padTo('                                                                                     │  [●] 1-CLICK SOLVER: ATOMIC      [●] ESCROW: FAIL-CLOSED      │  │', TARGET),
      padTo('                                                                                     │                                                            │  │', TARGET),
      padTo('                                                                                     │  COOLING VENTS: |||||||||||||||||||||||||||||||||||||||||  │  │', TARGET),
      padTo('                                                                                     │ [✛]                                                    [✛] │ / ', TARGET),
      padTo('                                                                                     └────────────────────────────────────────────────────────────┘/  ', TARGET),
    ];
  };

  // Compute Animated Mobile ASCII (Width: 43 columns)
  const computeMobileAscii = () => {
    const TARGET = 43;
    const tokens = ['USDC', 'BTC ', 'SOL ', 'NEAR', 'ETH '];
    const curToken = tokens[Math.floor(tick / 4) % tokens.length];
    const wave = tick % 2 === 0 ? '>>>' : '~~~';
    const led1 = tick % 2 === 0 ? '●' : '○';
    const led2 = tick % 3 === 0 ? '●' : '○';

    const p = tick % 14;
    let bus = '';
    for (let i = 0; i < 21; i++) {
      bus += (i + p) % 3 === 0 ? '►' : '═';
    }

    return [
      padTo('  [ PUBLIC VALUE RAILS: 35+ BLOCKCHAINS ]  ', TARGET),
      padTo('             │  │  │  │  │  │              ', TARGET),
      padTo('             ▼  ▼  ▼  ▼  ▼  ▼              ', TARGET),
      padTo('  ╭─────────────────────────────────────╮  ', TARGET),
      padTo('  │ ░▒▓ BRAIDED CONDUIT // @handle ▓▒░  │  ', TARGET),
      padTo('  │  ' + wave + ' [ ' + curToken + ' SHIELDED INTENT ] ' + wave + '  │  ', TARGET),
      padTo('  ╰──────────────────┬──────────────────╯  ', TARGET),
      padTo('                     │                     ', TARGET),
      padTo('             ┌───────┴───────┐             ', TARGET),
      padTo('             │  UPRAIL PLUG  │             ', TARGET),
      padTo('             │ [▓▓▓▓▓▓▓▓▓▓▓] │             ', TARGET),
      padTo('             │ NEP-518 ARMED │             ', TARGET),
      padTo('             └───────┬───────┘             ', TARGET),
      padTo('                     │ [COUPLING LOCKED]   ', TARGET),
      padTo('                     ▼                     ', TARGET),
      padTo('  ┌─────────────────────────────────────┐  ', TARGET),
      padTo('  │ [✛]                             [✛] │  ', TARGET),
      padTo('  │    █▄ █ █▀▀ ▄▀█ █▀█ ▄▀▀ █▀█ █▄ ▄█   │  ', TARGET),
      padTo('  │    █ ▀█ ██▄ █▀█ █▀▄ █▄▄ █▄█ █ ▀ █   │  ', TARGET),
      padTo('  │        near.com SOVEREIGN VAULT     │  ', TARGET),
      padTo('  │ ┌─────────────────────────────────┐ │  ', TARGET),
      padTo('  │ │ RECEPTACLE: nearcom:0x...       │ │  ', TARGET),
      padTo('  │ │ ╔═════════════════════════════╗ │ │  ', TARGET),
      padTo('  │ │ ║ [ ' + bus + ' ] ║ │ │  ', TARGET),
      padTo('  │ │ ╚═════════════════════════════╝ │ │  ', TARGET),
      padTo('  │ └─────────────────────────────────┘ │  ', TARGET),
      padTo('  │  [' + led1 + '] SHIELD: 100%   [' + led2 + '] BRIDGE: $0.00 │  ', TARGET),
      padTo('  │  COOLING VENTS: ||||||||||||||||| │  ', TARGET),
      padTo('  │ [✛]                             [✛] │  ', TARGET),
      padTo('  └─────────────────────────────────────┘  ', TARGET),
    ];
  };

  const desktopLines = computeDesktopAscii();
  const mobileLines = computeMobileAscii();
  const cycleStr = String(tick).padStart(5, '0');
  const spark = ['⚡', '✦', '●', '◆'][tick % 4];

  return (
    <section
      id="nearcom"
      className="w-full relative py-12 sm:py-16 md:py-20 border-y-2 border-black/90 bg-[#00EC97] text-stone-950 overflow-hidden"
      style={{
        backgroundImage:
          'radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.05) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }}
    >
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 relative z-10">
        <div className="flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-12">
          {/* 
            LEFT: The Master Hardware Schematic Card (Black Obsidian Card on NEAR Green)
          */}
          <div className="w-full lg:w-7/12 flex-1 min-w-0">
            <div className="rounded-3xl border-2 border-black bg-[#0A0807] p-4 sm:p-6 space-y-3.5 shadow-2xl overflow-hidden relative">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-800/80 pb-3 text-xs font-mono">
                <div className="flex items-center space-x-2">
                  <span className="h-2 w-2 rounded-full bg-[#00EC97] animate-pulse" />
                  <span className="text-[#00EC97] font-bold tracking-wider uppercase text-[11px]">
                    Hardware Schematic // Universal Ingress Bus
                  </span>
                </div>
                <div className="flex items-center space-x-3 text-[10px] text-stone-400">
                  <span className="text-[#00EC97] font-bold">COUPLING: {spark} ENGAGED</span>
                  <span>|</span>
                  <span>CYCLE: #{cycleStr}</span>
                </div>
              </div>

              {/* Desktop & Tablet ASCII (126 columns, hidden on mobile) */}
              <div className="hidden md:block overflow-x-auto py-2 select-all scrollbar-thin scrollbar-thumb-stone-800">
                <pre className="font-mono text-[9.5px] lg:text-[10px] xl:text-[11px] leading-tight text-[#00EC97] font-medium whitespace-pre">
                  {desktopLines.join('\n')}
                </pre>
              </div>

              {/* Mobile ASCII (43 columns, perfectly formatted for mobile devices) */}
              <div className="block md:hidden overflow-x-auto py-2 select-all scrollbar-thin scrollbar-thumb-stone-800">
                <pre className="font-mono text-[9px] sm:text-[10.5px] leading-tight text-[#00EC97] font-medium whitespace-pre mx-auto">
                  {mobileLines.join('\n')}
                </pre>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-800/80 text-[11px] font-mono text-stone-300">
                <div className="flex items-center space-x-3">
                  <span className="text-[#00EC97] font-bold">● PROTOCOL PINOUT ACTIVE</span>
                  <span className="hidden sm:inline text-stone-600">|</span>
                  <span className="text-stone-300">
                    Target:{' '}
                    <code className="text-[#00EC97] bg-stone-900 px-1.5 py-0.5 rounded font-bold">
                      nearcom:0x...
                    </code>
                  </span>
                </div>
                <span className="text-stone-400 text-[10px] sm:text-[11px]">
                  Zero Bridge Fee · 100% Sponsored Gas
                </span>
              </div>
            </div>
          </div>

          {/* 
            RIGHT: The Technical Writeup
          */}
          <div className="w-full lg:w-5/12 space-y-4 text-left">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-display font-black tracking-tight text-black leading-[1.05]">
              The public adapter to privacy
            </h2>
            <p className="text-sm sm:text-base lg:text-lg text-black/90 font-sans leading-relaxed font-medium">
              An open socket for the world to send crypto confidentially to your 𝕏 handle—routed directly into your personal near.com wallet with zero bridge fees and zero risk of loss.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
