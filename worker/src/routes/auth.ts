/**
 * Authentication routes for X OAuth 2.0 PKCE flow and WebAuthn Passkey Login
 * Free tier integration (/2/users/me) and zero KV writes
 */

import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext, ErrorResponse } from '../types';
import { generatePKCE, exchangeCode, getMe } from '../services/xApi';
import { createSession, destroySession } from '../middleware/session';
import { getDb, upsertXIdentity, getXIdentity } from '../db/postgres';
import * as webauthnService from '../services/webauthn';
import { redeemInvite } from '../services/inviteService';
import { signPayload, verifyAndUnpack } from '../utils/crypto';
import { storeChallenge, consumeChallenge } from '../services/challengeService';

export const authRouter = new Hono<AppContext>();

function getSecret(c: any): string {
  return c.env.SESSION_SECRET || 'uprail_master_signed_session_edge_2026';
}

/**
 * GET /auth/x/login
 * Initiates X OAuth 2.0 PKCE flow
 */
authRouter.get('/login', async (c) => {
  try {
    const returnTo = c.req.query('return_to') || '/';
    const inviteCode = c.req.query('invite') || null;
    const { codeVerifier, codeChallenge } = await generatePKCE();
    const state = crypto.randomUUID();

    // Determine absolute callback URL
    const reqUrl = new URL(c.req.url);
    const callbackUrl = `${reqUrl.origin}/auth/x/callback`;

    const oauthData = JSON.stringify({
      codeVerifier,
      state,
      returnTo,
      callbackUrl,
      inviteCode,
    });

    // 1. Set signed HttpOnly cookie for stateless edge resolution
    const secret = getSecret(c);
    const signedToken = await signPayload(oauthData, secret);
    setCookie(c, 'uprail_oauth_state', signedToken, {
      path: '/',
      httpOnly: true,
      secure: reqUrl.protocol === 'https:',
      sameSite: 'Lax',
      maxAge: 600,
    });

    // 2. Persist to memory + D1 fallback (zero KV writes)
    await storeChallenge(c.env, {
      key: `x_oauth:${state}`,
      challenge: oauthData,
      purpose: 'oauth_pkce',
      ttlSeconds: 600,
    });

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

    const reqUrl = new URL(c.req.url);
    const isLocal = reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1';
    const appOrigin = isLocal
      ? (c.req.header('x-forwarded-host') ? `http://${c.req.header('x-forwarded-host')}` : 'http://localhost:3000')
      : (c.env.WEBAUTHN_ORIGIN || 'https://app.uprail.world');

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

    // Retrieve state data: check signed cookie first, then fallback to challengeService
    let rawData: string | null = null;
    const cookieState = getCookie(c, 'uprail_oauth_state');
    if (cookieState) {
      const secret = getSecret(c);
      const unpacked = await verifyAndUnpack(cookieState, secret);
      if (unpacked) {
        try {
          const parsed = JSON.parse(unpacked);
          if (parsed.state === state) {
            rawData = unpacked;
          }
        } catch {}
      }
      deleteCookie(c, 'uprail_oauth_state', { path: '/' });
    }

    if (!rawData) {
      rawData = await consumeChallenge(c.env, {
        key: `x_oauth:${state}`,
        purpose: 'oauth_pkce',
      });
    }

    if (!rawData) {
      return c.json<ErrorResponse>(
        {
          error: 'Invalid, expired, or previously used OAuth state',
          code: 'INVALID_STATE',
        },
        400
      );
    }

    const { codeVerifier, returnTo, callbackUrl, inviteCode } = JSON.parse(rawData);

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

    // 1. Try PostgreSQL first, with fallback to D1
    let nearAccount: string | null = null;
    let identityPersisted = false;

    try {
      const sql = getDb(c.env);
      const identity = await upsertXIdentity(sql, {
        x_id: xUser.id,
        x_handle: xUser.username.toLowerCase(),
        x_name: xUser.name,
      });
      nearAccount = identity.near_account || null;
      identityPersisted = true;
    } catch (pgErr) {
      console.warn('Postgres identity upsert failed, using D1:', pgErr);
    }

    if (!identityPersisted && c.env.DB) {
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

      if (existing) {
        nearAccount = existing.near_account;
        await c.env.DB.prepare(
          'UPDATE x_identities SET x_handle = ?, x_name = ?, updated_at = ? WHERE x_id = ?'
        )
          .bind(xUser.username.toLowerCase(), xUser.name, now, xUser.id)
          .run();
      } else {
        await c.env.DB.prepare(
          'INSERT INTO x_identities (x_id, x_handle, x_name, near_account, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)'
        )
          .bind(xUser.id, xUser.username.toLowerCase(), xUser.name, now, now)
          .run();
      }
    }

    // Auto-redeem invite code if user arrived with one
    if (inviteCode) {
      try {
        await redeemInvite(c.env, inviteCode, {
          x_id: xUser.id,
          x_handle: xUser.username.toLowerCase(),
        });
      } catch (invErr) {
        console.warn('Auto-redeem invite on OAuth callback notice:', invErr);
      }
    }

    // Check activation and personal invite code from identity
    let isActivated = false;
    let personalInviteCode: string | null = null;
    if (c.env.DB) {
      try {
        const idRow = await c.env.DB.prepare(
          'SELECT is_activated, personal_invite_code FROM x_identities WHERE x_id = ?'
        )
          .bind(xUser.id)
          .first<{ is_activated: number | null; personal_invite_code: string | null }>();
        if (idRow) {
          isActivated = idRow.is_activated === 1;
          personalInviteCode = idRow.personal_invite_code || null;
        }
      } catch {}
    }

    // Establish signed cookie session (0 KV writes)
    await createSession(c, {
      x_id: xUser.id,
      x_handle: xUser.username.toLowerCase(),
      x_name: xUser.name,
      near_account: nearAccount,
      is_activated: isActivated,
      personal_invite_code: personalInviteCode,
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
 * GET /auth/x/session and GET /auth/x/status
 * Return currently authenticated session profile
 */
const getSessionHandler = async (c: any) => {
  const session = c.get('session');
  if (!session) {
    return c.json({
      authenticated: false,
      user: null,
      session: null,
    });
  }

  let isActivated = session.is_activated;
  let personalInviteCode = session.personal_invite_code;

  if (isActivated === undefined || !personalInviteCode) {
    try {
      if (c.env.DB) {
        const idRow = (await c.env.DB.prepare(
          'SELECT is_activated, personal_invite_code FROM x_identities WHERE x_id = ?'
        )
          .bind(session.x_id)
          .first()) as { is_activated: number | null; personal_invite_code: string | null } | null;
        if (idRow) {
          isActivated = idRow.is_activated === 1;
          personalInviteCode = idRow.personal_invite_code || null;
        }
      }
    } catch {}
  }

  let hasPasskey = !!session.near_account;
  if (!hasPasskey && c.env.DB) {
    try {
      const pk = await c.env.DB.prepare('SELECT id FROM passkeys WHERE x_id = ?')
        .bind(session.x_id)
        .first();
      if (pk) hasPasskey = true;
    } catch {}
  }

  const user = {
    id: session.x_id,
    handle: session.x_handle,
    name: session.x_name,
    avatarUrl: `https://unavatar.io/twitter/${session.x_handle}`,
    nearAccount: session.near_account,
    hasPasskey,
    isActivated: !!isActivated,
    personalInviteCode: personalInviteCode || null,
  };

  return c.json({
    authenticated: true,
    user,
    session: {
      xId: session.x_id,
      xHandle: session.x_handle,
      xName: session.x_name,
      nearAccount: session.near_account,
      hasPasskey,
      expiresAt: session.expires_at,
      isActivated: !!isActivated,
      personalInviteCode: personalInviteCode || null,
    },
  });
};

authRouter.get('/session', getSessionHandler);
authRouter.get('/status', getSessionHandler);

/**
 * POST /auth/x/logout
 * Destroys session by clearing cookie (0 KV writes)
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

/**
 * GET /auth/passkey/login-options
 * Generates WebAuthn authentication options for passkey sign-in
 */
authRouter.get('/passkey/login-options', async (c) => {
  try {
    const rpId = c.env.WEBAUTHN_RP_ID || 'uprail.world';
    const options = await webauthnService.generateAuthenticationOptions({ rpId });

    // Store challenge via challengeService (zero KV writes)
    await storeChallenge(c.env, {
      key: `webauthn_auth:${options.challenge}`,
      challenge: options.challenge,
      purpose: 'passkey_login',
      ttlSeconds: 300,
    });

    return c.json(options);
  } catch (err: any) {
    console.error('Passkey login options error:', err);
    return c.json<ErrorResponse>(
      { error: 'Failed to generate passkey login options', code: 'WEBAUTHN_OPTIONS_ERROR' },
      500
    );
  }
});

/**
 * POST /auth/passkey/login-verify
 * Verifies WebAuthn assertion signature and logs in the user
 */
authRouter.post('/passkey/login-verify', async (c) => {
  try {
    const body = await c.req.json<{ assertion: any }>().catch(() => null);
    if (!body || !body.assertion) {
      return c.json<ErrorResponse>({ error: 'Missing assertion payload', code: 'INVALID_REQUEST' }, 400);
    }

    const assertion = body.assertion;
    let challenge: string | null = null;

    if (assertion.response?.clientDataJSON) {
      try {
        const clientDataStr = atob(assertion.response.clientDataJSON.replace(/-/g, '+').replace(/_/g, '/'));
        const clientData = JSON.parse(clientDataStr);
        challenge = clientData.challenge;
      } catch {
        challenge = null;
      }
    }

    if (!challenge) {
      return c.json<ErrorResponse>({ error: 'Missing challenge in assertion', code: 'INVALID_CHALLENGE' }, 400);
    }

    // Verify challenge via challengeService (zero KV writes)
    const storedChallenge = await consumeChallenge(c.env, {
      key: `webauthn_auth:${challenge}`,
      purpose: 'passkey_login',
      expectedChallenge: challenge,
    });

    if (!storedChallenge) {
      return c.json<ErrorResponse>({ error: 'Challenge expired or invalid', code: 'CHALLENGE_EXPIRED' }, 400);
    }

    // Look up passkey credential from Postgres (or D1)
    let passkeyRow: { x_id: string; public_key: string; counter: number } | null = null;
    try {
      const sql = getDb(c.env);
      const [row] = await sql<any[]>`
        SELECT x_id, public_key, counter FROM passkeys WHERE credential_id = ${assertion.id}
      `;
      if (row) passkeyRow = row;
    } catch {
      if (c.env.DB) {
        passkeyRow = await c.env.DB.prepare(
          'SELECT x_id, public_key, counter FROM passkeys WHERE credential_id = ?'
        )
          .bind(assertion.id)
          .first<any>();
      }
    }

    if (!passkeyRow) {
      return c.json<ErrorResponse>(
        { error: 'Passkey not recognized. Please sign in with X first to register your passkey.', code: 'CREDENTIAL_NOT_FOUND' },
        404
      );
    }

    const rpId = c.env.WEBAUTHN_RP_ID || 'uprail.world';
    const expectedOrigin = c.env.WEBAUTHN_ORIGIN || 'https://app.uprail.world';

    const verification = await webauthnService.verifyAuthentication({
      assertion,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID: rpId,
      credential: {
        id: assertion.id,
        publicKey: passkeyRow.public_key,
        counter: Number(passkeyRow.counter) || 0,
      },
    });

    if (!verification.verified) {
      return c.json<ErrorResponse>({ error: 'Passkey verification failed', code: 'VERIFICATION_FAILED' }, 401);
    }

    // Fetch user profile from Postgres / D1
    let userProfile: { x_id: string; x_handle: string; x_name: string; near_account?: string | null } | null = null;
    try {
      const sql = getDb(c.env);
      const identity = await getXIdentity(sql, passkeyRow.x_id);
      if (identity) userProfile = identity;
    } catch {
      if (c.env.DB) {
        userProfile = await c.env.DB.prepare(
          'SELECT x_id, x_handle, x_name, near_account FROM x_identities WHERE x_id = ?'
        )
          .bind(passkeyRow.x_id)
          .first<any>();
      }
    }

    if (!userProfile) {
      return c.json<ErrorResponse>({ error: 'User profile not found', code: 'USER_NOT_FOUND' }, 404);
    }

    // Create session and set cookie (zero KV writes)
    const session = await createSession(c, {
      x_id: userProfile.x_id,
      x_handle: userProfile.x_handle,
      x_name: userProfile.x_name,
      near_account: userProfile.near_account,
    });

    return c.json({
      success: true,
      user: {
        id: session.x_id,
        handle: session.x_handle,
        name: session.x_name,
        avatarUrl: `https://unavatar.io/twitter/${session.x_handle}`,
        nearAccount: session.near_account,
      },
    });
  } catch (err: any) {
    console.error('Passkey login verify error:', err);
    return c.json<ErrorResponse>({ error: err.message || 'Passkey login failed', code: 'LOGIN_FAILED' }, 500);
  }
});
