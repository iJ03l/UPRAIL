'use client';

import { PageSuspense } from '@/lib/router';
import { CirclesView } from '@/views/CirclesView';

export default function Page() {
  return (
    <PageSuspense>
      <CirclesView />
    </PageSuspense>
  );
}
