'use client';

import { ClaimPage } from '@/views/ClaimPage';
import { ProtectedPage } from '@/components/ProtectedPage';

export default function Page() {
  return (
    <ProtectedPage>
      <ClaimPage />
    </ProtectedPage>
  );
}
