'use client';

import React from 'react';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--fg)] text-[var(--bg)]',
  ok: 'bg-[#047857] text-white dark:bg-[#34d399] dark:text-[#06281d]',
  warn: 'bg-[#b45309] text-white dark:bg-[#fbbf24] dark:text-[#2a1a02]',
  danger: 'bg-[#b91c1c] text-white dark:bg-[#f87171] dark:text-[#2a0606]',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Unified solid flat badge (22 px tall, zero border/gradient/translucency)
 * with high-contrast light and dark semantic tones.
 */
export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  icon,
  children,
  className = '',
  ...rest
}) => (
  <span
    className={`inline-flex h-[22px] items-center gap-[5px] rounded-full px-[9px] font-mono text-[11px] font-bold uppercase tracking-[0.04em] leading-none whitespace-nowrap flex-shrink-0 ${TONE_CLASSES[tone]} ${className}`.trim()}
    {...rest}
  >
    {icon && <span className="inline-flex items-center justify-center w-3 h-3 flex-shrink-0">{icon}</span>}
    <span>{children}</span>
  </span>
);
