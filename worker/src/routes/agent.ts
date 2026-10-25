/**
 * AI Chat Payment Rail for UP (UPRAIL.app).
 *
 * Designed specifically so users can connect any AI chat interface (ChatGPT,
 * Claude, Cursor, etc.) to send, receive, and check confidential payments
 * with strict USD spend caps:
 *  - Management (cookie + passkey): create, list, and revoke AI chat keys.
 *  - Chat Actions (Bearer agent key): pay @handle, receive (handle + cross-chain
 *    deposit address), read balance, and list sent/received payments.
 *  - OpenAPI spec (GET /api/agent/openapi.json): 1-click import for ChatGPT Actions.
 */

import { Context, Hono } from 'hono';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import {
  requireAgent,
  authorizeAgentSend,
  authorizeAgentWithdrawal,
} from '../middleware/agentAuth';
import { generateAgentKey, currentUtcDay } from '../services/agentKeys';
import {
  claimAgentRequest,
  completeAgentRequest,
  failAgentRequest,
  normalizeIdempotencyKey,
} from '../services/agentRequests';
import { paymentsRouter, handleSendPayment } from './payments';
import { handleWithdraw } from './claim';
import * as nearRpc from '../services/nearRpc';

export const agentRouter = new Hono<AppContext>();

agentRouter.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

const MAX_NAME = 48;
const MAX_KEY_DAYS = 365;
const DEFAULT_PER_TX_USD = 25;
const DEFAULT_DAILY_USD = 100;
const MAX_LIMIT_USD = 100_000;

interface KeyBody {
  name?: string;
  mode?: string | null;
  asset?: string | null;
  allowlist?: unknown;
  perTxLimit?: number | string | null;
  dailyLimit?: number | string | null;
  expiresInDays?: number | string | null;
}

function parseUsdLimit(value: unknown, fallback: number): number | null {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_LIMIT_USD) return null;
  const rounded = Math.round(n * 100) / 100;
  return rounded >= 0.01 ? rounded : null;
}

function shouldReleaseAgentSpend(status: number, code?: string): boolean {
  if (status >= 400 && status < 500) return true;
  return code === 'PAYMENT_RECORD_FAILED';
}

/**
 * Shared payment execution pipeline for both `POST /api/agent/pay` and the MCP
 * `pay_handle` tool.
 *
 * Enforces the USD caps with an atomic reservation, obtains a signed quote when
 * needed, and delegates settlement to the same handler as a human send. The
 * reservation is released only when the failure is definitely pre-settlement;
 * ambiguous settlement failures stay charged to keep the daily cap fail-closed.
 */

