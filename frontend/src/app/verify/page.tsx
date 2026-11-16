'use client';

import React from 'react';
import { VerifyPage } from '@/views/VerifyPage';
import { PageSuspense } from '@/lib/router';

export default function Page() {
  return (
    <PageSuspense>
      <VerifyPage />
    </PageSuspense>
  );
}
