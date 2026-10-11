'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

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
        fullScreen ? 'min-h-[100dvh]' : 'min-h-[240px]'
      } w-full bg-stone-50 text-stone-900 flex flex-col items-center justify-center p-6`}
    >
      <div className="flex flex-col items-center space-y-3">
        <Loader2 className="w-5 h-5 animate-spin text-stone-700" />
        {message && (
          <p className="text-xs font-mono text-stone-500 tracking-wide">
            {message}
          </p>
        )}
      </div>
    </div>
  );
};
