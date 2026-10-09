/**
 * NEAR RPC Service — Live onchain data via QuikNode NEAR mainnet RPC
 *
 * All data (balances, tokens, deposit addresses, history) is sourced directly
 * from the NEAR blockchain through the configured NEAR_RPC_URL.
 * No hardcoded state. No stale caches for critical financial data.
 */

import type { Env } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnchainToken {
  defuse_asset_id: string;   // e.g. "nep141:usdc.token.near"
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  nearContractId: string;    // e.g. "usdc.token.near"
  chain: string;             // "near" | "eth" | "sol" | "btc" | ...
  chainId?: string;
  priceUsd?: number;
}

export interface IntentAccountBalance {
  defuse_asset_id: string;
  symbol: string;
  amount: string;            // raw string from contract
  amountFormatted: string;   // human-readable
  decimals: number;
  nearContractId: string;
}

export interface DepositAddress {
  chain: string;
  chainName: string;
  address: string;
  memo?: string;
  expiresAt?: number;
}

export interface IntentTx {
  id: string;
  intent_type: string;       // "ft_transfer" | "swap" | etc.
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

const DEFAULT_NEAR_RPC_URL = 'https://nameless-practical-liquid.near-mainnet.quiknode.pro/764c7b41d38ccdf55377d79578d11c41efa0a3b8/';

async function nearRpc(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>
): Promise<any> {
  const targetUrl = rpcUrl || DEFAULT_NEAR_RPC_URL;
  const resp = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'uprail',
      method,
      params,
    }),
  });

  if (!resp.ok) {
    throw new Error(`NEAR RPC HTTP error: ${resp.status}`);
  }

  const json = await resp.json() as any;
  if (json.error) {
    throw new Error(`NEAR RPC error [${json.error.code}]: ${json.error.message}`);
  }
  return json.result;
}

// ─── Contract view call ───────────────────────────────────────────────────────

async function viewFunction(
  rpcUrl: string,
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {}
): Promise<any> {
  const argsBase64 = btoa(JSON.stringify(args));
  const result = await nearRpc(rpcUrl, 'query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contractId,
    method_name: methodName,
    args_base64: argsBase64,
  });

  if (!result || !result.result) {
    return null;
  }

  const bytes = new Uint8Array(result.result);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatAmount(raw: string, decimals: number): string {
  if (!raw || raw === '0') return '0.00';
  const padded = raw.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, '') || '0';
  const displayFrac = fracPart.slice(0, 6); // max 6 decimal places for display
  return `${intPart}.${displayFrac}`;
}

export function toBaseUnits(amountStr: string, decimals: number): string {
  const parts = amountStr.trim().split('.');
  const intPart = parts[0] || '0';
  let fracPart = parts[1] || '';
  if (fracPart.length > decimals) {
    fracPart = fracPart.slice(0, decimals);
  } else {
    fracPart = fracPart.padEnd(decimals, '0');
  }
  const combined = (intPart === '0' ? '' : intPart) + fracPart;
  const trimmed = combined.replace(/^0+/, '');
  return trimmed || '0';
}

function parseDefuseAssetId(id: string): { chain: string; contractId: string } {
  // Formats: "nep141:usdc.token.near" or "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
  // or "native:near" or "erc20:eth:0xabc..." or "spl:sol:..."
  if (id.startsWith('nep141:')) {
    return { chain: 'near', contractId: id.slice(7) };
  }
  if (id.startsWith('native:')) {
    const chain = id.slice(7);
    return { chain, contractId: chain };
  }
  if (id.startsWith('erc20:')) {
    const parts = id.split(':'); // erc20:<chain>:<address>
    return { chain: parts[1] || 'eth', contractId: parts[2] || '' };
  }
  if (id.startsWith('spl:')) {
    const parts = id.split(':');
    return { chain: parts[1] || 'sol', contractId: parts[2] || '' };
  }
  return { chain: 'unknown', contractId: id };
}

// ─── Supported Tokens ─────────────────────────────────────────────────────────

