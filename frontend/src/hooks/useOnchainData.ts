/**
 * useOnchainData — React hook for live NEAR blockchain data
 *
 * Provides real-time onchain data for the dashboard:
 *  - Live token list (all supported by NEAR Intents, no hardcoded list)
 *  - Live intent account balances (per authenticated user)
 *  - Live deposit addresses (ephemeral, per-chain)
 *  - Live transaction history from the intents contract
 *
 * All data is fetched fresh from onchain on mount and can be refreshed
 * manually. Deposit addresses are always fetched fresh (never cached)
 * because they are ephemeral.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  OnchainToken,
  OnchainBalance,
  DepositAddress,
  OnchainTx,
  fetchOnchainTokens,
  fetchOnchainBalances,
  fetchDepositAddress,
  fetchAllDepositAddresses,
  fetchOnchainHistory,
  fetchIntentAccount,
} from '../lib/onchainApi';

export interface UseOnchainDataResult {
  // Supported tokens (live from intents contract)
  tokens: OnchainToken[];
  isLoadingTokens: boolean;

  // User's intent account balances (live from onchain)
  balances: OnchainBalance[];
  totalBalanceUsd: number | null;
  nearAccount: string | null;
  hasIntentAccount: boolean;
  isLoadingBalances: boolean;
  /** Why a missing intent account has not been provisioned yet (if known). */
  accountError: string | null;

  // Deposit addresses (always fresh from onchain — ephemeral!)
  depositAddresses: DepositAddress[];
  getDepositAddress: (chain: string, token?: string) => DepositAddress | undefined;
  isLoadingAddresses: boolean;
  refreshDepositAddress: (chain: string, token?: string) => Promise<DepositAddress | null>;

  // Onchain transaction history
  transactions: OnchainTx[];
  isLoadingHistory: boolean;

  // Refresh functions
  refresh: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  refreshHistory: () => Promise<void>;

  error: string | null;
}

/**
 * Live registry price for a balance, or null when we have none. There is no
 * oracle table and no peg pin: an unpriced holding must not silently turn
 * into $0 (which made the dashboard total quietly wrong).
 */
function estimateUsd(symbol: string, amountFormatted: string, tokens: OnchainToken[] = []): number | null {
  const amount = parseFloat(amountFormatted) || 0;
  if (amount <= 0) return 0;
  const sym = (symbol || '').trim();

  const live = tokens.find((t) => (t.symbol || '').toLowerCase() === sym.toLowerCase())?.priceUsd;
  return typeof live === 'number' && isFinite(live) && live > 0 ? amount * live : null;
}

/** Prices are polled so the total on screen tracks the market, not mount time. */
const PRICE_REFRESH_MS = 30_000;

// ── Shared SWR Module Cache ─────────────────────────────────────────────────
const CACHE_KEY = 'uprail_onchain_cache';

interface OnchainCache {
  owner: string | null;
  tokens: OnchainToken[];
  balances: OnchainBalance[];
  nearAccount: string | null;
  hasIntentAccount: boolean;
  depositAddresses: DepositAddress[];
  transactions: OnchainTx[];
}

/**
 * Balances are PII for a privacy product. The snapshot is tagged with the
 * account that wrote it and dropped on read when a different account (or no
 * account) is signed in — an expired session that never hit "logout" used to
 * leave the previous user's balances on screen for the next sign-in.
 */
function cacheOwnerId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('uprail_x_user') || localStorage.getItem('uprail_user_cache_v1');
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u && u.id ? String(u.id) : null;
  } catch {
    return null;
  }
}

let globalCache: OnchainCache = {
  owner: null,
  tokens: [],
  balances: [],
  nearAccount: null,
  hasIntentAccount: false,
  depositAddresses: [],
  transactions: [],
};

// Hydrate on module load
try {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const owner = cacheOwnerId();
      if (parsed) {
        if (owner && parsed.owner && parsed.owner !== owner) {
          localStorage.removeItem(CACHE_KEY);
        } else {
          globalCache = { ...globalCache, ...parsed };
        }
      }
    }
  }
} catch {}

const listeners = new Set<() => void>();

export function persistCache(patch: Partial<OnchainCache>) {
  const owner = cacheOwnerId();
  // Never persist across accounts: a snapshot written by user A must not be
  // readable after user B signs in on the same browser.
  if (globalCache.owner && owner && globalCache.owner !== owner) {
    globalCache = { owner, tokens: [], balances: [], nearAccount: null, hasIntentAccount: false, depositAddresses: [], transactions: [] };
  } else if (!globalCache.owner && owner) {
    globalCache = { ...globalCache, owner };
  }
  globalCache = { ...globalCache, ...patch, owner };
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CACHE_KEY, JSON.stringify(globalCache));
    }
  } catch {}
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

export { globalCache };

