/**
 * Body size bounding middleware for UPRAIL Worker
 * Protects workers from memory exhaustion attacks via oversized request payloads.
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext, ErrorResponse } from '../types';

// Bounded to 256 KB — more than sufficient for signed transactions, quotes, and passkey assertions.
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

export const bodyLimit = (maxBytes: number = MAX_REQUEST_BODY_BYTES): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const tooLarge = () =>
      c.json<ErrorResponse>({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }, 413);

    // 1. Fast Content-Length check if present.
    const contentLength = c.req.header('content-length');
    if (contentLength) {
      const parsed = parseInt(contentLength, 10);
      if (!isNaN(parsed) && parsed > maxBytes) {
        return tooLarge();
      }
      return await next();
    }

    // 2. No Content-Length (chunked / streamed): a chunked request used to
    //    bypass the cap entirely. Buffer and measure, then hand the buffered
    //    bytes downstream so `c.req.json()/text()` still work.
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return await next();
    }

    try {
      const buf = await c.req.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        return tooLarge();
      }
      const rebuilt = new Request(c.req.raw.url, {
        method: c.req.raw.method,
        headers: c.req.raw.headers,
        body: buf.byteLength ? buf : undefined,
      });
      (c.req as { raw: Request }).raw = rebuilt;
    } catch {
      // Body already consumed or unreadable — let the route surface its own error.
    }

    return await next();
  };
};