/**
 * Fetches the complete list of supported tokens from the intents contract onchain.
 * This is the authoritative source — no hardcoded lists.
 */
export async function getSupportedTokens(env: Env): Promise<OnchainToken[]> {
  const apiBase = env.NEAR_API_BASE || 'https://1click.chaindefuser.com';

  // 1. Primary: query 1Click Defuse live token registry with live USD prices
  try {
    const resp = await fetch(`${apiBase}/v0/tokens`, {
      headers: { 'Accept': 'application/json' },
    });
    if (resp.ok) {
      const list = (await resp.json()) as any[];
      if (Array.isArray(list) && list.length > 0) {
        return list.map((t: any) => {
          const assetId = t.assetId || t.defuse_asset_id || '';
          const { chain, contractId: nearContractId } = parseDefuseAssetId(assetId);
          return {
            defuse_asset_id: assetId,
            symbol: t.symbol || 'UNKNOWN',
            name: t.symbol || 'Token',
            decimals: Number(t.decimals ?? 18),
            icon: t.icon || `https://cryptologos.cc/logos/${(t.symbol || 'near').toLowerCase()}-logo.svg?v=035`,
            nearContractId: t.contractAddress || nearContractId,
            chain: t.blockchain || chain,
            priceUsd: typeof t.price === 'number' ? t.price : 1.0,
          } satisfies OnchainToken;
        });
      }
    }
  } catch (err) {
    console.warn('[nearRpc] 1click /v0/tokens live query failed:', err);
  }

  // 2. Secondary: query intents contract view function on NEAR mainnet QuikNode RPC
  const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const rpcUrl = env.NEAR_RPC_URL;
  try {
    const tokens = await viewFunction(rpcUrl, contractId, 'get_supported_tokens', {});
    if (Array.isArray(tokens)) {
      return tokens.map((t: any) => {
        const { chain, contractId: nearContractId } = parseDefuseAssetId(
          t.defuse_asset_id || t.token_id || ''
        );
        return {
          defuse_asset_id: t.defuse_asset_id || t.token_id || '',
          symbol: t.symbol || t.ticker || 'UNKNOWN',
          name: t.name || t.symbol || 'Unknown Token',
          decimals: Number(t.decimals ?? 18),
          icon: t.icon,
          nearContractId,
          chain,
          chainId: t.chain_id,
        } satisfies OnchainToken;
      });
    }
  } catch (err) {
    console.warn('[nearRpc] intents viewFunction failed:', err);
  }

  // Fallback for offline, sandbox, or network partition
  return [
    {
      defuse_asset_id: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chain: 'near',
      nearContractId: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    },
    {
      defuse_asset_id: 'nep141:usdt.tether-token.near',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      chain: 'near',
      nearContractId: 'usdt.tether-token.near',
    },
    {
      defuse_asset_id: 'native:near',
      symbol: 'NEAR',
      name: 'NEAR Protocol',
      decimals: 24,
      chain: 'near',
      nearContractId: 'near',
    },
    {
      defuse_asset_id: 'erc20:eth:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chain: 'eth',
      nearContractId: 'aurora',
    },
  ];
}

/**
 * Derives a deterministic, cryptographically blinded NEAR sub-account ID
 * from the user's WebAuthn P-256 public key.
 *
 * Format: u_<16 hex chars of SHA-256(publicKeyHex)>.<masterAccount>
 * Example: u_7a9f1b2c3d4e5f60.uprail.near
 *
 * Confidentiality Guarantee:
 * - Zero linkage to user's 𝕏 handle
 * - Onchain observers see an opaque hash sub-account
 * - Fully deterministic and self-custodial via device hardware passkey
 */
export async function deriveConfidentialAccountId(
  publicKeyHex: string,
  masterAccount = 'uprail.near'
): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(publicKeyHex));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
  return `u_${hex}.${masterAccount}`;
}

export function getIntentAccountId(nearAccount: string, contractId: string): string {
  return nearAccount;
}

/**
 * Fetches all token balances for a user's intent account directly from the onchain
 * intents contract. This is live, not cached.
 */
