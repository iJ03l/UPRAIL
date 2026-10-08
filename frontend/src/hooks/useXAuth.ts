import { useState, useEffect, useCallback } from 'react';
import { XUser } from '../types';
import { api } from '../lib/api';

export function useXAuth() {
  const [user, setUser] = useState<XUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.getAuthStatus();
      setUser(res.user);
    } catch (err) {
      console.error('Failed to load X session:', err);
      setError('Could not verify session');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = async (demoHandle?: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const loggedUser = await api.loginWithX(demoHandle);
      setUser(loggedUser);
      return loggedUser;
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
      setUser(null);
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
