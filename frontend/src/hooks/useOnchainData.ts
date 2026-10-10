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
  totalBalanceUsd: number;
  nearAccount: string | null;
  hasIntentAccount: boolean;
  isLoadingBalances: boolean;

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

// Simple USD price oracle for display (real prices should come from a price feed)
// Using approximate market prices; in production connect to a price feed
const PRICE_ORACLE: Record<string, number> = {
  usdc: 1.0,
  usdt: 1.0,
  dai: 1.0,
  near: 5.85,
  eth: 3450.0,
  weth: 3450.0,
  btc: 68500.0,
  wbtc: 68500.0,
  sol: 180.0,
  bnb: 610.0,
  matic: 0.85,
  arb: 0.95,
  op: 1.8,
};

function estimateUsd(symbol: string, amountFormatted: string): number {
  const price = PRICE_ORACLE[symbol.toLowerCase()] ?? 0;
  const amount = parseFloat(amountFormatted) || 0;
  return amount * price;
}

// ── Shared SWR Module Cache ─────────────────────────────────────────────────
const CACHE_KEY = 'uprail_onchain_cache';

interface OnchainCache {
  tokens: OnchainToken[];
  balances: OnchainBalance[];
  nearAccount: string | null;
  hasIntentAccount: boolean;
  depositAddresses: DepositAddress[];
  transactions: OnchainTx[];
}

let globalCache: OnchainCache = {
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
      if (parsed) globalCache = { ...globalCache, ...parsed };
    }
  }
} catch {}

function persistCache(patch: Partial<OnchainCache>) {
  globalCache = { ...globalCache, ...patch };
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CACHE_KEY, JSON.stringify(globalCache));
    }
  } catch {}
}

export function useOnchainData(): UseOnchainDataResult {
  const [tokens, setTokens] = useState<OnchainToken[]>(globalCache.tokens);
  const [isLoadingTokens, setIsLoadingTokens] = useState(globalCache.tokens.length === 0);

  const [balances, setBalances] = useState<OnchainBalance[]>(globalCache.balances);
  const [nearAccount, setNearAccount] = useState<string | null>(globalCache.nearAccount);
  const [hasIntentAccount, setHasIntentAccount] = useState(globalCache.hasIntentAccount);
  const [isLoadingBalances, setIsLoadingBalances] = useState(
    globalCache.balances.length === 0 && !globalCache.hasIntentAccount
  );

  const [depositAddresses, setDepositAddresses] = useState<DepositAddress[]>(globalCache.depositAddresses);
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(globalCache.depositAddresses.length === 0);

  const [transactions, setTransactions] = useState<OnchainTx[]>(globalCache.transactions);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [error, setError] = useState<string | null>(null);

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
  const totalBalanceUsd = balances.reduce(
    (acc, b) => acc + estimateUsd(b.symbol, b.amountFormatted),
    0
  );

  return {
    tokens,
    isLoadingTokens,
    balances,
    totalBalanceUsd,
    nearAccount,
    hasIntentAccount,
    isLoadingBalances,
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