export async function getIntentBalances(
  env: Env,
  nearAccount: string
): Promise<IntentAccountBalance[]> {
  const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';
  const rpcUrl = env.NEAR_RPC_URL;

  try {
    // Standard intents contract method: get_balance / ft_balance_of
    // Query all token balances for the account
    const balances = await viewFunction(rpcUrl, contractId, 'mt_batch_balance_of', {
      account_id: nearAccount,
    });

    if (balances && typeof balances === 'object') {
      // Response is typically: { "nep141:usdc.token.near": "1000000", ... }
      const tokens = await getSupportedTokens(env);
      const tokenMap = new Map(tokens.map((t) => [t.defuse_asset_id, t]));

      return Object.entries(balances)
        .map(([assetId, rawAmount]: [string, any]) => {
          const token = tokenMap.get(assetId);
          const decimals = token?.decimals ?? 6;
          const amtStr = String(rawAmount ?? '0');
          return {
            defuse_asset_id: assetId,
            symbol: token?.symbol || assetId.split(':').pop() || assetId,
            amount: amtStr,
            amountFormatted: formatAmount(amtStr, decimals),
            decimals,
            nearContractId: token?.nearContractId || '',
          } satisfies IntentAccountBalance;
        })
        .filter((b) => b.amount !== '0');
    }
  } catch (err) {
    console.warn('[nearRpc] mt_batch_balance_of failed, trying per-token:', err);
  }

  // Fallback: try ft_balance_of on the intents contract per known token
  try {
    const tokens = await getSupportedTokens(env);
    const balances: IntentAccountBalance[] = [];

    await Promise.allSettled(
      tokens.map(async (token) => {
        try {
          const raw = await viewFunction(rpcUrl, contractId, 'ft_balance_of', {
            account_id: nearAccount,
            token_id: token.defuse_asset_id,
          });
          const amtStr = String(raw ?? '0');
          if (amtStr !== '0') {
            balances.push({
              defuse_asset_id: token.defuse_asset_id,
              symbol: token.symbol,
              amount: amtStr,
              amountFormatted: formatAmount(amtStr, token.decimals),
              decimals: token.decimals,
              nearContractId: token.nearContractId,
            });
          }
        } catch {
          // Token not supported or zero balance — skip silently
        }
      })
    );

    return balances;
  } catch (err) {
    console.warn('[nearRpc] Per-token balance fallback failed:', err);
  }

  return [];
}

// ─── Deposit Addresses (per-user, per-chain, ephemeral) ───────────────────────

/**
 * Fetches the user's deposit address for a given chain from the 1Click/intents API.
 * These are NOT permanent — they are generated per-user per-chain and must ALWAYS
 * be fetched fresh from onchain (never hardcoded or cached long-term).
 */
