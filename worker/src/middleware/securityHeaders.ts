/**
 * Security headers middleware for UPRAIL Worker
 * Enforces defense-in-depth HTTP headers on all responses.
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';

/**
 * Content-Security-Policy for the app.
 *
 * Deliberate trade-offs:
 *  - `script-src 'unsafe-inline'` is required because Next's static export
 *    ships its hydration bootstrap as inline scripts; a nonce cannot be added
 *    to static HTML. This still blocks cross-origin script loads, and the
 *    `connect-src`/`img-src`/`frame-ancestors` directives contain most of the
 *    damage an injected script could do. Tightening to hashes is a follow-up.
 *  - `img-src ... https:` because token icons are served from whatever CDN
 *    the live token registry reports (`image.mitte.gg`, `1click…`, etc).
 *  - Styles come from Next + `<link>` fonts hosted on Google/Fontshare.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com",
  "font-src 'self' data: https://fonts.gstatic.com https://api.fontshare.com https://cdn.fontshare.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://cloudflareinsights.com",
  "media-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

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
      if (!headers.has('Content-Security-Policy')) {
        headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
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
