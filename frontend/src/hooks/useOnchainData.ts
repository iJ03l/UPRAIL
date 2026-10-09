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
  getDepositAddress: (chain: string) => DepositAddress | undefined;
  isLoadingAddresses: boolean;
  refreshDepositAddress: (chain: string) => Promise<DepositAddress | null>;

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

export function useOnchainData(): UseOnchainDataResult {
  const [tokens, setTokens] = useState<OnchainToken[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);

  const [balances, setBalances] = useState<OnchainBalance[]>([]);
  const [nearAccount, setNearAccount] = useState<string | null>(null);
  const [hasIntentAccount, setHasIntentAccount] = useState(false);
  const [isLoadingBalances, setIsLoadingBalances] = useState(true);

  const [depositAddresses, setDepositAddresses] = useState<DepositAddress[]>([]);
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false);

  const [transactions, setTransactions] = useState<OnchainTx[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // ── Load supported tokens (no auth required) ──────────────────────────────
  const loadTokens = useCallback(async () => {
    try {
      setIsLoadingTokens(true);
      const toks = await fetchOnchainTokens();
      if (toks.length > 0) setTokens(toks);
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
      setIsLoadingBalances(true);
      setError(null);

      // Check intent account first
      const account = await fetchIntentAccount();
      setNearAccount(account.nearAccount);
      setHasIntentAccount(account.hasIntentAccount);

      if (account.hasIntentAccount && account.nearAccount) {
        const response = await fetchOnchainBalances();
        if (response) {
          setBalances(response.balances);
        }
      }
    } catch (err: any) {
      console.warn('[useOnchainData] balances:', err);
      // Don't surface balance errors as hard errors — just show empty
      setBalances([]);
    } finally {
      setIsLoadingBalances(false);
    }
  }, []);

  // ── Load all deposit addresses ─────────────────────────────────────────────
  const loadDepositAddresses = useCallback(async () => {
    try {
      setIsLoadingAddresses(true);
      const addresses = await fetchAllDepositAddresses();
      setDepositAddresses(addresses);
    } catch (err: any) {
      console.warn('[useOnchainData] deposit addresses:', err);
    } finally {
      setIsLoadingAddresses(false);
    }
  }, []);

  // ── Load transaction history ───────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    try {
      setIsLoadingHistory(true);
      const response = await fetchOnchainHistory(50);
      setTransactions(response.transactions);
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

  // ── Get deposit address for a specific chain ───────────────────────────────
  const getDepositAddress = useCallback(
    (chain: string): DepositAddress | undefined => {
      return depositAddresses.find((a) => a.chain === chain || a.chainName?.toLowerCase() === chain.toLowerCase());
    },
    [depositAddresses]
  );

  // ── Refresh deposit address for a single chain (always fresh) ─────────────
  const refreshDepositAddress = useCallback(async (chain: string): Promise<DepositAddress | null> => {
    try {
      const fresh = await fetchDepositAddress(chain, true);
      if (fresh) {
        setDepositAddresses((prev) => {
          const filtered = prev.filter((a) => a.chain !== chain);
          return [...filtered, fresh];
        });
      }
      return fresh;
    } catch (err: any) {
      console.warn(`[useOnchainData] refreshDepositAddress(${chain}):`, err);
      return null;
    }
  }, []);

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