export async function executeAgentPay(
  c: Context<AppContext>,
  rawBody: Record<string, any>
): Promise<Response> {
  const agent = c.get('agent')!;
  const recipientHandle = String(rawBody?.recipientHandle || '').trim();
  const asset = String(rawBody?.asset || '').trim();
  const amount =
    typeof rawBody?.amount === 'number'
      ? rawBody.amount
      : parseFloat(String(rawBody?.amount ?? ''));
  const memo = typeof rawBody?.memo === 'string' ? rawBody.memo.trim() : undefined;

  if (!recipientHandle || !asset || !Number.isFinite(amount) || amount <= 0) {
    return c.json(
      {
        error: 'recipientHandle, asset, and a positive amount are required.',
        code: 'INVALID_REQUEST',
      },
      400
    );
  }

  const idempotency = normalizeIdempotencyKey(
    c.req.header('Idempotency-Key') ?? rawBody?.idempotencyKey
  );
  if (!idempotency.ok) {
    return c.json(
      {
        error: 'Invalid Idempotency-Key. Use 1-128 letters, numbers, dots, colons, underscores or hyphens.',
        code: 'INVALID_IDEMPOTENCY_KEY',
      },
      400
    );
  }
  const idempotencyKey = idempotency.key;

  if (idempotencyKey) {
    const claim = await claimAgentRequest(c.env, agent.key_id, idempotencyKey);
    if (claim.state === 'replay') {
      return c.json(
        {
          error: 'This idempotency key already completed a payment.',
          code: 'AGENT_REQUEST_ALREADY_COMPLETED',
          paymentId: claim.paymentId,
        },
        409
      );
    }
    if (claim.state === 'in_progress') {
      return c.json(
        {
          error: 'A payment with this idempotency key is already in progress.',
          code: 'AGENT_REQUEST_IN_PROGRESS',
        },
        409
      );
    }
    if (claim.state === 'unknown') {
      return c.json(
        {
          error:
            'A previous payment with this idempotency key has an unknown outcome. Check your payment history before retrying.',
          code: 'AGENT_REQUEST_UNKNOWN',
        },
        409
      );
    }
    if (claim.state === 'unavailable') {
      return c.json(
        {
          error: 'Could not safely record the idempotency key. Try again later.',
          code: 'AGENT_REQUEST_UNAVAILABLE',
        },
        503
      );
    }
  }

  const markFailed = async () => {
    if (idempotencyKey) await failAgentRequest(c.env, agent.key_id, idempotencyKey, 'FAILED');
  };
  const markUnknown = async () => {
    if (idempotencyKey) await failAgentRequest(c.env, agent.key_id, idempotencyKey, 'UNKNOWN');
  };

  const auth = await authorizeAgentSend(c, agent, {
    recipientHandle,
    asset,
    amount,
    memo,
  });
  if (!auth.allowed) {
    await markFailed();
    return auth.response;
  }

  try {
    let quoteSignature =
      typeof rawBody?.quoteSignature === 'string' ? rawBody.quoteSignature.trim() : '';
    let depositAddress =
      typeof rawBody?.depositAddress === 'string' ? rawBody.depositAddress.trim() : '';

    if (!quoteSignature || !depositAddress) {
      let quoteRes: Response;
      try {
        const quoteReq = new Request('https://uprail.internal/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientHandle, asset, amount }),
        });
        quoteRes = await paymentsRouter.fetch(quoteReq, c.env, c.executionCtx);
      } catch (err) {
        await auth.release();
        await markFailed();
        console.error('[agent] quote request failed:', err);
        return c.json(
          { error: 'Failed to prepare payment quote.', code: 'QUOTE_FAILED' },
          502
        );
      }

      if (!quoteRes.ok) {
        await auth.release();
        await markFailed();
        const errData = (await quoteRes.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        return c.json(
          {
            error: errData.error || 'Failed to prepare payment quote.',
            code: errData.code || 'QUOTE_FAILED',
          },
          quoteRes.status as any
        );
      }
      const quote = (await quoteRes.json()) as {
        quoteSignature?: string;
        depositAddress?: string;
      };
      quoteSignature = quote.quoteSignature || '';
      depositAddress = quote.depositAddress || '';
    }

    c.set('parsedBody' as any, {
      recipientHandle,
      asset,
      amount,
      memo,
      quoteSignature,
      depositAddress,
    });

    const response = await handleSendPayment(c);

    const payload = (await response.clone().json().catch(() => null)) as {
      paymentId?: unknown;
      code?: unknown;
    } | null;
    const code = typeof payload?.code === 'string' ? payload.code : undefined;

    if (response.status === 201) {
      if (idempotencyKey) {
        const paymentId = typeof payload?.paymentId === 'string' ? payload.paymentId : null;
        if (paymentId) {
          const recorded = await completeAgentRequest(
            c.env,
            agent.key_id,
            idempotencyKey,
            paymentId
          );
          if (!recorded) {
            console.error('[agent] payment settled but idempotency row was not completed');
          }
        } else {
          await markUnknown();
        }
      }
    } else if (shouldReleaseAgentSpend(response.status, code)) {
      await auth.release();
      await markFailed();
    } else {
      await markUnknown();
    }

    return response;
  } catch (err) {
    await markUnknown();
    throw err;
  }
}

/**
 * Shared withdrawal execution pipeline for REST `/api/agent/withdraw` and the
 * MCP `withdraw_to_wallet` tool. Enforces the same per-key USD caps as sends,
 * then delegates settlement to the human withdrawal path. The agent key is the
 * authorization factor; withdrawals still require an explicit amount.
 */
