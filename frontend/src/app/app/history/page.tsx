'use client';

import { HistoryPage } from '@/views/HistoryPage';
import { ProtectedPage } from '@/components/ProtectedPage';

export default function Page() {
  return (
    <ProtectedPage>
      <HistoryPage />
    </ProtectedPage>
  );
}
