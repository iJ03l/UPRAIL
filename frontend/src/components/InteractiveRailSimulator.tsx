'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Lock,
  ExternalLink,
  Radio,
  Fingerprint,
  Wallet,
} from 'lucide-react';

const PRESETS = [
  { handle: 'satoshi', asset: 'BTC', amount: '1,000' },
  { handle: 'illia', asset: 'NEAR', amount: '500' },
  { handle: 'mert', asset: 'SOL', amount: '250' },
];

export const InteractiveRailSimulator: React.FC = () => {
  const [handle, setHandle] = useState('illia');
  const [asset, setAsset] = useState('USDC');
  const [amount, setAmount] = useState('500');
  const [activeStep, setActiveStep] = useState<'idle' | 'ingress' | 'shield' | 'settled'>('idle');

  const cleanHandle = handle.replace(/^@/, '').trim() || 'illia';

  const triggerBeam = () => {
    if (activeStep !== 'idle' && activeStep !== 'settled') return;
    setActiveStep('ingress');

    setTimeout(() => {
      setActiveStep('shield');
      setTimeout(() => {
        setActiveStep('settled');
      }, 1100);
    }, 900);
  };

  const isTransmitting = activeStep === 'ingress' || activeStep === 'shield';

  return (
    <div className="w-full border-y border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-[#0A0807] py-14 sm:py-20 select-none">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 space-y-8">
        {/* Minimal Header */}
        <div className="space-y-2 text-left border-b border-stone-200 dark:border-stone-800 pb-5">
          <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs sm:text-[10px] font-mono text-stone-600 dark:text-stone-300 font-bold">
            <Radio className="w-3.5 h-3.5 text-[#E05326] animate-pulse" />
            <span>INTERACTIVE TACTILE BEAM</span>
          </div>
          <h3 className="text-3xl sm:text-4xl md:text-5xl font-display font-black text-stone-950 dark:text-white tracking-tight">
            Beam Value to an 𝕏 Handle
          </h3>
          <p className="text-sm sm:text-base text-stone-600 dark:text-stone-400 font-sans max-w-xl">
            A dynamic multi-beam topology routing multichain liquidity into the UPRAIL confidential solver and straight into a personal near.com wallet.
          </p>
        </div>

        {/* The Tactile Simulator Chassis */}
        <div className="rounded-3xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#110D0B] p-5 sm:p-8 space-y-6 shadow-sm">
          {/* Controls Bar: Target Handle, Asset & Amount */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-6 border-b border-stone-200 dark:border-stone-800">
            {/* Target 𝕏 Handle */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400 font-bold">
                Target 𝕏 Handle
              </span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-bold text-[#E05326] text-sm">
                  @
                </span>
                <input
                  type="text"
                  value={cleanHandle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="handle"
                  disabled={isTransmitting}
                  className="w-full pl-8 pr-3 py-2.5 bg-stone-50 dark:bg-black border border-stone-200 dark:border-stone-800 focus:border-[#E05326] rounded-xl text-stone-900 dark:text-white font-mono text-sm focus:outline-none transition-colors"
                />
              </div>
              <div className="flex gap-1.5 pt-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.handle}
                    type="button"
                    onClick={() => {
                      setHandle(p.handle);
                      setAsset(p.asset);
                      setAmount(p.amount);
                    }}
                    disabled={isTransmitting}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                      cleanHandle.toLowerCase() === p.handle
                        ? 'bg-[#E05326] text-white'
                        : 'bg-stone-100 dark:bg-stone-900 text-stone-500 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    @{p.handle}
                  </button>
                ))}
              </div>
            </div>

            {/* Asset Selector */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400 font-bold">
                Asset
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {['USDC', 'NEAR', 'SOL', 'BTC'].map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setAsset(sym)}
                    disabled={isTransmitting}
                    className={`py-2.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer text-center ${
                      asset === sym
                        ? 'bg-black text-white dark:bg-white dark:text-black'
                        : 'bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-500 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount Selector */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400 font-bold">
                Amount (USD)
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {['100', '500', '1,000', '5,000'].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmount(val)}
                    disabled={isTransmitting}
                    className={`py-2.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer text-center ${
                      amount === val
                        ? 'bg-black text-white dark:bg-white dark:text-black'
                        : 'bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-500 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    ${val}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ========================================================= */}
          {/* ANIMATED BEAM CANVAS (TOPOLOGICAL MULTI-BEAM ROUTER)      */}
          {/* ========================================================= */}
          <div className="relative w-full rounded-2xl bg-black border border-stone-800 p-3 sm:p-6 select-none overflow-hidden">
            <svg
              viewBox="0 0 760 300"
              className="w-full h-auto overflow-visible select-none"
            >
              {/* ------------------------------------------------------------- */}
              {/* CONDUIT PATHS: LEFT INGRESS SOURCES -> CENTRAL UPRAIL HUB      */}
              {/* ------------------------------------------------------------- */}
              {/* Path 1: Top Ingress (@handle) -> Center Hub */}
              <path
                d="M 170 60 C 270 60, 270 150, 330 150"
                fill="none"
                stroke="#241914"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Path 2: Middle Ingress (EVM/Solana) -> Center Hub */}
              <path
                d="M 170 150 L 330 150"
                fill="none"
                stroke="#241914"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Path 3: Bottom Ingress (Bitcoin/UTXO) -> Center Hub */}
              <path
                d="M 170 240 C 270 240, 270 150, 330 150"
                fill="none"
                stroke="#241914"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* ------------------------------------------------------------- */}
              {/* CONDUIT PATHS: CENTRAL UPRAIL HUB -> RIGHT SETTLEMENT NODES   */}
              {/* ------------------------------------------------------------- */}
              {/* Path 4: Center Hub -> near.com Wallet */}
              <path
                d="M 430 150 C 490 150, 490 95, 590 95"
                fill="none"
                stroke="#12261C"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Path 5: Center Hub -> Hardware Passkey */}
              <path
                d="M 430 150 C 490 150, 490 205, 590 205"
                fill="none"
                stroke="#12261C"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* ------------------------------------------------------------- */}
              {/* ACTIVE TACTILE BEAMS (When Triggered or Simulating)          */}
              {/* ------------------------------------------------------------- */}
              {activeStep !== 'idle' && (
                <>
                  {/* Beam 1: Ingress Wave (Solid Burnt-Orange) */}
                  <motion.path
                    d="M 170 60 C 270 60, 270 150, 330 150"
                    fill="none"
                    stroke="#E05326"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: [0, 1] }}
                    transition={{ duration: 0.8, ease: 'easeInOut' }}
                  />
                  <motion.path
                    d="M 170 150 L 330 150"
                    fill="none"
                    stroke="#E05326"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: [0, 1] }}
                    transition={{ duration: 0.8, delay: 0.1, ease: 'easeInOut' }}
                  />
                  <motion.path
                    d="M 170 240 C 270 240, 270 150, 330 150"
                    fill="none"
                    stroke="#E05326"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: [0, 1] }}
                    transition={{ duration: 0.8, delay: 0.2, ease: 'easeInOut' }}
                  />

                  {/* Beam 2: Settlement Waves (Solid NEAR Green) */}
                  {(activeStep === 'shield' || activeStep === 'settled') && (
                    <>
                      <motion.path
                        d="M 430 150 C 490 150, 490 95, 590 95"
                        fill="none"
                        stroke="#00EC97"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: [0, 1] }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                      />
                      <motion.path
                        d="M 430 150 C 490 150, 490 205, 590 205"
                        fill="none"
                        stroke="#00EC97"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: [0, 1] }}
                        transition={{ duration: 0.8, delay: 0.15, ease: 'easeOut' }}
                      />
                    </>
                  )}
                </>
              )}

              {/* ------------------------------------------------------------- */}
              {/* LEFT COLUMN: 3 INGRESS NODES                                  */}
              {/* ------------------------------------------------------------- */}
              {/* Node 1: @handle */}
              <g transform="translate(100, 60)">
                <rect x="-80" y="-22" width="150" height="44" rx="10" fill="#140D0B" stroke="#E05326" strokeWidth="1.5" />
                <text x="-65" y="-3" fill="#FFB69E" fontFamily="monospace" fontSize="10" fontWeight="bold">
                  @{cleanHandle}
                </text>
                <text x="-65" y="11" fill="#E05326" fontFamily="monospace" fontSize="8" fontWeight="bold">
                  UNIVERSAL INGRESS
                </text>
                <circle cx="50" cy="0" r="5" fill="#E05326" />
              </g>

              {/* Node 2: EVM / SVM (USDC, SOL) */}
              <g transform="translate(100, 150)">
                <rect x="-80" y="-22" width="150" height="44" rx="10" fill="#140D0B" stroke="#3A2820" strokeWidth="1.5" />
                <text x="-65" y="-3" fill="#E7D8D0" fontFamily="monospace" fontSize="10" fontWeight="bold">
                  {asset} Cross-Chain
                </text>
                <text x="-65" y="11" fill="#8C7368" fontFamily="monospace" fontSize="8">
                  35+ BLOCKCHAINS
                </text>
                <circle cx="50" cy="0" r="5" fill="#E05326" opacity="0.6" />
              </g>

              {/* Node 3: Bitcoin SegWit / UTXO */}
              <g transform="translate(100, 240)">
                <rect x="-80" y="-22" width="150" height="44" rx="10" fill="#140D0B" stroke="#3A2820" strokeWidth="1.5" />
                <text x="-65" y="-3" fill="#E7D8D0" fontFamily="monospace" fontSize="10" fontWeight="bold">
                  Native UTXO / SVM
                </text>
                <text x="-65" y="11" fill="#8C7368" fontFamily="monospace" fontSize="8">
                  ZERO EXPIRING QUOTES
                </text>
                <circle cx="50" cy="0" r="5" fill="#E05326" opacity="0.6" />
              </g>

              {/* ------------------------------------------------------------- */}
              {/* CENTER HUB: UPRAIL CONFIDENTIAL SOLVER                        */}
              {/* ------------------------------------------------------------- */}
              <g transform="translate(380, 150)">
                {/* Rotating Enclave Shield Rings */}
                <motion.circle
                  r="48"
                  fill="none"
                  stroke="#00EC97"
                  strokeWidth="1.5"
                  strokeDasharray="6 4"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
                />
                <motion.circle
                  r="40"
                  fill="none"
                  stroke="#E05326"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  animate={{ rotate: -360 }}
                  transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                />
                {/* Hub Chassis */}
                <circle r="34" fill="#0A1812" stroke="#00EC97" strokeWidth="2.5" />
                <text y="-7" textAnchor="middle" fill="#A7F3D0" fontFamily="monospace" fontSize="8" fontWeight="bold">
                  intents.near
                </text>
                <text y="5" textAnchor="middle" fill="#00EC97" fontFamily="monospace" fontSize="9.5" fontWeight="black">
                  NEP-518
                </text>
                <text y="16" textAnchor="middle" fill="#E05326" fontFamily="monospace" fontSize="7" fontWeight="bold">
                  CONFIDENTIAL
                </text>
              </g>

              {/* ------------------------------------------------------------- */}
              {/* RIGHT COLUMN: 2 SETTLEMENT DESTINATION NODES                  */}
              {/* ------------------------------------------------------------- */}
              {/* Destination Node 1: near.com Personal Wallet */}
              <g transform="translate(660, 95)">
                <rect
                  x="-70"
                  y="-22"
                  width="150"
                  height="44"
                  rx="10"
                  fill="#081810"
                  stroke={activeStep === 'settled' ? '#00EC97' : '#1A3324'}
                  strokeWidth="1.5"
                />
                <circle cx="-55" cy="0" r="5" fill="#00EC97" />
                <text x="-42" y="-3" fill="#A7F3D0" fontFamily="monospace" fontSize="10" fontWeight="bold">
                  near.com Wallet
                </text>
                <text x="-42" y="11" fill="#00EC97" fontFamily="monospace" fontSize="7.5" fontWeight="bold">
                  nearcom:0x... RECEPTACLE
                </text>
              </g>

              {/* Destination Node 2: Hardware Passkey Claim */}
              <g transform="translate(660, 205)">
                <rect
                  x="-70"
                  y="-22"
                  width="150"
                  height="44"
                  rx="10"
                  fill="#081810"
                  stroke={activeStep === 'settled' ? '#00EC97' : '#1A3324'}
                  strokeWidth="1.5"
                />
                <circle cx="-55" cy="0" r="5" fill="#00EC97" />
                <text x="-42" y="-3" fill="#A7F3D0" fontFamily="monospace" fontSize="10" fontWeight="bold">
                  Hardware Passkey
                </text>
                <text x="-42" y="11" fill="#85D1A9" fontFamily="monospace" fontSize="7.5">
                  TOUCH ID / FACE ID
                </text>
              </g>
            </svg>
          </div>

          {/* Tactile Action Trigger & Kinetic Telemetry */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
            <div className="flex items-center space-x-3 text-xs font-mono text-stone-500">
              <span>Payload: <strong className="text-black dark:text-white font-bold">${amount} {asset}</strong></span>
              <span>·</span>
              <span>Shield: <strong className="text-[#00EC97] font-bold">100% Confidential</strong></span>
              <span>·</span>
              <span>Status: <strong className={
                activeStep === 'settled'
                  ? 'text-[#00EC97]'
                  : isTransmitting
                    ? 'text-[#E05326] animate-pulse'
                    : 'text-stone-400'
              }>
                {activeStep === 'settled' ? 'SETTLED IN near.com' : activeStep === 'shield' ? 'NEP-518 RELAY ACTIVE' : activeStep === 'ingress' ? 'INGRESS BEAMING' : 'READY TO TRANSMIT'}
              </strong></span>
            </div>

            {/* Tactile Kinetic Fire Button */}
            <motion.button
              type="button"
              onClick={triggerBeam}
              disabled={isTransmitting}
              whileTap={{ scale: 0.96 }}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-black dark:bg-white text-white dark:text-black font-display font-extrabold text-xs uppercase tracking-wider shadow-sm hover:scale-105 active:scale-95 transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <Zap className={`w-4 h-4 text-[#E05326] ${isTransmitting ? 'animate-bounce' : ''}`} />
              <span>{isTransmitting ? 'Beaming Value...' : 'Engage Confidential Beam'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
};
