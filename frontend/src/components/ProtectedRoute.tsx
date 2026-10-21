'use client';

import React from 'react';
import { Navigate, useLocation } from '../lib/router';
import { useXAuth } from '../hooks/useXAuth';
import { clearInvite, inviteFromSearch, withInvite } from '../lib/invite';
import { AuthLoadingScreen } from './AuthLoadingScreen';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute — Strict Multi-Stage Authentication & Access Gate
 *
 * 1. Unauthenticated: Redirects to /login (Step 1: Connect with 𝕏)
 * 2. 𝕏 connected but passkey not confirmed: Redirects to /login
 * 3. Passkey setup but Unactivated (First-time user): Redirects to /parking
 * 4. Verified, activated user: Renders children (/app)
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, isLoading } = useXAuth();
  const location = useLocation();

  if (isLoading) {
    return <AuthLoadingScreen message="Checking your session" />;
  }

  // Any invite that arrived with this URL is remembered before we bounce, so
  // the share link's ref code survives the redirect chain untouched. Activated
  // accounts are done onboarding, so drop it instead of re-persisting it.
  if (user?.isActivated) clearInvite();
  else inviteFromSearch(location.search);
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

  // X OAuth alone is not enough: the session must also have answered a
  // passkey (or consumed a recovery code) before any app page renders.
  if (user.hasPasskey !== true || user.passkeyVerified !== true) {
    return <Navigate to={withInvite(`/login?return_to=${returnTo}`)} replace />;
  }

  // If first-time user who hasn't redeemed an invite code, direct to comical parking page
  if (user.isActivated === false) {
    return <Navigate to={withInvite('/parking')} replace />;
  }

  return <>{children}</>;
};
