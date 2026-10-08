import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Fingerprint,
  ExternalLink,
} from 'lucide-react';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { InteractiveRailSimulator } from '../components/InteractiveRailSimulator';
import { TextReveal } from '../components/TextReveal';
import { AuthModal } from '../components/AuthModal';

export const LandingPage: React.FC = () => {
  const [showAuthModal, setShowAuthModal] = useState(false);
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
    <div className="relative min-h-screen bg-white text-stone-900 overflow-hidden selection:bg-[#E05326] selection:text-white font-sans">
      {/* 
        Quantus Background:
        - Interactive pixel grid that lights up on cursor movement and scroll
        - Autonomous adventurous neon-green sprite wandering the canvas
      */}
      <QuantusInteractiveCanvas />

      {/* Sleek Minimalist Header */}
      <header className="sticky top-0 z-40 w-full border-b border-stone-200/80 bg-white/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 sm:h-20 flex items-center justify-between">
          {/* Brand Emblem */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-tr from-[#E05326] via-[#FF6B35] to-[#39FF14] p-[1.5px] shadow-sm group-hover:scale-105 transition-transform duration-200">
              <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center">
                <span className="font-display font-black text-black text-base sm:text-lg tracking-tight">UP</span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-display font-extrabold text-lg sm:text-xl tracking-tight text-stone-950 flex items-center">
                UPRAIL
                <span className="ml-2 px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#E05326]/10 text-[#E05326] border border-[#E05326]/20 rounded">
                  WORLD
                </span>
              </span>
            </div>
          </Link>

          {/* Minimal Section Links */}
          <nav className="hidden md:flex items-center space-x-8 text-xs font-mono uppercase tracking-widest text-stone-500">
            <a href="#simulator" className="hover:text-black transition-colors">
              // Simulator
            </a>
            <a href="#dilemma" className="hover:text-black transition-colors">
              // The Dilemma
            </a>
            <a href="#manifesto" className="hover:text-black transition-colors">
              // Manifesto
            </a>
          </nav>

          {/* Launch App CTA */}
          <Link
            to="/app"
            className="px-4 sm:px-5 py-2.5 rounded-xl bg-black text-white font-display font-bold text-xs uppercase tracking-wider hover:bg-[#E05326] transition-all shadow-sm hover:shadow-[0_4px_20px_rgba(224,83,38,0.35)] flex items-center space-x-2"
          >
            <span>Launch App</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* Main Narrative Flow */}
      <main className="relative z-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-28 pb-32 space-y-32 sm:space-y-44">
        {/* 
          1. Hero Section: Monumental, Thoughtful, Clean
          Zero unnecessary dashboards or boring metric clutter
        */}
        <section className="relative text-center max-w-3xl mx-auto space-y-8">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-stone-100 border border-stone-200 text-[11px] font-mono text-stone-600">
            <span className="w-2 h-2 rounded-full bg-[#39FF14] border border-[#062E0C] animate-pulse" />
            <span>NEAR Confidential Intents • Hardware Biometrics</span>
          </div>

          <h1 className="text-5xl sm:text-7xl md:text-8xl font-display font-extrabold tracking-tight leading-[0.98] text-stone-950">
            MONEY ON <span className="underline decoration-[#E05326] decoration-4 underline-offset-8">𝕏</span>.
            <br />
            <span className="bg-gradient-to-r from-[#E05326] via-[#FF6B35] to-[#C8461C] bg-clip-text text-transparent">
              DISCREET BY DESIGN.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-stone-600 max-w-xl mx-auto font-sans leading-relaxed">
            Send cross-chain value directly to any @handle. No public ledger tracking. No seed phrases. Claimed by touch.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link
              to="/app"
              className="w-full sm:w-auto px-9 py-4 rounded-2xl bg-[#E05326] text-white font-display font-extrabold text-sm uppercase tracking-wider shadow-[0_10px_28px_rgba(224,83,38,0.3)] hover:shadow-[0_14px_40px_rgba(224,83,38,0.5)] hover:scale-105 active:scale-95 transition-all flex items-center justify-center space-x-3 cursor-pointer group"
            >
              <span>Enter Railway</span>
              <span className="text-xs font-mono font-normal opacity-90">(app.uprail.world)</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1.5 transition-transform" />
            </Link>

            <button
              onClick={() => setShowAuthModal(true)}
              className="w-full sm:w-auto px-7 py-4 rounded-2xl bg-white border border-stone-200 text-stone-800 hover:border-[#E05326] hover:text-[#E05326] font-display font-bold text-sm tracking-wide transition-all shadow-sm flex items-center justify-center space-x-2.5"
            >
              <Fingerprint className="w-4 h-4 text-[#E05326]" />
              <span>Connect Passkey / 𝕏</span>
            </button>
          </div>
        </section>

        {/* 
          2. The Simulation: Visual, Tactile, No Raw Backend Code
        */}
        <section id="simulator" className="scroll-mt-24 space-y-4">
          <InteractiveRailSimulator />
        </section>

        {/* 
          3. The Dilemma: Thoughtful Visual Contrast (Fishbowl vs Shard)
        */}
        <section id="dilemma" className="scroll-mt-24 space-y-8">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <span className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-bold">
              // The Surveillance Dilemma
            </span>
            <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950">
              The Fishbowl vs The Shard
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* The Fishbowl */}
            <div className="p-8 sm:p-10 rounded-3xl bg-stone-50 border border-stone-200/80 space-y-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-red-600 uppercase tracking-wider">
                  Public Ledger
                </span>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-red-100 text-red-700">
                  PERMANENT RECORD
                </span>
              </div>
              <h3 className="text-2xl font-display font-bold text-stone-950">
                The Public Fishbowl
              </h3>
              <p className="text-sm text-stone-600 leading-relaxed">
                Send \$100 to an X username on Ethereum or Solana, and every bot in the world indexes their total net worth, transaction times, and historical associations forever.
              </p>
              <div className="pt-4 border-t border-stone-200 text-xs font-mono text-stone-400">
                Explorer Scraping • MEV Front-Running • Social Profiling
              </div>
            </div>

            {/* The Shard */}
            <div className="p-8 sm:p-10 rounded-3xl bg-white border-2 border-[#E05326] space-y-5 shadow-lg shadow-[#E05326]/5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#E05326] uppercase tracking-wider">
                  UPRAIL Shard
                </span>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#39FF14]/20 border border-[#39FF14] text-[#062E0C]">
                  MATHEMATICALLY SHIELDED
                </span>
              </div>
              <h3 className="text-2xl font-display font-bold text-stone-950">
                The Confidential Shard
              </h3>
              <p className="text-sm text-stone-700 leading-relaxed font-medium">
                Funds enter a private TEE enclave where sender, recipient, and amount are mathematically hidden. Recipient signs with a hardware biometric key directly on their phone.
              </p>
              <div className="pt-4 border-t border-[#E05326]/20 text-xs font-mono text-[#E05326] font-bold">
                Zero Public Mempool • Hardware P-256 Key • 30-Day Auto Refund
              </div>
            </div>
          </div>
        </section>

        {/* 
          4. The Manifesto: Scroll-Triggered Text Reveal
          Fixed so text never turns white on white!
        */}
        <section id="manifesto" className="max-w-3xl mx-auto py-8 text-center space-y-6">
          <span className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-bold block">
            // Manifesto
          </span>
          <TextReveal
            className="text-3xl sm:text-4xl md:text-5xl font-display tracking-tight leading-tight justify-center"
            accentWords={['confidential', 'passkey', 'mempools', 'shards', 'secret']}
          >
            Public blockchains leak your wealth to the universe. UPRAIL routes value through confidential TEE shards where balances remain a secret between you and your biometric passkey. Zero mempools. Zero surveillance. Absolute discretion.
          </TextReveal>
        </section>

        {/* 
          5. Elevated "Ready to Send" Portal
          Interactive fast launcher directly into app.uprail.world
        */}
        <section className="relative rounded-3xl border border-stone-200 bg-stone-950 text-white p-8 sm:p-14 overflow-hidden shadow-2xl">
          {/* Subtle radiant burnt orange background glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-[#E05326]/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 max-w-2xl mx-auto text-center space-y-8">
            <div className="space-y-3">
              <span className="px-3 py-1 rounded-full bg-[#E05326]/20 border border-[#E05326]/40 text-[#E05326] text-xs font-mono font-bold uppercase tracking-wider">
                Production Gateway
              </span>
              <h2 className="text-3xl sm:text-5xl font-display font-extrabold text-white tracking-tight">
                Send to any handle now.
              </h2>
              <p className="text-sm text-stone-400">
                Type an 𝕏 handle to launch directly into the confidential send pipeline on <span className="text-white font-mono font-bold">app.uprail.world</span>.
              </p>
            </div>

            {/* Fast Launch Input Form */}
            <form onSubmit={handleQuickLaunch} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-[#E05326] text-base">
                  @
                </span>
                <input
                  type="text"
                  value={quickSendHandle}
                  onChange={(e) => setQuickSendHandle(e.target.value)}
                  placeholder="vitalik or satoshi"
                  className="w-full pl-9 pr-4 py-3.5 bg-stone-900 border border-stone-700 focus:border-[#E05326] rounded-2xl text-white font-medium text-sm focus:outline-none transition-colors"
                />
              </div>

              <button
                type="submit"
                className="px-7 py-3.5 rounded-2xl bg-[#E05326] hover:bg-[#FF6B35] text-white font-display font-extrabold text-xs uppercase tracking-wider transition-all shadow-[0_8px_24px_rgba(224,83,38,0.4)] flex items-center justify-center space-x-2 cursor-pointer flex-shrink-0"
              >
                <span>Launch App</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </section>
      </main>

      {/* Quantus Minimal Footer */}
      <footer className="w-full border-t border-stone-200 bg-white py-12 relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6 text-xs font-mono text-stone-400">
          <div className="flex items-center space-x-3">
            <span className="font-display font-bold text-stone-950 text-sm">UPRAIL.WORLD</span>
            <span>//</span>
            <span>NEAR Confidential Intents</span>
            <span>//</span>
            <span className="text-[#E05326] font-bold">app.uprail.world</span>
          </div>

          <div className="flex items-center space-x-6">
            <a
              href="https://docs.near-intents.org"
              target="_blank"
              rel="noreferrer"
              className="hover:text-black transition-colors flex items-center"
            >
              <span>1Click API Docs</span>
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
            <a
              href="https://intents.near.org/confidential"
              target="_blank"
              rel="noreferrer"
              className="hover:text-black transition-colors"
            >
              NEAR Confidential Shard
            </a>
            <Link to="/app" className="hover:text-black transition-colors font-bold text-[#E05326]">
              Enter App →
            </Link>
          </div>
        </div>
      </footer>

      {/* Dual Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
};
