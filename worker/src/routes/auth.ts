/**
 * Authentication routes for X OAuth 2.0 PKCE flow and WebAuthn Passkey Login
 * Free tier integration (/2/users/me) and zero KV writes
 */

import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext, ErrorResponse } from '../types';
import { generatePKCE, exchangeCode, getMe } from '../services/xApi';
import { createSession, destroySession, requireAuth, updateSession } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { rateLimit } from '../middleware/rateLimit';
import * as webauthnService from '../services/webauthn';
import * as nearRpc from '../services/nearRpc';
import { hasCachedOneClickSession } from '../services/oneclickAuth';
import { redeemInvite } from '../services/inviteService';
import {
  ensureRecoveryCodes,
  generateRecoveryCodes,
  getRecoveryStatus,
  listRecoveryCodes,
  verifyRecoveryCode,
} from '../services/recoveryCodes';
import { background } from '../utils/background';
import { signPayload, verifyAndUnpack } from '../utils/crypto';
import { storeChallenge, consumeChallenge } from '../services/challengeService';
import { getSessionSecret, requireSessionSecret } from '../utils/secrets';
import {
  resolveOrigin,
  resolveRpId,
  allowedWebAuthnOrigins,
  allowedWebAuthnRpIds,
} from '../services/webauthnConfig';
import { publicErrorMessage } from '../utils/errors';

export const authRouter = new Hono<AppContext>();

/**
 * Restricts the OAuth `return_to` value to a same-site absolute path.
 *
 * Without this, `/auth/login?return_to=https://evil.example` would turn the
 * post-login redirect into an open redirect used for phishing. Protocol-relative
 * (`//host`) and backslash tricks are rejected too, since browsers normalize
 * `https://app.example/\evil.com` to `https://evil.com`.
 */
function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/login';
  const v = value.trim();
  if (v.length === 0 || v.length > 512) return '/login';
  if (!v.startsWith('/') || v.startsWith('//')) return '/login';
  if (v.includes('\\') || v.includes('\u0000')) return '/login';
  if (/[\u0000-\u001f\u007f]/.test(v)) return '/login';
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(v)) return '/login';
  return v;
}

/**
 * True for the apex and any subdomain of uprail.world. A leading-dot suffix
 * check plus an exact apex match — `endsWith('uprail.world')` alone would also
 * match a lookalike like `evil-uprail.world` and scope the OAuth state cookie
 * to it. Matches the host-only policy the session cookie already follows.
 */
function isUprailHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase();
  return h === 'uprail.world' || h.endsWith('.uprail.world');
}

/**
 * Initiates X OAuth 2.0 PKCE flow, sets signed cookie state, and generates canonical authorize URL
 */