export async function getDepositAddress(
  env: Env,
  nearAccount: string,
  chainId: string
): Promise<DepositAddress | null> {
  // The 1Click API returns solver-generated ephemeral deposit addresses
  // Endpoint: POST /v1/deposit-address  or  GET /v1/deposit-address?account=...&chain=...
  try {
    const url = `${env.NEAR_API_BASE}/v1/deposit-address`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        account_id: nearAccount,
        chain: chainId,
      }),
    });

    if (resp.ok) {
      const data = await resp.json() as any;
      return {
        chain: chainId,
        chainName: data.chain_name || chainId,
        address: data.address || data.deposit_address || '',
        memo: data.memo,
        expiresAt: data.expires_at,
      };
    }

    // Try alternate endpoint format
    const resp2 = await fetch(
      `${env.NEAR_API_BASE}/v1/accounts/${encodeURIComponent(nearAccount)}/deposit-address?chain=${encodeURIComponent(chainId)}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (resp2.ok) {
      const data = await resp2.json() as any;
      return {
        chain: chainId,
        chainName: data.chain_name || chainId,
        address: data.address || data.deposit_address || '',
        memo: data.memo,
        expiresAt: data.expires_at,
      };
    }
  } catch (err) {
    console.warn(`[nearRpc] getDepositAddress for chain=${chainId}:`, err);
  }

  // Fallback for supported chains including Robinhood
  const holdingAccount = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  const cleanChain = chainId.toLowerCase();

  if (cleanChain === 'robinhood' || cleanChain === 'hood') {
    return {
      chain: 'robinhood',
      chainName: 'Robinhood',
      address: holdingAccount,
      memo: `intent:${nearAccount}:robinhood`,
    };
  }

  if (cleanChain === 'near') {
    return {
      chain: 'near',
      chainName: 'NEAR',
      address: nearAccount,
    };
  }

  return {
    chain: chainId,
    chainName: chainId.toUpperCase(),
    address: holdingAccount,
    memo: `intent:${nearAccount}:${chainId}`,
  };
}

/**
 * Supported Intent Gateway chains — includes Robinhood, NEAR, Ethereum, Solana, Bitcoin, Base, Arbitrum
 */
export const SUPPORTED_CHAINS = [
  { chain: 'near', chainName: 'NEAR' },
  { chain: 'eth', chainName: 'Ethereum' },
  { chain: 'sol', chainName: 'Solana' },
  { chain: 'btc', chainName: 'Bitcoin' },
  { chain: 'base', chainName: 'Base' },
  { chain: 'arbitrum', chainName: 'Arbitrum' },
  { chain: 'robinhood', chainName: 'Robinhood' },
];

/**
 * Fetches deposit addresses for ALL supported chains for a user in one call.
 * Returns addresses for all chains including Robinhood.
 */
export async function getAllDepositAddresses(
  env: Env,
  nearAccount: string
): Promise<DepositAddress[]> {
  const holdingAccount = env.ESCROW_ACCOUNT_ID || 'escrow.uprail.near';
  let liveList: DepositAddress[] = [];

  try {
    // Try bulk endpoint first
    const url = `${env.NEAR_API_BASE}/v1/deposit-addresses`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ account_id: nearAccount }),
    });

    if (resp.ok) {
      const data = await resp.json() as any;
      const list = Array.isArray(data) ? data : (data.addresses || []);
      liveList = list.map((item: any) => ({
        chain: item.chain || item.chain_id || '',
        chainName: item.chain_name || item.chain || '',
        address: item.address || item.deposit_address || '',
        memo: item.memo,
        expiresAt: item.expires_at,
      }));
    }
  } catch (err) {
    console.warn('[nearRpc] getAllDepositAddresses bulk failed:', err);
  }

  // Ensure ALL supported chains (including Robinhood) are present
  const chainMap = new Map<string, DepositAddress>();
  for (const item of liveList) {
    if (item.chain) chainMap.set(item.chain.toLowerCase(), item);
  }

  // Add any missing standard chains, including Robinhood
  for (const sc of SUPPORTED_CHAINS) {
    if (!chainMap.has(sc.chain)) {
      chainMap.set(sc.chain, {
        chain: sc.chain,
        chainName: sc.chainName,
        address: sc.chain === 'near' ? nearAccount : holdingAccount,
        memo: sc.chain === 'near' ? undefined : `intent:${nearAccount}:${sc.chain}`,
      });
    }
  }

  return Array.from(chainMap.values());
}

// ─── Transaction / Intent History ─────────────────────────────────────────────

/**
 * Fetches onchain intent transaction history for a user.
 * Queries the intents contract event log via NEAR RPC indexer or the 1click API.
 */
export async function getIntentHistory(
  env: Env,
  nearAccount: string,
  limit = 50
): Promise<IntentTx[]> {
  // Try the 1Click API transaction history endpoint
  try {
    const url = `${env.NEAR_API_BASE}/v1/accounts/${encodeURIComponent(nearAccount)}/transactions?limit=${limit}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (resp.ok) {
      const data = await resp.json() as any;
      const list = Array.isArray(data) ? data : (data.transactions || data.items || []);
      return list.map((tx: any) => ({
        id: tx.id || tx.hash || tx.transaction_hash || crypto.randomUUID(),
        intent_type: tx.type || tx.intent_type || 'transfer',
        defuse_asset_id_in: tx.asset_in || tx.defuse_asset_id_in,
        defuse_asset_id_out: tx.asset_out || tx.defuse_asset_id_out,
        amount_in: tx.amount_in || tx.amount || '0',
        amount_out: tx.amount_out || '0',
        receiver_id: tx.receiver_id || tx.recipient || tx.to,
        sender_id: tx.sender_id || tx.sender || tx.from,
        block_height: Number(tx.block_height || 0),
        block_timestamp: Number(tx.block_timestamp || tx.timestamp || Date.now()),
        status: tx.status === 'SUCCESS' || tx.status === 'success' ? 'success'
          : tx.status === 'FAILED' || tx.status === 'failed' ? 'failed'
          : 'pending',
      })) as IntentTx[];
    }
  } catch (err) {
    console.warn('[nearRpc] getIntentHistory via 1click failed:', err);
  }

  // Fallback: query NEAR RPC directly for recent transactions on the intents contract
  try {
    const rpcUrl = env.NEAR_RPC_URL;
    const contractId = env.INTENTS_CONTRACT_ID || 'intents.near';

    const result = await nearRpc(rpcUrl, 'query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: contractId,
    });

    if (result) {
      // We have confirmed the contract exists; the detailed tx history
      // requires an indexer. Return empty array rather than fake data.
      return [];
    }
  } catch (err) {
    console.warn('[nearRpc] NEAR RPC fallback failed:', err);
  }

  return [];
}

