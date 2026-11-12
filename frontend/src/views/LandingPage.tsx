'use client';

import React, { useState } from 'react';
import { ArrowDownLeft, ArrowRight, ExternalLink, Moon, Sun } from 'lucide-react';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { TextReveal } from '../components/TextReveal';
import { MoneyFlowSchematic } from '../components/MoneyFlowSchematic';
import { InteractiveRailSimulator } from '../components/InteractiveRailSimulator';
import { GlitchLogo } from '../components/GlitchLogo';
import { useTheme } from '../components/ThemeProvider';
import { MultiChainSection } from '../components/MultiChainSection';
import { NearcomSection } from '../components/NearcomSection';
import { SituationReportBanner } from '../components/SituationReportBanner';
import { CapabilitiesCarousel } from '../components/CapabilitiesCarousel';

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
  const [gatewayMode, setGatewayMode] = useState<'send' | 'request'>('send');
  const { resolved, setMode } = useTheme();
  const isDark = resolved === 'dark';
  const appSubdomainUrl = getAppSubdomainUrl();

  const handleQuickLaunch = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickSendHandle.replace(/^@/, '').trim();
    let targetUrl = appSubdomainUrl;
    if (gatewayMode === 'send') {
      targetUrl = clean
        ? `${appSubdomainUrl}/send?recipient=${encodeURIComponent(clean)}`
        : `${appSubdomainUrl}/send`;
    } else {
      targetUrl = clean
        ? `${appSubdomainUrl}/request?handle=${encodeURIComponent(clean)}`
        : `${appSubdomainUrl}/request`;
    }
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="relative min-h-screen bg-surface text-stone-900 overflow-x-clip selection:bg-black selection:text-white font-sans">
      {/* 
        Interactive Pixel Background & Adventurous Figurine
      */}
      <QuantusInteractiveCanvas />

      {/* Outage Communications & Live Situation Report */}
      <SituationReportBanner />

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
          1. Hero Section: Full width end to end, bold mobile typography
        */}
        <section className="w-full px-4 sm:px-8 lg:px-12 xl:px-16 2xl:px-20 space-y-6 sm:space-y-8 text-left py-8 sm:py-16 md:py-20 lg:py-24 min-h-[38vh] sm:min-h-[50vh] flex flex-col justify-center">
          <h1
            aria-label="Your X handle is now your private money hub."
            className="w-full text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-[5rem] 2xl:text-[5.75rem] font-display font-extrabold tracking-tight leading-[1.16] sm:leading-[1.1] text-stone-950"
          >
            <span aria-hidden="true">
              Your{' '}
              <span className="underline decoration-black decoration-2 sm:decoration-4 underline-offset-4 sm:underline-offset-6 inline-block">
                𝕏
              </span>{' '}
              handle
              <br />
              is now your pr
              <span className="relative inline-block">
                &#x0131;
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="pointer-events-none absolute left-1/2 -top-[0.04em] -translate-x-1/2 w-[0.34em] h-[0.34em] text-[#E05326]"
                >
                  <path
                    d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11"
                    stroke="currentColor"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    className="hero-lock-shackle"
                  />
                  <rect x="4" y="10.5" width="16" height="11" rx="3" fill="currentColor" />
                  <circle cx="12" cy="16" r="1.4" fill="white" />
                </svg>
              </span>
              vate m
              <span className="relative inline-flex items-center justify-center align-baseline mx-[0.02em] top-[0.07em] w-[0.58em] h-[0.58em]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="w-full h-full hero-coin-glyph"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9.2"
                    stroke="currentColor"
                    strokeWidth="3.5"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="4.2"
                    fill="#E05326"
                    fillOpacity="0.18"
                    stroke="#E05326"
                    strokeWidth="2.2"
                  />
                </svg>
              </span>
              ney h
              <span className="relative inline-block">
                u
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="pointer-events-none absolute left-1/2 top-[0.14em] -translate-x-1/2 w-[0.36em] h-[0.36em] text-emerald-600"
                >
                  <g className="hero-leaf-glyph">
                    <path
                      d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"
                      fill="currentColor"
                      fillOpacity="0.24"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                  </g>
                </svg>
              </span>
              b<span className="text-black">.</span>
            </span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-stone-600 max-w-2xl font-sans leading-relaxed">
            Pay friends, earn together in Circles, gift timelocked vaults, and route near.com or AI agents without a wallet.
          </p>

          <div className="pt-2 sm:pt-4 flex flex-col items-start gap-3">
            <a
              href={appSubdomainUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-7 py-3.5 sm:px-8 sm:py-4 rounded-2xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-sm uppercase tracking-wider shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all flex items-center space-x-2 cursor-pointer group"
            >
              <span>Launch App</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>

            <a
              href="https://docs.near-intents.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs font-mono text-stone-500 hover:text-stone-900 transition-colors pl-0.5"
            >
              <span>Powered by</span>
              <img
                src="/brand/near-logo.svg"
                alt="NEAR Intents"
                className="w-4 h-4 rounded-full ring-1 ring-black/10 dark:ring-white/20"
              />
              <span className="font-bold text-stone-800">NEAR Intents</span>
            </a>
          </div>
        </section>

        {/* 
          2. The Manifesto: Full width end-to-end bold presentation
        */}
        <section id="manifesto" className="w-full px-3 sm:px-5 lg:px-8 space-y-4 sm:space-y-6 scroll-mt-24">
          <span className="text-xs sm:text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
            // Manifesto
          </span>
          <div className="w-full">
            <TextReveal
              className="text-3xl sm:text-5xl md:text-6xl lg:text-[4.25rem] xl:text-[5.5rem] 2xl:text-[6.5rem] font-display font-extrabold tracking-tight leading-[1.15] sm:leading-[1.08]"
              accentWords={['leak', 'rekt', 'near', 'intents', 'confidential', 'uprail']}
            >
              Public blockchains leak your wealth and rekt. NEAR Intents made confidential transfers possible. UPRAIL streams that private value to 𝕏 handles.
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
          5. The near.com Sovereign Gateway (Universal Ingress & Zero Risk)
        */}
        <NearcomSection />

        {/* 
          6. Multi-Chain Scale (35+ Blockchains, 50+ Assets)
        */}
        <MultiChainSection />

        {/* 
          7. Capabilities — Centered Scroll-Driven 4-Card Showcase
        */}
        <CapabilitiesCarousel appSubdomainUrl={appSubdomainUrl} />

        {/* 
          6. Fast Send & Request Portal
        */}
        <section className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12">
          <div className="relative rounded-3xl border border-stone-200 bg-stone-950 text-white p-6 sm:p-10 lg:p-12 overflow-hidden shadow-xl">
            <div className="relative z-10 max-w-2xl space-y-5 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-stone-800 border border-stone-700 text-stone-300 text-xs sm:text-[10px] font-mono font-bold uppercase tracking-wider inline-block">
                  Gateway
                </span>
                <div className="inline-flex p-0.5 rounded-xl bg-stone-900 border border-stone-800 gap-1">
                  <button
                    type="button"
                    onClick={() => setGatewayMode('send')}
                    className={`px-3 py-1 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      gatewayMode === 'send'
                        ? 'bg-white text-black shadow-xs'
                        : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    onClick={() => setGatewayMode('request')}
                    className={`px-3 py-1 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      gatewayMode === 'request'
                        ? 'bg-white text-black shadow-xs'
                        : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    Request
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-extrabold text-white tracking-tight">
                  {gatewayMode === 'send' ? 'Send to anyone on 𝕏.' : 'Request from anyone on 𝕏.'}
                </h2>
                <p className="text-sm sm:text-base text-stone-400">
                  {gatewayMode === 'send'
                    ? 'Type an 𝕏 handle to launch directly into the confidential send pipeline on app.uprail.world.'
                    : 'Type an 𝕏 handle to generate a passkey-protected payment request link on app.uprail.world.'}
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
                    className="w-full pl-8 pr-3 py-3 bg-stone-900 border border-stone-700 focus:border-white rounded-xl text-white font-medium text-base font-mono focus:outline-none transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-white hover:bg-stone-200 text-black font-display font-extrabold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center space-x-1.5 cursor-pointer flex-shrink-0"
                >
                  <span>{gatewayMode === 'send' ? 'Launch Send' : 'Launch Request'}</span>
                  {gatewayMode === 'send' ? (
                    <ArrowRight className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowDownLeft className="w-3.5 h-3.5 text-[#E05326]" />
                  )}
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
              href="https://docs.uprail.world/docs/near"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black transition-colors flex items-center"
            >
              <span>near.com Rail</span>
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
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
              href={`${appSubdomainUrl}/request`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black transition-colors flex items-center"
            >
              <span>Request Money</span>
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
              href="https://nearhackathon.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-stone-700 hover:text-black transition-colors"
            >
              Near Hackathon
            </a>
          </span>
          <span className="hidden sm:inline text-stone-300">—</span>
          <span>
            crypto payments privately, not promises · handles stay off-chain ·{' '}
            <a
              href="mailto:privacy@uprail.world"
              className="font-bold text-stone-700 hover:text-black transition-colors"
            >
              privacy@uprail.world
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
};
