'use client';

import React from 'react';
import { GlitchLogo } from './GlitchLogo';

interface BrandLoadingScreenProps {
  message?: string;
  fullScreen?: boolean;
}

export const BrandLoadingScreen: React.FC<BrandLoadingScreenProps> = ({
  message,
  fullScreen = true,
}) => {
  return (
    <div
      className={`${
        fullScreen ? 'min-h-[100dvh]' : 'min-h-[300px]'
      } w-full bg-[#0A0807] text-[#F5F2EF] flex flex-col items-center justify-center p-6 selection:bg-[#E05326] selection:text-white`}
    >
      <div className="relative flex flex-col items-center space-y-6">
        {/* Official UPRAIL Glitch Brand Logo */}
        <div className="flex items-center justify-center p-2">
          <GlitchLogo href={false} size="lg" variant="dark" />
        </div>

        {/* Minimalist Ember Loading Track */}
        <div className="flex flex-col items-center space-y-3">
          <div className="w-28 h-1 bg-[#2C221D] rounded-full overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#E05326] to-transparent animate-pulse rounded-full" />
          </div>
          {message && (
            <p className="text-xs font-mono text-stone-400 tracking-wider uppercase">
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
