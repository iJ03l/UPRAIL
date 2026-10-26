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
  /**
   * USD of the holdings we could price. Not the complete portfolio whenever
   * `unpricedBalanceCount > 0` — the UI must say so rather than pass it off
   * as the total.
   */
  totalBalanceUsd: number | null;
  /** Holdings with no live price — how much of the portfolio is missing. */
  unpricedBalanceCount: number;
  nearAccount: string | null;
  hasIntentAccount: boolean;
  isLoadingBalances: boolean;
  /**
   * Set when the balance read FAILED, as opposed to succeeding with an empty
   * list. Consumers must not render a definitive `0.00` while this is set —
   * that is how a recipient who was just paid can be shown an empty wallet.
   */
  balancesError: string | null;
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

/** Assets that are a dollar by construction — the peg is a price. */
const STABLE_SYMBOLS = new Set([
  'USDC', 'USDT', 'DAI', 'FRAX', 'USDD', 'USDE', 'USDG', 'FDUSD',
]);

/**
 * USD value of a single holding, or `null` when nothing can price it.
 *
 * Resolution order matters:
 *  1. the price the API attached to the balance row — it travelled with the
 *     exact asset id, so it cannot be confused with a same-symbol asset on
 *     another chain;
 *  2. the registry joined on asset id / contract id;
 *  3. the registry joined on symbol (fallback only);
 *  4. the stablecoin peg.
 *
 * There is deliberately no `0` fallback: an unpriced launchpad meme must not
 * silently look worthless, and $0.00 must not look like a priced holding.
 */
