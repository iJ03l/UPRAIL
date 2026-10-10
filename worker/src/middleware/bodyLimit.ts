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
    // 1. Fast Content-Length check if present
    const contentLength = c.req.header('content-length');
    if (contentLength) {
      const parsed = parseInt(contentLength, 10);
      if (!isNaN(parsed) && parsed > maxBytes) {
        return c.json<ErrorResponse>(
          { error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' },
          413
        );
      }
    }

    return await next();
  };
};