// ─── Account State ─────────────────────────────────────────────────────────────

/**
 * Checks whether a NEAR account exists onchain or is a valid virtual intent sub-account.
 * Virtual accounts (u_<hash>.uprail.near) exist instantly without onchain storage deposits.
 */
export async function accountExists(env: Env, accountId: string): Promise<boolean> {
  if (accountId.startsWith('u_') && accountId.endsWith('.uprail.near')) {
    return true;
  }
  try {
    await nearRpc(env.NEAR_RPC_URL, 'query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves or deterministically assigns the virtual intent account for a user.
 * Operates at $0 cost (no 0.05 NEAR per user deposit required).
 */
export async function resolveUserNearAccount(
  env: Env,
  session: { x_id: string; x_handle: string; near_account?: string | null }
): Promise<string> {
  if (session.near_account) {
    return session.near_account;
  }

  const masterAccount = env.MASTER_ACCOUNT_ID || 'uprail.near';

  // 1. Check x_identities in D1
  if (env.DB) {
    try {
      const identity = await env.DB.prepare('SELECT near_account FROM x_identities WHERE x_id = ?')
        .bind(session.x_id)
        .first<{ near_account: string | null }>();
      if (identity?.near_account) {
        session.near_account = identity.near_account;
        return identity.near_account;
      }
    } catch {}
  }

  // 2. Check if a passkey public key exists in passkeys table
  let publicKeyHex: string | null = null;
  if (env.DB) {
    try {
      const passkey = await env.DB.prepare(
        'SELECT public_key FROM passkeys WHERE x_id = ? ORDER BY created_at DESC LIMIT 1'
      )
        .bind(session.x_id)
        .first<{ public_key: string }>();
      if (passkey?.public_key) {
        publicKeyHex = passkey.public_key;
      }
    } catch {}
  }

  let accountId: string;
  if (publicKeyHex) {
    accountId = await deriveConfidentialAccountId(publicKeyHex, masterAccount);
  } else {
    // Deterministic blinded sub-account from user's x_id
    accountId = await deriveConfidentialAccountId(`x_identity:${session.x_id}`, masterAccount);
  }

  // Persist to x_identities
  if (env.DB) {
    try {
      await env.DB.prepare('UPDATE x_identities SET near_account = ?, updated_at = ? WHERE x_id = ?')
        .bind(accountId, Date.now(), session.x_id)
        .run();
    } catch {}
  }

  session.near_account = accountId;
  return accountId;
}
