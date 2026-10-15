/**
 * Destination networks offered when sending to an external wallet via the
 * NEAR Intents (1Click) rail.
 *
 * The list itself comes from the worker (`/api/claim/withdraw-chains`), which
 * reads 1Click's live catalogue — so it always includes what the solver
 * actually supports (Sui, Robinhood, new L2s, …) without a hardcoded copy to
 * drift. This module only holds the address-shape helpers used to pick a
 * sensible default and flag an obvious mismatch.
 */

export type WithdrawChainFamily = 'evm' | 'sol' | 'btc' | 'near';

export interface WithdrawChain {
  key: string;
  name: string;
  family: WithdrawChainFamily | null;
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

/** Human label for a detected family, used in mismatch hints. */
export function familyLabel(family: WithdrawChainFamily | null): string {
  switch (family) {
    case 'evm':
      return 'EVM';
    case 'sol':
      return 'Solana';
    case 'btc':
      return 'Bitcoin';
    case 'near':
      return 'NEAR';
    default:
      return '';
  }
}
