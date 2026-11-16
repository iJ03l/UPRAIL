/**
 * Stateless HMAC-SHA256 signed session middleware for UP (UPRAIL.app)
 * Eliminates KV writes and database hits on every request.
 * Tamper-proof, cryptographically verified at the edge.
 */

import { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext, Session } from '../types';
import { signPayload, verifyAndUnpack } from '../utils/crypto';
import { getSessionSecret, requireSessionSecret } from '../utils/secrets';

export const SESSION_COOKIE_NAME = 'uprail_session';
export const SESSION_TTL_SECONDS = 86400 * 7; // 7 days

let missingSecretWarned = false;
function warnMissingSecret(): void {
  if (missingSecretWarned) return;
  missingSecretWarned = true;
  console.error('SESSION_SECRET is not configured — all sessions are rejected (fail closed)');
}

// Sessions issued between 85abc57 and d948918 were written with
// `Domain=.uprail.world`. A host-only delete does not match a domain-scoped
// cookie, so the legacy one kept the user authenticated and bounced them
// straight back to the dashboard after sign-out. Every cleanup path therefore
// deletes BOTH variants.
function deleteSessionCookies(c: Context<AppContext>): void {
  const reqUrl = new URL(c.req.url);
  const base: any = {
    path: '/',
    secure: reqUrl.protocol === 'https:',
    sameSite: 'Lax',
  };
  deleteCookie(c, SESSION_COOKIE_NAME, base);
  deleteCookie(c, SESSION_COOKIE_NAME, { ...base, domain: 'uprail.world' });
}

export const sessionMiddleware = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const rawCookie = getCookie(c, SESSION_COOKIE_NAME);

    if (rawCookie) {
      const secret = getSessionSecret(c.env);

      if (!secret) {
        // Fail closed: never authenticate against an unsigned/unguessable-cookie-free deployment.
        warnMissingSecret();
        deleteSessionCookies(c);
        return await next();
      }

      // 1. Signed cookie format (base64url.base64url)
      if (rawCookie.includes('.')) {
        try {
          const payloadStr = await verifyAndUnpack(rawCookie, secret);
          if (payloadStr) {
            const session = JSON.parse(payloadStr) as Session;
            if (session.expires_at > Date.now()) {
              c.set('session', session);
            } else {
              // Expired
              deleteSessionCookies(c);
            }
          }
        } catch (err) {
          console.error('Session signature unpack error:', err);
        }
      } else {
        // 2. Legacy raw sessionId fallback (read-only KV check, NO writes)
        try {
          if (c.env.CACHE) {
            const rawSession = await c.env.CACHE.get(`session:${rawCookie}`);
            if (rawSession) {
              const session = JSON.parse(rawSession) as Session;
              if (session.expires_at > Date.now()) {
                c.set('session', session);
              }
            }
          }
        } catch (err) {
          console.warn('Legacy session read error:', err);
        }
      }
    }

    return await next();
  };
};

/**
 * Creates a new session, signs it with HMAC-SHA256, and sets the secure HttpOnly cookie.
 * 0 KV writes, 0 database writes.
 */
export async function createSession(
  c: Context<AppContext>,
  userData: {
    x_id: string;
    x_handle: string;
    x_name: string;
    near_account?: string | null;
    custody_mode?: 'server' | 'self';
    is_activated?: boolean;
    personal_invite_code?: string | null;
    passkey_verified?: boolean;
    passkey_verified_at?: number;
  }
): Promise<Session> {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;

  const session: Session = {
    session_id: sessionId,
    x_id: userData.x_id,
    x_handle: userData.x_handle,
    x_name: userData.x_name,
    near_account: userData.near_account || null,
    custody_mode: userData.custody_mode || 'server',
    is_activated: userData.is_activated,
    personal_invite_code: userData.personal_invite_code || null,
    passkey_verified: userData.passkey_verified === true,
    passkey_verified_at: userData.passkey_verified === true
      ? (userData.passkey_verified_at || now)
      : undefined,
    created_at: now,
    expires_at: expiresAt,
  };

  const secret = requireSessionSecret(c.env);
  const signedToken = await signPayload(JSON.stringify(session), secret);

  const reqUrl = new URL(c.req.url);
  // Host-only cookie: app and API share one origin, so the cookie must not
  // leak to sibling subdomains. The old `.uprail.world` domain also matched
  // hostile lookalikes like `evil-uprail.world` (endsWith).
  const cookieOptions: any = {
    path: '/',
    httpOnly: true,
    secure: reqUrl.protocol === 'https:',
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SECONDS,
  };

  setCookie(c, SESSION_COOKIE_NAME, signedToken, cookieOptions);
  // Retire any lingering `Domain=.uprail.world` session cookie from before
  // d948918 so the browser holds exactly one (host-only) session cookie.
  // getCookie returns the first match, so a stale domain cookie that survives
  // would shadow the fresh host-only one and pin the user to an old session.
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    secure: reqUrl.protocol === 'https:',
    sameSite: 'Lax',
    domain: 'uprail.world',
  });

  c.set('session', session);
  return session;
}

/**
 * Updates an active session, signs the updated payload, and sets the cookie.
 * 0 KV writes.
 */
export async function updateSession(
  c: Context<AppContext>,
  updates: Partial<Omit<Session, 'session_id' | 'created_at'>>
): Promise<Session | null> {
  const current = c.get('session');
  if (!current) return null;

  const updated: Session = {
    ...current,
    ...updates,
  };

  const secret = requireSessionSecret(c.env);
  const signedToken = await signPayload(JSON.stringify(updated), secret);

  const reqUrl = new URL(c.req.url);
  const remainingSeconds = Math.max(1, Math.floor((updated.expires_at - Date.now()) / 1000));
  const cookieOptions: any = {
    path: '/',
    httpOnly: true,
    secure: reqUrl.protocol === 'https:',
    sameSite: 'Lax',
    maxAge: remainingSeconds,
  };

  setCookie(c, SESSION_COOKIE_NAME, signedToken, cookieOptions);

  c.set('session', updated);
  return updated;
}

/**
 * Destroys current session by deleting the cookie.
 * 0 KV writes.
 */
export async function destroySession(c: Context<AppContext>): Promise<void> {
  deleteSessionCookies(c);
}

/**
 * Middleware guard requiring an authenticated X session
 */
export interface RequireAuthOptions {
  /**
   * When true, an X-authenticated session must also have completed the passkey
   * second factor. Onboarding endpoints (registration, recovery, the passkey
   * confirmation itself) deliberately stay on plain requireAuth().
   */
  passkeyVerified?: boolean;
}

export const requireAuth = (options: RequireAuthOptions = {}): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const session = c.get('session');
    if (!session || !session.x_id) {
      return c.json(
        {
          error: 'Authentication required. Please log in with X.',
          code: 'UNAUTHORIZED',
        },
        401
      );
    }
    if (options.passkeyVerified && session.passkey_verified !== true) {
      return c.json(
        {
          error: 'Confirm this sign-in with your passkey to continue.',
          code: 'PASSKEY_CONFIRMATION_REQUIRED',
        },
        403
      );
    }
    return await next();
  };
};

/**
 * Middleware guard requiring a registered NEAR account
 */
export const requireNearAccount = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const session = c.get('session');
    if (!session || !session.near_account) {
      return c.json(
        {
          error: 'NEAR account not registered. Passkey setup required before claiming.',
          code: 'NEAR_ACCOUNT_REQUIRED',
        },
        403
      );
    }
    return await next();
  };
};
