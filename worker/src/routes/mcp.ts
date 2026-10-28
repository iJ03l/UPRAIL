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
      'Send a confidential payment to an X (Twitter) @handle on UPRAIL. Subject to the key’s per-transaction and daily USD spend caps.',
    inputSchema: {
      type: 'object',
      properties: {
        recipientHandle: {
          type: 'string',
          description: 'Recipient X handle, e.g. @alice or alice',
        },
        asset: {
          type: 'string',
          description: 'Asset symbol, e.g. USDC, USDT, NEAR',
        },
        amount: {
          type: ['string', 'number'],
          description: 'Human-readable token amount to send',
        },
        memo: {
          type: 'string',
          description: 'Optional note attached to the payment',
        },
        idempotencyKey: {
          type: 'string',
          description:
            'Optional unique key. Retrying with the same key never sends a second payment.',
        },
      },
      required: ['recipientHandle', 'asset', 'amount'],
    },
  },
  {
    name: 'withdraw_to_wallet',
    description:
      'Withdraw funds from your confidential UPRAIL vault to an external wallet address. Subject to the key’s per-payment and daily USD spend caps. Requires an explicit amount; “all” is not accepted.',
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
            'Optional unique key. Retrying with the same key never sends a second withdrawal.',
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
      "Read the owner's public and confidential UPRAIL balances. If asset is omitted or 'all', returns balances for all held tokens (USDC, NEAR, USDT, etc.).",
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
        const available = await nearRpc.getUserAvailableBalance(c.env, session, requestedAsset);
        let confidential = 0;
        if (isConfidentialRailEnabled(c.env)) {
          try {
            confidential = await getConfidentialAvailableBalance(c.env, session.x_id, requestedAsset);
          } catch (err) {
            console.warn('[mcp] confidential balance lookup skipped:', err);
          }
        }
        return toolText({
          handle: `@${session.x_handle}`,
          asset: requestedAsset.toUpperCase(),
          available,
          confidential,
          total: available + confidential,
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
          let available = 0;
          let confidential = 0;
          try {
            available = await nearRpc.getUserAvailableBalance(c.env, session, asset);
          } catch {}
          if (isConfidentialRailEnabled(c.env)) {
            try {
              confidential = await getConfidentialAvailableBalance(c.env, session.x_id, asset);
            } catch {}
          }
          return {
            asset,
            available,
            confidential,
            total: available + confidential,
          };
        })
      );

      const nonZeroOrStandard = balances.filter(
        (b) => ['USDC', 'NEAR', 'USDT'].includes(b.asset) || b.total > 0
      );

      return toolText({
        handle: `@${session.x_handle}`,
        balances: nonZeroOrStandard,
      });
    }

    case 'pay_handle': {
      const response = await executeAgentPay(c, {
        recipientHandle: args?.recipientHandle ?? args?.recipient ?? args?.handle,
        asset: args?.asset ?? args?.token,
        amount: args?.amount,
        memo: args?.memo,
        idempotencyKey: args?.idempotencyKey,
      });
      const payload = await response.json().catch(() => ({}));
      return toolText(payload, response.status !== 201);
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
      return toolText({ payments });
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
