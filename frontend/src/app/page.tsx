'use client';

import React, { useEffect, useState } from 'react';
import { LandingPage } from '@/views/LandingPage';
import { AppHome } from '@/views/AppHome';
import { ProtectedPage } from '@/components/ProtectedPage';

/**
 * `/` renders the public landing page everywhere except on the app subdomain,
 * where it is the authenticated dashboard.
 */
export default function Page() {
  const [isAppDomain, setIsAppDomain] = useState<boolean | null>(null);

  useEffect(() => {
    setIsAppDomain(window.location.hostname.startsWith('app.'));
  }, []);

  if (isAppDomain === null) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center shadow-xs">
          <span className="font-display font-black text-base tracking-tight">UP</span>
        </div>
      </div>
    );
  }

  return isAppDomain ? (
    <ProtectedPage>
      <AppHome />
    </ProtectedPage>
  ) : (
    <LandingPage />
  );
}
