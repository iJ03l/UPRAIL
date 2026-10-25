import { OAuthAuthorizationServer } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../types';

export const OAUTH_SCOPE = 'mcp';
export const OAUTH_SCOPES = [OAUTH_SCOPE];
export const OAUTH_REFRESH_TTL_SECONDS = 90 * 24 * 60 * 60;
export const OAUTH_CONNECTION_DAYS = 90;

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
