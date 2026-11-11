'use client';

import React from 'react';
import { PublicGiftView } from '@/views/PublicGiftView';
import { PageSuspense } from '@/lib/router';

export default function Page() {
  return (
    <PageSuspense>
      <PublicGiftView />
    </PageSuspense>
  );
}
