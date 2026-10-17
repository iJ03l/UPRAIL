/**
 * Model Context Protocol (MCP) server for UP (UPRAIL.app).
 *
 * Implemented as a JSON-RPC 2.0 server over Streamable HTTP: a single POST
 * endpoint that accepts `initialize`, `tools/list`, and `tools/call`. Requests
 * authenticate with the same Bearer agent key as the rest of the agent rail, so
 * every tool acts with the owner's identity and spend policy.
 *
 * Tools: resolve_handle, get_balance, pay_handle, create_payment_request.
 */

import { Context, Hono } from 'hono';
import type { AppContext } from '../types';
import { requireAgent, handleAgentPaymentIntent } from '../middleware/agentAuth';
import { handleSendPayment } from './payments';
import { addAgentSpend } from '../services/agentKeys';
import { mintChallenge } from '../services/x402Challenge';
import * as nearRpc from '../services/nearRpc';

export const mcpRouter = new Hono<AppContext>();

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
    name: 'resolve_handle',
    description: 'Resolve an X handle to a UPRAIL identity and its NEAR account.',
    inputSchema: {
      type: 'object',
      properties: { handle: { type: 'string', description: 'X handle, with or without @' } },
      required: ['handle'],
    },
  },
  {
    name: 'get_balance',
    description: "Read the owner's available UPRAIL balance for an asset.",
    inputSchema: {
      type: 'object',
      properties: { asset: { type: 'string', description: 'Asset symbol, e.g. NEAR or USDC' } },
    },
  },
  {
    name: 'pay_handle',
    description: 'Send a confidential payment to an X handle. Subject to the agent spend policy.',
    inputSchema: {
      type: 'object',
      properties: {
        recipientHandle: { type: 'string' },
        asset: { type: 'string' },
        amount: { type: ['string', 'number'], description: 'Human-readable amount' },
        memo: { type: 'string' },
      },
      required: ['recipientHandle', 'asset', 'amount'],
    },
  },
  {
    name: 'create_payment_request',
    description: 'Create an x402 payment request (402 challenge) payable by any chain.',
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string' },
        amount: { type: ['string', 'number'] },
        description: { type: 'string' },
        resource: { type: 'string' },
      },
      required: ['asset', 'amount'],
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
  const agent = c.get('agent')!;
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
      const asset = String(args?.asset || 'NEAR');
      const available = await nearRpc.getUserAvailableBalance(c.env, session, asset);
      return toolText({ asset, available });
    }

    case 'pay_handle': {
      const recipientHandle = String(args?.recipientHandle || '').trim();
      const asset = String(args?.asset || '').trim();
      const amount = parseFloat(String(args?.amount));
      if (!recipientHandle || !asset || !Number.isFinite(amount) || amount <= 0) {
        return toolText({ error: 'recipientHandle, asset, and a positive amount are required.' }, true);
      }

      const blocked = await handleAgentPaymentIntent(c, agent, {
        recipientHandle,
        asset,
        amount,
        memo: typeof args?.memo === 'string' ? args.memo : undefined,
      });
      if (blocked) {
        const data = await blocked.json().catch(() => ({}));
        return toolText(data, blocked.status >= 400);
      }

      // Run the exact human send pipeline with the tool arguments as the body.
      c.set('parsedBody' as any, { recipientHandle, asset, amount, memo: args?.memo });
      const response = await handleSendPayment(c);
      const payload = await response.json().catch(() => ({}));
      if (response.status === 201) {
        c.executionCtx?.waitUntil?.(addAgentSpend(c.env, agent.key_id, amount));
        return toolText(payload);
      }
      return toolText(payload, true);
    }

    case 'create_payment_request': {
      const asset = String(args?.asset || '').trim();
      const amount = String(args?.amount ?? '').trim();
      if (!asset || !(parseFloat(amount) > 0)) {
        return toolText({ error: 'asset and a positive amount are required.' }, true);
      }
      const { requirement, challenge } = await mintChallenge(c.env, {
        recipientHandle: session.x_handle,
        asset,
        amount,
        description: args?.description ? String(args.description) : undefined,
        resourceUrl: args?.resource ? String(args.resource) : undefined,
      });
      return toolText({
        requirement,
        depositAddress: challenge.depositAddress,
        expiresAt: challenge.expiresAt,
        recipientHandle: session.x_handle,
      });
    }

    default:
      return null; // signal unknown tool
  }
}

mcpRouter.post('/', requireAgent(), async (c) => {
  const message = (c.get('parsedBody' as any) ||
    (await c.req.json().catch(() => null))) as JsonRpcRequest | null;

  if (!message || typeof message !== 'object' || !message.method) {
    return c.json(rpcError(null, -32700, 'Parse error: expected a JSON-RPC 2.0 message.'), 400);
  }

  const { id, method, params } = message;

  // Notifications carry no id and expect no response body.
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized' || method === 'initialized') {
      return c.body(null, 202);
    }
    return c.body(null, 202);
  }

  switch (method) {
    case 'initialize':
      return c.json(
        rpcResult(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        })
      );

    case 'ping':
      return c.json(rpcResult(id, {}));

    case 'tools/list':
      return c.json(rpcResult(id, { tools: TOOLS }));

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
        return c.json(rpcResult(id, toolText({ error: err?.message || 'tool failed' }, true)));
      }
    }

    default:
      return c.json(rpcError(id, -32601, `Method not found: ${method}`));
  }
});

/** Minimal GET probe so clients can confirm the endpoint exists. */
mcpRouter.get('/', (c) => c.json({ name: SERVER_INFO.name, version: SERVER_INFO.version, protocol: 'mcp' }));
