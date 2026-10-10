/**
 * Security headers middleware for UPRAIL Worker
 * Enforces defense-in-depth HTTP headers on all responses.
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';

export const securityHeaders = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    await next();

    // Prevent MIME-sniffing
    if (!c.res.headers.has('X-Content-Type-Options')) {
      c.res.headers.set('X-Content-Type-Options', 'nosniff');
    }
    // Anti-clickjacking
    if (!c.res.headers.has('X-Frame-Options')) {
      c.res.headers.set('X-Frame-Options', 'DENY');
    }
    // Referrer policy
    if (!c.res.headers.has('Referrer-Policy')) {
      c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    }
    // Restrict unnecessary browser capabilities
    if (!c.res.headers.has('Permissions-Policy')) {
      c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    }
    // HTTP Strict Transport Security
    if (!c.res.headers.has('Strict-Transport-Security')) {
      c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
  };
};
