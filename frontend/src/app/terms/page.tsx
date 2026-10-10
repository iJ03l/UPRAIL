'use client';

import React from 'react';
import { LoginPage } from '@/views/LoginPage';
import { PageSuspense } from '@/lib/router';

export default function Page() {
  return (
    <PageSuspense>
      <LoginPage initialLegalTab="terms" />
    </PageSuspense>
  );
}
