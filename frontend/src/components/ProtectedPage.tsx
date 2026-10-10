'use client';

import React from 'react';
import { PageSuspense } from '../lib/router';
import { ProtectedRoute } from './ProtectedRoute';
import { AppLayout } from './AppLayout';

interface ProtectedPageProps {
  children: React.ReactNode;
}

/**
 * The standard shell for every authenticated app route:
 * Suspense (required by the router hooks) → auth gate → app chrome.
 */
export const ProtectedPage: React.FC<ProtectedPageProps> = ({ children }) => (
  <PageSuspense>
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  </PageSuspense>
);
