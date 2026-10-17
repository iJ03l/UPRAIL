import React from 'react';
import { Code, Callout, Endpoint, Field } from '@/components/docs/DocsUI';

export default function McpDocsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-orange-600">
          Feature 1
        </div>
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-stone-950">
          MCP server
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          UPRAIL exposes a Model Context Protocol server over Streamable HTTP, so any MCP client can
          resolve handles, read balances, pay, and create payment requests. Every tool call
          authenticates with a Bearer agent key and runs under that key&apos;s spend policy.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Endpoint</h2>
        <Endpoint verb="POST" path="/api/mcp" auth="Bearer agent key" />
        <p className="text-sm text-stone-600 leading-relaxed">
          A single JSON-RPC 2.0 endpoint implementing <code className="font-mono text-[13px]">initialize</code>,{' '}
          <code className="font-mono text-[13px]">tools/list</code>,{' '}
          <code className="font-mono text-[13px]">tools/call</code>, and{' '}
          <code className="font-mono text-[13px]">ping</code>. Notifications (no{' '}
          <code className="font-mono text-[13px]">id</code>) return <code className="font-mono text-[13px]">202</code>.
        </p>
        <Code title="Client config">{`{
  "mcpServers": {
    "uprail": {
      "type": "http",
      "url": "https://api.uprail.world/api/mcp",
      "headers": {
        "Authorization": "Bearer up_agent_…"
      }
    }
  }
}`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Tools</h2>

        <div className="rounded-2xl border border-stone-200 px-4 py-1">
          <Field name="resolve_handle" type="handle: string">
            Resolve an X handle to an UPRAIL identity and NEAR account.
          </Field>
          <Field name="get_balance" type="asset?: string">
            Read the owner&apos;s available balance (defaults to NEAR).
          </Field>
          <Field name="pay_handle" type="recipientHandle, asset, amount, memo?">
            Send a confidential payment to an X handle, subject to the key&apos;s policy.
          </Field>
          <Field name="create_payment_request" type="asset, amount, description?, resource?">
            Mint an x402 payment request payable by any chain. See the x402 section.
          </Field>
        </div>

        <h3 className="text-base font-display font-bold text-stone-950 pt-2">Call a tool</h3>
        <Code title="tools/call">{`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "pay_handle",
    "arguments": {
      "recipientHandle": "@alice",
      "asset": "USDC",
      "amount": "12.50",
      "memo": "api credits"
    }
  }
}`}</Code>
        <p className="text-sm text-stone-600 leading-relaxed">
          Tool output is returned as a text content block containing JSON. On failure the block is
          marked <code className="font-mono text-[13px]">isError: true</code>.
        </p>
        <Callout>
          <strong className="text-stone-900">Policy is shared.</strong> <code className="font-mono text-[13px]">pay_handle</code>{' '}
          is gated by the exact same rule evaluator as the REST <code className="font-mono text-[13px]">/api/agent/pay</code>{' '}
          route, so a payment is blocked or queued identically no matter which surface submitted it.
          In Always-Ask mode, a blocked payment returns the pending-approval payload as tool data.
        </Callout>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-display font-extrabold text-stone-950">Probe</h2>
        <Endpoint verb="GET" path="/api/mcp" />
        <Code title="Response">{`{ "name": "uprail", "version": "1.0.0", "protocol": "mcp" }`}</Code>
      </section>
    </article>
  );
}
