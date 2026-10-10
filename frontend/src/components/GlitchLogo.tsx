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
}

export const GlitchLogo: React.FC<GlitchLogoProps> = ({
  href = '/',
  size = 'md',
  variant = 'light',
  mode = 'cycle',
  badge,
  className = '',
  interval = 6500,
  fullDuration,
  iconDuration,
  interactive = true,
}) => {
  const [isGlitching, setIsGlitching] = useState<boolean>(false);
  const glitchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalTimerRef = useRef<NodeJS.Timeout | null>(null);

  const burstInterval = interval || fullDuration || 6500;

  // Trigger a brief cinematic glitch sequence (450ms) - strictly zero layout reflow
  const triggerGlitch = () => {
    if (isGlitching) return;
    setIsGlitching(true);

    if (glitchTimerRef.current) {
      clearTimeout(glitchTimerRef.current);
    }

    glitchTimerRef.current = setTimeout(() => {
      setIsGlitching(false);
    }, 450);
  };

  // Autonomous cinematic glitch interval
  useEffect(() => {
    if (mode === 'icon-only' || mode === 'full-only') return;

    intervalTimerRef.current = setInterval(() => {
      triggerGlitch();
    }, burstInterval);

    return () => {
      if (intervalTimerRef.current) clearInterval(intervalTimerRef.current);
      if (glitchTimerRef.current) clearTimeout(glitchTimerRef.current);
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
      container: mode === 'icon-only' ? 'w-6 h-6' : 'w-[102px] h-6',
      icon: 'h-6 w-6',
      wordmark: 'h-4.5 max-w-[70px]',
      gap: 'space-x-1.5',
      badge: 'text-[9px] px-1 py-0.2',
    },
    md: {
      container: mode === 'icon-only' ? 'w-7 sm:w-8 h-7 sm:h-8' : 'w-[124px] sm:w-[145px] h-7 sm:h-8',
      icon: 'h-7 w-7 sm:h-8 sm:w-8',
      wordmark: 'h-5.5 sm:h-6.5 max-w-[88px] sm:max-w-[105px]',
      gap: 'space-x-2 sm:space-x-2.5',
      badge: 'text-[10px] px-1.5 py-0.5',
    },
    lg: {
      container: mode === 'icon-only' ? 'w-9 sm:w-10 h-9 sm:h-10' : 'w-[155px] sm:w-[180px] h-9 sm:h-10',
      icon: 'h-9 w-9 sm:h-10 sm:w-10',
      wordmark: 'h-7.5 sm:h-8.5 max-w-[115px] sm:max-w-[135px]',
      gap: 'space-x-2.5 sm:space-x-3',
      badge: 'text-xs px-2 py-0.5',
    },
    xl: {
      container: mode === 'icon-only' ? 'w-11 sm:w-12 h-11 sm:h-12' : 'w-[190px] sm:w-[220px] h-11 sm:h-12',
      icon: 'h-11 w-11 sm:h-12 sm:w-12',
      wordmark: 'h-9.5 sm:h-10.5 max-w-[140px] sm:max-w-[165px]',
      gap: 'space-x-3 sm:space-x-3.5',
      badge: 'text-xs px-2 py-1',
    },
  }[size];

  const wordmarkSrc =
    variant === 'dark'
      ? '/brand/uprail-wordmark-white.png'
      : '/brand/uprail-wordmark.png';

  const showWordmark = mode !== 'icon-only';

  const innerContent = (
    <div
      className={`relative inline-flex items-center flex-shrink-0 select-none ${dimensions.gap} ${dimensions.container} ${className}`}
      onMouseEnter={handleInteraction}
      onTouchStart={handleInteraction}
      title="UPRAIL"
    >
      {/* 
        === PRIMARY LAYER === 
      */}
      <div
        className={`relative z-10 flex items-center ${dimensions.gap} flex-shrink-0 transition-transform duration-150 ${
          isGlitching ? 'glitch-anim-active' : ''
        }`}
      >
        {/* Brand Icon (Universal Orange Track) */}
        <div
          className={`relative flex-shrink-0 ${dimensions.icon} flex items-center justify-center transition-all duration-300 ${
            isGlitching ? 'icon-beacon-glow scale-105' : ''
          }`}
        >
          <img
            src="/brand/uprail-icon.png"
            alt="UPRAIL"
            className="w-full h-full object-contain filter drop-shadow-xs"
            draggable={false}
          />
        </div>

        {/* Wordmark ("uprail ™") - Always stable in box, zero layout shift */}
        {showWordmark && (
          <div
            className={`flex items-center flex-shrink-0 transition-opacity duration-200 ${
              isGlitching ? 'opacity-90' : 'opacity-100'
            }`}
          >
            <img
              src={wordmarkSrc}
              alt="uprail"
              className={`${dimensions.wordmark} w-auto object-contain flex-shrink-0`}
              draggable={false}
            />
          </div>
        )}

        {/* Optional Badge (e.g. "APP") */}
        {badge && showWordmark && (
          <div className="flex items-center flex-shrink-0">
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
            {showWordmark && (
              <div className="flex items-center flex-shrink-0">
                <img
                  src={wordmarkSrc}
                  alt=""
                  className={`${dimensions.wordmark} w-auto object-contain flex-shrink-0`}
                />
              </div>
            )}
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
            {showWordmark && (
              <div className="flex items-center flex-shrink-0">
                <img
                  src={wordmarkSrc}
                  alt=""
                  className={`${dimensions.wordmark} w-auto object-contain flex-shrink-0`}
                />
              </div>
            )}
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
