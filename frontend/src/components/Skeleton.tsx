'use client';

import React from 'react';

/**
 * Shimmer placeholder block. Wrap content areas (rows, chips, numbers) while a
 * first load is in flight so the page never pops from empty to full.
 */
export const Skeleton: React.FC<{
  className?: string;
  /** Optional rounded shape helper — pass a Tailwind height/width combo. */
  variant?: 'text' | 'chip' | 'row' | 'circle';
}> = ({ className = '', variant = 'text' }) => {
  const base = 'animate-pulse bg-stone-200/80 block';
  const shapes: Record<string, string> = {
    text: 'h-3 rounded-md',
    chip: 'h-7 rounded-xl',
    row: 'h-12 rounded-2xl',
    circle: 'rounded-full',
  };
  return <span className={`${base} ${shapes[variant]} ${className}`} aria-hidden="true" />;
};

/**
 * A block of skeleton lines used for list placeholders.
 */
export const SkeletonList: React.FC<{ rows?: number; className?: string }> = ({
  rows = 3,
  className = '',
}) => (
  <div className={`space-y-2 ${className}`} aria-hidden="true">
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} variant="row" />
    ))}
  </div>
);
