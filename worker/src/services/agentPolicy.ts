/**
 * Spend-policy evaluation for the agent payment rail.
 *
 * Kept separate from the middleware so the same rules can be re-checked at the
 * point funds actually move (defense in depth) and rendered in the UI.
 */

import type { AgentPrincipal } from '../types';
import { normalizeRecipient } from './agentKeys';

export interface AgentPaymentIntent {
  recipientHandle: string;
  asset: string;
  amount: number;
}

export interface AgentPolicyVerdict {
  allowed: boolean;
  /** Machine reason when not allowed (stable; safe to surface to the agent). */
  reason?: 'asset_not_allowed' | 'recipient_not_allowed' | 'per_tx_limit' | 'daily_limit';
  /** Human-readable detail for the UI/agent. */
  detail?: string;
}

/**
 * Evaluates the hard policy limits for an autonomous send.
 *
 * `spentToday` is the key's already-recorded spend for the current UTC day.
 * Caps are inclusive: amount === limit is allowed.
 */
export function evaluateAgentPolicy(
  principal: AgentPrincipal,
  intent: AgentPaymentIntent,
  spentToday: number
): AgentPolicyVerdict {
  if (principal.asset && !sameAsset(principal.asset, intent.asset)) {
    return {
      allowed: false,
      reason: 'asset_not_allowed',
      detail: `This key may only move ${principal.asset}.`,
    };
  }

  if (principal.allowlist && principal.allowlist.length > 0) {
    const recipient = normalizeRecipient(intent.recipientHandle);
    if (!principal.allowlist.includes(recipient)) {
      return {
        allowed: false,
        reason: 'recipient_not_allowed',
        detail: 'Recipient is not on this key\u2019s allowlist.',
      };
    }
  }

  if (principal.per_tx_limit !== null && intent.amount > principal.per_tx_limit + 1e-9) {
    return {
      allowed: false,
      reason: 'per_tx_limit',
      detail: `Amount exceeds the per-payment limit of ${principal.per_tx_limit}.`,
    };
  }

  if (
    principal.daily_limit !== null &&
    spentToday + intent.amount > principal.daily_limit + 1e-9
  ) {
    return {
      allowed: false,
      reason: 'daily_limit',
      detail: `Amount exceeds the remaining daily limit (${Math.max(
        0,
        principal.daily_limit - spentToday
      )} left of ${principal.daily_limit}).`,
    };
  }

  return { allowed: true };
}

/**
 * Loose asset equality across the identifiers a caller might send: defuse id
 * (`nep141:...`), contract id, or bare symbol. Mirrors assetsMatch but avoids a
 * heavy import cycle; unknown mismatches simply fall through to stricter denial.
 */
function sameAsset(a: string, b: string): boolean {
  const na = (a || '').trim().toLowerCase();
  const nb = (b || '').trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ca = na.includes(':') ? na.slice(na.indexOf(':') + 1) : na;
  const cb = nb.includes(':') ? nb.slice(nb.indexOf(':') + 1) : nb;
  return ca === cb;
}