async function initiateXAuth(c: any): Promise<{ authorizeUrl: string; state: string }> {
  const returnTo = sanitizeReturnTo(c.req.query('return_to'));
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
  const secret = requireSessionSecret(c.env);
  const signedToken = await signPayload(oauthData, secret);
  const cookieOptions: any = {
    path: '/',
    httpOnly: true,
    secure: reqUrl.protocol === 'https:',
    sameSite: 'Lax',
    maxAge: 600,
  };
  if (isUprailHost(reqUrl.hostname)) {
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
      : (resolveOrigin(c.env));

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
      const secret = getSessionSecret(c.env);
      const unpacked = secret ? await verifyAndUnpack(cookieState, secret) : null;
      if (unpacked) {
        try {
          const parsed = JSON.parse(unpacked);
          if (parsed.state === state) {
            rawData = unpacked;
          }
        } catch {}
      }
      const deleteOptions: any = { path: '/' };
      if (isUprailHost(reqUrl.hostname)) {
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

    // Persist / refresh the identity in D1 (the single source of truth)
    let nearAccount: string | null = null;
    if (c.env.DB) {
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

    // Establish signed cookie session (0 KV writes). X OAuth proves identity
    // only; the session stays unverified until the user also answers a passkey
    // ceremony (or consumes a recovery code to replace a lost passkey).
    await createSession(c, {
      x_id: xUser.id,
      x_handle: xUser.username.toLowerCase(),
      x_name: xUser.name,
      near_account: nearAccount,
      is_activated: isActivated,
      personal_invite_code: personalInviteCode,
    });

    // Login == account exists. Provision the confidential intent sub-account
    // right away so the first deposit/withdraw never has to wait on it.
    background(
      c.executionCtx,
      nearRpc.ensureIntentAccount(c.env, {
        x_id: xUser.id,
        x_handle: xUser.username.toLowerCase(),
        near_account: nearAccount,
      }),
      'intent account provisioning (oauth)'
    );

    // X OAuth always hands control back to /login. The browser, not the
    // server, knows whether this device already holds a passkey; LoginPage
    // then either creates one, confirms one, or offers recovery. This also
    // prevents an existing passkey row from bouncing a new device straight to
    // the dashboard without the second factor.
    const safeInvite =
      typeof inviteCode === 'string' && /^[A-Z]{6}$/.test(inviteCode.trim().toUpperCase())
        ? inviteCode.trim().toUpperCase()
        : '';
    const safeReturnTo = sanitizeReturnTo(returnTo);
    const params = new URLSearchParams();
    if (safeInvite) params.set('invite', safeInvite);
    if (safeReturnTo !== '/' && safeReturnTo !== '/login') {
      params.set('return_to', safeReturnTo);
    }
    const query = params.toString();
    return c.redirect(`${appOrigin}/login${query ? `?${query}` : ''}`);
  } catch (err: any) {
    console.error('X OAuth callback processing error:', err);
    const reqUrl = new URL(c.req.url);
    const isLocal = reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1';
    const appOrigin = isLocal
      ? (c.req.header('x-forwarded-host') ? `http://${c.req.header('x-forwarded-host')}` : 'http://localhost:3000')
      : (resolveOrigin(c.env));
    return c.redirect(`${appOrigin}/login?error=${encodeURIComponent(publicErrorMessage(err, 'Authentication with 𝕏 failed'))}`);
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
  let custodyMode: 'server' | 'self' = session.custody_mode === 'self' ? 'self' : 'server';
  let backupPubkey: string | null = null;
  let selfCustodyAt: number | null = null;

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
      const custodyRec = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
      custodyMode = custodyRec.custodyMode;
      backupPubkey = custodyRec.backupPubkey;
      selfCustodyAt = custodyRec.selfCustodyAt;
    } catch {}
  }

  // Row-based, never inferred from `near_account`: a provisioned vault account
  // without a registered credential must read as "no passkey" so the client
  // sends the user through create-passkey instead of a doomed credential lookup.
  let hasPasskey = false;
  let pendingOnchainPasskeysCount = 0;
  if (c.env.DB) {
    try {
      const pk = await c.env.DB.prepare('SELECT id FROM passkeys WHERE x_id = ?')
        .bind(session.x_id)
        .first();
      if (pk) hasPasskey = true;
      if (custodyMode === 'self') {
        const pending = (await c.env.DB.prepare(
          'SELECT COUNT(*) AS cnt FROM passkeys WHERE x_id = ? AND near_p256_pubkey IS NOT NULL AND onchain_added_at IS NULL'
        )
          .bind(session.x_id)
          .first()) as { cnt: number } | null;
        pendingOnchainPasskeysCount = Number(pending?.cnt || 0);
      }
    } catch {}
  }

  let oneClickSessionActive = custodyMode === 'server';
  if (custodyMode === 'self') {
    try {
      oneClickSessionActive = await hasCachedOneClickSession(c.env, session.x_id);
    } catch {
      oneClickSessionActive = false;
    }
  }

  // Recovery-code status is optional metadata. A missing pepper or transient
  // D1 issue must not make the whole session endpoint fail.
  let hasRecoveryCodes = false;
  let recoveryCodesRemaining = 0;
  if (c.env.DB) {
    try {
      const status = await getRecoveryStatus(c.env, session.x_id);
      hasRecoveryCodes = status.hasCodes;
      recoveryCodesRemaining = status.remaining;
    } catch {}
  }

  const passkeyVerified = session.passkey_verified === true;
  const recoveryAuthorized =
    session.recovery_authorized === true &&
    typeof session.recovery_authorized_at === 'number' &&
    Date.now() - session.recovery_authorized_at <= 10 * 60 * 1000;

  const user = {
    id: session.x_id,
    handle: session.x_handle,
    name: session.x_name,
    avatarUrl: `https://unavatar.io/twitter/${session.x_handle}`,
    nearAccount,
    hasPasskey,
    passkeyVerified,
    recoveryAuthorized,
    hasRecoveryCodes,
    recoveryCodesRemaining,
    custodyMode,
    backupPubkey,
    selfCustodyAt,
    oneClickSessionActive,
    pendingOnchainPasskeysCount,
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
      passkeyVerified,
      recoveryAuthorized,
      hasRecoveryCodes,
      recoveryCodesRemaining,
      custodyMode,
      backupPubkey,
      selfCustodyAt,
      oneClickSessionActive,
      pendingOnchainPasskeysCount,
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
    const rpId = resolveRpId(c.env);
    // Passkey Discoverable Credentials (Resident Keys):
    // Do not restrict allowCredentials so iOS and modern browsers display
    // the native "Sign in to uprail.world with your passkey" prompt with Face ID/Touch ID
    // and the "Other Options" button rather than locking the user to a foreign device ID.
    const options = await webauthnService.generateAuthenticationOptions({ rpId });

    // Store challenge via challengeService (zero KV writes)
    await storeChallenge(c.env, {
      key: `webauthn_auth:${options.challenge}`,
      challenge: options.challenge,
      purpose: 'passkey_login',
      ttlSeconds: 300,
    });

    // rpId is not part of the WebAuthn spec response but the client needs it
    // so authentication uses the same relying party as registration.
    return c.json({ ...options, rpId });
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

    // Look up passkey credential from D1
    let passkeyRow: { x_id: string; public_key: string; counter: number } | null = null;
    if (c.env.DB) {
      passkeyRow = await c.env.DB.prepare(
        'SELECT x_id, public_key, counter FROM passkeys WHERE credential_id = ?'
      )
        .bind(assertion.id)
        .first<any>();

      if (!passkeyRow && assertion.rawId && assertion.rawId !== assertion.id) {
        passkeyRow = await c.env.DB.prepare(
          'SELECT x_id, public_key, counter FROM passkeys WHERE credential_id = ?'
        )
          .bind(assertion.rawId)
          .first<any>();
      }
    }

    if (!passkeyRow) {
      return c.json<ErrorResponse>(
        { error: 'Passkey not recognized. Please sign in with X first to register your passkey.', code: 'CREDENTIAL_NOT_FOUND' },
        404
      );
    }

    // A passkey sign-in must never silently switch an already-authenticated
    // session to the credential owner. Switching accounts requires an explicit
    // sign-out first, so one user's passkey cannot take over another user's
    // active X session.
    const activeSession = c.get('session');
    if (activeSession?.x_id && activeSession.x_id !== passkeyRow.x_id) {
      return c.json<ErrorResponse>(
        {
          error: 'This passkey belongs to a different UPRAIL account. Sign out before switching accounts.',
          code: 'ACCOUNT_MISMATCH',
        },
        403
      );
    }

    // Same strict expectations used at registration: the configured origin/rpId
    // only (plus localhost ports in local dev). Never a hardcoded host list —
    // that would accept an assertion minted on an unrelated site sharing the
    // registrable domain.
    const expectedOrigins = allowedWebAuthnOrigins(c.env);
    const expectedRPIDs = allowedWebAuthnRpIds(c.env);

    const verification = await webauthnService.verifyAuthentication({
      assertion,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: expectedRPIDs,
      credential: {
        id: assertion.id,
        publicKey: passkeyRow.public_key,
        counter: Number(passkeyRow.counter) || 0,
      },
    });

    if (!verification.verified) {
      return c.json<ErrorResponse>({ error: 'Passkey verification failed', code: 'VERIFICATION_FAILED' }, 401);
    }

    // Fetch user profile from D1
    let userProfile: { x_id: string; x_handle: string; x_name: string; near_account?: string | null; is_activated?: number | null; personal_invite_code?: string | null } | null = null;
    if (c.env.DB) {
      userProfile = await c.env.DB.prepare(
        'SELECT x_id, x_handle, x_name, near_account, is_activated, personal_invite_code FROM x_identities WHERE x_id = ?'
      )
        .bind(passkeyRow.x_id)
        .first<any>();
    }

    if (!userProfile) {
      return c.json<ErrorResponse>({ error: 'User profile not found', code: 'USER_NOT_FOUND' }, 404);
    }

    // Update counter in D1
    const newCounter = (verification as any).authenticationInfo?.newCounter ?? 0;
    if (c.env.DB) {
      await c.env.DB.prepare('UPDATE passkeys SET counter = ? WHERE credential_id = ?')
        .bind(newCounter, assertion.id)
        .run()
        .catch(() => {});
    }

    const custodyRec = await nearRpc.getUserCustodyRecord(c.env, userProfile.x_id);

    // Create session and set cookie (zero KV writes)
    const session = await createSession(c, {
      x_id: userProfile.x_id,
      x_handle: userProfile.x_handle,
      x_name: userProfile.x_name,
      near_account: userProfile.near_account,
      custody_mode: custodyRec.custodyMode,
      is_activated: userProfile.is_activated === 1,
      personal_invite_code: userProfile.personal_invite_code || null,
      passkey_verified: true,
      passkey_verified_at: Date.now(),
    });

    const isActivated = userProfile.is_activated === 1 || session.is_activated;
    const personalInviteCode = userProfile.personal_invite_code || session.personal_invite_code;

    // Existing users who predate recovery codes get them backfilled on their
    // next verified sign-in. Plaintext is never returned here: codes are only
    // revealed by POST /auth/recovery/codes after a fresh passkey assertion.
    let recovery: Awaited<ReturnType<typeof ensureRecoveryCodes>> = null;
    try {
      recovery = await ensureRecoveryCodes(c.env, session.x_id);
    } catch (recoveryErr) {
      console.warn('Recovery-code backfill skipped:', recoveryErr);
    }

    return c.json({
      success: true,
      user: {
        id: session.x_id,
        handle: session.x_handle,
        name: session.x_name,
        avatarUrl: `https://unavatar.io/twitter/${session.x_handle}`,
        nearAccount: session.near_account,
        hasPasskey: true,
        passkeyVerified: true,
        custodyMode: custodyRec.custodyMode,
        backupPubkey: custodyRec.backupPubkey,
        hasRecoveryCodes: recovery?.hasCodes ?? true,
        recoveryCodesRemaining: recovery?.remaining ?? undefined,
        isActivated: !!isActivated,
        personalInviteCode: personalInviteCode || null,
      },
    });
  } catch (err: any) {
    console.error('Passkey login verify error:', err);
    return c.json<ErrorResponse>({ error: publicErrorMessage(err, 'Passkey login failed'), code: 'LOGIN_FAILED' }, 500);
  }
});

