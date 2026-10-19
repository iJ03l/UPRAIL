/**
 * CORS middleware for UP (UPRAIL.app)
 *
 * - Cookie-authenticated app routes strictly allow only UPRAIL origins (with credentials).
 * - Stateless Bearer/key-authenticated AI chat routes (`/api/mcp`, `/api/agent/pay`,
 *   `/api/agent/receive`, `/api/agent/balance`, `/api/agent/payments`,
 *   `/api/agent/openapi.json`) allow any origin (`*`) without credentials so
 *   web-based AI chat interfaces (OpenAI, Claude, Grok, Meta Muse, etc.) can
 *   connect directly without CORS errors.
 */

import { MiddlewareHandler } from 'hono';
import type { AppContext } from '../types';
import { resolveOrigin } from '../services/webauthnConfig';

function isStatelessAiChatRoute(path: string): boolean {
  if (path === '/api/mcp' || path.startsWith('/api/mcp/')) return true;
  if (path.startsWith('/api/agent/') && !path.startsWith('/api/agent/keys')) return true;
  return false;
}

export const corsMiddleware = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const origin = c.req.header('Origin');
    const path = new URL(c.req.url).pathname;

    if (isStatelessAiChatRoute(path)) {
      c.header('Access-Control-Allow-Origin', '*');
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      c.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Agent-Key, X-API-Key, Mcp-Session-Id, MCP-Protocol-Version, Accept, Cache-Control'
      );
      c.header('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');
      c.header('Access-Control-Max-Age', '86400');

      if (c.req.method === 'OPTIONS') {
        return c.body(null, 204);
      }
      return await next();
    }

    const configuredOrigin = resolveOrigin(c.env);
    let allowedOrigin = '';

    if (origin) {
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

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    return await next();
  };
};