export async function executeAgentWithdraw(
  c: Context<AppContext>,
  rawBody: Record<string, any>
): Promise<Response> {
  const agent = c.get('agent')!;
  const destinationAddress = String(rawBody?.destinationAddress || '').trim();
  const destinationChain =
    String(rawBody?.destinationChain || rawBody?.chain || '')
      .trim()
      .toLowerCase() || undefined;
  const asset = String(rawBody?.asset || 'usdc').trim().toLowerCase();
  const amountStr = String(rawBody?.amount ?? '').trim();

  if (!destinationAddress) {
    return c.json(
      { error: 'destinationAddress is required.', code: 'INVALID_REQUEST' },
      400
    );
  }
  if (
    !amountStr ||
    amountStr === 'all' ||
    !/^\d{1,15}(\.\d{1,18})?$/.test(amountStr) ||
    Number(amountStr) <= 0
  ) {
    return c.json(
      {
        error: 'A positive explicit amount is required for AI chat withdrawals.',
        code: 'INVALID_AMOUNT',
      },
      400
    );
  }

  const parsedAmount = Number(amountStr);
  const idempotency = normalizeIdempotencyKey(
    c.req.header('Idempotency-Key') ?? rawBody?.idempotencyKey
  );
  if (!idempotency.ok) {
    return c.json(
      {
        error:
          'Invalid Idempotency-Key. Use 1-128 letters, numbers, dots, colons, underscores or hyphens.',
        code: 'INVALID_IDEMPOTENCY_KEY',
      },
      400
    );
  }
  const idempotencyKey = idempotency.key;

  if (idempotencyKey) {
    const claim = await claimAgentRequest(c.env, agent.key_id, idempotencyKey);
    if (claim.state === 'replay') {
      return c.json(
        {
          error: 'This idempotency key already completed a withdrawal.',
          code: 'AGENT_REQUEST_ALREADY_COMPLETED',
          withdrawalId: claim.paymentId,
        },
        409
      );
    }
    if (claim.state === 'in_progress') {
      return c.json(
        {
          error: 'A withdrawal with this idempotency key is already in progress.',
          code: 'AGENT_REQUEST_IN_PROGRESS',
        },
        409
      );
    }
    if (claim.state === 'unknown') {
      return c.json(
        {
          error:
            'A previous withdrawal with this idempotency key has an unknown outcome. Check your history before retrying.',
          code: 'AGENT_REQUEST_UNKNOWN',
        },
        409
      );
    }
    if (claim.state === 'unavailable') {
      return c.json(
        {
          error: 'Could not safely record the idempotency key. Try again later.',
          code: 'AGENT_REQUEST_UNAVAILABLE',
        },
        503
      );
    }
  }

  const markFailed = async () => {
    if (idempotencyKey) await failAgentRequest(c.env, agent.key_id, idempotencyKey, 'FAILED');
  };
  const markUnknown = async () => {
    if (idempotencyKey) await failAgentRequest(c.env, agent.key_id, idempotencyKey, 'UNKNOWN');
  };

  const auth = await authorizeAgentWithdrawal(c, agent, {
    asset,
    amount: parsedAmount,
    destinationAddress,
    destinationChain,
  });
  if (!auth.allowed) {
    await markFailed();
    return auth.response;
  }

  c.set('parsedBody' as any, {
    destinationAddress,
    destinationChain,
    asset,
    amount: amountStr,
  });

  try {
    const response = await handleWithdraw(c);
    const payload = (await response.clone().json().catch(() => null)) as {
      withdrawalId?: unknown;
    } | null;
    const withdrawalId =
      typeof payload?.withdrawalId === 'string' ? payload.withdrawalId : null;

    if (response.ok) {
      if (idempotencyKey) {
        if (withdrawalId) {
          const recorded = await completeAgentRequest(
            c.env,
            agent.key_id,
            idempotencyKey,
            withdrawalId
          );
          if (!recorded) {
            console.error('[agent] withdrawal settled but idempotency row was not completed');
          }
        } else {
          await markUnknown();
        }
      }
    } else if (
      (response.status >= 400 && response.status < 500) ||
      response.status === 502 ||
      response.status === 503
    ) {
      await auth.release();
      await markFailed();
    } else {
      await markUnknown();
    }

    return response;
  } catch (err) {
    await markUnknown();
    throw err;
  }
}

/**
 * POST /api/agent/keys
 * Creates an AI chat key with mandatory USD spend caps. Passkey-gated.
 * The plaintext key (`up_agent_...`) is returned once and never stored.
 */
