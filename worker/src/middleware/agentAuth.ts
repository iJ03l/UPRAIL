/**
 * Agent credential middleware for UP (UPRAIL.app).
 *
 * Authenticates AI chat connections (Claude, ChatGPT, Cursor, etc.) using a
 * Passkey-issued Bearer key (`up_agent_...`). Resolves the owning user's
 * session and enforces USD spend limits (per-payment + daily) with atomic D1
 * reservations before any funds move.
 */

import { Context, MiddlewareHandler } from 'hono';
import type { AgentPrincipal, AppContext, Session } from '../types';
import {
  hashAgentKey,
  looksLikeAgentKey,
  getAgentSpendToday,
  reserveAgentSpend,
  releaseAgentSpend,
} from '../services/agentKeys';
import {
  agentUsdValue,
  evaluateAgentPolicy,
  evaluateAgentSpendPolicy,
} from '../services/agentPolicy';
import { SESSION_TTL_SECONDS } from './session';

const DEFAULT_PER_TX_USD = 25;
const DEFAULT_DAILY_USD = 100;

interface AgentKeyRow {
  id: string;
  agent_id: string;
  x_id: string;
  per_tx_limit: string | null;
  daily_limit: string | null;
  expires_at: number | null;
  revoked_at: number | null;
}

function jsonError(
  c: Context<AppContext>,
  status: 401 | 403,
  message: string,
  code: string
): Response {
  return c.json({ error: message, code }, status);
}

export interface AgentAuthOptions {
  allowQueryKey?: boolean;
}

export const requireAgent = (options: AgentAuthOptions = {}): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const header = (c.req.header('Authorization') || '').trim();
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(header);
    const queryKey = options.allowQueryKey
      ? (c.req.query('key') || '').trim() || (c.req.query('api_key') || '').trim()
      : '';
    const candidate =
      bearerMatch?.[1]?.trim() ||
      (looksLikeAgentKey(header) ? header : '') ||
      (c.req.header('X-Agent-Key') || '').trim() ||
      (c.req.header('X-API-Key') || '').trim() ||
      queryKey;
    const rawKey = candidate;
    if (!rawKey || !looksLikeAgentKey(rawKey)) {
      return jsonError(
        c,
        401,
        options.allowQueryKey
          ? 'Agent key required. Send "Authorization: Bearer up_agent_…" or append "?key=up_agent_…".'
          : 'Agent key required. Send "Authorization: Bearer up_agent_…".',
        'AGENT_KEY_REQUIRED'
      );
    }

    if (!c.env.DB) {
      return jsonError(c, 401, 'Agent authentication unavailable.', 'AGENT_KEY_REQUIRED');
    }

    const keyHash = await hashAgentKey(rawKey);
    let row: AgentKeyRow | null = null;
    try {
      row = await c.env.DB.prepare(
        `SELECT k.id, k.agent_id, k.x_id, k.per_tx_limit, k.daily_limit,
                k.expires_at, k.revoked_at
           FROM agent_keys k
          WHERE k.key_hash = ?`
      )
        .bind(keyHash)
        .first<AgentKeyRow>();
    } catch (err) {
      console.error('[agentAuth] key lookup failed:', err);
      return jsonError(c, 401, 'Agent authentication failed.', 'AGENT_KEY_REQUIRED');
    }

    if (!row) return jsonError(c, 401, 'Invalid agent key.', 'AGENT_KEY_INVALID');
    if (row.revoked_at) return jsonError(c, 403, 'This agent key has been revoked.', 'AGENT_KEY_REVOKED');
    if (row.expires_at && row.expires_at < Date.now()) {
      return jsonError(c, 403, 'This agent key has expired.', 'AGENT_KEY_EXPIRED');
    }

    const identity = await c.env.DB.prepare(
      'SELECT x_handle, x_name, near_account, is_activated, personal_invite_code FROM x_identities WHERE x_id = ?'
    )
      .bind(row.x_id)
      .first<{
        x_handle: string;
        x_name: string;
        near_account: string | null;
        is_activated: number | null;
        personal_invite_code: string | null;
      }>();

    if (!identity) {
      return jsonError(c, 403, 'The owner of this agent key no longer exists.', 'AGENT_OWNER_MISSING');
    }

    const now = Date.now();
    const session: Session = {
      session_id: `agent:${row.id}`,
      x_id: row.x_id,
      x_handle: identity.x_handle,
      x_name: identity.x_name,
      near_account: identity.near_account,
      is_activated: identity.is_activated == null ? undefined : Boolean(identity.is_activated),
      personal_invite_code: identity.personal_invite_code,
      created_at: now,
      expires_at: now + SESSION_TTL_SECONDS * 1000,
    };
    c.set('session', session);

    const perTx = row.per_tx_limit == null ? DEFAULT_PER_TX_USD : parseFloat(row.per_tx_limit);
    const daily = row.daily_limit == null ? DEFAULT_DAILY_USD : parseFloat(row.daily_limit);

    const principal: AgentPrincipal = {
      key_id: row.id,
      agent_id: row.agent_id,
      x_id: row.x_id,
      per_tx_limit_usd: Number.isFinite(perTx) && perTx > 0 ? perTx : DEFAULT_PER_TX_USD,
      daily_limit_usd: Number.isFinite(daily) && daily > 0 ? daily : DEFAULT_DAILY_USD,
    };
    c.set('agent', principal);

    // Fire-and-forget last-used stamp.
    c.executionCtx?.waitUntil?.(
      c.env.DB.prepare('UPDATE agent_keys SET last_used_at = ? WHERE id = ?')
        .bind(now, row.id)
        .run()
        .catch((err: unknown) => console.warn('[agentAuth] last_used update failed:', err))
    );

    const method = c.req.method.toUpperCase();
    const contentType = c.req.header('Content-Type') || '';
    if (method !== 'GET' && method !== 'HEAD' && contentType.includes('application/json')) {
      try {
        const body = await c.req.json();
        c.set('parsedBody' as any, body);
      } catch {
        // leave parsedBody unset
      }
    }

    return await next();
  };
};

