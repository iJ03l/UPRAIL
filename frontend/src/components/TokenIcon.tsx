import React, { useState } from 'react';
import { getOnchainIcon } from '../lib/onchainIcons';

// NEAR official black & white vector SVG
const NEAR_SVG_DATA = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="50" fill="%23000000"/><g transform="translate(19,19) scale(0.69)" fill="white"><path d="M72.2,4.6L53.4,32.5c-1.3,1.9,1.2,4.2,3,2.6L74.9,19c0.5-0.4,1.2-0.1,1.2,0.6v50.3c0,0.7-0.9,1-1.3,0.5l-56-67C17,1.2,14.4,0,11.5,0h-2C4.3,0,0,4.3,0,9.6v70.8C0,85.7,4.3,90,9.6,90c3.3,0,6.4-1.7,8.2-4.6l18.8-27.9c1.3-1.9-1.2-4.2-3-2.6l-18.5,16c-0.5,0.4-1.2,0.1-1.2-0.6V20.1c0-0.7,0.9-1,1.3-0.5l56,67c1.8,2.2,4.5,3.4,7.3,3.4h2c5.3,0,9.6-4.3,9.6-9.6V9.6c0-5.3-4.3-9.6-9.6-9.6C77.1,0,74,1.7,72.2,4.6z"/></g></svg>`;

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
