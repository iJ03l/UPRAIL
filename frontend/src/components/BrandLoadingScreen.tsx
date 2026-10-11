'use client';

import React from 'react';

interface BrandLoadingScreenProps {
  message?: string;
  fullScreen?: boolean;
}

/**
 * BrandLoadingScreen — rendered null to completely eliminate artificial
 * loading overlays and flash states across all navigation and auth checks.
 */
export const BrandLoadingScreen: React.FC<BrandLoadingScreenProps> = () => {
  return null;
};