agentRouter.post('/keys', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), async (c) => {
  const session = c.get('session')!;
  const body = (c.get('parsedBody' as any) || {}) as KeyBody;

  const name = String(body.name || '').trim().slice(0, MAX_NAME);
  if (!name) {
    return c.json({ error: 'A name for your AI chat is required.', code: 'INVALID_NAME' }, 400);
  }

  const mode = body.mode == null || body.mode === '' ? 'autonomous' : String(body.mode);
  if (mode !== 'autonomous') {
    return c.json(
      {
        error: 'Only autonomous AI chat keys are supported. Always-ask mode is not available.',
        code: 'UNSUPPORTED_AGENT_MODE',
      },
      400
    );
  }
  const hasAssetScope = body.asset != null && String(body.asset).trim() !== '';
  const hasAllowlist =
    body.allowlist != null &&
    !(Array.isArray(body.allowlist) && body.allowlist.length === 0);
  if (hasAssetScope || hasAllowlist) {
    return c.json(
      {
        error: 'Asset and recipient allowlists are not supported on AI chat keys.',
        code: 'UNSUPPORTED_AGENT_SCOPE',
      },
      400
    );
  }

  const perTxUsd = parseUsdLimit(body.perTxLimit, DEFAULT_PER_TX_USD);
  const dailyUsd = parseUsdLimit(body.dailyLimit, DEFAULT_DAILY_USD);
  if (perTxUsd === null || dailyUsd === null) {
    return c.json(
      {
        error: 'Valid positive USD spend limits are required.',
        code: 'INVALID_SPEND_LIMITS',
      },
      400
    );
  }
  if (perTxUsd > dailyUsd) {
    return c.json(
      {
        error: 'Per-payment limit cannot exceed the daily spend limit.',
        code: 'PER_TX_EXCEEDS_DAILY',
      },
      400
    );
  }

  let expiresAt: number | null = null;
  if (body.expiresInDays != null && body.expiresInDays !== '') {
    const days = Number(body.expiresInDays);
    if (!Number.isFinite(days) || days <= 0) {
      return c.json(
        {
          error: 'Key expiration must be a positive number of days (maximum 365).',
          code: 'INVALID_KEY_EXPIRY',
        },
        400
      );
    }
    expiresAt = Date.now() + Math.min(days, MAX_KEY_DAYS) * 86400 * 1000;
  }

  const agentId = crypto.randomUUID();
  const keyId = crypto.randomUUID();
  const { plaintext, hash, prefix } = await generateAgentKey();
  const now = Date.now();
  const perTxLimit = String(perTxUsd);
  const dailyLimit = String(dailyUsd);

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO agents (id, x_id, name, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(agentId, session.x_id, name, mode, now, now),
      c.env.DB.prepare(
        `INSERT INTO agent_keys
          (id, agent_id, x_id, label, key_hash, key_prefix, asset, per_tx_limit, daily_limit, allowlist, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)`
      ).bind(keyId, agentId, session.x_id, name, hash, prefix, perTxLimit, dailyLimit, expiresAt, now),
    ]);
  } catch (err) {
    console.error('[agent] key creation failed:', err);
    return c.json({ error: 'Could not create the AI chat key.', code: 'AGENT_KEY_CREATE_FAILED' }, 500);
  }

  return c.json(
    {
      id: keyId,
      agentId,
      name,
      perTxLimit,
      dailyLimit,
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
 * Lists the caller's AI chat keys (never the secret) along with today's USD spend.
 */
agentRouter.get('/keys', requireAuth({ passkeyVerified: true }), async (c) => {
  const session = c.get('session')!;
  const { results } = await c.env.DB.prepare(
    `SELECT k.id, k.agent_id, k.label, k.key_prefix, k.per_tx_limit, k.daily_limit,
            k.expires_at, k.last_used_at, k.revoked_at, k.created_at,
            a.name
       FROM agent_keys k
       JOIN agents a ON a.id = k.agent_id
      WHERE k.x_id = ?
      ORDER BY k.created_at DESC`
  )
    .bind(session.x_id)
    .all<any>();

  const keys = (results || []).map((row): any => ({
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    label: row.label,
    keyPrefix: row.key_prefix,
    perTxLimit: row.per_tx_limit,
    dailyLimit: row.daily_limit,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    spentToday: 0,
  }));

  if (keys.length) {
    try {
      const { results: spendRows } = await c.env.DB.prepare(
        'SELECT agent_key_id, spent FROM agent_spend WHERE day = ?'
      )
        .bind(currentUtcDay())
        .all<{ agent_key_id: string; spent: string | null }>();
      const spendByKey = new Map(
        (spendRows || []).map((r) => [r.agent_key_id, parseFloat(r.spent || '0') || 0])
      );
      for (const k of keys) k.spentToday = spendByKey.get(k.id) ?? 0;
    } catch (err) {
      console.warn('[agent] spend attach failed:', err);
    }
  }

  return c.json({ keys });
});

/**
 * POST /api/agent/keys/:id/revoke
 * Revokes an AI chat key immediately. Passkey-gated.
 */
agentRouter.post('/keys/:id/revoke', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), async (c) => {
  const session = c.get('session')!;
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    'UPDATE agent_keys SET revoked_at = ? WHERE id = ? AND x_id = ? AND revoked_at IS NULL'
  )
    .bind(Date.now(), id, session.x_id)
    .run();

  if (!result.meta?.changes) {
    return c.json({ error: 'Key not found.', code: 'AGENT_KEY_NOT_FOUND' }, 404);
  }
  return c.json({ id, revoked: true });
});

