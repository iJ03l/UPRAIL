'use client';

import React, { useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ExternalLink,
  Fingerprint,
  Lock,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { SolidCoffeeIcon } from './CoffeeModal';

interface CapabilitiesCarouselProps {
  appSubdomainUrl: string;
}

const COFFEE_BEANS = [
  { id: 'near', label: '1 NEAR', chain: 'NEAR', out: '~$3.55 USDC', fill: '#E05326' },
  { id: 'usdc', label: '5 USDC', chain: 'Base', out: '4.95 USDC', fill: '#C87632' },
  { id: 'sol', label: '0.02 SOL', chain: 'Solana', out: '~$4.10 USDC', fill: '#9A4D23' },
] as const;

const CAPABILITY_TABS = [
  { num: '01', short: 'Requests' },
  { num: '02', short: 'AI Chat' },
  { num: '03', short: 'Creator Fees' },
  { num: '04', short: 'Coffee Link' },
] as const;

const SLIDE_EASE = [0.22, 1, 0.36, 1] as const;

export const CapabilitiesCarousel: React.FC<CapabilitiesCarouselProps> = ({
  appSubdomainUrl,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [selectedBean, setSelectedBean] = useState<string>('near');
  const shouldReduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start start', 'end end'],
  });

  const progressScale = useTransform(scrollYProgress, [0, 1], [0.25, 1]);

  useMotionValueEvent(scrollYProgress, 'change', (latest) => {
    const nextIdx = Math.min(3, Math.max(0, Math.floor(latest * 4)));
    setActiveIndex((prev) => {
      if (prev === nextIdx) return prev;
      setDirection(nextIdx > prev ? 1 : -1);
      return nextIdx;
    });
  });

  const scrollToStep = (index: number) => {
    const clamped = Math.min(3, Math.max(0, index));
    if (!trackRef.current) {
      setDirection(clamped >= activeIndex ? 1 : -1);
      setActiveIndex(clamped);
      return;
    }
    const rect = trackRef.current.getBoundingClientRect();
    const trackTop = window.scrollY + rect.top;
    const scrollable = Math.max(1, trackRef.current.offsetHeight - window.innerHeight);
    // Aim neatly inside the middle of the target bucket so boundaries never flicker.
    const targetProgress = (clamped + 0.45) / 4;
    const targetY =
      clamped === 0
        ? trackTop + 4
        : clamped === 3
          ? trackTop + scrollable - 4
          : trackTop + targetProgress * scrollable;

    setDirection(clamped >= activeIndex ? 1 : -1);
    setActiveIndex(clamped);
    window.scrollTo({ top: targetY, behavior: shouldReduceMotion ? 'auto' : 'smooth' });
  };

  const activeBean =
    COFFEE_BEANS.find((b) => b.id === selectedBean) || COFFEE_BEANS[0];

  const slideVariants = {
    enter: (dir: number) =>
      shouldReduceMotion
        ? { opacity: 0 }
        : {
            x: dir >= 0 ? 64 : -64,
            scale: 0.96,
            opacity: 0,
          },
    center: {
      x: 0,
      scale: 1,
      opacity: 1,
      transition: { duration: shouldReduceMotion ? 0.18 : 0.36, ease: SLIDE_EASE },
    },
    exit: (dir: number) =>
      shouldReduceMotion
        ? { opacity: 0, transition: { duration: 0.15 } }
        : {
            x: dir >= 0 ? -64 : 64,
            scale: 0.96,
            opacity: 0,
            transition: { duration: 0.24, ease: SLIDE_EASE },
          },
  };

  return (
    <section
      id="capabilities"
      ref={trackRef}
      className="relative w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-20 min-h-[250vh] sm:min-h-[280vh]"
    >
      <div className="sticky top-20 sm:top-24 py-4 sm:py-6 flex flex-col justify-center space-y-5">
        {/* Top Header + Step Navigation Pills */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <span className="text-xs sm:text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
              // Capabilities · {CAPABILITY_TABS[activeIndex].num} / 04
            </span>
            <h2 className="text-2xl sm:text-4xl font-display font-extrabold tracking-tight text-stone-950 dark:text-white leading-[1.06]">
              Four private ways value moves.
            </h2>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1 p-1 rounded-2xl bg-stone-100/90 dark:bg-stone-900/90 border border-stone-200 dark:border-stone-800 backdrop-blur-sm">
              {CAPABILITY_TABS.map((tab, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={tab.num}
                    type="button"
                    onClick={() => scrollToStep(idx)}
                    className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] font-mono font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                      isActive
                        ? idx === 3
                          ? 'bg-[#E05326] text-white shadow-xs'
                          : 'bg-stone-950 text-white dark:bg-white dark:text-stone-950 shadow-xs'
                        : 'text-stone-500 hover:text-stone-950 dark:hover:text-white'
                    }`}
                  >
                    <span className="opacity-70">{tab.num}</span>
                    <span className="hidden md:inline">{tab.short}</span>
                  </button>
                );
              })}
            </div>

            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous capability"
                disabled={activeIndex === 0}
                onClick={() => scrollToStep(activeIndex - 1)}
                className="w-8 h-8 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-700 dark:text-stone-200 disabled:opacity-35 flex items-center justify-center hover:border-stone-400 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Next capability"
                disabled={activeIndex === 3}
                onClick={() => scrollToStep(activeIndex + 1)}
                className="w-8 h-8 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-700 dark:text-stone-200 disabled:opacity-35 flex items-center justify-center hover:border-stone-400 transition-colors cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Continuous Scroll Progress Rail */}
        <div className="h-1 w-full rounded-full bg-stone-200/80 dark:bg-stone-800 overflow-hidden">
          <motion.div
            style={{ scaleX: progressScale, transformOrigin: '0% 50%' }}
            className="h-full w-full bg-[#E05326] rounded-full"
          />
        </div>

        {/* Centered Carousel Stage */}
        <div className="relative min-h-[500px] sm:min-h-[450px] lg:min-h-[440px] flex items-center justify-center overflow-hidden">
          <AnimatePresence mode="popLayout" custom={direction} initial={false}>
            {activeIndex === 0 && (
              <motion.div
                key="cap-01"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="w-full rounded-[2rem] bg-stone-950 text-white border border-stone-800 p-6 sm:p-9 lg:p-10 shadow-xl grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center"
              >
                <div className="lg:col-span-6 space-y-5 flex flex-col justify-between h-full">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono uppercase tracking-widest text-stone-400 font-bold">
                        01 / Payment Requests
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-stone-900 text-[#E05326] border border-stone-800 font-bold">
                        Voluntary
                      </span>
                    </div>

                    <h3 className="text-3xl sm:text-4xl lg:text-5xl font-display font-extrabold tracking-tight leading-[1.04]">
                      Request from anyone on 𝕏.
                    </h3>
                    <p className="text-sm sm:text-base text-stone-400 leading-relaxed max-w-md">
                      Invoices, freelance gigs, or dinner splits. Send a clean request link — they settle or decline with one biometric tap.
                    </p>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {['Voluntary', 'Zero Wallet', 'Biometric Tap', 'Zero Fees'].map((tag) => (
                        <span
                          key={tag}
                          className="px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-800 text-[11px] font-mono text-stone-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-stone-800/80 gap-3">
                    <a
                      href="https://docs.uprail.world/docs/requests"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-stone-400 hover:text-white transition-colors inline-flex items-center gap-1"
                    >
                      <span>Docs</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={`${appSubdomainUrl}/request`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-5 py-2.5 rounded-xl bg-white text-stone-950 hover:bg-stone-200 font-display font-extrabold text-xs uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>Request Money</span>
                      <ArrowDownLeft className="w-3.5 h-3.5 text-[#E05326]" />
                    </a>
                  </div>
                </div>

                {/* Illustration 01: Passkey Request Ticket */}
                <div className="lg:col-span-6 flex items-center justify-center">
                  <div className="w-full max-w-md rounded-2xl bg-stone-900/90 border border-stone-800 p-5 space-y-4 shadow-inner">
                    <div className="flex items-center justify-between text-[11px] font-mono text-stone-400">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                        <span>REQUEST · PASSKEY GATED</span>
                      </span>
                      <span>#REQ_84F2</span>
                    </div>

                    <div className="rounded-xl bg-black/60 border border-stone-800/80 p-4 flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-mono text-stone-500">@alex asks @mert</p>
                        <p className="text-2xl sm:text-3xl font-display font-black text-white mt-0.5 tabular-nums">
                          $45.00 <span className="text-sm font-mono text-stone-400">USDC</span>
                        </p>
                        <p className="text-[11px] font-mono text-stone-400 mt-1">
                          &ldquo;Design sprint dinner split&rdquo;
                        </p>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-[#E05326]/15 border border-[#E05326]/40 flex items-center justify-center text-[#E05326]">
                        <Fingerprint className="w-6 h-6" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono font-bold">
                      <div className="py-2.5 rounded-xl bg-stone-800/70 text-stone-400 text-center border border-stone-700/60">
                        Decline
                      </div>
                      <div className="py-2.5 rounded-xl bg-white text-stone-950 text-center flex items-center justify-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Tap to Settle</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeIndex === 1 && (
              <motion.div
                key="cap-02"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="w-full rounded-[2rem] bg-stone-100 dark:bg-stone-900 text-stone-950 dark:text-white border border-stone-200 dark:border-stone-800 p-6 sm:p-9 lg:p-10 shadow-xl grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center"
              >
                <div className="lg:col-span-6 space-y-5 flex flex-col justify-between h-full">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400 font-bold">
                        02 / AI Chat & MCP
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-200 border border-stone-200 dark:border-stone-700 font-bold">
                        1-Click MCP
                      </span>
                    </div>

                    <h3 className="text-3xl sm:text-4xl lg:text-5xl font-display font-extrabold tracking-tight leading-[1.04]">
                      Pay straight from any AI chat.
                    </h3>
                    <p className="text-sm sm:text-base text-stone-600 dark:text-stone-300 leading-relaxed max-w-md">
                      Give Claude, ChatGPT, or Cursor a passkey-signed spending cap in USD. Agents settle transfers privately without ever seeing your keys.
                    </p>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {['Claude', 'ChatGPT', 'Grok', 'Cursor'].map((tag) => (
                        <span
                          key={tag}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-[11px] font-mono text-stone-700 dark:text-stone-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-stone-200 dark:border-stone-800 gap-3">
                    <a
                      href="https://docs.uprail.world/docs/agents"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-white transition-colors inline-flex items-center gap-1"
                    >
                      <span>Docs</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={`${appSubdomainUrl}/agents`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-5 py-2.5 rounded-xl bg-stone-950 dark:bg-white text-white dark:text-stone-950 hover:bg-stone-800 dark:hover:bg-stone-200 font-display font-extrabold text-xs uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>Connect AI</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {/* Illustration 02: Scoped AI Session Terminal */}
                <div className="lg:col-span-6 flex items-center justify-center">
                  <div className="w-full max-w-md rounded-2xl bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 p-5 space-y-3.5 shadow-sm">
                    <div className="flex items-center justify-between text-[11px] font-mono text-stone-500">
                      <span className="inline-flex items-center gap-1.5 font-bold text-stone-900 dark:text-white">
                        <Bot className="w-3.5 h-3.5 text-[#E05326]" />
                        <span>MCP SESSION · OAUTH 2.1</span>
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold">
                        ACTIVE
                      </span>
                    </div>

                    <div className="rounded-xl bg-stone-950 text-stone-100 p-3.5 font-mono text-xs space-y-2">
                      <div className="flex items-center gap-2 text-stone-400">
                        <Terminal className="w-3.5 h-3.5 text-[#E05326]" />
                        <span>&ldquo;Tip @sara 12 USDC for the PR&rdquo;</span>
                      </div>
                      <div className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                        <Check className="w-3 h-3" />
                        <span>uprail.pay(@sara, $12.00) · Shielded</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-stone-500">
                        <span>Daily Cap Used</span>
                        <span className="font-bold text-stone-900 dark:text-white">$12 / $50 USD</span>
                      </div>
                      <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                        <div className="h-full w-1/4 rounded-full bg-[#E05326]" />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeIndex === 2 && (
              <motion.div
                key="cap-03"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="w-full rounded-[2rem] bg-stone-950 text-white border border-stone-800 p-6 sm:p-9 lg:p-10 shadow-xl grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center"
              >
                <div className="lg:col-span-6 space-y-5 flex flex-col justify-between h-full">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono uppercase tracking-widest text-stone-400 font-bold">
                        03 / Creator Fees
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-stone-900 text-[#E05326] border border-stone-800 font-bold">
                        Auto RPC
                      </span>
                    </div>

                    <h3 className="text-3xl sm:text-4xl lg:text-5xl font-display font-extrabold tracking-tight leading-[1.04]">
                      Route token fees straight to 𝕏.
                    </h3>
                    <p className="text-sm sm:text-base text-stone-400 leading-relaxed max-w-md">
                      Launch on any NEAR pad, point creator royalties to UPRAIL, and claim accumulated protocol fees confidentially by touch.
                    </p>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {['Nearly', 'JustHoot', 'Intear', 'Rhea Launchpad'].map((tag) => (
                        <span
                          key={tag}
                          className="px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-800 text-[11px] font-mono text-stone-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-stone-800/80 gap-3">
                    <a
                      href="https://docs.uprail.world/docs/fees"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-stone-400 hover:text-white transition-colors inline-flex items-center gap-1"
                    >
                      <span>Docs</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={`${appSubdomainUrl}/claim?view=fees`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-5 py-2.5 rounded-xl bg-white text-stone-950 hover:bg-stone-200 font-display font-extrabold text-xs uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>Collect Fees</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {/* Illustration 03: Launchpad Fee Conduit */}
                <div className="lg:col-span-6 flex items-center justify-center">
                  <div className="w-full max-w-md rounded-2xl bg-stone-900/90 border border-stone-800 p-5 space-y-4">
                    <svg
                      viewBox="0 0 360 150"
                      className="w-full h-auto"
                      aria-hidden="true"
                    >
                      {/* Incoming Launchpad Streams */}
                      <path
                        d="M 28 32 C 110 32, 120 75, 185 75"
                        fill="none"
                        stroke="#E05326"
                        strokeWidth="2.5"
                        strokeDasharray="6 6"
                      />
                      <path
                        d="M 28 75 L 185 75"
                        fill="none"
                        stroke="#34D399"
                        strokeWidth="2.5"
                        strokeDasharray="6 6"
                      />
                      <path
                        d="M 28 118 C 110 118, 120 75, 185 75"
                        fill="none"
                        stroke="#F59E0B"
                        strokeWidth="2.5"
                        strokeDasharray="6 6"
                      />

                      {/* Left Labels */}
                      <rect x="6" y="18" width="66" height="26" rx="8" fill="#18181B" stroke="#3F3F46" />
                      <text x="39" y="35" textAnchor="middle" fill="#E4E4E7" fontSize="10" fontFamily="monospace">
                        NEARLY
                      </text>
                      <rect x="6" y="62" width="66" height="26" rx="8" fill="#18181B" stroke="#3F3F46" />
                      <text x="39" y="79" textAnchor="middle" fill="#E4E4E7" fontSize="10" fontFamily="monospace">
                        HOOT
                      </text>
                      <rect x="6" y="106" width="66" height="26" rx="8" fill="#18181B" stroke="#3F3F46" />
                      <text x="39" y="123" textAnchor="middle" fill="#E4E4E7" fontSize="10" fontFamily="monospace">
                        INTEAR
                      </text>

                      {/* Router Node */}
                      <circle cx="195" cy="75" r="24" fill="#09090B" stroke="#E05326" strokeWidth="2.5" />
                      <text x="195" y="72" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="bold" fontFamily="monospace">
                        AUTO
                      </text>
                      <text x="195" y="84" textAnchor="middle" fill="#E05326" fontSize="9" fontWeight="bold" fontFamily="monospace">
                        RPC
                      </text>

                      {/* Outbound to Vault */}
                      <path d="M 219 75 L 270 75" fill="none" stroke="#FFFFFF" strokeWidth="2.5" />
                      <rect x="270" y="47" width="84" height="56" rx="14" fill="#FFFFFF" />
                      <text x="312" y="72" textAnchor="middle" fill="#09090B" fontSize="10" fontWeight="bold" fontFamily="monospace">
                        @creator
                      </text>
                      <text x="312" y="88" textAnchor="middle" fill="#059669" fontSize="10" fontWeight="bold" fontFamily="monospace">
                        Claimable
                      </text>
                    </svg>
                    <div className="flex items-center justify-between text-[11px] font-mono text-stone-400 border-t border-stone-800 pt-3">
                      <span>On-chain royalties routed automatically</span>
                      <span className="text-emerald-400 font-bold">Passkey Claim</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeIndex === 3 && (
              <motion.div
                key="cap-04"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="w-full rounded-[2rem] bg-[#FAF3E8] dark:bg-[#19120D] text-[#1E140E] dark:text-[#FAF3E8] border border-[#E5D6C0] dark:border-[#3B2B20] p-6 sm:p-9 lg:p-10 shadow-xl grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center"
              >
                {/* Left: Warm Editorial Storefront Story */}
                <div className="lg:col-span-6 space-y-5 flex flex-col justify-between h-full">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono uppercase tracking-widest text-[#8C522E] dark:text-[#E59D6B] font-bold inline-flex items-center gap-1.5">
                        <SolidCoffeeIcon className="w-3.5 h-3.5 text-[#E05326]" />
                        <span>04 / Buy Me a Coffee</span>
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#E05326]/12 text-[#C84218] dark:text-[#FF855E] border border-[#E05326]/25 font-bold inline-flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" />
                        <span>Bio Link Storefront</span>
                      </span>
                    </div>

                    <h3 className="text-3xl sm:text-4xl lg:text-5xl font-display font-extrabold tracking-tight leading-[1.04]">
                      One coffee link in your 𝕏 bio.
                    </h3>
                    <p className="text-sm sm:text-base text-[#5C493C] dark:text-[#CEBEB0] leading-relaxed max-w-md">
                      Share{' '}
                      <span className="font-mono font-bold text-[#1E140E] dark:text-white underline decoration-[#E05326] decoration-2 underline-offset-4">
                        uprail.world/you
                      </span>
                      . Fans or AI agents send exact tokens from 35+ chains with zero sign-in — brewed straight into your private vault.
                    </p>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {['Zero Sign-In', 'Token-First Input', 'Private Settlement', 'Agent-Readable'].map((tag) => (
                        <span
                          key={tag}
                          className="px-2.5 py-1 rounded-lg bg-[#F1E6D6] dark:bg-[#271C15] border border-[#DFCEB5] dark:border-[#463326] text-[11px] font-mono text-[#4A372B] dark:text-[#E2D2C3]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-[#E5D6C0] dark:border-[#3B2B20] gap-3">
                    <a
                      href="https://docs.uprail.world"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-[#7C6352] hover:text-[#1E140E] dark:text-[#BBA798] dark:hover:text-white transition-colors inline-flex items-center gap-1"
                    >
                      <span>Docs</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={appSubdomainUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-5 py-2.5 rounded-xl bg-[#1E140E] dark:bg-[#FAF3E8] text-[#FAF3E8] dark:text-[#1E140E] hover:opacity-90 font-display font-extrabold text-xs uppercase tracking-wider inline-flex items-center gap-1.5 transition-opacity shadow-sm"
                    >
                      <SolidCoffeeIcon className="w-3.5 h-3.5 text-[#E05326]" />
                      <span>Create Coffee Link</span>
                    </a>
                  </div>
                </div>

                {/* Right: Illustrative Interactive Privacy Espresso Press + Thermal Receipt */}
                <div className="lg:col-span-6 flex flex-col items-center justify-center space-y-3">
                  {/* Clickable Token Beans Hopper */}
                  <div className="inline-flex items-center gap-1.5 p-1 rounded-full bg-[#EFE2CF] dark:bg-[#271C15] border border-[#DFCEB5] dark:border-[#463326]">
                    {COFFEE_BEANS.map((bean) => {
                      const active = bean.id === activeBean.id;
                      return (
                        <button
                          key={bean.id}
                          type="button"
                          onClick={() => setSelectedBean(bean.id)}
                          className={`px-3 py-1 rounded-full text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#1E140E] text-[#FAF3E8] dark:bg-[#E05326] dark:text-white shadow-xs'
                              : 'text-[#6A5445] dark:text-[#C5B3A3] hover:text-[#1E140E]'
                          }`}
                        >
                          {bean.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Pour-Over + Perforated Receipt Artwork */}
                  <div className="w-full max-w-md grid grid-cols-2 gap-2.5 sm:gap-3 items-stretch">
                    {/* Left Half: Custom SVG Pour-Over & Mug */}
                    <div className="rounded-2xl bg-[#F3E8D7] dark:bg-[#251A13] border border-[#E0CFB8] dark:border-[#413024] p-2.5 sm:p-4 flex flex-col items-center justify-center relative overflow-hidden">
                      <svg
                        viewBox="0 0 180 175"
                        className="w-28 sm:w-40 h-auto"
                        aria-hidden="true"
                      >
                        {/* Animated Steam Wisps */}
                        <motion.path
                          d="M 70 30 Q 64 18, 72 8"
                          fill="none"
                          stroke="#C87632"
                          strokeWidth="2"
                          strokeLinecap="round"
                          animate={shouldReduceMotion ? undefined : { opacity: [0.25, 0.75, 0.25], y: [2, -4, 2] }}
                          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        <motion.path
                          d="M 106 28 Q 112 16, 104 6"
                          fill="none"
                          stroke="#C87632"
                          strokeWidth="2"
                          strokeLinecap="round"
                          animate={shouldReduceMotion ? undefined : { opacity: [0.65, 0.2, 0.65], y: [-2, 3, -2] }}
                          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                        />

                        {/* Pour-Over Cone Dripper (Origin Chain Token) */}
                        <path
                          d="M 54 34 L 126 34 L 100 72 L 80 72 Z"
                          fill="#FFFFFF"
                          stroke="#3B281E"
                          strokeWidth="2.5"
                          strokeLinejoin="round"
                        />
                        <text
                          x="90"
                          y="52"
                          textAnchor="middle"
                          fill="#3B281E"
                          fontSize="10"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {activeBean.chain}
                        </text>

                        {/* Privacy Mesh Filter Ring */}
                        <rect
                          x="62"
                          y="70"
                          width="56"
                          height="16"
                          rx="8"
                          fill="#1E140E"
                        />
                        <text
                          x="90"
                          y="81"
                          textAnchor="middle"
                          fill="#FAF3E8"
                          fontSize="7.5"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          SHIELD FILTER
                        </text>

                        {/* Brew Stream */}
                        <motion.line
                          x1="90"
                          y1="86"
                          x2="90"
                          y2="108"
                          stroke={activeBean.fill}
                          strokeWidth="4"
                          strokeLinecap="round"
                          animate={shouldReduceMotion ? undefined : { opacity: [0.6, 1, 0.6] }}
                          transition={{ duration: 1.4, repeat: Infinity }}
                        />

                        {/* Ceramic Cup */}
                        <path
                          d="M 124 114 C 142 114, 142 142, 124 142"
                          fill="none"
                          stroke="#3B281E"
                          strokeWidth="3"
                        />
                        <path
                          d="M 52 106 L 128 106 L 122 152 C 120 160, 60 160, 58 152 Z"
                          fill="#FFFDF9"
                          stroke="#3B281E"
                          strokeWidth="2.5"
                          strokeLinejoin="round"
                        />
                        {/* Rich Crema Fill */}
                        <ellipse cx="90" cy="108" rx="34" ry="5" fill={activeBean.fill} />
                        {/* Cup Sleeve Badge */}
                        <path
                          d="M 56 122 L 124 122 L 122 142 L 58 142 Z"
                          fill="#E05326"
                        />
                        <text
                          x="90"
                          y="135"
                          textAnchor="middle"
                          fill="#FFFFFF"
                          fontSize="8.5"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          uprail.world
                        </text>
                      </svg>
                    </div>

                    {/* Right Half: Warm Perforated Paper Thermal Receipt */}
                    <div className="rounded-2xl bg-[#FFFDF9] dark:bg-[#231912] border border-[#E0CFB8] dark:border-[#413024] p-3 sm:p-4 flex flex-col justify-between font-mono text-[10px] sm:text-[11px] shadow-xs">
                      <div className="space-y-2 sm:space-y-2.5">
                        <div className="flex items-center justify-between border-b border-dashed border-[#D7C5AE] dark:border-[#493628] pb-1.5 sm:pb-2 gap-1">
                          <span className="font-bold text-[#1E140E] dark:text-[#FAF3E8]">
                            RECEIPT
                          </span>
                          <span className="text-[9px] sm:text-[10px] text-[#8C522E] dark:text-[#E59D6B] truncate">
                            uprail.world/you
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex justify-between gap-1">
                            <span className="text-[#7C6352] dark:text-[#B4A090]">SENT</span>
                            <span className="font-bold text-[#1E140E] dark:text-white text-right">
                              {activeBean.label}
                            </span>
                          </div>
                          <div className="flex justify-between gap-1">
                            <span className="text-[#7C6352] dark:text-[#B4A090]">ROUTE</span>
                            <span className="font-bold text-[#E05326] text-right">1-Time Addr</span>
                          </div>
                          <div className="flex justify-between gap-1">
                            <span className="text-[#7C6352] dark:text-[#B4A090]">VAULT</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 text-right">
                              {activeBean.out}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-2.5 border-t border-dashed border-[#D7C5AE] dark:border-[#493628] flex items-center justify-between text-[9px] sm:text-[10px] text-[#7C6352] dark:text-[#B4A090]">
                        <span className="inline-flex items-center gap-1">
                          <Lock className="w-3 h-3 text-[#E05326] flex-shrink-0" />
                          <span>Zero link</span>
                        </span>
                        <span className="font-bold text-[#1E140E] dark:text-[#FAF3E8]">
                          PAID ✓
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Scroll Cue */}
        <div className="flex items-center justify-center gap-2 text-[11px] font-mono text-stone-400">
          {activeIndex < 3 ? (
            <span>Scroll to reveal next ({activeIndex + 1}/4)</span>
          ) : (
            <span className="text-[#E05326] font-bold">
              All 4 capabilities unlocked · Continue scrolling ↓
            </span>
          )}
        </div>
      </div>
    </section>
  );
};
