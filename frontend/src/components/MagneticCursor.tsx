import React, { useEffect, useState } from 'react';

export const MagneticCursor: React.FC = () => {
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [targetPos, setTargetPos] = useState({ x: -100, y: -100 });
  const [isHoveringClickable, setIsHoveringClickable] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only enable on pointer-capable devices (not pure touch)
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const handleMouseMove = (e: MouseEvent) => {
      setTargetPos({ x: e.clientX, y: e.clientY });
      setIsVisible(true);

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.tagName === 'INPUT' ||
          target.closest('button') ||
          target.closest('a') ||
          target.closest('.interactive-target'))
      ) {
        setIsHoveringClickable(true);
      } else {
        setIsHoveringClickable(false);
      }
    };

    const handleMouseLeave = () => setIsVisible(false);

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    // Smooth spring loop
    let animId: number;
    const update = () => {
      setPos((prev) => ({
        x: prev.x + (targetPos.x - prev.x) * 0.2,
        y: prev.y + (targetPos.y - prev.y) * 0.2,
      }));
      animId = requestAnimationFrame(update);
    };
    animId = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animId);
    };
  }, [targetPos]);

  if (!isVisible) return null;

  return (
    <>
      {/* Outer ambient radiant aura */}
      <div
        className="fixed top-0 left-0 pointer-events-none z-50 transition-transform duration-75 ease-out"
        style={{
          transform: `translate3d(${pos.x - (isHoveringClickable ? 32 : 20)}px, ${
            pos.y - (isHoveringClickable ? 32 : 20)
          }px, 0)`,
        }}
      >
        <div
          className={`rounded-full transition-all duration-200 ${
            isHoveringClickable
              ? 'w-16 h-16 border-2 border-[#E05326] bg-[#E05326]/15 backdrop-blur-[2px] shadow-[0_0_25px_rgba(224,83,38,0.5)] scale-110'
              : 'w-10 h-10 border border-[#E05326]/50 bg-[#E05326]/5 shadow-[0_0_15px_rgba(224,83,38,0.3)]'
          }`}
        />
      </div>

      {/* Tiny sharp white optic center point */}
      <div
        className="fixed top-0 left-0 pointer-events-none z-50"
        style={{
          transform: `translate3d(${targetPos.x - 2.5}px, ${targetPos.y - 2.5}px, 0)`,
        }}
      >
        <div className="w-1.5 h-1.5 bg-[#FFFFFF] rounded-full shadow-[0_0_8px_#FFFFFF]" />
      </div>
    </>
  );
};
