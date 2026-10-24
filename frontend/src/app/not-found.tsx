'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center font-mono text-xs text-stone-500">
      Page not found — taking you home...
    </div>
  );
}
