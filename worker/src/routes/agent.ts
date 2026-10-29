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
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/session';
import { requirePasskeyAuth } from '../middleware/passkeyAuth';
import {
  requireAgent,
  authorizeAgentSend,
  authorizeAgentWithdrawal,
  reserveAgentBudget,
} from '../middleware/agentAuth';
import {
  agentUsdValue,
  evaluateAgentSpendPolicy,
  isValidAgentHandle,
} from '../services/agentPolicy';
import { resolveOrigin } from '../services/webauthnConfig';
import {
  generateAgentKey,
  currentUtcDay,
  parseAgentUsdLimit,
  AGENT_DEFAULT_PER_TX_USD,
  AGENT_DEFAULT_DAILY_USD,
  AGENT_MAX_NAME_LENGTH,
} from '../services/agentKeys';
import { getAuthorizationServer } from '../oauth/authorization';
import {
  claimAgentRequest,
  completeAgentRequest,
  failAgentRequest,
  normalizeIdempotencyKey,
} from '../services/agentRequests';
import { paymentsRouter, handleSendPayment } from './payments';
import { handleWithdraw } from './claim';
import * as nearRpc from '../services/nearRpc';
import {
  getConfidentialAvailableBalance,
  isConfidentialRailEnabled,
} from '../services/confidentialRail';

export const agentRouter = new Hono<AppContext>();

agentRouter.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

const MAX_NAME = AGENT_MAX_NAME_LENGTH;
const MAX_KEY_DAYS = 365;
const DEFAULT_PER_TX_USD = AGENT_DEFAULT_PER_TX_USD;
const DEFAULT_DAILY_USD = AGENT_DEFAULT_DAILY_USD;

interface KeyBody {
  name?: string;
  mode?: string | null;
  asset?: string | null;
  allowlist?: unknown;
  perTxLimit?: number | string | null;
  dailyLimit?: number | string | null;
  expiresInDays?: number | string | null;
}