export interface AgentIntent {
  recipientHandle: string;
  asset: string;
  amount: number;
  memo?: string;
}

export interface AgentWithdrawalIntent {
  asset: string;
  amount: number;
  destinationAddress: string;
  destinationChain?: string;
}

export type AgentSendAuthorization =
  | { allowed: true; reservedUsd: number; release: () => Promise<void> }
  | { allowed: false; response: Response };

async function reserveAgentBudget(
  c: Context<AppContext>,
  principal: AgentPrincipal,
  usd: number
): Promise<AgentSendAuthorization> {
  const dailyLimit = principal.daily_limit_usd;
  if (dailyLimit === null) {
    return {
      allowed: false,
      response: c.json(
        {
          error: 'This connection has no spend limits. Create a new connection in UPRAIL → AI Chat.',
          code: 'AGENT_POLICY_DENIED',
          reason: 'no_limits',
        },
        403
      ),
    };
  }

  const reserved = await reserveAgentSpend(c.env, principal.key_id, usd, dailyLimit);
  if (!reserved) {
    const spentToday = await getAgentSpendToday(c.env, principal.key_id);
    const remaining = Math.max(0, dailyLimit - spentToday);
    return {
      allowed: false,
      response: c.json(
        {
          error: `This transfer (~$${usd.toFixed(2)}) exceeds your remaining daily limit ($${remaining.toFixed(2)} left of $${dailyLimit}).`,
          code: 'AGENT_POLICY_DENIED',
          reason: 'daily_limit',
        },
        403
      ),
    };
  }

  return {
    allowed: true,
    reservedUsd: usd,
    release: () => releaseAgentSpend(c.env, principal.key_id, usd),
  };
}

/**
 * Enforces the key's USD spend policy and atomically reserves the USD amount
 * against today's budget before any funds move. Shared by REST `/api/agent/pay`
 * and MCP `send_payment` / `pay_handle`.
 */
export async function authorizeAgentSend(
  c: Context<AppContext>,
  principal: AgentPrincipal,
  intent: AgentIntent
): Promise<AgentSendAuthorization> {
  const usd = await agentUsdValue(c.env, intent.asset, intent.amount);
  const verdict = evaluateAgentPolicy(principal, {
    recipientHandle: intent.recipientHandle,
    usd,
  });

  if (!verdict.allowed || usd === null) {
    return {
      allowed: false,
      response: c.json(
        {
          error: verdict.detail || 'Payment denied by agent spend limit.',
          code: 'AGENT_POLICY_DENIED',
          reason: verdict.reason,
        },
        403
      ),
    };
  }

  return reserveAgentBudget(c, principal, usd);
}

/**
 * Enforces the same USD spend caps for withdrawals to an external wallet.
 * Withdrawals are bearer-authorized like payments, but the destination is an
 * address rather than an X handle.
 */
export async function authorizeAgentWithdrawal(
  c: Context<AppContext>,
  principal: AgentPrincipal,
  intent: AgentWithdrawalIntent
): Promise<AgentSendAuthorization> {
  const usd = await agentUsdValue(c.env, intent.asset, intent.amount);
  const verdict = evaluateAgentSpendPolicy(principal, usd);

  if (!verdict.allowed || usd === null) {
    return {
      allowed: false,
      response: c.json(
        {
          error: verdict.detail || 'Withdrawal denied by agent spend limit.',
          code: 'AGENT_POLICY_DENIED',
          reason: verdict.reason,
        },
        403
      ),
    };
  }

  return reserveAgentBudget(c, principal, usd);
}
