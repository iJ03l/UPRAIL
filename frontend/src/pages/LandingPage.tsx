import React, { useState } from 'react';
import { Link } from 'react-router-dom';
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

  return (
    <div className="relative min-h-screen bg-white text-stone-900 overflow-hidden selection:bg-[#E05326] selection:text-white font-sans">
      {/* 
        Quantus Interactive Background: 
        1. Dynamic pixelated matrix that lights up on mouse movement & scroll
        2. Real figure pixel sprite trailing behind cursor based on velocity vector
      */}
      <QuantusInteractiveCanvas />

      {/* Quantus-Style Technical Header */}
      <header className="sticky top-0 z-40 w-full border-b border-stone-200/90 bg-white/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          {/* Brand Emblem */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-[#E05326] via-[#FF6B35] to-[#39FF14] p-[1.5px] shadow-sm group-hover:scale-105 transition-transform duration-200">
              <div className="w-full h-full bg-white rounded-xl flex items-center justify-center">
                <span className="font-display font-black text-black text-base sm:text-lg tracking-tight">UP</span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-display font-extrabold text-lg sm:text-xl tracking-tight text-stone-950 flex items-center">
                UPRAIL
                <span className="ml-2 px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#E05326]/10 text-[#E05326] border border-[#E05326]/20 rounded">
                  MAINNET
                </span>
              </span>
              <span className="text-[10px] font-mono text-stone-400 -mt-0.5 hidden sm:inline uppercase tracking-widest">
                uprail.world // confidential
              </span>
            </div>
          </Link>

          {/* Navigation Links in Quantus Minimal Monospace */}
          <nav className="hidden md:flex items-center space-x-6 text-xs font-mono uppercase tracking-wider text-stone-600">
            <a href="#problem" className="hover:text-black transition-colors">
              [01 // The Vulnerability]
            </a>
            <a href="#simulator" className="hover:text-black transition-colors">
              [02 // Intent Simulator]
            </a>
            <a href="#matrix" className="hover:text-black transition-colors">
              [03 // Matrix]
            </a>
            <a href="#specs" className="hover:text-black transition-colors">
              [04 // Architecture]
            </a>
          </nav>

          {/* CTA: Enter App */}
          <div className="flex items-center space-x-3">
            <Link
              to="/app"
              className="relative group px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-black text-white font-display font-bold text-xs uppercase tracking-wider hover:bg-[#E05326] transition-all shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:shadow-[0_4px_22px_rgba(224,83,38,0.35)] flex items-center space-x-2"
            >
              <span>Launch App</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Landing Flow */}
      <main className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-28 space-y-28 sm:space-y-36">
        {/* Hero Section */}
        <section className="relative text-center max-w-4xl mx-auto space-y-6 pt-2 sm:pt-6">
          {/* Quantus-style system prompt banner */}
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-stone-100 border border-stone-200/80 text-xs font-mono text-stone-700 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-[#39FF14] border border-[#062E0C] animate-pulse" />
            <span>CONFIDENTIAL ENTITY ACTIVE • STEER CURSOR TO GUIDE</span>
          </div>

          {/* Huge Display Heading */}
          <h1 className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-display font-extrabold tracking-tight leading-[1.02] text-stone-950">
            Money on <span className="underline decoration-[#E05326] decoration-4 underline-offset-8">𝕏</span>.
            <br />
            <span className="bg-gradient-to-r from-[#E05326] via-[#FF6B35] to-[#C8461C] bg-clip-text text-transparent">
              Zero public leak.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed font-sans">
            Send confidential cross-chain payments to any X handle on NEAR Confidential Intents.
            Recipient claims instantly with biometric passkeys on <span className="font-mono text-black font-semibold">app.uprail.world</span>.
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

          {/* Quantus-Style Tabular Stats Row */}
          <div className="pt-10 grid grid-cols-2 md:grid-cols-4 border border-stone-200 rounded-2xl bg-stone-50/70 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-stone-200 text-left shadow-sm">
            <div className="p-4 sm:p-5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 block mb-1">
                Execution Model
              </span>
              <span className="text-xl sm:text-2xl font-mono font-bold text-stone-900 block leading-tight">
                TEE Enclave
              </span>
              <span className="text-[11px] font-mono text-[#E05326] mt-0.5 block">
                Private Shard Shielder
              </span>
            </div>

            <div className="p-4 sm:p-5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 block mb-1">
                Recipient Auth
              </span>
              <span className="text-xl sm:text-2xl font-mono font-bold text-stone-900 block leading-tight">
                P-256 Passkey
              </span>
              <span className="text-[11px] font-mono text-stone-600 mt-0.5 block">
                WebAuthn ES256 (-7)
              </span>
            </div>

            <div className="p-4 sm:p-5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 block mb-1">
                Inbound Settlement
              </span>
              <span className="text-xl sm:text-2xl font-mono font-bold text-stone-900 block leading-tight">
                ~2.1s
              </span>
              <span className="text-[11px] font-mono text-[#E05326] mt-0.5 block">
                1Click Swap Engine
              </span>
            </div>

            <div className="p-4 sm:p-5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 block mb-1">
                Escrow Protection
              </span>
              <span className="text-xl sm:text-2xl font-mono font-bold text-stone-900 block leading-tight">
                30 Days
              </span>
              <span className="text-[11px] font-mono text-emerald-600 mt-0.5 block">
                Auto Alarm Refund
              </span>
            </div>
          </div>
        </section>

        {/* Quantus-Style Problem / Vulnerability Section */}
        <section id="problem" className="scroll-mt-24 space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-stone-200 pb-4 gap-2">
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-bold">
                [01 // The Surveillance Dilemma]
              </span>
              <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-stone-950 mt-1">
                $2.8 Trillion in Crypto. Zero Social Privacy.
              </h2>
            </div>
            <p className="text-xs font-mono text-stone-500 max-w-sm">
              Linking a public wallet address to a social identity invites permanent scraping, phishing, and physical targeting.
            </p>
          </div>

          {/* Quantus Chain Comparison Matrix */}
          <div id="matrix" className="border border-stone-200 rounded-3xl bg-white overflow-hidden shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-stone-200 text-left">
              {/* Bitcoin */}
              <div className="p-6 sm:p-8 space-y-3 bg-stone-50/50">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-wider text-stone-400">Network</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800">
                    VULNERABLE
                  </span>
                </div>
                <div className="text-xl font-display font-bold text-stone-900">Bitcoin</div>
                <div className="font-mono text-xs text-stone-500">ECDSA-256 (secp256k1)</div>
                <p className="text-xs text-stone-600 leading-relaxed pt-2 border-t border-stone-200">
                  Every Satoshi sent to a public handle links your entire UTXO graph and future balance.
                </p>
              </div>

              {/* Ethereum */}
              <div className="p-6 sm:p-8 space-y-3 bg-stone-50/50">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-wider text-stone-400">Network</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800">
                    VULNERABLE
                  </span>
                </div>
                <div className="text-xl font-display font-bold text-stone-900">Ethereum</div>
                <div className="font-mono text-xs text-stone-500">Public Mempools</div>
                <p className="text-xs text-stone-600 leading-relaxed pt-2 border-t border-stone-200">
                  MEV bots front-run transfers; Etherscan indexes every social handle payment permanently.
                </p>
              </div>

              {/* Solana */}
              <div className="p-6 sm:p-8 space-y-3 bg-stone-50/50">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-wider text-stone-400">Network</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800">
                    VULNERABLE
                  </span>
                </div>
                <div className="text-xl font-display font-bold text-stone-900">Solana</div>
                <div className="font-mono text-xs text-stone-500">Public Account History</div>
                <p className="text-xs text-stone-600 leading-relaxed pt-2 border-t border-stone-200">
                  Wallet scrapers instantly associate Twitter handles with live token balances and net worth.
                </p>
              </div>

              {/* UPRAIL */}
              <div className="p-6 sm:p-8 space-y-3 bg-[#E05326]/5 relative">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-wider text-[#E05326] font-bold">UPRAIL</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#39FF14]/20 border border-[#39FF14] text-[#062E0C]">
                    SHIELDED
                  </span>
                </div>
                <div className="text-xl font-display font-bold text-stone-950">NEAR Confidential</div>
                <div className="font-mono text-xs text-[#E05326] font-bold">TEE Private Shard + P-256</div>
                <p className="text-xs text-stone-800 leading-relaxed pt-2 border-t border-[#E05326]/20 font-medium">
                  Balances, transfers, and recipients are strictly encrypted. Only your biometric passkey holds the spend key.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Live Interactive Prototype Element: Confidential Rail Simulator */}
        <section id="simulator" className="scroll-mt-24 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200 pb-3">
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-bold">
                [02 // Interactive Prototype]
              </span>
              <h2 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950">
                Pulse The Confidential Intent
              </h2>
            </div>
            <span className="text-xs font-mono text-stone-400 hidden sm:inline">
              LIVE SIMULATION // 1CLICK
            </span>
          </div>
          <InteractiveRailSimulator />
        </section>

        {/* Quantus-Style Scroll Manifesto Text Reveal */}
        <section className="max-w-4xl mx-auto py-8 text-center space-y-6">
          <div className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-bold">
            [03 // The Confidential Philosophy]
          </div>
          <TextReveal
            className="text-2xl sm:text-4xl md:text-5xl font-display font-bold tracking-tight leading-tight justify-center"
            accentWords={['confidential', 'passkey', 'mempools', 'shards', 'secret']}
          >
            Public blockchains leak your wealth to the universe. UPRAIL routes value through confidential TEE shards where balances remain a secret between you and your biometric passkey. Zero mempools. Zero surveillance. Absolute discretion.
          </TextReveal>
        </section>

        {/* Architecture Spec Sheet (Quantus Technical Style) */}
        <section id="specs" className="scroll-mt-24 space-y-6">
          <div className="border-b border-stone-200 pb-3 flex items-center justify-between">
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-bold">
                [04 // Protocol Specifications]
              </span>
              <h2 className="text-2xl sm:text-3xl font-display font-extrabold text-stone-950">
                Cryptographic Blueprint
              </h2>
            </div>
            <span className="text-xs font-mono text-stone-400 hidden sm:inline">
              NEP-413 // WEBAUTHN P-256
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl border border-stone-200 bg-stone-50 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#E05326]/10 text-[#E05326] flex items-center justify-center font-mono font-bold text-sm">
                01
              </div>
              <h3 className="text-lg font-display font-bold text-stone-900">
                Confidential Escrow DO
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Cloudflare Durable Object state machine running SQLite and 30-day hardware alarms. Syncs claim proofs to NEAR private shard via ed25519 signer.
              </p>
              <div className="font-mono text-[11px] text-[#E05326] pt-2 border-t border-stone-200">
                Standard: NEP-413 (Ed25519)
              </div>
            </div>

            <div className="p-6 rounded-2xl border border-stone-200 bg-stone-50 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#E05326]/10 text-[#E05326] flex items-center justify-center font-mono font-bold text-sm">
                02
              </div>
              <h3 className="text-lg font-display font-bold text-stone-900">
                Stable Snowflake Binding
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                X OAuth 2.0 PKCE binds the recipient's permanent numeric user ID. Usernames can change or recycle; funds always map to the true identity.
              </p>
              <div className="font-mono text-[11px] text-[#E05326] pt-2 border-t border-stone-200">
                Identity: X API v2 PKCE
              </div>
            </div>

            <div className="p-6 rounded-2xl border border-stone-200 bg-stone-50 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-black text-white flex items-center justify-center font-mono font-bold text-sm shadow-md">
                03
              </div>
              <h3 className="text-lg font-display font-bold text-stone-900">
                Hardware Passkey Signer
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                WebAuthn P-256 private keys generated inside the user's Secure Enclave. Partner APIs cannot access balances; only hardware signatures can unlock.
              </p>
              <div className="font-mono text-[11px] text-stone-900 font-bold pt-2 border-t border-stone-200">
                Cipher: ES256 (NIST P-256, -7)
              </div>
            </div>
          </div>
        </section>

        {/* Quantus-Style Call To Action Terminal Banner */}
        <section className="p-8 sm:p-14 rounded-3xl bg-stone-950 text-white border border-stone-800 shadow-2xl relative overflow-hidden text-center">
          <div className="relative z-10 max-w-2xl mx-auto space-y-6">
            <span className="px-3 py-1 rounded-full bg-[#E05326]/20 border border-[#E05326]/40 text-[#E05326] text-xs font-mono font-bold uppercase tracking-wider">
              Launch Production Environment
            </span>
            <h2 className="text-3xl sm:text-5xl font-display font-extrabold text-white tracking-tight">
              Ready to Send Discretion?
            </h2>
            <p className="text-sm text-stone-400">
              Access the confidential payment rail on <span className="text-white font-mono font-bold">app.uprail.world</span> to initiate transfers or claim pending balances with your passkey.
            </p>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/app"
                className="w-full sm:w-auto inline-flex items-center justify-center space-x-3 px-8 py-4 rounded-2xl bg-[#E05326] text-white font-display font-extrabold text-sm uppercase tracking-wider hover:bg-[#FF6B35] hover:scale-105 transition-all shadow-[0_10px_30px_rgba(224,83,38,0.5)]"
              >
                <span>Launch app.uprail.world</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Quantus-Style Technical Footer */}
      <footer className="w-full border-t border-stone-200 bg-white py-12 relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6 text-xs font-mono text-stone-500">
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
              Launch App →
            </Link>
          </div>
        </div>
      </footer>

      {/* Dual Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
};
