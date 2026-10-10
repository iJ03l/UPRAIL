'use client';

import { Navigate, PageSuspense } from '@/lib/router';

export default function Page() {
  return (
    <PageSuspense>
      <Navigate to="/parking" replace />
    </PageSuspense>
  );
}
