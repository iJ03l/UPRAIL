'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import {
  Zap,
  ArrowRight,
  ShieldCheck,
  Lock,
  ExternalLink,
  Radio,
  Fingerprint,
} from 'lucide-react';

const PRESETS = [
  { handle: 'satoshi', asset: 'BTC', amount: '1,000' },
  { handle: 'illia', asset: 'NEAR', amount: '500' },
  { handle: 'mert', asset: 'SOL', amount: '250' },
];

const ASSETS = ['USDC', 'NEAR', 'SOL', 'BTC'];

export const InteractiveRailSimulator: React.FC = () => {
  const [handle, setHandle] = useState('illia');
  const [asset, setAsset] = useState('USDC');
  const [amount, setAmount] = useState('500');
  const [isBeaming, setIsBeaming] = useState(false);
  const [isCharged, setIsCharged] = useState(false);

  const cleanHandle = handle.replace(/^@/, '').trim() || 'illia';

  const triggerBeam = () => {
    if (isBeaming) return;
    setIsBeaming(true);
    setIsCharged(false);

    setTimeout(() => {
      setIsCharged(true);
      setTimeout(() => {
        setIsBeaming(false);
      }, 1800);
    }, 1200);
  };

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
            A tactile intent beam connecting any sender directly into a private near.com wallet.
          </p>
        </div>

        {/* The Tactile Simulator Chassis */}
        <div className="rounded-3xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#110D0B] p-6 sm:p-8 space-y-8 shadow-sm">
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
                {ASSETS.map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setAsset(sym)}
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
          {/* THE TACTILE BEAM ARENA: KINETIC SVG PHYSICAL CONDUIT      */}
          {/* ========================================================= */}
          <div className="relative w-full rounded-2xl bg-black border border-stone-800 p-4 sm:p-8 overflow-hidden select-none">
            <svg
              viewBox="0 0 680 180"
              className="w-full h-auto overflow-visible select-none"
            >
              {/* Conduit Background Vacuum Track */}
              <line
                x1="80"
                y1="90"
                x2="600"
                y2="90"
                stroke="#181412"
                strokeWidth="14"
                strokeLinecap="round"
              />
              <line
                x1="80"
                y1="90"
                x2="600"
                y2="90"
                stroke="#2C221D"
                strokeWidth="2"
                strokeDasharray="4 4"
                strokeLinecap="round"
              />

              {/* TACTILE BEAM CORE (Active when Beaming) */}
              {isBeaming && (
                <>
                  {/* Glowing Solid Beam Ray */}
                  <motion.line
                    x1="80"
                    y1="90"
                    x2="600"
                    y2="90"
                    stroke="#E05326"
                    strokeWidth="6"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                  {/* Internal Green Hyper-Beam */}
                  <motion.line
                    x1="340"
                    y1="90"
                    x2="600"
                    y2="90"
                    stroke="#00EC97"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8, delay: 0.4, ease: 'easeOut' }}
                  />

                  {/* High-speed Kinetic Pulse Packets */}
                  {[0, 0.25, 0.5, 0.75].map((delay, idx) => (
                    <motion.circle
                      key={idx}
                      r="5"
                      fill={idx % 2 === 0 ? '#E05326' : '#00EC97'}
                      cy="90"
                      initial={{ cx: 80 }}
                      animate={{ cx: [80, 340, 600] }}
                      transition={{
                        duration: 1.2,
                        repeat: Infinity,
                        delay: delay,
                        ease: 'linear',
                      }}
                    />
                  ))}
                </>
              )}

              {/* 1. EMITTER NODE: @HANDLE (Left) */}
              <g transform="translate(80, 90)">
                <motion.circle
                  r="34"
                  fill="#140D0B"
                  stroke="#E05326"
                  strokeWidth="2.5"
                  animate={isBeaming ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 0.3, repeat: isBeaming ? Infinity : 0 }}
                />
                <text y="-4" textAnchor="middle" fill="#FFB69E" fontFamily="monospace" fontSize="10.5" fontWeight="bold">
                  @{cleanHandle}
                </text>
                <text y="11" textAnchor="middle" fill="#E05326" fontFamily="monospace" fontSize="8" fontWeight="bold">
                  EMITTER
                </text>

                {/* Emitter Kinetic Ring */}
                <motion.circle
                  r="40"
                  fill="none"
                  stroke="#E05326"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                />
              </g>

              {/* 2. NEP-518 INTENT PRISM: ZERO-KNOWLEDGE CONVERTER (Center) */}
              <g transform="translate(340, 90)">
                <motion.circle
                  r="32"
                  fill="#0A1812"
                  stroke="#00EC97"
                  strokeWidth="2"
                  animate={isBeaming ? { scale: [1, 1.15, 1] } : {}}
                  transition={{ duration: 0.4, repeat: isBeaming ? Infinity : 0 }}
                />
                <text y="-4" textAnchor="middle" fill="#A7F3D0" fontFamily="monospace" fontSize="9" fontWeight="bold">
                  NEP-518
                </text>
                <text y="10" textAnchor="middle" fill="#00EC97" fontFamily="monospace" fontSize="7.5" fontWeight="black">
                  PRISM
                </text>

                {/* Rotating Shield Ring */}
                <motion.circle
                  r="40"
                  fill="none"
                  stroke="#00EC97"
                  strokeWidth="1"
                  strokeDasharray="6 4"
                  animate={{ rotate: -360 }}
                  transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
                />
              </g>

              {/* 3. RECEIVER RECEPTACLE: near.com SOVEREIGN SOCKET (Right) */}
              <g transform="translate(600, 90)">
                <motion.circle
                  r="34"
                  fill="#061C14"
                  stroke={isCharged ? '#00EC97' : '#2A3C34'}
                  strokeWidth="2.5"
                  animate={isCharged ? { scale: [1, 1.18, 1] } : {}}
                  transition={{ duration: 0.5 }}
                />
                <text y="-4" textAnchor="middle" fill={isCharged ? '#A7F3D0' : '#4E6B5E'} fontFamily="monospace" fontSize="10.5" fontWeight="bold">
                  near.com
                </text>
                <text y="11" textAnchor="middle" fill={isCharged ? '#00EC97' : '#4E6B5E'} fontFamily="monospace" fontSize="8" fontWeight="bold">
                  SOCKET
                </text>

                {/* Receiver Lock Latch */}
                <motion.circle
                  r="40"
                  fill="none"
                  stroke={isCharged ? '#00EC97' : '#2A3C34'}
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  animate={isCharged ? { rotate: 360 } : {}}
                  transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                />
              </g>
            </svg>
          </div>

          {/* Tactile Action Trigger & Kinetic Telemetry */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
            <div className="flex items-center space-x-3 text-xs font-mono text-stone-500">
              <span>Payload: <strong className="text-black dark:text-white font-bold">{amount} {asset}</strong></span>
              <span>·</span>
              <span>Shield: <strong className="text-[#00EC97] font-bold">100% Zero-Loss</strong></span>
              <span>·</span>
              <span>Status: <strong className={isCharged ? 'text-[#00EC97]' : isBeaming ? 'text-[#E05326] animate-pulse' : 'text-stone-400'}>
                {isCharged ? 'LOCKED & DELIVERED' : isBeaming ? 'BEAMING PACKETS' : 'STANDBY'}
              </strong></span>
            </div>

            {/* Tactile Kinetic Fire Button */}
            <motion.button
              type="button"
              onClick={triggerBeam}
              disabled={isBeaming}
              whileTap={{ scale: 0.96 }}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-black dark:bg-white text-white dark:text-black font-display font-extrabold text-xs uppercase tracking-wider shadow-sm hover:scale-105 active:scale-95 transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <Zap className={`w-4 h-4 text-[#E05326] ${isBeaming ? 'animate-bounce' : ''}`} />
              <span>{isBeaming ? 'Beaming Value...' : 'Fire Tactile Beam'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
};
