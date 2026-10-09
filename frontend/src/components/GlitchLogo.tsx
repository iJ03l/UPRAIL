'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Link } from '../lib/router';

export interface GlitchLogoProps {
  /** Target link href/path (e.g. '/' or '/app'). If empty string or false, renders as a div */
  href?: string | false;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Color variant: 'light' (black wordmark on light bg) or 'dark' (white wordmark on dark bg) */
  variant?: 'light' | 'dark' | 'auto';
  /** Display mode: 'cycle' (cinematic glitch between full & icon), 'icon-only', or 'full-only' */
  mode?: 'cycle' | 'icon-only' | 'full-only';
  /** Optional badge text next to the logo (e.g. 'APP') */
  badge?: string;
  /** Extra CSS classes */
  className?: string;
  /** Cycle duration in ms for the full logo display before glitching (default: 5500) */
  fullDuration?: number;
  /** Cycle duration in ms for the icon-only display before glitching back (default: 3800) */
  iconDuration?: number;
  /** Enable hover and touch interactive glitch triggers (default: true) */
  interactive?: boolean;
}

export const GlitchLogo: React.FC<GlitchLogoProps> = ({
  href = '/',
  size = 'md',
  variant = 'light',
  mode = 'cycle',
  badge,
  className = '',
  fullDuration = 5500,
  iconDuration = 3800,
  interactive = true,
}) => {
  // Start with full logo unless mode is explicitly icon-only
  const [showWordmark, setShowWordmark] = useState<boolean>(mode !== 'icon-only');
  const [isGlitching, setIsGlitching] = useState<boolean>(false);
  const glitchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cycleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Trigger a brief cinematic glitch sequence (approx 480ms)
  const triggerGlitch = (callback?: () => void) => {
    setIsGlitching(true);

    if (glitchTimerRef.current) {
      clearTimeout(glitchTimerRef.current);
    }

    // Midway through the glitch (~200ms), perform the state transition
    const midTimer = setTimeout(() => {
      if (callback) callback();
    }, 200);

    glitchTimerRef.current = setTimeout(() => {
      clearTimeout(midTimer);
      setIsGlitching(false);
    }, 480);
  };

  // Autonomous cinematic glitch cycle
  useEffect(() => {
    if (mode !== 'cycle') {
      setShowWordmark(mode === 'full-only');
      return;
    }

    const scheduleNextTransition = () => {
      const waitTime = showWordmark ? fullDuration : iconDuration;

      cycleTimerRef.current = setTimeout(() => {
        triggerGlitch(() => {
          setShowWordmark((prev) => !prev);
        });
      }, waitTime);
    };

    scheduleNextTransition();

    return () => {
      if (cycleTimerRef.current) clearTimeout(cycleTimerRef.current);
      if (glitchTimerRef.current) clearTimeout(glitchTimerRef.current);
    };
  }, [mode, showWordmark, fullDuration, iconDuration]);

  // Interactive handler for hover or tap
  const handleInteraction = () => {
    if (!interactive || isGlitching) return;
    triggerGlitch(() => {
      if (mode === 'cycle') {
        setShowWordmark((prev) => !prev);
      }
    });
  };

  // Dimensional scale classes
  const dimensions = {
    sm: {
      icon: 'h-6 w-6 sm:h-6 sm:w-6',
      wordmark: 'h-5 sm:h-5 max-w-[85px]',
      gap: 'space-x-1.5',
      badge: 'text-[9px] px-1 py-0.2',
    },
    md: {
      icon: 'h-7 w-7 sm:h-8 sm:w-8',
      wordmark: 'h-6 sm:h-7 max-w-[110px] sm:max-w-[125px]',
      gap: 'space-x-2 sm:space-x-2.5',
      badge: 'text-[10px] px-1.5 py-0.5',
    },
    lg: {
      icon: 'h-9 w-9 sm:h-10 sm:w-10',
      wordmark: 'h-8 sm:h-9 max-w-[140px] sm:max-w-[160px]',
      gap: 'space-x-2.5 sm:space-x-3',
      badge: 'text-xs px-2 py-0.5',
    },
    xl: {
      icon: 'h-11 w-11 sm:h-12 sm:w-12',
      wordmark: 'h-10 sm:h-11 max-w-[180px] sm:max-w-[200px]',
      gap: 'space-x-3 sm:space-x-3.5',
      badge: 'text-xs px-2 py-1',
    },
  }[size];

  const wordmarkSrc =
    variant === 'dark'
      ? '/brand/uprail-wordmark-white.png'
      : '/brand/uprail-wordmark.png';

  const content = (
    <div
      className={`relative inline-flex items-center select-none ${dimensions.gap} ${className}`}
      onMouseEnter={handleInteraction}
      onTouchStart={handleInteraction}
      title="UPRAIL"
    >
      {/* 
        === PRIMARY LAYER === 
      */}
      <div
        className={`relative z-10 flex items-center ${dimensions.gap} transition-transform duration-150 ${
          isGlitching ? 'glitch-anim-active' : ''
        }`}
      >
        {/* Brand Icon (Universal Orange Track) */}
        <div
          className={`relative flex-shrink-0 ${dimensions.icon} flex items-center justify-center transition-all duration-300 ${
            !showWordmark && !isGlitching ? 'icon-beacon-glow' : ''
          }`}
        >
          <img
            src="/brand/uprail-icon.png"
            alt="UPRAIL"
            className="w-full h-full object-contain filter drop-shadow-xs"
            draggable={false}
          />
        </div>

        {/* Collapsible Wordmark ("uprail ™") */}
        <div
          className={`overflow-hidden flex items-center transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            showWordmark
              ? `${dimensions.wordmark} opacity-100 scale-100 translate-x-0`
              : 'max-w-0 opacity-0 scale-90 -translate-x-3 pointer-events-none'
          }`}
        >
          <img
            src={wordmarkSrc}
            alt="uprail"
            className="h-full w-auto object-contain flex-shrink-0"
            draggable={false}
          />
        </div>

        {/* Optional Badge (e.g. "APP") */}
        {badge && (
          <div
            className={`overflow-hidden flex items-center transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              showWordmark
                ? 'max-w-[60px] opacity-100'
                : 'max-w-0 opacity-0 pointer-events-none'
            }`}
          >
            <span
              className={`font-mono font-bold bg-stone-100 text-stone-800 border border-stone-200 rounded-md uppercase tracking-wider flex-shrink-0 ${dimensions.badge}`}
            >
              {badge}
            </span>
          </div>
        )}
      </div>

      {/* 
        === CINEMATIC GLITCH DISRUPTION LAYERS (Active during signal disruption) === 
      */}
      {isGlitching && (
        <>
          {/* Slice Tearing Layer 1 (Red/Orange chromatic split) */}
          <div
            aria-hidden="true"
            className={`absolute inset-0 z-20 flex items-center ${dimensions.gap} pointer-events-none glitch-slice-layer-1`}
            style={{
              filter: 'drop-shadow(-3px 0 0 rgba(224, 83, 38, 0.95))',
            }}
          >
            <div className={`flex-shrink-0 ${dimensions.icon}`}>
              <img
                src="/brand/uprail-icon.png"
                alt=""
                className="w-full h-full object-contain"
              />
            </div>
            <div
              className={`overflow-hidden flex items-center ${
                showWordmark ? dimensions.wordmark : 'max-w-0 opacity-0'
              }`}
            >
              <img
                src={wordmarkSrc}
                alt=""
                className="h-full w-auto object-contain flex-shrink-0"
              />
            </div>
          </div>

          {/* Slice Tearing Layer 2 (Cyan/Blue chromatic split) */}
          <div
            aria-hidden="true"
            className={`absolute inset-0 z-20 flex items-center ${dimensions.gap} pointer-events-none glitch-slice-layer-2`}
            style={{
              filter: 'drop-shadow(3px 0 0 rgba(0, 220, 255, 0.85))',
            }}
          >
            <div className={`flex-shrink-0 ${dimensions.icon}`}>
              <img
                src="/brand/uprail-icon.png"
                alt=""
                className="w-full h-full object-contain"
              />
            </div>
            <div
              className={`overflow-hidden flex items-center ${
                showWordmark ? dimensions.wordmark : 'max-w-0 opacity-0'
              }`}
            >
              <img
                src={wordmarkSrc}
                alt=""
                className="h-full w-auto object-contain flex-shrink-0"
              />
            </div>
          </div>

          {/* Scanning Laser Beam */}
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#E05326] to-transparent pointer-events-none z-30 glitch-laser-beam shadow-[0_0_8px_#E05326]"
          />

          {/* Micro CRT Scanlines Overlay */}
          <div
            aria-hidden="true"
            className="absolute inset-0 z-20 pointer-events-none glitch-scanlines opacity-40 rounded-sm"
          />
        </>
      )}
    </div>
  );

  if (href === false || !href) {
    return content;
  }

  return (
    <Link
      to={href}
      className="inline-flex items-center group cursor-pointer focus:outline-none"
    >
      {content}
    </Link>
  );
};
