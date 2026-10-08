import React, { useState } from 'react';
import {
  Eye,
  Shield,
  AlertTriangle,
  Lock,
  Radio,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

export const SurveillanceDilemma: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'both' | 'fishbowl' | 'shard'>('both');

  return (
    <div className="w-full space-y-6">
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-stone-200 pb-4 gap-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-[#E05326] font-bold block mb-1">
            // The Architectural Dilemma
          </span>
          <h2 className="text-3xl sm:text-5xl font-display font-extrabold text-stone-950 tracking-tight">
            The Fishbowl vs The Shard
          </h2>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-stone-100 border border-stone-200 text-xs font-mono">
          <button
            onClick={() => setActiveTab('both')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              activeTab === 'both'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'text-stone-500 hover:text-black'
            }`}
          >
            Compare Both
          </button>
          <button
            onClick={() => setActiveTab('fishbowl')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              activeTab === 'fishbowl'
                ? 'bg-red-600 text-white font-bold shadow-sm'
                : 'text-stone-500 hover:text-black'
            }`}
          >
            Public Fishbowl
          </button>
          <button
            onClick={() => setActiveTab('shard')}
            className={`px-3 py-1.5 rounded-xl transition-all ${
              activeTab === 'shard'
                ? 'bg-[#E05326] text-white font-bold shadow-sm'
                : 'text-stone-500 hover:text-black'
            }`}
          >
            UPRAIL Shard
          </button>
        </div>
      </div>

      {/* Main Comparative Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
        {/* Card 1: The Public Fishbowl */}
        {(activeTab === 'both' || activeTab === 'fishbowl') && (
          <div className="rounded-3xl border border-red-200/90 bg-stone-50/60 p-6 sm:p-8 space-y-6 relative overflow-hidden transition-all shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-200 pb-4">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center font-bold">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-stone-950 text-xl">
                    The Public Fishbowl
                  </h3>
                  <span className="text-[10px] font-mono text-stone-500 uppercase">
                    Ethereum • Solana • Etherscan
                  </span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-red-100 text-red-700 flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                <span>SURVEILLANCE BY DEFAULT</span>
              </span>
            </div>

            <p className="text-sm text-stone-600 leading-relaxed">
              When a Twitter handle is tied to a standard public wallet, your entire balance, transaction timestamps, and financial network are irreversibly cataloged.
            </p>

            {/* Simulated Live Scanner Telemetry Feed */}
            <div className="rounded-2xl bg-white border border-stone-200 p-4 font-mono text-xs space-y-2.5 shadow-inner">
              <div className="text-[10px] uppercase tracking-wider text-stone-400 flex items-center justify-between pb-1 border-b border-stone-100">
                <span className="flex items-center space-x-1.5">
                  <Radio className="w-3 h-3 text-red-500 animate-pulse" />
                  <span>Public Mempool Telemetry</span>
                </span>
                <span className="text-red-500">LIVE LEAK</span>
              </div>

              <div className="space-y-1.5 text-[11px] leading-relaxed text-stone-700">
                <div className="p-2 rounded-lg bg-red-50/70 border border-red-100 flex items-start space-x-2">
                  <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-stone-900">@alice $\rightarrow$ @bob:</span> 500 USDC exposed.
                    <span className="block text-[10px] text-stone-400">Etherscan tags both social handles automatically.</span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-red-50/70 border border-red-100 flex items-start space-x-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-stone-900">Wallet Scraper:</span> Total holdings revealed.
                    <span className="block text-[10px] text-stone-400">Target net worth broadcasted to bots and phishing syndicates.</span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-red-50/70 border border-red-100 flex items-start space-x-2">
                  <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-stone-900">Mempool MEV:</span> Front-running sandwich bots extract gas.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Card 2: The UPRAIL Shielded Shard */}
        {(activeTab === 'both' || activeTab === 'shard') && (
          <div className="rounded-3xl border-2 border-[#E05326] bg-white p-6 sm:p-8 space-y-6 relative overflow-hidden transition-all shadow-xl shadow-[#E05326]/5">
            <div className="flex items-center justify-between border-b border-stone-200 pb-4">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#E05326]/10 text-[#E05326] flex items-center justify-center font-bold">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-stone-950 text-xl">
                    The UPRAIL Shard
                  </h3>
                  <span className="text-[10px] font-mono text-stone-500 uppercase">
                    NEAR Confidential Intents • WebAuthn P-256
                  </span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#39FF14]/20 border border-[#39FF14] text-[#062E0C] flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#39FF14] animate-pulse" />
                <span>SHIELDED BY CODE</span>
              </span>
            </div>

            <p className="text-sm text-stone-700 leading-relaxed font-medium">
              Funds settle directly into a confidential TEE enclave. Sender, recipient, and amounts are mathematically blinded. Only the recipient's biometric passkey can decrypt.
            </p>

            {/* Simulated Shielded Enclave Telemetry Feed */}
            <div className="rounded-2xl bg-stone-900 text-stone-100 p-4 font-mono text-xs space-y-2.5 shadow-inner">
              <div className="text-[10px] uppercase tracking-wider text-stone-400 flex items-center justify-between pb-1 border-b border-stone-800">
                <span className="flex items-center space-x-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#39FF14]" />
                  <span>Confidential Enclave Pipeline</span>
                </span>
                <span className="text-[#39FF14] font-bold">100% SECURE</span>
              </div>

              <div className="space-y-1.5 text-[11px] leading-relaxed text-stone-300">
                <div className="p-2 rounded-lg bg-stone-800/80 border border-stone-700 flex items-start space-x-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#39FF14] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-white">Blind Transfer:</span> 0 mempool leak.
                    <span className="block text-[10px] text-stone-400">Public balance visible on block explorers: $0.00.</span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-stone-800/80 border border-stone-700 flex items-start space-x-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#39FF14] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-white">Zero-Knowledge Identity:</span> Numeric Snowflake binding.
                    <span className="block text-[10px] text-stone-400">No public address directory. Handles change; funds stay safe.</span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-stone-800/80 border border-stone-700 flex items-start space-x-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#39FF14] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-white">Biometric Release:</span> One-touch Touch ID / Face ID.
                    <span className="block text-[10px] text-stone-400">Hardware-isolated P-256 key. Unclaimed funds auto-refund after 30 days.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