/**
 * POST /auth/passkey/confirm
 *
 * Completes the second factor after X OAuth. requirePasskeyAuth() proves the
 * assertion belongs to the current session's x_id, so this cannot be used to
 * swap accounts the way the standalone passkey-login endpoint can.
 */
authRouter.post('/passkey/confirm', requireAuth(), requirePasskeyAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const now = Date.now();
    await updateSession(c, {
      passkey_verified: true,
      passkey_verified_at: now,
      recovery_authorized: false,
      recovery_authorized_at: undefined,
    });

    let recovery: Awaited<ReturnType<typeof ensureRecoveryCodes>> = null;
    try {
      recovery = await ensureRecoveryCodes(c.env, session.x_id);
    } catch (recoveryErr) {
      console.warn('Recovery-code backfill skipped:', recoveryErr);
    }

    return c.json({
      success: true,
      passkeyVerified: true,
      hasRecoveryCodes: recovery?.hasCodes ?? true,
      recoveryCodesRemaining: recovery?.remaining ?? undefined,
    });
  } catch (err: any) {
    console.error('Passkey session confirmation error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Passkey confirmation failed'), code: 'PASSKEY_CONFIRM_FAILED' },
      500
    );
  }
});

/**
 * GET /auth/recovery/status
 * Returns counts only — plaintext codes are never stored or re-readable.
 */
