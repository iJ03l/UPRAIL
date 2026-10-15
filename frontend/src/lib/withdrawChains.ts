/**
 * Destination networks offered when sending to an external wallet via the
 * NEAR Intents (1Click) rail.
 *
 * The worker owns the actual asset ids and is the authority: it rejects any
 * chain the chosen token cannot settle to. This module only drives the picker
 * and keeps the choice sensible for the address the user typed — an EVM
 * address is valid on every EVM chain, so without an explicit selection the
 * app has no way to know which one was meant.
 */

export type WithdrawChainFamily = 'evm' | 'sol' | 'btc' | 'near';

export interface WithdrawChain {
  key: string;
  name: string;
  family: WithdrawChainFamily;
}

const ALL_CHAINS: WithdrawChain[] = [
  { key: 'base', name: 'Base', family: 'evm' },
  { key: 'eth', name: 'Ethereum', family: 'evm' },
  { key: 'arbitrum', name: 'Arbitrum', family: 'evm' },
  { key: 'op', name: 'Optimism', family: 'evm' },
  { key: 'pol', name: 'Polygon', family: 'evm' },
  { key: 'avax', name: 'Avalanche', family: 'evm' },
  { key: 'sol', name: 'Solana', family: 'sol' },
  { key: 'btc', name: 'Bitcoin', family: 'btc' },
  { key: 'near', name: 'NEAR', family: 'near' },
];

/**
 * Networks each spendable symbol can settle to. Mirrors the worker's
 * DESTINATION_ASSETS map; anything absent is a NEAR-only (native) asset.
 */
const CHAINS_BY_SYMBOL: Record<string, string[]> = {
  USDC: ['base', 'eth', 'arbitrum', 'op', 'pol', 'avax', 'sol', 'near'],
  USDT: ['eth', 'sol', 'near'],
  NEAR: ['near'],
  ETH: ['eth', 'base', 'arbitrum'],
  SOL: ['sol'],
  BTC: ['btc'],
};

/** Cross-chain destinations for a token symbol (empty = NEAR-only asset). */
export function withdrawChainsForSymbol(symbol: string): WithdrawChain[] {
  const keys = CHAINS_BY_SYMBOL[(symbol || '').toUpperCase()];
  if (!keys) return [];
  return ALL_CHAINS.filter((chain) => keys.includes(chain.key));
}

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const BTC_RE = /^(?:bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)*$/;

/** Address family, or null when the input is empty/not yet a known shape. */
export function addressFamily(address: string): WithdrawChainFamily | null {
  const a = (address || '').trim();
  if (!a) return null;
  if (EVM_RE.test(a)) return 'evm';
  if (BTC_RE.test(a)) return 'btc';
  if (!a.includes('.') && SOL_RE.test(a)) return 'sol';
  if (a.length <= 64 && NEAR_RE.test(a)) return 'near';
  return null;
}

/** Narrow the options to the family the address actually belongs to. */
export function chainsForAddress(chains: WithdrawChain[], address: string): WithdrawChain[] {
  const family = addressFamily(address);
  if (!family) return chains;
  const filtered = chains.filter((chain) => chain.family === family);
  return filtered.length > 0 ? filtered : chains;
}
