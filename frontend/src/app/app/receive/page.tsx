'use client';

import { ReceivePage } from '@/views/ReceivePage';
import { ProtectedPage } from '@/components/ProtectedPage';

export default function Page() {
  return (
    <ProtectedPage>
      <ReceivePage />
    </ProtectedPage>
  );
}
