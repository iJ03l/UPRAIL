/**
 * Spend-policy evaluation for AI-chat connections (the agent rail).
 *
 * Limits are denominated in USD so "25 per payment" means $25 whether the chat
 * sends USDC, NEAR or BTC — a raw-unit cap would let 25 BTC through a "25" limit.
 * An asset we cannot price is refused outright rather than slipping past the cap.
 */

import type { AgentPrincipal, Env } from '../types';
import * as nearRpc from './nearRpc';

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'FRAX', 'USDE', 'FDUSD', 'USDD', 'USDG', 'PYUSD']);

export interface AgentPolicyVerdict {
  allowed: boolean;
  reason?: 'recipient_not_handle' | 'unpriced_asset' | 'per_tx_limit' | 'daily_limit' | 'no_limits';
  detail?: string;
}

/** USD value of `amount` units of `asset`, or null when the asset has no live price. */
export async function agentUsdValue(env: Env, asset: string, amount: number): Promise<number | null> {
  if (!(amount > 0)) return null;
  try {
    const tokens = await nearRpc.getSupportedTokens(env);
    let token = nearRpc.resolveTokenForAsset(asset, tokens);
    if (!token) token = await nearRpc.resolveRheaToken(env, asset);
    const symbol = (token?.symbol || asset || '').toUpperCase();
    if (STABLES.has(symbol)) return amount;
    const price = token?.priceUsd;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) return amount * price;
  } catch (err) {
    console.warn('[agentPolicy] price lookup failed:', err);
  }
  return null;
}

/** True only for a syntactically valid X handle (with or without a leading @). */
export function isValidAgentHandle(value: string): boolean {
  return /^[a-zA-Z0-9_]{1,15}$/.test((value || '').trim().replace(/^@+/, ''));
}

/**
 * Static checks that do not need the day's running total. The daily cap is
 * enforced separately with an atomic reservation (see reserveAgentSpend) so two
 * concurrent chat requests can never jointly exceed it.
 */
export function evaluateAgentSpendPolicy(
  principal: AgentPrincipal,
  usd: number | null
): AgentPolicyVerdict {
  if (principal.per_tx_limit_usd === null || principal.daily_limit_usd === null) {
    return {
      allowed: false,
      reason: 'no_limits',
      detail: 'This connection has no spend limits. Create a new connection in UPRAIL → AI Chat.',
    };
  }
  if (usd === null) {
    return {
      allowed: false,
      reason: 'unpriced_asset',
      detail: 'This asset has no live USD price, so it cannot be checked against your limits. Use USDC, USDT or NEAR.',
    };
  }
  if (usd > principal.per_tx_limit_usd + 1e-9) {
    return {
      allowed: false,
      reason: 'per_tx_limit',
      detail: `This transfer is ~$${usd.toFixed(2)}, above your per-transaction limit of $${principal.per_tx_limit_usd}.`,
    };
  }
  if (usd > principal.daily_limit_usd + 1e-9) {
    return {
      allowed: false,
      reason: 'daily_limit',
      detail: `This transfer exceeds your daily limit of $${principal.daily_limit_usd}.`,
    };
  }
  return { allowed: true };
}

export function evaluateAgentPolicy(
  principal: AgentPrincipal,
  intent: { recipientHandle: string; usd: number | null }
): AgentPolicyVerdict {
  if (!isValidAgentHandle(intent.recipientHandle)) {
    return {
      allowed: false,
      reason: 'recipient_not_handle',
      detail:
        'AI chat payments go to X handles only (e.g. @alice). Use the withdrawal tool for a wallet address.',
    };
  }
  return evaluateAgentSpendPolicy(principal, intent.usd);
}
