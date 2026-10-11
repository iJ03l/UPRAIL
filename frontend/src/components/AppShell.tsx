'use client';

import React, { Suspense } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppLayout } from '@/components/AppLayout';

/**
 * Client shell for every /app/* route: auth gate + app chrome around the
 * page. Kept in a client component so the route layout itself can stay a
 * server component and export share-card metadata.
 */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <Suspense fallback={null}>
      <ProtectedRoute>
        <AppLayout>{children}</AppLayout>
      </ProtectedRoute>
    </Suspense>
  );
};
