import { useState, useEffect, useCallback } from 'react';
import { XUser } from '../types';
import { api } from '../lib/api';

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
  const [isLoading, setIsLoading] = useState(!globalUser);
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
    try {
      setIsLoading(true);
      setError(null);
      await api.loginWithX();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);
      await api.logout();
      setGlobalUser(null);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    user,
    isAuthenticated: !!user,
    isLoading,
    error,
    login,
    logout,
    refreshSession: checkSession,
  };
}
