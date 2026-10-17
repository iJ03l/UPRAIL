'use client';

import React from 'react';
import { Navigate, PageSuspense } from '@/lib/router';

/**
 * `/fees` is a shareable shortcut for the creator-fee claim view. The canonical
 * route lives at `/app/fees` (inside the authenticated app shell).
 */
export default function Page() {
  return (
    <PageSuspense>
      <Navigate to="/app/fees" replace />
    </PageSuspense>
  );
}
