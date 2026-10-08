/**
 * Authentication routes for X OAuth 2.0 PKCE flow
 * Free tier integration (/2/users/me) and KV-backed sessions
 */

import { Hono } from 'hono';
import type { AppContext, ErrorResponse } from '../types';
import { generatePKCE, exchangeCode, getMe } from '../services/xApi';
import { createSession, destroySession } from '../middleware/session';

export const authRouter = new Hono<AppContext>();

/**
 * GET /auth/x/login
 * Initiates X OAuth 2.0 PKCE flow
 */
authRouter.get('/login', async (c) => {
  try {
    const returnTo = c.req.query('return_to') || '/';
    const { codeVerifier, codeChallenge } = await generatePKCE();
    const state = crypto.randomUUID();

    // Determine absolute callback URL
    const reqUrl = new URL(c.req.url);
    const callbackUrl = `${reqUrl.origin}/auth/x/callback`;

    // Store state and verifier in KV (10 minutes TTL)
    await c.env.CACHE.put(
      `x_oauth:${state}`,
      JSON.stringify({
        codeVerifier,
        state,
        returnTo,
        callbackUrl,
      }),
      { expirationTtl: 600 }
    );

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: c.env.X_CLIENT_ID,
      redirect_uri: callbackUrl,
      scope: 'users.read tweet.read offline.access',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizeUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
    return c.redirect(authorizeUrl);
  } catch (err: any) {
    console.error('Failed to initiate X login:', err);
    return c.json<ErrorResponse>(
      {
        error: 'Failed to initiate X login flow',
        code: 'AUTH_INIT_FAILED',
      },
      500
    );
  }
});

/**
 * GET /auth/x/callback
 * Handles OAuth callback from X, fetches user profile, creates session
 */
authRouter.get('/callback', async (c) => {
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');
    const errorDescription = c.req.query('error_description');

    const appOrigin = c.env.WEBAUTHN_ORIGIN || 'https://uprail.app';

    if (error) {
      console.warn('X OAuth error received:', error, errorDescription);
      return c.redirect(`${appOrigin}?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return c.json<ErrorResponse>(
        {
          error: 'Missing code or state parameter',
          code: 'INVALID_REQUEST',
        },
        400
      );
    }

    // Retrieve state data from KV
    const rawData = await c.env.CACHE.get(`x_oauth:${state}`);
    if (!rawData) {
      return c.json<ErrorResponse>(
        {
          error: 'Invalid, expired, or previously used OAuth state',
          code: 'INVALID_STATE',
        },
        400
      );
    }

    // Immediately remove state from KV
    await c.env.CACHE.delete(`x_oauth:${state}`);

    const { codeVerifier, returnTo, callbackUrl } = JSON.parse(rawData);

    // Exchange authorization code for tokens
    const tokens = await exchangeCode({
      code,
      codeVerifier,
      clientId: c.env.X_CLIENT_ID,
      clientSecret: c.env.X_CLIENT_SECRET,
      redirectUri: callbackUrl,
    });

    // Fetch user details from X /2/users/me (Free tier)
    const xUser = await getMe(tokens.access_token);
    const now = Date.now();

    // Check if user already exists in D1
    const existing = await c.env.DB.prepare(
      'SELECT x_id, x_handle, x_name, near_account FROM x_identities WHERE x_id = ?'
    )
      .bind(xUser.id)
      .first<{
        x_id: string;
        x_handle: string;
        x_name: string;
        near_account: string | null;
      }>();

    let nearAccount: string | null = null;

    if (existing) {
      nearAccount = existing.near_account;
      // Update profile
      await c.env.DB.prepare(
        'UPDATE x_identities SET x_handle = ?, x_name = ?, updated_at = ? WHERE x_id = ?'
      )
        .bind(xUser.username.toLowerCase(), xUser.name, now, xUser.id)
        .run();
    } else {
      // Insert new identity
      await c.env.DB.prepare(
        'INSERT INTO x_identities (x_id, x_handle, x_name, near_account, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)'
      )
        .bind(xUser.id, xUser.username.toLowerCase(), xUser.name, now, now)
        .run();
    }

    // Establish KV session and set HttpOnly cookie
    await createSession(c, {
      x_id: xUser.id,
      x_handle: xUser.username.toLowerCase(),
      x_name: xUser.name,
      near_account: nearAccount,
    });

    // Redirect user to destination
    const destination = returnTo.startsWith('/')
      ? `${appOrigin}${returnTo}`
      : returnTo;

    return c.redirect(destination);
  } catch (err: any) {
    console.error('X OAuth callback processing error:', err);
    return c.json<ErrorResponse>(
      {
        error: `Authentication failed: ${err.message || 'Unknown error'}`,
        code: 'AUTH_CALLBACK_FAILED',
      },
      500
    );
  }
});

/**
 * GET /auth/x/session
 * Return currently authenticated session profile
 */
authRouter.get('/session', async (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({
      authenticated: false,
      session: null,
    });
  }

  return c.json({
    authenticated: true,
    session: {
      xId: session.x_id,
      xHandle: session.x_handle,
      xName: session.x_name,
      nearAccount: session.near_account,
      expiresAt: session.expires_at,
    },
  });
});

/**
 * POST /auth/x/logout
 * Destroys session from KV and clears cookie
 */
authRouter.post('/logout', async (c) => {
  try {
    await destroySession(c);
    return c.json({ success: true });
  } catch (err: any) {
    console.error('Logout error:', err);
    return c.json<ErrorResponse>(
      {
        error: 'Failed to logout',
        code: 'LOGOUT_ERROR',
      },
      500
    );
  }
});
