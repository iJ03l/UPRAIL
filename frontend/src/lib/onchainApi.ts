/**
 * Onchain API Client — Live NEAR blockchain data
 *
 * All data is fetched from the worker's /api/onchain/* endpoints,
 * which in turn pull live from the NEAR mainnet via QuikNode RPC.
 *
 * Nothing is hardcoded: chains, tokens, deposit addresses, and
 * transaction history all come from onchain state.
 */

const API_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  (typeof process !== 'undefined' && process.env?.API_URL) ||
  '';

function url(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface OnchainToken {
  id: string;             // defuse_asset_id, e.g. "nep141:usdc.token.near"
  symbol: string;
  name: string;
  iconUrl: string;
  decimals: number;
  nearContractId: string;
  chain: string;          // "near" | "eth" | "sol" | "btc" | ...
  chainId?: string;
  badge?: string;
  balance?: string;
}

export interface OnchainBalance {
  defuse_asset_id: string;
  symbol: string;
  amount: string;
  amountFormatted: string;
  decimals: number;
  nearContractId: string;
}

export interface OnchainBalancesResponse {
  nearAccount: string;
  balances: OnchainBalance[];
  source: 'onchain';
  fetchedAt: number;
}

export interface DepositAddress {
  chain: string;
  chainName: string;
  address: string;
  memo?: string;
  expiresAt?: number;
}

export interface DepositAddressResponse {
  address?: DepositAddress;
  addresses?: DepositAddress[];
  nearAccount: string;
  source: 'onchain';
  fetchedAt: number;
}

export interface OnchainTx {
  id: string;
  intent_type: string;
  defuse_asset_id_in?: string;
  defuse_asset_id_out?: string;
  amount_in?: string;
  amount_out?: string;
  receiver_id?: string;
  sender_id?: string;
  block_height: number;
  block_timestamp: number;
  status: 'success' | 'pending' | 'failed';
}

export interface OnchainHistoryResponse {
  transactions: OnchainTx[];
  nearAccount: string | null;
  source: 'onchain';
  fetchedAt?: number;
}

export interface TxChallengeResponse {
  challenge: string;
  expiresIn: number;
  message: string;
}

// ─── API calls ─────────────────────────────────────────────────────────────────

/**
 * Fetches all tokens supported by NEAR Intents from the onchain contract.
 * This is the live, authoritative token list.
 */
export async function fetchOnchainTokens(): Promise<OnchainToken[]> {
  const res = await fetch(url('/api/onchain/tokens'), {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to fetch onchain tokens: ${res.status}`);
  const data = await res.json() as { tokens: any[] };
  return (data.tokens || []).map((t: any) => ({
    id: t.id || t.defuse_asset_id || '',
    symbol: t.symbol || '',
    name: t.name || t.symbol || '',
    iconUrl: t.iconUrl || t.icon || '',
    decimals: Number(t.decimals ?? 18),
    nearContractId: t.nearContractId || '',
    chain: t.chain || 'near',
    chainId: t.chainId,
    badge: t.badge,
    balance: '0.00',
  }));
}

/**
 * Fetches the authenticated user's live intent account balances from onchain.
 * Scoped strictly to the calling user — never returns another user's data.
 */
export async function fetchOnchainBalances(): Promise<OnchainBalancesResponse | null> {
  const res = await fetch(url('/api/onchain/balances'), {
    credentials: 'include',
  });
  if (res.status === 400) return null; // No intent account yet
  if (!res.ok) throw new Error(`Failed to fetch onchain balances: ${res.status}`);
  return await res.json() as OnchainBalancesResponse;
}

/**
 * Fetches the deposit address for a specific chain for the authenticated user.
 * IMPORTANT: These addresses are ephemeral — always fetch fresh, never cache.
 */
export async function fetchDepositAddress(chain: string): Promise<DepositAddress | null> {
  const res = await fetch(url(`/api/onchain/deposit-address?chain=${encodeURIComponent(chain)}`), {
    credentials: 'include',
  });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch deposit address for ${chain}: ${res.status}`);
  const data = await res.json() as DepositAddressResponse;
  return data.address || null;
}

/**
 * Fetches deposit addresses for ALL chains for the authenticated user.
 * Returns a list sorted by chain name.
 */
export async function fetchAllDepositAddresses(): Promise<DepositAddress[]> {
  const res = await fetch(url('/api/onchain/deposit-address'), {
    credentials: 'include',
  });
  if (res.status === 400) return [];
  if (!res.ok) throw new Error(`Failed to fetch all deposit addresses: ${res.status}`);
  const data = await res.json() as DepositAddressResponse;
  return data.addresses || [];
}

/**
 * Fetches the authenticated user's onchain transaction history from the intents contract.
 */
export async function fetchOnchainHistory(limit = 50): Promise<OnchainHistoryResponse> {
  const res = await fetch(url(`/api/onchain/history?limit=${limit}`), {
    credentials: 'include',
  });
  if (!res.ok) return { transactions: [], nearAccount: null, source: 'onchain' };
  return await res.json() as OnchainHistoryResponse;
}

/**
 * Fetches the authenticated user's intent account info from onchain.
 */
export async function fetchIntentAccount(): Promise<{
  hasIntentAccount: boolean;
  nearAccount: string | null;
  xHandle: string;
}> {
  const res = await fetch(url('/api/onchain/account'), {
    credentials: 'include',
  });
  if (!res.ok) return { hasIntentAccount: false, nearAccount: null, xHandle: '' };
  return await res.json();
}

// ─── Passkey Transaction Authorization ────────────────────────────────────────

/**
 * Requests a fresh single-use challenge from the server for a passkey-authorized transaction.
 * Call this BEFORE prompting the user for their passkey.
 */
export async function requestTxChallenge(): Promise<TxChallengeResponse> {
  const res = await fetch(url('/api/auth-challenge'), {
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.error || 'Failed to get transaction challenge');
  }
  return await res.json() as TxChallengeResponse;
}
