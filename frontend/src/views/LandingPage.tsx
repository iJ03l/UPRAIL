'use client';

import React, { useState } from 'react';
import { Link } from '../lib/router';
import { ArrowRight, ExternalLink, Moon, Sun, Bot, Coins, Network } from 'lucide-react';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { TextReveal } from '../components/TextReveal';
import { MoneyFlowSchematic } from '../components/MoneyFlowSchematic';
import { InteractiveRailSimulator } from '../components/InteractiveRailSimulator';
import { GlitchLogo } from '../components/GlitchLogo';
import { useTheme } from '../components/ThemeProvider';

const getAppSubdomainUrl = () => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3000/app';
    }
  }
  return 'https://app.uprail.world';
};

export const LandingPage: React.FC = () => {
  const [quickSendHandle, setQuickSendHandle] = useState('');
  const { resolved, setMode } = useTheme();
  const isDark = resolved === 'dark';
  const appSubdomainUrl = getAppSubdomainUrl();

  const handleQuickLaunch = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickSendHandle.replace(/^@/, '').trim();
    const targetUrl = clean
      ? `${appSubdomainUrl}/send?recipient=${encodeURIComponent(clean)}`
      : appSubdomainUrl;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="relative min-h-screen bg-white text-stone-900 overflow-x-hidden selection:bg-black selection:text-white font-sans">
      {/* 
        Interactive Pixel Background & Adventurous Figurine
      */}
      <QuantusInteractiveCanvas />

      {/* Clean Header */}
      <header className="sticky top-0 z-40 w-full border-b border-stone-200/80 bg-white/80 backdrop-blur-md">
        <div className="w-full px-4 sm:px-8 lg:px-12 h-16 sm:h-20 flex items-center justify-between">
          {/* Brand with Cinematic Glitch */}
          <GlitchLogo href="/" size="md" className="flex-shrink-0" />

          {/* Launch App Button - Strictly opens app.uprail.world in new tab */}
          <a
            href={appSubdomainUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 px-4 py-2 sm:px-6 sm:py-2.5 rounded-xl bg-black text-white font-display font-bold text-xs uppercase tracking-wider hover:bg-stone-800 transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer hover:scale-105 active:scale-95"
          >
            <span>Launch App</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* Main Flow: Balanced spacing */}
      <main className="relative z-20 w-full pt-4 sm:pt-7 md:pt-9 lg:pt-10 pb-16 sm:pb-24 space-y-10 sm:space-y-16 md:space-y-20">
        {/* 
          1. Hero Section: Full width end to end, text size halved, vertical space maintained
        */}
        <section className="w-full px-4 sm:px-8 lg:px-12 xl:px-16 2xl:px-20 space-y-6 sm:space-y-8 text-left py-12 sm:py-16 md:py-20 lg:py-24 min-h-[44vh] sm:min-h-[50vh] flex flex-col justify-center">
          <h1 className="w-full text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-[5rem] 2xl:text-[5.75rem] font-display font-extrabold tracking-tight leading-[1.08] sm:leading-[1.0] text-stone-950">
            Send money
            <br />
            to anyone on{' '}
            <span className="underline decoration-black decoration-2 sm:decoration-4 underline-offset-4 sm:underline-offset-6 inline-block">
              𝕏
            </span>
            <span className="text-black">.</span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-stone-600 max-w-2xl font-sans leading-relaxed">
            Confidential by design. Claimed by touch.
          </p>

          <div className="pt-2 sm:pt-4 flex items-center gap-3">
            <a
              href={appSubdomainUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-7 py-3.5 sm:px-8 sm:py-4 rounded-2xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-xs sm:text-sm uppercase tracking-wider shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all flex items-center space-x-2 cursor-pointer group"
            >
              <span>Launch App</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        </section>

        {/* 
          2. The Manifesto: Full width end to end
        */}
        <section id="manifesto" className="w-full px-4 sm:px-8 lg:px-12 xl:px-16 2xl:px-20 space-y-4 sm:space-y-6 scroll-mt-24">
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
            // Manifesto
          </span>
          <div className="w-full">
            <TextReveal
              className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl 2xl:text-9xl font-display font-black tracking-tight leading-[1.08] sm:leading-[0.98]"
              accentWords={['leak', 'near', 'intents', 'confidential', 'uprail']}
            >
              Public blockchains leak your wealth. NEAR Intents made confidential transfers possible. UPRAIL streams private value to 𝕏 handles.
            </TextReveal>
          </div>
        </section>

        {/* 
          3. Schematic: Money Flow (Mobile 2x2 grid, Desktop conduits)
        */}
        <section id="schematic" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24">
          <MoneyFlowSchematic />
        </section>

        {/* 
          4. Visual Simulator: Fullwidth end-to-end background
        */}
        <section id="simulator" className="w-full scroll-mt-24">
          <InteractiveRailSimulator />
        </section>

        {/* 
          5. AI Chat Payments & Creator Fees
        */}
        <section id="coming-soon" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24 space-y-6">
          <div className="space-y-3">
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
              // AI Chat &amp; Creator Fees
            </span>
            <h2 className="text-2xl sm:text-4xl md:text-5xl font-display font-extrabold tracking-tight text-stone-950 max-w-3xl">
              Pay from any AI chat — and route creator fees to 𝕏.
            </h2>
            <p className="text-sm sm:text-base text-stone-600 max-w-2xl leading-relaxed">
              Connect ChatGPT, Claude, or Cursor to send and receive confidential payments within
              USD spend limits you control, or route launchpad creator fees straight to your 𝕏
              handle. Read the{' '}
              <a
                href="https://docs.uprail.world"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-stone-900 underline underline-offset-2"
              >
                docs
              </a>{' '}
              for 1-minute setup.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                icon: Bot,
                tag: 'AI Chat',
                title: 'Pay & receive in any AI chat',
                body: 'Send confidential payments to any 𝕏 handle or generate deposit addresses straight from ChatGPT, Claude, or Cursor — protected by USD spend limits.',
              },
              {
                icon: Network,
                tag: 'MCP & Actions',
                title: '1-click MCP & OpenAPI setup',
                body: 'Drop your Passkey-issued key into Claude Desktop, Cursor, or ChatGPT Actions to check balances, pay handles, and receive across chains.',
              },
              {
                icon: Coins,
                tag: 'Payouts',
                title: 'Creator fees to 𝕏',
                body: 'Launch on Nearly or JustHoot, point your creator fees at an 𝕏 handle, and UPRAIL routes them straight to it.',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-3xl border border-stone-200 bg-stone-50 p-6 space-y-3 flex flex-col"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-2xl bg-stone-950 text-white flex items-center justify-center">
                    <f.icon className="w-5 h-5" />
                  </div>
                  <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Live
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 font-bold">
                    {f.tag}
                  </div>
                  <h3 className="font-display font-extrabold text-stone-950 text-lg leading-tight">
                    {f.title}
                  </h3>
                </div>
                <p className="text-sm text-stone-600 leading-relaxed flex-1">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 
          6. Fast Send Portal
        */}
        <section className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12">
          <div className="relative rounded-3xl border border-stone-200 bg-stone-950 text-white p-6 sm:p-10 lg:p-12 overflow-hidden shadow-xl">
            <div className="relative z-10 max-w-2xl space-y-5 text-left">
              <div className="space-y-2">
                <span className="px-2.5 py-0.5 rounded-full bg-stone-800 border border-stone-700 text-stone-300 text-[10px] font-mono font-bold uppercase tracking-wider inline-block">
                  Gateway
                </span>
                <h2 className="text-2xl sm:text-4xl md:text-5xl font-display font-extrabold text-white tracking-tight">
                  Send to anyone on 𝕏.
                </h2>
                <p className="text-xs sm:text-sm text-stone-400">
                  Type an 𝕏 handle to launch directly into the confidential send pipeline on app.uprail.world.
                </p>
              </div>

              {/* Fast Form */}
              <form onSubmit={handleQuickLaunch} className="flex flex-col sm:flex-row gap-2.5 max-w-md">
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-bold text-stone-400 text-sm">
                    @
                  </span>
                  <input
                    type="text"
                    value={quickSendHandle}
                    onChange={(e) => setQuickSendHandle(e.target.value)}
                    placeholder="username"
                    className="w-full pl-8 pr-3 py-3 bg-stone-900 border border-stone-700 focus:border-white rounded-xl text-white font-medium text-base sm:text-xs font-mono focus:outline-none transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-white hover:bg-stone-200 text-black font-display font-extrabold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center space-x-1.5 cursor-pointer flex-shrink-0"
                >
                  <span>Launch</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </section>
      </main>

      {/* Clean Footer */}
      <footer className="w-full border-t border-stone-200 bg-white py-8 relative z-20">
        <div className="w-full px-4 sm:px-8 lg:px-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-stone-400">
          <div className="flex items-center space-x-2">
            <GlitchLogo href="/" size="sm" />
            <span>//</span>
            <span>NEAR Intents</span>
          </div>

          <div className="flex items-center space-x-4">
            <button
              type="button"
              onClick={() => setMode(isDark ? 'light' : 'dark')}
              aria-label="Toggle color theme"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full border border-stone-200 hover:border-stone-300 hover:bg-stone-50 text-stone-500 hover:text-black transition-colors cursor-pointer"
            >
              {isDark ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
              <span>{isDark ? 'Light' : 'Dark'}</span>
            </button>
            <a
              href="https://docs.uprail.world"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black transition-colors flex items-center"
            >
              <span>Docs</span>
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
            <a
              href="https://docs.near-intents.org"
              target="_blank"
              rel="noreferrer"
              className="hover:text-black transition-colors flex items-center"
            >
              <span>1Click Docs</span>
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
            <a
              href={appSubdomainUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black transition-colors font-bold text-stone-900"
            >
              Enter App →
            </a>
          </div>
        </div>

        {/* Built-by credit */}
        <div className="w-full px-4 sm:px-8 lg:px-12 mt-6 pt-5 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-center gap-2 text-[11px] font-mono text-stone-400 text-center">
          <span>
            Built by{' '}
            <a
              href="https://x.com/xy63ry0rx"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-stone-700 hover:text-black transition-colors"
            >
              @5194
            </a>{' '}
            · for{' '}
            <a
              href="https://x.com/Uptoberonnear"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-stone-700 hover:text-black transition-colors"
            >
              UP
            </a>
          </span>
          <span className="hidden sm:inline text-stone-300">—</span>
          <span>crypto payments, not promises · private by default</span>
        </div>
      </footer>
    </div>
  );
};
