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
import { requireAgent, authorizeAgentSend } from '../middleware/agentAuth';
import { generateAgentKey, currentUtcDay } from '../services/agentKeys';
import { paymentsRouter, handleSendPayment } from './payments';
import * as nearRpc from '../services/nearRpc';

export const agentRouter = new Hono<AppContext>();

const MAX_NAME = 48;
const MAX_KEY_DAYS = 365;
const DEFAULT_PER_TX_USD = 25;
const DEFAULT_DAILY_USD = 100;
const MAX_LIMIT_USD = 100_000;

interface KeyBody {
  name?: string;
  perTxLimit?: number | string | null;
  dailyLimit?: number | string | null;
  expiresInDays?: number | string | null;
}

function parseUsdLimit(value: unknown, fallback: number): number | null {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_LIMIT_USD) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Shared payment execution pipeline for both `POST /api/agent/pay` and the MCP
 * `pay_handle` tool.
 *
 * 1. Enforces the key's USD per-transaction and daily spend caps, atomically
 *    reserving the USD amount before any funds move.
 * 2. Automatically obtains a fresh signed quote from the quote pipeline when
 *    the caller has not pre-fetched `quoteSignature` + `depositAddress`.
 * 3. Delegates settlement to `handleSendPayment` and releases the reserved USD
 *    spend if settlement does not succeed (HTTP 201).
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

  const auth = await authorizeAgentSend(c, agent, {
    recipientHandle,
    asset,
    amount,
    memo,
  });
  if (!auth.allowed) {
    return auth.response;
  }

  try {
    let quoteSignature =
      typeof rawBody?.quoteSignature === 'string' ? rawBody.quoteSignature.trim() : '';
    let depositAddress =
      typeof rawBody?.depositAddress === 'string' ? rawBody.depositAddress.trim() : '';

    if (!quoteSignature || !depositAddress) {
      const quoteReq = new Request('https://uprail.internal/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientHandle, asset, amount }),
      });
      const quoteRes = await paymentsRouter.fetch(quoteReq, c.env, c.executionCtx);
      if (!quoteRes.ok) {
        await auth.release();
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
    if (response.status !== 201) {
      await auth.release();
    }
    return response;
  } catch (err) {
    await auth.release();
    throw err;
  }
}

/**
 * POST /api/agent/keys
 * Creates a scoped AI chat key with mandatory USD spend caps. Passkey-gated.
 * The plaintext key (`up_live_...`) is returned once and never stored.
 */
agentRouter.post('/keys', requireAuth(), requirePasskeyAuth(), async (c) => {
  const session = c.get('session')!;
  const body = (c.get('parsedBody' as any) || {}) as KeyBody;

  const name = String(body.name || '').trim().slice(0, MAX_NAME);
  if (!name) {
    return c.json({ error: 'A name for your AI chat is required.', code: 'INVALID_NAME' }, 400);
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
  const days = body.expiresInDays == null || body.expiresInDays === '' ? null : Number(body.expiresInDays);
  if (days !== null && Number.isFinite(days) && days > 0) {
    expiresAt = Date.now() + Math.min(days, MAX_KEY_DAYS) * 86400 * 1000;
  }

  const agentId = crypto.randomUUID();
  const keyId = crypto.randomUUID();
  const { plaintext, hash, prefix } = await generateAgentKey();
  const now = Date.now();
  const perTxLimit = String(perTxUsd);
  const dailyLimit = String(dailyUsd);

  try {
    await c.env.DB.prepare(
      'INSERT INTO agents (id, x_id, name, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(agentId, session.x_id, name, 'autonomous', now, now)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO agent_keys
        (id, agent_id, x_id, label, key_hash, key_prefix, asset, per_tx_limit, daily_limit, allowlist, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)`
    )
      .bind(keyId, agentId, session.x_id, name, hash, prefix, perTxLimit, dailyLimit, expiresAt, now)
      .run();
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
agentRouter.get('/keys', requireAuth(), async (c) => {
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
agentRouter.post('/keys/:id/revoke', requireAuth(), requirePasskeyAuth(), async (c) => {
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
            WHERE (recipient_x_id = ? OR LOWER(recipient_handle) = LOWER(?))
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
         OR LOWER(recipient_handle) = LOWER(?)
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
        ApiKeyQuery: {
          type: 'apiKey',
          in: 'query',
          name: 'key',
          description: 'Or pass your UPRAIL AI Chat key as ?key=up_agent_…',
        },
      },
    },
    security: [{ BearerAuth: [] }, { ApiKeyQuery: [] }],
    paths: {
      '/api/agent/pay': {
        post: {
          operationId: 'sendPayment',
          summary: 'Send a confidential payment to an X @handle',
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
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Payment sent and escrowed for recipient' },
            '403': { description: 'Blocked by USD spend limit' },
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
              schema: { type: 'string', default: 'USDC' },
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
