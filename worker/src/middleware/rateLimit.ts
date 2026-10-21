/**
 * In-memory rate limiting middleware for UP (UPRAIL.app)
 * Zero Cloudflare KV calls — eliminates KV write limits and 429 quota errors.
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';

export interface RateLimitOptions {
  limit?: number; // max requests per minute (default 60)
  prefix?: string; // route-specific prefix
  /** Keep the strict limit even for authenticated sessions. */
  strict?: boolean;
}

interface WindowRecord {
  count: number;
  resetAt: number;
}

// In-memory rate limiting map per worker isolate
const rateLimitMap = new Map<string, WindowRecord>();

// Clean expired records periodically
function pruneExpiredRecords() {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (record.resetAt <= now) {
      rateLimitMap.delete(key);
    }
  }
}

export const rateLimit = (options?: RateLimitOptions): MiddlewareHandler<AppContext> => {
  const defaultLimit = options?.limit ?? 300;
  const prefix = options?.prefix ?? 'default';

  return async (c, next) => {
    // 1. Bypass CORS preflight
    if (c.req.method === 'OPTIONS') {
      return await next();
    }

    const pathname = c.req.path.toLowerCase();

    // 2. Bypass static assets and direct SPA page document routes
    if (
      pathname.startsWith('/assets/') ||
      pathname.endsWith('.js') ||
      pathname.endsWith('.css') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.svg') ||
      pathname.endsWith('.ico') ||
      pathname.endsWith('.jpg') ||
      pathname.endsWith('.woff') ||
      pathname.endsWith('.woff2') ||
      pathname.endsWith('.map') ||
      // Standard SPA document routes
      pathname === '/' ||
      pathname === '/app' ||
      pathname === '/app/' ||
      (pathname.startsWith('/app/') && !pathname.startsWith('/api/')) ||
      pathname === '/login' ||
      pathname === '/parking'
    ) {
      return await next();
    }

    // 3. Key on the VERIFIED session identity whenever one is present.
    //    sessionMiddleware() runs upstream and HMAC-verifies the cookie, so
    //    session.x_id cannot be spoofed by the client. Anonymous traffic falls
    //    back to the edge IP that Cloudflare sets — never to client-supplied
    //    forwarding headers (x-real-ip / x-forwarded-for are spoofable).
    const session = c.get('session');
    const subject = session?.x_id
      ? `u:${session.x_id}`
      : `ip:${c.req.header('cf-connecting-ip') || 'unknown'}`;
    const effectiveLimit =
      session && !options?.strict ? Math.max(defaultLimit, 600) : defaultLimit;

    const now = Date.now();
    const key = `rl:${prefix}:${subject}`;

    let record = rateLimitMap.get(key);

    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + 60000 };
      rateLimitMap.set(key, record);
    } else {
      record.count += 1;
    }

    // Prune map if large
    if (rateLimitMap.size > 2000) {
      pruneExpiredRecords();
    }

    const remaining = Math.max(0, effectiveLimit - record.count);

    c.header('X-RateLimit-Limit', effectiveLimit.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());

    if (record.count > effectiveLimit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      c.header('Retry-After', retryAfterSeconds.toString());

      return c.json(
        {
          error: 'Too many requests. Rate limit exceeded.',
          code: 'RATE_LIMITED',
        },
        429
      );
    }

    return await next();
  };
};