/**
 * POST /api/agent/keys/:id/delete
 * Permanently removes a revoked or expired key and its spend/idempotency
 * history. Passkey-gated and owner-scoped; active keys must be revoked first.
 */
agentRouter.post('/keys/:id/delete', requireAuth({ passkeyVerified: true }), requirePasskeyAuth(), async (c) => {
  const session = c.get('session')!;
  const id = c.req.param('id');
  const key = await c.env.DB.prepare(
    'SELECT agent_id, revoked_at, expires_at FROM agent_keys WHERE id = ? AND x_id = ?'
  )
    .bind(id, session.x_id)
    .first<{ agent_id: string; revoked_at: number | null; expires_at: number | null }>();

  if (!key) {
    return c.json({ error: 'Key not found.', code: 'AGENT_KEY_NOT_FOUND' }, 404);
  }
  const now = Date.now();
  const dead = Boolean(key.revoked_at) || Boolean(key.expires_at && key.expires_at < now);
  if (!dead) {
    return c.json(
      {
        error: 'Revoke this key before deleting it.',
        code: 'AGENT_KEY_NOT_REVOKED',
      },
      409
    );
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM agent_spend WHERE agent_key_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM agent_requests WHERE agent_key_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM agent_approvals WHERE agent_key_id = ?').bind(id),
    c.env.DB.prepare(
      `DELETE FROM agent_keys
        WHERE id = ? AND x_id = ?
          AND (revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < ?))`
    ).bind(id, session.x_id, now),
    c.env.DB.prepare(
      `DELETE FROM agents
        WHERE id = ? AND x_id = ?
          AND NOT EXISTS (SELECT 1 FROM agent_keys WHERE agent_id = ?)`
    ).bind(key.agent_id, session.x_id, key.agent_id),
  ]);

  return c.json({ id, deleted: true });
});

/**
 * POST /api/agent/pay
 * Bearer-authenticated. Sends a confidential payment to an X @handle within the
 * key's USD spend caps. Auto-quotes when no quoteSignature is supplied.
 */
agentRouter.post('/pay', requireAgent(), async (c) => {
  const body =
    (c.get('parsedBody' as any) as Record<string, any> | undefined) ||
    ((await c.req.json().catch(() => ({}))) as Record<string, any>);
  return await executeAgentPay(c, body);
});

/**
 * POST /api/agent/withdraw
 * Bearer-authenticated. Withdraws to an external wallet address within the
 * key's USD spend caps. Requires an explicit amount (no "all").
 */
agentRouter.post('/withdraw', requireAgent(), async (c) => {
  const body =
    (c.get('parsedBody' as any) as Record<string, any> | undefined) ||
    ((await c.req.json().catch(() => ({}))) as Record<string, any>);
  return await executeAgentWithdraw(c, body);
});

/**
 * GET /api/agent/receive
 * Bearer-authenticated. Returns the user's UPRAIL @handle, confidential vault
 * account, pending incoming payments, and (when `chain` is specified) a fresh
 * single-use cross-chain deposit address so the user can receive crypto from
 * any wallet directly inside their AI chat.
 */
