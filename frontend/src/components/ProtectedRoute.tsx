'use client';

import React from 'react';
import { Navigate, useLocation } from '../lib/router';
import { useXAuth } from '../hooks/useXAuth';
import { inviteFromSearch, withInvite } from '../lib/invite';
import { Loader2 } from 'lucide-react';

import { BrandLoadingScreen } from './BrandLoadingScreen';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute — Strict Multi-Stage Authentication & Access Gate
 *
 * 1. Unauthenticated: Redirects to /login (Step 1: Connect with 𝕏)
 * 2. 𝕏 connected but No Passkey: Redirects to /login (Step 2: Create Passkey)
 * 3. Passkey setup but Unactivated (First-time user): Redirects to /parking
 * 4. Activated user: Renders children (/app)
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, isLoading } = useXAuth();
  const location = useLocation();

  if (isLoading) {
    return <BrandLoadingScreen message="Verifying access clearance..." />;
  }

  // Any invite that arrived with this URL is remembered before we bounce, so
  // the share link's ref code survives the redirect chain untouched.
  inviteFromSearch(location.search);
  const returnTo = encodeURIComponent(location.pathname + location.search);

  if (!user) {
    return (
      <Navigate
        to={withInvite(`/login?return_to=${returnTo}`)}
        replace
        state={{ from: location }}
      />
    );
  }

  // If user does not have a passkey setup yet, direct them to complete Passkey setup
  if (user.hasPasskey === false) {
    return <Navigate to={withInvite(`/login?return_to=${returnTo}`)} replace />;
  }

  // If first-time user who hasn't redeemed an invite code, direct to comical parking page
  if (user.isActivated === false) {
    return <Navigate to={withInvite('/parking')} replace />;
  }

  return <>{children}</>;
};
