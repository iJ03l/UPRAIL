'use client';

import React, { useRef, useState } from 'react';
import {
  motion,
  MotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'framer-motion';
import { ArrowDownLeft, ArrowLeft, ArrowRight, ExternalLink, Gift, Leaf } from 'lucide-react';
import { SolidCoffeeIcon } from './CoffeeModal';

interface CapabilitiesCarouselProps {
  appSubdomainUrl: string;
}

interface CapabilityCardData {
  id: string;
  num: string;
  eyebrow: string;
  title: string;
  summary: string;
  ctaLabel: string;
  ctaHref: (appUrl: string) => string;
  docsHref: string;
  variant: 'dark' | 'light' | 'coffee';
  receiptLines: [ { label: string; value: string }, { label: string; value: string } ];
  isRequestArrow?: boolean;
  isCoffee?: boolean;
  icon?: 'leaf' | 'gift';
}

const BARCODE_BARS = [2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 2, 1, 1, 2, 1];

const CARDS: CapabilityCardData[] = [
  {
    id: 'requests',
    num: '01',
    eyebrow: '01 / Requests',
    title: 'Request from anyone on 𝕏.',
    summary: 'Share a passkey link. They settle or decline in one tap.',
    ctaLabel: 'Request Money',
    ctaHref: (appUrl) => `${appUrl}/request`,
    docsHref: 'https://docs.uprail.world',
    variant: 'dark',
    receiptLines: [
      { label: 'PAYER', value: 'Any 𝕏 @handle' },
      { label: 'SETTLEMENT', value: '1-Tap Passkey' },
    ],
    isRequestArrow: true,
  },
  {
    id: 'ai',
    num: '02',
    eyebrow: '02 / AI Chat',
    title: 'Pay from any AI.',
    summary: 'Connect Claude, ChatGPT, or Cursor under strict USD caps.',
    ctaLabel: 'Connect AI',
    ctaHref: (appUrl) => `${appUrl}/agents`,
    docsHref: 'https://docs.uprail.world/docs/agents',
    variant: 'light',
    receiptLines: [
      { label: 'PROTOCOL', value: 'OAuth 2.1 + MCP' },
      { label: 'POLICY', value: 'Atomic USD Caps' },
    ],
  },
  {
    id: 'fees',
    num: '03',
    eyebrow: '03 / Creator Fees',
    title: 'Route token fees to 𝕏.',
    summary: 'Point launchpad royalties to UPRAIL. Claim by touch.',
    ctaLabel: 'Collect Fees',
    ctaHref: (appUrl) => `${appUrl}/claim?view=fees`,
    docsHref: 'https://docs.uprail.world/docs/fees',
    variant: 'dark',
    receiptLines: [
      { label: 'ROUTING', value: 'On-Chain Receipt' },
      { label: 'GAS', value: '100% Sponsored' },
    ],
  },
  {
    id: 'coffee',
    num: '04',
    eyebrow: '04 / Buy Me a Coffee',
    title: 'One coffee link in your 𝕏 bio.',
    summary: 'Zero-login tips in NEAR, USDC, or SOL via uprail.world/you.',
    ctaLabel: 'Create Coffee Link',
    ctaHref: (appUrl) => appUrl,
    docsHref: 'https://docs.uprail.world/docs/coffee',
    variant: 'coffee',
    receiptLines: [
      { label: 'CHECKOUT', value: 'Zero Login' },
      { label: 'NETWORKS', value: '35+ Blockchains' },
    ],
    isCoffee: true,
  },
  {
    id: 'circles',
    num: '05',
    eyebrow: '05 / Circles',
    title: 'Pool Earn vaults together.',
    summary: 'Split a shared goal with anyone in 1Click Earn vaults. Compound yield together until payout or dissolve.',
    ctaLabel: 'Open Circles',
    ctaHref: (appUrl) => `${appUrl}/circles`,
    docsHref: 'https://docs.uprail.world/circles',
    variant: 'light',
    receiptLines: [
      { label: 'VAULTS', value: '6 Earn Pools (9.2%)' },
      { label: 'CUSTODY', value: 'Isolated Escrow' },
    ],
    icon: 'leaf',
  },
  {
    id: 'gifts',
    num: '06',
    eyebrow: '06 / Vault Gifts',
    title: 'Gift compounding yield.',
    summary: 'Lock TLO, stNEAR, or gtUSDCp behind a date and @handle. Only their passkey unwraps it.',
    ctaLabel: 'Send a Vault Gift',
    ctaHref: (appUrl) => `${appUrl}/circles?tab=gifts`,
    docsHref: 'https://docs.uprail.world/circles#gift',
    variant: 'dark',
    receiptLines: [
      { label: 'TIMELOCK', value: 'Unlock Date + Passkey' },
      { label: 'GIFT FEE', value: '0% Protocol Fee' },
    ],
    icon: 'gift',
  },
];

const MAX_INDEX = CARDS.length - 1;

interface ArcCardProps {
  card: CapabilityCardData;
  index: number;
  progress: MotionValue<number>;
  activeIndex: number;
  appSubdomainUrl: string;
  shouldReduceMotion: boolean;
  onSelect: (idx: number) => void;
}

const ArcCard: React.FC<ArcCardProps> = ({
  card,
  index,
  progress,
  activeIndex,
  appSubdomainUrl,
  shouldReduceMotion,
  onSelect,
}) => {
  const offset = useTransform(progress, (p) => index - p);

  const x = useTransform(offset, [-2, -1, 0, 1, 2], ['-205%', '-108%', '0%', '108%', '205%']);
  const y = useTransform(
    offset,
    [-2, -1, -0.45, 0, 0.45, 1, 2],
    shouldReduceMotion ? [0, 0, 0, 0, 0, 0, 0] : [145, 48, 10, 0, 10, 48, 145]
  );
  const rotate = useTransform(
    offset,
    [-2, -1, 0, 1, 2],
    shouldReduceMotion ? [0, 0, 0, 0, 0] : [-10, -5, 0, 5, 10]
  );
  const scale = useTransform(offset, [-2, -1, 0, 1, 2], [0.64, 0.78, 1.04, 0.78, 0.64]);
  const opacity = useTransform(
    offset,
    [-2.2, -1.35, -0.75, 0, 0.75, 1.35, 2.2],
    [0, 0.16, 0.42, 1, 0.42, 0.16, 0]
  );
  const zIndex = useTransform(offset, (v) => Math.round(30 - Math.abs(v) * 10));

  const isCenter = activeIndex === index;

  const surfaceClass =
    card.variant === 'coffee'
      ? 'bg-[#FAF3E8] dark:bg-[#1A130E] text-[#1E140E] dark:text-[#FAF3E8] border-[#E2D2BA] dark:border-[#3E2D20]'
      : card.variant === 'light'
        ? 'bg-stone-100 dark:bg-stone-900 text-stone-950 dark:text-white border-stone-200 dark:border-stone-800'
        : 'bg-stone-950 text-white border-stone-800';

  const eyebrowClass =
    card.variant === 'coffee'
      ? 'text-[#9B5529] dark:text-[#E79E6D]'
      : card.variant === 'light'
        ? 'text-stone-500 dark:text-stone-400'
        : 'text-stone-400';

  const summaryClass =
    card.variant === 'coffee'
      ? 'text-[#5C493C] dark:text-[#CFC0B2]'
      : card.variant === 'light'
        ? 'text-stone-600 dark:text-stone-300'
        : 'text-stone-400';

  const dashedBorderClass =
    card.variant === 'coffee'
      ? 'border-[#D9C4A9] dark:border-[#4B3626]'
      : card.variant === 'light'
        ? 'border-stone-300 dark:border-stone-700'
        : 'border-stone-800';

  const valueClass =
    card.variant === 'coffee'
      ? 'text-[#1E140E] dark:text-[#FAF3E8]'
      : card.variant === 'light'
        ? 'text-stone-900 dark:text-stone-100'
        : 'text-stone-100';

  const docsLinkClass =
    card.variant === 'coffee'
      ? 'text-[#7A6150] hover:text-[#1E140E] dark:text-[#BDA898] dark:hover:text-white'
      : card.variant === 'light'
        ? 'text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-white'
        : 'text-stone-400 hover:text-white';

  const ctaClass =
    card.variant === 'coffee'
      ? 'bg-[#1E140E] dark:bg-[#FAF3E8] text-[#FAF3E8] dark:text-[#1E140E] hover:opacity-90'
      : card.variant === 'light'
        ? 'bg-stone-950 dark:bg-white text-white dark:text-stone-950 hover:bg-stone-800 dark:hover:bg-stone-200'
        : 'bg-white text-stone-950 hover:bg-stone-200';

  return (
    <motion.article
      style={{ x, y, rotate, scale, opacity, zIndex }}
      onClick={() => {
        if (!isCenter) onSelect(index);
      }}
      className={`absolute top-6 sm:top-4 w-[310px] sm:w-[660px] md:w-[750px] min-h-[320px] sm:min-h-[540px] rounded-2xl sm:rounded-3xl border shadow-xl flex flex-col justify-between select-none overflow-hidden ${surfaceClass} ${
        isCenter ? 'pointer-events-auto cursor-default' : 'cursor-pointer'
      }`}
    >
      {/* Top Receipt Strip */}
      <div
        className={`px-6 sm:px-11 pt-5 sm:pt-8 pb-3 border-b border-dashed flex items-center justify-between ${dashedBorderClass}`}
      >
        <span
          className={`text-[10px] sm:text-xs font-mono uppercase tracking-widest font-bold inline-flex items-center gap-1.5 ${eyebrowClass}`}
        >
          {card.isCoffee && <SolidCoffeeIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#E05326]" />}
          {card.icon === 'leaf' && (
            <Leaf className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600 fill-emerald-500/20" />
          )}
          {card.icon === 'gift' && (
            <Gift className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
          )}
          <span>RCPT // {card.eyebrow}</span>
        </span>
        <div className="flex items-center gap-2">
          <span className={`hidden sm:inline text-[10px] font-mono uppercase tracking-wider ${eyebrowClass}`}>
            UPRAIL RAIL
          </span>
          <span
            className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${
              card.icon === 'leaf'
                ? 'bg-emerald-500'
                : card.icon === 'gift'
                  ? 'bg-amber-400'
                  : 'bg-[#E05326]'
            }`}
          />
        </div>
      </div>

      {/* Main Receipt Body */}
      <div className="px-6 sm:px-11 py-4 sm:py-7 flex-1 flex flex-col justify-between gap-4 sm:gap-6">
        <div className="space-y-2 sm:space-y-4">
          <h3 className="text-2xl sm:text-5xl md:text-[3.25rem] font-display font-extrabold tracking-tight leading-[1.05]">
            {card.title}
          </h3>

          <p className={`text-xs sm:text-lg md:text-xl leading-relaxed ${summaryClass}`}>
            {card.summary}
          </p>
        </div>

        {/* Receipt Ledger Rows */}
        <div className={`pt-3 sm:pt-4 border-t border-dashed space-y-1.5 sm:space-y-2.5 font-mono text-[10px] sm:text-xs ${dashedBorderClass}`}>
          {card.receiptLines.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <span className={`uppercase tracking-wider ${eyebrowClass}`}>{row.label}</span>
              <span className={`flex-1 border-b border-dotted opacity-40 ${dashedBorderClass}`} />
              <span className={`font-bold ${valueClass}`}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Perforated Tear Line + Side Cutouts + Barcode Footer */}
      <div className={`relative px-6 sm:px-11 py-4 sm:py-6 border-t border-dashed flex items-center justify-between gap-3 ${dashedBorderClass}`}>
        <span className="absolute -left-2.5 -top-2.5 w-5 h-5 rounded-full bg-surface border border-stone-200/60 dark:border-stone-800/60 pointer-events-none" />
        <span className="absolute -right-2.5 -top-2.5 w-5 h-5 rounded-full bg-surface border border-stone-200/60 dark:border-stone-800/60 pointer-events-none" />

        <div className="flex items-center gap-3 sm:gap-4">
          {/* Receipt Barcode Stub */}
          <div className="hidden sm:flex items-center gap-[2px] h-5 opacity-45" aria-hidden="true">
            {BARCODE_BARS.map((w, i) => (
              <span
                key={i}
                style={{ width: `${w}px` }}
                className="h-full bg-current rounded-[0.5px]"
              />
            ))}
          </div>

          <a
            href={card.docsHref}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={isCenter ? 0 : -1}
            onClick={(e) => {
              if (!isCenter) e.preventDefault();
            }}
            className={`text-xs font-mono transition-colors inline-flex items-center gap-1 ${docsLinkClass}`}
          >
            <span>Docs</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <a
          href={card.ctaHref(appSubdomainUrl)}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={isCenter ? 0 : -1}
          onClick={(e) => {
            if (!isCenter) e.preventDefault();
          }}
          className={`px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl font-display font-extrabold text-[11px] sm:text-xs uppercase tracking-wider inline-flex items-center gap-1.5 transition-all ${ctaClass}`}
        >
          {card.isCoffee && <SolidCoffeeIcon className="w-3.5 h-3.5 text-[#E05326]" />}
          {card.icon === 'leaf' && <Leaf className="w-3.5 h-3.5 text-emerald-500" />}
          {card.icon === 'gift' && <Gift className="w-3.5 h-3.5 text-amber-500" />}
          <span>{card.ctaLabel}</span>
          {card.isRequestArrow ? (
            <ArrowDownLeft className="w-3.5 h-3.5 text-[#E05326]" />
          ) : !card.isCoffee ? (
            <ArrowRight className="w-3.5 h-3.5" />
          ) : null}
        </a>
      </div>
    </motion.article>
  );
};

export const CapabilitiesCarousel: React.FC<CapabilitiesCarouselProps> = ({
  appSubdomainUrl,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const shouldReduceMotion = Boolean(useReducedMotion());

  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start start', 'end end'],
  });

  // Smooth continuous index [0..MAX_INDEX] with brief dwell plateau at start & end
  const progress = useTransform(
    scrollYProgress,
    [0, 0.06, 0.94, 1],
    [0, 0, MAX_INDEX, MAX_INDEX]
  );

  useMotionValueEvent(progress, 'change', (latest) => {
    const rounded = Math.min(MAX_INDEX, Math.max(0, Math.round(latest)));
    setActiveIndex((prev) => (prev === rounded ? prev : rounded));
  });

  const scrollToStep = (index: number) => {
    const clamped = Math.min(MAX_INDEX, Math.max(0, index));
    if (!trackRef.current) {
      setActiveIndex(clamped);
      return;
    }
    const rect = trackRef.current.getBoundingClientRect();
    const trackTop = window.scrollY + rect.top;
    const scrollable = Math.max(1, trackRef.current.offsetHeight - window.innerHeight);
    const frac = 0.06 + (clamped / MAX_INDEX) * 0.88;
    const targetY =
      clamped === 0
        ? trackTop
        : clamped === MAX_INDEX
          ? trackTop + scrollable
          : trackTop + frac * scrollable;

    setActiveIndex(clamped);
    window.scrollTo({ top: targetY, behavior: shouldReduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <section
      id="capabilities"
      ref={trackRef}
      className="relative w-full max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 scroll-mt-20 min-h-[340vh] sm:min-h-[380vh]"
    >
      <div className="sticky top-14 sm:top-16 py-2 sm:py-3 flex flex-col justify-center space-y-4">
        {/* Clean Header + Prev/Next Arrows */}
        <div className="flex items-end justify-between gap-4 max-w-6xl w-full mx-auto">
          <div className="space-y-1">
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#E05326] font-bold block">
              // Capabilities
            </span>
            <h2 className="text-2xl sm:text-4xl font-display font-extrabold tracking-tight text-stone-950 dark:text-white leading-[1.06]">
              Six ways value moves.
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous capability"
              disabled={activeIndex === 0}
              onClick={() => scrollToStep(activeIndex - 1)}
              className="w-9 h-9 rounded-full border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-700 dark:text-stone-200 disabled:opacity-35 flex items-center justify-center hover:border-stone-400 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Next capability"
              disabled={activeIndex === MAX_INDEX}
              onClick={() => scrollToStep(activeIndex + 1)}
              className="w-9 h-9 rounded-full border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-700 dark:text-stone-200 disabled:opacity-35 flex items-center justify-center hover:border-stone-400 transition-colors cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Continuous Scroll-Driven Right-to-Left Arc Stage */}
        <div
          className="relative w-full h-[420px] sm:h-[585px] flex items-start justify-center overflow-x-clip overflow-y-visible"
          style={{
            WebkitMaskImage:
              'linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)',
            maskImage:
              'linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)',
          }}
        >
          {CARDS.map((card, index) => (
            <ArcCard
              key={card.id}
              card={card}
              index={index}
              progress={progress}
              activeIndex={activeIndex}
              appSubdomainUrl={appSubdomainUrl}
              shouldReduceMotion={shouldReduceMotion}
              onSelect={scrollToStep}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