agentRouter.get('/receive', requireAgent(), async (c) => {
  const session = c.get('session')!;
  const chain = (c.req.query('chain') || '').trim().toLowerCase();
  const token = (c.req.query('token') || '').trim().toUpperCase() || undefined;
  const amount = (c.req.query('amount') || '').trim() || undefined;

  try {
    const nearAccount =
      session.near_account || (await nearRpc.resolveUserNearAccount(c.env, session));
    let depositAddress: string | null = null;

    if (chain) {
      const deposit = await nearRpc.getDepositAddress(
        c.env,
        nearAccount,
        chain,
        true,
        token,
        amount
      );
      if (!deposit?.address) {
        return c.json(
          {
            error: `Could not generate a deposit address for chain "${chain}"${token ? ` (${token})` : ''}.`,
            code: 'NO_DEPOSIT_ADDRESS',
          },
          404
        );
      }
      depositAddress = deposit.address;
    }

    let pendingPayments: any[] = [];
    if (c.env.DB) {
      try {
        const { results } = await c.env.DB.prepare(
          `SELECT id, sender_x_handle, asset, amount, memo, status, created_at, expires_at
             FROM payments
            WHERE (recipient_x_id = ? OR (recipient_x_id IS NULL AND LOWER(recipient_handle) = LOWER(?)))
              AND status = 'ESCROWED'
            ORDER BY created_at DESC
            LIMIT 25`
        )
          .bind(session.x_id, session.x_handle)
          .all<any>();
        pendingPayments = results || [];
      } catch {}
    }

    return c.json({
      handle: `@${session.x_handle}`,
      nearAccount,
      ...(chain
        ? {
            chain,
            token: token || null,
            amount: amount || null,
            depositAddress,
          }
        : {}),
      pendingPayments,
      instructions: chain
        ? `Send ${amount ? `${amount} ` : ''}${token || 'tokens'} on ${chain} to ${depositAddress}. Funds credit straight to @${session.x_handle}'s confidential UPRAIL vault.`
        : `Anyone on UPRAIL can pay @${session.x_handle} directly by X handle, or pass ?chain=base&token=USDC (supported chains: near, base, ethereum, arbitrum, solana, bitcoin) to generate a cross-chain deposit address.`,
    });
  } catch (err) {
    console.error('[agent] receive failed:', err);
    return c.json({ error: 'Could not prepare receive details.', code: 'RECEIVE_ERROR' }, 500);
  }
});

/**
 * GET /api/agent/balance?asset=USDC
 * Available balance for a specific asset (defaults to NEAR) plus the user's
 * @handle.
 */
agentRouter.get('/balance', requireAgent(), async (c) => {
  const session = c.get('session')!;
  const asset = c.req.query('asset') || 'NEAR';
  try {
    const available = await nearRpc.getUserAvailableBalance(c.env, session, asset);
    return c.json({
      handle: `@${session.x_handle}`,
      asset,
      available,
    });
  } catch (err) {
    console.error('[agent] balance lookup failed:', err);
    return c.json({ error: 'Could not read balance.', code: 'BALANCE_ERROR' }, 500);
  }
});

/**
 * GET /api/agent/payments
 * The owner's recent sent and received payments (read-only).
 */
agentRouter.get('/payments', requireAgent(), async (c) => {
  const session = c.get('session')!;
  const { results } = await c.env.DB.prepare(
    `SELECT id, sender_x_id, sender_x_handle, recipient_handle, asset, amount, memo, status, created_at, expires_at
       FROM payments
      WHERE sender_x_id = ?
         OR recipient_x_id = ?
         OR (recipient_x_id IS NULL AND LOWER(recipient_handle) = LOWER(?))
      ORDER BY created_at DESC
      LIMIT 50`
  )
    .bind(session.x_id, session.x_id, session.x_handle)
    .all<any>();

  const payments = (results || []).map((row) => ({
    id: row.id,
    direction: row.sender_x_id === session.x_id ? 'sent' : 'received',
    senderHandle: row.sender_x_handle ? `@${row.sender_x_handle}` : null,
    recipientHandle: `@${String(row.recipient_handle || '').replace(/^@/, '')}`,
    asset: row.asset,
    amount: row.amount,
    memo: row.memo || null,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
  }));

  return c.json({ payments });
});

/**
 * GET /api/agent/openapi.json
 * Public OpenAPI 3.1.0 specification so OpenAI (ChatGPT / OpenAI Dot), Grok,
 * Meta Muse, or any OpenAPI-based AI assistant can import UPRAIL payment
 * actions by URL.
 */
