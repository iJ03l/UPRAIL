'use client';

import React, { useState } from 'react';
import { ArrowDownLeft, ArrowRight, ExternalLink, Moon, Sun } from 'lucide-react';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { TextReveal } from '../components/TextReveal';
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

          {/* Nav Actions: X (@uprailworld) + Launch App */}
          <nav aria-label="Primary navigation" className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <a
              href="https://x.com/uprailworld"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Follow @uprailworld on X"
              title="Follow @uprailworld on X"
              className="inline-flex items-center justify-center gap-1.5 h-9 w-9 sm:w-auto sm:h-10 sm:px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-900 text-xs font-mono font-bold transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5 fill-current flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span className="hidden sm:inline">@uprailworld</span>
            </a>

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
          </nav>
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
              h
              <span className="relative inline-flex items-center justify-center align-baseline mx-[0.01em] top-[0.11em] w-[0.72em] h-[0.72em] text-emerald-600 dark:text-emerald-400">
                <svg viewBox="0 0 28 28" fill="none" className="w-full h-full">
                  <g className="hero-at-orbit">
                    <path
                      d="M17.2 10.6v4.1c0 1.8 1.1 2.9 2.7 2.9 2.2 0 3.7-2 3.7-5.1 0-5-3.8-8.7-9.4-8.7-5.7 0-9.8 4.1-9.8 9.8 0 5.8 4.2 9.8 10.1 9.8 2.4 0 4.5-.6 6.2-1.7"
                      stroke="currentColor"
                      strokeWidth="3.1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                  <circle
                    cx="13.7"
                    cy="13.7"
                    r="3.8"
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                </svg>
              </span>
              ndle
              <br />
              <span className="relative inline-block leading-none">
                &#x0131;
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="pointer-events-none absolute left-1/2 -top-[0.02em] -translate-x-1/2 w-[0.28em] h-[0.28em] text-[#E05326]"
                >
                  <g className="hero-spark-glyph">
                    <path
                      d="M12 1.5L14.8 9.2L22.5 12L14.8 14.8L12 22.5L9.2 14.8L1.5 12L9.2 9.2L12 1.5Z"
                      fill="currentColor"
                    />
                  </g>
                </svg>
              </span>
              s now your pr
              <span className="relative inline-block leading-none">
                i
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="pointer-events-none absolute left-1/2 top-[56%] -translate-x-1/2 -translate-y-1/2 w-[0.62em] h-[0.62em] text-emerald-500"
                >
                  <g className="hero-privacy-slash">
                    <line
                      x1="4.5"
                      y1="19.5"
                      x2="19.5"
                      y2="4.5"
                      stroke="var(--bg)"
                      strokeWidth="6.4"
                      strokeLinecap="round"
                    />
                    <line
                      x1="4.5"
                      y1="19.5"
                      x2="19.5"
                      y2="4.5"
                      stroke="currentColor"
                      strokeWidth="3.4"
                      strokeLinecap="round"
                    />
                  </g>
                </svg>
              </span>
              vate m
              <span className="relative inline-flex items-center justify-center align-baseline mx-[0.02em] top-[0.06em] w-[0.6em] h-[0.6em]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="w-full h-full hero-coin-glyph"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9.2"
                    fill="#E05326"
                    fillOpacity="0.1"
                    stroke="currentColor"
                    strokeWidth="3.6"
                  />
                  <rect
                    x="10.2"
                    y="6.8"
                    width="3.6"
                    height="10.4"
                    rx="1.8"
                    fill="#E05326"
                  />
                </svg>
              </span>
              ney hub<span className="text-black">.</span>
            </span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-stone-600 max-w-2xl font-sans leading-relaxed">
            Pay anyone, earn together in Circles, gift timelocked vaults, and route $ directly to near.com or AI agents without a wallet acts for you.
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

            <div
              aria-label="Powered by NEAR"
              className="inline-flex items-center gap-2 text-xs font-mono text-stone-500 pl-0.5 select-none"
            >
              <span>Powered by</span>
              <span className="inline-flex items-center gap-1.5 text-stone-950 dark:text-white">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  color="#000"
                  viewBox="0 0 512 512"
                  aria-hidden="true"
                  className="w-4 h-4 shrink-0"
                >
                  <rect width="512" height="512" fill="#00EC97" rx="110" />
                  <path
                    fill="currentColor"
                    d="M373.89 106.199a31.95 31.95 0 0 0-27.213 15.207l-62.631 92.979a6.67 6.67 0 0 0-.989 5.001 6.66 6.66 0 0 0 2.837 4.235 6.67 6.67 0 0 0 8.032-.494l61.643-53.47c1.02-.924 2.599-.827 3.523.193.419.473.644 1.074.644 1.697v167.402a2.49 2.49 0 0 1-2.502 2.491 2.48 2.48 0 0 1-1.912-.891L168.976 117.497a31.93 31.93 0 0 0-24.356-11.298h-6.508c-17.623 0-31.917 14.294-31.917 31.917v235.767c0 17.623 14.294 31.917 31.917 31.917a31.94 31.94 0 0 0 27.213-15.206l62.631-92.98a6.66 6.66 0 0 0-1.847-9.236 6.67 6.67 0 0 0-8.033.494l-61.643 53.471c-1.02.923-2.599.826-3.522-.194a2.49 2.49 0 0 1-.634-1.697V173.008a2.49 2.49 0 0 1 2.502-2.492c.731 0 1.439.322 1.912.891l186.313 223.096a31.95 31.95 0 0 0 24.357 11.297h6.508c17.623 0 31.927-14.272 31.938-31.895V138.116c0-17.623-14.294-31.917-31.917-31.917"
                  />
                </svg>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 981 254"
                  aria-hidden="true"
                  className="h-3 w-auto shrink-0"
                >
                  <path
                    fill="currentColor"
                    d="M136.42.98c-26.61 0-45.96 6.29-62.4 20.8L44.99 46.93c-2.42 1.94-7.26 3.39-10.64.48-3.39-2.9-3.87-6.77-.97-10.64l15.48-23.22c2.42-3.39.49-7.74-3.87-7.74H7.74C3.39 5.81 0 9.2 0 13.55v226.4c0 4.35 3.39 7.74 7.74 7.74h38.7c4.35 0 7.74-3.39 7.74-7.74V112.24c0-58.53 48.86-67.72 67.24-67.72 39.18 0 53.21 28.06 53.21 49.34v146.09c0 4.35 3.39 7.74 7.74 7.74h38.7c4.35 0 7.74-3.39 7.74-7.74V89.02c0-54.18-35.32-88.04-92.4-88.04zM386.503.012c-74.98 0-122.87 45.96-122.87 108.36v34.35c0 65.79 47.89 110.78 122.87 110.78 66.27 0 112.71-34.35 117.55-80.79.49-4.84-2.9-8.22-7.74-8.22h-37.73c-3.39 0-6.29 1.94-7.26 5.32-4.84 15.48-27.57 38.7-64.82 38.7s-72.08-27.09-71.6-65.79l.49-43.05c.48-32.41 34.35-54.66 71.11-54.66 33.38 0 65.79 18.87 69.17 49.83a7.073 7.073 0 0 1-5.71 7.49l-108.46 21.05c-4.35.97-7.74 4.84-7.74 9.67v.48c0 4.35 4.35 8.22 10.64 8.22h155.77a7.74 7.74 0 0 0 7.74-7.74v-30.47c0-57.56-49.83-103.52-121.42-103.52zM656.423.01c-60.47 0-112.71 35.31-112.71 81.75 0 3.87 3.39 6.77 7.74 6.77h39.18c3.87 0 6.77-2.9 7.26-6.77 3.87-21.28 29.51-36.76 57.08-36.76 32.89 0 55.15 20.32 55.15 55.15v42.09c0 43.05-31.93 64.82-71.6 64.82-30.96 0-48.86-11.61-48.86-30.48 0-16.45 8.71-30.48 44.5-38.7l51.76-14.03c5.32-1.45 7.26-5.81 6.29-10.64-.48-3.87-4.83-5.81-8.71-5.81h-53.69c-45.47 0-91.43 29.02-91.43 71.59v6.77c0 43.54 41.12 66.27 88.04 66.27 29.99 0 55.63-11.61 71.59-25.15l23.71-20.32c3.87-3.39 7.74-3.39 11.12 0 2.9 2.9 1.93 7.26-.49 10.64l-14.51 22.74c-2.42 3.39-.49 7.74 3.87 7.74h34.83c4.35 0 7.74-3.39 7.74-7.74V93.36c0-56.11-40.15-93.36-107.88-93.36zm316.836 5.81h-54.18c-18.86 0-37.25 11.61-50.31 22.74l-21.28 18.38c-2.42 1.94-6.78 3.39-9.68.97-3.39-2.42-4.84-7.26-1.93-11.13l15.48-23.22c2.42-3.39.49-7.74-3.87-7.74h-36.28c-4.35 0-7.74 3.39-7.74 7.74v226.4c0 4.35 3.39 7.74 7.74 7.74h39.67c4.35 0 7.74-3.39 7.74-7.74v-116.1c0-49.83 20.32-72.08 64.34-72.08h50.31c4.35 0 7.74-3.39 7.74-7.74V13.56c0-4.35-3.39-7.74-7.74-7.74z"
                  />
                </svg>
              </span>
            </div>
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
              href="https://docs.uprail.world"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black transition-colors flex items-center"
            >
              <span>Docs</span>
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
