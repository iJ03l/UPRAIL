import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { QuantusInteractiveCanvas } from '../components/QuantusInteractiveCanvas';
import { TextReveal } from '../components/TextReveal';
import { SurveillanceDilemma } from '../components/SurveillanceDilemma';
import { InteractiveRailSimulator } from '../components/InteractiveRailSimulator';
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
        - Interactive pixel grid that lights up on cursor movement & scroll
        - Adventurous autonomous neon-green sprite roaming the background
      */}
      <QuantusInteractiveCanvas />

      {/* Clean Minimalist Header */}
      <header className="sticky top-0 z-40 w-full border-b border-stone-200/80 bg-white/80 backdrop-blur-md">
        <div className="w-full px-4 sm:px-8 lg:px-12 h-18 sm:h-20 flex items-center justify-between">
          {/* Brand Emblem */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-tr from-[#E05326] via-[#FF6B35] to-[#39FF14] p-[1.5px] shadow-sm group-hover:scale-105 transition-transform duration-200">
              <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center">
                <span className="font-display font-black text-black text-base sm:text-lg tracking-tight">UP</span>
              </div>
            </div>
            <span className="font-display font-extrabold text-xl tracking-tight text-stone-950">
              UPRAIL
            </span>
          </Link>

          {/* Minimal Section Links */}
          <nav className="hidden md:flex items-center space-x-8 text-xs font-mono uppercase tracking-widest text-stone-500">
            <a href="#manifesto" className="hover:text-black transition-colors">
              // Manifesto
            </a>
            <a href="#dilemma" className="hover:text-black transition-colors">
              // The Dilemma
            </a>
            <a href="#simulator" className="hover:text-black transition-colors">
              // Simulator
            </a>
          </nav>

          {/* Launch App CTA */}
          <Link
            to="/app"
            className="px-5 py-2.5 rounded-xl bg-black text-white font-display font-bold text-xs uppercase tracking-wider hover:bg-[#E05326] transition-all shadow-sm hover:shadow-[0_4px_20px_rgba(224,83,38,0.35)] flex items-center space-x-2"
          >
            <span>Launch App</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* Main Narrative Flow - Full Width Experience */}
      <main className="relative z-20 w-full px-4 sm:px-8 lg:px-12 pt-16 sm:pt-28 pb-32 space-y-32 sm:space-y-48">
        {/* 
          1. Hero Section: Full Width, Left Aligned, Not Centered
          "Send money to anyone on x"
        */}
        <section className="w-full max-w-7xl space-y-8 text-left">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-stone-100 border border-stone-200 text-[11px] font-mono text-stone-600">
            <span className="w-2 h-2 rounded-full bg-[#39FF14] border border-[#062E0C] animate-pulse" />
            <span>NEAR Confidential Intents • Hardware Biometrics</span>
          </div>

          <h1 className="text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-display font-extrabold tracking-tight leading-[0.94] text-stone-950">
            Send money
            <br />
            to anyone on{' '}
            <span className="underline decoration-[#E05326] decoration-4 sm:decoration-8 underline-offset-8 inline-block">
              𝕏
            </span>
            <span className="text-[#E05326]">.</span>
          </h1>

          <p className="text-xl sm:text-2xl text-stone-600 max-w-2xl font-sans leading-relaxed">
            Confidential by design. No public balances, no seed phrases. Claimed by touch.
          </p>

          <div className="pt-2 flex items-center gap-4">
            <Link
              to="/app"
              className="px-9 py-4 rounded-2xl bg-[#E05326] text-white font-display font-extrabold text-sm uppercase tracking-wider shadow-[0_10px_28px_rgba(224,83,38,0.3)] hover:shadow-[0_14px_40px_rgba(224,83,38,0.55)] hover:scale-105 active:scale-95 transition-all flex items-center space-x-3 cursor-pointer group"
            >
              <span>Enter Railway</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1.5 transition-transform" />
            </Link>
          </div>
        </section>

        {/* 
          2. The Manifesto: Moved a Section Up!
          Full width end to end with bigger text and smooth scroll animation
        */}
        <section id="manifesto" className="w-full space-y-8 scroll-mt-28">
          <span className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-bold block">
            // Manifesto
          </span>
          <div className="w-full">
            <TextReveal
              className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-display tracking-tight leading-[1.04]"
              accentWords={['confidential', 'passkey', 'mempools', 'shards', 'secret']}
            >
              Public blockchains leak your wealth to the universe. UPRAIL routes value through confidential TEE shards where balances remain a secret between you and your biometric passkey. Zero mempools. Zero surveillance. Absolute discretion.
            </TextReveal>
          </div>
        </section>

        {/* 
          3. Redesigned Surveillance Dilemma:
          Comparative telemetry console (Fishbowl vs Shard)
        */}
        <section id="dilemma" className="w-full scroll-mt-28">
          <SurveillanceDilemma />
        </section>

        {/* 
          4. The Simulation: Visual, Tactile, No Raw Backend Code
        */}
        <section id="simulator" className="w-full scroll-mt-28">
          <InteractiveRailSimulator />
        </section>

        {/* 
          5. Elevated "Ready to Send" Portal
          Interactive fast launcher directly into app.uprail.world
        */}
        <section className="relative w-full rounded-3xl border border-stone-200 bg-stone-950 text-white p-8 sm:p-16 lg:p-20 overflow-hidden shadow-2xl">
          {/* Subtle radiant burnt orange background glow */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#E05326]/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 max-w-4xl space-y-8 text-left">
            <div className="space-y-4">
              <span className="px-3 py-1 rounded-full bg-[#E05326]/20 border border-[#E05326]/40 text-[#E05326] text-xs font-mono font-bold uppercase tracking-wider inline-block">
                Production Gateway
              </span>
              <h2 className="text-4xl sm:text-6xl md:text-7xl font-display font-extrabold text-white tracking-tight leading-tight">
                Send to any handle now.
              </h2>
              <p className="text-base sm:text-lg text-stone-400 max-w-xl">
                Type an 𝕏 handle to launch directly into the confidential send pipeline.
              </p>
            </div>

            {/* Fast Launch Input Form */}
            <form onSubmit={handleQuickLaunch} className="flex flex-col sm:flex-row gap-3 max-w-md">
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
                className="px-8 py-3.5 rounded-2xl bg-[#E05326] hover:bg-[#FF6B35] text-white font-display font-extrabold text-xs uppercase tracking-wider transition-all shadow-[0_8px_24px_rgba(224,83,38,0.4)] flex items-center justify-center space-x-2 cursor-pointer flex-shrink-0"
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
        <div className="w-full px-4 sm:px-8 lg:px-12 flex flex-col md:flex-row items-center justify-between gap-6 text-xs font-mono text-stone-400">
          <div className="flex items-center space-x-3">
            <span className="font-display font-bold text-stone-950 text-sm">UPRAIL</span>
            <span>//</span>
            <span>NEAR Confidential Intents</span>
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