function shouldReleaseAgentSpend(status: number, code?: string): boolean {
  if (status >= 400 && status < 500) return true;
  return code === 'PAYMENT_RECORD_FAILED' || code === 'SEND_PAYMENT_ERROR';
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

export interface ParsedAgentRecipient {
  handle: string;
  amount: string;
}

export function parseAgentRecipients(rawBody: Record<string, any>): ParsedAgentRecipient[] {
  const defaultAmount = String(rawBody?.amount ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');

  if (Array.isArray(rawBody?.recipients) && rawBody.recipients.length > 0) {
    const list: ParsedAgentRecipient[] = [];
    for (const item of rawBody.recipients) {
      if (typeof item === 'string') {
        const h = item.trim().replace(/^@+/, '');
        if (h) list.push({ handle: h, amount: defaultAmount });
      } else if (item && typeof item === 'object') {
        const h = String(item.recipientHandle || item.handle || item.recipient || '')
          .trim()
          .replace(/^@+/, '');
        const a = String(item.amount ?? defaultAmount)
          .trim()
          .replace(/^["']|["']$/g, '');
        if (h) list.push({ handle: h, amount: a });
      }
    }
    if (list.length > 0) return list;
  }

  const rawTarget = rawBody?.recipientHandle ?? rawBody?.recipient ?? rawBody?.handle;
  if (Array.isArray(rawTarget)) {
    return rawTarget
      .map((t) => String(t || '').trim().replace(/^@+/, ''))
      .filter(Boolean)
      .map((handle) => ({ handle, amount: defaultAmount }));
  }

  const rawStr = String(rawTarget || '').trim();
  if (rawStr.includes(',') || rawStr.includes(';') || (rawStr.includes(' ') && rawStr.includes('@'))) {
    const parts = rawStr
      .split(/[,;\s]+/)
      .map((s) => s.trim().replace(/^@+/, ''))
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.map((handle) => ({ handle, amount: defaultAmount }));
    }
  }

  const single = rawStr.replace(/^@+/, '');
  return single ? [{ handle: single, amount: defaultAmount }] : [];
}

export async function executeAgentPay(
  c: Context<AppContext>,
  rawBody: Record<string, any>
): Promise<Response> {
  const agent = c.get('agent')!;
  const recipients = parseAgentRecipients(rawBody);
  const asset = String(rawBody?.asset || rawBody?.token || '').trim();
  const memo = typeof rawBody?.memo === 'string' ? rawBody.memo.trim() : undefined;

  if (recipients.length === 0 || !asset) {
    return c.json(
      {
        error: 'recipientHandle, asset, and a positive amount are required.',
        code: 'INVALID_REQUEST',
      },
      400
    );
  }

  for (const r of recipients) {
    if (!isValidAgentHandle(r.handle)) {
      return c.json(
        {
          error:
            'AI chat payments go to X handles only (e.g. @alice). Use the withdrawal tool for a wallet address.',
          code: 'AGENT_POLICY_DENIED',
          reason: 'recipient_not_handle',
        },
        403
      );
    }
    const parsedAmt = parseFloat(r.amount);
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      return c.json(
        {
          error: `Invalid amount: "${r.amount}". A positive number is required.`,
          code: 'INVALID_REQUEST',
        },
        400
      );
    }
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

  // Evaluate total USD value and spend guardrails
  const recipientsWithUsd: Array<{ handle: string; amount: string; amountNum: number; usd: number | null }> = [];
  let totalUsd = 0;
  let hasUnpriced = false;
  for (const r of recipients) {
    const amountNum = parseFloat(r.amount);
    const usd = await agentUsdValue(c.env, asset, amountNum);
    if (usd === null) hasUnpriced = true;
    else totalUsd += usd;
    recipientsWithUsd.push({ handle: r.handle, amount: r.amount, amountNum, usd });
  }

  const perTxLimit = agent.per_tx_limit_usd ?? 0;
  const dailyLimit = agent.daily_limit_usd ?? 0;

  // Check against remaining daily limit
  const today = new Date().toISOString().slice(0, 10);
  const spendRow = await c.env.DB.prepare(
    'SELECT spent FROM agent_spend WHERE agent_key_id = ? AND day = ?'
  )
    .bind(agent.key_id, today)
    .first<{ spent?: string }>();
  const currentSpent = parseFloat(spendRow?.spent || '0') || 0;
  const remainingDaily = Math.max(0, dailyLimit - currentSpent);

  const exceedsPerTx =
    perTxLimit > 0 &&
    (totalUsd > perTxLimit + 1e-9 ||
      recipientsWithUsd.some((r) => (r.usd ?? 0) > perTxLimit + 1e-9));
  const exceedsDaily = dailyLimit > 0 && totalUsd > remainingDaily + 1e-9;

  // Guardrail limits exceeded -> create instant passkey authorization for multiple accounts (or explicit approval)
  if (exceedsPerTx || exceedsDaily || hasUnpriced) {
    await markFailed();
    const reason = exceedsDaily ? 'daily_limit' : exceedsPerTx ? 'per_tx_limit' : 'unpriced_asset';
    const limitUsd = exceedsDaily ? remainingDaily : perTxLimit;

    if (recipients.length > 1 || rawBody?.requestApproval === true) {
      const approvalId = `appr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const now = Date.now();
      const expiresAt = now + 15 * 60 * 1000;
      const payload = JSON.stringify({
        asset,
        recipients: recipientsWithUsd.map((r) => ({
          recipientHandle: r.handle,
          amount: r.amount,
          usd: r.usd,
        })),
        totalAmount: recipientsWithUsd
          .reduce((sum, r) => sum + r.amountNum, 0)
          .toFixed(6)
          .replace(/\.?0+$/, ''),
        totalUsd,
        memo,
        agentName: agent.label || 'AI Agent',
        exceededReason: reason,
        limitUsd,
      });

      await c.env.DB.prepare(
        `INSERT INTO agent_approvals (id, x_id, agent_key_id, payload, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`
      )
        .bind(approvalId, agent.x_id, agent.key_id, payload, now, expiresAt)
        .run();

      const appOrigin = resolveOrigin(c.env);
      const approvalUrl = `${appOrigin}/approve?id=${approvalId}`;

      return c.json(
        {
          status: 'REQUIRES_PASSKEY_APPROVAL',
          code: 'APPROVAL_REQUIRED',
          approvalId,
          approvalUrl,
          expiresAt,
          totalUsd: Number(totalUsd.toFixed(2)),
          recipients: recipientsWithUsd.map((r) => ({
            recipientHandle: `@${r.handle}`,
            amount: r.amount,
            asset,
          })),
          message: `This batch payment (${recipientsWithUsd.length} accounts, ~$${totalUsd.toFixed(2)}) exceeds your spend guardrail. Please sign with your Passkey to authorize: ${approvalUrl}`,
        },
        403
      );
    }

    // Single recipient standard policy denial
    const errorMsg = exceedsDaily
      ? `This transfer (~$${totalUsd.toFixed(2)}) exceeds your remaining daily limit ($${remainingDaily.toFixed(2)} left of $${dailyLimit}).`
      : exceedsPerTx
      ? `This transfer (~$${totalUsd.toFixed(2)}) exceeds your per-transaction limit ($${perTxLimit}).`
      : `Cannot calculate USD value for asset "${asset}". Set a price or use USDC/USDT/NEAR.`;

    return c.json(
      {
        error: errorMsg,
        code: 'AGENT_POLICY_DENIED',
        reason,
        perTxLimitUsd: perTxLimit,
        dailyLimitUsd: dailyLimit,
        totalUsd: Number(totalUsd.toFixed(2)),
      },
      403
    );
  }

  // Within limits: atomically reserve totalUsd
  const auth = await reserveAgentBudget(c, agent, totalUsd);
  if (!auth.allowed) {
    await markFailed();
    return auth.response;
  }

  try {
    if (recipients.length === 1) {
      const r = recipients[0];
      const singleRes = await executeSingleSend(c, r.handle, asset, r.amount, memo, rawBody);
      const payload = (await singleRes.clone().json().catch(() => null)) as any;
      const code = typeof payload?.code === 'string' ? payload.code : undefined;

      if (singleRes.status === 201) {
        if (idempotencyKey && payload?.paymentId) {
          await completeAgentRequest(c.env, agent.key_id, idempotencyKey, payload.paymentId);
        }
      } else if (shouldReleaseAgentSpend(singleRes.status, code)) {
        await auth.release();
        await markFailed();
      } else {
        await markUnknown();
      }
      return singleRes;
    }

    const results: any[] = [];
    for (const r of recipients) {
      const singleRes = await executeSingleSend(c, r.handle, asset, r.amount, memo, {});
      if (singleRes.status !== 201) {
        const errJson = (await singleRes.json().catch(() => ({}))) as any;
        await auth.release();
        await markFailed();
        return c.json(
          {
            error: errJson.error || `Payment to @${r.handle} failed.`,
            code: 'BATCH_SEND_ERROR',
            partialResults: results,
          },
          singleRes.status as any
        );
      }
      const data = (await singleRes.json()) as any;
      results.push({
        recipientHandle: r.handle,
        amount: r.amount,
        asset,
        paymentId: data.paymentId,
        shareLink: data.shareLink,
        claimLink: data.claimLink || data.shareLink,
        xShareUrl: data.xShareUrl,
        tweetIntentUrl: data.tweetIntentUrl,
        status: data.status,
      });
    }

    if (idempotencyKey && results[0]?.paymentId) {
      await completeAgentRequest(c.env, agent.key_id, idempotencyKey, results[0].paymentId);
    }

    return c.json(
      {
        status: 'CLAIMED',
        success: true,
        asset,
        totalSent: results.length,
        payments: results,
        shareLinks: results.map((p) => p.shareLink).filter(Boolean),
        message:
          `Payments delivered to ${results.length} accounts! Links to share:\n` +
          results.map((p) => `@${p.recipientHandle}: ${p.shareLink}`).join('\n'),
      },
      201
    );
  } catch (err) {
    await markUnknown();
    throw err;
  }
}

async function executeSingleSend(
  c: Context<AppContext>,
  recipientHandle: string,
  asset: string,
  rawAmount: string,
  memo: string | undefined,
  rawBody: Record<string, any>
): Promise<Response> {
  let quoteSignature =
    typeof rawBody?.quoteSignature === 'string' ? rawBody.quoteSignature.trim() : '';
  let depositAddress =
    typeof rawBody?.depositAddress === 'string' ? rawBody.depositAddress.trim() : '';

  if (!quoteSignature || !depositAddress) {
    const quoteReq = new Request('https://uprail.internal/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientHandle, asset, amount: rawAmount }),
    });
    const quoteRes = await paymentsRouter.fetch(quoteReq, c.env, c.executionCtx);
    if (!quoteRes.ok) {
      const errData = (await quoteRes.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      return new Response(
        JSON.stringify({
          error: errData.error || 'Failed to prepare payment quote.',
          code: errData.code || 'QUOTE_FAILED',
        }),
        { status: quoteRes.status, headers: { 'Content-Type': 'application/json' } }
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
    amount: rawAmount,
    memo,
    quoteSignature,
    depositAddress,
  });

  return await handleSendPayment(c);
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
  const destinationAddress = String(
    rawBody?.destinationAddress || rawBody?.address || rawBody?.recipient || ''
  ).trim();
  const destinationChain =
    String(rawBody?.destinationChain || rawBody?.chain || '')
      .trim()
      .toLowerCase() || undefined;
  const asset = String(rawBody?.asset || rawBody?.token || 'usdc').trim().toLowerCase();
  const amountStr = String(rawBody?.amount ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');

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

async function listAllOAuthGrants(env: Env, xId: string): Promise<any[]> {
  const oauth = getAuthorizationServer(env).getOAuthApi(env);
  const grants: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(xId, { limit: 100, cursor });
    grants.push(...(page.items || []));
    cursor = page.cursor;
  } while (cursor);
  return grants;
}

async function revokeOAuthGrantsForAgentKey(
  env: Env,
  xId: string,
  agentKeyId: string
): Promise<number> {
  const oauth = getAuthorizationServer(env).getOAuthApi(env);
  const grants = await listAllOAuthGrants(env, xId);
  const matching = grants.filter((grant) => grant?.metadata?.agentKeyId === agentKeyId);
  for (const grant of matching) {
    await oauth.revokeGrant(grant.id, xId);
  }
  return matching.length;
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

  const perTxUsd = parseAgentUsdLimit(body.perTxLimit, DEFAULT_PER_TX_USD);
  const dailyUsd = parseAgentUsdLimit(body.dailyLimit, DEFAULT_DAILY_USD);
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
            k.auth_method, k.oauth_client_id, k.oauth_client_name,
            a.name
       FROM agent_keys k
       JOIN agents a ON a.id = k.agent_id
      WHERE k.x_id = ?
      ORDER BY k.created_at DESC`
  )
    .bind(session.x_id)
    .all<any>();

  let grantsByKey = new Map<string, any>();
  if ((results || []).some((row) => row.auth_method === 'oauth')) {
    try {
      const grants = await listAllOAuthGrants(c.env, session.x_id);
      grantsByKey = new Map(
        grants
          .filter((grant) => typeof grant?.metadata?.agentKeyId === 'string')
          .map((grant) => [grant.metadata.agentKeyId as string, grant])
      );
    } catch (err) {
      console.warn('[agent] OAuth grant lookup failed:', err);
    }
  }

  const now = Date.now();
  const keys = (results || []).map((row): any => {
    const grant = grantsByKey.get(row.id);
    const expiresAtMs = row.expires_at ? Number(row.expires_at) : null;
    const expired = Boolean(expiresAtMs && expiresAtMs < now);
    const grantExpired = Boolean(grant?.expiresAt && grant.expiresAt * 1000 < now);
    const connectionStatus = row.revoked_at
      ? 'revoked'
      : expired || grantExpired
        ? 'expired'
        : row.auth_method === 'oauth' && !grant
          ? 'disconnected'
          : 'active';
    return {
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
      authMethod: row.auth_method === 'oauth' ? 'oauth' : 'key',
      oauthClientId: row.oauth_client_id,
      oauthClientName: row.oauth_client_name,
      oauthGrantId: grant?.id ?? null,
      oauthConnectedAt: grant?.createdAt ? grant.createdAt * 1000 : null,
      connectionStatus,
    };
  });

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
  const key = await c.env.DB.prepare(
    'SELECT auth_method FROM agent_keys WHERE id = ? AND x_id = ?'
  )
    .bind(id, session.x_id)
    .first<{ auth_method: 'key' | 'oauth' }>();
  if (!key) {
    return c.json({ error: 'Key not found.', code: 'AGENT_KEY_NOT_FOUND' }, 404);
  }

  const result = await c.env.DB.prepare(
    'UPDATE agent_keys SET revoked_at = ? WHERE id = ? AND x_id = ? AND revoked_at IS NULL'
  )
    .bind(Date.now(), id, session.x_id)
    .run();

  let oauthGrantsRevoked = 0;
  if (key.auth_method === 'oauth') {
    try {
      oauthGrantsRevoked = await revokeOAuthGrantsForAgentKey(c.env, session.x_id, id);
    } catch (err) {
      console.warn('[agent] OAuth grant revoke failed (D1 key is already revoked):', err);
    }
  }
  return c.json({ id, revoked: true, oauthGrantsRevoked });
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
    'SELECT agent_id, revoked_at, expires_at, auth_method FROM agent_keys WHERE id = ? AND x_id = ?'
  )
    .bind(id, session.x_id)
    .first<{
      agent_id: string;
      revoked_at: number | null;
      expires_at: number | null;
      auth_method: 'key' | 'oauth';
    }>();

  if (!key) {
    return c.json({ error: 'Key not found.', code: 'AGENT_KEY_NOT_FOUND' }, 404);
  }
  const now = Date.now();
  let dead = Boolean(key.revoked_at) || Boolean(key.expires_at && key.expires_at < now);
  if (!dead && key.auth_method === 'oauth') {
    try {
      const grants = await listAllOAuthGrants(c.env, session.x_id);
      const grant = grants.find((item) => item?.metadata?.agentKeyId === id);
      const grantExpired = Boolean(grant?.expiresAt && grant.expiresAt * 1000 < now);
      if (!grant || grantExpired) dead = true;
    } catch (err) {
      console.warn('[agent] OAuth grant check before delete failed:', err);
    }
  }
  if (!dead) {
    return c.json(
      {
        error: 'Revoke this key before deleting it.',
        code: 'AGENT_KEY_NOT_REVOKED',
      },
      409
    );
  }

  if (key.auth_method === 'oauth') {
    try {
      await revokeOAuthGrantsForAgentKey(c.env, session.x_id, id);
    } catch (err) {
      console.warn('[agent] OAuth grant cleanup failed before delete:', err);
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM agent_spend WHERE agent_key_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM agent_requests WHERE agent_key_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM agent_approvals WHERE agent_key_id = ?').bind(id),
    c.env.DB.prepare(
      `DELETE FROM agent_keys
        WHERE id = ? AND x_id = ?
          AND (? = 1 OR revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < ?))`
    ).bind(id, session.x_id, dead ? 1 : 0, now),
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
    let confidential = 0;
    if (isConfidentialRailEnabled(c.env)) {
      try {
        confidential = await getConfidentialAvailableBalance(c.env, session.x_id, asset);
      } catch (confErr) {
        console.warn('[agent] confidential balance lookup skipped:', confErr);
      }
    }
    return c.json({
      handle: `@${session.x_handle}`,
      asset,
      available,
      confidential,
      total: available + confidential,
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
         OR (
           (recipient_x_id = ? OR (recipient_x_id IS NULL AND LOWER(recipient_handle) = LOWER(?)))
           AND status NOT IN ('PENDING', 'DEPOSIT_WAITING', 'CANCELLED')
         )
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
            'Get your UPRAIL @handle, view pending incoming payments, or generate a confidential deposit address for any chain',
          description:
            'When the confidential rail is enabled, generated deposit addresses settle into Confidential Intents.',
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
          summary: 'Check public and confidential UPRAIL balances for a token',
          description:
            'Returns available (public Intents/plain/virtual), confidential, and total spendable balance. Confidential is included when the private rail is enabled.',
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
            '200': {
              description: 'Available public and confidential token balance',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      handle: { type: 'string' },
                      asset: { type: 'string' },
                      available: {
                        type: 'number',
                        description: 'Public Intents/plain/virtual balance',
                      },
                      confidential: {
                        type: 'number',
                        description: 'Confidential Intents balance',
                      },
                      total: {
                        type: 'number',
                        description: 'available + confidential',
                      },
                    },
                  },
                },
              },
            },
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
