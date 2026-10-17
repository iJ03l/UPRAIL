/**
 * Agent payment rail for UP (UPRAIL.app).
 *
 * Two faces on one router:
 *  - Management (cookie + passkey): create/list/revoke agent keys, and
 *    approve/deny Always-Ask payments.
 *  - Programmatic (Bearer agent key): pay, read balance, list payments.
 *
 * Programmatic sends reuse `handleSendPayment` verbatim, so an agent payment is
 * the same onchain object as a human send — same quote binding, same escrow,
 * same expiry/refund behavior.
 */

import { Context, Hono } from 'hono';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import { requireAgent } from '../middleware/agentAuth';
import { generateAgentKey, normalizeRecipient, addAgentSpend } from '../services/agentKeys';
import { handleSendPayment } from './payments';
import * as nearRpc from '../services/nearRpc';

export const agentRouter = new Hono<AppContext>();

const MAX_NAME = 48;
const MAX_KEY_DAYS = 365;

interface KeyBody {
  name?: string;
  mode?: string;
  asset?: string | null;
  perTxLimit?: number | string | null;
  dailyLimit?: number | string | null;
  allowlist?: string[] | null;
  expiresInDays?: number | string | null;
}

function parsePositiveLimit(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n);
}

/**
 * POST /api/agent/keys
 * Creates a named agent and mints one scoped key. The plaintext key is returned
 * exactly once and never stored. Passkey-gated: a key can move funds, so
 * creating one is a fund-affecting action.
 */
agentRouter.post('/keys', requireAuth(), requirePasskeyAuth(), async (c) => {
  const session = c.get('session')!;
  const body = (c.get('parsedBody' as any) || {}) as KeyBody;

  const name = String(body.name || '').trim().slice(0, MAX_NAME);
  if (!name) {
    return c.json({ error: 'A name is required.', code: 'INVALID_NAME' }, 400);
  }

  const mode = body.mode === 'autonomous' ? 'autonomous' : 'always_ask';
  const asset = typeof body.asset === 'string' && body.asset.trim() ? body.asset.trim() : null;
  const perTxLimit = parsePositiveLimit(body.perTxLimit);
  const dailyLimit = parsePositiveLimit(body.dailyLimit);

  let allowlist: string | null = null;
  if (Array.isArray(body.allowlist) && body.allowlist.length > 0) {
    const normalized = body.allowlist
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(normalizeRecipient);
    if (normalized.length > 0) allowlist = JSON.stringify(normalized);
  }

  let expiresAt: number | null = null;
  const days = body.expiresInDays == null ? null : Number(body.expiresInDays);
  if (days !== null && Number.isFinite(days) && days > 0) {
    expiresAt = Date.now() + Math.min(days, MAX_KEY_DAYS) * 86400 * 1000;
  }

  const agentId = crypto.randomUUID();
  const keyId = crypto.randomUUID();
  const { plaintext, hash, prefix } = await generateAgentKey();
  const now = Date.now();

  try {
    await c.env.DB.prepare(
      'INSERT INTO agents (id, x_id, name, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(agentId, session.x_id, name, mode, now, now)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO agent_keys
        (id, agent_id, x_id, label, key_hash, key_prefix, asset, per_tx_limit, daily_limit, allowlist, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        keyId,
        agentId,
        session.x_id,
        name,
        hash,
        prefix,
        asset,
        perTxLimit,
        dailyLimit,
        allowlist,
        expiresAt,
        now
      )
      .run();
  } catch (err) {
    console.error('[agent] key creation failed:', err);
    return c.json({ error: 'Could not create the agent key.', code: 'AGENT_KEY_CREATE_FAILED' }, 500);
  }

  return c.json(
    {
      id: keyId,
      agentId,
      name,
      mode,
      asset,
      perTxLimit,
      dailyLimit,
      allowlist: allowlist ? JSON.parse(allowlist) : null,
      expiresAt,
      keyPrefix: prefix,
      // Shown once. The caller must store it; it is unrecoverable.
      key: plaintext,
    },
    201
  );
});

/**
 * GET /api/agent/keys
 * Lists the caller's agent keys (never the secret).
 */
agentRouter.get('/keys', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const { results } = await c.env.DB.prepare(
    `SELECT k.id, k.agent_id, k.label, k.key_prefix, k.asset, k.per_tx_limit, k.daily_limit,
            k.allowlist, k.expires_at, k.last_used_at, k.revoked_at, k.created_at,
            a.name, a.mode
       FROM agent_keys k
       JOIN agents a ON a.id = k.agent_id
      WHERE k.x_id = ?
      ORDER BY k.created_at DESC`
  )
    .bind(session.x_id)
    .all<any>();

  const keys = (results || []).map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    label: row.label,
    mode: row.mode,
    keyPrefix: row.key_prefix,
    asset: row.asset,
    perTxLimit: row.per_tx_limit,
    dailyLimit: row.daily_limit,
    allowlist: row.allowlist ? safeJson(row.allowlist) : null,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));

  return c.json({ keys });
});

