import { OAuthResourceServer } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../types';
import { getAgentKeyById, findAgentKeyByRawKey, looksLikeAgentKey } from '../services/agentKeys';
import { resolveAgentPrincipal } from '../middleware/agentAuth';
import { handleMcpRequest } from '../routes/mcp';
import { OAUTH_SCOPES, getAuthorizationServer, getOAuthConfig } from './authorization';

interface McpTokenProps {
  agentKeyId: string;
}

const resourceCache = new Map<string, OAuthResourceServer<Env, McpTokenProps>>();

function authError(status: 401 | 403, code: string, message: string, request: Request): Response {
  const metadataUrl = `${new URL(request.url).origin}/.well-known/oauth-protected-resource/api/mcp`;
  return Response.json(
    { error: message, code },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'WWW-Authenticate': `Bearer error="invalid_token", error_description="${message}", resource_metadata="${metadataUrl}"`,
      },
    }
  );
}

export function getResourceServer(env: Env): OAuthResourceServer<Env, McpTokenProps> {
  const { issuer, resource } = getOAuthConfig(env);
  const cacheKey = `${issuer}|${resource}`;
  const cached = resourceCache.get(cacheKey);
  if (cached) return cached;

  const resourceServer = new OAuthResourceServer<Env, McpTokenProps>({
    resourceMetadata: {
      resource,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      resource_name: 'UPRAIL MCP',
    },
    requiredScopes: OAUTH_SCOPES,
    validateToken: (tokenEnv) => async (audience, token) => {
      const oauth = await getAuthorizationServer(tokenEnv).validateToken<McpTokenProps>(
        audience,
        token,
        tokenEnv
      );
      if (oauth?.props?.agentKeyId) {
        return {
          props: { agentKeyId: oauth.props.agentKeyId },
          audience: oauth.audience,
          expiresAt: oauth.expiresAt,
          scope: oauth.scope,
          userId: oauth.userId,
          clientId: oauth.clientId,
        };
      }

      if (!looksLikeAgentKey(token)) return null;
      try {
        const row = await findAgentKeyByRawKey(tokenEnv, token);
        if (!row) return null;
        return {
          props: { agentKeyId: row.id },
          audience,
          expiresAt: row.expires_at ? Math.floor(row.expires_at / 1000) : undefined,
          scope: OAUTH_SCOPES,
          userId: row.x_id,
          clientId: 'legacy-key',
        };
      } catch (err) {
        console.warn('[oauth] legacy key validation failed:', err);
        return null;
      }
    },
    handler: {
      async fetch(request, handlerEnv, ctx) {
        const keyId = ctx.props?.agentKeyId;
        if (!keyId) return authError(401, 'AGENT_KEY_REQUIRED', 'Agent key required.', request);

        const row = await getAgentKeyById(handlerEnv, keyId);
        if (!row) {
          return authError(401, 'AGENT_KEY_INVALID', 'This connection no longer exists.', request);
        }

        const resolved = await resolveAgentPrincipal(handlerEnv, row, { executionCtx: ctx });
        if (!resolved.ok) {
          return authError(resolved.status, resolved.code, resolved.message, request);
        }

        return await handleMcpRequest(
          request,
          handlerEnv,
          ctx,
          resolved.session,
          resolved.agent
        );
      },
    },
  });

  resourceCache.set(cacheKey, resourceServer);
  return resourceServer;
}
