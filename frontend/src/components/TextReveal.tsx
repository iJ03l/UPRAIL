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
  const [revealedCount, setRevealedCount] = useState(0);

  const words = children.split(' ');

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      // Start revealing when top is within viewport
      const start = windowHeight * 0.85;
      const end = windowHeight * 0.25;

      const progress = Math.min(
        1,
        Math.max(0, (start - rect.top) / (start - end))
      );

      const count = Math.floor(progress * (words.length + 2));
      setRevealedCount(count);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [words.length]);

  return (
    <div ref={containerRef} className={`flex flex-wrap gap-x-2.5 gap-y-2 ${className}`}>
      {words.map((word, index) => {
        const isRevealed = index <= revealedCount;
        const isAccent = accentWords.some((a) =>
          word.toLowerCase().includes(a.toLowerCase())
        );

        return (
          <span
            key={index}
            className={`transition-all duration-300 transform inline-block ${
              isRevealed
                ? isAccent
                  ? 'text-[#E05326] font-black scale-105'
                  : 'text-stone-950 font-extrabold scale-100'
                : 'text-stone-300 font-medium scale-95'
            }`}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