/**
 * POST /api/agent/keys/:id/revoke
 * Revokes a key immediately. Passkey-gated.
 */
agentRouter.post('/keys/:id/revoke', requireAuth(), requirePasskeyAuth(), async (c) => {
  const session = c.get('session')!;
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    'UPDATE agent_keys SET revoked_at = ? WHERE id = ? AND x_id = ? AND revoked_at IS NULL'
  )
    .bind(Date.now(), id, session.x_id)
    .run();

  if (!result.meta?.changes) {
    return c.json({ error: 'Agent key not found.', code: 'AGENT_KEY_NOT_FOUND' }, 404);
  }
  return c.json({ id, revoked: true });
});

/**
 * GET /api/agent/approvals
 * Pending Always-Ask approvals awaiting the user's on-device decision.
 */
agentRouter.get('/approvals', requireAuth(), async (c) => {
  const session = c.get('session')!;
  const { results } = await c.env.DB.prepare(
    `SELECT id, agent_key_id, payload, status, created_at, expires_at
       FROM agent_approvals
      WHERE x_id = ? AND status = 'PENDING' AND expires_at > ?
      ORDER BY created_at DESC`
  )
    .bind(session.x_id, Date.now())
    .all<any>();

  const approvals = (results || []).map((row) => ({
    id: row.id,
    agentKeyId: row.agent_key_id,
    payload: safeJson(row.payload),
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
  return c.json({ approvals });
});

/**
 * POST /api/agent/approvals/:id/approve | /deny
 * The on-device decision. Passkey-gated.
 */
async function decideApproval(
  c: Context<AppContext>,
  status: 'APPROVED' | 'DENIED'
): Promise<Response> {
  const session = c.get('session')!;
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    `UPDATE agent_approvals SET status = ?, decided_at = ?
      WHERE id = ? AND x_id = ? AND status = 'PENDING'`
  )
    .bind(status, Date.now(), id, session.x_id)
    .run();

  if (!result.meta?.changes) {
    return c.json({ error: 'Approval not found or already decided.', code: 'APPROVAL_NOT_FOUND' }, 404);
  }
  return c.json({ id, status });
}

agentRouter.post('/approvals/:id/approve', requireAuth(), requirePasskeyAuth(), (c) =>
  decideApproval(c, 'APPROVED')
);
agentRouter.post('/approvals/:id/deny', requireAuth(), requirePasskeyAuth(), (c) =>
  decideApproval(c, 'DENIED')
);

/**
 * POST /api/agent/pay
 * Bearer-authenticated. Delegates to the human send pipeline, then records the
 * spend against the key's daily budget on success.
 */
agentRouter.post('/pay', requireAgent(), async (c) => {
  const agent = c.get('agent')!;
  const body = (c.get('parsedBody' as any) || {}) as any;
  const response = await handleSendPayment(c);
  if (response.status === 201) {
    const amount = parseFloat(String(body?.amount)) || 0;
    c.executionCtx?.waitUntil?.(addAgentSpend(c.env, agent.key_id, amount));
  }
  return response;
});

/**
 * GET /api/agent/balance?asset=USDC
 * Available balance for one asset (defaults to NEAR).
 */
agentRouter.get('/balance', requireAgent(), async (c) => {
  const session = c.get('session')!;
  const asset = c.req.query('asset') || 'NEAR';
  try {
    const available = await nearRpc.getUserAvailableBalance(c.env, session, asset);
    return c.json({ asset, available });
  } catch (err) {
    console.error('[agent] balance lookup failed:', err);
    return c.json({ error: 'Could not read balance.', code: 'BALANCE_ERROR' }, 500);
  }
});

/**
 * GET /api/agent/payments
 * The owner's recent payments (agent-visible, read-only).
 */
agentRouter.get('/payments', requireAgent(), async (c) => {
  const session = c.get('session')!;
  const { results } = await c.env.DB.prepare(
    `SELECT id, recipient_handle, asset, amount, status, created_at, expires_at
       FROM payments
      WHERE sender_x_id = ?
      ORDER BY created_at DESC
      LIMIT 50`
  )
    .bind(session.x_id)
    .all<any>();
  return c.json({ payments: results || [] });
});

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