export function balanceUsd(b: OnchainBalance, tokens: OnchainToken[] = []): number | null {
  const amount = parseFloat(b.amountFormatted || '0') || 0;
  if (!(amount > 0)) return 0;

  const direct = b.priceUsd;
  if (typeof direct === 'number' && isFinite(direct) && direct > 0) return amount * direct;

  const id = (b.defuse_asset_id || '').toLowerCase();
  const contract = (b.nearContractId || '').toLowerCase();
  for (const t of tokens) {
    const tid = (t.id || '').toLowerCase();
    const tc = (t.nearContractId || '').toLowerCase();
    const matched =
      (id && (tid === id || tc === id)) ||
      (contract && (tid === contract || tc === contract));
    if (matched && typeof t.priceUsd === 'number' && t.priceUsd > 0) return amount * t.priceUsd;
  }

  const sym = (b.symbol || '').trim().toUpperCase();
  if (STABLE_SYMBOLS.has(sym)) return amount;

  if (sym) {
    const bySymbol = tokens.find((t) => (t.symbol || '').trim().toUpperCase() === sym);
    if (bySymbol && typeof bySymbol.priceUsd === 'number' && bySymbol.priceUsd > 0) {
      return amount * bySymbol.priceUsd;
    }
  }
  return null;
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
let balancesErrorShared: string | null = null;

function publishBalancesError(message: string | null) {
  balancesErrorShared = message;
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

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

let inflightTokens: Promise<void> | null = null;
let inflightBalances: Promise<void> | null = null;
let inflightAddresses: Promise<void> | null = null;
let inflightHistory: Promise<void> | null = null;

export function useOnchainData(): UseOnchainDataResult {
  const [tokens, setTokens] = useState<OnchainToken[]>(globalCache.tokens);
  const [isLoadingTokens, setIsLoadingTokens] = useState(globalCache.tokens.length === 0);

  const [balances, setBalances] = useState<OnchainBalance[]>(globalCache.balances);
  const [nearAccount, setNearAccount] = useState<string | null>(globalCache.nearAccount);
  const [hasIntentAccount, setHasIntentAccount] = useState(globalCache.hasIntentAccount);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [balancesError, setBalancesError] = useState<string | null>(null);
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
      setBalancesError(balancesErrorShared);
    };
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  // ── Load supported tokens (no auth required) ──────────────────────────────
  const loadTokens = useCallback(async () => {
    if (inflightTokens) {
      await inflightTokens;
      setTokens(globalCache.tokens);
      setIsLoadingTokens(false);
      return;
    }
    const task = (async () => {
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
        inflightTokens = null;
        setIsLoadingTokens(false);
      }
    })();
    inflightTokens = task;
    await task;
  }, []);

  // ── Load user's intent account balances ───────────────────────────────────
  const loadBalances = useCallback(async () => {
    if (inflightBalances) {
      await inflightBalances;
      setBalances(globalCache.balances);
      setNearAccount(globalCache.nearAccount);
      setHasIntentAccount(globalCache.hasIntentAccount);
      setBalancesError(balancesErrorShared);
      setIsLoadingBalances(false);
      return;
    }
    const task = (async () => {
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
            balancesErrorShared = null;
            persistCache({ balances: response.balances });
          } else {
            // fetchOnchainBalances swallows a 400 into `null`. That is a failed
            // read, NOT an empty wallet — keeping the previous snapshot with no
            // marker is what made a just-paid recipient see a confident 0.00.
            publishBalancesError('Could not load your balance.');
          }
        } else {
          // The read SUCCEEDED and says there is no account yet — that is an
          // onboarding state, not a failure, so it must not look like an error.
          // A real failure throws above and lands in catch.
          publishBalancesError(account.provisionError || null);
        }
      } catch (err: any) {
        console.warn('[useOnchainData] balances:', err);
        publishBalancesError(err?.message || 'Could not load your balance.');
      } finally {
        inflightBalances = null;
        setIsLoadingBalances(false);
      }
    })();
    inflightBalances = task;
    await task;
  }, []);

  // ── Load all deposit addresses ─────────────────────────────────────────────
  const loadDepositAddresses = useCallback(async () => {
    if (inflightAddresses) {
      await inflightAddresses;
      setDepositAddresses(globalCache.depositAddresses);
      setIsLoadingAddresses(false);
      return;
    }
    const task = (async () => {
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
        inflightAddresses = null;
        setIsLoadingAddresses(false);
      }
    })();
    inflightAddresses = task;
    await task;
  }, []);

  // ── Load transaction history ───────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (inflightHistory) {
      await inflightHistory;
      setTransactions(globalCache.transactions);
      setIsLoadingHistory(false);
      return;
    }
    const task = (async () => {
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
        inflightHistory = null;
        setIsLoadingHistory(false);
      }
    })();
    inflightHistory = task;
    await task;
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

  // ── Keep prices and balances live while the tab is open ───────────────────
  // Balances MUST be repolled too, not just prices: a payment can be claimed
  // on-chain while this tab is open, and the old behaviour (prices only) left
  // the recipient staring at the pre-claim balance until a full reload.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadTokens();
        void loadBalances();
      }
    }, PRICE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadTokens, loadBalances]);

  // Returning to the tab is the moment a recipient most often wants to send,
  // and it is also when a claim may have landed while they were away.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadBalances();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadBalances]);

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
  // A subtotal of the holdings we can price is worth more than a dash, but it
  // must never masquerade as the whole portfolio: when nothing is priced the
  // total stays unknown (null -> "—"), and when only some holdings are priced
  // the count of missing ones is reported alongside so the figure is read as
  // a floor.
  const perBalanceUsd = balances.map((b) => balanceUsd(b, tokens));
  const unpricedBalanceCount = perBalanceUsd.filter((v) => v === null).length;
  const pricedTotal = perBalanceUsd.reduce<number>((acc, v) => (v === null ? acc : acc + v), 0);
  const hasPricedValue = perBalanceUsd.some((v) => v !== null && v > 0);
  const totalBalanceUsd = hasPricedValue || unpricedBalanceCount === 0 ? pricedTotal : null;

  return {
    tokens,
    isLoadingTokens,
    balances,
    totalBalanceUsd,
    unpricedBalanceCount,
    nearAccount,
    hasIntentAccount,
    isLoadingBalances,
    balancesError,
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
