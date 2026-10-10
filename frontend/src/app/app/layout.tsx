'use client';

import React, { Suspense } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppLayout } from '@/components/AppLayout';
import { BrandLoadingScreen } from '@/components/BrandLoadingScreen';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<BrandLoadingScreen message="Loading secure railway..." />}>
      <ProtectedRoute>
        <AppLayout>{children}</AppLayout>
      </ProtectedRoute>
    </Suspense>
  );
}
