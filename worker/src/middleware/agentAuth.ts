/**
 * Agent credential middleware for UP (UPRAIL.app).
 *
 * Replaces the session+passkey pair for programmatic callers. A valid agent key
 * resolves to its owning user's session (so the exact same send pipeline runs)
 * and to a spend policy that is enforced before any funds move:
 *
 *  - mode 'always_ask': every payment queues a PENDING approval. The agent
 *    retries with `X-Agent-Approval: <id>` once the user approves on device.
 *  - mode 'autonomous': payments execute immediately when within policy, and
 *    are denied (403) when outside it.
 */

import { Context, MiddlewareHandler } from 'hono';
import type { AgentPrincipal, AppContext, Session } from '../types';
import {
  hashAgentKey,
  looksLikeAgentKey,
  parseAllowlist,
  getAgentSpendToday,
} from '../services/agentKeys';
import { evaluateAgentPolicy } from '../services/agentPolicy';
import { SESSION_TTL_SECONDS } from './session';

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

interface AgentKeyRow {
  id: string;
  agent_id: string;
  x_id: string;
  asset: string | null;
  per_tx_limit: string | null;
  daily_limit: string | null;
  allowlist: string | null;
  expires_at: number | null;
  revoked_at: number | null;
  mode: string;
}

function jsonError(
  c: Context<AppContext>,
  status: 401 | 403,
  message: string,
  code: string
): Response {
  return c.json({ error: message, code }, status);
}

export const requireAgent = (): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const header = c.req.header('Authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const rawKey = match?.[1]?.trim();
    if (!rawKey || !looksLikeAgentKey(rawKey)) {
      return jsonError(c, 401, 'Agent key required. Send "Authorization: Bearer up_agent_…".', 'AGENT_KEY_REQUIRED');
    }

    if (!c.env.DB) {
      return jsonError(c, 401, 'Agent authentication unavailable.', 'AGENT_KEY_REQUIRED');
    }

    const keyHash = await hashAgentKey(rawKey);
    let row: AgentKeyRow | null = null;
    try {
      row = await c.env.DB.prepare(
        `SELECT k.id, k.agent_id, k.x_id, k.asset, k.per_tx_limit, k.daily_limit,
                k.allowlist, k.expires_at, k.revoked_at, a.mode
           FROM agent_keys k
           JOIN agents a ON a.id = k.agent_id
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

    // Resolve the owning identity so we can act as that user.
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

    const mode: AgentPrincipal['mode'] = row.mode === 'autonomous' ? 'autonomous' : 'always_ask';
    const principal: AgentPrincipal = {
      key_id: row.id,
      agent_id: row.agent_id,
      x_id: row.x_id,
      mode,
      asset: row.asset,
      per_tx_limit: row.per_tx_limit == null ? null : parseFloat(row.per_tx_limit),
      daily_limit: row.daily_limit == null ? null : parseFloat(row.daily_limit),
      allowlist: parseAllowlist(row.allowlist),
    };
    c.set('agent', principal);

    // Fire-and-forget last-used stamp (never blocks or fails the request).
    c.executionCtx?.waitUntil?.(
      c.env.DB.prepare('UPDATE agent_keys SET last_used_at = ? WHERE id = ?')
        .bind(now, row.id)
        .run()
        .catch((err: unknown) => console.warn('[agentAuth] last_used update failed:', err))
    );

    // Parse+cache the body for calls that carry a payment intent. GET endpoints
    // (balance, history) have no body and skip policy gating entirely.
    const method = c.req.method.toUpperCase();
    const contentType = c.req.header('Content-Type') || '';
    let body: any = null;
    if (method !== 'GET' && method !== 'HEAD' && contentType.includes('application/json')) {
      try {
        body = await c.req.json();
        c.set('parsedBody' as any, body);
      } catch {
        body = null;
      }
    }

    const isPaymentIntent =
      body && typeof body.recipientHandle === 'string' && body.amount !== undefined;
    if (!isPaymentIntent) {
      return await next();
    }

    const amount = parseFloat(String(body.amount)) || 0;
    const intent = {
      recipientHandle: String(body.recipientHandle),
      asset: String(body.asset || ''),
      amount,
    };

    if (mode === 'always_ask') {
      const approvalId = (c.req.header('X-Agent-Approval') || '').trim();
      if (approvalId) {
        const approval = await c.env.DB.prepare(
          `SELECT id, payload FROM agent_approvals
            WHERE id = ? AND x_id = ? AND agent_key_id = ? AND status = 'APPROVED' AND expires_at > ?`
        )
          .bind(approvalId, row.x_id, row.id, now)
          .first<{ id: string; payload: string }>();

        if (approval && approvalMatches(approval.payload, intent)) {
          await c.env.DB.prepare(
            "UPDATE agent_approvals SET status = 'CONSUMED', decided_at = ? WHERE id = ? AND status = 'APPROVED'"
          )
            .bind(now, approvalId)
            .run();
          return await next();
        }
      }

      // No matching approval: queue one for the user to decide on device.
      const id = crypto.randomUUID();
      try {
        await c.env.DB.prepare(
          `INSERT INTO agent_approvals (id, x_id, agent_key_id, payload, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`
        )
          .bind(
            id,
            row.x_id,
            row.id,
            JSON.stringify({
              recipientHandle: intent.recipientHandle,
              asset: intent.asset,
              amount: intent.amount,
              memo: typeof body.memo === 'string' ? body.memo : undefined,
            }),
            now,
            now + APPROVAL_TTL_MS
          )
          .run();
      } catch (err) {
        console.error('[agentAuth] could not queue approval:', err);
        return jsonError(c, 403, 'Could not queue an approval for this payment.', 'AGENT_APPROVAL_FAILED');
      }

      return c.json(
        {
          status: 'PENDING_APPROVAL',
          approvalId: id,
          code: 'AGENT_APPROVAL_REQUIRED',
          detail: 'This agent is in Always-Ask mode. Approve on device, then retry with the X-Agent-Approval header.',
        },
        202
      );
    }

    // Autonomous: enforce the hard policy now.
    const spentToday = await getAgentSpendToday(c.env, row.id);
    const verdict = evaluateAgentPolicy(principal, intent, spentToday);
    if (!verdict.allowed) {
      return c.json(
        {
          error: verdict.detail || 'Payment denied by agent policy.',
          code: 'AGENT_POLICY_DENIED',
          reason: verdict.reason,
        },
        403
      );
    }

    return await next();
  };
};

/** True when a stored approval's payload matches the retried intent exactly. */
function approvalMatches(
  payloadJson: string,
  intent: { recipientHandle: string; asset: string; amount: number }
): boolean {
  try {
    const p = JSON.parse(payloadJson);
    return (
      String(p.recipientHandle) === intent.recipientHandle &&
      String(p.asset) === intent.asset &&
      Math.abs((parseFloat(p.amount) || 0) - intent.amount) < 1e-9
    );
  } catch {
    return false;
  }
}
