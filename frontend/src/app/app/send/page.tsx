'use client';

import { SendPage } from '@/views/SendPage';
import { ProtectedPage } from '@/components/ProtectedPage';

export default function Page() {
  return (
    <ProtectedPage>
      <SendPage />
    </ProtectedPage>
  );
}
