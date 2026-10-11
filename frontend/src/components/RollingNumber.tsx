'use client';

import React, { useEffect, useRef, useState } from 'react';

interface RollingNumberProps {
  /** Current value. `null` renders the fallback (e.g. "—") with no motion. */
  value: number | null;
  /** Formatter applied to the animated value each frame. */
  format: (v: number) => string;
  /** Rendered when value is null/undefined/NaN. */
  fallback?: string;
  durationMs?: number;
  className?: string;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Slot-machine style number: when the value changes the digits roll from the
 * previous figure to the new one instead of snapping.
 */
export const RollingNumber: React.FC<RollingNumberProps> = ({
  value,
  format,
  fallback = '—',
  durationMs = 650,
  className = '',
}) => {
  const [display, setDisplay] = useState(() => (typeof value === 'number' && isFinite(value) ? value : null));
  const fromRef = useRef<number | null>(display);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const to = typeof value === 'number' && isFinite(value) ? value : null;

    if (to === null) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      fromRef.current = null;
      setDisplay(null);
      return;
    }

    const from = fromRef.current;
    // First paint — nothing to roll from.
    if (from === null || from === to) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const next = from + (to - from) * easeOutCubic(t);
      setDisplay(next);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        fromRef.current = to;
        setDisplay(to);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [value, durationMs]);

  return (
    <span className={className} aria-live="polite">
      {display === null ? fallback : format(display)}
    </span>
  );
};
