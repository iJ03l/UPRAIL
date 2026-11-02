'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ShieldCheck,
  Eye,
  EyeOff,
  Fingerprint,
  Radio,
  Lock,
  ArrowRight,
  Zap,
  RefreshCw,
  Search,
  Scan,
  Shield,
  Layers,
  Cpu,
  CornerDownRight,
  Sparkles,
} from 'lucide-react';

export const MoneyFlowSchematic: React.FC = () => {
  const [activeStep, setActiveStep] = useState<number>(0);
  const [autoPlay, setAutoPlay] = useState<boolean>(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Auto-cycle through the 3 execution phases
  useEffect(() => {
    if (!autoPlay) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 3);
    }, 4500);
    return () => clearInterval(interval);
  }, [autoPlay]);

  const phases = [
    {
      id: 0,
      badge: 'PHASE 01',
      title: 'Ingress & Broadcast',
      publicLabel: 'Unshielded Mempool Radiating',
      privateLabel: 'Universal @handle Ingress Iris',
    },
    {
      id: 1,
      badge: 'PHASE 02',
      title: 'Conduit Execution',
      publicLabel: 'Mempool Sniffers & MEV Siphoning',
      privateLabel: 'NEP-518 Confidential Solver Enclave',
    },
    {
      id: 2,
      badge: 'PHASE 03',
      title: 'Terminal Settlement',
      publicLabel: 'Explorer Net Worth Doxxing',
      privateLabel: '1-Tap near.com Socket or Passkey',
    },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 sm:space-y-8 text-stone-900 dark:text-white">
      {/* 
        Section Header: Responsive, bold mobile typography
      */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-stone-200 dark:border-stone-800 pb-5">
        <div className="space-y-2 text-left">
          <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs sm:text-[10px] font-mono text-stone-600 dark:text-stone-300 font-bold">
            <Radio className="w-3.5 h-3.5 text-[#E05326] animate-pulse" />
            <span>TOPOLOGICAL ARCHITECTURE</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-black text-stone-950 dark:text-white tracking-tight leading-[1.06]">
            How Money Moves
          </h2>
          <p className="text-sm sm:text-base text-stone-600 dark:text-stone-400 font-sans max-w-xl">
            Compare the naked surveillance topology of legacy blockchains against UPRAIL&apos;s hermetic confidential solver enclave.
          </p>
        </div>

        {/* Interactive Phase Stepper */}
        <div className="flex items-center space-x-1.5 p-1.5 rounded-2xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 self-start sm:self-auto shadow-inner">
          {phases.map((phase, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setActiveStep(idx);
                setAutoPlay(false);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs sm:text-xs font-mono font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                activeStep === idx
                  ? 'bg-black text-white dark:bg-white dark:text-black shadow-sm'
                  : 'text-stone-500 hover:text-stone-950 dark:hover:text-white'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${activeStep === idx ? 'bg-[#E05326]' : 'bg-stone-400'}`} />
              <span>0{idx + 1}</span>
              <span className="hidden md:inline">/ {phase.title.split(' ')[0]}</span>
            </button>
          ))}

          <button
            type="button"
            onClick={() => setAutoPlay(!autoPlay)}
            className={`p-1.5 rounded-xl border border-transparent transition-colors cursor-pointer ${
              autoPlay
                ? 'text-[#00EC97] hover:bg-stone-200 dark:hover:bg-stone-800'
                : 'text-stone-400 hover:text-black dark:hover:text-white'
            }`}
            title={autoPlay ? 'Pause auto-cycle' : 'Resume auto-cycle'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${autoPlay ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
          </button>
        </div>
      </div>

      {/* 
        The Dual Graphical Architectural Schematics
      */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        {/* ========================================================= */}
        {/* SCHEMATIC 1: PUBLIC VALUE CONDUIT (RADICAL EXPOSURE)     */}
        {/* ========================================================= */}
        <div className="rounded-3xl border-2 border-red-500/30 dark:border-red-500/25 bg-gradient-to-b from-red-500/[0.04] to-transparent dark:bg-[#0E0A0A] p-5 sm:p-7 space-y-5 shadow-xl relative overflow-hidden flex flex-col justify-between">
          {/* Ambient Red Alarm Wash */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />

          <div className="space-y-4 relative z-10">
            {/* Header Telemetry */}
            <div className="flex items-center justify-between pb-3 border-b border-red-500/20">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                <span className="font-display font-extrabold text-base sm:text-lg text-stone-950 dark:text-white">
                  Public Blockchains
                </span>
              </div>
              <span className="text-[10px] sm:text-xs font-mono font-bold text-red-500 bg-red-500/10 border border-red-500/30 px-2.5 py-0.5 rounded-full flex items-center space-x-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>RADICAL EXPOSURE</span>
              </span>
            </div>

            {/* Visual SVG Circuit: Public Unshielded Pipeline */}
            <div className="w-full rounded-2xl bg-black/90 border border-red-500/30 p-3 sm:p-4 relative overflow-hidden shadow-inner">
              {/* Circuit Grid Background */}
              <div
                className="absolute inset-0 pointer-events-none opacity-20"
                style={{
                  backgroundImage: 'radial-gradient(circle, #EF4444 1px, transparent 1px)',
                  backgroundSize: '16px 16px',
                }}
              />

              <svg
                viewBox="0 0 540 280"
                className="w-full h-auto select-none overflow-visible"
                style={{ filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.15))' }}
              >
                <defs>
                  <linearGradient id="publicPipeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity="0.8" />
                    <stop offset="50%" stopColor="#F97316" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#EF4444" stopOpacity="0.8" />
                  </linearGradient>

                  <linearGradient id="leakBeam" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#EF4444" stopOpacity="0.0" />
                  </linearGradient>

                  <filter id="redGlow">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* 1. SENDER INGRESS NODE (Left) */}
                <g transform="translate(60, 140)">
                  {/* Expanding Radiating Mempool Waves */}
                  <motion.circle
                    r="28"
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    animate={{ r: [20, 38], opacity: [0.8, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                  />
                  <circle r="22" fill="#1A0D0D" stroke="#EF4444" strokeWidth="2" />
                  {/* Sender Glyph */}
                  <text
                    y="-4"
                    textAnchor="middle"
                    fill="#FCA5A5"
                    fontFamily="monospace"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    0x4a12
                  </text>
                  <text
                    y="9"
                    textAnchor="middle"
                    fill="#EF4444"
                    fontFamily="monospace"
                    fontSize="8"
                    fontWeight="bold"
                  >
                    SENDER
                  </text>

                  {/* Active highlight in step 0 */}
                  {activeStep === 0 && (
                    <motion.circle
                      r="26"
                      fill="none"
                      stroke="#EF4444"
                      strokeWidth="2"
                      animate={{ scale: [1, 1.25, 1], opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </g>

                {/* 2. THE UNSHIELDED CONDUIT (Main Bus Line) */}
                <path
                  d="M 85 140 L 455 140"
                  stroke="rgba(239, 68, 68, 0.3)"
                  strokeWidth="12"
                  strokeLinecap="round"
                />
                <path
                  d="M 85 140 L 455 140"
                  stroke="url(#publicPipeGrad)"
                  strokeWidth="2.5"
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                />

                {/* Animated Unshielded Value Packets (Red/Orange pulses) */}
                <motion.circle
                  r="6"
                  fill="#F87171"
                  filter="url(#redGlow)"
                  animate={{
                    cx: [85, 200, 330, 455],
                    cy: [140, 140, 140, 140],
                  }}
                  transition={{
                    duration: 3.2,
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                />

                {/* 3. SURVEILLANCE LISTENERS TAPPING THE PIPE */}
                {/* Surveillance Tap 1: MEMPOOL SNIFFER (Top-Left) */}
                <g transform="translate(195, 50)">
                  <line x1="0" y1="25" x2="0" y2="85" stroke="#EF4444" strokeWidth="1.5" strokeDasharray="3 3" />
                  {/* Leaking particle flowing upward into sniffer */}
                  <motion.circle
                    r="3"
                    fill="#EF4444"
                    animate={{ cy: [85, 25], opacity: [1, 0.2] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeIn' }}
                  />
                  <rect x="-60" y="-18" width="120" height="38" rx="8" fill="#180C0C" stroke="#EF4444" strokeWidth="1.5" />
                  <text x="0" y="-2" textAnchor="middle" fill="#FCA5A5" fontFamily="monospace" fontSize="9" fontWeight="bold">
                    MEMPOOL SNIFFER
                  </text>
                  <text x="0" y="11" textAnchor="middle" fill="#EF4444" fontFamily="monospace" fontSize="7.5">
                    PUBLIC TX PAYLOAD LEAK
                  </text>
                </g>

                {/* Surveillance Tap 2: CHAINALYSIS / ARKHAM EYE (Top-Right) */}
                <g transform="translate(345, 50)">
                  <line x1="0" y1="25" x2="0" y2="85" stroke="#EF4444" strokeWidth="1.5" strokeDasharray="3 3" />
                  {/* Leaking particle */}
                  <motion.circle
                    r="3"
                    fill="#F97316"
                    animate={{ cy: [85, 25], opacity: [1, 0.2] }}
                    transition={{ duration: 1.6, delay: 0.4, repeat: Infinity, ease: 'easeIn' }}
                  />
                  <rect x="-62" y="-18" width="124" height="38" rx="8" fill="#180C0C" stroke="#F97316" strokeWidth="1.5" />
                  <text x="0" y="-2" textAnchor="middle" fill="#FED7AA" fontFamily="monospace" fontSize="9" fontWeight="bold">
                    AI CLUSTER INDEXER
                  </text>
                  <text x="0" y="11" textAnchor="middle" fill="#F97316" fontFamily="monospace" fontSize="7.5">
                    ARKHAM / NANSEN GRAPH
                  </text>
                </g>

                {/* Surveillance Tap 3: MEV SANDWICH BOT (Bottom-Center) */}
                <g transform="translate(270, 225)">
                  <line x1="0" y1="-25" x2="0" y2="-80" stroke="#EF4444" strokeWidth="1.5" strokeDasharray="3 3" />
                  {/* Leaking particle flowing downward */}
                  <motion.circle
                    r="3"
                    fill="#EF4444"
                    animate={{ cy: [-80, -25], opacity: [1, 0.2] }}
                    transition={{ duration: 1.5, delay: 0.7, repeat: Infinity, ease: 'easeIn' }}
                  />
                  <rect x="-65" y="-16" width="130" height="36" rx="8" fill="#180C0C" stroke="#EF4444" strokeWidth="1.5" />
                  <text x="0" y="-1" textAnchor="middle" fill="#FCA5A5" fontFamily="monospace" fontSize="9" fontWeight="bold">
                    MEV FRONTRUNNER
                  </text>
                  <text x="0" y="12" textAnchor="middle" fill="#EF4444" fontFamily="monospace" fontSize="7.5">
                    SANDWICH / SLIPPAGE THEFT
                  </text>
                </g>

                {/* 4. RECIPIENT TERMINAL (Right - Fully Doxxed) */}
                <g transform="translate(475, 140)">
                  <circle r="24" fill="#1F0F0F" stroke="#EF4444" strokeWidth="2" />
                  <text y="-5" textAnchor="middle" fill="#FCA5A5" fontFamily="monospace" fontSize="9.5" fontWeight="bold">
                    0x73c9
                  </text>
                  <text y="8" textAnchor="middle" fill="#EF4444" fontFamily="monospace" fontSize="8" fontWeight="bold">
                    DOXXED
                  </text>

                  {/* Radiating Leak Wave from recipient */}
                  <motion.circle
                    r="30"
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    animate={{ r: [25, 42], opacity: [0.7, 0] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />

                  {/* Active highlight in step 2 */}
                  {activeStep === 2 && (
                    <motion.circle
                      r="28"
                      fill="none"
                      stroke="#EF4444"
                      strokeWidth="2"
                      animate={{ scale: [1, 1.25, 1], opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </g>
              </svg>
            </div>

            {/* Visual Doxxing Telemetry Strip */}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-between">
                <span className="text-stone-400">COUNTERPARTY:</span>
                <span className="text-red-400 font-bold">100% UNMASKED</span>
              </div>
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-between">
                <span className="text-stone-400">NET WORTH:</span>
                <span className="text-red-400 font-bold">PUBLICLY INDEXED</span>
              </div>
            </div>
          </div>

          {/* Active Phase Callout (Public) */}
          <div className="pt-3 border-t border-red-500/20 flex items-center justify-between text-xs font-mono">
            <span className="text-stone-400">ACTIVE LEAK:</span>
            <span className="text-red-400 font-bold tracking-wide">
              {phases[activeStep].publicLabel}
            </span>
          </div>
        </div>

        {/* ========================================================= */}
        {/* SCHEMATIC 2: UPRAIL CONFIDENTIAL INTENT ENCLAVE           */}
        {/* ========================================================= */}
        <div className="rounded-3xl border-2 border-[#00EC97]/40 dark:border-[#00EC97]/30 bg-gradient-to-b from-[#00EC97]/[0.05] to-transparent dark:bg-[#0A0E0C] p-5 sm:p-7 space-y-5 shadow-xl relative overflow-hidden flex flex-col justify-between">
          {/* Ambient Emerald & Burnt-Orange Glow Wash */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#00EC97]/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#E05326]/10 rounded-full blur-3xl pointer-events-none" />

          <div className="space-y-4 relative z-10">
            {/* Header Telemetry */}
            <div className="flex items-center justify-between pb-3 border-b border-[#00EC97]/25">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#00EC97] animate-pulse" />
                <span className="font-display font-extrabold text-base sm:text-lg text-stone-950 dark:text-white">
                  UPRAIL Confidential Enclave
                </span>
              </div>
              <span className="text-[10px] sm:text-xs font-mono font-bold text-[#00EC97] bg-[#00EC97]/10 border border-[#00EC97]/35 px-2.5 py-0.5 rounded-full flex items-center space-x-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>NEP-518 SHIELDED</span>
              </span>
            </div>

            {/* Visual SVG Circuit: Hermetic Enclave Topology */}
            <div className="w-full rounded-2xl bg-black/90 border border-[#00EC97]/35 p-3 sm:p-4 relative overflow-hidden shadow-inner">
              {/* Circuit Grid Background */}
              <div
                className="absolute inset-0 pointer-events-none opacity-20"
                style={{
                  backgroundImage: 'radial-gradient(circle, #00EC97 1px, transparent 1px)',
                  backgroundSize: '16px 16px',
                }}
              />

              <svg
                viewBox="0 0 540 280"
                className="w-full h-auto select-none overflow-visible"
                style={{ filter: 'drop-shadow(0 0 8px rgba(0, 236, 151, 0.2))' }}
              >
                <defs>
                  <linearGradient id="shieldPipeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#E05326" stopOpacity="0.9" />
                    <stop offset="50%" stopColor="#00EC97" stopOpacity="1.0" />
                    <stop offset="100%" stopColor="#00C1DE" stopOpacity="0.9" />
                  </linearGradient>

                  <filter id="greenGlow">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* 1. UNIVERSAL @HANDLE INGRESS PORTAL (Left) */}
                <g transform="translate(60, 140)">
                  {/* Rotating Burnt-Orange Ingress Iris */}
                  <motion.circle
                    r="26"
                    fill="none"
                    stroke="#E05326"
                    strokeWidth="1.5"
                    strokeDasharray="6 4"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
                  />
                  <circle r="22" fill="#120A07" stroke="#E05326" strokeWidth="2" />
                  <text
                    y="-3"
                    textAnchor="middle"
                    fill="#FFB69E"
                    fontFamily="monospace"
                    fontSize="11"
                    fontWeight="bold"
                  >
                    @handle
                  </text>
                  <text
                    y="10"
                    textAnchor="middle"
                    fill="#E05326"
                    fontFamily="monospace"
                    fontSize="7.5"
                    fontWeight="bold"
                  >
                    INGRESS
                  </text>

                  {/* Active highlight in step 0 */}
                  {activeStep === 0 && (
                    <motion.circle
                      r="28"
                      fill="none"
                      stroke="#E05326"
                      strokeWidth="2"
                      animate={{ scale: [1, 1.25, 1], opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </g>

                {/* 2. THE HERMETIC CONDUIT (Lead-in to Enclave Core) */}
                <path
                  d="M 85 140 L 220 140"
                  stroke="rgba(224, 83, 38, 0.3)"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <path
                  d="M 85 140 L 220 140"
                  stroke="#E05326"
                  strokeWidth="2.5"
                  strokeDasharray="5 3"
                  strokeLinecap="round"
                />

                {/* Lead-out to Receptacle */}
                <path
                  d="M 320 140 L 455 140"
                  stroke="rgba(0, 236, 151, 0.3)"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <path
                  d="M 320 140 L 455 140"
                  stroke="#00EC97"
                  strokeWidth="2.5"
                  strokeDasharray="5 3"
                  strokeLinecap="round"
                />

                {/* Animated Green/Orange Cryptographic Particle */}
                <motion.circle
                  r="6"
                  fill="#00EC97"
                  filter="url(#greenGlow)"
                  animate={{
                    cx: [85, 270, 455],
                    cy: [140, 140, 140],
                    fill: ['#E05326', '#00EC97', '#00C1DE'],
                  }}
                  transition={{
                    duration: 3.2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />

                {/* 3. THE CENTRAL CRYPTOGRAPHIC CORE (NEP-518 SOLVER ENCLAVE) */}
                <g transform="translate(270, 140)">
                  {/* Outer Shield Hexagon/Ring */}
                  <motion.circle
                    r="48"
                    fill="none"
                    stroke="#00EC97"
                    strokeWidth="1.5"
                    strokeDasharray="8 6"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
                  />
                  <motion.circle
                    r="40"
                    fill="none"
                    stroke="#00C1DE"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                    animate={{ rotate: -360 }}
                    transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
                  />

                  {/* Dark Enclave Chassis */}
                  <circle r="34" fill="#061811" stroke="#00EC97" strokeWidth="2.5" />

                  {/* Core Status Glyphs */}
                  <text y="-8" textAnchor="middle" fill="#A7F3D0" fontFamily="monospace" fontSize="8.5" fontWeight="bold">
                    intents.near
                  </text>
                  <text y="4" textAnchor="middle" fill="#00EC97" fontFamily="monospace" fontSize="9" fontWeight="black">
                    NEP-518
                  </text>
                  <text y="15" textAnchor="middle" fill="#00C1DE" fontFamily="monospace" fontSize="7" fontWeight="bold">
                    ZK-SOLVER
                  </text>

                  {/* Bouncing Deflected Probe Rays (Surveillance Deflection) */}
                  <g transform="translate(0, -60)">
                    <line x1="-30" y1="-20" x2="-8" y2="-5" stroke="#EF4444" strokeWidth="1" strokeDasharray="3 2" />
                    {/* Bounced Ray */}
                    <line x1="-8" y1="-5" x2="-35" y2="-10" stroke="#00EC97" strokeWidth="1.5" />
                    <text x="-12" y="-18" textAnchor="end" fill="#00EC97" fontFamily="monospace" fontSize="7" fontWeight="bold">
                      ✦ DEFLECTED
                    </text>
                  </g>

                  {/* Active highlight in step 1 */}
                  {activeStep === 1 && (
                    <motion.circle
                      r="44"
                      fill="none"
                      stroke="#00EC97"
                      strokeWidth="2.5"
                      animate={{ scale: [1, 1.2, 1], opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </g>

                {/* 4. SETTLEMENT TERMINAL (near.com Socket or Passkey Receptacle) */}
                <g transform="translate(475, 140)">
                  <circle r="24" fill="#061C14" stroke="#00EC97" strokeWidth="2" />
                  <text y="-5" textAnchor="middle" fill="#A7F3D0" fontFamily="monospace" fontSize="8.5" fontWeight="bold">
                    near.com
                  </text>
                  <text y="8" textAnchor="middle" fill="#00EC97" fontFamily="monospace" fontSize="7.5" fontWeight="bold">
                    SOCKET
                  </text>

                  {/* Stable Emerald Lock Ring */}
                  <circle
                    r="30"
                    fill="none"
                    stroke="#00EC97"
                    strokeWidth="1"
                    strokeDasharray="6 3"
                    opacity="0.6"
                  />

                  {/* Active highlight in step 2 */}
                  {activeStep === 2 && (
                    <motion.circle
                      r="28"
                      fill="none"
                      stroke="#00EC97"
                      strokeWidth="2"
                      animate={{ scale: [1, 1.25, 1], opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </g>
              </svg>
            </div>

            {/* Visual Cryptographic Telemetry Strip */}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2.5 rounded-xl bg-[#00EC97]/10 border border-[#00EC97]/30 flex items-center justify-between">
                <span className="text-stone-400">COUNTERPARTY:</span>
                <span className="text-[#00EC97] font-bold">0.00% LEAK</span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#00EC97]/10 border border-[#00EC97]/30 flex items-center justify-between">
                <span className="text-stone-400">SETTLEMENT:</span>
                <span className="text-[#00EC97] font-bold">1-TAP SOVEREIGN</span>
              </div>
            </div>
          </div>

          {/* Active Phase Callout (Private) */}
          <div className="pt-3 border-t border-[#00EC97]/20 flex items-center justify-between text-xs font-mono">
            <span className="text-stone-400">SHIELD STATUS:</span>
            <span className="text-[#00EC97] font-bold tracking-wide">
              {phases[activeStep].privateLabel}
            </span>
          </div>
        </div>
      </div>

      {/* 
        3-Stage Visual Architecture Contrast Matrix (Minimal Text, Pure Technical Clarity)
      */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 pt-2">
        {phases.map((phase) => {
          const isSelected = activeStep === phase.id;
          return (
            <motion.button
              key={phase.id}
              type="button"
              onClick={() => {
                setActiveStep(phase.id);
                setAutoPlay(false);
              }}
              whileHover={{ y: -2 }}
              className={`p-4 sm:p-5 rounded-2xl border text-left transition-all cursor-pointer space-y-3 ${
                isSelected
                  ? 'bg-black text-white dark:bg-stone-900 border-[#E05326] shadow-md ring-1 ring-[#E05326]'
                  : 'bg-white dark:bg-stone-950 border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:border-stone-400'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#E05326] font-bold">
                  {phase.badge}
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    isSelected
                      ? 'bg-[#E05326]/20 text-[#E05326] font-bold'
                      : 'bg-stone-100 dark:bg-stone-900 text-stone-500'
                  }`}
                >
                  {isSelected ? 'INSPECTING' : 'TAP TO VIEW'}
                </span>
              </div>

              <h4 className="text-base sm:text-lg font-display font-bold text-stone-950 dark:text-white leading-tight">
                {phase.title}
              </h4>

              <div className="space-y-1.5 text-xs font-mono pt-1 border-t border-stone-200/60 dark:border-stone-800/80">
                <div className="flex items-center space-x-1.5 text-red-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="truncate">{phase.publicLabel}</span>
                </div>
                <div className="flex items-center space-x-1.5 text-[#00EC97]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00EC97] flex-shrink-0" />
                  <span className="truncate">{phase.privateLabel}</span>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};