authRouter.get('/recovery/status', requireAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const status = await getRecoveryStatus(c.env, session.x_id);
    return c.json(status);
  } catch (err: any) {
    console.error('Recovery status error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Could not load recovery-code status'), code: 'RECOVERY_STATUS_FAILED' },
      500
    );
  }
});

/**
 * POST /auth/recovery/codes
 * Reveals unused codes after a fresh passkey assertion. Codes generated
 * before encrypted-at-rest storage are counted as legacy and cannot be shown.
 */
authRouter.post('/recovery/codes', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const result = await listRecoveryCodes(c.env, session.x_id);
    return c.json({
      success: true,
      codes: result.codes,
      remaining: result.remaining,
      legacy: result.legacy,
    });
  } catch (err: any) {
    console.error('Recovery-code view error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Could not load recovery codes'), code: 'RECOVERY_VIEW_FAILED' },
      500
    );
  }
});

/**
 * POST /auth/recovery/verify
 *
 * Consumes one single-use code and grants a short-lived authorization to
 * replace a lost passkey. The account must still be X-authenticated.
 */
authRouter.post(
  '/recovery/verify',
  requireAuth(),
  rateLimit({ limit: 5, prefix: 'recovery-verify', strict: true }),
  async (c) => {
    try {
      const session = c.get('session')!;
      const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
      if (custody.custodyMode === 'self') {
        return c.json<ErrorResponse>(
          {
            error: 'Self-custody accounts must recover using the device Recovery Key you saved during upgrade.',
            code: 'SELF_CUSTODY_BACKUP_KEY_REQUIRED',
          },
          403
        );
      }
      const body = await c.req.json<{ code?: string }>().catch(() => null);
      const result = await verifyRecoveryCode(c.env, session.x_id, body?.code);

      if (!result.ok) {
        return c.json<ErrorResponse>(
          { error: 'That recovery code is invalid or has already been used.', code: 'INVALID_RECOVERY_CODE' },
          400
        );
      }

      await updateSession(c, {
        recovery_authorized: true,
        recovery_authorized_at: Date.now(),
      });

      return c.json({ success: true, remaining: result.remaining });
    } catch (err: any) {
      console.error('Recovery-code verification error:', err);
      return c.json<ErrorResponse>(
        { error: publicErrorMessage(err, 'Could not verify recovery code'), code: 'RECOVERY_VERIFY_FAILED' },
        500
      );
    }
  }
);

