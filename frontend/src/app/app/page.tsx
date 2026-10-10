'use client';

import { AppHome } from '@/views/AppHome';
import { ProtectedPage } from '@/components/ProtectedPage';

export default function Page() {
  return (
    <ProtectedPage>
      <AppHome />
    </ProtectedPage>
  );
}
