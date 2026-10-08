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

  const words = children.split(' ');

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      // Start revealing as container scrolls up from bottom
      const start = windowHeight * 0.9;
      const end = windowHeight * 0.15;

      const progress = Math.min(
        1,
        Math.max(0, (start - rect.top) / (start - end))
      );

      setScrollProgress(progress);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const totalWords = words.length;

  return (
    <div
      ref={containerRef}
      className={`w-full flex flex-wrap gap-x-3 sm:gap-x-5 md:gap-x-6 gap-y-2 sm:gap-y-4 ${className}`}
    >
      {words.map((word, index) => {
        // Individual word threshold
        const wordThreshold = (index / totalWords);
        const isRevealed = scrollProgress >= wordThreshold;
        const isAccent = accentWords.some((a) =>
          word.toLowerCase().includes(a.toLowerCase())
        );

        return (
          <span
            key={index}
            className={`transition-all duration-200 inline-block tracking-tight ${
              isRevealed
                ? isAccent
                  ? 'text-[#E05326] font-black underline decoration-[#E05326]/40 decoration-4 underline-offset-8 drop-shadow-[0_2px_12px_rgba(224,83,38,0.25)]'
                  : 'text-stone-950 font-black'
                : 'text-stone-300 font-bold opacity-30 select-none'
            }`}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
