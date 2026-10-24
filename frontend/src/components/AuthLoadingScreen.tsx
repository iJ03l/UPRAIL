'use client';

import React from 'react';
import { GlitchLogo } from './GlitchLogo';

interface AuthLoadingScreenProps {
  message?: string;
  hint?: string;
}

export const AuthLoadingScreen: React.FC<AuthLoadingScreenProps> = ({
  message = 'Checking your session',
  hint = 'This only takes a moment.',
}) => {
  return (
    <div className="min-h-[100dvh] w-full bg-surface text-ink flex flex-col items-center justify-center px-6 font-sans">
      <div className="flex flex-col items-center gap-6 text-center">
        <GlitchLogo href={false} size="lg" />
        <div className="flex items-center gap-2.5">
          <span className="w-4 h-4 rounded-full border-2 border-ink border-t-transparent animate-spin" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            {message}
          </span>
        </div>
        {hint && <p className="text-xs text-subtle max-w-xs">{hint}</p>}
      </div>
    </div>
  );
};
