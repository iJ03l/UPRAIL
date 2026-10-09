import React, { useState } from 'react';
import { getOnchainIcon } from '../lib/onchainIcons';

// NEAR official black & white vector SVG
const NEAR_SVG_DATA = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"><rect width="100" height="100" rx="50" fill="%23000000"/><path d="M69.75 30.25L54.75 51.5L71.25 72.5H62.75L49.5 55.75L37.25 72.5H28.75L45.25 50L30.25 30.25H38.75L51 46.25L62.25 30.25H69.75Z" fill="white"/></svg>`;

// Color palette for deterministic fallback badges
const BADGE_COLORS = [
  'bg-emerald-900 text-emerald-200 border-emerald-800',
  'bg-indigo-900 text-indigo-200 border-indigo-800',
  'bg-amber-900 text-amber-200 border-amber-800',
  'bg-rose-900 text-rose-200 border-rose-800',
  'bg-violet-900 text-violet-200 border-violet-800',
  'bg-cyan-900 text-cyan-200 border-cyan-800',
  'bg-stone-900 text-stone-200 border-stone-800',
];

function getBadgeColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % BADGE_COLORS.length;
  return BADGE_COLORS[idx];
}

interface TokenIconProps {
  symbol: string;
  iconUrl?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | number;
  className?: string;
}

export const TokenIcon: React.FC<TokenIconProps> = ({
  symbol,
  iconUrl,
  size = 'md',
  className = '',
}) => {
  const [hasError, setHasError] = useState(false);

  const cleanSymbol = (symbol || '').trim();
  const lowerSymbol = cleanSymbol.toLowerCase();

  // Resolve authentic onchain icon directly from contract metadata
  let resolvedUrl: string | undefined = undefined;

  if (iconUrl && !iconUrl.includes('cryptologos.cc') && !iconUrl.includes('jsdelivr.net')) {
    resolvedUrl = iconUrl;
  } else if (lowerSymbol === 'near' || lowerSymbol === 'wnear') {
    resolvedUrl = getOnchainIcon('near') || NEAR_SVG_DATA;
  } else {
    resolvedUrl = getOnchainIcon(lowerSymbol);
  }

  // Dimension mapping
  let dimClasses = 'w-5 h-5 text-[9px]';
  if (size === 'sm') dimClasses = 'w-4 h-4 text-[8px]';
  else if (size === 'md') dimClasses = 'w-5 h-5 text-[9px]';
  else if (size === 'lg') dimClasses = 'w-7 h-7 text-xs';
  else if (size === 'xl') dimClasses = 'w-9 h-9 text-xs';

  if (!resolvedUrl || hasError) {
    const badgeColor = getBadgeColor(cleanSymbol);
    const displayAbbr = cleanSymbol.slice(0, 3).toUpperCase();
    return (
      <div
        className={`rounded-full flex items-center justify-center font-mono font-bold border flex-shrink-0 select-none ${dimClasses} ${badgeColor} ${className}`}
        title={cleanSymbol}
      >
        <span>{displayAbbr}</span>
      </div>
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={cleanSymbol}
      onError={() => setHasError(true)}
      className={`rounded-full object-cover flex-shrink-0 bg-stone-100 border border-stone-200 select-none ${dimClasses} ${className}`}
      loading="lazy"
    />
  );
};
