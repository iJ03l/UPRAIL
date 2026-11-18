'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Link } from '../lib/router';
import { useTheme } from './ThemeProvider';

export interface GlitchLogoProps {
  /** Target link href/path (e.g. '/' or '/app'). If empty string or false, renders as a div */
  href?: string | false;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Color variant: 'light' (black wordmark on light bg) or 'dark' (white wordmark on dark bg) */
  variant?: 'light' | 'dark' | 'auto';
  /** Display mode: 'cycle' (cinematic glitch burst every interval), 'icon-only', or 'full-only' */
  mode?: 'cycle' | 'icon-only' | 'full-only';
  /** Optional badge text next to the logo (e.g. 'APP') */
  badge?: string;
  /** Extra CSS classes */
  className?: string;
  /** Glitch burst interval in ms (default: 6500) */
  interval?: number;
  /** Cycle duration in ms for backward compatibility */
  fullDuration?: number;
  iconDuration?: number;
  /** Enable hover and touch interactive glitch triggers (default: true) */
  interactive?: boolean;
  /** Hide wordmark (and badge) below sm breakpoint so mobile headers only show the icon */
  hideWordmarkOnMobile?: boolean;
}

const ASCII_GLYPHS = ['/', '\\', '|', '_', '[', ']', '{', '}', '<', '>', '~', '!', '?', '#', '$', '%', '&', '*', '^', '=', '+', '0', '1', '░', '▒', '▓', '█'];
const ASCII_ICONS = ['//', '[//]', '[/]', '░▒', '<//>', '[▲]', '[#]', '||', '//'];
const ASCII_BADGES = ['[::]', '[01]', '[#]', '[!!]', '[OK]'];
const ASCII_STREAMS = ['0x9A', '1011', '0100', 'SYNC', 'RAIL', 'OK'];
const TARGET_WORD = 'UPRAIL';

