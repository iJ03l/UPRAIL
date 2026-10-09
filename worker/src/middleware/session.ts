/**
 * Stateless HMAC-SHA256 signed session middleware for UP (UPRAIL.app)
 * Eliminates KV writes and database hits on every request.
 * Tamper-proof, cryptographically verified at the edge.
 */

import { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext, Session } from '../types';
import { signPayload, verifyAndUnpack } from '../utils/crypto';

export const SESSION_COOKIE_NAME = 'uprail_session';
export const SESSION_TTL_SECONDS = 86400 * 7; // 7 days

function getSecret(c: Context<AppContext>): string {
  return c.env.SESSION_SECRET || 'uprail_master_signed_session_edge_2026';
}

export const sessionMiddleware = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const rawCookie = getCookie(c, SESSION_COOKIE_NAME);

    if (rawCookie) {
      const secret = getSecret(c);

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
              const reqUrl = new URL(c.req.url);
              deleteCookie(c, SESSION_COOKIE_NAME, {
                path: '/',
                secure: reqUrl.protocol === 'https:',
                sameSite: 'Lax',
              });
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
    is_activated?: boolean;
    personal_invite_code?: string | null;
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
    is_activated: userData.is_activated,
    personal_invite_code: userData.personal_invite_code || null,
    created_at: now,
    expires_at: expiresAt,
  };

  const secret = getSecret(c);
  const signedToken = await signPayload(JSON.stringify(session), secret);

  const reqUrl = new URL(c.req.url);
  const cookieOptions: any = {
    path: '/',
    httpOnly: true,
    secure: reqUrl.protocol === 'https:',
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SECONDS,
  };
  if (reqUrl.hostname.endsWith('uprail.world')) {
    cookieOptions.domain = '.uprail.world';
  }

  setCookie(c, SESSION_COOKIE_NAME, signedToken, cookieOptions);

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

  const secret = getSecret(c);
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
  if (reqUrl.hostname.endsWith('uprail.world')) {
    cookieOptions.domain = '.uprail.world';
  }

  setCookie(c, SESSION_COOKIE_NAME, signedToken, cookieOptions);

  c.set('session', updated);
  return updated;
}

/**
 * Destroys current session by deleting the cookie.
 * 0 KV writes.
 */
export async function destroySession(c: Context<AppContext>): Promise<void> {
  const reqUrl = new URL(c.req.url);
  const deleteOptions: any = {
    path: '/',
    secure: reqUrl.protocol === 'https:',
    sameSite: 'Lax',
  };
  if (reqUrl.hostname.endsWith('uprail.world')) {
    deleteOptions.domain = '.uprail.world';
  }
  deleteCookie(c, SESSION_COOKIE_NAME, deleteOptions);
}

/**
 * Middleware guard requiring an authenticated X session
 */
export const requireAuth = (): MiddlewareHandler<AppContext> => {
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