export function useOnchainData(): UseOnchainDataResult {
  const [tokens, setTokens] = useState<OnchainToken[]>(globalCache.tokens);
  const [isLoadingTokens, setIsLoadingTokens] = useState(globalCache.tokens.length === 0);

  const [balances, setBalances] = useState<OnchainBalance[]>(globalCache.balances);
  const [nearAccount, setNearAccount] = useState<string | null>(globalCache.nearAccount);
  const [hasIntentAccount, setHasIntentAccount] = useState(globalCache.hasIntentAccount);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isLoadingBalances, setIsLoadingBalances] = useState(
    globalCache.balances.length === 0 && !globalCache.hasIntentAccount
  );

  const [depositAddresses, setDepositAddresses] = useState<DepositAddress[]>(globalCache.depositAddresses);
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(globalCache.depositAddresses.length === 0);

  const [transactions, setTransactions] = useState<OnchainTx[]>(globalCache.transactions);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Synchronize state across all components when global cache updates
  useEffect(() => {
    const sync = () => {
      setTokens(globalCache.tokens);
      setBalances(globalCache.balances);
      setNearAccount(globalCache.nearAccount);
      setHasIntentAccount(globalCache.hasIntentAccount);
      setDepositAddresses(globalCache.depositAddresses);
      setTransactions(globalCache.transactions);
    };
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  // ── Load supported tokens (no auth required) ──────────────────────────────
  const loadTokens = useCallback(async () => {
    try {
      if (globalCache.tokens.length === 0) setIsLoadingTokens(true);
      const toks = await fetchOnchainTokens();
      if (toks.length > 0) {
        setTokens(toks);
        persistCache({ tokens: toks });
      }
    } catch (err: any) {
      console.warn('[useOnchainData] tokens:', err);
      setError(err.message);
    } finally {
      setIsLoadingTokens(false);
    }
  }, []);

  // ── Load user's intent account balances ───────────────────────────────────
  const loadBalances = useCallback(async () => {
    try {
      if (globalCache.balances.length === 0 && !globalCache.hasIntentAccount) {
        setIsLoadingBalances(true);
      }
      setError(null);

      // Check intent account first
      const account = await fetchIntentAccount();
      setNearAccount(account.nearAccount);
      setHasIntentAccount(account.hasIntentAccount);
      setAccountError(account.hasIntentAccount ? null : (account.provisionError ?? null));
      persistCache({ nearAccount: account.nearAccount, hasIntentAccount: account.hasIntentAccount });

      if (account.hasIntentAccount && account.nearAccount) {
        const response = await fetchOnchainBalances();
        if (response) {
          setBalances(response.balances);
          persistCache({ balances: response.balances });
        }
      }
    } catch (err: any) {
      console.warn('[useOnchainData] balances:', err);
    } finally {
      setIsLoadingBalances(false);
    }
  }, []);

  // ── Load all deposit addresses ─────────────────────────────────────────────
  const loadDepositAddresses = useCallback(async () => {
    try {
      if (globalCache.depositAddresses.length === 0) {
        setIsLoadingAddresses(true);
      }
      const addresses = await fetchAllDepositAddresses();
      if (addresses.length > 0) {
        setDepositAddresses(addresses);
        persistCache({ depositAddresses: addresses });
      }
    } catch (err: any) {
      console.warn('[useOnchainData] deposit addresses:', err);
    } finally {
      setIsLoadingAddresses(false);
    }
  }, []);

  // ── Load transaction history ───────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    try {
      if (globalCache.transactions.length === 0) {
        setIsLoadingHistory(true);
      }
      const response = await fetchOnchainHistory(50);
      setTransactions(response.transactions);
      persistCache({ transactions: response.transactions });
    } catch (err: any) {
      console.warn('[useOnchainData] history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // ── Full refresh ──────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    await Promise.allSettled([
      loadTokens(),
      loadBalances(),
      loadDepositAddresses(),
      loadHistory(),
    ]);
  }, [loadTokens, loadBalances, loadDepositAddresses, loadHistory]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mounted) return;
      await Promise.allSettled([
        loadTokens(),
        loadBalances(),
        loadDepositAddresses(),
        loadHistory(),
      ]);
    })();
    return () => { mounted = false; };
  }, [loadTokens, loadBalances, loadDepositAddresses, loadHistory]);

  // ── Keep prices live while the tab is open ────────────────────────────────
  // Balances keep their own cadence; only the token/price payload is repolled
  // so the number on screen does not freeze at whatever it was on mount.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadTokens();
    }, PRICE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadTokens]);

  // ── Get deposit address for a specific chain & token ───────────────────────
  const getDepositAddress = useCallback(
    (chain: string, token?: string): DepositAddress | undefined => {
      return depositAddresses.find(
        (a) =>
          (a.chain === chain || a.chainName?.toLowerCase() === chain.toLowerCase()) &&
          (!token || !a.token || a.token.toLowerCase() === token.toLowerCase())
      );
    },
    [depositAddresses]
  );

  // ── Refresh deposit address for a single chain & token (always fresh) ─────
  const refreshDepositAddress = useCallback(
    async (chain: string, token?: string): Promise<DepositAddress | null> => {
      try {
        const fresh = await fetchDepositAddress(chain, true, token);
        if (fresh) {
          setDepositAddresses((prev) => {
            const filtered = prev.filter(
              (a) => !(a.chain === chain && (!token || !a.token || a.token.toLowerCase() === token.toLowerCase()))
            );
            return [...filtered, fresh];
          });
        }
        return fresh;
      } catch (err: any) {
        console.warn(`[useOnchainData] refreshDepositAddress(${chain}, ${token}):`, err);
        return null;
      }
    },
    []
  );

  // ── Compute total balance USD ─────────────────────────────────────────────
  const perBalanceUsd = balances.map((b) => estimateUsd(b.symbol, b.amountFormatted, tokens));
  const totalBalanceUsd = perBalanceUsd.some((v) => v === null)
    ? null
    : perBalanceUsd.reduce<number>((acc, v) => acc + (v as number), 0);

  return {
    tokens,
    isLoadingTokens,
    balances,
    totalBalanceUsd,
    nearAccount,
    hasIntentAccount,
    isLoadingBalances,
    accountError,
    depositAddresses,
    getDepositAddress,
    isLoadingAddresses,
    refreshDepositAddress,
    transactions,
    isLoadingHistory,
    refresh,
    refreshBalances: loadBalances,
    refreshHistory: loadHistory,
    error,
  };
}