agentRouter.get('/openapi.json', (c) => {
  const origin = new URL(c.req.url).origin;
  const serverUrl = origin.includes('localhost') ? origin : 'https://api.uprail.world';
  return c.json({
    openapi: '3.1.0',
    info: {
      title: 'UPRAIL AI Chat Payments',
      version: '1.0.0',
      description:
        'Send, receive, and check confidential payments on UPRAIL from OpenAI, Claude, Grok, Meta Muse, or any AI chat interface.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Paste your UPRAIL AI Chat key (starts with up_agent_)',
        },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: {
      '/api/agent/pay': {
        post: {
          operationId: 'sendPayment',
          summary: 'Send a confidential payment to an X @handle',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string', maxLength: 128 },
              description:
                'Unique key for retry safety. A repeated key never sends a second payment.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['recipientHandle', 'asset', 'amount'],
                  properties: {
                    recipientHandle: {
                      type: 'string',
                      description: 'Recipient X handle, e.g. @alice',
                    },
                    asset: {
                      type: 'string',
                      description: 'Token symbol, e.g. USDC, USDT, NEAR',
                    },
                    amount: {
                      type: 'number',
                      description: 'Human-readable token amount to send',
                    },
                    memo: {
                      type: 'string',
                      description: 'Optional payment note',
                    },
                    idempotencyKey: {
                      type: 'string',
                      maxLength: 128,
                      description:
                        'Optional unique key for retry safety; the Idempotency-Key header takes precedence.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Payment sent and escrowed for recipient' },
            '403': { description: 'Blocked by USD spend limit' },
            '409': { description: 'Idempotency key already used or still in progress' },
          },
        },
      },
      '/api/agent/withdraw': {
        post: {
          operationId: 'withdrawToWallet',
          summary: 'Withdraw funds from the UPRAIL vault to an external wallet address',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string', maxLength: 128 },
              description:
                'Unique key for retry safety. A repeated key never sends a second withdrawal.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['destinationAddress', 'asset', 'amount'],
                  properties: {
                    destinationAddress: {
                      type: 'string',
                      description: 'Destination wallet address',
                    },
                    destinationChain: {
                      type: 'string',
                      description: 'Optional destination network, e.g. base, ethereum, solana, bitcoin, near',
                    },
                    asset: {
                      type: 'string',
                      description: 'Token symbol, e.g. USDC, USDT, NEAR',
                    },
                    amount: {
                      type: 'string',
                      description: 'Explicit human-readable amount; "all" is not accepted',
                    },
                    idempotencyKey: {
                      type: 'string',
                      maxLength: 128,
                      description: 'Optional unique key for retry safety',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Withdrawal settled' },
            '403': { description: 'Blocked by USD spend limit' },
            '409': { description: 'Idempotency key already used or still in progress' },
          },
        },
      },
      '/api/agent/receive': {
        get: {
          operationId: 'receivePayment',
          summary:
            'Get your UPRAIL @handle, view pending incoming payments, or generate a deposit address for any chain',
          parameters: [
            {
              name: 'chain',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['near', 'base', 'ethereum', 'arbitrum', 'solana', 'bitcoin'],
              },
              description: 'Optional blockchain network to generate a deposit address for',
            },
            {
              name: 'token',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional token symbol, e.g. USDC, USDT, NEAR, SOL, ETH',
            },
            {
              name: 'amount',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional expected deposit amount',
            },
          ],
          responses: {
            '200': { description: 'Receive details and optional deposit address' },
          },
        },
      },
      '/api/agent/balance': {
        get: {
          operationId: 'getBalance',
          summary: 'Check available UPRAIL vault balance for a token',
          parameters: [
            {
              name: 'asset',
              in: 'query',
              required: false,
              schema: { type: 'string', default: 'NEAR' },
              description: 'Token symbol to check (e.g. USDC, USDT, NEAR)',
            },
          ],
          responses: {
            '200': { description: 'Available token balance' },
          },
        },
      },
      '/api/agent/payments': {
        get: {
          operationId: 'listPayments',
          summary: 'List recent sent and received payments',
          responses: {
            '200': { description: 'List of recent sent and received payments' },
          },
        },
      },
    },
  });
});
