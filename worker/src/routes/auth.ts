/**
 * Authentication routes for X OAuth 2.0 PKCE flow and WebAuthn Passkey Login
 * Free tier integration (/2/users/me) and zero KV writes
 */

import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext, ErrorResponse } from '../types';
import { generatePKCE, exchangeCode, getMe } from '../services/xApi';
import { createSession, destroySession, requireAuth } from '../middleware/session';
import { getDb, upsertXIdentity, getXIdentity } from '../db/postgres';
import * as webauthnService from '../services/webauthn';
import * as nearRpc from '../services/nearRpc';
import { redeemInvite } from '../services/inviteService';
import { signPayload, verifyAndUnpack } from '../utils/crypto';
import { storeChallenge, consumeChallenge } from '../services/challengeService';

export const authRouter = new Hono<AppContext>();

function getSecret(c: any): string {
  return c.env.SESSION_SECRET || 'uprail_master_signed_session_edge_2026';
}

/**
 * Initiates X OAuth 2.0 PKCE flow, sets signed cookie state, and generates canonical authorize URL
 */
async function initiateXAuth(c: any): Promise<{ authorizeUrl: string; state: string }> {
  const returnTo = c.req.query('return_to') || '/login';
  const inviteCode = c.req.query('invite') || null;
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = crypto.randomUUID();

  // Determine absolute callback URL (always app.uprail.world in production)
  const reqUrl = new URL(c.req.url);
  const isLocal = reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1';
  const callbackUrl = isLocal
    ? `${reqUrl.origin}/auth/x/callback`
    : 'https://app.uprail.world/auth/x/callback';

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
  const cookieOptions: any = {
    path: '/',
    httpOnly: true,
    secure: reqUrl.protocol === 'https:',
    sameSite: 'Lax',
    maxAge: 600,
  };
  if (reqUrl.hostname.endsWith('uprail.world')) {
    cookieOptions.domain = '.uprail.world';
  }
  setCookie(c, 'uprail_oauth_state', signedToken, cookieOptions);

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

  // Canonical X.com OAuth 2.0 authorize endpoint
  const authorizeUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`;
  return { authorizeUrl, state };
}

/**
 * GET /auth/x/init and GET /auth/x/authorize-url
 * Returns JSON { url: authorizeUrl } for client-side direct navigation to real 𝕏 OAuth
 */
authRouter.get('/init', async (c) => {
  try {
    const { authorizeUrl } = await initiateXAuth(c);
    return c.json({ url: authorizeUrl });
  } catch (err: any) {
    console.error('Failed to init X OAuth:', err);
    return c.json<ErrorResponse>(
      {
        error: 'Failed to initiate X login flow',
        code: 'AUTH_INIT_FAILED',
      },
      500
    );
  }
});

authRouter.get('/authorize-url', async (c) => {
  try {
    const { authorizeUrl } = await initiateXAuth(c);
    return c.json({ url: authorizeUrl });
  } catch (err: any) {
    console.error('Failed to get X authorize URL:', err);
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
 * GET /auth/x/login
 * Initiates X OAuth 2.0 PKCE flow - redirects (302) or returns JSON if requested
 */
authRouter.get('/login', async (c) => {
  try {
    const { authorizeUrl } = await initiateXAuth(c);
    if (c.req.header('accept')?.includes('application/json') || c.req.query('format') === 'json') {
      return c.json({ url: authorizeUrl });
    }
    return c.redirect(authorizeUrl, 302);
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
      return c.redirect(`${appOrigin}/login?error=${encodeURIComponent(errorDescription || error)}`);
    }

    if (!code || !state) {
      return c.redirect(`${appOrigin}/login?error=${encodeURIComponent('Missing code or state parameter from 𝕏')}`);
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
      const deleteOptions: any = { path: '/' };
      if (reqUrl.hostname.endsWith('uprail.world')) {
        deleteOptions.domain = '.uprail.world';
      }
      deleteCookie(c, 'uprail_oauth_state', deleteOptions);
    }

    if (!rawData) {
      rawData = await consumeChallenge(c.env, {
        key: `x_oauth:${state}`,
        purpose: 'oauth_pkce',
      });
    }

    if (!rawData) {
      return c.redirect(`${appOrigin}/login?error=${encodeURIComponent('Your login session expired. Please connect with 𝕏 again.')}`);
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

    if ((c.env as any).DATABASE_URL || (c.env as any).HYPERDRIVE) {
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

    // Check if user has registered passkey
    let hasPasskey = !!nearAccount;
    if (!hasPasskey && c.env.DB) {
      try {
        const pk = await c.env.DB.prepare('SELECT id FROM passkeys WHERE x_id = ?')
          .bind(xUser.id)
          .first();
        if (pk) hasPasskey = true;
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

    // Intelligently route user to the right step to prevent bounce loops:
    // 1. If user does not have a passkey yet -> /login (Step 2: Set Up Passkey)
    // 2. If user has passkey but is not activated -> /parking (Comical Parking Gate)
    // 3. If user has both -> /app (or returnTo if custom)
    let destination: string;
    if (!hasPasskey) {
      destination = `${appOrigin}/login`;
    } else if (!isActivated) {
      destination = `${appOrigin}/parking`;
    } else {
      destination = returnTo && returnTo !== '/' && returnTo !== '/login'
        ? (returnTo.startsWith('/') ? `${appOrigin}${returnTo}` : returnTo)
        : `${appOrigin}/app`;
    }

    return c.redirect(destination);
  } catch (err: any) {
    console.error('X OAuth callback processing error:', err);
    const reqUrl = new URL(c.req.url);
    const isLocal = reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1';
    const appOrigin = isLocal
      ? (c.req.header('x-forwarded-host') ? `http://${c.req.header('x-forwarded-host')}` : 'http://localhost:3000')
      : (c.env.WEBAUTHN_ORIGIN || 'https://app.uprail.world');
    return c.redirect(`${appOrigin}/login?error=${encodeURIComponent(err.message || 'Authentication with 𝕏 failed')}`);
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
  let nearAccount = session.near_account;

  if (c.env.DB) {
    try {
      const idRow = (await c.env.DB.prepare(
        'SELECT is_activated, personal_invite_code, near_account FROM x_identities WHERE x_id = ?'
      )
        .bind(session.x_id)
        .first()) as { is_activated: number | null; personal_invite_code: string | null; near_account: string | null } | null;
      if (idRow) {
        if (idRow.is_activated !== null) isActivated = idRow.is_activated === 1;
        if (idRow.personal_invite_code) personalInviteCode = idRow.personal_invite_code;
        if (idRow.near_account) nearAccount = idRow.near_account;
      }
    } catch {}
  }

  let hasPasskey = !!nearAccount;
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
    nearAccount,
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
      nearAccount,
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

/**
 * GET /auth/export-key-challenge
 * Generates a challenge for the user to authenticate with their WebAuthn passkey
 * before exporting their authentic NEAR private key.
 */
authRouter.get('/export-key-challenge', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const rpId = c.env.WEBAUTHN_RP_ID || 'uprail.world';

  let passkey: any = null;
  if (c.env.DB) {
    try {
      passkey = await c.env.DB.prepare(
        'SELECT credential_id, transports FROM passkeys WHERE x_id = ? ORDER BY created_at DESC LIMIT 1'
      )
        .bind(session.x_id)
        .first();
    } catch (err) {
      console.warn('export-key-challenge DB error:', err);
    }
  }

  const credentialIds = passkey?.credential_id ? [passkey.credential_id] : undefined;
  const options = await webauthnService.generateAuthenticationOptions({
    credentialIds,
    rpId,
  });

  const challengeToken = await signPayload(
    JSON.stringify({
      challenge: options.challenge,
      x_id: session.x_id,
      exp: Date.now() + 5 * 60 * 1000,
    }),
    getSecret(c)
  );

  return c.json({ options, challengeToken });
});

