'use client';

import React from 'react';
import { ParkingPage } from '@/views/ParkingPage';
import { PageSuspense } from '@/lib/router';

export default function Page() {
  return (
    <PageSuspense>
      <ParkingPage />
    </PageSuspense>
  );
}