/**
 * POST /auth/recovery/regenerate
 * Requires a fresh passkey assertion; invalidates every unused old code.
 */
authRouter.post('/recovery/regenerate', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), async (c) => {
  try {
    const session = c.get('session')!;
    const generated = await generateRecoveryCodes(c.env, session.x_id, { replace: true });
    return c.json({
      success: true,
      recoveryCodes: generated?.codes || [],
      hasRecoveryCodes: true,
      remaining: generated?.remaining || 0,
    });
  } catch (err: any) {
    console.error('Recovery-code regeneration error:', err);
    return c.json<ErrorResponse>(
      { error: publicErrorMessage(err, 'Could not generate recovery codes'), code: 'RECOVERY_GENERATE_FAILED' },
      500
    );
  }
});

/**
 * GET /auth/export-key-challenge
 * Generates a challenge for the user to authenticate with their WebAuthn passkey
 * before inspecting their standard (server-derived) NEAR private key.
 * Disabled once upgraded to Self-Custody.
 */
authRouter.get('/export-key-challenge', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
  if (custody.custodyMode === 'self') {
    return c.json<ErrorResponse>(
      {
        error:
          'This account uses Passkey Self-Custody. Uprail no longer holds or exports an account private key — only your passkey and your saved device Recovery Key control this account.',
        code: 'SELF_CUSTODY_NO_EXPORT',
      },
      403
    );
  }
  const rpId = resolveRpId(c.env);

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
    requireSessionSecret(c.env)
  );

  return c.json({ options, challengeToken });
});

/**
 * POST /auth/export-key
 * Verifies the WebAuthn passkey assertion and returns the server-derived NEAR
 * signing keypair for standard (custody_mode='server') accounts.
 */
authRouter.post('/export-key', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const custody = await nearRpc.getUserCustodyRecord(c.env, session.x_id);
  if (custody.custodyMode === 'self') {
    return c.json<ErrorResponse>(
      {
        error:
          'Self-custody accounts have no server-exportable private key. Your passkey (on-chain P-256) and device Recovery Key exclusively control this account.',
        code: 'SELF_CUSTODY_NO_EXPORT',
      },
      403
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as any;
  const { assertion, challengeToken } = body;

  if (!assertion || !challengeToken) {
    return c.json<ErrorResponse>(
      { error: 'Missing assertion or challenge token', code: 'INVALID_REQUEST' },
      400
    );
  }

  // Verify challenge token
  const verifySecret = getSessionSecret(c.env);
  const payloadStr = verifySecret ? await verifyAndUnpack(challengeToken, verifySecret) : null;
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

  const expectedOrigins = allowedWebAuthnOrigins(c.env);
  const expectedRPIDs = allowedWebAuthnRpIds(c.env);

  try {
    const verification = await webauthnService.verifyAuthentication({
      assertion,
      expectedChallenge: payload.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: expectedRPIDs,
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

  // Passkey verified for standard custody_mode='server' account.
  const derived = await nearRpc.deriveUserNearKeypair(c.env, session.x_id);
  const nearAccount = session.near_account || derived.accountId;

  return c.json({
    success: true,
    custodyMode: 'server',
    custodyNote:
      'Standard managed key: Uprail derives this key on demand when you authorize actions. Upgrade to Self-Custody in Settings to revoke server signing access on intents.near.',
    nearAccount,
    privateKey: derived.privateKeyB58,
    publicKey: derived.publicKeyB58,
  });
});

