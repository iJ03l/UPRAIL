'use client';

import React, { Suspense } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppLayout } from '@/components/AppLayout';
import { ClaimPage } from '@/views/ClaimPage';
import { Loader2 } from 'lucide-react';

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-50 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-stone-900" />
        </div>
      }
    >
      <ProtectedRoute>
        <AppLayout>
          <ClaimPage />
        </AppLayout>
      </ProtectedRoute>
    </Suspense>
  );
}
