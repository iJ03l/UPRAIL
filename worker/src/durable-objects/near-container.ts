/**
 * NearContainer Durable Object - Container Lifecycle Manager
 * Controls the Go container worker runtime and proxies requests to port 8080.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

export class NearContainer extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Proxies incoming requests to the internal Go container listening on port 8080
   */
  override async fetch(request: Request): Promise<Response> {
    try {
      // 1. Check Cloudflare Containers lifecycle
      const container = (this.ctx as any).container;
      if (container) {
        if (!container.running && typeof container.start === 'function') {
          console.log('[NearContainer] Starting Go container...');
          await container.start();
        }

        // Check if container provides getTcpPort (Cloudflare Container Workers API)
        if (typeof container.getTcpPort === 'function') {
          const tcpPort = container.getTcpPort(8080);
          if (tcpPort && typeof tcpPort.fetch === 'function') {
            return await tcpPort.fetch(request);
          }
        }

        // Direct container fetch if supported
        if (typeof container.fetch === 'function') {
          return await container.fetch(request);
        }
      }

      // 2. Fallback to container port 8080 via localhost loopback or internal address.
      //    Callers (nearProxy) already produce signed, correctly-pathed requests
      //    (e.g. /internal/quote); headers and path are forwarded untouched so
      //    the Go signature still verifies. No rewriting is done here.
      const url = new URL(request.url);
      const targetUrl = new URL(url.pathname + url.search, 'http://127.0.0.1:8080');

      const headers = new Headers(request.headers);
      headers.set('Host', '127.0.0.1:8080');

      const fetchOptions: RequestInit = {
        method: request.method,
        headers,
      };

      if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
        // @ts-ignore - duplex is needed in some node/v8 fetch implementations with streaming body
        fetchOptions.duplex = 'half';
        fetchOptions.body = request.body;
      }

      const response = await fetch(targetUrl.toString(), fetchOptions);
      return response;
    } catch (err: any) {
      console.error('[NearContainer] Proxy error:', err);
      return new Response(
        JSON.stringify({
          error: `Go container proxy error: ${err.message || 'Unknown error'}`,
          code: 'CONTAINER_ERROR',
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }
}
