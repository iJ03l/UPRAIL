import { OAuthAuthorizationServer } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../types';
import { getAgentKeyById } from '../services/agentKeys';

export const OAUTH_SCOPE = 'mcp';
export const OAUTH_SCOPES = [OAUTH_SCOPE];
export const OAUTH_REFRESH_TTL_SECONDS = 90 * 24 * 60 * 60;
export const OAUTH_CONNECTION_DAYS = 90;
export const OAUTH_MAX_CONNECTION_DAYS = 365;

interface OAuthConfig {
  issuer: string;
  resource: string;
  authorizationServer: OAuthAuthorizationServer<Env>;
}

const configCache = new Map<string, OAuthConfig>();

export function getOAuthConfig(env: Env): OAuthConfig {
  const issuer = env.OAUTH_ISSUER || 'https://app.uprail.world';
  const resource = env.OAUTH_RESOURCE || 'https://api.uprail.world/api/mcp';
  const cacheKey = `${issuer}|${resource}`;
  const cached = configCache.get(cacheKey);
  if (cached) return cached;

  const authorizationServer = new OAuthAuthorizationServer<Env>({
    issuer,
    resources: [resource],
    scopesSupported: OAUTH_SCOPES,
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationEndpoint: '/oauth/register',
    refreshTokenTTL: OAUTH_REFRESH_TTL_SECONDS,
    tokenExchangeCallback: async ({ grantType, props, env: tokenEnv }) => {
      if (grantType !== 'authorization_code') return;
      const agentKeyId = typeof props?.agentKeyId === 'string' ? props.agentKeyId : '';
      if (!agentKeyId) return;

      const row = await getAgentKeyById(tokenEnv, agentKeyId);
      if (!row?.expires_at) return;

      const remaining = Math.floor((row.expires_at - Date.now()) / 1000);
      if (remaining <= 0) return { refreshTokenTTL: 0 };
      return { refreshTokenTTL: Math.max(60, remaining) };
    },
    onError: ({ code, description, internal }) => {
      console.warn('[oauth] error', {
        code,
        description,
        reason: internal?.reason,
      });
    },
  });

  const config = { issuer, resource, authorizationServer };
  configCache.set(cacheKey, config);
  return config;
}

export function getAuthorizationServer(env: Env): OAuthAuthorizationServer<Env> {
  return getOAuthConfig(env).authorizationServer;
}
