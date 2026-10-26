'use client';

import React, { useState } from 'react';
import { ArrowRight, ExternalLink, Moon, Sun } from 'lucide-react';
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
    <div className="relative min-h-screen bg-surface text-stone-900 overflow-x-hidden selection:bg-black selection:text-white font-sans">
      {/* 
        Interactive Pixel Background & Adventurous Figurine
      */}
      <QuantusInteractiveCanvas />

      {/* Clean Header */}
      <header className="sticky top-0 z-40 w-full border-b border-stone-200/80 bg-surface-glass backdrop-blur-md">
        <div className="w-full px-4 sm:px-8 lg:px-12 h-16 sm:h-20 flex items-center justify-between">
          {/* Brand with Cinematic Glitch — icon-only on mobile, full wordmark on sm+ */}
          <GlitchLogo href="/" size="md" hideWordmarkOnMobile className="flex-shrink-0" />

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
        <section className="w-full px-4 sm:px-8 lg:px-12 xl:px-16 2xl:px-20 space-y-5 sm:space-y-8 text-left py-8 sm:py-16 md:py-20 lg:py-24 min-h-[38vh] sm:min-h-[50vh] flex flex-col justify-center">
          <h1 className="w-full text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-[5rem] 2xl:text-[5.75rem] font-display font-extrabold tracking-tight leading-[1.08] sm:leading-[1.0] text-stone-950">
            Your{' '}
            <span className="underline decoration-black decoration-2 sm:decoration-4 underline-offset-4 sm:underline-offset-6 inline-block">
              𝕏
            </span>{' '}
            handle
            <br />
            is now a payment account<span className="text-black">.</span>
          </h1>

          <p className="text-sm sm:text-lg md:text-xl text-stone-600 max-w-2xl font-sans leading-relaxed">
            From the web, any AI chat, or launchpad fees. Send to a handle, not a wallet.
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
              className="text-2xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl 2xl:text-9xl font-display font-black tracking-tight leading-[1.12] sm:leading-[0.98]"
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
          5. AI Chat & Creator Fees — Stark Architectural Split
        */}
        <section id="coming-soon" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24 space-y-5">
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
            // AI Chat &amp; Creator Fees
          </span>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {/* 01: AI Chat Payments */}
            <div className="rounded-3xl bg-stone-950 text-white p-6 sm:p-9 flex flex-col justify-between space-y-6 sm:space-y-8 border border-stone-900">
              <div className="space-y-4 sm:space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono uppercase tracking-widest text-stone-400 font-bold">
                    01 / AI Chat
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-stone-900 text-[#E05326] border border-stone-800 font-bold">
                    1-Click MCP
                  </span>
                </div>

                <div className="space-y-2">
                  <h3 className="text-2xl sm:text-4xl font-display font-extrabold tracking-tight text-white leading-[1.08]">
                    Pay from any AI.
                  </h3>
                  <p className="text-xs sm:text-sm text-stone-400 leading-relaxed">
                    Send and receive private transfers in chat. Capped in USD.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {['Claude', 'OpenAI Dot', 'Grok Bot', 'Meta Muse', 'Cursor'].map((name) => (
                    <span
                      key={name}
                      className="px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-800 text-[11px] font-mono text-stone-300"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-stone-800/80 gap-3">
                <a
                  href="https://docs.uprail.world/docs/agents"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-stone-400 hover:text-white transition-colors inline-flex items-center gap-1"
                >
                  <span>Docs</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={`${appSubdomainUrl}/agents`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 rounded-xl bg-white text-stone-950 hover:bg-stone-200 font-display font-extrabold text-xs uppercase tracking-wider inline-flex items-center gap-1.5 transition-all"
                >
                  <span>Connect AI</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* 02: Creator Fees */}
            <div className="rounded-3xl bg-stone-100/80 text-stone-950 p-6 sm:p-9 flex flex-col justify-between space-y-6 sm:space-y-8 border border-stone-200">
              <div className="space-y-4 sm:space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono uppercase tracking-widest text-stone-500 font-bold">
                    02 / Creator Fees
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white text-stone-900 border border-stone-200 font-bold">
                    Auto RPC
                  </span>
                </div>

                <div className="space-y-2">
                  <h3 className="text-2xl sm:text-4xl font-display font-extrabold tracking-tight text-stone-950 leading-[1.08]">
                    Route token fees to 𝕏.
                  </h3>
                  <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
                    Launch on any pad. Point fees to UPRAIL. Get paid by touch.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {['Nearly', 'JustHoot'].map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-1 rounded-lg bg-white border border-stone-200 text-[11px] font-mono text-stone-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-stone-200 gap-3">
                <a
                  href="https://docs.uprail.world/docs/fees"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-stone-500 hover:text-stone-950 transition-colors inline-flex items-center gap-1"
                >
                  <span>Docs</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={`${appSubdomainUrl}/claim?view=fees`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 rounded-xl bg-stone-950 text-white hover:bg-stone-800 font-display font-extrabold text-xs uppercase tracking-wider inline-flex items-center gap-1.5 transition-all"
                >
                  <span>Collect fees</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
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
      <footer className="w-full border-t border-stone-200 bg-surface py-8 relative z-20">
        <div className="w-full px-4 sm:px-8 lg:px-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-stone-400">
          <div className="flex items-center space-x-2">
            <GlitchLogo href="/" size="sm" />
            <span>//</span>
            <span>NEAR Intents</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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
              href="https://x.com/uprailworld"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-stone-700 hover:text-black transition-colors"
            >
              UP
            </a>
          </span>
          <span className="hidden sm:inline text-stone-300">—</span>
          <span>crypto payments, not promises · handles stay off-chain</span>
        </div>
      </footer>
    </div>
  );
};
