'use client';

import React from 'react';
import { Navigate, useLocation } from '../lib/router';
import { useXAuth } from '../hooks/useXAuth';
import { Loader2 } from 'lucide-react';

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
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center shadow-xs mb-4">
          <span className="font-display font-black text-base tracking-tight">UP</span>
        </div>
        <div className="flex items-center space-x-2 text-stone-500 font-mono text-xs">
          <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
          <span>Verifying access clearance...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to={`/login?return_to=${encodeURIComponent(location.pathname + location.search)}`}
        replace
        state={{ from: location }}
      />
    );
  }

  // If user does not have a passkey setup yet, direct them to complete Passkey setup
  if (user.hasPasskey === false) {
    return <Navigate to="/login" replace />;
  }

  // If first-time user who hasn't redeemed an invite code, direct to comical parking page
  if (user.isActivated === false) {
    return <Navigate to="/parking" replace />;
  }

  return <>{children}</>;
};
