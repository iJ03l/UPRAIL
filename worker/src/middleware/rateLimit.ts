/**
 * In-memory rate limiting middleware for UP (UPRAIL.app)
 * Zero Cloudflare KV calls — eliminates KV write limits and 429 quota errors.
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';

export interface RateLimitOptions {
  limit?: number; // max requests per minute (default 60)
  prefix?: string; // route-specific prefix
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

    // 3. Higher allowance for authenticated sessions
    const hasSessionCookie = !!c.req.header('cookie')?.includes('uprail_session');
    const effectiveLimit = hasSessionCookie ? Math.max(defaultLimit, 600) : defaultLimit;

    // Extract client IP address
    const ip =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-real-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
      '127.0.0.1';

    const now = Date.now();
    const key = `rl:${prefix}:${ip}`;

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
