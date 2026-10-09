/**
 * X (Twitter) API v2 Client with OAuth 2.0 PKCE support
 * UPRAIL.app Free tier integration (/2/users/me only)
 */

export interface XUser {
  id: string;
  username: string;
  name: string;
}

export interface XTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope: string;
  refresh_token?: string;
}

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * Base64URL encode a buffer without padding
 */
export function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate PKCE code verifier and code challenge (S256)
 */
export async function generatePKCE(): Promise<PKCEPair> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const codeVerifier = base64UrlEncode(randomBytes);

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = base64UrlEncode(digest);

  return { codeVerifier, codeChallenge };
}

/**
 * Exchange OAuth 2.0 authorization code for access token
 */
export async function exchangeCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}): Promise<XTokenResponse> {
  const bodyParams: Record<string, string> = {
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (params.clientSecret) {
    const credentials = btoa(`${params.clientId}:${params.clientSecret}`);
    headers['Authorization'] = `Basic ${credentials}`;
  } else {
    // For public clients without secret, client_id goes in the body
    bodyParams.client_id = params.clientId;
  }

  const body = new URLSearchParams(bodyParams);

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('X OAuth token exchange failed:', response.status, errorText);
    let errorDetail = response.statusText;
    try {
      const parsed = JSON.parse(errorText);
      errorDetail = parsed.error_description || parsed.error || errorText;
    } catch {
      if (errorText) errorDetail = errorText;
    }
    throw new Error(`X OAuth token exchange failed: ${errorDetail}`);
  }

  return (await response.json()) as XTokenResponse;
}

/**
 * Refresh an OAuth 2.0 access token
 */
export async function refreshToken(
  token: string,
  clientId: string,
  clientSecret?: string
): Promise<XTokenResponse> {
  const body = new URLSearchParams({
    refresh_token: token,
    grant_type: 'refresh_token',
    client_id: clientId,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (clientSecret) {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('X OAuth token refresh failed:', response.status, errorText);
    throw new Error(`X OAuth token refresh failed: ${response.statusText}`);
  }

  return (await response.json()) as XTokenResponse;
}

/**
 * Fetch authenticated user profile via X API v2 Free tier (/2/users/me)
 */
export async function getMe(accessToken: string): Promise<XUser> {
  const response = await fetch('https://api.twitter.com/2/users/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('X /2/users/me failed:', response.status, errorText);
    throw new Error(`Failed to fetch X user profile: ${response.statusText}`);
  }

  const json = (await response.json()) as {
    data: {
      id: string;
      username: string;
      name: string;
    };
  };

  if (!json.data || !json.data.id || !json.data.username) {
    throw new Error('Invalid user payload returned by X API');
  }

  return {
    id: json.data.id,
    username: json.data.username,
    name: json.data.name,
  };
}
