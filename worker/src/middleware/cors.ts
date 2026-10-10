/**
 * CORS middleware for UP (UPRAIL.app)
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';
import { resolveOrigin } from '../services/webauthnConfig';

export const corsMiddleware = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const origin = c.req.header('Origin');
    const configuredOrigin = resolveOrigin(c.env);

    let allowedOrigin = '';

    if (origin) {
      // Check if origin matches UPRAIL domain or configured origin or local development
      if (
        origin === configuredOrigin ||
        origin === 'https://uprail.world' ||
        origin === 'https://app.uprail.world' ||
        origin.endsWith('.uprail.world') ||
        origin === 'https://uprail.app' ||
        origin.endsWith('.uprail.app') ||
        origin === 'http://localhost:3000' ||
        origin === 'http://localhost:5173' ||
        origin === 'http://127.0.0.1:3000' ||
        origin === 'http://127.0.0.1:5173'
      ) {
        allowedOrigin = origin;
      }
    }

    // Set CORS headers if origin is allowed
    if (allowedOrigin) {
      c.header('Access-Control-Allow-Origin', allowedOrigin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      c.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, Cache-Control'
      );
      c.header('Access-Control-Max-Age', '86400');
    }

    // Handle OPTIONS preflight
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    return await next();
  };
};
