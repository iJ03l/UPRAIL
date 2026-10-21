import { useState, useEffect, useCallback } from 'react';
import { XUser } from '../types';
import { api } from '../lib/api';
import { rememberLastAuth } from '../lib/passkeyStorage';

const USER_CACHE_KEY = 'uprail_user_cache_v1';

// Shared module-level state & subscribers
let globalUser: XUser | null = (() => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY) || localStorage.getItem('uprail_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
})();

const subscribers = new Set<(user: XUser | null) => void>();
let inFlightAuthPromise: Promise<XUser | null> | null = null;

function setGlobalUser(u: XUser | null) {
  globalUser = u;
  if (typeof window !== 'undefined') {
    try {
      if (u) {
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u));
      } else {
        localStorage.removeItem(USER_CACHE_KEY);
      }
    } catch {}
  }
  subscribers.forEach((cb) => cb(u));
}

export function useXAuth() {
  const [user, setUser] = useState<XUser | null>(globalUser);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (nextUser: XUser | null) => {
      setUser(nextUser);
      setIsLoading(false);
    };
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
    };
  }, []);

  const checkSession = useCallback(async () => {
    if (inFlightAuthPromise) {
      try {
        const result = await inFlightAuthPromise;
        setUser(result);
        setIsLoading(false);
        return result;
      } catch {
        // Handled below
      }
    }

    try {
      if (!globalUser) setIsLoading(true);
      setError(null);

      inFlightAuthPromise = api
        .getAuthStatus()
        .then((res) => {
          // A logout landed while this request was in flight: logout already
          // cleared globalUser, the cache keys, and the session cookie, and
          // kicked off a hard redirect. Applying this stale result would
          // re-write the old user into shared state and bounce the tab back
          // to the dashboard mid-sign-out, so drop it entirely.
          if (res.stale) return null;
          if (res.user) rememberLastAuth(res.user);
          setGlobalUser(res.user);
          return res.user;
        })
        .catch((err) => {
          console.error('Failed to load X session:', err);
          // If 401 or null session, clear cache
          setGlobalUser(null);
          setError('Could not verify session');
          return null;
        })
        .finally(() => {
          inFlightAuthPromise = null;
          setIsLoading(false);
        });

      return await inFlightAuthPromise;
    } catch (err) {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = async () => {
    // OAuth leaves the page. Keep this separate from session loading so the
    // login screen can paint a real "taking you to X" state instead of
    // unmounting its own button the instant it is tapped.
    setIsRedirecting(true);
    setError(null);
    try {
      await api.loginWithX();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      setIsRedirecting(false);
      throw err;
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);
      // api.logout() destroys the server cookie AND clears both user cache
      // keys, so nothing here can re-hydrate the old session afterwards.
      await api.logout();
      setGlobalUser(null);
    } catch (err) {
      console.error('Logout error:', err);
      // Even a failed backend call must end in a signed-out client: clear local
      // state so ProtectedRoute sees no user and bounces to /login.
      setGlobalUser(null);
    } finally {
      setIsLoading(false);
      // Hard navigation, not a router push: a full unload guarantees no
      // in-flight checkSession() or cached-module state survives to send the
      // user back to the dashboard.
      window.location.replace('/login');
    }
  };

  return {
    user,
    isAuthenticated: !!user,
    isLoading,
    isRedirecting,
    error,
    login,
    logout,
    refreshSession: checkSession,
  };
}
