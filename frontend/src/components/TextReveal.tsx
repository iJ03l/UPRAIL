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

      // Calculate progress between entering bottom and reaching middle of viewport
      const start = windowHeight * 0.9;
      const end = windowHeight * 0.3;

      const progress = Math.min(
        1,
        Math.max(0, (start - rect.top) / (start - end))
      );

      const count = Math.floor(progress * words.length);
      setRevealedCount(count);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [words.length]);

  return (
    <div ref={containerRef} className={`flex flex-wrap gap-x-2.5 gap-y-1.5 ${className}`}>
      {words.map((word, index) => {
        const isRevealed = index <= revealedCount;
        const isAccent = accentWords.some(
          (a) => word.toLowerCase().includes(a.toLowerCase())
        );

        return (
          <span
            key={index}
            className={`transition-all duration-300 transform inline-block ${
              isRevealed
                ? isAccent
                  ? 'text-[#E05326] font-bold opacity-100 translate-y-0 scale-100 drop-shadow-[0_0_12px_rgba(224,83,38,0.4)]'
                  : 'text-white font-medium opacity-100 translate-y-0 scale-100'
                : 'text-[#4A3B33] opacity-25 translate-y-2 scale-95'
            }`}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
