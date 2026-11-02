'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Eye, ShieldCheck, Radio } from 'lucide-react';

export const MoneyFlowSchematic: React.FC = () => {
  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 text-stone-900 dark:text-white">
      {/* Minimal Header */}
      <div className="space-y-2 text-left border-b border-stone-200 dark:border-stone-800 pb-5">
        <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs sm:text-[10px] font-mono text-stone-600 dark:text-stone-300 font-bold">
          <Radio className="w-3.5 h-3.5 text-[#E05326] animate-pulse" />
          <span>ARCHITECTURE COMPARISON</span>
        </div>
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-black text-stone-950 dark:text-white tracking-tight leading-[1.06]">
          How Money Moves
        </h2>
        <p className="text-sm sm:text-base text-stone-600 dark:text-stone-400 font-sans max-w-xl">
          Radical public blockchain exposure versus UPRAIL&apos;s confidential solver settlement.
        </p>
      </div>

      {/* Side-by-Side Solid Architecture Cards (Zero Gradients) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        {/* ========================================================= */}
        {/* CARD 1: PUBLIC BLOCKCHAINS (SOLID RED / RADICAL EXPOSURE) */}
        {/* ========================================================= */}
        <div className="rounded-3xl border border-red-500/40 bg-[#140D0D] p-5 sm:p-7 space-y-6 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-red-500/20">
              <span className="font-display font-extrabold text-base sm:text-lg text-white">
                Public Blockchains
              </span>
              <span className="text-[10px] sm:text-xs font-mono font-bold text-red-400 bg-stone-900 border border-red-500/50 px-2.5 py-0.5 rounded-full flex items-center space-x-1.5">
                <Eye className="w-3.5 h-3.5 text-red-500" />
                <span>RADICAL EXPOSURE</span>
              </span>
            </div>

            {/* Solid Minimal SVG Topology */}
            <div className="w-full rounded-2xl bg-black border border-stone-800 p-3 sm:p-4 relative overflow-hidden">
              <svg
                viewBox="0 0 460 140"
                className="w-full h-auto select-none overflow-visible"
              >
                {/* Sender Node */}
                <g transform="translate(55, 70)">
                  <circle r="22" fill="#1C1010" stroke="#EF4444" strokeWidth="2" />
                  <text y="4" textAnchor="middle" fill="#FCA5A5" fontFamily="monospace" fontSize="9.5" fontWeight="bold">
                    Sender
                  </text>
                  <motion.circle
                    r="26"
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    animate={{ r: [22, 34], opacity: [0.9, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                  />
                </g>

                {/* Unshielded Leaking Pipe (Solid Lines) */}
                <line
                  x1="80"
                  y1="70"
                  x2="380"
                  y2="70"
                  stroke="#381818"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <line
                  x1="80"
                  y1="70"
                  x2="380"
                  y2="70"
                  stroke="#EF4444"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                />

                {/* Animated Leaking Packet (Solid Red) */}
                <motion.circle
                  r="6"
                  fill="#EF4444"
                  animate={{ cx: [80, 230, 380] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: 'linear' }}
                  cy="70"
                />

                {/* Center Surveillance Leak Tap */}
                <g transform="translate(230, 70)">
                  {/* Upward Leaking Pulse */}
                  <line x1="0" y1="-8" x2="0" y2="-32" stroke="#EF4444" strokeWidth="1.5" strokeDasharray="3 3" />
                  <motion.circle
                    r="3"
                    fill="#EF4444"
                    animate={{ cy: [-8, -32], opacity: [1, 0.2] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeIn' }}
                  />
                  <rect x="-56" y="-52" width="112" height="22" rx="6" fill="#1C1010" stroke="#EF4444" strokeWidth="1.5" />
                  <text x="0" y="-38" textAnchor="middle" fill="#FCA5A5" fontFamily="monospace" fontSize="7.5" fontWeight="bold">
                    EXPLORERS &amp; BOTS
                  </text>
                </g>

                {/* Recipient Node (Exposed) */}
                <g transform="translate(405, 70)">
                  <circle r="22" fill="#1C1010" stroke="#EF4444" strokeWidth="2" />
                  <text y="4" textAnchor="middle" fill="#EF4444" fontFamily="monospace" fontSize="8.5" fontWeight="bold">
                    Doxxed
                  </text>
                  <motion.circle
                    r="26"
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    animate={{ r: [22, 34], opacity: [0.9, 0] }}
                    transition={{ duration: 2, delay: 1, repeat: Infinity, ease: 'easeOut' }}
                  />
                </g>
              </svg>
            </div>

            {/* 2 Crisp Solid Comparison Points */}
            <div className="space-y-2 text-xs font-mono">
              <div className="p-3 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-between">
                <span className="text-stone-400">Identity &amp; Balance:</span>
                <span className="text-red-400 font-bold">100% Publicly Exposed</span>
              </div>
              <div className="p-3 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-between">
                <span className="text-stone-400">Counterparty Link:</span>
                <span className="text-red-400 font-bold">Permanently Mapped</span>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* CARD 2: UPRAIL (SOLID GREEN / CONFIDENTIAL INTENTS)       */}
        {/* ========================================================= */}
        <div className="rounded-3xl border border-[#00EC97]/40 bg-[#0B1410] p-5 sm:p-7 space-y-6 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[#00EC97]/20">
              <span className="font-display font-extrabold text-base sm:text-lg text-white">
                UPRAIL
              </span>
              <span className="text-[10px] sm:text-xs font-mono font-bold text-[#00EC97] bg-stone-900 border border-[#00EC97]/50 px-2.5 py-0.5 rounded-full flex items-center space-x-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#00EC97]" />
                <span>CONFIDENTIAL INTENTS</span>
              </span>
            </div>

            {/* Solid Minimal SVG Topology */}
            <div className="w-full rounded-2xl bg-black border border-stone-800 p-3 sm:p-4 relative overflow-hidden">
              <svg
                viewBox="0 0 460 140"
                className="w-full h-auto select-none overflow-visible"
              >
                {/* Handle Ingress Node */}
                <g transform="translate(55, 70)">
                  <circle r="22" fill="#1A110D" stroke="#E05326" strokeWidth="2" />
                  <text y="4" textAnchor="middle" fill="#FFB69E" fontFamily="monospace" fontSize="9.5" fontWeight="bold">
                    @handle
                  </text>
                  <motion.circle
                    r="25"
                    fill="none"
                    stroke="#E05326"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                  />
                </g>

                {/* Hermetic Shielded Conduit (Solid Lines) */}
                <line
                  x1="80"
                  y1="70"
                  x2="380"
                  y2="70"
                  stroke="#103322"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <line
                  x1="80"
                  y1="70"
                  x2="380"
                  y2="70"
                  stroke="#00EC97"
                  strokeWidth="2"
                  strokeDasharray="5 3"
                  strokeLinecap="round"
                />

                {/* Animated Shielded Packet (Solid Green) */}
                <motion.circle
                  r="6"
                  fill="#00EC97"
                  animate={{ cx: [80, 230, 380] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                  cy="70"
                />

                {/* Center NEP-518 Shield Enclave */}
                <g transform="translate(230, 70)">
                  <circle r="24" fill="#0A2418" stroke="#00EC97" strokeWidth="2" />
                  <text y="-3" textAnchor="middle" fill="#A7F3D0" fontFamily="monospace" fontSize="8" fontWeight="bold">
                    NEP-518
                  </text>
                  <text y="8" textAnchor="middle" fill="#00EC97" fontFamily="monospace" fontSize="7" fontWeight="black">
                    SHIELD
                  </text>
                  <motion.circle
                    r="28"
                    fill="none"
                    stroke="#00EC97"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
                  />
                </g>

                {/* near.com Socket Terminal */}
                <g transform="translate(405, 70)">
                  <circle r="22" fill="#0A2418" stroke="#00EC97" strokeWidth="2" />
                  <text y="4" textAnchor="middle" fill="#A7F3D0" fontFamily="monospace" fontSize="8" fontWeight="bold">
                    near.com
                  </text>
                  <circle
                    r="25"
                    fill="none"
                    stroke="#00EC97"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                    opacity="0.6"
                  />
                </g>
              </svg>
            </div>

            {/* 2 Crisp Solid Comparison Points */}
            <div className="space-y-2 text-xs font-mono">
              <div className="p-3 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-between">
                <span className="text-stone-400">Identity &amp; Balance:</span>
                <span className="text-[#00EC97] font-bold">100% Confidential</span>
              </div>
              <div className="p-3 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-between">
                <span className="text-stone-400">Settlement Target:</span>
                <span className="text-[#00EC97] font-bold">1-Tap Personal near.com</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
