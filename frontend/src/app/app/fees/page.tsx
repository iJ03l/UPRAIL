'use client';

import { Navigate } from '@/lib/router';

/**
 * Creator fees now live as a tab inside `/app/claim`. Keep this route as a
 * redirect for old bookmarks and links.
 */
export default function Page() {
  return <Navigate to="/app/claim?view=fees" replace />;
}
