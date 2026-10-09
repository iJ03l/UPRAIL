'use client';

import React, { useState } from 'react';
import { Link } from '../lib/router';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { TextReveal } from '../components/TextReveal';
import { MoneyFlowSchematic } from '../components/MoneyFlowSchematic';
import { InteractiveRailSimulator } from '../components/InteractiveRailSimulator';
import { GlitchLogo } from '../components/GlitchLogo';

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
          <GlitchLogo href="/" size="md" />

          {/* Section Navigation (Desktop) */}
          <nav className="hidden md:flex items-center space-x-7 text-xs font-mono uppercase tracking-widest text-stone-500">
            <a href="#manifesto" className="hover:text-black transition-colors">
              // Manifesto
            </a>
            <a href="#schematic" className="hover:text-black transition-colors">
              // How It Works
            </a>
            <a href="#simulator" className="hover:text-black transition-colors">
              // Simulator
            </a>
          </nav>

          {/* Launch App Button - Strictly opens app.uprail.world in new tab */}
          <a
            href={appSubdomainUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 sm:px-6 sm:py-2.5 rounded-xl bg-black text-white font-display font-bold text-xs uppercase tracking-wider hover:bg-stone-800 transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer hover:scale-105 active:scale-95"
          >
            <span>Launch App</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* Main Flow: Balanced spacing */}
      <main className="relative z-20 w-full pt-4 sm:pt-7 md:pt-9 lg:pt-10 pb-16 sm:pb-24 space-y-10 sm:space-y-16 md:space-y-20">
        {/* 
          1. Hero Section: Full width end to end
        */}
        <section className="w-full px-4 sm:px-8 lg:px-12 xl:px-16 2xl:px-20 space-y-4 sm:space-y-6 text-left py-2 sm:py-4 md:py-6">
          <h1 className="w-full text-5xl sm:text-7xl md:text-8xl lg:text-9xl xl:text-[10rem] 2xl:text-[11.5rem] font-display font-extrabold tracking-tight leading-[1.0] sm:leading-[0.9] text-stone-950">
            Send money
            <br />
            to anyone on{' '}
            <span className="underline decoration-black decoration-4 sm:decoration-8 underline-offset-8 inline-block">
              𝕏
            </span>
            <span className="text-black">.</span>
          </h1>

          <p className="text-lg sm:text-2xl md:text-3xl text-stone-600 max-w-3xl font-sans leading-relaxed">
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
          5. Fast Send Portal
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
                    className="w-full pl-8 pr-3 py-3 bg-stone-900 border border-stone-700 focus:border-white rounded-xl text-white font-medium text-xs font-mono focus:outline-none transition-colors"
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

          <div className="flex items-center space-x-5">
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
      </footer>
    </div>
  );
};
