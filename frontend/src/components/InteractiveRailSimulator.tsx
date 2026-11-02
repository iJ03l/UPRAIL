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
  const [activeStep, setActiveStep] = useState<'idle' | 'ingress' | 'shield' | 'received' | 'settled'>('idle');

  const cleanHandle = handle.replace(/^@/, '').trim() || 'illia';

  const triggerBeam = () => {
    if (activeStep !== 'idle' && activeStep !== 'settled') return;
    setActiveStep('ingress');

    setTimeout(() => {
      setActiveStep('shield');
      setTimeout(() => {
        setActiveStep('received');
        setTimeout(() => {
          setActiveStep('settled');
        }, 800);
      }, 900);
    }, 800);
  };

  const isTransmitting = activeStep !== 'idle' && activeStep !== 'settled';

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
            Send from any blockchain into a recipient&apos;s 𝕏 handle—settling confidentially with instant routing into near.com or any external chain wallet.
          </p>
        </div>

        {/* The Tactile Simulator Chassis */}
        <div className="rounded-3xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#110D0B] p-5 sm:p-8 space-y-6 shadow-sm">
          {/* Controls Bar: Target Handle, Asset & Amount */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-6 border-b border-stone-200 dark:border-stone-800">
            {/* Target 𝕏 Handle */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400 font-bold">
                Recipient 𝕏 Handle
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
                Source Asset
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
                Transfer Amount
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
          {/* ANIMATED BEAM CANVAS: SENDER -> SQUARE HUB -> @HANDLE     */}
          {/* ========================================================= */}
          <div className="relative w-full rounded-2xl bg-black border border-stone-800 p-3 sm:p-6 select-none overflow-hidden">
            <svg
              viewBox="0 0 880 340"
              className="w-full h-auto overflow-visible select-none"
            >
              {/* ------------------------------------------------------------- */}
              {/* INGRESS CONDUITS: SENDER SOURCES -> SQUARE UPRAIL SOLVER HUB   */}
              {/* ------------------------------------------------------------- */}
              {/* Path 1: Top Sender (35+ Chains) -> Square Hub */}
              <path
                d="M 160 70 C 270 70, 270 170, 320 170"
                fill="none"
                stroke="#241914"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Path 2: Middle Sender (AI Chat) -> Square Hub */}
              <path
                d="M 160 170 L 320 170"
                fill="none"
                stroke="#241914"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Path 3: Bottom Sender (Creator Fees) -> Square Hub */}
              <path
                d="M 160 270 C 270 270, 270 170, 320 170"
                fill="none"
                stroke="#241914"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* ------------------------------------------------------------- */}
              {/* EGRESS CONDUIT: SQUARE HUB -> RECIPIENT @HANDLE               */}
              {/* ------------------------------------------------------------- */}
              <path
                d="M 420 170 L 490 170"
                fill="none"
                stroke="#12261C"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* ------------------------------------------------------------- */}
              {/* WITHDRAWAL CONDUITS: @HANDLE -> NEAR.COM / ANY CHAIN / PASSKEY*/}
              {/* ------------------------------------------------------------- */}
              {/* Path 5: @handle -> near.com Wallet */}
              <path
                d="M 640 170 C 690 170, 690 80, 740 80"
                fill="none"
                stroke="#12261C"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Path 6: @handle -> Wallet on Any Chain */}
              <path
                d="M 640 170 L 740 170"
                fill="none"
                stroke="#12261C"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Path 7: @handle -> Hardware Passkey Ground */}
              <path
                d="M 640 170 C 690 170, 690 260, 740 260"
                fill="none"
                stroke="#12261C"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* ------------------------------------------------------------- */}
              {/* ACTIVE KINETIC BEAMS (When Firing / In-Flight)                 */}
              {/* ------------------------------------------------------------- */}
              {activeStep !== 'idle' && (
                <>
                  {/* Phase 1: Ingress Beams to Square Hub */}
                  <motion.path
                    d="M 160 70 C 270 70, 270 170, 320 170"
                    fill="none"
                    stroke="#E05326"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: [0, 1] }}
                    transition={{ duration: 0.7, ease: 'easeInOut' }}
                  />
                  <motion.path
                    d="M 160 170 L 320 170"
                    fill="none"
                    stroke="#E05326"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: [0, 1] }}
                    transition={{ duration: 0.7, delay: 0.1, ease: 'easeInOut' }}
                  />
                  <motion.path
                    d="M 160 270 C 270 270, 270 170, 320 170"
                    fill="none"
                    stroke="#E05326"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: [0, 1] }}
                    transition={{ duration: 0.7, delay: 0.2, ease: 'easeInOut' }}
                  />

                  {/* Phase 2: Square Hub -> Recipient @handle */}
                  {(activeStep === 'shield' || activeStep === 'received' || activeStep === 'settled') && (
                    <motion.path
                      d="M 420 170 L 490 170"
                      fill="none"
                      stroke="#00EC97"
                      strokeWidth="4"
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: [0, 1] }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  )}

                  {/* Phase 3: Recipient @handle -> near.com & Any Chain Outlets */}
                  {(activeStep === 'received' || activeStep === 'settled') && (
                    <>
                      <motion.path
                        d="M 640 170 C 690 170, 690 80, 740 80"
                        fill="none"
                        stroke="#00EC97"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: [0, 1] }}
                        transition={{ duration: 0.7, ease: 'easeOut' }}
                      />
                      <motion.path
                        d="M 640 170 L 740 170"
                        fill="none"
                        stroke="#00EC97"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: [0, 1] }}
                        transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
                      />
                      <motion.path
                        d="M 640 170 C 690 170, 690 260, 740 260"
                        fill="none"
                        stroke="#00EC97"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: [0, 1] }}
                        transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
                      />
                    </>
                  )}
                </>
              )}

              {/* ------------------------------------------------------------- */}
              {/* LEFT COLUMN: 3 SENDER INGRESS NODES                           */}
              {/* ------------------------------------------------------------- */}
              {/* Sender 1: 35+ Blockchains */}
              <g transform="translate(90, 70)">
                <rect x="-75" y="-22" width="145" height="44" rx="8" fill="#140D0B" stroke="#E05326" strokeWidth="1.5" />
                <rect x="62" y="-4" width="8" height="8" rx="1.5" fill="#E05326" />
                <text x="-60" y="-3" fill="#FFB69E" fontFamily="monospace" fontSize="9.5" fontWeight="bold">
                  Sender (35+ Chains)
                </text>
                <text x="-60" y="11" fill="#E05326" fontFamily="monospace" fontSize="7.5" fontWeight="bold">
                  {asset} · EVM · SVM · UTXO
                </text>
              </g>

              {/* Sender 2: AI Chat / Agents */}
              <g transform="translate(90, 170)">
                <rect x="-75" y="-22" width="145" height="44" rx="8" fill="#140D0B" stroke="#3A2820" strokeWidth="1.5" />
                <rect x="62" y="-4" width="8" height="8" rx="1.5" fill="#E05326" opacity="0.6" />
                <text x="-60" y="-3" fill="#E7D8D0" fontFamily="monospace" fontSize="9.5" fontWeight="bold">
                  AI Chat &amp; MCP
                </text>
                <text x="-60" y="11" fill="#8C7368" fontFamily="monospace" fontSize="7.5">
                  CLAUDE · GROK · CURSOR
                </text>
              </g>

              {/* Sender 3: Creator Launchpad Fees */}
              <g transform="translate(90, 270)">
                <rect x="-75" y="-22" width="145" height="44" rx="8" fill="#140D0B" stroke="#3A2820" strokeWidth="1.5" />
                <rect x="62" y="-4" width="8" height="8" rx="1.5" fill="#E05326" opacity="0.6" />
                <text x="-60" y="-3" fill="#E7D8D0" fontFamily="monospace" fontSize="9.5" fontWeight="bold">
                  Launchpad Fees
                </text>
                <text x="-60" y="11" fill="#8C7368" fontFamily="monospace" fontSize="7.5">
                  RHEA · NEARLY · HOOT
                </text>
              </g>

              {/* ------------------------------------------------------------- */}
              {/* CENTER HUB: THE BRUTALIST SQUARE ENCLAVE (NEP-518 SOLVER)      */}
              {/* ------------------------------------------------------------- */}
              <g transform="translate(370, 170)">
                {/* Outer Rotating Square Brackets */}
                <motion.rect
                  x="-52"
                  y="-52"
                  width="104"
                  height="104"
                  rx="12"
                  fill="none"
                  stroke="#00EC97"
                  strokeWidth="1.5"
                  strokeDasharray="8 6"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
                />
                {/* Inner Counter-Rotating Square */}
                <motion.rect
                  x="-44"
                  y="-44"
                  width="88"
                  height="88"
                  rx="8"
                  fill="none"
                  stroke="#E05326"
                  strokeWidth="1"
                  strokeDasharray="5 4"
                  animate={{ rotate: -360 }}
                  transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
                />

                {/* Solid Dark Square Chassis */}
                <rect
                  x="-36"
                  y="-36"
                  width="72"
                  height="72"
                  rx="8"
                  fill="#0A1812"
                  stroke="#00EC97"
                  strokeWidth="2.5"
                />

                {/* Left and Right Square Coupling Pins */}
                <rect x="-40" y="-4" width="8" height="8" rx="1.5" fill="#E05326" />
                <rect x="32" y="-4" width="8" height="8" rx="1.5" fill="#00EC97" />

                {/* Square Hub Typography */}
                <text y="-8" textAnchor="middle" fill="#A7F3D0" fontFamily="monospace" fontSize="7.5" fontWeight="bold">
                  intents.near
                </text>
                <text y="5" textAnchor="middle" fill="#00EC97" fontFamily="monospace" fontSize="9" fontWeight="black">
                  NEP-518
                </text>
                <text y="17" textAnchor="middle" fill="#E05326" fontFamily="monospace" fontSize="6.5" fontWeight="bold">
                  SQUARE ENCLAVE
                </text>
              </g>

              {/* ------------------------------------------------------------- */}
              {/* CENTER-RIGHT: THE RECIPIENT 𝕏 HANDLE (THE RECEIVING END)       */}
              {/* ------------------------------------------------------------- */}
              <g transform="translate(565, 170)">
                <rect
                  x="-75"
                  y="-26"
                  width="150"
                  height="52"
                  rx="10"
                  fill="#120A07"
                  stroke={activeStep === 'received' || activeStep === 'settled' ? '#00EC97' : '#E05326'}
                  strokeWidth="2"
                />
                {/* Left & Right Pins */}
                <rect x="-79" y="-4" width="8" height="8" rx="1.5" fill="#00EC97" />
                <rect x="71" y="-4" width="8" height="8" rx="1.5" fill="#00EC97" />

                <text x="-60" y="-7" fill="#FFB69E" fontFamily="monospace" fontSize="10.5" fontWeight="black">
                  @{cleanHandle}
                </text>
                <text x="-60" y="7" fill={activeStep === 'received' || activeStep === 'settled' ? '#00EC97' : '#E05326'} fontFamily="monospace" fontSize="7.5" fontWeight="bold">
                  RECIPIENT GATEWAY
                </text>
                <text x="-60" y="18" fill="#8C7368" fontFamily="monospace" fontSize="6.5">
                  Zero KYC · Touch ID Claim
                </text>
              </g>

              {/* ------------------------------------------------------------- */}
              {/* RIGHT COLUMN: 3 WITHDRAWAL OUTLETS (AFTER RECEIVING AT @HANDLE)*/}
              {/* ------------------------------------------------------------- */}
              {/* Outlet 1: near.com Personal Wallet */}
              <g transform="translate(795, 80)">
                <rect
                  x="-65"
                  y="-20"
                  width="140"
                  height="40"
                  rx="8"
                  fill="#081810"
                  stroke={activeStep === 'settled' ? '#00EC97' : '#1A3324'}
                  strokeWidth="1.5"
                />
                <rect x="-69" y="-4" width="8" height="8" rx="1.5" fill="#00EC97" />
                <text x="-52" y="-3" fill="#A7F3D0" fontFamily="monospace" fontSize="9" fontWeight="bold">
                  near.com Wallet
                </text>
                <text x="-52" y="9" fill="#00EC97" fontFamily="monospace" fontSize="7" fontWeight="bold">
                  nearcom:0x... SOVEREIGN
                </text>
              </g>

              {/* Outlet 2: Wallet on Any Chain */}
              <g transform="translate(795, 170)">
                <rect
                  x="-65"
                  y="-20"
                  width="140"
                  height="40"
                  rx="8"
                  fill="#081810"
                  stroke={activeStep === 'settled' ? '#00EC97' : '#1A3324'}
                  strokeWidth="1.5"
                />
                <rect x="-69" y="-4" width="8" height="8" rx="1.5" fill="#00EC97" />
                <text x="-52" y="-3" fill="#A7F3D0" fontFamily="monospace" fontSize="9" fontWeight="bold">
                  Wallet on Any Chain
                </text>
                <text x="-52" y="9" fill="#85D1A9" fontFamily="monospace" fontSize="7">
                  SOL · BASE · BTC · ETH
                </text>
              </g>

              {/* Outlet 3: Hardware Passkey */}
              <g transform="translate(795, 260)">
                <rect
                  x="-65"
                  y="-20"
                  width="140"
                  height="40"
                  rx="8"
                  fill="#081810"
                  stroke={activeStep === 'settled' ? '#00EC97' : '#1A3324'}
                  strokeWidth="1.5"
                />
                <rect x="-69" y="-4" width="8" height="8" rx="1.5" fill="#00EC97" />
                <text x="-52" y="-3" fill="#A7F3D0" fontFamily="monospace" fontSize="9" fontWeight="bold">
                  Hardware Passkey
                </text>
                <text x="-52" y="9" fill="#85D1A9" fontFamily="monospace" fontSize="7">
                  TOUCH ID / FACE ID
                </text>
              </g>
            </svg>
          </div>

          {/* Tactile Action Trigger & Kinetic Telemetry */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
            <div className="flex items-center space-x-3 text-xs font-mono text-stone-500">
              <span>Sending: <strong className="text-black dark:text-white font-bold">${amount} {asset}</strong></span>
              <span>►</span>
              <span>Recipient: <strong className="text-[#E05326] font-bold">@{cleanHandle}</strong></span>
              <span>·</span>
              <span>Status: <strong className={
                activeStep === 'settled'
                  ? 'text-[#00EC97]'
                  : isTransmitting
                    ? 'text-[#E05326] animate-pulse'
                    : 'text-stone-400'
              }>
                {activeStep === 'settled' ? 'DELIVERED & ROUTED' : activeStep === 'received' ? 'RECEIVED AT @HANDLE' : activeStep === 'shield' ? 'NEP-518 SQUARE ENCLAVE' : activeStep === 'ingress' ? 'SENDER BEAMING' : 'READY TO TRANSMIT'}
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
              <span>{isTransmitting ? 'Beaming Value...' : 'Beam to @' + cleanHandle}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
};