/**
 * POST /auth/export-key
 * Verifies the WebAuthn passkey assertion and returns the user's authentic
 * NEAR master keypair for self-custody export.
 */
authRouter.post('/export-key', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const body = (await c.req.json().catch(() => ({}))) as any;
  const { assertion, challengeToken } = body;

  if (!assertion || !challengeToken) {
    return c.json<ErrorResponse>(
      { error: 'Missing assertion or challenge token', code: 'INVALID_REQUEST' },
      400
    );
  }

  // Verify challenge token
  const payloadStr = await verifyAndUnpack(challengeToken, getSecret(c));
  if (!payloadStr) {
    return c.json<ErrorResponse>(
      { error: 'Challenge expired or invalid', code: 'CHALLENGE_EXPIRED' },
      401
    );
  }

  const payload = JSON.parse(payloadStr);
  if (payload.x_id !== session.x_id || payload.exp < Date.now()) {
    return c.json<ErrorResponse>(
      { error: 'Challenge token expired or mismatched', code: 'CHALLENGE_MISMATCH' },
      401
    );
  }

  // Look up passkey credential
  let passkeyRow: any = null;
  if (c.env.DB) {
    passkeyRow = await c.env.DB.prepare(
      'SELECT public_key, counter FROM passkeys WHERE x_id = ? AND credential_id = ? LIMIT 1'
    )
      .bind(session.x_id, assertion.id)
      .first<any>();
  }

  if (!passkeyRow) {
    return c.json<ErrorResponse>(
      { error: 'Passkey credential not found', code: 'CREDENTIAL_NOT_FOUND' },
      404
    );
  }

  const rpId = c.env.WEBAUTHN_RP_ID || 'uprail.world';
  const expectedOrigin = c.env.WEBAUTHN_ORIGIN || 'https://app.uprail.world';

  try {
    const verification = await webauthnService.verifyAuthentication({
      assertion,
      expectedChallenge: payload.challenge,
      expectedOrigin,
      expectedRPID: rpId,
      credential: {
        id: assertion.id,
        publicKey: passkeyRow.public_key,
        counter: Number(passkeyRow.counter) || 0,
      },
    });

    if (!verification.verified) {
      return c.json<ErrorResponse>(
        { error: 'Passkey authentication failed', code: 'VERIFICATION_FAILED' },
        401
      );
    }
  } catch (authErr: any) {
    return c.json<ErrorResponse>(
      { error: `Passkey verification failed: ${authErr.message}`, code: 'VERIFICATION_FAILED' },
      401
    );
  }

  // Passkey verified! Derive authentic NEAR keypair
  const derived = await nearRpc.deriveUserNearKeypair(c.env, session.x_id);
  const nearAccount = session.near_account || derived.accountId;

  return c.json({
    success: true,
    nearAccount,
    privateKey: derived.privateKeyB58,
    publicKey: derived.publicKeyB58,
  });
});

