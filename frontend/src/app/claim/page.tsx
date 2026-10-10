'use client';

import React from 'react';
import { ClaimPage } from '@/views/ClaimPage';
import { Navigate, useLocation, PageSuspense } from '@/lib/router';
import { ProtectedPage } from '@/components/ProtectedPage';

function ClaimRoute() {
  const { pathname } = useLocation();
  const tail = pathname.replace(/^\/claim\/?/, '').replace(/\/$/, '');
  const hasId = /^[A-Za-z0-9_-]{1,64}$/.test(tail);

  if (!hasId) {
    return <Navigate to="/app/claim" replace />;
  }

  return (
    <ProtectedPage>
      <ClaimPage />
    </ProtectedPage>
  );
}

/**
 * `/claim`             → canonical app route (/app/claim)
 * `/claim/<paymentId>` → share-link deep link, rendered here (the Worker
 *                        rewrites that path onto this static page).
 *
 * Everything sits under PageSuspense because the router hooks call
 * useSearchParams, which Next requires a Suspense boundary around.
 */
export default function Page() {
  return (
    <PageSuspense>
      <ClaimRoute />
    </PageSuspense>
  );
}
