'use client';

import React from 'react';
import { PublicCoffeeView } from '@/views/PublicCoffeeView';
import { PageSuspense } from '@/lib/router';

export default function Page() {
  return (
    <PageSuspense>
      <PublicCoffeeView />
    </PageSuspense>
  );
}
