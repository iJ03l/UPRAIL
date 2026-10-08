/**
 * KV-backed session middleware for UP (UPRAIL.app)
 */

import { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext, Session } from '../types';

export const SESSION_COOKIE_NAME = 'uprail_session';
export const SESSION_TTL_SECONDS = 86400; // 24 hours

export const sessionMiddleware = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const sessionId = getCookie(c, SESSION_COOKIE_NAME);

    if (sessionId) {
      try {
        const rawSession = await c.env.CACHE.get(`session:${sessionId}`);
        if (rawSession) {
          const session = JSON.parse(rawSession) as Session;
          if (session.expires_at > Date.now()) {
            c.set('session', session);
          } else {
            // Expired in data
            await c.env.CACHE.delete(`session:${sessionId}`);
            deleteCookie(c, SESSION_COOKIE_NAME, {
              path: '/',
              secure: true,
              sameSite: 'Strict',
            });
          }
        }
      } catch (err) {
        console.error('Failed to load session from KV:', err);
      }
    }

    return await next();
  };
};

/**
 * Creates a new session, writes it to KV, and sets the secure HttpOnly cookie
 */
export async function createSession(
  c: Context<AppContext>,
  userData: {
    x_id: string;
    x_handle: string;
    x_name: string;
    near_account?: string | null;
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
    created_at: now,
    expires_at: expiresAt,
  };

  await c.env.CACHE.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });

  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: SESSION_TTL_SECONDS,
  });

  c.set('session', session);
  return session;
}

/**
 * Updates an active session in KV
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

  const remainingTtl = Math.max(1, Math.floor((updated.expires_at - Date.now()) / 1000));
  await c.env.CACHE.put(`session:${current.session_id}`, JSON.stringify(updated), {
    expirationTtl: remainingTtl,
  });

  c.set('session', updated);
  return updated;
}

/**
 * Destroys current session from KV and clears cookie
 */
export async function destroySession(c: Context<AppContext>): Promise<void> {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId) {
    await c.env.CACHE.delete(`session:${sessionId}`);
    deleteCookie(c, SESSION_COOKIE_NAME, {
      path: '/',
      secure: true,
      sameSite: 'Strict',
    });
  }
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
