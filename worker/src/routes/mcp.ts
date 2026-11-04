/**
 * Model Context Protocol (MCP) server for UP (UPRAIL.app).
 *
 * Implemented as a JSON-RPC 2.0 server over Streamable HTTP: a single POST
 * endpoint that accepts `initialize`, `tools/list`, and `tools/call`. Requests
 * authenticate with the same Bearer AI chat key (`up_agent_...`) as `/api/agent/*`,
 * enforcing the owner's USD spend caps on every payment.
 *
 * Tools:
 *  - pay_handle        — Send a confidential payment to any X @handle
 *  - withdraw_to_wallet — Send funds from the vault to an external wallet address
 *  - receive_payment   — Get your @handle, pending incoming payments, or a fresh deposit address
 *  - get_balance       — Check your available UPRAIL balance
 *  - list_payments     — View recent sent and received payments
 *  - resolve_handle    — Check if an X @handle has activated UPRAIL
 */

import { Context, Hono } from 'hono';
import type { AgentPrincipal, AppContext, Env, Session } from '../types';
import { requireAgent } from '../middleware/agentAuth';
import { executeAgentPay, executeAgentWithdraw } from './agent';
import { publicErrorMessage } from '../utils/errors';
import * as nearRpc from '../services/nearRpc';
import {
  getConfidentialAvailableBalance,
  getConfidentialBalances,
  isConfidentialRailEnabled,
} from '../services/confidentialRail';
import { resolveOrigin } from '../services/webauthnConfig';

export const mcpRouter = new Hono<AppContext>();

mcpRouter.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'uprail', version: '1.0.0' };

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

