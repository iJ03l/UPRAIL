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
    return null;
  }

  return isAppDomain ? (
    <ProtectedPage>
      <AppHome />
    </ProtectedPage>
  ) : (
    <LandingPage />
  );
}
