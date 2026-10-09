import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware for Subdomain and Path Routing
 *
 * - uprail.world -> Serves Landing Page on `/`
 * - app.uprail.world -> Rewrites root `/` to `/app` (Protected Dashboard)
 */
export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const url = request.nextUrl.clone();

  // If request arrives at app.uprail.world root '/', rewrite to '/app'
  if (hostname.startsWith('app.') && url.pathname === '/') {
    url.pathname = '/app';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
