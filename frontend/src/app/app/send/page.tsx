'use client';

import { PageSuspense } from '@/lib/router';
import { SendPage } from '@/views/SendPage';

export default function Page() {
  return (
    <PageSuspense>
      <SendPage />
    </PageSuspense>
  );
}
