'use client';

import React, { useState } from 'react';
import { Link } from '../lib/router';
import { ArrowRight, ExternalLink, Moon, Sun, Bot, Coins, CheckCircle2, Shield, Sparkles, Fingerprint } from 'lucide-react';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { TextReveal } from '../components/TextReveal';
import { MoneyFlowSchematic } from '../components/MoneyFlowSchematic';
import { InteractiveRailSimulator } from '../components/InteractiveRailSimulator';
import { GlitchLogo } from '../components/GlitchLogo';
import { useTheme } from '../components/ThemeProvider';

const AI_CHAT_DEMOS = [
  {
    id: 'claude',
    name: 'Claude',
    prompt: 'Send 50 USDC to @vitalik',
    action: 'uprail_send_to_x',
    amount: '50 USDC',
    recipient: '@vitalik',
    cap: '$50 / $250 daily cap',
  },
  {
    id: 'openai',
    name: 'OpenAI Dot',
    prompt: 'Pay @mert 120 USDC for design',
    action: 'POST /agent/send',
    amount: '120 USDC',
    recipient: '@mert',
    cap: '$120 / $250 daily cap',
  },
  {
    id: 'grok',
    name: 'Grok Bot',
    prompt: 'Tip @elonmusk 25 NEAR',
    action: 'uprail_send_to_x',
    amount: '25 NEAR',
    recipient: '@elonmusk',
    cap: '$112 / $250 daily cap',
  },
  {
    id: 'muse',
    name: 'Meta Muse',
    prompt: 'Generate a 100 USDC deposit link',
    action: 'uprail_receive',
    amount: '100 USDC',
    recipient: 'Deposit Intent',
    cap: '14 chains supported',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    prompt: 'Send 15 USDC bounty to @balajis',
    action: 'mcp:uprail',
    amount: '15 USDC',
    recipient: '@balajis',
    cap: '$15 / $250 daily cap',
  },
];

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
  const [activeAiIdx, setActiveAiIdx] = useState(0);
  const [activeLaunchpad, setActiveLaunchpad] = useState<'Nearly' | 'JustHoot'>('Nearly');
  const { resolved, setMode } = useTheme();
  const isDark = resolved === 'dark';
  const appSubdomainUrl = getAppSubdomainUrl();
  const activeAi = AI_CHAT_DEMOS[activeAiIdx];

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
          5. AI Chat Payments & Creator Fees — Visual Interactive Bento
        */}
        <section id="coming-soon" className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-24 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-stone-200 pb-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block mb-1">
                // AI Chat &amp; Creator Fees
              </span>
              <h2 className="text-2xl sm:text-4xl font-display font-extrabold tracking-tight text-stone-950">
                Pay from AI. Earn on 𝕏.
              </h2>
            </div>
            <a
              href="https://docs.uprail.world"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-stone-600 hover:text-black transition-colors"
            >
              <span>1-Min Setup Docs</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* LEFT PANEL: Interactive AI Chat Terminal */}
            <div className="rounded-3xl bg-stone-950 text-white p-6 sm:p-7 flex flex-col justify-between space-y-6 border border-stone-800 shadow-lg relative overflow-hidden">
              {/* Top Header + Interactive AI Selector Pills */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#E05326] animate-pulse" />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400 font-bold">
                      AI Chat Payments · 1-Click MCP
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-stone-900 text-stone-300 border border-stone-800">
                    USD Spend Caps
                  </span>
                </div>

                {/* Clickable AI Platform Switcher */}
                <div className="flex flex-wrap gap-1.5">
                  {AI_CHAT_DEMOS.map((client, idx) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => setActiveAiIdx(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                        activeAiIdx === idx
                          ? 'bg-[#E05326] text-white shadow-sm'
                          : 'bg-stone-900 text-stone-400 hover:text-white border border-stone-800'
                      }`}
                    >
                      {client.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Simulated Chat Exchange (Visual, Minimal Text) */}
              <div className="rounded-2xl bg-stone-900/90 border border-stone-800 p-4 space-y-3.5">
                {/* User Prompt Bubble */}
                <div className="flex justify-end">
                  <div className="px-3.5 py-2 rounded-2xl rounded-tr-xs bg-white text-stone-950 text-xs sm:text-sm font-medium shadow-xs">
                    “{activeAi.prompt}”
                  </div>
                </div>

                {/* AI Response Receipt */}
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-[#E05326]/15 border border-[#E05326]/40 text-[#E05326] flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="flex-1 rounded-2xl rounded-tl-xs bg-stone-950 border border-stone-800 p-3 space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-mono text-stone-400">
                      <span className="text-[#E05326] font-bold">{activeAi.action}</span>
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Settled
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="font-display font-extrabold text-base sm:text-lg text-white">
                        {activeAi.amount}
                      </span>
                      <span className="font-mono text-xs text-stone-300">
                        → {activeAi.recipient}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-1.5 border-t border-stone-800/80 text-[10px] font-mono text-stone-500">
                      <span className="flex items-center gap-1">
                        <Shield className="w-3 h-3 text-stone-400" /> NEAR Intents Shielded
                      </span>
                      <span>{activeAi.cap}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom CTA */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-mono text-stone-400">
                  Paste 1 URL. Zero key custody.
                </span>
                <a
                  href={`${appSubdomainUrl}/agents`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-white text-stone-950 hover:bg-stone-200 font-display font-extrabold text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all"
                >
                  <span>Connect AI</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* RIGHT PANEL: Visual Creator Fees Pipeline */}
            <div className="rounded-3xl bg-stone-50 text-stone-950 p-6 sm:p-7 flex flex-col justify-between space-y-6 border border-stone-200 relative overflow-hidden">
              {/* Top Header + Launchpad Switcher */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500 font-bold">
                      Launchpad Creator Fees · Auto RPC
                    </span>
                  </div>
                  <div className="flex gap-1 bg-stone-200/70 p-0.5 rounded-xl">
                    {(['Nearly', 'JustHoot'] as const).map((lp) => (
                      <button
                        key={lp}
                        type="button"
                        onClick={() => setActiveLaunchpad(lp)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                          activeLaunchpad === lp
                            ? 'bg-stone-950 text-white shadow-2xs'
                            : 'text-stone-600 hover:text-stone-950'
                        }`}
                      >
                        {lp}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Visual Step 1: Tag Badge */}
                <div className="rounded-2xl bg-white border border-stone-200 p-3.5 flex items-center justify-between shadow-2xs">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 font-bold">
                    Token Description
                  </span>
                  <code className="text-xs font-mono font-bold text-stone-900 bg-stone-100 px-2.5 py-1 rounded-lg border border-stone-200">
                    Fees to <span className="text-[#E05326]">@yourhandle</span> via UPRAIL
                  </code>
                </div>
              </div>

              {/* Visual Step 2: 3-Node Pipeline Graphic */}
              <div className="rounded-2xl bg-white border border-stone-200 p-4 space-y-4 shadow-2xs">
                <div className="grid grid-cols-3 items-center gap-2 text-center">
                  {/* Node 1: Launchpad */}
                  <div className="rounded-xl bg-stone-50 border border-stone-200 p-3 space-y-1">
                    <Coins className="w-4 h-4 mx-auto text-stone-700" />
                    <div className="font-display font-extrabold text-xs text-stone-950">
                      {activeLaunchpad}
                    </div>
                    <div className="text-[9px] font-mono text-stone-400">100% Fees</div>
                  </div>

                  {/* Node 2: UPRAIL Escrow */}
                  <div className="relative rounded-xl bg-stone-950 text-white p-3 space-y-1 shadow-xs">
                    <Sparkles className="w-4 h-4 mx-auto text-[#E05326]" />
                    <div className="font-mono font-bold text-[10px] truncate">
                      escrow.uprail
                    </div>
                    <div className="text-[9px] font-mono text-emerald-400">NEAR RPC Sync</div>
                  </div>

                  {/* Node 3: X Handle */}
                  <div className="rounded-xl bg-stone-50 border border-stone-200 p-3 space-y-1">
                    <Fingerprint className="w-4 h-4 mx-auto text-[#E05326]" />
                    <div className="font-display font-extrabold text-xs text-stone-950">
                      @yourhandle
                    </div>
                    <div className="text-[9px] font-mono text-stone-500">Passkey Claim</div>
                  </div>
                </div>

                {/* Live Payout Bar */}
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-50/80 border border-emerald-200/80">
                  <span className="text-[11px] font-mono font-bold text-emerald-900">
                    Auto-detected on NEAR
                  </span>
                  <span className="font-display font-extrabold text-xs text-emerald-700">
                    +42.8 NEAR Claimable
                  </span>
                </div>
              </div>

              {/* Bottom CTA */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-mono text-stone-500">
                  Zero webhooks. Zero API keys.
                </span>
                <a
                  href={`${appSubdomainUrl}/fees`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-stone-950 text-white hover:bg-stone-800 font-display font-extrabold text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all"
                >
                  <span>Claim Fees</span>
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
