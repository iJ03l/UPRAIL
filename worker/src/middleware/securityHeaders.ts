/**
 * Security headers middleware for UPRAIL Worker
 * Enforces defense-in-depth HTTP headers on all responses.
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';

export const securityHeaders = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    await next();

    if (!c.res) return;

    const applyHeaders = (headers: Headers) => {
      if (!headers.has('X-Content-Type-Options')) {
        headers.set('X-Content-Type-Options', 'nosniff');
      }
      if (!headers.has('X-Frame-Options')) {
        headers.set('X-Frame-Options', 'DENY');
      }
      if (!headers.has('Referrer-Policy')) {
        headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      }
      if (!headers.has('Permissions-Policy')) {
        headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      }
      if (!headers.has('Strict-Transport-Security')) {
        headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
      }
    };

    try {
      applyHeaders(c.res.headers);
    } catch {
      // If c.res has immutable headers (e.g. static assets returned by env.ASSETS.fetch),
      // re-construct response with a mutable Headers instance.
      const newHeaders = new Headers(c.res.headers);
      applyHeaders(newHeaders);
      c.res = new Response(c.res.body, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: newHeaders,
      });
    }
  };
};