export const GlitchLogo: React.FC<GlitchLogoProps> = ({
  href = '/',
  size = 'md',
  variant = 'auto',
  mode = 'cycle',
  badge,
  className = '',
  interval = 6500,
  fullDuration,
  iconDuration,
  interactive = true,
  hideWordmarkOnMobile = false,
}) => {
  const [isGlitching, setIsGlitching] = useState<boolean>(false);
  const [asciiWordmark, setAsciiWordmark] = useState<string>(TARGET_WORD);
  const [asciiIcon, setAsciiIcon] = useState<string>('//');
  const [asciiBadge, setAsciiBadge] = useState<string>(badge || '');
  const [asciiStream, setAsciiStream] = useState<string>('0x9A');

  const glitchFrameRef = useRef<number | null>(null);
  const intervalTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { resolved } = useTheme();
  // 'auto' flips the wordmark with the active theme so the wordmark is
  // never left invisible against the dark background.
  const effectiveVariant = variant === 'auto' ? (resolved === 'dark' ? 'dark' : 'light') : variant;

  const burstInterval = interval || fullDuration || 6500;

  // Trigger an authentic cyber ASCII glitch burst (~460ms) - strictly zero layout reflow
  const triggerGlitch = () => {
    if (isGlitching) return;
    setIsGlitching(true);

    if (typeof window === 'undefined') return;

    // Check for prefers-reduced-motion
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTimeout(() => setIsGlitching(false), 200);
      return;
    }

    const startTime = performance.now();
    const duration = 460;

    const frameStep = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      if (progress >= 1) {
        setIsGlitching(false);
        setAsciiWordmark(TARGET_WORD);
        setAsciiIcon('//');
        setAsciiBadge(badge || '');
        if (glitchFrameRef.current) {
          cancelAnimationFrame(glitchFrameRef.current);
          glitchFrameRef.current = null;
        }
        return;
      }

      // Step ASCII icon glyph
      const iconIdx = Math.floor(progress * ASCII_ICONS.length);
      setAsciiIcon(ASCII_ICONS[iconIdx] || '//');

      // Step ASCII badge
      const badgeIdx = Math.floor(progress * ASCII_BADGES.length);
      setAsciiBadge(badge ? ASCII_BADGES[badgeIdx] || '[01]' : '');

      // Step ASCII telemetry
      const streamIdx = Math.floor(progress * ASCII_STREAMS.length);
      setAsciiStream(ASCII_STREAMS[streamIdx] || '0x9A');

      // Scramble wordmark: characters progressively resolve towards completion
      const scrambled = TARGET_WORD.split('').map((char, i) => {
        const lockProgress = (i + 1) / (TARGET_WORD.length + 0.8);
        if (progress > lockProgress && Math.random() > 0.12) {
          return char;
        }
        return ASCII_GLYPHS[Math.floor(Math.random() * ASCII_GLYPHS.length)];
      }).join('');

      setAsciiWordmark(scrambled);
      glitchFrameRef.current = requestAnimationFrame(frameStep);
    };

    glitchFrameRef.current = requestAnimationFrame(frameStep);
  };

  // Autonomous periodic ASCII glitch burst
  useEffect(() => {
    if (mode === 'icon-only' || mode === 'full-only') return;

    intervalTimerRef.current = setInterval(() => {
      triggerGlitch();
    }, burstInterval);

    return () => {
      if (intervalTimerRef.current) clearInterval(intervalTimerRef.current);
      if (glitchFrameRef.current) cancelAnimationFrame(glitchFrameRef.current);
    };
  }, [mode, burstInterval]);

  // Interactive handler for hover or tap
  const handleInteraction = () => {
    if (!interactive || isGlitching) return;
    triggerGlitch();
  };

  // Dimensional scale classes - locked container widths guarantee 0 layout shift
  const dimensions = {
    sm: {
      container:
        mode === 'icon-only'
          ? 'w-6 h-6'
          : hideWordmarkOnMobile
            ? 'w-6 sm:w-[102px] h-6'
            : 'w-[102px] h-6',
      icon: 'h-6 w-6',
      wordmark: 'h-4.5 max-w-[70px]',
      gap: 'space-x-1.5',
      badge: 'text-[9px] px-1 py-0.2',
      asciiIconText: 'text-[11px]',
      asciiWordmarkText: 'text-[10px] sm:text-[11px]',
    },
    md: {
      container:
        mode === 'icon-only'
          ? 'w-7 sm:w-8 h-7 sm:h-8'
          : hideWordmarkOnMobile
            ? 'w-7 sm:w-[145px] h-7 sm:h-8'
            : 'w-[124px] sm:w-[145px] h-7 sm:h-8',
      icon: 'h-7 w-7 sm:h-8 sm:w-8',
      wordmark: 'h-5.5 sm:h-6.5 max-w-[88px] sm:max-w-[105px]',
      gap: 'space-x-2 sm:space-x-2.5',
      badge: 'text-[10px] px-1.5 py-0.5',
      asciiIconText: 'text-xs sm:text-sm',
      asciiWordmarkText: 'text-xs sm:text-[13px]',
    },
    lg: {
      container:
        mode === 'icon-only'
          ? 'w-9 sm:w-10 h-9 sm:h-10'
          : hideWordmarkOnMobile
            ? 'w-9 sm:w-[180px] h-9 sm:h-10'
            : 'w-[155px] sm:w-[180px] h-9 sm:h-10',
      icon: 'h-9 w-9 sm:h-10 sm:w-10',
      wordmark: 'h-7.5 sm:h-8.5 max-w-[115px] sm:max-w-[135px]',
      gap: 'space-x-2.5 sm:space-x-3',
      badge: 'text-xs px-2 py-0.5',
      asciiIconText: 'text-sm sm:text-base',
      asciiWordmarkText: 'text-sm sm:text-base',
    },
    xl: {
      container:
        mode === 'icon-only'
          ? 'w-11 sm:w-12 h-11 sm:h-12'
          : hideWordmarkOnMobile
            ? 'w-11 sm:w-[220px] h-11 sm:h-12'
            : 'w-[190px] sm:w-[220px] h-11 sm:h-12',
      icon: 'h-11 w-11 sm:h-12 sm:w-12',
      wordmark: 'h-9.5 sm:h-10.5 max-w-[140px] sm:max-w-[165px]',
      gap: 'space-x-3 sm:space-x-3.5',
      badge: 'text-xs px-2 py-1',
      asciiIconText: 'text-base sm:text-lg',
      asciiWordmarkText: 'text-base sm:text-lg',
    },
  }[size];

  const wordmarkSrc =
    effectiveVariant === 'dark'
      ? '/brand/uprail-wordmark-white.png'
      : '/brand/uprail-wordmark.png';

  const showWordmark = mode !== 'icon-only';
  const wordmarkVisibilityClass = hideWordmarkOnMobile ? 'hidden sm:flex' : 'flex';

  const innerContent = (
    <div
      className={`relative inline-flex items-center flex-shrink-0 select-none ${dimensions.gap} ${dimensions.container} ${className}`}
      onMouseEnter={handleInteraction}
      onTouchStart={handleInteraction}
      title="UPRAIL"
    >
      {/* 
        === PRIMARY LOGO SURFACE === 
      */}
      <div
        className={`relative z-10 flex items-center ${dimensions.gap} flex-shrink-0 transition-transform duration-100 ${
          isGlitching ? 'ascii-glitch-active' : ''
        }`}
      >
        {/* Brand Icon: Switches between authentic PNG and glowing ASCII rail glyphs */}
        <div
          className={`relative flex-shrink-0 ${dimensions.icon} flex items-center justify-center transition-all duration-150`}
        >
          <img
            src="/brand/uprail-icon.png"
            alt="UPRAIL"
            className={`w-full h-full object-contain filter drop-shadow-xs transition-opacity duration-75 ${
              isGlitching ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
            }`}
            draggable={false}
          />
          {isGlitching && (
            <div
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
            >
              <span
                className={`font-mono font-black text-[#E05326] ${dimensions.asciiIconText} tracking-tighter drop-shadow-[0_0_8px_rgba(224,83,38,0.9)]`}
              >
                {asciiIcon}
              </span>
            </div>
          )}
        </div>

        {/* Wordmark: Switches between brand wordmark PNG and dynamic ASCII scramble */}
        {showWordmark && (
          <div
            className={`${wordmarkVisibilityClass} relative items-center flex-shrink-0`}
          >
            <img
              src={wordmarkSrc}
              alt="uprail"
              className={`${dimensions.wordmark} w-auto object-contain flex-shrink-0 transition-opacity duration-75 ${
                isGlitching ? 'opacity-0' : 'opacity-100'
              }`}
              draggable={false}
            />
            {isGlitching && (
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center pointer-events-none select-none overflow-hidden"
              >
                <span
                  className={`font-mono font-black text-[#E05326] ${dimensions.asciiWordmarkText} uppercase tracking-wider whitespace-nowrap drop-shadow-[0_0_8px_rgba(224,83,38,0.85)]`}
                >
                  {asciiWordmark}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Optional Badge (e.g. "APP"): Scrambles into ASCII on glitch */}
        {badge && showWordmark && (
          <div className={`${wordmarkVisibilityClass} items-center flex-shrink-0`}>
            <span
              className={`font-mono font-bold ${
                isGlitching
                  ? 'bg-[#E05326]/10 text-[#E05326] border-[#E05326]/40'
                  : 'bg-stone-100 text-stone-800 border-stone-200'
              } border rounded-md uppercase tracking-wider flex-shrink-0 transition-colors ${dimensions.badge}`}
            >
              {isGlitching ? asciiBadge : badge}
            </span>
          </div>
        )}
      </div>

      {/* 
        === CYBER ASCII ATMOSPHERIC TELEMETRY (Active strictly during glitch burst) === 
      */}
      {isGlitching && (
        <>
          {/* Micro Telemetry Stream */}
          <div
            aria-hidden="true"
            className="absolute -top-3 left-0 right-0 overflow-hidden h-2.5 pointer-events-none opacity-60 font-mono text-[7px] sm:text-[8px] tracking-widest text-[#E05326] flex items-center justify-between select-none"
          >
            <span>//RAIL</span>
            <span>{asciiStream}</span>
          </div>

          {/* Micro CRT Scanline Laser Sweep */}
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 h-[1.5px] bg-[#E05326] pointer-events-none z-30 glitch-laser-beam"
          />

          {/* Micro CRT Terminal Scanlines */}
          <div
            aria-hidden="true"
            className="absolute inset-0 z-20 pointer-events-none glitch-scanlines opacity-30 rounded-sm"
          />
        </>
      )}
    </div>
  );

  if (href === false || !href) {
    return innerContent;
  }

  return (
    <Link
      to={href}
      className={`inline-flex items-center flex-shrink-0 ${dimensions.container} group cursor-pointer focus:outline-none`}
    >
      {innerContent}
    </Link>
  );
};
