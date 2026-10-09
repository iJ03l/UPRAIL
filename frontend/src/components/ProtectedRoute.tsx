'use client';

import React from 'react';
import { Navigate, useLocation } from '../lib/router';
import { useXAuth } from '../hooks/useXAuth';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute — Strict Authentication Gate
 *
 * Ensures NO ONE can access any dashboard page without an active,
 * authenticated 𝕏 session.
 *
 * - While validating session: shows minimal branded splash
 * - If unauthenticated: immediately redirects to /login with return path
 * - If authenticated: renders protected dashboard children
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
          <span>Verifying 𝕏 authentication...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    // Preserve attempted destination to redirect back after login
    return (
      <Navigate
        to={`/login?return_to=${encodeURIComponent(location.pathname + location.search)}`}
        replace
        state={{ from: location }}
      />
    );
  }

  return <>{children}</>;
};