const TOOLS = [
  {
    name: 'pay_handle',
    description:
      'Send a confidential payment to one or more X (Twitter) handles on UPRAIL. If the payment completes, ALWAYS display the returned claimLink / shareLink and xShareUrl so the user can share it on X/Twitter. If the payment requires passkey approval (status: REQUIRES_PASSKEY_APPROVAL), you MUST display the clickable markdown link [Confirm & Authorize with Passkey](approvalUrl) so the user can tap to approve with Touch ID / Face ID. IMPORTANT: Never retry with a modified idempotencyKey if a call fails or times out; if retryable is false or the outcome is uncertain, call list_payments first to verify whether the payment already went through.',
    inputSchema: {
      type: 'object',
      properties: {
        recipientHandle: {
          type: 'string',
          description:
            'Recipient X handle(s). Can be a single handle (e.g. "@alice"), comma-separated handles (e.g. "@alice, @bob"), or an array of handles.',
        },
        recipients: {
          type: 'array',
          description:
            'Optional array of recipient handles (e.g. ["@alice", "@bob"]) or recipient objects ({ recipientHandle, amount }).',
          items: {
            type: ['string', 'object'],
          },
        },
        asset: {
          type: 'string',
          description: 'Asset symbol, e.g. USDC, USDT, NEAR',
        },
        amount: {
          type: ['string', 'number'],
          description: 'Human-readable token amount to send per recipient (or default amount)',
        },
        memo: {
          type: 'string',
          description: 'Optional note attached to the payment',
        },
        idempotencyKey: {
          type: 'string',
          description:
            'Optional unique key. Retrying with the same key never sends a second payment. Never invent a new key when retrying the same user request.',
        },
      },
      required: ['asset', 'amount'],
    },
  },
  {
    name: 'check_approval',
    description:
      'Check the status of an instant passkey payment authorization request (created when a payment exceeds guardrail limits). If approved by the user, returns confirmed payment details and share links.',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: {
          type: 'string',
          description: 'The approval ID returned by pay_handle (e.g. appr_...)',
        },
      },
      required: ['approvalId'],
    },
  },
  {
    name: 'withdraw_to_wallet',
    description:
      'Withdraw funds from your confidential UPRAIL vault to an external wallet address. Subject to the key’s per-payment and daily USD spend caps. Requires an explicit amount; “all” is not accepted. Never retry with a modified idempotencyKey if a call fails or times out.',
    inputSchema: {
      type: 'object',
      properties: {
        destinationAddress: {
          type: 'string',
          description: 'Destination wallet address (EVM, Solana, Bitcoin, NEAR, or another supported chain)',
        },
        asset: {
          type: 'string',
          description: 'Asset symbol, e.g. USDC, USDT, NEAR, ETH, SOL, BTC',
        },
        amount: {
          type: ['string', 'number'],
          description: 'Explicit human-readable token amount to withdraw',
        },
        chain: {
          type: 'string',
          description: 'Optional destination network, e.g. base, ethereum, arbitrum, solana, bitcoin, near',
        },
        idempotencyKey: {
          type: 'string',
          description:
            'Optional unique key. Retrying with the same key never sends a second withdrawal. Never invent a new key when retrying the same user request.',
        },
      },
      required: ['destinationAddress', 'asset', 'amount'],
    },
  },
  {
    name: 'receive_payment',
    description:
      'Get your UPRAIL @handle for receiving payments, check pending incoming payments, or generate a single-use confidential deposit address to receive crypto from any external blockchain.',
    inputSchema: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description:
            'Optional blockchain to generate a deposit address for (near, base, ethereum, arbitrum, solana, bitcoin)',
        },
        token: {
          type: 'string',
          description: 'Optional token symbol for the deposit (e.g. USDC, USDT, NEAR, SOL, ETH)',
        },
        amount: {
          type: ['string', 'number'],
          description: 'Optional expected deposit amount',
        },
      },
    },
  },
  {
    name: 'get_balance',
    description:
      "Read the owner's available UPRAIL token balances. If asset is omitted or 'all', returns balances for all held tokens (USDC, NEAR, USDT, etc.).",
    inputSchema: {
      type: 'object',
      properties: {
        asset: {
          type: 'string',
          description:
            'Optional asset symbol, e.g. USDC, USDT, or NEAR. Omit or pass "all" to list all balances.',
        },
      },
    },
  },
  {
    name: 'list_payments',
    description: "List the owner's recent sent and received payments on UPRAIL.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'resolve_handle',
    description: 'Check whether an X @handle is registered on UPRAIL and resolve its account.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'X handle, with or without @' },
      },
      required: ['handle'],
    },
  },
  {
    name: 'list_contacts',
    description: "List the owner's saved contacts ('People you pay') and frequent transfer recipients, including nicknames, pinned status, and preferred assets.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'save_contact',
    description: "Save, update, or pin a trusted contact in the owner's 'People you pay' list.",
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'X handle (with or without @)' },
        nickname: { type: 'string', description: 'Optional friendly nickname' },
        preferredAsset: { type: 'string', description: 'Optional preferred asset symbol (e.g. USDC, NEAR)' },
        preferredAmount: { type: ['string', 'number'], description: 'Optional default transfer amount' },
        isPinned: { type: 'boolean', description: 'Whether to pin this contact to the top' },
      },
      required: ['handle'],
    },
  },
  {
    name: 'request_payment',
    description: 'Create a UPRAIL payment request asking an X @handle for money. Returns the request ID, share link, and tweet text. The recipient can view, accept, or decline voluntarily.',
    inputSchema: {
      type: 'object',
      properties: {
        requestedHandle: { type: 'string', description: 'Target X handle to request money from (with or without @)' },
        asset: { type: 'string', description: 'Asset symbol, e.g. USDC, USDT, NEAR' },
        amount: { type: ['string', 'number'], description: 'Human-readable token amount requested' },
        memo: { type: 'string', description: 'Optional note or reason for the request' },
        expiresInDays: { type: 'number', description: 'Days until expiry (1 to 30, default 7)' },
      },
      required: ['requestedHandle', 'asset', 'amount'],
    },
  },
  {
    name: 'list_requests',
    description: "List the owner's incoming and/or outgoing payment requests on UPRAIL.",
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['incoming', 'outgoing', 'all'],
          description: "Filter direction: 'incoming' (requests sent to owner), 'outgoing' (requests created by owner), or 'all'. Default is 'all'.",
        },
      },
    },
  },
  {
    name: 'accept_request',
    description: 'Accept and pay an incoming UPRAIL payment request using vault funds. Executes a payment bounded by agent spend caps, marks the request as COMPLETED, and returns settlement proof.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'The payment request ID (e.g. req_...)' },
        idempotencyKey: { type: 'string', description: 'Optional idempotency key to prevent double payment' },
      },
      required: ['requestId'],
    },
  },
  {
    name: 'decline_request',
    description: 'Decline an incoming UPRAIL payment request.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'The payment request ID (e.g. req_...)' },
        reason: { type: 'string', description: 'Optional decline reason' },
      },
      required: ['requestId'],
    },
  },
];

function rpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

/** Wraps a tool's JSON output in an MCP tool result. */
function toolText(value: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

async function callTool(c: Context<AppContext>, name: string, args: any): Promise<unknown> {
  const session = c.get('session')!;

  switch (name) {
    case 'resolve_handle': {
      const raw = String(args?.handle || '').trim().replace(/^@/, '');
      if (!raw) return toolText({ error: 'handle is required.' }, true);
      const row = await c.env.DB.prepare(
        `SELECT x_handle, x_name, near_account, is_activated
           FROM x_identities WHERE lower(x_handle) = lower(?)`
      )
        .bind(raw)
        .first<any>();
      if (!row) return toolText({ handle: raw, exists: false });
      return toolText({
        handle: row.x_handle,
        exists: true,
        name: row.x_name,
        nearAccount: row.near_account,
        isActivated: Boolean(row.is_activated),
      });
    }

    case 'get_balance': {
      const requestedAsset = args?.asset ? String(args.asset).trim() : null;
      if (requestedAsset && requestedAsset.toLowerCase() !== 'all') {
        const balance = await nearRpc.getUserAvailableBalance(c.env, session, requestedAsset);
        return toolText({
          handle: `@${session.x_handle}`,
          asset: requestedAsset.toUpperCase(),
          balance: Number(balance.toFixed(6)),
          available: Number(balance.toFixed(6)),
        });
      }

      // If no specific asset was requested (or 'all'), return all held assets
      const assetSet = new Set<string>(['USDC', 'NEAR', 'USDT']);
      if (isConfidentialRailEnabled(c.env)) {
        try {
          const confList = await getConfidentialBalances(c.env, session.x_id);
          for (const cb of confList) {
            if (parseFloat(cb.amountFormatted || '0') > 0 && cb.symbol) {
              assetSet.add(cb.symbol.toUpperCase());
            }
          }
        } catch (err) {
          console.warn('[mcp] confidential balances lookup skipped:', err);
        }
      }
      if (c.env.DB) {
        try {
          const deltas = await nearRpc.getVirtualBalanceDeltas(c.env, session);
          for (const [sym, amt] of Object.entries(deltas)) {
            if (amt > 0) assetSet.add(sym.toUpperCase());
          }
        } catch {}
      }

      const balances = await Promise.all(
        Array.from(assetSet).map(async (asset) => {
          let balance = 0;
          try {
            balance = await nearRpc.getUserAvailableBalance(c.env, session, asset);
          } catch {}
          const rounded = Number(balance.toFixed(6));
          return {
            asset,
            balance: rounded,
            available: rounded,
          };
        })
      );

      const nonZeroOrStandard = balances.filter(
        (b) => ['USDC', 'NEAR', 'USDT'].includes(b.asset) || b.balance > 0
      );

      return toolText({
        handle: `@${session.x_handle}`,
        balances: nonZeroOrStandard,
      });
    }

    case 'pay_handle': {
      const response = await executeAgentPay(c, {
        recipientHandle: args?.recipientHandle ?? args?.recipient ?? args?.handle,
        recipients: args?.recipients,
        asset: args?.asset ?? args?.token,
        amount: args?.amount,
        memo: args?.memo,
        idempotencyKey: args?.idempotencyKey,
        requestApproval: args?.requestApproval !== false,
      });
      const payload = (await response.json().catch(() => ({}))) as any;
      const isError =
        response.status !== 201 &&
        response.status !== 200 &&
        payload?.status !== 'REQUIRES_PASSKEY_APPROVAL';
      return toolText(payload, isError);
    }

    case 'check_approval': {
      const approvalId = String(args?.approvalId || '').trim();
      if (!approvalId) return toolText({ error: 'approvalId is required.' }, true);
      const row = await c.env.DB.prepare(
        'SELECT id, x_id, agent_key_id, payload, status, result, created_at, expires_at, decided_at FROM agent_approvals WHERE id = ?'
      )
        .bind(approvalId)
        .first<any>();
      if (!row) return toolText({ error: 'Approval request not found.', status: 'NOT_FOUND' }, true);

      let payloadData: any = {};
      try {
        payloadData = JSON.parse(row.payload);
      } catch {}

      let resultData: any = null;
      if (row.result) {
        try {
          resultData = JSON.parse(row.result);
        } catch {}
      }

      const appOrigin = resolveOrigin(c.env);
      if (row.status === 'APPROVED' && resultData) {
        return toolText({
          status: 'APPROVED',
          approvalId: row.id,
          decidedAt: row.decided_at,
          ...resultData,
          message:
            'Payment has been approved and delivered with the user’s Passkey! Share links:\n' +
            (resultData.shareLinks || []).join('\n'),
        });
      }

      return toolText({
        status: row.status,
        approvalId: row.id,
        approvalUrl: `${appOrigin}/approve?id=${row.id}`,
        expiresAt: row.expires_at,
        isExpired: row.expires_at < Date.now(),
        decidedAt: row.decided_at,
        request: payloadData,
        message:
          row.status === 'PENDING'
            ? `Approval is still pending. The user can sign with their Passkey at: ${appOrigin}/approve?id=${row.id}`
            : `Approval status: ${row.status}`,
      });
    }

    case 'withdraw_to_wallet': {
      const response = await executeAgentWithdraw(c, {
        destinationAddress:
          args?.destinationAddress ?? args?.address ?? args?.recipient ?? args?.to,
        destinationChain: args?.chain ?? args?.destinationChain,
        asset: args?.asset ?? args?.token,
        amount: args?.amount,
        idempotencyKey: args?.idempotencyKey,
      });
      const payload = await response.json().catch(() => ({}));
      return toolText(payload, !response.ok);
    }

    case 'receive_payment': {
      const chain = String(args?.chain || '').trim().toLowerCase();
      const token = String(args?.token || '').trim().toUpperCase() || undefined;
      const amount =
        args?.amount !== undefined && args?.amount !== null && String(args.amount).trim() !== ''
          ? String(args.amount).trim()
          : undefined;

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
          return toolText(
            {
              error: `Could not generate a deposit address for chain "${chain}"${token ? ` (${token})` : ''}.`,
              code: 'NO_DEPOSIT_ADDRESS',
            },
            true
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

      return toolText({
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
          : `Anyone on UPRAIL can pay @${session.x_handle} directly by X handle, or pass chain (near, base, ethereum, arbitrum, solana, bitcoin) and token (e.g. USDC) to generate a cross-chain deposit address.`,
      });
    }

    case 'list_payments': {
      const { results } = await c.env.DB.prepare(
        `SELECT id, sender_x_id, sender_x_handle, recipient_handle, asset, amount, memo, status, created_at, expires_at
           FROM payments
          WHERE sender_x_id = ?
             OR (
               (recipient_x_id = ? OR (recipient_x_id IS NULL AND LOWER(recipient_handle) = LOWER(?)))
               AND status NOT IN ('PENDING', 'DEPOSIT_WAITING', 'CANCELLED')
             )
          ORDER BY created_at DESC
          LIMIT 25`
      )
        .bind(session.x_id, session.x_id, session.x_handle)
        .all<any>();

      const appOrigin = resolveOrigin(c.env);
      const payments = (results || []).map((row) => {
        const recipientHandle = `@${String(row.recipient_handle || '').replace(/^@/, '')}`;
        const shareLink = `${appOrigin}/claim/${row.id}`;
        return {
          id: row.id,
          direction: row.sender_x_id === session.x_id ? 'sent' : 'received',
          senderHandle: row.sender_x_handle ? `@${row.sender_x_handle}` : null,
          recipientHandle,
          asset: row.asset,
          amount: row.amount,
          memo: row.memo || null,
          status: row.status,
          shareLink,
          claimLink: shareLink,
          xShareUrl: `https://x.com/intent/post?text=${encodeURIComponent(`Hey ${recipientHandle}, I sent you ${row.amount} ${row.asset} on UPRAIL: ${shareLink}`)}`,
          created_at: row.created_at,
          expires_at: row.expires_at,
        };
      });
      return toolText({ payments });
    }

    case 'list_contacts': {
      if (!c.env.DB) return toolText({ contacts: [] });
      const saved = await c.env.DB.prepare(
        `SELECT * FROM contacts WHERE user_x_id = ? ORDER BY is_pinned DESC, updated_at DESC LIMIT 50`
      )
        .bind(session.x_id)
        .all<any>();
      return toolText({ contacts: saved.results || [] });
    }

    case 'save_contact': {
      const rawHandle = String(args?.handle || args?.contactHandle || '').trim().replace(/^@+/, '').toLowerCase();
      if (!rawHandle) return toolText({ error: 'Valid handle is required.' }, true);
      if (!c.env.DB) return toolText({ error: 'Database unavailable' }, true);

      const id = `cnt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const now = Date.now();
      const isPinned = args?.isPinned === true || args?.is_pinned === true ? 1 : 0;

      await c.env.DB.prepare(
        `INSERT INTO contacts (id, user_x_id, contact_handle, nickname, preferred_amount, preferred_asset, is_pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_x_id, contact_handle) DO UPDATE SET
           nickname = COALESCE(excluded.nickname, contacts.nickname),
           preferred_amount = COALESCE(excluded.preferred_amount, contacts.preferred_amount),
           preferred_asset = COALESCE(excluded.preferred_asset, contacts.preferred_asset),
           is_pinned = excluded.is_pinned,
           updated_at = excluded.updated_at`
      )
        .bind(id, session.x_id, rawHandle, args?.nickname || null, args?.preferredAmount ? String(args.preferredAmount) : null, args?.preferredAsset ? String(args.preferredAsset).toUpperCase() : null, isPinned, now, now)
        .run();

      return toolText({ success: true, handle: `@${rawHandle}`, isPinned: Boolean(isPinned) });
    }

    case 'request_payment': {
      const targetHandle = String(args?.requestedHandle || args?.handle || '').trim().replace(/^@+/, '').toLowerCase();
      const asset = String(args?.asset || 'USDC').trim().toUpperCase();
      const amount = String(args?.amount || '').trim();
      const requesterHandle = String(session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();

      if (!targetHandle) return toolText({ error: 'Valid requestedHandle is required.' }, true);
      if (targetHandle === requesterHandle) return toolText({ error: 'Cannot request money from yourself.' }, true);
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return toolText({ error: 'Amount must be greater than zero.' }, true);

      if (!c.env.DB) return toolText({ error: 'Database unavailable' }, true);

      // Check anti-spam hourly rate limit
      const oneHourAgo = Date.now() - 3600 * 1000;
      const countRow = await c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM payment_requests WHERE requester_x_id = ? AND created_at > ?`
      )
        .bind(session.x_id, oneHourAgo)
        .first<{ count: number }>();

      if (countRow && countRow.count >= 10) {
        return toolText({ error: 'Rate limit: Maximum 10 payment requests per hour.' }, true);
      }

      const id = `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const now = Date.now();
      const days = Math.min(Math.max(Number(args?.expiresInDays) || 7, 1), 30);
      const expiresAt = now + days * 86400 * 1000;
      const memo = typeof args?.memo === 'string' ? args.memo.trim().slice(0, 280) : null;
      const amountFormatted = `${amount} ${asset}`;

      await c.env.DB.prepare(
        `INSERT INTO payment_requests (
          id, requester_x_id, requester_handle, requested_handle, requested_x_id,
          asset, amount, amount_formatted, memo, status, created_at, expires_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'PENDING', ?, ?)`
      )
        .bind(id, session.x_id, requesterHandle, targetHandle, asset, amount, amountFormatted, memo, now, expiresAt)
        .run();

      const appOrigin = resolveOrigin(c.env);
      const requestLink = `${appOrigin}/request/${id}`;
      const tweetText = `Hey @${targetHandle}, don't leave me hanging! 👀 I requested a payment of ${amountFormatted} on UPRAIL. Settle up or decline here: ${requestLink}`;

      return toolText({
        id,
        status: 'PENDING',
        requesterHandle: `@${requesterHandle}`,
        requestedHandle: `@${targetHandle}`,
        asset,
        amount,
        amountFormatted,
        memo,
        requestLink,
        tweetText,
        xShareUrl: `https://x.com/intent/post?text=${encodeURIComponent(tweetText)}`,
        expiresAt,
      });
    }

    case 'list_requests': {
      if (!c.env.DB) return toolText({ requests: [] });
      const direction = String(args?.direction || 'all').toLowerCase();
      const handle = String(session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();

      let query = '';
      if (direction === 'outgoing') {
        query = `SELECT * FROM payment_requests WHERE requester_x_id = ? ORDER BY created_at DESC LIMIT 50`;
      } else if (direction === 'incoming') {
        query = `SELECT * FROM payment_requests WHERE LOWER(requested_handle) = ? OR requested_x_id = ? ORDER BY created_at DESC LIMIT 50`;
      } else {
        query = `SELECT * FROM payment_requests WHERE requester_x_id = ? OR LOWER(requested_handle) = ? ORDER BY created_at DESC LIMIT 50`;
      }

      const { results } = await c.env.DB.prepare(query)
        .bind(direction === 'incoming' ? handle : session.x_id, direction === 'all' ? handle : (direction === 'incoming' ? session.x_id : undefined))
        .all<any>();

      const appOrigin = resolveOrigin(c.env);
      const requests = (results || []).map((r) => ({
        id: r.id,
        direction: r.requester_x_id === session.x_id ? 'outgoing' : 'incoming',
        requesterHandle: `@${r.requester_handle}`,
        requestedHandle: `@${r.requested_handle}`,
        asset: r.asset,
        amount: r.amount,
        amountFormatted: r.amount_formatted,
        memo: r.memo || null,
        status: r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        completedAt: r.completed_at || null,
        requestLink: `${appOrigin}/request/${r.id}`,
      }));

      return toolText({ requests });
    }

    case 'accept_request': {
      const id = String(args?.requestId || '').trim();
      if (!id) return toolText({ error: 'requestId is required.' }, true);
      if (!c.env.DB) return toolText({ error: 'Database unavailable' }, true);

      const req = await c.env.DB.prepare(`SELECT * FROM payment_requests WHERE id = ?`).bind(id).first<any>();
      if (!req) return toolText({ error: 'Request not found.' }, true);

      const currentHandle = String(session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
      const targetHandle = String(req.requested_handle || '').trim().replace(/^@+/, '').toLowerCase();

      if (targetHandle !== currentHandle && req.requested_x_id !== session.x_id) {
        return toolText({ error: 'Unauthorized: This request was sent to a different account.' }, true);
      }

      if (req.status !== 'PENDING') {
        return toolText({ error: `Request cannot be accepted (current status: ${req.status}).` }, true);
      }

      if (req.expires_at && req.expires_at < Date.now()) {
        await c.env.DB.prepare(`UPDATE payment_requests SET status = 'EXPIRED' WHERE id = ?`).bind(id).run();
        return toolText({ error: 'Request has expired.' }, true);
      }

      const response = await executeAgentPay(c, {
        recipientHandle: req.requester_handle,
        asset: req.asset,
        amount: req.amount,
        memo: req.memo ? `Accept: ${req.memo}` : `Payment request ${req.id}`,
        idempotencyKey: args?.idempotencyKey,
        requestId: req.id,
      });

      const body = await response.json();
      return toolText(body, !response.ok);
    }

    case 'decline_request': {
      const id = String(args?.requestId || '').trim();
      if (!id) return toolText({ error: 'requestId is required.' }, true);
      if (!c.env.DB) return toolText({ error: 'Database unavailable' }, true);

      const req = await c.env.DB.prepare(`SELECT * FROM payment_requests WHERE id = ?`).bind(id).first<any>();
      if (!req) return toolText({ error: 'Request not found.' }, true);

      const currentHandle = String(session.x_handle || '').trim().replace(/^@+/, '').toLowerCase();
      const targetHandle = String(req.requested_handle || '').trim().replace(/^@+/, '').toLowerCase();

      if (targetHandle !== currentHandle && req.requested_x_id !== session.x_id) {
        return toolText({ error: 'Unauthorized: This request was sent to a different account.' }, true);
      }

      if (req.status !== 'PENDING') {
        return toolText({ error: `Request cannot be declined (current status: ${req.status}).` }, true);
      }

      const reason = typeof args?.reason === 'string' ? args.reason.trim().slice(0, 200) : null;
      await c.env.DB.prepare(
        `UPDATE payment_requests SET status = 'DECLINED', decline_reason = ?, completed_at = ? WHERE id = ?`
      )
        .bind(reason, Date.now(), id)
        .run();

      return toolText({ success: true, status: 'DECLINED', requestId: id });
    }

    default:
      return null; // signal unknown tool
  }
}

async function mcpHandler(c: Context<AppContext>): Promise<Response> {
  const message = (c.get('parsedBody' as any) ||
    (await c.req.json().catch(() => null))) as JsonRpcRequest | null;

  if (!message || typeof message !== 'object' || !message.method) {
    return c.json(rpcError(null, -32700, 'Parse error: expected a JSON-RPC 2.0 message.'), 400);
  }

  const { id, method, params } = message;

  // Notifications carry no id and expect no response body.
  if (id === undefined || id === null) {
    return c.body(null, 202);
  }

  switch (method) {
    case 'initialize': {
      const sessionId = c.req.header('Mcp-Session-Id') || `mcp_${c.get('agent')!.key_id}`;
      c.header('Mcp-Session-Id', sessionId);
      return c.json(
        rpcResult(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        })
      );
    }

    case 'ping':
      return c.json(rpcResult(id, {}));

    case 'tools/list':
      return c.json(rpcResult(id, { tools: TOOLS }));

    case 'resources/list':
      return c.json(rpcResult(id, { resources: [] }));

    case 'resources/templates/list':
      return c.json(rpcResult(id, { resourceTemplates: [] }));

    case 'prompts/list':
      return c.json(rpcResult(id, { prompts: [] }));

    case 'tools/call': {
      const name = String(params?.name || '');
      const args = params?.arguments || {};
      try {
        const result = await callTool(c, name, args);
        if (result === null) {
          return c.json(rpcError(id, -32602, `Unknown tool: ${name}`));
        }
        return c.json(rpcResult(id, result));
      } catch (err: any) {
        console.error('[mcp] tool call failed:', name, err);
        return c.json(rpcResult(id, toolText({ error: publicErrorMessage(err, 'tool failed') }, true)));
      }
    }

    default:
      return c.json(rpcError(id, -32601, `Method not found: ${method}`));
  }
}

/** Minimal GET probe so clients can confirm the endpoint exists. */
function mcpProbe(c: Context<AppContext>): Response {
  return c.json({ name: SERVER_INFO.name, version: SERVER_INFO.version, protocol: 'mcp' });
}

export async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  session: Session,
  agent: AgentPrincipal
): Promise<Response> {
  const parsedBody = await request.clone().json().catch(() => null);
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.set('session', session);
    c.set('agent', agent);
    c.set('parsedBody' as any, parsedBody);
    await next();
    c.header('Cache-Control', 'no-store');
  });
  app.post('/api/mcp', mcpHandler);
  app.get('/api/mcp', mcpProbe);
  return await app.fetch(request, env, ctx);
}

mcpRouter.post('/', requireAgent(), async (c) =>
  handleMcpRequest(c.req.raw, c.env, c.executionCtx as unknown as ExecutionContext, c.get('session')!, c.get('agent')!)
);

mcpRouter.get('/', requireAgent(), mcpProbe);
