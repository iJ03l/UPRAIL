import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Fingerprint,
  ExternalLink,
} from 'lucide-react';
import { NeonSpriteCanvas } from '../components/NeonSpriteCanvas';
import { InteractiveRailSimulator } from '../components/InteractiveRailSimulator';
import { TextReveal } from '../components/TextReveal';
import { AuthModal } from '../components/AuthModal';

export const LandingPage: React.FC = () => {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <div className="relative min-h-screen bg-white text-stone-900 overflow-hidden selection:bg-[#E05326] selection:text-white">
      {/* Faceless Neon-Green Humanoid Sprite (nearest-neighbor scaled, tracks cursor) */}
      <NeonSpriteCanvas />

      {/* Subtle fine architectural grid pattern on white */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #000000 1px, transparent 1px), linear-gradient(to bottom, #000000 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Clean Editorial Floating Header */}
      <header className="sticky top-0 z-40 w-full border-b border-stone-200/80 bg-white/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          {/* Brand Emblem */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#E05326] via-[#FF6B35] to-[#39FF14] p-[2px] shadow-lg shadow-[#E05326]/20 group-hover:scale-105 transition-transform duration-300">
              <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center">
                <span className="font-display font-black text-black text-lg tracking-tight">UP</span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-display font-extrabold text-xl tracking-tight text-stone-950 flex items-center">
                UPRAIL
                <span className="ml-2 px-2 py-0.5 text-[10px] font-mono font-bold bg-[#E05326]/10 text-[#E05326] border border-[#E05326]/25 rounded-md">
                  WORLD
                </span>
              </span>
              <span className="text-[11px] font-sans text-stone-500 -mt-1 hidden sm:inline">
                The Confidential Value Railway for 𝕏
              </span>
            </div>
          </Link>

          {/* Navigation Links & Action */}
          <div className="flex items-center space-x-4 sm:space-x-6">
            <a
              href="#simulator"
              className="text-xs font-mono font-medium text-stone-600 hover:text-black transition-colors hidden md:inline"
            >
              Interactive Simulator
            </a>
            <a
              href="#how-it-works"
              className="text-xs font-mono font-medium text-stone-600 hover:text-black transition-colors hidden md:inline"
            >
              How It Works
            </a>

            {/* Launch App Button -> app.uprail.world / /app */}
            <Link
              to="/app"
              className="relative group px-5 py-2.5 rounded-xl bg-black text-white font-display font-bold text-xs uppercase tracking-wider hover:bg-[#E05326] transition-all shadow-[0_4px_16px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_25px_rgba(224,83,38,0.4)] flex items-center space-x-2"
            >
              <span>Launch App</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Landing Flow */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-28 space-y-32">
        {/* Hero Section */}
        <section className="relative text-center max-w-4xl mx-auto space-y-8 pt-4 sm:pt-8">
          {/* Status Badge */}
          <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-stone-100 border border-stone-200 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-[#39FF14] border border-[#052E08] animate-pulse" />
            <span className="text-xs font-mono text-stone-700">
              Steer cursor to guide the Confidential Entity • NEAR Intents GA
            </span>
          </div>

          {/* Monumental Headline in Rare Fonts */}
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-display font-extrabold tracking-tight leading-[1.05] text-stone-950">
            MONEY ON <span className="font-sans text-black underline decoration-[#E05326] decoration-4 underline-offset-8">𝕏</span>,
            <br />
            <span className="bg-gradient-to-r from-[#E05326] via-[#FF6B35] to-[#C8461C] bg-clip-text text-transparent">
              SHIELDED BY CODE.
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-base sm:text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed font-sans">
            Pay any X handle from any blockchain. No public balance tracking. No seed phrases.
            Claimed instantly with device passkeys on <span className="text-black font-mono font-bold">app.uprail.world</span>.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link
              to="/app"
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-[#E05326] text-white font-display font-extrabold text-sm uppercase tracking-wider shadow-[0_10px_30px_rgba(224,83,38,0.35)] hover:shadow-[0_15px_45px_rgba(224,83,38,0.55)] hover:scale-105 active:scale-95 transition-all flex items-center justify-center space-x-3 cursor-pointer group"
            >
              <span>Enter Railway</span>
              <span className="text-xs font-mono font-normal opacity-90">(app.uprail.world)</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1.5 transition-transform" />
            </Link>

            <button
              onClick={() => setShowAuthModal(true)}
              className="w-full sm:w-auto px-7 py-4 rounded-2xl bg-white border-2 border-stone-200 text-stone-800 hover:border-[#E05326] hover:text-[#E05326] font-display font-bold text-sm tracking-wide transition-all shadow-sm flex items-center justify-center space-x-2.5"
            >
              <Fingerprint className="w-4 h-4 text-[#E05326]" />
              <span>Connect Passkey / 𝕏</span>
            </button>
          </div>

          {/* Trust Metrics Cards */}
          <div className="pt-12 grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 shadow-sm">
              <div className="text-[11px] font-mono text-stone-500 uppercase tracking-wider">Privacy Engine</div>
              <div className="text-lg font-display font-bold text-stone-900 mt-0.5">TEE Private Shard</div>
              <div className="text-[11px] text-[#E05326] font-mono mt-0.5">Zero public ledger leak</div>
            </div>
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 shadow-sm">
              <div className="text-[11px] font-mono text-stone-500 uppercase tracking-wider">Authentication</div>
              <div className="text-lg font-display font-bold text-stone-900 mt-0.5">P-256 Passkey</div>
              <div className="text-[11px] text-stone-700 font-mono mt-0.5">Touch ID / Face ID</div>
            </div>
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 shadow-sm">
              <div className="text-[11px] font-mono text-stone-500 uppercase tracking-wider">Inbound Chains</div>
              <div className="text-lg font-display font-bold text-stone-900 mt-0.5">Multichain Ingest</div>
              <div className="text-[11px] text-[#E05326] font-mono mt-0.5">ETH • ARB • SOL • NEAR</div>
            </div>
            <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 shadow-sm">
              <div className="text-[11px] font-mono text-stone-500 uppercase tracking-wider">Escrow Safety</div>
              <div className="text-lg font-display font-bold text-stone-900 mt-0.5">30-Day Timeout</div>
              <div className="text-[11px] text-stone-700 font-mono mt-0.5">Automatic alarm refund</div>
            </div>
          </div>
        </section>

        {/* The Interactive Element: Confidential Rail Simulator */}
        <section className="scroll-mt-24" id="simulator">
          <div className="mb-4 text-center">
            <span className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-semibold">
              Live Interactive Prototype
            </span>
            <h2 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950 mt-1">
              Simulate a Confidential Transfer
            </h2>
          </div>
          <InteractiveRailSimulator />
        </section>

        {/* Scroll-Triggered Text Reveal Section */}
        <section className="max-w-4xl mx-auto py-12 text-center space-y-6">
          <div className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-bold">
            The Confidential Rail Manifesto
          </div>
          <TextReveal
            className="text-2xl sm:text-4xl md:text-5xl font-display font-bold tracking-tight leading-tight justify-center"
            accentWords={['confidential', 'passkey', 'mempools', 'shards', 'secret']}
          >
            Public blockchains leak your wealth to the universe. UPRAIL routes value through confidential TEE shards where balances remain a secret between you and your biometric passkey. Zero mempools. Zero surveillance. Absolute discretion.
          </TextReveal>
        </section>

        {/* How It Works - 3 Step Cards */}
        <section id="how-it-works" className="space-y-12 scroll-mt-24">
          <div className="text-center space-y-3">
            <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950">
              How The Railway Operates
            </h2>
            <p className="text-sm text-stone-600 max-w-lg mx-auto">
              Three cryptographic steps turn any X username into an unbreakable confidential vault.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Step 1 */}
            <div className="p-8 rounded-3xl bg-stone-50 border border-stone-200 shadow-sm relative overflow-hidden group hover:border-[#E05326] transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#E05326]/10 text-[#E05326] flex items-center justify-center font-mono font-bold text-lg mb-6 border border-[#E05326]/20">
                01
              </div>
              <h3 className="text-xl font-display font-bold text-stone-900 mb-3">
                Deposit to Escrow
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Sender addresses the payment to <span className="text-stone-950 font-mono font-bold">@handle</span>. Funds flow via 1Click Swap into a private escrow DO. The recipient's true address is not yet exposed because it doesn't need to exist yet.
              </p>
              <div className="mt-6 pt-4 border-t border-stone-200 font-mono text-[11px] text-[#E05326]">
                POST /v0/quote (confidentiality: advanced)
              </div>
            </div>

            {/* Step 2 */}
            <div className="p-8 rounded-3xl bg-stone-50 border border-stone-200 shadow-sm relative overflow-hidden group hover:border-[#E05326] transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#E05326]/10 text-[#E05326] flex items-center justify-center font-mono font-bold text-lg mb-6 border border-[#E05326]/20">
                02
              </div>
              <h3 className="text-xl font-display font-bold text-stone-900 mb-3">
                Identity Binding
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                The recipient opens <span className="text-stone-950 font-mono font-bold">app.uprail.world</span> and authenticates with X OAuth 2.0 PKCE. Their stable numeric Snowflake ID is mapped to their pending deposits.
              </p>
              <div className="mt-6 pt-4 border-t border-stone-200 font-mono text-[11px] text-[#E05326]">
                Snowflake ID mapping • Zero public directory
              </div>
            </div>

            {/* Step 3 */}
            <div className="p-8 rounded-3xl bg-stone-50 border border-stone-200 shadow-sm relative overflow-hidden group hover:border-[#E05326] transition-all">
              <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center font-mono font-bold text-lg mb-6 shadow-md">
                03
              </div>
              <h3 className="text-xl font-display font-bold text-stone-900 mb-3">
                Biometric Passkey Claim
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                A WebAuthn P-256 passkey is generated directly on their phone or laptop. The escrow executes a confidential intent transfer into their passkey account. Only their biometric signature can spend it.
              </p>
              <div className="mt-6 pt-4 border-t border-stone-200 font-mono text-[11px] text-stone-900 font-bold">
                Hardware-isolated P-256 (ES256, Alg -7)
              </div>
            </div>
          </div>
        </section>

        {/* Public vs UPRAIL Comparison Matrix */}
        <section className="p-8 sm:p-12 rounded-3xl bg-stone-50 border border-stone-200 shadow-sm space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950">
              Public Explorer vs. The Confidential Rail
            </h2>
            <p className="text-xs text-stone-500">
              Why sending money to social accounts requires hardware-isolated zero-knowledge confidentiality.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
            {/* Public Chains */}
            <div className="p-6 rounded-2xl bg-white border border-red-200 space-y-4 shadow-sm">
              <div className="flex items-center space-x-2 text-red-600 font-mono text-xs font-bold uppercase">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span>Standard Public Chains (Venmo/Solana/Etherscan)</span>
              </div>
              <ul className="space-y-3 text-xs text-stone-600">
                <li className="flex items-start space-x-2">
                  <span className="text-red-500 font-bold">✕</span>
                  <span>Anyone who knows your @handle can see your exact wallet balance.</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-red-500 font-bold">✕</span>
                  <span>Every transaction is permanently public in blockchain explorers.</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-red-500 font-bold">✕</span>
                  <span>Recipients must generate 12-word seed phrases before receiving funds.</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-red-500 font-bold">✕</span>
                  <span>Unclaimed funds sent to inactive handles are lost forever.</span>
                </li>
              </ul>
            </div>

            {/* UPRAIL */}
            <div className="p-6 rounded-2xl bg-white border-2 border-[#E05326] space-y-4 shadow-md">
              <div className="flex items-center space-x-2 text-[#E05326] font-mono text-xs font-bold uppercase">
                <span className="w-2 h-2 rounded-full bg-[#E05326] animate-pulse" />
                <span>UPRAIL Confidential Railway</span>
              </div>
              <ul className="space-y-3 text-xs text-stone-900 font-medium">
                <li className="flex items-start space-x-2">
                  <span className="text-[#E05326] font-bold">✓</span>
                  <span>Balances, history, and recipients are strictly encrypted on a private TEE shard.</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-[#E05326] font-bold">✓</span>
                  <span>Partner APIs cannot view user balances—only the user's signature can authenticate.</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-[#E05326] font-bold">✓</span>
                  <span>Zero seed phrases: One-touch hardware passkey creation (Face ID / Touch ID).</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-[#E05326] font-bold">✓</span>
                  <span>Automatic 30-day Durable Object alarm refunds if recipient never claims.</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Final CTA Banner */}
        <section className="text-center py-16 px-6 rounded-3xl bg-stone-950 text-white border border-stone-800 relative overflow-hidden shadow-2xl">
          <div className="relative z-10 max-w-2xl mx-auto space-y-6">
            <h2 className="text-3xl sm:text-5xl font-display font-extrabold text-white tracking-tight">
              Ready to Send Discretion?
            </h2>
            <p className="text-sm text-stone-300">
              Launch the production application on <span className="text-white font-mono font-bold">app.uprail.world</span> to initiate confidential payments or claim funds waiting for your X handle.
            </p>
            <div className="pt-2">
              <Link
                to="/app"
                className="inline-flex items-center space-x-3 px-8 py-4 rounded-2xl bg-[#E05326] text-white font-display font-extrabold text-sm uppercase tracking-wider hover:bg-[#FF6B35] hover:scale-105 transition-all shadow-[0_10px_30px_rgba(224,83,38,0.5)]"
              >
                <span>Launch app.uprail.world</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-stone-200 bg-white py-10 relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-stone-500">
          <div className="flex items-center space-x-3">
            <span className="font-display font-bold text-stone-950 text-sm">UPRAIL.WORLD</span>
            <span>•</span>
            <span>Confidential Intents Railway</span>
            <span>•</span>
            <span className="font-mono text-[#E05326] font-bold">app.uprail.world</span>
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
