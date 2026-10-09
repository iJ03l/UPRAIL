'use client';

import React, { useState } from 'react';
import { Link, useNavigate } from '../lib/router';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { TextReveal } from '../components/TextReveal';
import { MoneyFlowSchematic } from '../components/MoneyFlowSchematic';
import { InteractiveRailSimulator } from '../components/InteractiveRailSimulator';

export const LandingPage: React.FC = () => {
  const [quickSendHandle, setQuickSendHandle] = useState('');
  const navigate = useNavigate();

  const handleQuickLaunch = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickSendHandle.replace(/^@/, '').trim();
    if (clean) {
      navigate(`/app/send?recipient=${encodeURIComponent(clean)}`);
    } else {
      navigate('/app');
    }
  };

  return (
    <div className="relative min-h-screen bg-white text-stone-900 overflow-x-hidden selection:bg-black selection:text-white font-sans">
      {/* 
        Interactive Pixel Background & Adventurous Figurine
      */}
      <QuantusInteractiveCanvas />

      {/* Clean Header */}
      <header className="sticky top-0 z-40 w-full border-b border-stone-200/80 bg-white/80 backdrop-blur-md">
        <div className="w-full px-4 sm:px-8 lg:px-12 h-16 sm:h-18 flex items-center justify-between">
          {/* Brand */}
          <Link to="/" className="flex items-center space-x-2.5 group">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-black text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform duration-200">
              <span className="font-display font-black text-white text-xs sm:text-sm tracking-tight">UP</span>
            </div>
            <span className="font-display font-extrabold text-lg sm:text-xl tracking-tight text-stone-950">
              UPRAIL
            </span>
          </Link>

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

          {/* Launch App Button */}
          <Link
            to="/app"
            className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-black text-white font-display font-bold text-xs uppercase tracking-wider hover:bg-stone-800 transition-all shadow-xs flex items-center space-x-1.5"
          >
            <span>Launch App</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* Main Flow: Mobile-optimized spacing */}
      <main className="relative z-20 w-full px-4 sm:px-8 lg:px-12 pt-10 sm:pt-20 pb-20 sm:pb-28 space-y-16 sm:space-y-28 md:space-y-36">
        {/* 
          1. Hero Section: Mobile friendly, desktop padded on both sides
        */}
        <section className="w-full space-y-5 sm:space-y-7 text-left md:px-12 lg:px-20 xl:px-32">
          <h1 className="text-4xl sm:text-6xl md:text-8xl lg:text-9xl font-display font-extrabold tracking-tight leading-[1.05] sm:leading-[0.92] text-stone-950 max-w-4xl">
            Send money
            <br />
            to anyone on{' '}
            <span className="underline decoration-black decoration-4 sm:decoration-8 underline-offset-8 inline-block">
              𝕏
            </span>
            <span className="text-black">.</span>
          </h1>

          <p className="text-base sm:text-xl text-stone-600 max-w-xl font-sans leading-relaxed">
            Confidential by design. Claimed by touch.
          </p>

          <div className="pt-1 flex items-center gap-3">
            <Link
              to="/app"
              className="px-7 py-3.5 sm:px-8 sm:py-4 rounded-2xl bg-black hover:bg-stone-800 text-white font-display font-extrabold text-xs sm:text-sm uppercase tracking-wider shadow-xs hover:shadow-md hover:scale-105 active:scale-95 transition-all flex items-center space-x-2 cursor-pointer group"
            >
              <span>Launch App</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </section>

        {/* 
          2. The Manifesto: Punchy core text, mobile readable
        */}
        <section id="manifesto" className="w-full space-y-4 sm:space-y-6 scroll-mt-24">
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
            // Manifesto
          </span>
          <div className="w-full">
            <TextReveal
              className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-black tracking-tight leading-[1.1] sm:leading-[1.02]"
              accentWords={['leak', 'near', 'intents', 'confidential', 'uprail']}
            >
              Public blockchains leak your wealth. NEAR Intents made confidential transfers possible. UPRAIL streams private value to 𝕏 handles.
            </TextReveal>
          </div>
        </section>

        {/* 
          3. Schematic: Money Flow (Mobile 2x2 grid, Desktop conduits)
        */}
        <section id="schematic" className="w-full scroll-mt-24">
          <MoneyFlowSchematic />
        </section>

        {/* 
          4. Visual Simulator: Compact for mobile
        */}
        <section id="simulator" className="w-full scroll-mt-24">
          <div className="max-w-6xl mx-auto">
            <InteractiveRailSimulator />
          </div>
        </section>

        {/* 
          5. Fast Send Portal
        */}
        <section className="w-full">
          <div className="max-w-6xl mx-auto relative rounded-3xl border border-stone-200 bg-stone-950 text-white p-6 sm:p-10 lg:p-12 overflow-hidden shadow-xl">
            <div className="relative z-10 max-w-2xl space-y-5 text-left">
              <div className="space-y-2">
                <span className="px-2.5 py-0.5 rounded-full bg-stone-800 border border-stone-700 text-stone-300 text-[10px] font-mono font-bold uppercase tracking-wider inline-block">
                  Gateway
                </span>
                <h2 className="text-2xl sm:text-4xl md:text-5xl font-display font-extrabold text-white tracking-tight">
                  Send to anyone on 𝕏.
                </h2>
                <p className="text-xs sm:text-sm text-stone-400">
                  Type an 𝕏 handle to launch directly into the confidential send pipeline.
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
            <span className="font-display font-bold text-stone-950 text-xs">UPRAIL</span>
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
            <Link to="/app" className="hover:text-black transition-colors font-bold text-stone-900">
              Enter App →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
