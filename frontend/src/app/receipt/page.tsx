'use client';

import React from 'react';
import { ReceiptPage } from '@/views/ReceiptPage';
import { Navigate, useLocation, PageSuspense } from '@/lib/router';

function ReceiptRoute() {
  const { pathname } = useLocation();
  const tail = pathname.replace(/^\/receipt\/?/, '').replace(/\/$/, '');
  const id = /^wth_[A-Za-z0-9-]{1,64}$/.test(tail) ? tail : '';

  if (!id) {
    return <Navigate to="/" replace />;
  }

  return <ReceiptPage id={id} />;
}

/**
 * `/receipt/<withdrawalId>` → public wallet-send receipt. The Worker rewrites
 * that path onto this static page, which reads the id from the URL.
 */
export default function Page() {
  return (
    <PageSuspense>
      <ReceiptRoute />
    </PageSuspense>
  );
}
