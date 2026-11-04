'use client';

import React from 'react';
import { PublicRequestView } from '@/views/PublicRequestView';
import { PageSuspense } from '@/lib/router';

export default function Page() {
  return (
    <PageSuspense>
      <PublicRequestView />
    </PageSuspense>
  );
}
