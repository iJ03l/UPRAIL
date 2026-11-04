'use client';

import { PageSuspense } from '@/lib/router';
import { RequestMoneyPage } from '@/views/RequestMoneyPage';

export default function Page() {
  return (
    <PageSuspense>
      <RequestMoneyPage />
    </PageSuspense>
  );
}
