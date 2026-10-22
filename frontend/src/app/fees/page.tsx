'use client';

import React from 'react';
import { Navigate, PageSuspense } from '@/lib/router';

/**
 * `/fees` is a shareable shortcut for the creator-fee tab in the claim view.
 * The canonical route lives at `/app/claim?view=fees`.
 */
export default function Page() {
  return (
    <PageSuspense>
      <Navigate to="/app/claim?view=fees" replace />
    </PageSuspense>
  );
}
