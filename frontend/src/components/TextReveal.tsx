'use client';

import React, { useEffect, useRef, useState } from 'react';

interface TextRevealProps {
  children: string;
  className?: string;
  accentWords?: string[];
}

export const TextReveal: React.FC<TextRevealProps> = ({
  children,
  className = '',
  accentWords = [],
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  const words = children.trim().split(/\s+/);

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      // Container starts illuminating when it reaches the bottom half of the screen
      // and completes full illumination as it passes the top third
      const revealStart = windowHeight * 0.85;
      const revealEnd = windowHeight * 0.20;

      const currentProgress = (revealStart - rect.top) / (revealStart - revealEnd);
      const clamped = Math.min(1, Math.max(0, currentProgress));

      setScrollProgress(clamped);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const totalWords = words.length;

  return (
    <div
      ref={containerRef}
      className={`w-full block text-left sm:text-justify sm:[text-align-last:left] ${className}`}
    >
      {words.map((word, index) => {
        // Individual word threshold
        const wordThreshold = index / totalWords;
        const isRevealed = scrollProgress >= wordThreshold;
        const isAccent = accentWords.some((a) =>
          word.toLowerCase().includes(a.toLowerCase())
        );

        return (
          <React.Fragment key={index}>
            <span
              className={`inline transition-colors duration-300 tracking-tighter ${
                isRevealed
                  ? isAccent
                    ? 'text-[#E05326] font-extrabold underline decoration-[#E05326]/40 decoration-4 sm:decoration-8 underline-offset-8'
                    : 'text-stone-950 dark:text-white font-extrabold'
                  : 'text-stone-300 dark:text-stone-700 font-extrabold opacity-35 select-none'
              }`}
            >
              {word}
            </span>
            {index < totalWords - 1 ? ' ' : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};
