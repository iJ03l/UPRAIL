import React from 'react';
import { Code, Callout, Endpoint, Field } from '@/components/docs/DocsUI';

export default function McpDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          MCP &amp; OpenAPI Actions
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          Connect Claude, OpenAI Dot, Grok Bot, Meta Muse &amp; Cursor
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          UPRAIL exposes a universal <strong className="text-stone-900">1-Click MCP URL</strong>, a
          standard <strong className="text-stone-900">MCP JSON config</strong>, and an{' '}
          <strong className="text-stone-900">OpenAPI 3.1 spec</strong> so you can connect any AI chat
          interface in seconds. Every tool call runs under your key&apos;s USD spend limits.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Option A — 1-Click Connector URL (Grok Bot, Meta Muse, OpenAI Dot, Claude Web/Mobile)
        </h2>
        <Endpoint verb="POST" path="/api/mcp?key=up_agent_…" auth="Self-authenticated URL" />
        <p className="text-sm text-stone-600 leading-relaxed">
          For AI chats that accept a single Remote MCP / Connector URL without a separate custom
          header field, paste your 1-click URL directly:
        </p>
        <Code title="1-Click MCP Server URL">{`https://api.uprail.world/api/mcp?key=up_agent_YOUR_KEY`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Option B — OpenAI Dot / ChatGPT, Grok &amp; Meta Muse OpenAPI Actions
        </h2>
        <Endpoint verb="GET" path="/api/agent/openapi.json" auth="public" />
        <p className="text-sm text-stone-600 leading-relaxed">
          In <strong className="text-stone-900">OpenAI Dot / ChatGPT</strong>,{' '}
          <strong className="text-stone-900">Grok Studio</strong>, or{' '}
          <strong className="text-stone-900">Meta Muse</strong>, open{' '}
          <strong className="text-stone-900">Actions / Tools → Import from URL</strong>, paste{' '}
          <code className="font-mono text-[13px]">https://api.uprail.world/api/agent/openapi.json</code>,
          and set Authentication to <strong className="text-stone-900">API Key (Bearer)</strong> with
          your <code className="font-mono text-[13px]">up_agent_…</code> key.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">
          Option C — Claude Desktop, Cursor &amp; Windsurf (MCP JSON)
        </h2>
        <Endpoint verb="POST" path="/api/mcp" auth="Bearer agent key" />
        <Code title="MCP config JSON">{`{
  "mcpServers": {
    "uprail": {
      "url": "https://api.uprail.world/api/mcp",
      "headers": {
        "Authorization": "Bearer up_agent_…"
      }
    }
  }
}`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Available tools</h2>

        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="pay_handle" type="recipientHandle, asset, amount, memo?">
            Send a confidential payment to an X <code className="font-mono">@handle</code> within
            your USD spend limits.
          </Field>
          <Field name="receive_payment" type="chain?, token?, amount?">
            Get your UPRAIL <code className="font-mono">@handle</code>, check pending incoming
            payments, or generate a fresh deposit address on any supported blockchain.
          </Field>
          <Field name="get_balance" type="asset?: string">
            Read your available UPRAIL balance for a token (e.g. USDC, USDT, NEAR).
          </Field>
          <Field name="list_payments" type="none">
            List your recent sent and received payments on UPRAIL.
          </Field>
          <Field name="resolve_handle" type="handle: string">
            Check if an X <code className="font-mono">@handle</code> has activated UPRAIL.
          </Field>
        </div>

        <h3 className="text-base font-display font-bold text-stone-950 pt-2">Example MCP call</h3>
        <Code title="tools/call">{`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "pay_handle",
    "arguments": {
      "recipientHandle": "@alice",
      "asset": "USDC",
      "amount": 10,
      "memo": "coffee"
    }
  }
}`}</Code>
        <Callout>
          <strong className="text-stone-900">Shared USD enforcement.</strong> Both MCP{' '}
          <code className="font-mono text-[13px]">pay_handle</code> and REST{' '}
          <code className="font-mono text-[13px]">POST /api/agent/pay</code> run through the exact
          same atomic USD spend reservation and quote-and-send pipeline.
        </Callout>
      </section>
    </article>
  );
}
