/**
 * Per-IP rate limiting middleware using Cloudflare KV for UP (UPRAIL.app)
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';

export interface RateLimitOptions {
  limit?: number; // max requests per minute (default 60)
  prefix?: string; // route-specific prefix
}

export const rateLimit = (options?: RateLimitOptions): MiddlewareHandler<AppContext> => {
  const limit = options?.limit ?? 60;
  const prefix = options?.prefix ?? 'default';

  return async (c, next) => {
    // Extract client IP address
    const ip =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-real-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
      '127.0.0.1';

    // 1-minute fixed window
    const currentMinute = Math.floor(Date.now() / 60000);
    const key = `rl:${prefix}:${ip}:${currentMinute}`;

    try {
      const rawCount = await c.env.CACHE.get(key);
      const count = rawCount ? parseInt(rawCount, 10) : 0;

      if (count >= limit) {
        c.header('Retry-After', '60');
        c.header('X-RateLimit-Limit', limit.toString());
        c.header('X-RateLimit-Remaining', '0');

        return c.json(
          {
            error: 'Too many requests. Rate limit exceeded.',
            code: 'RATE_LIMITED',
          },
          429
        );
      }

      // Increment count and store with 120s TTL
      await c.env.CACHE.put(key, (count + 1).toString(), {
        expirationTtl: 120,
      });

      c.header('X-RateLimit-Limit', limit.toString());
      c.header('X-RateLimit-Remaining', (limit - (count + 1)).toString());
    } catch (err) {
      console.error('Rate limiting error:', err);
      // Fail-open on KV error to prevent blocking legitimate traffic
    }

    return await next();
  };
};
